const { tableNumbersMatch, normalizeTableNumber } = require('../utils/tableNumberMatch');

const TABLE_ORDER_MERGE_WINDOW_MINUTES = 40;

function isOrderMergeableState(order) {
  if (!order) return false;
  if (order.type !== 'dine_in') return false;
  if (String(order.payment_status || 'pending') === 'paid') return false;
  if (!['pending', 'preparing', 'ready'].includes(String(order.status || ''))) return false;
  return true;
}

function orderMatchesTableScope(order, { tableId, tableNumberRaw } = {}) {
  const tableKey = normalizeTableNumber(tableNumberRaw);
  const scopedId = String(tableId || '').trim();
  const rowTableId = String(order?.table_id || '').trim();
  if (scopedId && rowTableId) return rowTableId === scopedId;
  if (scopedId && !rowTableId && tableKey) return tableNumbersMatch(order?.table_number, tableKey);
  if (tableKey) return tableNumbersMatch(order?.table_number, tableKey);
  return false;
}

function isWithinMergeWindowTx(tx, order) {
  const releaseAt = String(order.kitchen_release_at || '').trim();
  if (releaseAt) {
    const held = tx.queryOne(
      "SELECT CASE WHEN datetime(?) > datetime('now', 'localtime') THEN 1 ELSE 0 END AS held",
      [releaseAt],
    );
    if (Number(held?.held || 0) === 1) return false;
  }
  const anchor = String(order.kitchen_last_send_at || order.updated_at || order.created_at || '').trim();
  if (!anchor) return false;
  const within = tx.queryOne(
    `SELECT CASE WHEN datetime(?) >= datetime('now', '-${TABLE_ORDER_MERGE_WINDOW_MINUTES} minutes', 'localtime') THEN 1 ELSE 0 END AS ok`,
    [anchor],
  );
  return Number(within?.ok || 0) === 1;
}

/** Última comanda activa de la mesa enviada hace menos de 40 minutos. */
function findMergeableTableOrderTx(tx, tableNumberRaw, { tableId } = {}) {
  const tableKey = normalizeTableNumber(tableNumberRaw);
  if (!tableKey && !String(tableId || '').trim()) return null;

  const candidates = tx.queryAll(`
    SELECT *
    FROM orders
    WHERE type = 'dine_in'
      AND IFNULL(TRIM(payment_status), 'pending') != 'paid'
      AND status IN ('pending', 'preparing', 'ready')
    ORDER BY datetime(COALESCE(kitchen_last_send_at, updated_at, created_at)) DESC
  `);

  for (const row of candidates) {
    if (!orderMatchesTableScope(row, { tableId, tableNumberRaw: tableKey })) continue;
    if (!isWithinMergeWindowTx(tx, row)) continue;
    return row;
  }
  return null;
}

function resolveExplicitMergeTargetTx(tx, targetOrderId, { tableId, tableNumberRaw } = {}) {
  const id = String(targetOrderId || '').trim();
  if (!id) return null;
  const order = tx.queryOne('SELECT * FROM orders WHERE id = ?', [id]);
  if (!order) return null;
  if (!isOrderMergeableState(order)) return null;
  if (!orderMatchesTableScope(order, { tableId, tableNumberRaw })) return null;
  if (!isWithinMergeWindowTx(tx, order)) return null;
  return order;
}

module.exports = {
  TABLE_ORDER_MERGE_WINDOW_MINUTES,
  findMergeableTableOrderTx,
  resolveExplicitMergeTargetTx,
  orderMatchesTableScope,
  isOrderMergeableState,
};
