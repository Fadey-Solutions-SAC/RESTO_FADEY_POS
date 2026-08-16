/**
 * Numeración interna de ventas (cuentas cobradas) desde el inicio del sistema.
 * No se reinicia al abrir/cerrar caja (eso solo afecta order_number de comandas).
 */
const { queryAll, queryOne, runSql, withTransaction } = require('../database');

function ensureSaleNumberSchema() {
  runSql(`
    CREATE TABLE IF NOT EXISTS sale_sequence (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      current_number INTEGER NOT NULL DEFAULT 0
    )
  `);
  runSql('INSERT OR IGNORE INTO sale_sequence (id, current_number) VALUES (1, 0)');
  const cols = queryAll('PRAGMA table_info(orders)') || [];
  if (!cols.some((c) => c.name === 'sale_number')) {
    runSql('ALTER TABLE orders ADD COLUMN sale_number INTEGER');
  }
}

function currentSaleCount() {
  ensureSaleNumberSchema();
  return Number(queryOne('SELECT current_number FROM sale_sequence WHERE id = 1')?.current_number || 0);
}

function bumpSaleNumberTx(tx) {
  tx.run('UPDATE sale_sequence SET current_number = current_number + 1 WHERE id = 1');
  return Number(tx.queryOne('SELECT current_number FROM sale_sequence WHERE id = 1')?.current_number || 0);
}

/** Asigna un N.º de venta a todas las comandas de un mismo cobro (cuenta de mesa). */
function assignSaleNumberToOrderIdsTx(tx, orderIds) {
  const ids = [...new Set((orderIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const rows = tx.queryAll(
    `SELECT id, sale_number FROM orders WHERE id IN (${placeholders})`,
    ids,
  ) || [];
  const existing = rows.map((r) => Number(r.sale_number || 0)).filter((n) => n > 0);
  const n = existing.length ? Math.min(...existing) : bumpSaleNumberTx(tx);
  for (const id of ids) {
    tx.run(
      'UPDATE orders SET sale_number = ? WHERE id = ? AND (sale_number IS NULL OR sale_number = 0)',
      [n, id],
    );
  }
  return n;
}

function groupPaidAtMs(orders) {
  const times = (orders || []).map((o) => new Date(o.paid_at || o.updated_at || o.created_at || 0).getTime());
  const valid = times.filter((t) => Number.isFinite(t) && t > 0);
  return valid.length ? Math.min(...valid) : 0;
}

function backfillSaleNumbers() {
  ensureSaleNumberSchema();
  const missing = queryOne(`
    SELECT COUNT(*) AS c FROM orders
    WHERE payment_status = 'paid'
      AND status != 'cancelled'
      AND IFNULL(payment_method, '') NOT IN ('cortesia', 'cuenta_cliente')
      AND (sale_number IS NULL OR sale_number = 0)
  `);
  if (!Number(missing?.c || 0)) {
    const maxRow = queryOne('SELECT MAX(sale_number) AS m FROM orders');
    const seq = currentSaleCount();
    const maxN = Number(maxRow?.m || 0);
    if (maxN > seq) runSql('UPDATE sale_sequence SET current_number = ? WHERE id = 1', [maxN]);
    return;
  }

  const { groupPaidOrdersBySalesAccount } = require('../utils/salesAccountGrouping');
  const orders = queryAll(`
    SELECT * FROM orders
    WHERE payment_status = 'paid'
      AND status != 'cancelled'
      AND IFNULL(payment_method, '') NOT IN ('cortesia', 'cuenta_cliente')
  `) || [];
  const groups = groupPaidOrdersBySalesAccount(orders).sort((a, b) => groupPaidAtMs(a) - groupPaidAtMs(b));

  let n = 0;
  withTransaction((tx) => {
    for (const group of groups) {
      const existing = group.map((o) => Number(o.sale_number || 0)).filter((x) => x > 0);
      if (existing.length) {
        const shared = Math.min(...existing);
        n = Math.max(n, ...existing);
        for (const o of group) {
          if (!Number(o.sale_number || 0)) {
            tx.run('UPDATE orders SET sale_number = ? WHERE id = ?', [shared, o.id]);
          }
        }
        continue;
      }
      n += 1;
      for (const o of group) {
        tx.run('UPDATE orders SET sale_number = ? WHERE id = ?', [n, o.id]);
      }
    }
    const seqNow = Number(tx.queryOne('SELECT current_number FROM sale_sequence WHERE id = 1')?.current_number || 0);
    if (n > seqNow) tx.run('UPDATE sale_sequence SET current_number = ? WHERE id = 1', [n]);
  });
}

module.exports = {
  ensureSaleNumberSchema,
  currentSaleCount,
  assignSaleNumberToOrderIdsTx,
  backfillSaleNumbers,
};
