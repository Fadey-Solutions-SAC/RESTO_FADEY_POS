const { queryOne, runSql } = require('../database');

const SETTINGS_KEY = 'bar_station_settings';
const BAR_AUTO_DISMISS_MINUTES_DEFAULT = 30;
const BAR_AUTO_DISMISS_MINUTES_MIN = 5;
const BAR_AUTO_DISMISS_MINUTES_MAX = 180;

const DEFAULT = Object.freeze({
  autoDismissPendingAfter30Min: false,
  autoDismissMinutes: BAR_AUTO_DISMISS_MINUTES_DEFAULT,
});

function normalizeAutoDismissMinutes(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return BAR_AUTO_DISMISS_MINUTES_DEFAULT;
  return Math.min(BAR_AUTO_DISMISS_MINUTES_MAX, Math.max(BAR_AUTO_DISMISS_MINUTES_MIN, parsed));
}

function normalizeSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const flag = src.autoDismissPendingAfter30Min;
  const on =
    flag === true
    || flag === 1
    || flag === '1'
    || flag === 'true';
  // Conservar claves extra del JSON guardado (compatibilidad hacia adelante).
  return {
    ...src,
    autoDismissPendingAfter30Min: on,
    autoDismissMinutes: normalizeAutoDismissMinutes(src.autoDismissMinutes),
  };
}

function readBarStationSettings() {
  const row = queryOne('SELECT value FROM app_settings WHERE key = ?', [SETTINGS_KEY]);
  if (!row?.value) return { ...DEFAULT };
  try {
    return normalizeSettings(JSON.parse(row.value));
  } catch (_) {
    return { ...DEFAULT };
  }
}

function saveBarStationSettings(input) {
  const current = readBarStationSettings();
  const patch = input && typeof input === 'object' ? input : {};
  // Solo actualiza campos enviados; el resto se mantiene (no borra preferencias del local).
  const merged = { ...current, ...patch };
  const next = normalizeSettings(merged);
  runSql(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [SETTINGS_KEY, JSON.stringify(next)],
  );
  return next;
}

module.exports = {
  SETTINGS_KEY,
  BAR_AUTO_DISMISS_MINUTES_DEFAULT,
  BAR_AUTO_DISMISS_MINUTES_MIN,
  BAR_AUTO_DISMISS_MINUTES_MAX,
  normalizeAutoDismissMinutes,
  readBarStationSettings,
  saveBarStationSettings,
};
