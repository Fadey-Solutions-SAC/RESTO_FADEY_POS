const { queryAll } = require('../database');
const { normalizeTableNumber, tableNumbersMatch } = require('../utils/tableNumberMatch');

const ACTIVE_ORDER_STATUS_SQL =
  "status IN ('pending','preparing','ready') AND IFNULL(TRIM(payment_status), 'pending') != 'paid'";

function deriveTableStatus(table, orders) {
  const hasActiveOrders = Array.isArray(orders) && orders.length > 0;
  if (hasActiveOrders) return 'occupied';
  const dbStatus = String(table?.status || 'available').toLowerCase();
  if (dbStatus === 'reserved' || dbStatus === 'maintenance') return dbStatus;
  return 'available';
}

function orderBelongsToTable(order, table) {
  if (!order || !table) return false;
  const tableId = String(table.id || '').trim();
  const orderTableId = String(order.table_id || '').trim();
  if (tableId && orderTableId) return orderTableId === tableId;
  return tableNumbersMatch(order.table_number, table.number);
}

/** Pedidos activos de una mesa física (por table_id; fallback número de mesa). */
function loadActiveTableOrders(tableRef) {
  const table =
    tableRef && typeof tableRef === 'object'
      ? tableRef
      : { number: tableRef, id: '' };
  const key = normalizeTableNumber(table.number);
  if (!key && !String(table.id || '').trim()) return [];

  const orders = queryAll(
    `SELECT * FROM orders WHERE ${ACTIVE_ORDER_STATUS_SQL} ORDER BY created_at DESC`,
  );
  const matched = orders.filter((o) => orderBelongsToTable(o, table));
  matched.forEach((o) => {
    o.items = queryAll('SELECT * FROM order_items WHERE order_id = ?', [o.id]);
  });
  return matched;
}

/** Una sola consulta de pedidos activos + ítems; agrupa por mesa (evita N+1 en GET /tables). */
function loadAllActiveTableOrdersWithItems() {
  const orders = queryAll(
    `SELECT * FROM orders WHERE ${ACTIVE_ORDER_STATUS_SQL} ORDER BY created_at DESC`,
  );
  if (!orders.length) return [];

  const placeholders = orders.map(() => '?').join(',');
  const ids = orders.map((o) => o.id);
  const allItems = queryAll(
    `SELECT * FROM order_items WHERE order_id IN (${placeholders})`,
    ids,
  );
  const itemsByOrderId = new Map();
  for (const item of allItems) {
    if (!itemsByOrderId.has(item.order_id)) itemsByOrderId.set(item.order_id, []);
    itemsByOrderId.get(item.order_id).push(item);
  }
  orders.forEach((o) => {
    o.items = itemsByOrderId.get(o.id) || [];
  });
  return orders;
}

function attachActiveOrdersToTables(tables, activeOrders) {
  for (const t of tables) {
    const orders = activeOrders.filter((o) => orderBelongsToTable(o, t));
    t.orders = orders;
    t.order_total = orders.reduce((sum, o) => sum + (o.total || 0), 0);
    t.order_count = orders.length;
    t.status = deriveTableStatus(t, orders);
  }
}

module.exports = {
  ACTIVE_ORDER_STATUS_SQL,
  deriveTableStatus,
  orderBelongsToTable,
  loadActiveTableOrders,
  loadAllActiveTableOrdersWithItems,
  attachActiveOrdersToTables,
};
