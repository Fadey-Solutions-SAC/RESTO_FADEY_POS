/**
 * Identidad persistente del POS para registro automático en el panel SaaS.
 * No altera ventas, cocina, delivery ni facturación operativa.
 */
const crypto = require('crypto');
const { queryOne, runSql } = require('../database');
const { getControlConfig } = require('../masterAdminService');
const { formatPlanForSaas } = require('../servicePlan');
const { normalizePaymentEstado, PAYMENT_STATUSES } = require('../../packages/shared-types');
const { setClientIdentityResolver, readClientIdentity } = require('../../packages/shared-config');
const { getRestaurantContext } = require('./centralSyncService');

const SAAS_IDENTITY_KEY = 'saas_pos_identity';
const packageVersion = String(require('../../package.json').version || '1.0.0').trim();

function parseJsonSafe(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (_) {
    return fallback;
  }
}

function readIdentityStore() {
  const row = queryOne('SELECT value FROM app_settings WHERE key = ?', [SAAS_IDENTITY_KEY]);
  const parsed = parseJsonSafe(row?.value, {});
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function writeIdentityStore(store) {
  runSql(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [SAAS_IDENTITY_KEY, JSON.stringify(store || {})],
  );
}

function generateClientId() {
  const suffix = crypto.randomBytes(4).toString('hex').slice(0, 6);
  return `cliente_${suffix}`;
}

function generateClientApiKey() {
  const suffix = crypto.randomBytes(5).toString('hex').toUpperCase().slice(0, 8);
  return `RF_CLIENT_KEY_${suffix}`;
}

function resolveRenderUrlFromEnv(env = process.env) {
  return String(
    env.RENDER_PUBLIC_URL
    || env.NEXT_PUBLIC_API_URL
    || env.PUBLIC_API_BASE_URL
    || '',
  ).replace(/\/$/, '');
}

function ensureSaasPosIdentity(env = process.env) {
  const store = readIdentityStore();
  const now = new Date().toISOString();
  let changed = false;

  const envClientId = String(env.CLIENT_ID || '').trim();
  if (!envClientId && !String(store.clientId || '').trim()) {
    store.clientId = generateClientId();
    changed = true;
  } else if (envClientId && store.clientId !== envClientId) {
    store.clientId = envClientId;
    changed = true;
  } else if (!store.clientId) {
    store.clientId = envClientId || generateClientId();
    changed = true;
  }

  if (!String(store.clientApiKey || '').trim()) {
    store.clientApiKey = generateClientApiKey();
    changed = true;
  }

  const renderUrl = resolveRenderUrlFromEnv(env);
  if (renderUrl && store.renderUrl !== renderUrl) {
    store.renderUrl = renderUrl;
    changed = true;
  }

  if (!store.createdAt) {
    store.createdAt = now;
    changed = true;
  }
  store.lastActivityAt = now;
  changed = true;

  if (changed) writeIdentityStore(store);
  return store;
}

function touchSaasLastActivity() {
  const store = readIdentityStore();
  store.lastActivityAt = new Date().toISOString();
  const renderUrl = resolveRenderUrlFromEnv();
  if (renderUrl) store.renderUrl = renderUrl;
  writeIdentityStore(store);
  return store;
}

function getEffectiveClientId(env = process.env) {
  const envId = String(env.CLIENT_ID || '').trim();
  if (envId) return envId;
  return String(ensureSaasPosIdentity(env).clientId || '').trim();
}

function getEffectiveClientApiKey() {
  return String(ensureSaasPosIdentity().clientApiKey || '').trim();
}

function getEffectiveRenderUrl(env = process.env) {
  return resolveRenderUrlFromEnv(env) || String(readIdentityStore().renderUrl || '').trim();
}

function resolveClientIdentityFromEnvAndStore(env = process.env) {
  const store = ensureSaasPosIdentity(env);
  const clientId = getEffectiveClientId(env);
  return {
    clientId,
    restaurantId: String(env.RESTAURANT_ID || clientId || '').trim(),
    webServiceId: String(env.WEBSERVICE_ID || clientId || '').trim(),
    licenseKey: String(env.LICENSE_KEY || clientId || '').trim(),
    centralPlatformUrl: String(
      env.CENTRAL_API_URL
      || env.CENTRAL_PLATFORM_URL
      || env.NEXT_PUBLIC_PLATFORM_URL
      || 'https://restofadey.pe',
    ).replace(/\/$/, ''),
    apiSecretKey: String(env.API_SECRET_KEY || '').trim(),
    publicApiUrl: getEffectiveRenderUrl(env),
    clientApiKey: String(store.clientApiKey || '').trim(),
  };
}

function registerPosClientIdentityResolver() {
  setClientIdentityResolver(resolveClientIdentityFromEnvAndStore);
}

function isoDateOnly(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function deriveLicenseStatus() {
  const control = getControlConfig();
  const ctx = getRestaurantContext();
  const pp = ctx.pagoUso?.platform_payment || {};
  const paymentEstado = normalizePaymentEstado(pp.estado);
  const locked = Number(control.global_lock_enabled || 0) === 1;

  if (locked) return 'suspendido';
  if (paymentEstado === PAYMENT_STATUSES.PENDING) return 'pendiente';
  if (paymentEstado === PAYMENT_STATUSES.REJECTED) return 'rechazado';

  const exp = isoDateOnly(ctx.pagoUso?.fecha_proxima_facturacion);
  if (exp) {
    const today = new Date().toISOString().slice(0, 10);
    if (exp < today && paymentEstado !== PAYMENT_STATUSES.APPROVED) return 'vencido';
  }

  if (paymentEstado === PAYMENT_STATUSES.APPROVED) return 'activo';
  if (String(ctx.pagoUso?.comprobante_pago_url || '').trim()) return 'activo';
  return 'activo';
}

function derivePaymentStatusForInfo() {
  const ctx = getRestaurantContext();
  const pp = ctx.pagoUso?.platform_payment || {};
  const estado = normalizePaymentEstado(pp.estado);
  if (estado === PAYMENT_STATUSES.APPROVED) return 'approved';
  if (estado === PAYMENT_STATUSES.REJECTED) return 'rejected';
  if (estado === PAYMENT_STATUSES.PENDING) return 'pending';
  if (String(ctx.pagoUso?.comprobante_pago_url || '').trim()) return 'pending';
  return 'none';
}

/** Perfil público para vincular web service (sin login). */
function buildPublicRestaurantDiscoveryPayload() {
  const restaurant = queryOne(
    'SELECT name, legal_name, company_ruc, phone, email, address FROM restaurants LIMIT 1',
  );
  const admin = queryOne(
    `SELECT full_name, email FROM users
     WHERE lower(role) IN ('admin','master_admin') AND is_active = 1
     ORDER BY CASE WHEN lower(role) = 'admin' THEN 0 ELSE 1 END, created_at ASC
     LIMIT 1`,
  );
  const legalName =
    String(restaurant?.legal_name || '').trim()
    || String(admin?.full_name || '').trim();

  const ownerName =
    String(admin?.full_name || '').trim().split(/\s+/)[0]
    || String(restaurant?.legal_name || '').trim().split(/\s+/)[0]
    || '';

  return {
    name: String(restaurant?.name || '').trim() || 'Mi Restaurante',
    ownerName: ownerName || undefined,
    legalName,
    email: String(restaurant?.email || admin?.email || '').trim(),
    phone: String(restaurant?.phone || '').trim(),
    ruc: String(restaurant?.company_ruc || '').trim(),
    address: String(restaurant?.address || '').trim(),
    product: 'resto-fadey',
  };
}

function buildRestaurantInfoResponse() {
  const store = touchSaasLastActivity();
  const identity = readClientIdentity();
  const restaurant = queryOne(
    'SELECT name, legal_name, company_ruc, phone, email, address, updated_at FROM restaurants LIMIT 1',
  );
  const admin = queryOne(
    `SELECT full_name, email FROM users
     WHERE lower(role) IN ('admin','master_admin') AND is_active = 1
     ORDER BY CASE WHEN lower(role) = 'admin' THEN 0 ELSE 1 END, created_at ASC
     LIMIT 1`,
  );
  const ctx = getRestaurantContext();
  const control = getControlConfig();
  const expDate = isoDateOnly(ctx.pagoUso?.fecha_proxima_facturacion);
  const ownerName =
    String(admin?.full_name || '').trim()
    || String(restaurant?.legal_name || '').trim()
    || String(restaurant?.name || '').trim();

  return {
    clientId: identity.clientId,
    apiKey: identity.clientApiKey || store.clientApiKey || getEffectiveClientApiKey(),
    restaurantName: String(restaurant?.name || '').trim(),
    ownerName,
    ruc: String(restaurant?.company_ruc || '').trim(),
    phone: String(restaurant?.phone || '').trim(),
    email: String(restaurant?.email || admin?.email || '').trim(),
    plan: formatPlanForSaas(control.service_plan),
    licenseStatus: deriveLicenseStatus(),
    paymentStatus: derivePaymentStatusForInfo(),
    expirationDate: expDate || null,
    lastActivity: store.lastActivityAt || new Date().toISOString(),
    renderUrl: getEffectiveRenderUrl(),
    systemVersion: packageVersion,
    validationKey: String(identity.apiSecretKey || '').trim() ? 'configured' : 'missing_api_secret',
  };
}

function getSystemHealthPayload() {
  const store = readIdentityStore();
  let database = 'connected';
  try {
    queryOne('SELECT 1 AS ok');
  } catch (_) {
    database = 'error';
  }
  return {
    status: database === 'connected' ? 'online' : 'degraded',
    database,
    version: packageVersion,
    lastActivity: store.lastActivityAt || new Date().toISOString(),
    clientId: getEffectiveClientId(),
    renderUrl: getEffectiveRenderUrl(),
  };
}

function assertClientIdMatches(bodyClientId) {
  const expected = getEffectiveClientId();
  const licenseKey = String(process.env.LICENSE_KEY || '').trim();
  const incoming = String(bodyClientId || '').trim();
  if (!incoming) return { ok: true };
  if (!expected && !licenseKey) return { ok: true };
  if (incoming === expected) return { ok: true };
  if (licenseKey && incoming === licenseKey) return { ok: true };
  const store = readIdentityStore();
  if (incoming === String(store.clientId || '').trim()) return { ok: true };
  return { ok: false, status: 403, error: 'clientId no coincide con este POS' };
}

function initPosSaasIdentity() {
  registerPosClientIdentityResolver();
  const identity = ensureSaasPosIdentity();
  const merged = readClientIdentity();
  console.log(
    '[saas-pos] identidad lista',
    JSON.stringify({
      clientId: merged.clientId || '(pendiente)',
      hasApiSecret: Boolean(merged.apiSecretKey),
      hasClientApiKey: Boolean(identity.clientApiKey),
      renderUrl: getEffectiveRenderUrl() || '(sin RENDER_PUBLIC_URL)',
    }),
  );
  if (merged.apiSecretKey && merged.centralPlatformUrl) {
    try {
      const { syncSaasClientProfile } = require('./centralSyncService');
      syncSaasClientProfile();
    } catch (_) {
      /* opcional al arranque */
    }
  }
  return identity;
}

module.exports = {
  initPosSaasIdentity,
  registerPosClientIdentityResolver,
  ensureSaasPosIdentity,
  touchSaasLastActivity,
  buildRestaurantInfoResponse,
  buildPublicRestaurantDiscoveryPayload,
  getSystemHealthPayload,
  assertClientIdMatches,
  getEffectiveClientId,
  getEffectiveRenderUrl,
  resolveClientIdentityFromEnvAndStore,
};
