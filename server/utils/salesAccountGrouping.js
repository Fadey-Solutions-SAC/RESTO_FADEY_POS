/**
 * Cuenta de venta: agrupa comandas cobradas en un mismo cobro (N.º de venta).
 * Las comandas siguen existiendo para cocina/bar; la venta se cuenta por cuenta (un comprobante).
 */
const { queryAll, queryOne, ensureOrdersPaidAtColumns } = require('../database');
const { resolveRegionalTimezone } = require('./appDateTime');

const PAID_SALES_BASE_WHERE = `status != 'cancelled'
  AND payment_status = 'paid'
  AND IFNULL(payment_method, '') NOT IN ('cortesia', 'cuenta_cliente')`;

const PAID_SALES_JOIN_WHERE = `o.status != 'cancelled'
  AND o.payment_status = 'paid'
  AND IFNULL(o.payment_method, '') NOT IN ('cortesia', 'cuenta_cliente')`;

function paidAtSql(alias = '') {
  const p = alias ? `${alias}.` : '';
  const hasPaidAt = ensureOrdersPaidAtColumns();
  if (hasPaidAt) return `COALESCE(${p}paid_at, ${p}updated_at, ${p}created_at)`;
  return `COALESCE(${p}updated_at, ${p}created_at)`;
}

function salesAccountOrderSelectSql() {
  const hasPaidAt = ensureOrdersPaidAtColumns();
  const paidCol = hasPaidAt ? 'paid_at' : 'NULL AS paid_at';
  let registerCol = "'' AS cash_register_id";
  try {
    const cols = queryAll('PRAGMA table_info(orders)') || [];
    if (cols.some((c) => c.name === 'cash_register_id')) registerCol = 'cash_register_id';
  } catch {
    /* ignore */
  }
  return `id, type, table_number, ${registerCol}, customer_id, customer_name, order_number, sale_number,
  ${paidCol}, updated_at, created_at, total, subtotal, tax, discount, tip_amount,
  payment_method, payment_breakdown, payment_status, status, created_by_user_id, created_by_user_name`;
}

function partsFromDate(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const map = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour,
    minute: map.minute,
    second: map.second,
  };
}

function parseOrderDate(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const normalized = text.includes('T') ? text : text.replace(' ', 'T');
  const withZone = /[zZ]|[+-]\d{2}:\d{2}$/.test(normalized) ? normalized : `${normalized}Z`;
  const d = new Date(withZone);
  return Number.isNaN(d.getTime()) ? null : d;
}

