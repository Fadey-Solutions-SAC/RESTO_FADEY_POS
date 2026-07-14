const { queryAll, queryOne } = require('../database');
const { getOpenRegistersOnActiveStations, listCajasWithIds } = require('../cajaSettings');
const { getMovementTotals, getCashNoteTotals } = require('./registerSessionSales');
const { sqlBusinessTimestamp, getBusinessTodayDateKey } = require('../utils/appDateTime');

const PAID_SALES_WHERE = `o.status != 'cancelled'
  AND o.payment_status = 'paid'
  AND IFNULL(o.payment_method, '') NOT IN ('cortesia', 'cuenta_cliente')`;

/** Momento real del cobro (igual que arqueo de caja). */
const PAID_ORDER_EVENT_AT = 'COALESCE(o.paid_at, o.updated_at, o.created_at)';

function parseYmd(input) {
  const v = String(input || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
}

function mapSoldRows(rows) {
  return (rows || []).map((row) => {
    const qty = Number(row.total_qty) || 0;
    const amt = Number(row.total_amount) || 0;
    return {
      product_id: row.product_id,
      product_name: row.product_name,
      total_qty: qty,
      total_amount: amt,
      order_count: Number(row.order_count) || 0,
      unit_price: qty > 0 ? amt / qty : 0,
    };
  });
}

function registerSalesWindowSql(registerId, openedAt, closedAt) {
  const end = closedAt || new Date().toISOString();
  const id = String(registerId || '').trim();
  if (id) {
    return {
      clause: `(
        IFNULL(o.cash_register_id, '') = ?
        OR (
          IFNULL(o.cash_register_id, '') = ''
          AND ${PAID_ORDER_EVENT_AT} >= ?
          AND ${PAID_ORDER_EVENT_AT} <= ?
        )
      )`,
      params: [id, openedAt, end],
    };
  }
  return {
    clause: `${PAID_ORDER_EVENT_AT} >= ? AND ${PAID_ORDER_EVENT_AT} <= ?`,
    params: [openedAt, end],
  };
}

function querySoldProductsBetween(openedAt, closedAt, registerId = null) {
  const window = registerSalesWindowSql(registerId, openedAt, closedAt);
  const qtyRows = queryAll(
    `SELECT
      oi.product_id,
      oi.product_name,
      COALESCE(SUM(oi.quantity), 0) as total_qty,
      COALESCE(SUM(oi.subtotal), 0) as total_amount
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE ${PAID_SALES_WHERE}
       AND ${window.clause}
     GROUP BY oi.product_id, oi.product_name
     ORDER BY total_qty DESC, oi.product_name ASC`,
    window.params,
  );
  const accountRows = queryAll(
    `SELECT DISTINCT
      oi.product_id,
      oi.product_name,
      o.id,
      o.type,
      o.table_number,
      o.cash_register_id,
      o.customer_id,
      o.paid_at,
      o.updated_at,
      o.created_at
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE ${PAID_SALES_WHERE}
       AND ${window.clause}`,
    window.params,
  );
  const { countSalesAccounts } = require('../utils/salesAccountGrouping');
  const accountCounts = new Map();
  const ordersByProduct = new Map();
  for (const row of accountRows || []) {
    const productKey = String(row.product_id || row.product_name || '').trim() || row.product_name;
    if (!ordersByProduct.has(productKey)) ordersByProduct.set(productKey, new Map());
    ordersByProduct.get(productKey).set(String(row.id), row);
  }
  for (const [productKey, orderMap] of ordersByProduct.entries()) {
    accountCounts.set(productKey, countSalesAccounts([...orderMap.values()]));
  }
  return mapSoldRows((qtyRows || []).map((row) => ({
    ...row,
    order_count: accountCounts.get(String(row.product_id || row.product_name || '').trim() || row.product_name) || 0,
  })));
}

function sumProductTotal(products) {
  return (products || []).reduce((s, r) => s + (Number(r.total_amount) || 0), 0);
}

function loadRegisterMeta(registerId) {
  return queryOne(
    `SELECT cr.*, u.full_name as user_name
     FROM cash_registers cr
     LEFT JOIN users u ON u.id = cr.user_id
     WHERE cr.id = ?`,
    [registerId],
  );
}

function loadClosedRegistersInDateRange(from, to) {
  const closedLocal = sqlBusinessTimestamp('cr.closed_at', queryOne);
  return queryAll(
    `SELECT cr.*, u.full_name as user_name
     FROM cash_registers cr
     LEFT JOIN users u ON u.id = cr.user_id
     WHERE cr.closed_at IS NOT NULL
       AND DATE(${closedLocal}) >= date(?)
       AND DATE(${closedLocal}) <= date(?)
     ORDER BY cr.closed_at DESC`,
    [from, to],
  );
}

function stationNameForId(cajaStationId) {
  const id = String(cajaStationId || '').trim();
  if (!id) return 'Sin caja';
  const match = listCajasWithIds().find((c) => c.id === id);
  return match?.name || 'Caja';
}

function mapRegisterToProductBlock(reg, { isOpen = false } = {}) {
  const sold_products = querySoldProductsBetween(reg.opened_at, isOpen ? null : reg.closed_at, reg.id);
  const cajaStationId = String(reg.caja_station_id || '').trim();
  const movements = reg?.id ? getMovementTotals(reg.id) : { total_expense: 0 };
  const notes = reg?.id ? getCashNoteTotals(reg.id) : { notes_debit: 0 };
  return {
    register_id: reg.id,
    caja_station_id: cajaStationId,
    station_name: stationNameForId(cajaStationId),
    user_name: reg.user_name || reg.cajero_name || '',
    opened_at: reg.opened_at,
    closed_at: isOpen ? null : reg.closed_at,
    is_open: isOpen,
    total_sales: Number(reg.total_sales || 0),
    total_cash: Number(reg.total_cash || 0),
    total_card: Number(reg.total_card || 0),
    total_yape: Number(reg.total_yape || 0),
    total_plin: Number(reg.total_plin || 0),
    cash_expenses: Number(movements.total_expense || 0),
    notes_debit: Number(notes.notes_debit || 0),
    sold_products,
    product_sales_total: sumProductTotal(sold_products),
  };
}

function buildRegisterBlocksForDateRange(from, to) {
  const closures = loadClosedRegistersInDateRange(from, to);
  const blocks = closures.map((reg) => mapRegisterToProductBlock(reg));

  const today = getBusinessTodayDateKey(queryOne);
  if (to >= today && from <= today) {
    const openRegisters = getOpenRegistersOnActiveStations();
    for (const reg of openRegisters) {
      if (!reg?.id) continue;
      blocks.push(mapRegisterToProductBlock(reg, { isOpen: true }));
    }
  }

  return blocks;
}

function buildProductSalesReport(query = {}) {
  const from = parseYmd(query.from);
  const to = parseYmd(query.to);
  const current = String(query.current || '').trim() === '1' || query.current === true;
  const registerIdsRaw = String(query.register_ids || query.registerIds || '').trim();
  const registerIds = registerIdsRaw
    ? registerIdsRaw.split(',').map((x) => x.trim()).filter(Boolean)
    : [];

  if (current) {
    const openRegisters = getOpenRegistersOnActiveStations();
    if (!openRegisters.length) {
      return {
        mode: 'current',
        register_open: false,
        sold_products: [],
        by_register: [],
        product_sales_total: 0,
        filters: { current: true },
      };
    }
    const byRegister = openRegisters.map((reg) => {
      const sold_products = querySoldProductsBetween(reg.opened_at, null, reg.id);
      return {
        register_id: reg.id,
        user_name: reg.user_name || reg.cajero_name || '',
        opened_at: reg.opened_at,
        closed_at: null,
        is_open: true,
        sold_products,
        product_sales_total: sumProductTotal(sold_products),
      };
    });
    const merged = mergeSoldProducts(byRegister.flatMap((r) => r.sold_products));
    return {
      mode: 'current',
      register_open: true,
      sold_products: merged,
      by_register: byRegister,
      product_sales_total: sumProductTotal(merged),
      filters: {
        current: true,
        register_count: byRegister.length,
      },
    };
  }

  if (registerIds.length) {
    const byRegister = [];
    for (const id of registerIds) {
      const reg = loadRegisterMeta(id);
      if (!reg?.id || !reg.closed_at) continue;
      const sold_products = querySoldProductsBetween(reg.opened_at, reg.closed_at, reg.id);
      byRegister.push({
        register_id: reg.id,
        user_name: reg.user_name || '',
        opened_at: reg.opened_at,
        closed_at: reg.closed_at,
        is_open: false,
        sold_products,
        product_sales_total: sumProductTotal(sold_products),
      });
    }
    const merged = mergeSoldProducts(byRegister.flatMap((r) => r.sold_products));
    return {
      mode: 'registers',
      sold_products: merged,
      by_register: byRegister,
      product_sales_total: sumProductTotal(merged),
      filters: {
        register_ids: byRegister.map((r) => r.register_id),
        register_count: byRegister.length,
      },
    };
  }

  if (from && to) {
    const byRegister = buildRegisterBlocksForDateRange(from, to);
    const sold_products = mergeSoldProducts(byRegister.flatMap((r) => r.sold_products));
    return {
      mode: 'date_range',
      sold_products,
      by_register: byRegister,
      product_sales_total: sumProductTotal(sold_products),
      filters: {
        from,
        to,
        closure_count: byRegister.filter((r) => !r.is_open).length,
        register_count: byRegister.length,
      },
    };
  }

  return {
    mode: 'none',
    sold_products: [],
    by_register: [],
    product_sales_total: 0,
    filters: {},
    error: 'Indique rango de fechas (from/to), register_ids o current=1',
  };
}

function mergeSoldProducts(rows) {
  const m = new Map();
  for (const row of rows || []) {
    const key = String(row.product_id || row.product_name || '').trim() || row.product_name;
    const prev = m.get(key) || {
      product_id: row.product_id,
      product_name: row.product_name,
      total_qty: 0,
      total_amount: 0,
      order_count: 0,
    };
    prev.total_qty += Number(row.total_qty) || 0;
    prev.total_amount += Number(row.total_amount) || 0;
    prev.order_count += Number(row.order_count) || 0;
    m.set(key, prev);
  }
  return [...m.values()]
    .map((r) => ({
      ...r,
      unit_price: r.total_qty > 0 ? r.total_amount / r.total_qty : 0,
    }))
    .sort((a, b) => b.total_qty - a.total_qty || String(a.product_name).localeCompare(String(b.product_name), 'es'));
}

module.exports = {
  buildProductSalesReport,
  querySoldProductsBetween,
  mergeSoldProducts,
};
