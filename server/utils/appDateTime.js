/**
 * Fechas/horas en zona del restaurante (por defecto America/Lima).
 * SQLite en la nube usa UTC; datetime('now','localtime') sigue siendo UTC en Render.
 */
const DEFAULT_TIMEZONE = 'America/Lima';
const DEFAULT_UTC_OFFSET = '-05:00';

function partsFromDate(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const map = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour,
    minute: map.minute,
    second: map.second,
  };
}

function resolveRegionalTimezone(queryOneFn) {
  try {
    if (typeof queryOneFn === 'function') {
      const regionalRow = queryOneFn("SELECT value FROM app_settings WHERE key = 'regional' LIMIT 1");
      if (regionalRow?.value) {
        const parsed = JSON.parse(regionalRow.value);
        const tz = String(parsed?.timezone || '').trim();
        if (tz) return tz;
      }
      const settingsRow = queryOneFn("SELECT value FROM app_settings WHERE key = 'settings' LIMIT 1");
      if (settingsRow?.value) {
        const parsed = JSON.parse(settingsRow.value);
        const tz = String(parsed?.regional?.timezone || '').trim();
        if (tz) return tz;
      }
    }
  } catch (_) {
    /* noop */
  }
  return DEFAULT_TIMEZONE;
}

/** `YYYY-MM-DD HH:MM:SS` en zona regional (p. ej. Lima). */
function formatLimaSqlDateTime(date = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const p = partsFromDate(date, timeZone);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

function nowLimaSql(queryOneFn) {
  const tz = resolveRegionalTimezone(queryOneFn);
  return formatLimaSqlDateTime(new Date(), tz);
}

function utcOffsetForTimezone(timeZone) {
  if (timeZone === 'America/Lima') return DEFAULT_UTC_OFFSET;
  try {
    const d = new Date();
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
    });
    const part = fmt.formatToParts(d).find((p) => p.type === 'timeZoneName')?.value || '';
    const m = part.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
    if (m) {
      const sign = m[1].startsWith('-') || m[1].startsWith('+') ? m[1][0] : '+';
      const hours = String(Math.abs(Number(m[1]))).padStart(2, '0');
      const mins = m[2] || '00';
      return `${sign}${hours}:${mins}`;
    }
  } catch (_) {
    /* noop */
  }
  return DEFAULT_UTC_OFFSET;
}

function getBusinessTodayDateKey(queryOneFn) {
  const tz = resolveRegionalTimezone(queryOneFn);
  const p = partsFromDate(new Date(), tz);
  return `${p.year}-${p.month}-${p.day}`;
}

function getBusinessMonthKey(queryOneFn) {
  const tz = resolveRegionalTimezone(queryOneFn);
  const p = partsFromDate(new Date(), tz);
  return `${p.year}-${p.month}`;
}

/** Convierte timestamp UTC naive (Render) a hora del restaurante en SQL. */
function sqlBusinessTimestamp(columnExpr, queryOneFn) {
  const tz = resolveRegionalTimezone(queryOneFn);
  const offset = utcOffsetForTimezone(tz);
  return `datetime(${columnExpr}, '${offset}')`;
}

function sqlBusinessNow(queryOneFn) {
  return `'${nowLimaSql(queryOneFn)}'`;
}

module.exports = {
  DEFAULT_TIMEZONE,
  DEFAULT_UTC_OFFSET,
  resolveRegionalTimezone,
  formatLimaSqlDateTime,
  nowLimaSql,
  utcOffsetForTimezone,
  getBusinessTodayDateKey,
  getBusinessMonthKey,
  sqlBusinessTimestamp,
  sqlBusinessNow,
};
