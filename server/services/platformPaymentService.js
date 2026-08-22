/**
 * Pagos por comprobante: pendiente → plataforma central → aprobado/rechazado (polling).
 * Tras aprobación el comprobante pasa al historial y el formulario queda listo para el próximo ciclo.
 */
const { readClientIdentity, isCentralSyncConfigured } = require('../../packages/shared-config');
const { PAYMENT_STATUSES, normalizePaymentEstado } = require('../../packages/shared-types');
const { mapCentralSyncError } = require('./saasPanelErrors');
const { v4: uuidv4 } = require('uuid');
const { queryOne, runSql } = require('../database');
const { proximaFechaFromControlAnchor } = require('../pagoUsoBillingSync');
const {
  addNotification,
  clearNotificationsByTitle,
  clearPaymentCycleReminderNotifications,
  releaseAutoLockIfComprobantePresent,
  PAGO_USO_SUBIR_COMPROBANTE_AVISO_TITLE,
} = require('../masterAdminService');

const PAGO_USO_KEY = 'pago_uso_sistema';
const APPROVAL_NOTIFICATION_TITLE = 'Pago aprobado — Resto Fadey';
const PAYMENT_APPROVAL_THANK_YOU = 'Gracias por trabajar con nosotros.';
const PAYMENT_APPROVAL_BODY = 'Su pago fue aprobado correctamente. Licencia actualizada.';
const PAYMENT_APPROVAL_FULL_MESSAGE = `${PAYMENT_APPROVAL_THANK_YOU} ${PAYMENT_APPROVAL_BODY}`;
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
    pp.approval_notice_until = null;
    pp.last_approval_at = null;
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

function voucherUrlFromHistorialEntry(entry) {
  return String(entry?.comprobante_pago_url || entry?.voucher || '').trim();
}

function normalizeHistorialEntryForClient(entry) {
  const url = voucherUrlFromHistorialEntry(entry);
  return {
    id: String(entry?.id || ''),
    fecha: String(entry?.fecha || ''),
    estado: normalizePaymentEstado(entry?.estado) || String(entry?.estado || ''),
    referencia: String(entry?.referencia || ''),
    monto: entry?.monto != null && Number.isFinite(Number(entry.monto)) ? Number(entry.monto) : null,
    aprobacion_at: entry?.aprobacion_at || null,
    rechazo_motivo: String(entry?.rechazo_motivo || ''),
    comprobante_pago_url: url,
    voucher: url,
  };
}

function historialSinPendienteDuplicado(pago, referencia) {
  const ref = String(referencia || '').trim();
  const hist = Array.isArray(pago.platform_payment?.historial) ? [...pago.platform_payment.historial] : [];
  if (!ref) return hist;
  return hist.filter((h) => {
    const e = normalizePaymentEstado(h.estado);
    if (e !== PAYMENT_STATUSES.PENDING) return true;
    return String(h.referencia || '').trim() !== ref;
  });
}

function appendHistorial(pago, entry) {
  const hist = Array.isArray(pago.platform_payment?.historial) ? [...pago.platform_payment.historial] : [];
  hist.unshift({
    id: String(entry?.id || uuidv4()),
    ...entry,
    comprobante_pago_url: voucherUrlFromHistorialEntry(entry) || String(entry?.comprobante_pago_url || entry?.voucher || '').trim(),
    voucher: voucherUrlFromHistorialEntry(entry) || String(entry?.voucher || entry?.comprobante_pago_url || '').trim(),
  });
  if (hist.length > 50) hist.length = 50;
  return hist;
}

/** Al aprobar: actualiza el registro pendiente del mismo ciclo o crea uno aprobado. */
function upsertHistorialApproved(pago, entry) {
  const hist = Array.isArray(pago.platform_payment?.historial) ? [...pago.platform_payment.historial] : [];
  const ref = String(entry.referencia || '').trim();
  const url = voucherUrlFromHistorialEntry(entry);
  const idx = hist.findIndex((h) => {
    const e = normalizePaymentEstado(h.estado);
    const sameRef = ref && String(h.referencia || '').trim() === ref;
    const sameVoucher = url && voucherUrlFromHistorialEntry(h) === url;
    return (e === PAYMENT_STATUSES.PENDING || e === PAYMENT_STATUSES.APPROVED) && (sameRef || sameVoucher);
  });
  const row = {
    id: idx >= 0 ? String(hist[idx].id || uuidv4()) : uuidv4(),
    ...entry,
    comprobante_pago_url: url,
    voucher: url,
  };
  if (idx >= 0) {
    hist[idx] = { ...hist[idx], ...row, estado: PAYMENT_STATUSES.APPROVED };
  } else {
    hist.unshift(row);
  }
  if (hist.length > 50) hist.length = 50;
  return hist;
}

