const { queryOne, runSql } = require('../database');

const DEFAULT_JORNADA_LABORAL = Object.freeze({
  requiere_foto_inicio_sesion: 0,
  requiere_foto_fin_jornada: 0,
  requiere_foto_asistencia: 0,
});

function isFlagEnabled(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function normalizeJornadaLaboral(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const inicio = Object.prototype.hasOwnProperty.call(o, 'requiere_foto_inicio_sesion')
    ? (isFlagEnabled(o.requiere_foto_inicio_sesion) ? 1 : 0)
    : 0;
  const fin = Object.prototype.hasOwnProperty.call(o, 'requiere_foto_fin_jornada')
    ? (isFlagEnabled(o.requiere_foto_fin_jornada) ? 1 : 0)
    : 0;
  return {
    requiere_foto_inicio_sesion: inicio,
    requiere_foto_fin_jornada: fin,
    requiere_foto_asistencia: inicio || fin ? 1 : 0,
  };
}

function readJornadaLaboralFromSettingsBlob(settingsObj) {
  const jl = settingsObj?.jornada_laboral && typeof settingsObj.jornada_laboral === 'object'
    ? settingsObj.jornada_laboral
    : {};
  const normalized = normalizeJornadaLaboral(jl);
  return {
    loginPhoto: normalized.requiere_foto_inicio_sesion === 1,
    logoutPhoto: normalized.requiere_foto_fin_jornada === 1,
    jornada_laboral: normalized,
  };
}

function readJornadaLaboralFlags() {
  const row = queryOne('SELECT value FROM app_settings WHERE key = ?', ['settings']);
  if (!row?.value) {
    return { loginPhoto: false, logoutPhoto: false, jornada_laboral: { ...DEFAULT_JORNADA_LABORAL } };
  }
  try {
    const s = JSON.parse(row.value);
    return readJornadaLaboralFromSettingsBlob(s);
  } catch {
    return { loginPhoto: false, logoutPhoto: false, jornada_laboral: { ...DEFAULT_JORNADA_LABORAL } };
  }
}

/** Asegura claves explícitas en 0 si faltan; no infiere desde legacy. */
function ensureJornadaLaboralDefaultsInSettings() {
  const row = queryOne('SELECT value FROM app_settings WHERE key = ?', ['settings']);
  if (!row?.value) return false;
  let parsed = {};
  try {
    parsed = JSON.parse(row.value);
  } catch {
    return false;
  }
  const current = parsed.jornada_laboral && typeof parsed.jornada_laboral === 'object'
    ? parsed.jornada_laboral
    : {};
  const hasInicio = Object.prototype.hasOwnProperty.call(current, 'requiere_foto_inicio_sesion');
  const hasFin = Object.prototype.hasOwnProperty.call(current, 'requiere_foto_fin_jornada');
  if (hasInicio && hasFin) return false;
  const nextJl = normalizeJornadaLaboral({
    ...current,
    requiere_foto_inicio_sesion: hasInicio ? current.requiere_foto_inicio_sesion : 0,
    requiere_foto_fin_jornada: hasFin ? current.requiere_foto_fin_jornada : 0,
  });
  const next = { ...parsed, jornada_laboral: nextJl };
  runSql(
    "UPDATE app_settings SET value = ?, updated_at = datetime('now') WHERE key = ?",
    [JSON.stringify(next), 'settings'],
  );
  return true;
}

/**
 * Una sola vez: foto de asistencia desactivada por defecto (instalaciones que quedaron en 1 por migración legacy).
 */
function applyJornadaFotoDefaultOffMigration() {
  const key = '2026-08-jornada-foto-default-off-v1';
  const done = queryOne('SELECT 1 AS ok FROM schema_migrations WHERE migration_key = ?', [key]);
  if (done?.ok) return false;
  const row = queryOne('SELECT value FROM app_settings WHERE key = ?', ['settings']);
  if (!row?.value) {
    runSql('INSERT OR IGNORE INTO schema_migrations (migration_key) VALUES (?)', [key]);
    return false;
  }
  let parsed = {};
  try {
    parsed = JSON.parse(row.value);
  } catch {
    runSql('INSERT OR IGNORE INTO schema_migrations (migration_key) VALUES (?)', [key]);
    return false;
  }
  const next = {
    ...parsed,
    jornada_laboral: { ...DEFAULT_JORNADA_LABORAL },
  };
  runSql(
    "UPDATE app_settings SET value = ?, updated_at = datetime('now') WHERE key = ?",
    [JSON.stringify(next), 'settings'],
  );
  runSql('INSERT OR IGNORE INTO schema_migrations (migration_key) VALUES (?)', [key]);
  console.log('[migration] jornada_laboral: foto de asistencia desactivada por defecto');
  return true;
}

module.exports = {
  DEFAULT_JORNADA_LABORAL,
  normalizeJornadaLaboral,
  readJornadaLaboralFlags,
  readJornadaLaboralFromSettingsBlob,
  ensureJornadaLaboralDefaultsInSettings,
  applyJornadaFotoDefaultOffMigration,
};
