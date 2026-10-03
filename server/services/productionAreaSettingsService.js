/**
 * Ajustes por área de producción (cocina, bar y áreas dinámicas), guardados en el servidor:
 * retiro automático de comandas sin atender y notificación sonora (activa / volumen).
 */
const { queryOne, runSql } = require('../database');

const SETTINGS_KEY = 'production_area_settings';
const LEGACY_BAR_KEY = 'bar_station_settings';

const AUTO_DISMISS_MINUTES_DEFAULT = 30;
const AUTO_DISMISS_MINUTES_MIN = 5;
const AUTO_DISMISS_MINUTES_MAX = 180;

const DEFAULT_AREA_SETTINGS = Object.freeze({
  autoDismissEnabled: false,
  autoDismissMinutes: AUTO_DISMISS_MINUTES_DEFAULT,
  notifyEnabled: true,
  notifyVolume: 100,
});

function toBool(v, fallback) {
  if (v === true || v === 1 || v === '1' || v === 'true') return true;
  if (v === false || v === 0 || v === '0' || v === 'false') return false;
  return fallback;
}

function normalizeAutoDismissMinutes(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return AUTO_DISMISS_MINUTES_DEFAULT;
  return Math.min(AUTO_DISMISS_MINUTES_MAX, Math.max(AUTO_DISMISS_MINUTES_MIN, parsed));
}

function normalizeVolume(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_AREA_SETTINGS.notifyVolume;
  return Math.min(100, Math.max(10, parsed));
}

function normalizeAreaSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    autoDismissEnabled: toBool(src.autoDismissEnabled, DEFAULT_AREA_SETTINGS.autoDismissEnabled),
    autoDismissMinutes: normalizeAutoDismissMinutes(src.autoDismissMinutes),
    notifyEnabled: toBool(src.notifyEnabled, DEFAULT_AREA_SETTINGS.notifyEnabled),
    notifyVolume: normalizeVolume(src.notifyVolume),
  };
}

function normalizeAreaId(areaId) {
  return String(areaId || '').trim() || 'cocina';
}

function readJsonSetting(key) {
  const row = queryOne('SELECT value FROM app_settings WHERE key = ?', [key]);
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value);
  } catch (_) {
    return null;
  }
}

function writeJsonSetting(key, value) {
  runSql(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [key, JSON.stringify(value)],
  );
}

function readAllRaw() {
  const stored = readJsonSetting(SETTINGS_KEY);
  const map = stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...stored } : {};
  if (!map.bar) {
    const legacy = readJsonSetting(LEGACY_BAR_KEY);
    if (legacy && typeof legacy === 'object') {
      map.bar = {
        autoDismissEnabled: toBool(legacy.autoDismissPendingAfter30Min, false),
        autoDismissMinutes: legacy.autoDismissMinutes,
      };
    }
  }
  return map;
}

function readAreaSettings(areaId) {
  const map = readAllRaw();
  return normalizeAreaSettings(map[normalizeAreaId(areaId)]);
}

function readAllAreaSettings() {
  const map = readAllRaw();
  const out = {};
  for (const [id, raw] of Object.entries(map)) out[id] = normalizeAreaSettings(raw);
  return out;
}

function saveAreaSettings(areaId, patch) {
  const id = normalizeAreaId(areaId);
  const map = readAllRaw();
  const current = normalizeAreaSettings(map[id]);
  const input = patch && typeof patch === 'object' ? patch : {};
  const allowed = {};
  for (const key of Object.keys(DEFAULT_AREA_SETTINGS)) {
    if (Object.prototype.hasOwnProperty.call(input, key)) allowed[key] = input[key];
  }
  const next = normalizeAreaSettings({ ...current, ...allowed });
  map[id] = next;
  writeJsonSetting(SETTINGS_KEY, map);
  return next;
}

module.exports = {
  SETTINGS_KEY,
  AUTO_DISMISS_MINUTES_DEFAULT,
  AUTO_DISMISS_MINUTES_MIN,
  AUTO_DISMISS_MINUTES_MAX,
  DEFAULT_AREA_SETTINGS,
  normalizeAreaSettings,
  normalizeAutoDismissMinutes,
  readAreaSettings,
  readAllAreaSettings,
  saveAreaSettings,
};
