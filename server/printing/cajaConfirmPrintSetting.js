const { queryOne, runSql } = require('../database');

const APP_SETTINGS_KEY = 'caja_sale_print_confirm';

function parseConfirmPrintValue(raw) {
  if (raw === false || raw === 0) return false;
  if (raw === true || raw === 1) return true;
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return true;
  if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false;
  if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true;
  try {
    const parsed = JSON.parse(String(raw));
    if (parsed === false || parsed === 0) return false;
    if (parsed === true || parsed === 1) return true;
    if (parsed && typeof parsed === 'object' && Object.prototype.hasOwnProperty.call(parsed, 'enabled')) {
      return Boolean(parsed.enabled);
    }
  } catch (_) {
    /* noop */
  }
  return true;
}

/** Global del restaurante: aviso «¿imprimir nota de venta?» tras cobrar. Por defecto activo. */
function readCajaSalePrintConfirm() {
  try {
    const row = queryOne('SELECT value FROM app_settings WHERE key = ?', [APP_SETTINGS_KEY]);
    if (!row || row.value == null || String(row.value).trim() === '') return true;
    return parseConfirmPrintValue(row.value);
  } catch (_) {
    return true;
  }
}

function writeCajaSalePrintConfirm(enabled) {
  const next = Boolean(enabled);
  runSql(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [APP_SETTINGS_KEY, next ? 'true' : 'false'],
  );
  return next;
}

module.exports = {
  APP_SETTINGS_KEY,
  parseConfirmPrintValue,
  readCajaSalePrintConfirm,
  writeCajaSalePrintConfirm,
};
