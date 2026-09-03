/**
 * Evita que un guardado de tema / blob por defecto pise cajas y salones.
 * Recupera nombres desde el historial si el blob volvió a los valores de fábrica.
 */

const { queryAll, queryOne, runSql } = require('../database');

function parseJsonSafe(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function settingsFromState(state) {
  if (!state || typeof state !== 'object') return {};
  if (state.settings && typeof state.settings === 'object' && !Array.isArray(state.settings)) {
    return state.settings;
  }
  return state;
}

function looksLikeFactoryCajas(list) {
  if (!Array.isArray(list) || list.length === 0) return true;
  if (list.length !== 1) return false;
  return String(list[0]?.name || '').trim().toLowerCase() === 'caja principal';
}

function looksLikeFactorySalones(list) {
  if (!Array.isArray(list) || list.length === 0) return true;
  if (list.length !== 1) return false;
  const id = String(list[0]?.id || '').trim();
  const name = String(list[0]?.name || '').trim().toLowerCase();
  return id === 'principal' && (name === 'salón principal' || name === 'salon principal');
}

function catalogScore(cajas, salones) {
  const cajaNames = (cajas || []).map((c) => String(c?.name || '').trim()).filter(Boolean);
  const salonNames = (salones || []).map((s) => String(s?.name || '').trim()).filter(Boolean);
  let score = cajaNames.length + salonNames.length;
  if (!looksLikeFactoryCajas(cajas)) score += 10;
  if (!looksLikeFactorySalones(salones)) score += 10;
  if (salonNames.some((n) => n.toLowerCase() !== 'salón principal' && n.toLowerCase() !== 'salon principal')) {
    score += 5;
  }
  return score;
}

function findBestCatalogFromHistory() {
  const rows = queryAll(
    `SELECT before_state, after_state FROM app_settings_history ORDER BY datetime(created_at) DESC LIMIT 80`
  );
  let best = null;
  let bestScore = 0;
  for (const row of rows || []) {
    for (const col of ['after_state', 'before_state']) {
      const state = parseJsonSafe(row[col], null);
      const settings = settingsFromState(state);
      const cajas = Array.isArray(settings.cajas) ? settings.cajas : [];
      const salones = Array.isArray(settings.salones) ? settings.salones : [];
      if (!cajas.length && !salones.length) continue;
      const score = catalogScore(cajas, salones);
      if (score > bestScore) {
        bestScore = score;
        best = { cajas, salones };
      }
    }
  }
  return best;
}

function persistSettingsPatch(patch) {
  const row = queryOne('SELECT value FROM app_settings WHERE key = ?', ['settings']);
  const prev = parseJsonSafe(row?.value, {});
  const next = { ...prev, ...patch };
  runSql(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    ['settings', JSON.stringify(next)]
  );
}

/** Si cajas/salones volvieron al seed, restaura el último catálogo personalizado del historial. */
function recoverCajasAndSalonesIfResetToDefaults() {
  const row = queryOne('SELECT value FROM app_settings WHERE key = ?', ['settings']);
  const current = parseJsonSafe(row?.value, {});
  const cajas = Array.isArray(current.cajas) ? current.cajas : [];
  const salones = Array.isArray(current.salones) ? current.salones : [];
  const cajasReset = looksLikeFactoryCajas(cajas);
  const salonesReset = looksLikeFactorySalones(salones);
  if (!cajasReset && !salonesReset) return false;

  const recovered = findBestCatalogFromHistory();
  if (!recovered) return false;

  const patch = {};
  if (cajasReset && Array.isArray(recovered.cajas) && recovered.cajas.length && !looksLikeFactoryCajas(recovered.cajas)) {
    patch.cajas = recovered.cajas;
  }
  if (salonesReset && Array.isArray(recovered.salones) && recovered.salones.length && !looksLikeFactorySalones(recovered.salones)) {
    patch.salones = recovered.salones;
  }
  if (!Object.keys(patch).length) return false;
  persistSettingsPatch(patch);
  return true;
}

function shouldKeepPreviousCatalog(prevList, incomingList, kind) {
  const prev = Array.isArray(prevList) ? prevList : [];
  const incoming = Array.isArray(incomingList) ? incomingList : [];
  if (!prev.length) return false;
  if (kind === 'cajas') {
    return looksLikeFactoryCajas(incoming) && !looksLikeFactoryCajas(prev);
  }
  return looksLikeFactorySalones(incoming) && !looksLikeFactorySalones(prev);
}

module.exports = {
  looksLikeFactoryCajas,
  looksLikeFactorySalones,
  recoverCajasAndSalonesIfResetToDefaults,
  shouldKeepPreviousCatalog,
};
