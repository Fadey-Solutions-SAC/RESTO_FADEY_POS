/** Expresiones SQL compartidas para jornadas (Tiempo trabajado).
 * Los timestamps de jornada se guardan en hora del restaurante (p. ej. America/Lima).
 * Las duraciones deben restar contra «ahora» en la misma zona, no contra UTC de SQLite.
 */

function businessNowSqlLiteral() {
  try {
    const { queryOne } = require('../database');
    const { nowLimaSql } = require('../utils/appDateTime');
    const sql = String(nowLimaSql(queryOne) || '').trim();
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(sql)) {
      return `'${sql}'`;
    }
  } catch (_) {
    /* fallback */
  }
  try {
    const { formatLimaSqlDateTime } = require('../utils/appDateTime');
    return `'${formatLimaSqlDateTime(new Date())}'`;
  } catch (_) {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `'${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}'`;
  }
}

function rawWorkedMinutesExpr(alias = 's') {
  const nowLit = businessNowSqlLiteral();
  return `CASE
      WHEN ${alias}.logout_at IS NULL THEN MAX(0, CAST((julianday(${nowLit}) - julianday(${alias}.login_at)) * 24 * 60 AS INTEGER))
      ELSE COALESCE(${alias}.worked_minutes, MAX(0, CAST((julianday(${alias}.logout_at) - julianday(${alias}.login_at)) * 24 * 60 AS INTEGER)), 0)
    END`;
}

function effectiveWorkedMinutesExpr(alias = 's') {
  const raw = rawWorkedMinutesExpr(alias);
  const st = `COALESCE(NULLIF(trim(${alias}.attendance_status), ''), 'pending')`;
  const roleIsAdmin = `lower(coalesce(nullif(u.role, ''), nullif(${alias}.role, ''), '')) = 'admin'`;
  return `(CASE WHEN ${roleIsAdmin} THEN (${raw}) ELSE (CASE ${st}
    WHEN 'justificado' THEN 0
    WHEN 'ausente' THEN 0
    WHEN 'pending' THEN 0
    WHEN 'asistente' THEN (${raw})
    ELSE 0
  END) END)`;
}

/** Misma regla que effectiveWorkedMinutesExpr, en JS para filas agregadas. */
function effectiveWorkedMinutesFromValues({ rawMinutes, attendanceStatus, role }) {
  const raw = Math.max(0, Number(rawMinutes) || 0);
  if (String(role || '').toLowerCase() === 'admin') return raw;
  const st = String(attendanceStatus || 'pending').trim().toLowerCase();
  if (st === 'asistente') return raw;
  return 0;
}

function parseDateKey(input) {
  const value = String(input || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

function shiftLabelFromHour(hour) {
  const h = Number(hour);
  if (h >= 5 && h < 12) return 'mañana';
  if (h >= 12 && h < 18) return 'tarde';
  return 'noche';
}

/** login_at ya está en hora del restaurante: no aplicar 'localtime' de SQLite (en cloud es UTC). */
function shiftLabelFromLoginSql(alias = 's') {
  return `CASE
    WHEN CAST(strftime('%H', ${alias}.login_at) AS INTEGER) BETWEEN 5 AND 11 THEN 'mañana'
    WHEN CAST(strftime('%H', ${alias}.login_at) AS INTEGER) BETWEEN 12 AND 17 THEN 'tarde'
    ELSE 'noche'
  END`;
}

module.exports = {
  businessNowSqlLiteral,
  rawWorkedMinutesExpr,
  effectiveWorkedMinutesExpr,
  effectiveWorkedMinutesFromValues,
  parseDateKey,
  shiftLabelFromHour,
  shiftLabelFromLoginSql,
};
