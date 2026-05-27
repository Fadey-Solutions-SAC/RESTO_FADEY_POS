/**
 * Pagos por comprobante: pendiente → plataforma central → aprobado/rechazado (polling).
 * El comprobante permanece en BD; la UI lo oculta tras aprobación.
 */
const { readClientIdentity, isCentralSyncConfigured } = require('../../packages/shared-config');
const { PAYMENT_STATUSES, normalizePaymentEstado } = require('../../packages/shared-types');
const { mapCentralSyncError } = require('./saasPanelErrors');
const { queryOne, runSql } = require('../database');
const { proximaFechaFromControlAnchor } = require('../pagoUsoBillingSync');
const {
  addNotification,
  clearNotificationsByTitle,
  releaseAutoLockIfComprobantePresent,
  PAGO_USO_SUBIR_COMPROBANTE_AVISO_TITLE,
} = require('../masterAdminService');

const PAGO_USO_KEY = 'pago_uso_sistema';
const APPROVAL_NOTIFICATION_TITLE = 'Pago aprobado — Resto Fadey';
const PENDING_NOTIFICATION_TITLE = 'Comprobante recibido — pendiente de aprobación';
const REJECTED_NOTIFICATION_TITLE = 'Pago rechazado — Resto Fadey';
const LEGACY_SUCCESS_NOTIFICATION_TITLE = 'Pago exitoso¡ Gracias por trabajar con Resto Fadey';
/** Aviso de aprobación en campana y banner de Mi restaurante (por defecto 1 hora). */
const PAYMENT_APPROVAL_NOTICE_MINUTES = Math.max(
  1,
  Number(process.env.PLATFORM_PAYMENT_APPROVAL_NOTICE_MINUTES || 60),
);

const POLL_MS = Math.max(15000, Number(process.env.PLATFORM_PAYMENT_POLL_MS || 60000));
const RETRY_DELAYS_MS = [800, 2000, 5000];

let pollTimer = null;
let pollInFlight = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withCentralRetry(fn) {
  let last = null;
  for (let i = 0; i < RETRY_DELAYS_MS.length; i += 1) {
    last = await fn();
    if (last?.ok || last?.skipped) return last;
    if (i < RETRY_DELAYS_MS.length - 1) {
      await sleep(RETRY_DELAYS_MS[i]);
    }
  }
  return last;
}

/**
 * Nuevo archivo de comprobante: reabre la UI y reinicia el flujo si el pago anterior
 * ya fue aprobado/rechazado o si se reemplaza el archivo en revisión.
 */
function applyNewComprobanteUploadToPago(pago, nextUrl, prevUrl) {
  const out = { ...(pago && typeof pago === 'object' ? pago : {}) };
  const next = String(nextUrl || '').trim();
  const prev = String(prevUrl || '').trim();
  if (!next) return out;
  out.comprobante_pago_url = next;
  if (next === prev) return out;

  const pp = { ...(out.platform_payment || {}) };
  const estado = normalizePaymentEstado(pp.estado);
  pp.comprobante_oculto_ui = false;

  if (
    estado === PAYMENT_STATUSES.APPROVED
    || estado === PAYMENT_STATUSES.REJECTED
    || estado === PAYMENT_STATUSES.PENDING
  ) {
    pp.estado = '';
    pp.referencia = '';
    pp.submitted_at = '';
    pp.resolved_at = '';
    pp.last_central_sync_ok = null;
    pp.last_central_sync_error = '';
    pp.central_payment_id = null;
    clearNotificationsByTitle(PENDING_NOTIFICATION_TITLE);
    clearNotificationsByTitle(APPROVAL_NOTIFICATION_TITLE);
    clearNotificationsByTitle(LEGACY_SUCCESS_NOTIFICATION_TITLE);
  }
  out.platform_payment = pp;
  return out;
}

function readPagoUso() {
  const row = queryOne('SELECT value FROM app_settings WHERE key = ?', [PAGO_USO_KEY]);
  try {
    return row?.value ? JSON.parse(row.value) : {};
  } catch (_) {
    return {};
  }
}

function writePagoUso(pago) {
  runSql(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [PAGO_USO_KEY, JSON.stringify(pago || {})],
  );
}

function isoDateKeyNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function generateReferencia() {
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `RF-${Date.now()}-${suffix}`;
}

function appendHistorial(pago, entry) {
  const hist = Array.isArray(pago.platform_payment?.historial) ? [...pago.platform_payment.historial] : [];
  hist.unshift(entry);
  if (hist.length > 50) hist.length = 50;
  return hist;
}

