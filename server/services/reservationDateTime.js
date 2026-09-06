/**
 * Fecha/hora de reserva en hora de negocio (America/Lima).
 * No usar Date(y,m,d,h,mi) del servidor: en Render eso es UTC y adelanta T−30 / avisos.
 */
const { DEFAULT_UTC_OFFSET } = require('../utils/appDateTime');

function normalizeReservationTime(timeStr) {
  const raw = String(timeStr || '').trim();
  const slice = raw.slice(0, 5);
  const m = slice.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return '';
  return `${String(Number(m[1])).padStart(2, '0')}:${m[2]}`;
}

/** Interpreta date+time de reserva como instante absoluto (pared Lima). */
function parseReservationLocalDateTime(dateStr, timeStr) {
  const date = String(dateStr || '').trim().slice(0, 10);
  const time = normalizeReservationTime(timeStr);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const d = new Date(`${date}T${time}:00${DEFAULT_UTC_OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatSqliteLocalDatetime(date) {
  if (!date || !(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  // Mostrar componentes en Lima, no en TZ del proceso.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const map = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  let hour = map.hour || '00';
  if (hour === '24') hour = '00';
  return `${map.year}-${map.month}-${map.day} ${hour}:${map.minute}:${map.second || '00'}`;
}

function computeMinutesBeforeReservation(reservationDate, reservationTime, minutesBefore) {
  const at = parseReservationLocalDateTime(reservationDate, reservationTime);
  if (!at) return null;
  const release = new Date(at.getTime() - Math.max(0, Number(minutesBefore) || 0) * 60_000);
  return formatSqliteLocalDatetime(release);
}

/** HH:MM normalizado en SQL (acepta 9:05, 09:05, 09:05:00). */
function reservationTimeSqlExpr(alias = 'r') {
  const t = `substr(trim(COALESCE(${alias}.time, '')), 1, 5)`;
  return `CASE WHEN length(${t}) = 4 THEN '0' || ${t} ELSE ${t} END`;
}

function reservationLocalSqlExpr(alias = 'r') {
  return `datetime(${alias}.date || ' ' || (${reservationTimeSqlExpr(alias)}))`;
}

/** Momento T−N de liberación a cocina (misma pared horaria Lima que las reservas). */
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
