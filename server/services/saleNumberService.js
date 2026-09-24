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
  try {
    require('../database').ensureOrdersReportColumns();
  } catch (_) {
    const cols = queryAll('PRAGMA table_info(orders)') || [];
    if (!cols.some((c) => c.name === 'sale_number' || c.NAME === 'sale_number')) {
      runSql('ALTER TABLE orders ADD COLUMN sale_number INTEGER');
    }
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
  // Un solo N.º de venta para todo el cobro (fuerza unificar si alguna comanda ya tenía otro).
  for (const id of ids) {
    tx.run('UPDATE orders SET sale_number = ? WHERE id = ?', [n, id]);
  }
  return n;
}

/**
 * Si varias comandas de la misma mesa se cobraron casi juntas con N.º distintos
 * (p. ej. sync offline por comanda), unifica al menor sale_number / comprobante.
 */
function unifyTableSaleNumbersTx(tx, orderIds, windowSeconds = 180) {
  const ids = [...new Set((orderIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return;
  const ph = ids.map(() => '?').join(',');
  const seeds = tx.queryAll(
    `SELECT id, table_number, table_id, cash_register_id, sale_number, paid_at, updated_at
     FROM orders WHERE id IN (${ph}) AND type = 'dine_in' AND payment_status = 'paid'`,
    ids,
  ) || [];
  const seenTables = new Set();
  for (const seed of seeds) {
    const table = String(seed.table_number || '').trim();
    if (!table || seenTables.has(table)) continue;
    seenTables.add(table);
    const paidRef = seed.paid_at || seed.updated_at;
    const sibs = tx.queryAll(
      `SELECT id, sale_number, sale_document_type, sale_document_number
       FROM orders
       WHERE type = 'dine_in'
         AND payment_status = 'paid'
         AND status != 'cancelled'
         AND IFNULL(payment_method, '') NOT IN ('cortesia', 'cuenta_cliente')
         AND TRIM(CAST(table_number AS TEXT)) = ?
         AND ABS(
           strftime('%s', COALESCE(paid_at, updated_at, created_at))
           - strftime('%s', COALESCE(?, updated_at, created_at))
         ) <= ?`,
      [table, paidRef, Number(windowSeconds) || 180],
    ) || [];
    if (sibs.length < 2) continue;
    const nums = sibs.map((s) => Number(s.sale_number || 0)).filter((n) => n > 0);
    if (!nums.length) continue;
    const keep = Math.min(...nums);
    const docNum = `001-${String(keep).padStart(8, '0')}`;
    for (const s of sibs) {
      tx.run(
        `UPDATE orders SET sale_number = ?,
          sale_document_number = CASE
            WHEN IFNULL(NULLIF(trim(sale_document_type), ''), 'nota_venta') = 'nota_venta' THEN ?
            ELSE COALESCE(NULLIF(trim(sale_document_number), ''), ?)
          END
         WHERE id = ?`,
        [keep, docNum, docNum, s.id],
      );
    }
  }
}

/**
 * Cobro de mesa completa: incluye todas las comandas pendientes de esa mesa.
 * (No aplica a cobro parcial por líneas.)
 */
function expandPendingTableOrderIdsTx(tx, orderIds) {
  const ids = [...new Set((orderIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return ids;
  const expanded = new Set(ids);
  const ph = ids.map(() => '?').join(',');
  const seeds = tx.queryAll(
    `SELECT id, table_number, table_id, type FROM orders WHERE id IN (${ph})`,
    ids,
  ) || [];
  for (const seed of seeds) {
    const type = String(seed.type || 'dine_in').toLowerCase();
    if (type === 'delivery' || type === 'pickup') continue;
    const table = String(seed.table_number || '').trim();
    const tid = String(seed.table_id || '').trim();
    if (!table && !tid) continue;
    const sibs = tx.queryAll(
      `SELECT id FROM orders
       WHERE IFNULL(type, 'dine_in') NOT IN ('delivery', 'pickup')
         AND status NOT IN ('cancelled', 'delivered')
         AND IFNULL(payment_status, 'pending') = 'pending'
         AND (
           (TRIM(CAST(table_number AS TEXT)) = ? AND ? != '')
           OR (IFNULL(table_id, '') = ? AND ? != '')
         )`,
      [table, table, tid, tid],
    ) || [];
    sibs.forEach((s) => expanded.add(String(s.id)));
  }
  return [...expanded];
}

function groupPaidAtMs(orders) {
  const times = (orders || []).map((o) => new Date(o.paid_at || o.updated_at || o.created_at || 0).getTime());
  const valid = times.filter((t) => Number.isFinite(t) && t > 0);
  return valid.length ? Math.min(...valid) : 0;
}

/**
 * Corrige cobros históricos partidos en varios sale_number (una fila por comanda).
 * Unifica al menor N.º y actualiza nota de venta 001-########.
 */
function unifyHistoricalMesaSaleNumbers() {
  ensureSaleNumberSchema();
  const { groupPaidOrdersBySalesAccount } = require('../utils/salesAccountGrouping');
  const orders = queryAll(`
    SELECT id, type, table_number, table_id, cash_register_id, sale_number,
           sale_document_type, sale_document_number, paid_at, updated_at, created_at, total
    FROM orders
    WHERE payment_status = 'paid'
      AND status != 'cancelled'
      AND IFNULL(payment_method, '') NOT IN ('cortesia', 'cuenta_cliente')
      AND IFNULL(type, 'dine_in') = 'dine_in'
      AND TRIM(CAST(IFNULL(table_number, '') AS TEXT)) != ''
  `) || [];
  if (!orders.length) return;
  const groups = groupPaidOrdersBySalesAccount(orders);
  withTransaction((tx) => {
    for (const group of groups) {
      if (!group || group.length < 2) continue;
      const nums = group.map((o) => Number(o.sale_number || 0)).filter((x) => x > 0);
      if (nums.length < 2) continue;
      const uniq = new Set(nums);
      if (uniq.size < 2) continue;
      const keep = Math.min(...nums);
      const docNum = `001-${String(keep).padStart(8, '0')}`;
      for (const o of group) {
        tx.run(
          `UPDATE orders SET sale_number = ?,
            sale_document_number = CASE
              WHEN IFNULL(NULLIF(trim(sale_document_type), ''), 'nota_venta') = 'nota_venta' THEN ?
              ELSE COALESCE(NULLIF(trim(sale_document_number), ''), ?)
            END
           WHERE id = ?`,
          [keep, docNum, docNum, o.id],
        );
      }
    }
  });
}

function backfillSaleNumbers() {
  ensureSaleNumberSchema();
  try {
    unifyHistoricalMesaSaleNumbers();
  } catch (err) {
    console.warn('[sale_number] unify mesa:', err?.message || err);
  }

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
          tx.run('UPDATE orders SET sale_number = ? WHERE id = ?', [shared, o.id]);
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
  expandPendingTableOrderIdsTx,
  unifyTableSaleNumbersTx,
  backfillSaleNumbers,
};
