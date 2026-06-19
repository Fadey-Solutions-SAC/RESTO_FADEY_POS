/**
 * Fecha/hora de reserva en hora local del servidor (alineada con datetime('now','localtime') en SQLite).
 */

function parseReservationLocalDateTime(dateStr, timeStr) {
  const date = String(dateStr || '').trim();
  const timeRaw = String(timeStr || '').trim();
  const time = timeRaw.slice(0, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time)) return null;
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

function reservationLocalSqlExpr(alias = 'r') {
  return `datetime(${alias}.date || ' ' || substr(${alias}.time, 1, 5))`;
}

module.exports = {
  parseReservationLocalDateTime,
  formatSqliteLocalDatetime,
  computeMinutesBeforeReservation,
  reservationLocalSqlExpr,
};
