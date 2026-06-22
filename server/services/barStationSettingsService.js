const { queryOne, runSql } = require('../database');

const SETTINGS_KEY = 'bar_station_settings';
const BAR_AUTO_DISMISS_MINUTES = 30;

const DEFAULT = Object.freeze({
  autoDismissPendingAfter30Min: false,
});

function normalizeSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const flag = src.autoDismissPendingAfter30Min;
  const on =
    flag === true
    || flag === 1
    || flag === '1'
    || flag === 'true';
  return { autoDismissPendingAfter30Min: on };
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
  const next = normalizeSettings({ ...current, ...(input && typeof input === 'object' ? input : {}) });
  runSql(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [SETTINGS_KEY, JSON.stringify(next)],
  );
  return next;
}

module.exports = {
  SETTINGS_KEY,
  BAR_AUTO_DISMISS_MINUTES,
  readBarStationSettings,
  saveBarStationSettings,
};
