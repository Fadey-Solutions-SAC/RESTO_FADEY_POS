/**
 * Cálculos de asistencia RR. HH. (backend). Jornadas que cruzan medianoche incluidas.
 */

function pad2(n) {
  return String(n).padStart(2, '0');
}

function parseHmToMinutes(value) {
  const raw = String(value || '00:00').trim();
  const [h, m] = raw.split(':').map((x) => Number(x));
  const hours = Number.isFinite(h) ? h : 0;
  const mins = Number.isFinite(m) ? m : 0;
  return (hours * 60 + mins + 1440) % 1440;
}

function minutesToHm(total) {
  const n = Math.max(0, Math.round(Number(total) || 0));
  const h = Math.floor(n / 60);
  const m = n % 60;
  return `${h}h ${pad2(m)}m`;
}

function isOvernightSchedule(startTime, endTime) {
  return parseHmToMinutes(endTime) <= parseHmToMinutes(startTime);
}

function parseSqlDateTime(value) {
  const s = String(value || '').trim().replace('T', ' ');
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  return {
    y: Number(m[1]),
    mo: Number(m[2]),
    d: Number(m[3]),
    h: Number(m[4] || 0),
    mi: Number(m[5] || 0),
    s: Number(m[6] || 0),
  };
}

function formatDateParts(y, mo, d) {
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}

function addDays(y, mo, d, delta) {
  const dt = new Date(y, mo - 1, d + delta);
  return { y: dt.getFullYear(), mo: dt.getMonth() + 1, d: dt.getDate() };
}

function clockMinutesFromSql(value) {
  const p = parseSqlDateTime(value);
  if (!p) return 0;
  return p.h * 60 + p.mi;
}

function workDateForCheckIn(checkInSql, startTime, endTime) {
  const p = parseSqlDateTime(checkInSql);
  if (!p) return String(checkInSql || '').slice(0, 10);
  if (isOvernightSchedule(startTime, endTime) && clockMinutesFromSql(checkInSql) < parseHmToMinutes(endTime)) {
    const prev = addDays(p.y, p.mo, p.d, -1);
    return formatDateParts(prev.y, prev.mo, prev.d);
  }
  return formatDateParts(p.y, p.mo, p.d);
}

function diffMsSql(fromSql, toSql) {
  const a = parseSqlDateTime(fromSql);
  const b = parseSqlDateTime(toSql);
  if (!a || !b) return 0;
  const da = Date.UTC(a.y, a.mo - 1, a.d, a.h, a.mi, a.s);
  const db = Date.UTC(b.y, b.mo - 1, b.d, b.h, b.mi, b.s);
  return db - da;
}

function diffMinutesSql(fromSql, toSql) {
  return Math.max(0, Math.round(diffMsSql(fromSql, toSql) / 60000));
}

function diffSecondsSql(fromSql, toSql) {
  return Math.round(diffMsSql(fromSql, toSql) / 1000);
}

/**
 * Tardanza respecto a hora de inicio. Si llega dentro de tolerancia → late_minutes puede ser >0
 * pero el estado es on_time.
 */
function computeLateMinutes(checkInSql, startTime, overnight) {
  const start = parseHmToMinutes(startTime);
  let check = clockMinutesFromSql(checkInSql);
  if (overnight && check < start) check += 1440;
  const startAdj = overnight ? start : start;
  return Math.max(0, check - startAdj);
}

function computeEarlyLeaveMinutes(checkOutSql, endTime, overnight) {
  const end = parseHmToMinutes(endTime);
  const out = clockMinutesFromSql(checkOutSql);
  if (overnight) {
    if (out <= end) return Math.max(0, end - out);
    return Math.max(0, (end + 1440) - out);
  }
  return Math.max(0, end - out);
}

function utcNaiveSqlToZonedSql(sql, timeZone = 'America/Lima') {
  const p = parseSqlDateTime(sql);
  if (!p) return String(sql || '');
  try {
    const { formatLimaSqlDateTime } = require('../utils/appDateTime');
    const asUtc = new Date(Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s));
    return formatLimaSqlDateTime(asUtc, timeZone || 'America/Lima');
  } catch (_) {
    return String(sql || '');
  }
}