function isPaymentApprovedForUnlock(pago) {
  if (!isCentralSyncConfigured()) return true;
  const pp = pago?.platform_payment || {};
  const estado = normalizePaymentEstado(pp.estado);
  if (!estado && String(pago?.comprobante_pago_url || '').trim()) {
    return true;
  }
  return estado === PAYMENT_STATUSES.APPROVED;
}

/** Desbloqueo y aviso legacy (sin plataforma central configurada). */
function legacyConfirmComprobanteOnUpload(urlTrimmed) {
  if (!String(urlTrimmed || '').trim()) return;
  releaseAutoLockIfComprobantePresent(urlTrimmed, { legacySuccessMessage: true });
}

/** Panel Vercel/Supabase envuelve respuestas en { success, data: { ... } }. */
function unwrapCentralApiBody(data) {
  if (!data || typeof data !== 'object') return data;
  const inner = data.data;
  if (inner && typeof inner === 'object' && (data.success === true || data.ok === true)) {
    return inner;
  }
  return data;
}

function pickRemotePaymentEstado(payload) {
  const d = unwrapCentralApiBody(payload);
  if (!d || typeof d !== 'object') return null;
  return normalizePaymentEstado(
    d.paymentStatus
      || d.estado
      || d.status
      || d.payment?.paymentStatus
      || d.payment?.estado
      || d.payment?.status,
  );
}

