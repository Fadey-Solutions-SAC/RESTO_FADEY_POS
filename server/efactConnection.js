/**
 * Conexión al bot Python (e-fact): URL y secreto pueden fijarse por entorno
 * (mismo contenedor Docker o .env junto al API Node) sin depender del valor guardado en el panel.
 *
 * EFACT_API_URL / INTERNAL_EFACT_API_URL — base sin barra final, p. ej. http://127.0.0.1:8765
 * EFACT_HTTP_SECRET / INTERNAL_EFACT_HTTP_SECRET — mismo valor que en el .env del bot (X-EFACT-SECRET)
 */

function envEfactApiUrl() {
  return String(process.env.EFACT_API_URL || process.env.INTERNAL_EFACT_API_URL || '').trim();
}

function envEfactHttpSecret() {
  return String(process.env.EFACT_HTTP_SECRET || process.env.INTERNAL_EFACT_HTTP_SECRET || '').trim();
}

/**
 * Solo acepta http(s)://… válido. Cualquier otro texto en BD (p. ej. usuario de login
 * pegado por error o autocompletado del navegador) se ignora para no romper fetch al bot.
 */
function sanitizeDbEfactApiUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const lc = s.toLowerCase();
  if (!lc.startsWith('http://') && !lc.startsWith('https://')) return '';
  try {
    // eslint-disable-next-line no-new
    new URL(s);
    return s;
  } catch {
    return '';
  }
}

/** Bot local por defecto cuando el proveedor es restaurant_efact y no hay URL. */
const DEFAULT_LOCAL_EFACT_URL = 'http://127.0.0.1:8765';

function effectiveEfactApiUrl(restaurant) {
  const fromEnv = envEfactApiUrl();
  if (fromEnv) return fromEnv;
  const fromDb = sanitizeDbEfactApiUrl(restaurant?.billing_api_url);
  if (fromDb) return fromDb;
  if (String(restaurant?.billing_provider || '').toLowerCase() === 'restaurant_efact') {
    return DEFAULT_LOCAL_EFACT_URL;
  }
  return '';
}

/** true si vacío (se usa solo env) o si es URL http(s) válida */
function isAcceptableEfactApiUrlForStorage(value) {
  const s = String(value ?? '').trim();
  if (!s) return true;
  return Boolean(sanitizeDbEfactApiUrl(s));
}

function effectiveEfactHttpSecret(restaurant) {
  const fromEnv = envEfactHttpSecret();
  if (fromEnv) return fromEnv;
  return String(restaurant?.billing_api_token || '').trim();
}

function billingEfactUrlFromEnv() {
  return Boolean(envEfactApiUrl());
}

function billingEfactSecretFromEnv() {
  return Boolean(envEfactHttpSecret());
}

module.exports = {
  effectiveEfactApiUrl,
  effectiveEfactHttpSecret,
  billingEfactUrlFromEnv,
  billingEfactSecretFromEnv,
  sanitizeDbEfactApiUrl,
  isAcceptableEfactApiUrlForStorage,
};
