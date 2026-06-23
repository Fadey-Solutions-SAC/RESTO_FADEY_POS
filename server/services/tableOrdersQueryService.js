const { queryAll } = require('../database');
const { normalizeTableNumber, tableNumbersMatch } = require('../utils/tableNumberMatch');

const ACTIVE_ORDER_STATUS_SQL =
  "status IN ('pending','preparing','ready') AND IFNULL(TRIM(payment_status), 'pending') != 'paid'";

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

module.exports = {
  ACTIVE_ORDER_STATUS_SQL,
  orderBelongsToTable,
  loadActiveTableOrders,
};