async function fetchCentralStatus(referencia) {
  if (!isCentralSyncConfigured()) return { skipped: true };
  const { fetchCentralLicenseStatus } = require('./centralSyncService');
  const licenseRes = await fetchCentralLicenseStatus();
  if (licenseRes?.ok && licenseRes.data) {
    const d = unwrapCentralApiBody(licenseRes.data);
    const remoteEstado = pickRemotePaymentEstado(d);
    if (remoteEstado) {
      return {
        ok: true,
        data: {
          estado: remoteEstado,
          payment: d.payment || { estado: remoteEstado, id: d.payment?.id },
          licenseStatus: d.licenseStatus,
        },
      };
    }
  }

  const identity = readClientIdentity();
  const ref = String(referencia || '').trim();
  const qs = new URLSearchParams({ clientId: identity.clientId });
  if (ref) qs.set('referencia', ref);
  const url = `${identity.centralPlatformUrl}/api/payments/status?${qs.toString()}`;
  const headers = {
    Authorization: `Bearer ${identity.apiSecretKey}`,
    'X-Client-Id': identity.clientId,
    'X-WebService-Id': identity.webServiceId || identity.clientId,
    'X-License-Key': identity.licenseKey || identity.clientId,
  };
  try {
    const res = await fetch(url, { method: 'GET', headers });
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (_) {
      data = {};
    }
    if (!res.ok) {
      return { ok: false, status: res.status, data };
    }
    const unwrapped = unwrapCentralApiBody(data);
    const remoteEstado = pickRemotePaymentEstado(unwrapped);
    return {
      ok: true,
      data: {
        ...unwrapped,
        estado: remoteEstado || unwrapped.estado,
        payment: unwrapped.payment || unwrapped,
      },
    };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

function parseExpirationDateInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function renewLicenseOnPaymentApproved(pago, expirationDate = null) {
  const explicit = parseExpirationDateInput(expirationDate);
  if (explicit) {
    pago.fecha_proxima_facturacion = explicit;
    pago.comprobante_alert_sent_for = '';
    return pago;
  }
  const periodo = pago.periodo_facturacion === 'semestral' ? 'semestral' : 'mensual';
  const today = isoDateKeyNow();
  const current = String(pago.fecha_proxima_facturacion || '').trim();
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(current) && current >= today ? current : today;
  pago.fecha_proxima_facturacion = proximaFechaFromControlAnchor(anchor, periodo);
  pago.comprobante_alert_sent_for = '';
  return pago;
}

function paymentApprovalNoticeExpiresAt() {
  return new Date(Date.now() + PAYMENT_APPROVAL_NOTICE_MINUTES * 60 * 1000).toISOString();
}

function isWithinPaymentApprovalNoticeWindow(resolvedAtIso) {
  const t = new Date(resolvedAtIso || '').getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < PAYMENT_APPROVAL_NOTICE_MINUTES * 60 * 1000;
}

function clearPaymentQueueNotifications() {
  clearNotificationsByTitle(PENDING_NOTIFICATION_TITLE);
  clearNotificationsByTitle(PAGO_USO_SUBIR_COMPROBANTE_AVISO_TITLE);
}

/** Quita avisos previos del ciclo de pago; deja solo la notificación de pendiente de aprobación. */
function clearNotificationsBeforePaymentPending() {
  clearNotificationsByTitle(PAGO_USO_SUBIR_COMPROBANTE_AVISO_TITLE);
  clearNotificationsByTitle(PENDING_NOTIFICATION_TITLE);
  clearNotificationsByTitle(APPROVAL_NOTIFICATION_TITLE);
  clearNotificationsByTitle(LEGACY_SUCCESS_NOTIFICATION_TITLE);
}

function notifyPaymentApproved() {
  clearPaymentQueueNotifications();
  clearNotificationsByTitle(APPROVAL_NOTIFICATION_TITLE);
  clearNotificationsByTitle(LEGACY_SUCCESS_NOTIFICATION_TITLE);
  addNotification({
    title: APPROVAL_NOTIFICATION_TITLE,
    message: 'Pago aprobado correctamente. Licencia actualizada.',
    created_by: 'Plataforma central',
    level: 'success',
    expires_at: paymentApprovalNoticeExpiresAt(),
  });
}

function notifyPaymentRejected(motivo) {
  clearNotificationsByTitle(PENDING_NOTIFICATION_TITLE);
  clearNotificationsByTitle(APPROVAL_NOTIFICATION_TITLE);
  clearNotificationsByTitle(LEGACY_SUCCESS_NOTIFICATION_TITLE);
  addNotification({
    title: REJECTED_NOTIFICATION_TITLE,
    message: motivo || 'Su comprobante no fue aprobado. Contacte a soporte o suba un nuevo comprobante.',
    created_by: 'Plataforma central',
    level: 'warning',
  });
}

function notifyPaymentPending() {
  clearNotificationsBeforePaymentPending();
  addNotification({
    title: PENDING_NOTIFICATION_TITLE,
    message: 'Su comprobante fue enviado y está pendiente de revisión por el administrador.',
    created_by: 'Sistema automático',
    level: 'info',
  });
}

function applyPaymentApproved({ centralPaymentId, resolvedAt, expirationDate } = {}) {
  const pago = readPagoUso();
  const pp = { ...(pago.platform_payment || {}) };
  const now = resolvedAt || new Date().toISOString();
  const ref = String(pp.referencia || '').trim();
  const url = String(pago.comprobante_pago_url || '').trim();

  pp.estado = PAYMENT_STATUSES.APPROVED;
  pp.resolved_at = now;
  pp.comprobante_oculto_ui = true;
  if (centralPaymentId) pp.central_payment_id = centralPaymentId;

  pago.platform_payment = pp;
  pago.platform_payment.historial = appendHistorial(pago, {
    fecha: now.slice(0, 10),
    voucher: url,
    estado: PAYMENT_STATUSES.APPROVED,
    referencia: ref,
    monto: pp.monto ?? null,
    aprobacion_at: now,
  });

  const renewed = renewLicenseOnPaymentApproved(pago, expirationDate);
  writePagoUso(renewed);

  if (url) {
    releaseAutoLockIfComprobantePresent(url, {
      legacySuccessMessage: false,
      clearUploadAviso: false,
    });
  }
  notifyPaymentApproved();

  return getPublicPlatformPaymentState();
}

/** Confirmación push desde panel SaaS (POST /api/license/confirm). */
function confirmLicenseFromSaas({ clientId, status, expirationDate } = {}) {
  const { assertClientIdMatches } = require('./posSaasIdentityService');
  const access = assertClientIdMatches(clientId);
  if (!access.ok) {
    return { ok: false, status: access.status, error: access.error };
  }

  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'approved' || normalized === 'aprobado') {
    const payment = applyPaymentApproved({
      resolvedAt: new Date().toISOString(),
      expirationDate,
    });
    return {
      ok: true,
      message: 'Pago aprobado correctamente. Licencia actualizada.',
      payment,
    };
  }
  if (normalized === 'rejected' || normalized === 'rechazado') {
    const payment = applyPaymentRejected({
      motivo: 'Pago rechazado desde el panel administrativo.',
      resolvedAt: new Date().toISOString(),
    });
    return { ok: true, message: 'Pago rechazado registrado en el POS.', payment };
  }

  return { ok: false, status: 400, error: 'status debe ser approved o rejected' };
}

function applyPaymentRejected({ motivo, resolvedAt } = {}) {
  const pago = readPagoUso();
  const pp = { ...(pago.platform_payment || {}) };
  const now = resolvedAt || new Date().toISOString();
  const ref = String(pp.referencia || '').trim();
  const url = String(pago.comprobante_pago_url || '').trim();

  pp.estado = PAYMENT_STATUSES.REJECTED;
  pp.resolved_at = now;
  pp.comprobante_oculto_ui = false;

  pago.platform_payment = pp;
  pago.platform_payment.historial = appendHistorial(pago, {
    fecha: now.slice(0, 10),
    voucher: url,
    estado: PAYMENT_STATUSES.REJECTED,
    referencia: ref,
    monto: pp.monto ?? null,
    rechazo_motivo: motivo || '',
  });
  writePagoUso(pago);
  notifyPaymentRejected(motivo);

  return getPublicPlatformPaymentState();
}

/**
 * Registra comprobante en estado pendiente y lo envía a la plataforma central.
 */
async function registerPendingComprobantePayment({ comprobanteUrl, monto = null, referencia = null }) {
  const url = String(comprobanteUrl || '').trim();
  if (!url) return null;

  const ref = String(referencia || '').trim() || generateReferencia();
  const now = new Date().toISOString();
  let pago = readPagoUso();

  pago.platform_payment = {
    estado: PAYMENT_STATUSES.PENDING,
    referencia: ref,
    monto: monto != null && Number.isFinite(Number(monto)) ? Number(monto) : null,
    central_payment_id: null,
    submitted_at: now,
    resolved_at: null,
    comprobante_oculto_ui: false,
    historial: appendHistorial(pago, {
      fecha: now.slice(0, 10),
      voucher: url,
      estado: PAYMENT_STATUSES.PENDING,
      referencia: ref,
      monto: monto != null && Number.isFinite(Number(monto)) ? Number(monto) : null,
      aprobacion_at: null,
    }),
  };
  writePagoUso(pago);
  notifyPaymentPending();

  await pushComprobanteToCentral({ comprobanteUrl: url, referencia: ref });

  return getPublicPlatformPaymentState();
}

function recordCentralSyncResult(pago, result) {
  const pp = { ...(pago.platform_payment || {}) };
  pp.last_central_sync_at = new Date().toISOString();
  if (result?.skipped) {
    pp.last_central_sync_ok = false;
    pp.last_central_sync_error = `Sync omitido: ${result.reason || 'central_not_configured'}`;
  } else if (result?.ok) {
    pp.last_central_sync_ok = true;
    pp.last_central_sync_error = '';
    if (result?.data?.paymentId) pp.central_payment_id = result.data.paymentId;
  } else {
    pp.last_central_sync_ok = false;
    const detail = result?.data?.error || result?.error || `HTTP ${result?.status || '?'}`;
    pp.last_central_sync_error = String(detail).slice(0, 500);
    console.warn('[platform-payment] sync central falló:', pp.last_central_sync_error);
  }
  pago.platform_payment = pp;
  writePagoUso(pago);
  return pp;
}

/** Envía (o reenvía) el comprobante actual a POST /api/payments */
async function pushComprobanteToCentral({ comprobanteUrl, referencia } = {}) {
  const pago = readPagoUso();
  const url = String(comprobanteUrl || pago.comprobante_pago_url || '').trim();
  if (!url) return { ok: false, error: 'sin_comprobante_url' };

  if (!isCentralSyncConfigured()) {
    const diag = require('../../packages/shared-config').getCentralSyncConfigDiagnostics();
    const result = { skipped: true, reason: `faltan variables: ${diag.missing.join(', ')}` };
    recordCentralSyncResult(pago, result);
    return result;
  }

  const ref = String(referencia || pago.platform_payment?.referencia || '').trim() || generateReferencia();
  try {
    const { syncVoucherPaymentNow } = require('./centralSyncService');
    const syncResult = await withCentralRetry(() =>
      syncVoucherPaymentNow({
        comprobanteUrl: url,
        reference: ref,
        amount: pago.platform_payment?.monto ?? null,
      }),
    );
    recordCentralSyncResult(readPagoUso(), syncResult);
    if (syncResult?.ok) {
      try {
        const { syncSaasClientProfile } = require('./centralSyncService');
        syncSaasClientProfile();
      } catch (_) {
        /* opcional */
      }
    }
    return syncResult;
  } catch (err) {
    const result = { ok: false, error: err.message || String(err) };
    recordCentralSyncResult(readPagoUso(), result);
    return result;
  }
}

function syncExpiredPaymentApprovalNotices() {
  const pago = readPagoUso();
  const pp = pago.platform_payment || {};
  const estado = normalizePaymentEstado(pp.estado);
  if (estado !== PAYMENT_STATUSES.APPROVED) return;
  if (isWithinPaymentApprovalNoticeWindow(pp.resolved_at)) return;
  clearNotificationsByTitle(APPROVAL_NOTIFICATION_TITLE);
  clearNotificationsByTitle(LEGACY_SUCCESS_NOTIFICATION_TITLE);
}

async function pollAndApplyPaymentStatus() {
  if (pollInFlight) return;
  syncExpiredPaymentApprovalNotices();
  if (!isCentralSyncConfigured()) return;

  const pago = readPagoUso();
  const pp = pago.platform_payment || {};
  const estado = normalizePaymentEstado(pp.estado);
  if (!pp.referencia && estado !== PAYMENT_STATUSES.PENDING) return;
  if (estado === PAYMENT_STATUSES.APPROVED || estado === PAYMENT_STATUSES.REJECTED) return;

  pollInFlight = true;
  try {
    const result = await fetchCentralStatus(pp.referencia);
    if (!result.ok || !result.data) return;

    const remoteEstado = normalizePaymentEstado(result.data.estado || result.data.payment?.estado);
    if (remoteEstado === PAYMENT_STATUSES.APPROVED) {
      applyPaymentApproved({
        centralPaymentId: result.data.payment?.id || result.data.paymentId,
        resolvedAt: result.data.payment?.updated_at,
      });
    } else if (remoteEstado === PAYMENT_STATUSES.REJECTED) {
      applyPaymentRejected({
        motivo: result.data.payment?.rechazo_motivo || result.data.motivo,
        resolvedAt: result.data.payment?.updated_at,
      });
    }
  } finally {
    pollInFlight = false;
  }
}

function getPublicPlatformPaymentState() {
  syncExpiredPaymentApprovalNotices();
  const pago = readPagoUso();
  const pp = pago.platform_payment || {};
  const estado = normalizePaymentEstado(pp.estado);
  const centralOn = isCentralSyncConfigured();
  const approved = estado === PAYMENT_STATUSES.APPROVED;
  const pending = estado === PAYMENT_STATUSES.PENDING;
  const rejected = estado === PAYMENT_STATUSES.REJECTED;
  const oculto = Boolean(pp.comprobante_oculto_ui) || approved;
  const showApprovalNotice = approved && isWithinPaymentApprovalNoticeWindow(pp.resolved_at);

  return {
    central_configured: centralOn,
    estado: estado || (centralOn ? null : 'aprobado'),
    referencia: String(pp.referencia || ''),
    monto: pp.monto ?? null,
    submitted_at: pp.submitted_at || null,
    resolved_at: pp.resolved_at || null,
    comprobante_oculto_ui: oculto,
    comprobante_visible_en_panel: Boolean(String(pago.comprobante_pago_url || '').trim()) && !oculto,
    show_pending_banner: pending,
    show_approved_banner: showApprovalNotice,
    show_rejected_banner: rejected,
    plan_activo: approved,
    mensaje_aprobado: showApprovalNotice
      ? 'Pago aprobado correctamente. Licencia actualizada.'
      : '',
    mensaje_licencia: showApprovalNotice ? 'Licencia actualizada' : '',
    historial_count: Array.isArray(pp.historial) ? pp.historial.length : 0,
    last_central_sync_ok: pp.last_central_sync_ok ?? null,
    last_central_sync_error: String(pp.last_central_sync_error || ''),
    central_user_message: !pp.last_central_sync_ok && pp.last_central_sync_error
      ? mapCentralSyncError({
          ok: false,
          error: pp.last_central_sync_error,
          last_central_sync_error: pp.last_central_sync_error,
        })
      : '',
    show_resync_hint: pending && pp.last_central_sync_ok === false,
    last_central_sync_at: pp.last_central_sync_at || null,
    central_payment_id: pp.central_payment_id || null,
  };
}

/** Quita comprobante local (antes de enviar o si aún no fue aprobado). */
function clearComprobanteDraft() {
  const pago = readPagoUso();
  const pp = pago.platform_payment || {};
  const estado = normalizePaymentEstado(pp.estado);
  if (estado === PAYMENT_STATUSES.APPROVED) {
    return { ok: false, central_user_message: 'No puede quitar un comprobante ya aprobado.' };
  }
  pago.comprobante_pago_url = '';
  delete pago.platform_payment;
  writePagoUso(pago);
  clearNotificationsByTitle(PENDING_NOTIFICATION_TITLE);
  return { ok: true };
}

/** Guarda URL local y envía comprobante al panel SaaS (acción explícita «Enviar comprobante»). */
async function submitComprobanteToPanel({ comprobanteUrl, monto = null } = {}) {
  const url = String(comprobanteUrl || readPagoUso().comprobante_pago_url || '').trim();
  if (!url) {
    return {
      ok: false,
      error: 'sin_comprobante',
      central_user_message: 'Primero cargue una imagen o PDF del comprobante.',
    };
  }

  const pago = readPagoUso();
  if (pago.comprobante_pago_url !== url) {
    pago.comprobante_pago_url = url;
    writePagoUso(pago);
  }

  if (!isCentralSyncConfigured()) {
    const { getCentralSyncConfigDiagnostics } = require('../../packages/shared-config');
    const diag = getCentralSyncConfigDiagnostics();
    return {
      ok: false,
      skipped: true,
      central_user_message: diag.missing.length
        ? `Conexión con el panel no configurada. En Render defina: ${diag.missing.join(', ')}.`
        : 'Conexión con el panel no configurada.',
    };
  }

  const identity = readClientIdentity();
  const absolute = require('./centralSyncService').resolvePublicVoucherUrl(url);
  if (!/^https?:\/\//i.test(absolute) && !identity.publicApiUrl) {
    return {
      ok: false,
      central_user_message:
        'Configure NEXT_PUBLIC_API_URL en el servidor (URL pública del POS) para que el panel pueda ver el comprobante.',
    };
  }

  try {
    const { evaluateAutomaticBillingRules } = require('../masterAdminService');
    evaluateAutomaticBillingRules();
  } catch (_) {
    /* opcional */
  }

  const { resolveComprobanteAmount } = require('./centralSyncService');
  const pagoForAmount = readPagoUso();
  const resolvedMonto =
    monto != null && Number.isFinite(Number(monto))
      ? resolveComprobanteAmount(monto, pagoForAmount, { strict: true })
      : resolveComprobanteAmount(null, pagoForAmount);
  if (resolvedMonto == null) {
    return {
      ok: false,
      central_user_message:
        'Indique el monto pagado (S/) en el formulario, mayor a cero, antes de enviar el comprobante.',
    };
  }
  if (pagoForAmount.monto_comprobante !== resolvedMonto) {
    pagoForAmount.monto_comprobante = resolvedMonto;
    writePagoUso(pagoForAmount);
  }

  const paymentState = await registerPendingComprobantePayment({
    comprobanteUrl: url,
    monto: resolvedMonto,
  });
  const pp = readPagoUso().platform_payment || {};
  const syncOk = pp.last_central_sync_ok === true;
  return {
    ok: syncOk,
    payment: paymentState || getPublicPlatformPaymentState(),
    central_user_message: syncOk
      ? ''
      : mapCentralSyncError({
          ok: false,
          error: pp.last_central_sync_error,
          last_central_sync_error: pp.last_central_sync_error,
          status: (() => {
            const m = String(pp.last_central_sync_error || '').match(/HTTP\s+(\d+)/i);
            return m ? Number(m[1]) : undefined;
          })(),
        }),
  };
}

function startPlatformPaymentPoller() {
  if (pollTimer) return;
  if (!isCentralSyncConfigured()) {
    console.log('[platform-payment] polling desactivado (central no configurada)');
    return;
  }
  pollAndApplyPaymentStatus().catch(() => {});
  pollTimer = setInterval(() => {
    pollAndApplyPaymentStatus().catch((err) => {
      console.warn('[platform-payment] poll:', err.message || err);
    });
  }, POLL_MS);
  console.log(`[platform-payment] polling cada ${POLL_MS}ms`);
}

module.exports = {
  applyNewComprobanteUploadToPago,
  registerPendingComprobantePayment,
  legacyConfirmComprobanteOnUpload,
  pollAndApplyPaymentStatus,
  getPublicPlatformPaymentState,
  startPlatformPaymentPoller,
  isPaymentApprovedForUnlock,
  applyPaymentApproved,
  applyPaymentRejected,
  fetchCentralStatus,
  pushComprobanteToCentral,
  submitComprobanteToPanel,
  clearComprobanteDraft,
  confirmLicenseFromSaas,
  readPagoUso,
  writePagoUso,
};