/** Tras aprobación: comprobante al historial y formulario listo para el próximo pago. */
function archiveApprovedPaymentAndPrepareNextCycle(pago, { now, ref, url, monto, centralPaymentId } = {}) {
  const ts = now || new Date().toISOString();
  const voucher = String(url || '').trim();
  const prevHist = Array.isArray(pago.platform_payment?.historial) ? [...pago.platform_payment.historial] : [];
  const historial = voucher
    ? upsertHistorialApproved(pago, {
      fecha: ts.slice(0, 10),
      voucher,
      comprobante_pago_url: voucher,
      estado: PAYMENT_STATUSES.APPROVED,
      referencia: ref,
      monto: monto != null && Number.isFinite(Number(monto)) ? Number(monto) : null,
      aprobacion_at: ts,
    })
    : prevHist;
  pago.comprobante_pago_url = '';
  delete pago.monto_comprobante;
  pago.platform_payment = {
    historial,
    approval_notice_until: paymentApprovalNoticeExpiresAt(),
    last_approval_at: ts,
  };
  if (centralPaymentId) {
    pago.platform_payment.last_central_payment_id = centralPaymentId;
  }
  return pago;
}

function daysFromTodayToDueDate(dueKey) {
  const due = String(dueKey || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return null;
  const a = new Date(`${isoDateKeyNow()}T12:00:00`);
  const b = new Date(`${due}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

function isLicensePeriodActive(pago) {
  const d = daysFromTodayToDueDate(pago?.fecha_proxima_facturacion);
  return d != null && d >= 0;
}

function isPaymentApprovedForUnlock(pago) {
  if (!isCentralSyncConfigured()) return true;
  const pp = pago?.platform_payment || {};
  const estado = normalizePaymentEstado(pp.estado);
  if (estado === PAYMENT_STATUSES.APPROVED) return true;
  if (estado === PAYMENT_STATUSES.PENDING) return true;
  if (isApprovalNoticeActive(pp)) return true;
  if (isLicensePeriodActive(pago)) return true;
  if (!estado && String(pago?.comprobante_pago_url || '').trim()) return true;
  return false;
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

/** Solo campos del pago concreto; nunca mezclar licenseStatus ni un pago viejo aprobado. */
function pickRemotePaymentEstado(payload, { referencia } = {}) {
  const d = unwrapCentralApiBody(payload);
  if (!d || typeof d !== 'object') return null;
  const refFilter = String(referencia || '').trim();
  const payment = d.payment && typeof d.payment === 'object' ? d.payment : null;
  const paymentRef = String(payment?.referencia || d.referencia || '').trim();

  if (refFilter && (!paymentRef || paymentRef !== refFilter)) {
    return null;
  }

  return normalizePaymentEstado(
    payment?.estado
      || payment?.paymentStatus
      || payment?.status
      || d.paymentStatus,
  );
}

function centralStatusRequestHeaders(identity) {
  return {
    Authorization: `Bearer ${identity.apiSecretKey}`,
    'X-Client-Id': identity.clientId,
    'X-WebService-Id': identity.webServiceId || identity.clientId,
    'X-License-Key': identity.licenseKey || identity.clientId,
  };
}

/** Consulta el pago exacto por referencia en el panel central. */
async function fetchCentralPaymentStatusByReferencia(referencia) {
  const ref = String(referencia || '').trim();
  if (!ref) return { ok: false, error: 'sin_referencia' };

  const identity = readClientIdentity();
  const qs = new URLSearchParams({ clientId: identity.clientId, referencia: ref });
  const url = `${identity.centralPlatformUrl}/api/payments/status?${qs.toString()}`;
  try {
    const res = await fetch(url, { method: 'GET', headers: centralStatusRequestHeaders(identity) });
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
    const payment = unwrapped?.payment && typeof unwrapped.payment === 'object'
      ? unwrapped.payment
      : null;
    if (!payment) {
      return {
        ok: true,
        data: { estado: null, referencia: ref, payment: null },
      };
    }
    const remoteEstado = pickRemotePaymentEstado(unwrapped, { referencia: ref });
    return {
      ok: true,
      data: {
        estado: remoteEstado,
        referencia: ref,
        payment,
        paymentId: payment.id || unwrapped.paymentId,
      },
    };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

async function fetchCentralStatus(referencia) {
  if (!isCentralSyncConfigured()) return { skipped: true };
  const ref = String(referencia || '').trim();

  if (ref) {
    return fetchCentralPaymentStatusByReferencia(ref);
  }

  const { fetchCentralLicenseStatus } = require('./centralSyncService');
  const licenseRes = await fetchCentralLicenseStatus();
  if (licenseRes?.ok && licenseRes.data) {
    const d = unwrapCentralApiBody(licenseRes.data);
    const paymentRef = String(d.payment?.referencia || '').trim();
    const remoteEstado = pickRemotePaymentEstado(d, { referencia: paymentRef || undefined });
    if (remoteEstado && paymentRef) {
      return {
        ok: true,
        data: {
          estado: remoteEstado,
          referencia: paymentRef,
          payment: d.payment,
          licenseStatus: d.licenseStatus,
        },
      };
    }
  }

  return { ok: true, data: { estado: null, payment: null } };
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
  clearPaymentCycleReminderNotifications();
  clearNotificationsByTitle(PENDING_NOTIFICATION_TITLE);
}

/** Quita avisos previos del ciclo de pago; deja solo la notificación de pendiente de aprobación. */
function clearNotificationsBeforePaymentPending() {
  clearPaymentCycleReminderNotifications();
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
    message: PAYMENT_APPROVAL_FULL_MESSAGE,
    created_by: 'Plataforma central',
    level: 'success',
    expires_at: paymentApprovalNoticeExpiresAt(),
  });
}

function notifyPaymentRejected(motivo) {
  clearPaymentCycleReminderNotifications();
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
  const montoRaw = pp.monto ?? pago.monto_comprobante ?? null;
  const monto = montoRaw != null && Number.isFinite(Number(montoRaw)) ? Number(montoRaw) : null;

  archiveApprovedPaymentAndPrepareNextCycle(pago, {
    now,
    ref,
    url,
    monto,
    centralPaymentId,
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
      message: PAYMENT_APPROVAL_FULL_MESSAGE,
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

  const prevPp = pago.platform_payment || {};
  pago.platform_payment = { ...prevPp, historial: historialSinPendienteDuplicado(pago, ref) };
  pago.platform_payment = {
    ...pago.platform_payment,
    estado: PAYMENT_STATUSES.PENDING,
    referencia: ref,
    monto: monto != null && Number.isFinite(Number(monto)) ? Number(monto) : null,
    central_payment_id: null,
    submitted_at: now,
    resolved_at: null,
    comprobante_oculto_ui: false,
    approval_notice_until: null,
    historial: appendHistorial(pago, {
      fecha: now.slice(0, 10),
      voucher: url,
      comprobante_pago_url: url,
      estado: PAYMENT_STATUSES.PENDING,
      referencia: ref,
      monto: monto != null && Number.isFinite(Number(monto)) ? Number(monto) : null,
      aprobacion_at: null,
    }),
  };
  writePagoUso(pago);
  notifyPaymentPending();

  await pushComprobanteToCentral({ comprobanteUrl: url, referencia: ref });

  try {
    const {
      releasePaymentBlockOnComprobanteSubmit,
      evaluateAutomaticBillingRules,
    } = require('../masterAdminService');
    releasePaymentBlockOnComprobanteSubmit();
    evaluateAutomaticBillingRules();
  } catch (_) {
    /* opcional */
  }

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
  const noticeUntil = pp.approval_notice_until ? new Date(pp.approval_notice_until).getTime() : NaN;
  const estado = normalizePaymentEstado(pp.estado);
  const legacyApproved = estado === PAYMENT_STATUSES.APPROVED;
  const noticeActive = Number.isFinite(noticeUntil) && Date.now() < noticeUntil;
  if (!legacyApproved && !noticeActive) return;
  if (legacyApproved && isWithinPaymentApprovalNoticeWindow(pp.resolved_at)) return;
  if (noticeActive) return;
  if (pp.approval_notice_until) {
    pp.approval_notice_until = null;
    pago.platform_payment = pp;
    writePagoUso(pago);
  }
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
  const localRef = String(pp.referencia || '').trim();
  if (!localRef || estado !== PAYMENT_STATUSES.PENDING) return;

  pollInFlight = true;
  try {
    const result = await fetchCentralStatus(localRef);
    if (!result.ok || !result.data) return;

    const remoteRef = String(
      result.data.payment?.referencia || result.data.referencia || '',
    ).trim();
    if (!remoteRef || remoteRef !== localRef) return;

    const remoteEstado = normalizePaymentEstado(
      result.data.estado || result.data.payment?.estado,
    );
    if (!remoteEstado) return;

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

function isApprovalNoticeActive(pp = {}) {
  const until = pp.approval_notice_until ? new Date(pp.approval_notice_until).getTime() : NaN;
  if (Number.isFinite(until) && Date.now() < until) return true;
  const estado = normalizePaymentEstado(pp.estado);
  return estado === PAYMENT_STATUSES.APPROVED && isWithinPaymentApprovalNoticeWindow(pp.resolved_at);
}

function getPublicPlatformPaymentState() {
  syncExpiredPaymentApprovalNotices();
  const pago = readPagoUso();
  const pp = pago.platform_payment || {};
  const estado = normalizePaymentEstado(pp.estado);
  const centralOn = isCentralSyncConfigured();
  const hasActiveComprobante = Boolean(String(pago.comprobante_pago_url || '').trim());
  const approved = estado === PAYMENT_STATUSES.APPROVED;
  const pending = estado === PAYMENT_STATUSES.PENDING && hasActiveComprobante;
  const rejected = estado === PAYMENT_STATUSES.REJECTED;
  const showApprovalNotice = isApprovalNoticeActive(pp);
  const oculto = hasActiveComprobante && (Boolean(pp.comprobante_oculto_ui) || approved);
  const historial = (Array.isArray(pp.historial) ? pp.historial : []).map(normalizeHistorialEntryForClient);
  const planActivo = showApprovalNotice || isLicensePeriodActive(pago);

  return {
    central_configured: centralOn,
    estado: hasActiveComprobante ? (estado || null) : (centralOn ? null : (planActivo ? 'aprobado' : null)),
    referencia: String(pp.referencia || ''),
    monto: pp.monto ?? pago.monto_comprobante ?? null,
    submitted_at: pp.submitted_at || null,
    resolved_at: pp.resolved_at || pp.last_approval_at || null,
    comprobante_oculto_ui: oculto,
    comprobante_visible_en_panel: hasActiveComprobante && !oculto,
    show_pending_banner: pending,
    show_approved_banner: showApprovalNotice,
    show_rejected_banner: rejected,
    plan_activo: planActivo,
    mensaje_gracias: showApprovalNotice ? PAYMENT_APPROVAL_THANK_YOU : '',
    mensaje_aprobado: showApprovalNotice ? PAYMENT_APPROVAL_BODY : '',
    mensaje_licencia: showApprovalNotice ? 'Licencia actualizada' : '',
    historial,
    historial_count: historial.length,
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

/** Solo admin maestro: elimina una entrada del historial local de comprobantes. */
function deleteHistorialEntry(entryId) {
  const id = String(entryId || '').trim();
  if (!id) {
    return { ok: false, central_user_message: 'Identificador de comprobante inválido.' };
  }
  const pago = readPagoUso();
  const pp = pago.platform_payment || {};
  const hist = Array.isArray(pp.historial) ? pp.historial : [];
  const next = hist.filter((h) => {
    const hid = String(h?.id || '').trim();
    if (hid && hid === id) return false;
    const fallback = `${h?.fecha || ''}|${h?.referencia || ''}|${voucherUrlFromHistorialEntry(h)}`;
    return fallback !== id;
  });
  if (next.length === hist.length) {
    return { ok: false, central_user_message: 'No se encontró el comprobante en el historial.' };
  }
  pago.platform_payment = { ...pp, historial: next };
  writePagoUso(pago);
  return { ok: true, payment: getPublicPlatformPaymentState() };
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
  try {
    const { evaluateAutomaticBillingRules } = require('../masterAdminService');
    evaluateAutomaticBillingRules();
  } catch (_) {
    /* Tras marcar pendiente: no recrear aviso de vencimiento ni subir comprobante. */
  }
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
  deleteHistorialEntry,
  confirmLicenseFromSaas,
  readPagoUso,
  writePagoUso,
};