/**
 * Si salida < ingreso (p. ej. ingreso guardado en UTC), intenta normalizar el par.
 * @returns {{ checkInSql: string, checkOutSql: string, rawMinutes: number, checkInFixed: boolean }}
 */
function resolveAttendanceInterval(checkInSql, checkOutSql, timeZone = 'America/Lima') {
  let inSql = String(checkInSql || '');
  const outSql = String(checkOutSql || '');
  let raw = diffMinutesSql(inSql, outSql);
  let checkInFixed = false;
  if (raw <= 0 && inSql && outSql && diffMsSql(inSql, outSql) < 0) {
    const converted = utcNaiveSqlToZonedSql(inSql, timeZone);
    const raw2 = diffMinutesSql(converted, outSql);
    if (raw2 > 0) {
      inSql = converted;
      raw = raw2;
      checkInFixed = true;
    }
  }
  return { checkInSql: inSql, checkOutSql: outSql, rawMinutes: raw, checkInFixed };
}

function computeWorkedAndOvertime({
  checkInSql,
  checkOutSql,
  breakMinutes = 0,
  maxHours = 8,
  overtimeAfterMinutes = null,
  timeZone = 'America/Lima',
}) {
  const resolved = resolveAttendanceInterval(checkInSql, checkOutSql, timeZone);
  const raw = resolved.rawMinutes;
  const brkConfigured = Math.max(0, Number(breakMinutes) || 0);
  // No restar refrigerio completo en turnos más cortos que el break (evita 0h 00m).
  const brk = raw > brkConfigured ? brkConfigured : 0;
  const worked = Math.max(0, raw - brk);
  const cap = overtimeAfterMinutes != null && Number.isFinite(Number(overtimeAfterMinutes))
    ? Number(overtimeAfterMinutes)
    : Math.round(Number(maxHours || 8) * 60);
  const overtime = Math.max(0, worked - cap);
  const normal = Math.max(0, worked - overtime);
  const missing = Math.max(0, cap - worked);
  return {
    raw_minutes: raw,
    worked_minutes: worked,
    normal_minutes: normal,
    overtime_minutes: overtime,
    missing_minutes: missing,
    break_minutes: brk,
    check_in_at: resolved.checkInSql,
    check_in_fixed: resolved.checkInFixed,
  };
}

function attendanceStatus({ lateMinutes, toleranceMinutes, justified = false }) {
  const late = Math.max(0, Number(lateMinutes) || 0);
  const tol = Math.max(0, Number(toleranceMinutes) || 0);
  if (justified && late > tol) return 'late_justified';
  if (late > tol) return 'late';
  return 'on_time';
}

function jsNowSql(date = new Date(), timeZone = 'America/Lima') {
  try {
    const { formatLimaSqlDateTime } = require('../utils/appDateTime');
    return formatLimaSqlDateTime(date, timeZone || 'America/Lima');
  } catch (_) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
  }
}

function jsTodayDate(date = new Date(), timeZone = 'America/Lima') {
  return String(jsNowSql(date, timeZone) || '').slice(0, 10);
}

function weekdayMonday0(dateSql) {
  const p = parseSqlDateTime(`${dateSql} 12:00:00`);
  if (!p) return 0;
  const dt = new Date(p.y, p.mo - 1, p.d);
  return (dt.getDay() + 6) % 7;
}

module.exports = {
  pad2,
  parseHmToMinutes,
  minutesToHm,
  isOvernightSchedule,
  parseSqlDateTime,
  clockMinutesFromSql,
  workDateForCheckIn,
  diffMsSql,
  diffMinutesSql,
  diffSecondsSql,
  computeLateMinutes,
  computeEarlyLeaveMinutes,
  computeWorkedAndOvertime,
  attendanceStatus,
  utcNaiveSqlToZonedSql,
  resolveAttendanceInterval,
  jsNowSql,
  jsTodayDate,
  weekdayMonday0,
};
