/**
 * Fecha operativa del turno de caja para filtros e informes.
 * Si el cierre ocurre en un día distinto al de la apertura (tras medianoche),
 * se usa la fecha de apertura. La hora real de cierre (closed_at) no cambia.
 */
const { resolveRegionalTimezone, sqlBusinessTimestamp, partsFromDate } = require('./appDateTime');

function parseSqliteTimestamp(ts) {
  const s = String(ts || '').trim();
  if (!s) return null;
  if (s.includes('T')) return new Date(s);
  const asUtc = new Date(`${s.replace(' ', 'T')}Z`);
  if (!Number.isNaN(asUtc.getTime())) return asUtc;
  const fallback = new Date(s);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function dateKeyFromTimestamp(ts, queryOneFn) {
  const d = parseSqliteTimestamp(ts);
  if (!d) return '';
  const tz = resolveRegionalTimezone(queryOneFn);
  const p = partsFromDate(d, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

function computeRegisterBusinessDateKey(openedAt, closedAt, queryOneFn) {
  if (!openedAt) return closedAt ? dateKeyFromTimestamp(closedAt, queryOneFn) : '';
  if (!closedAt) return dateKeyFromTimestamp(openedAt, queryOneFn);
  const openKey = dateKeyFromTimestamp(openedAt, queryOneFn);
  const closeKey = dateKeyFromTimestamp(closedAt, queryOneFn);
  if (!openKey || !closeKey) return closeKey || openKey;
  if (closeKey > openKey) return openKey;
  return closeKey;
}

/** Expresión SQL: YYYY-MM-DD operativo del turno (zona del restaurante). */
function sqlRegisterBusinessDateExpr(openedCol, closedCol, queryOneFn) {
  const openedL = sqlBusinessTimestamp(openedCol, queryOneFn);
  const closedL = sqlBusinessTimestamp(closedCol, queryOneFn);
  return `CASE
    WHEN ${closedCol} IS NULL THEN DATE(${openedL})
    WHEN DATE(${closedL}) > DATE(${openedL}) THEN DATE(${openedL})
    ELSE DATE(${closedL})
  END`;
}

/** Columna persistida o cálculo en caliente para registros antiguos. */
function sqlCoalesceRegisterBusinessDate(columnExpr, openedCol, closedCol, queryOneFn) {
  const computed = sqlRegisterBusinessDateExpr(openedCol, closedCol, queryOneFn);
  return `COALESCE(NULLIF(trim(${columnExpr}), ''), ${computed})`;
}

function backfillCashRegisterBusinessDates(queryOneFn, runSqlFn) {
  const computed = sqlRegisterBusinessDateExpr('opened_at', 'closed_at', queryOneFn);
  runSqlFn(
    `UPDATE cash_registers
     SET business_date = ${computed}
     WHERE closed_at IS NOT NULL`
  );
}

module.exports = {
  computeRegisterBusinessDateKey,
  dateKeyFromTimestamp,
  sqlRegisterBusinessDateExpr,
  sqlCoalesceRegisterBusinessDate,
  backfillCashRegisterBusinessDates,
};
