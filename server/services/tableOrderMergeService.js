const { tableNumbersMatch } = require('../utils/tableNumberMatch');

const TABLE_ORDER_MERGE_WINDOW_MINUTES = 10;

/** Última comanda activa de la mesa enviada hace menos de 10 minutos. */
function findMergeableTableOrderTx(tx, tableNumberRaw) {
  const tableKey = String(tableNumberRaw ?? '').trim();
  if (!tableKey) return null;

  const candidates = tx.queryAll(`
    SELECT *
    FROM orders
    WHERE type = 'dine_in'
      AND IFNULL(TRIM(payment_status), 'pending') != 'paid'
      AND status IN ('pending', 'preparing', 'ready')
    ORDER BY datetime(COALESCE(kitchen_last_send_at, updated_at, created_at)) DESC
  `);

  for (const row of candidates) {
    if (!tableNumbersMatch(row.table_number, tableKey)) continue;
    const releaseAt = String(row.kitchen_release_at || '').trim();
    if (releaseAt) {
      const held = tx.queryOne(
        "SELECT CASE WHEN datetime(?) > datetime('now', 'localtime') THEN 1 ELSE 0 END AS held",
        [releaseAt],
      );
      if (Number(held?.held || 0) === 1) continue;
    }
    const anchor = String(row.kitchen_last_send_at || row.updated_at || row.created_at || '').trim();
    if (!anchor) continue;
    const within = tx.queryOne(
      `SELECT CASE WHEN datetime(?) >= datetime('now', '-${TABLE_ORDER_MERGE_WINDOW_MINUTES} minutes', 'localtime') THEN 1 ELSE 0 END AS ok`,
      [anchor],
    );
    if (Number(within?.ok || 0) === 1) return row;
  }
  return null;
}

module.exports = {
  TABLE_ORDER_MERGE_WINDOW_MINUTES,
  findMergeableTableOrderTx,
};