function salesAccountPaidAtBucket(order, timeZone) {
  const raw = order?.paid_at || order?.updated_at || order?.created_at || '';
  const d = parseOrderDate(raw);
  if (!d) return `unknown:${order?.id || ''}`;
  const p = partsFromDate(d, timeZone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

function salesAccountKey(order, timeZone = resolveRegionalTimezone(queryOne)) {
  if (!order) return '';
  const saleNum = Number(order.sale_number || 0);
  if (saleNum > 0) return `venta:${saleNum}`;
  const table = String(order.table_number || '').trim();
  const type = String(order.type || 'dine_in');
  const isMesa = type === 'dine_in' && table;
  if (isMesa) {
    const registerId = String(order.cash_register_id || '');
    return `mesa:${table}:${registerId}:${salesAccountPaidAtBucket(order, timeZone)}`;
  }
  const customerId = String(order.customer_id || '').trim();
  const registerId = String(order.cash_register_id || '');
  if (customerId) {
    return `cliente:${customerId}:${registerId}:${salesAccountPaidAtBucket(order, timeZone)}`;
  }
  return `pedido:${order.id || ''}`;
}

function groupPaidOrdersBySalesAccount(orders = [], queryOneFn = queryOne) {
  const tz = resolveRegionalTimezone(queryOneFn);
  const buckets = new Map();
  for (const order of orders || []) {
    if (!order) continue;
    const key = salesAccountKey(order, tz);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(order);
  }
  return [...buckets.values()];
}

function countSalesAccounts(orders = [], queryOneFn = queryOne) {
  return groupPaidOrdersBySalesAccount(orders, queryOneFn).length;
}

function queryPaidSalesOrders(whereSql, params = [], queryAllFn = queryAll) {
  ensureOrdersPaidAtColumns();
  const clause = String(whereSql || '').trim() || '1=1';
  return queryAllFn(
    `SELECT ${salesAccountOrderSelectSql()}
     FROM orders o
     WHERE ${PAID_SALES_JOIN_WHERE}
       AND (${clause})`,
    params,
  ) || [];
}

function countSalesAccountsWhere(whereSql, params = [], queryOneFn = queryOne) {
  const rows = queryPaidSalesOrders(whereSql, params);
  return countSalesAccounts(rows, queryOneFn);
}

function summarizeSalesAccounts(orders = [], queryOneFn = queryOne) {
  const groups = groupPaidOrdersBySalesAccount(orders, queryOneFn);
  return {
    account_count: groups.length,
    comanda_count: (orders || []).length,
  };
}

/** Mapa order_id → clave de cuenta (para métricas por producto). */
function buildOrderAccountKeyMap(orders = [], queryOneFn = queryOne) {
  const tz = resolveRegionalTimezone(queryOneFn);
  const map = new Map();
  for (const order of orders || []) {
    if (!order?.id) continue;
    map.set(String(order.id), salesAccountKey(order, tz));
  }
  return map;
}

/** Cuentas por día local (YYYY-MM-DD) según paid_at. */
function countSalesAccountsByDay(orders = [], queryOneFn = queryOne) {
  const tz = resolveRegionalTimezone(queryOneFn);
  const dayCounts = new Map();
  for (const group of groupPaidOrdersBySalesAccount(orders, queryOneFn)) {
    const primary = group[0];
    const d = parseOrderDate(primary?.paid_at || primary?.updated_at || primary?.created_at);
    if (!d) continue;
    const p = partsFromDate(d, tz);
    const dayKey = `${p.year}-${p.month}-${p.day}`;
    dayCounts.set(dayKey, (dayCounts.get(dayKey) || 0) + 1);
  }
  return dayCounts;
}

/** Cuentas por hora (0-23) según paid_at. */
function sumSalesAccountsByHour(orders = [], queryOneFn = queryOne) {
  const tz = resolveRegionalTimezone(queryOneFn);
  const byHour = Object.fromEntries([...Array(24)].map((_, h) => [String(h).padStart(2, '0'), { accounts: 0, total: 0 }]));
  for (const group of groupPaidOrdersBySalesAccount(orders, queryOneFn)) {
    const primary = group[0];
    const d = parseOrderDate(primary?.paid_at || primary?.updated_at || primary?.created_at);
    if (!d) continue;
    const p = partsFromDate(d, tz);
    const hour = p.hour;
    const total = group.reduce((sum, row) => sum + Number(row.total || 0), 0);
    byHour[hour].accounts += 1;
    byHour[hour].total += total;
  }
  return byHour;
}

/** Métodos de pago agregados por cuenta (usa método del pedido principal). */
function summarizePaymentMethodsByAccount(orders = [], queryOneFn = queryOne) {
  const methods = new Map();
  for (const group of groupPaidOrdersBySalesAccount(orders, queryOneFn)) {
    const sorted = [...group].sort(
      (a, b) => new Date(String(b?.paid_at || b?.updated_at || 0)).getTime()
        - new Date(String(a?.paid_at || a?.updated_at || 0)).getTime(),
    );
    const primary = sorted[0];
    const method = String(primary?.payment_method || 'efectivo');
    const total = group.reduce((sum, row) => sum + Number(row.total || 0), 0);
    if (!methods.has(method)) methods.set(method, { payment_method: method, count: 0, total: 0 });
    const entry = methods.get(method);
    entry.count += 1;
    entry.total += total;
  }
  return [...methods.values()].sort((a, b) => b.total - a.total);
}

function getPaidSalesEventSql(queryOneFn = queryOne) {
  const { sqlBusinessTimestamp, getBusinessTodayDateKey, getBusinessMonthKey } = require('./appDateTime');
  ensureOrdersPaidAtColumns();
  const at = paidAtSql('');
  const local = sqlBusinessTimestamp(at, queryOneFn);
  const orderAt = paidAtSql('o');
  const orderLocal = sqlBusinessTimestamp(orderAt, queryOneFn);
  const today = getBusinessTodayDateKey(queryOneFn);
  const month = getBusinessMonthKey(queryOneFn);
  return {
    EVENT_AT: at,
    EVENT_LOCAL: local,
    EVENT_DATE: `DATE(${local})`,
    EVENT_MONTH: `strftime('%Y-%m', ${local})`,
    EVENT_HOUR: `strftime('%H', ${local})`,
    ORDER_LOCAL: orderLocal,
    ORDER_DATE: `DATE(${orderLocal})`,
    ORDER_MONTH: `strftime('%Y-%m', ${orderLocal})`,
    TODAY: `'${today}'`,
    MONTH: `'${month}'`,
  };
}

function metricsFromPaidOrdersWhere(whereSql, params = [], queryOneFn = queryOne) {
  const rows = queryPaidSalesOrders(whereSql, params);
  const sales = rows.reduce((sum, row) => sum + Number(row.total || 0), 0);
  const subtotal = rows.reduce((sum, row) => sum + Number(row.subtotal || 0), 0);
  const tax = rows.reduce((sum, row) => sum + Number(row.tax || 0), 0);
  const discount = rows.reduce((sum, row) => sum + Number(row.discount || 0), 0);
  const tips = rows.reduce((sum, row) => sum + Number(row.tip_amount || 0), 0);
  return {
    orders: countSalesAccounts(rows, queryOneFn),
    sales,
    subtotal,
    tax,
    discount,
    tips,
    comandas: rows.length,
  };
}

function summarizeSalesAccountsByDay(orders = [], queryOneFn = queryOne) {
  const tz = resolveRegionalTimezone(queryOneFn);
  const buckets = new Map();
  for (const group of groupPaidOrdersBySalesAccount(orders, queryOneFn)) {
    const primary = group[0];
    const d = parseOrderDate(primary?.paid_at || primary?.updated_at || primary?.created_at);
    if (!d) continue;
    const p = partsFromDate(d, tz);
    const dayKey = `${p.year}-${p.month}-${p.day}`;
    if (!buckets.has(dayKey)) buckets.set(dayKey, { date: dayKey, orders: 0, total: 0, tax: 0, discounts: 0 });
    const entry = buckets.get(dayKey);
    entry.orders += 1;
    entry.total += group.reduce((sum, row) => sum + Number(row.total || 0), 0);
    entry.tax += group.reduce((sum, row) => sum + Number(row.tax || 0), 0);
    entry.discounts += group.reduce((sum, row) => sum + Number(row.discount || 0), 0);
  }
  return [...buckets.values()].sort((a, b) => b.date.localeCompare(a.date));
}

function summarizeSalesAccountsByMonth(orders = [], queryOneFn = queryOne) {
  const tz = resolveRegionalTimezone(queryOneFn);
  const buckets = new Map();
  for (const group of groupPaidOrdersBySalesAccount(orders, queryOneFn)) {
    const primary = group[0];
    const d = parseOrderDate(primary?.paid_at || primary?.updated_at || primary?.created_at);
    if (!d) continue;
    const p = partsFromDate(d, tz);
    const monthKey = `${p.year}-${p.month}`;
    if (!buckets.has(monthKey)) buckets.set(monthKey, { month: monthKey, orders: 0, total: 0, tax: 0, discounts: 0 });
    const entry = buckets.get(monthKey);
    entry.orders += 1;
    entry.total += group.reduce((sum, row) => sum + Number(row.total || 0), 0);
    entry.tax += group.reduce((sum, row) => sum + Number(row.tax || 0), 0);
    entry.discounts += group.reduce((sum, row) => sum + Number(row.discount || 0), 0);
  }
  return [...buckets.values()].sort((a, b) => b.month.localeCompare(a.month));
}

/** Ranking de productos con order_count = cuentas de venta distintas (no comandas). */
function queryProductSalesRanking(dateWhereSql = '1=1', params = [], queryAllFn = queryAll, queryOneFn = queryOne) {
  const clause = String(dateWhereSql || '').trim() || '1=1';
  const qtyRows = queryAllFn(
    `SELECT
      oi.product_id,
      oi.product_name,
      COALESCE(SUM(oi.quantity), 0) AS total_sold,
      COALESCE(SUM(oi.subtotal), 0) AS total_revenue
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE ${PAID_SALES_JOIN_WHERE}
       AND (${clause})
     GROUP BY oi.product_id, oi.product_name
     ORDER BY total_sold DESC`,
    params,
  );
  const accountRows = queryAllFn(
    `SELECT DISTINCT
      oi.product_id,
      oi.product_name,
      o.id,
      o.type,
      o.table_number,
      o.cash_register_id,
      o.customer_id,
      ${paidAtSql('o')} AS paid_at,
      o.updated_at,
      o.created_at
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE ${PAID_SALES_JOIN_WHERE}
       AND (${clause})`,
    params,
  );
  const accountCounts = new Map();
  const ordersByProduct = new Map();
  for (const row of accountRows || []) {
    const productKey = String(row.product_id || row.product_name || '').trim() || row.product_name;
    if (!ordersByProduct.has(productKey)) ordersByProduct.set(productKey, new Map());
    ordersByProduct.get(productKey).set(String(row.id), row);
  }
  for (const [productKey, orderMap] of ordersByProduct.entries()) {
    accountCounts.set(productKey, countSalesAccounts([...orderMap.values()], queryOneFn));
  }
  return (qtyRows || []).map((row) => ({
    product_id: row.product_id,
    product_name: row.product_name,
    total_sold: Number(row.total_sold) || 0,
    total_revenue: Number(row.total_revenue) || 0,
    order_count: accountCounts.get(String(row.product_id || row.product_name || '').trim() || row.product_name) || 0,
  }));
}

module.exports = {
  PAID_SALES_BASE_WHERE,
  PAID_SALES_JOIN_WHERE,
  get SALES_ACCOUNT_ORDER_SELECT() {
    return salesAccountOrderSelectSql();
  },
  get SALES_EVENT_AT_SQL() {
    return paidAtSql('');
  },
  paidAtSql,
  salesAccountOrderSelectSql,
  salesAccountKey,
  groupPaidOrdersBySalesAccount,
  countSalesAccounts,
  queryPaidSalesOrders,
  countSalesAccountsWhere,
  summarizeSalesAccounts,
  buildOrderAccountKeyMap,
  countSalesAccountsByDay,
  sumSalesAccountsByHour,
  summarizePaymentMethodsByAccount,
  getPaidSalesEventSql,
  metricsFromPaidOrdersWhere,
  summarizeSalesAccountsByDay,
  summarizeSalesAccountsByMonth,
  queryProductSalesRanking,
};
