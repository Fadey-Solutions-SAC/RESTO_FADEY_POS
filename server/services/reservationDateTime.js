/**
 * Fecha/hora de reserva en hora local del servidor (alineada con datetime('now','localtime') en SQLite).
 */

function normalizeReservationTime(timeStr) {
  const raw = String(timeStr || '').trim();
  const slice = raw.slice(0, 5);
  const m = slice.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return '';
  return `${String(Number(m[1])).padStart(2, '0')}:${m[2]}`;
}

function parseReservationLocalDateTime(dateStr, timeStr) {
  const date = String(dateStr || '').trim().slice(0, 10);
  const time = normalizeReservationTime(timeStr);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  if (!y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm)) return null;
  const dt = new Date(y, m - 1, d, hh, mm, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function formatSqliteLocalDatetime(date) {
  if (!date || !(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
}

function computeMinutesBeforeReservation(reservationDate, reservationTime, minutesBefore) {
  const at = parseReservationLocalDateTime(reservationDate, reservationTime);
  if (!at) return null;
  at.setMinutes(at.getMinutes() - Math.max(0, Number(minutesBefore) || 0));
  return formatSqliteLocalDatetime(at);
}

/** HH:MM normalizado en SQL (acepta 9:05, 09:05, 09:05:00). */
function reservationTimeSqlExpr(alias = 'r') {
  const t = `substr(trim(COALESCE(${alias}.time, '')), 1, 5)`;
  return `CASE WHEN length(${t}) = 4 THEN '0' || ${t} ELSE ${t} END`;
}

function reservationLocalSqlExpr(alias = 'r') {
  return `datetime(${alias}.date || ' ' || (${reservationTimeSqlExpr(alias)}))`;
}

/** Momento T−N de liberación a cocina (mismo reloj que localtime). */
function reservationKitchenReleaseSqlExpr(alias = 'r', minutesBefore = 30) {
  const mins = Math.max(0, Number(minutesBefore) || 0);
  return `datetime(${alias}.date || ' ' || (${reservationTimeSqlExpr(alias)}), '-${mins} minutes')`;
}

module.exports = {
  normalizeReservationTime,
  parseReservationLocalDateTime,
  formatSqliteLocalDatetime,
  computeMinutesBeforeReservation,
  reservationTimeSqlExpr,
  reservationLocalSqlExpr,
  reservationKitchenReleaseSqlExpr,
};
