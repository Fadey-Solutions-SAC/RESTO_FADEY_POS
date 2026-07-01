const { queryAll, queryOne } = require('../database');
const { getOpenRegistersOnActiveStations } = require('../cajaSettings');

const PAID_SALES_WHERE = `o.status != 'cancelled'
  AND o.payment_status = 'paid'
  AND IFNULL(o.payment_method, '') != 'cortesia'`;

const ORDER_EVENT_SQL = 'COALESCE(o.updated_at, o.created_at)';

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

function querySoldProductsBetween(openedAt, closedAt) {
  const end = closedAt || new Date().toISOString();
  const rows = queryAll(
    `SELECT
      oi.product_id,
      oi.product_name,
      COALESCE(SUM(oi.quantity), 0) as total_qty,
      COALESCE(SUM(oi.subtotal), 0) as total_amount,
      COUNT(DISTINCT oi.order_id) as order_count
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE ${PAID_SALES_WHERE}
       AND ${ORDER_EVENT_SQL} >= ?
       AND ${ORDER_EVENT_SQL} <= ?
     GROUP BY oi.product_id, oi.product_name
     ORDER BY total_qty DESC, oi.product_name ASC`,
    [openedAt, end],
  );
  return mapSoldRows(rows);
}

function querySoldProductsByLocalDateRange(from, to) {
  const rows = queryAll(
    `SELECT
      oi.product_id,
      oi.product_name,
      COALESCE(SUM(oi.quantity), 0) as total_qty,
      COALESCE(SUM(oi.subtotal), 0) as total_amount,
      COUNT(DISTINCT oi.order_id) as order_count
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE ${PAID_SALES_WHERE}
       AND DATE(datetime(${ORDER_EVENT_SQL}, 'localtime')) >= date(?)
       AND DATE(datetime(${ORDER_EVENT_SQL}, 'localtime')) <= date(?)
     GROUP BY oi.product_id, oi.product_name
     ORDER BY total_qty DESC, oi.product_name ASC`,
    [from, to],
  );
  return mapSoldRows(rows);
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
  return queryAll(
    `SELECT cr.*, u.full_name as user_name
     FROM cash_registers cr
     LEFT JOIN users u ON u.id = cr.user_id
     WHERE cr.closed_at IS NOT NULL
       AND DATE(datetime(cr.closed_at, 'localtime')) >= date(?)
       AND DATE(datetime(cr.closed_at, 'localtime')) <= date(?)
     ORDER BY cr.closed_at DESC`,
    [from, to],
  );
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
      const sold_products = querySoldProductsBetween(reg.opened_at, null);
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
      const sold_products = querySoldProductsBetween(reg.opened_at, reg.closed_at);
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
    const sold_products = querySoldProductsByLocalDateRange(from, to);
    const closures = loadClosedRegistersInDateRange(from, to);
    const byRegister = closures.map((reg) => {
      const sp = querySoldProductsBetween(reg.opened_at, reg.closed_at);
      return {
        register_id: reg.id,
        user_name: reg.user_name || '',
        opened_at: reg.opened_at,
        closed_at: reg.closed_at,
        is_open: false,
        sold_products: sp,
        product_sales_total: sumProductTotal(sp),
      };
    });
    return {
      mode: 'date_range',
      sold_products,
      by_register: byRegister,
      product_sales_total: sumProductTotal(sold_products),
      filters: { from, to, closure_count: byRegister.length },
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
