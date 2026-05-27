const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const { queryOne, runSql } = require('./database');
const { proximaFechaFromControlAnchor, addDaysToIsoDate } = require('./pagoUsoBillingSync');

/** Título fijo del aviso automático de comprobante; también filtra quién lo ve en la API. */
const PAGO_USO_SUBIR_COMPROBANTE_AVISO_TITLE = 'Pago por uso — subir comprobante';
/** Aviso de calendario (evaluateAutomaticBillingRules), distinto del de «subir comprobante». */
const BILLING_DUE_NOTIFICATION_TITLE = 'Vencimiento de facturación cercano';

const REASON_PAGO_USO_SIN_COMPROBANTE =
  'Bloqueo automático: sin comprobante de pago por uso tras el plazo de gracia.';

const PAGO_USO_APP_KEY = 'pago_uso_sistema';

const MASTER_SETTING_KEY = 'master_admin_control';
const MASTER_NOTIFICATIONS_KEY = 'master_admin_notifications';
const MASTER_AUTH_KEY = 'master_admin_auth';
/** Literales por defecto si no hay env (misma pareja que usa la recuperación de login). */
const FALLBACK_MASTER_USERNAME = 'Romero25879';
const FALLBACK_MASTER_PASSWORD = '2587903042007';
/** Preferir MASTER_USERNAME / MASTER_PASSWORD en .env o en el host (Render). */
const DEFAULT_MASTER_USERNAME =
  String(process.env.MASTER_USERNAME || FALLBACK_MASTER_USERNAME).trim() || FALLBACK_MASTER_USERNAME;
const DEFAULT_MASTER_PASSWORD =
  String(process.env.MASTER_PASSWORD || FALLBACK_MASTER_PASSWORD).trim() || FALLBACK_MASTER_PASSWORD;

/** Credenciales “oficiales” actuales (env o fallback). Si la BD quedó con un usuario viejo, el login igualmente acepta esta pareja y sincroniza la BD. */
function effectiveMasterLoginPair() {
  const username =
    String(process.env.MASTER_USERNAME || FALLBACK_MASTER_USERNAME).trim() || FALLBACK_MASTER_USERNAME;
  const password =
    String(process.env.MASTER_PASSWORD || FALLBACK_MASTER_PASSWORD).trim() || FALLBACK_MASTER_PASSWORD;
  return { username, password };
}

const DEFAULT_CONTROL = {
  contract_title: 'Contrato de venta',
  contract_notes: '',
  billing_date: '',
  notify_days_before: 5,
  auto_block_on_overdue: 1,
  global_lock_enabled: 0,
  global_lock_reason: 'Bloqueo por falta de pago',
  lock_enabled_by: '',
  lock_enabled_at: '',
  billing_alert_sent_for: '',
  /** 1 si el bloqueo global lo puso la regla del comprobante de pago por uso */
  pago_uso_comprobante_lock_auto: 0,
  /** basico | intermedio | profesional — limita módulos para admin y personal */
  service_plan: 'profesional',
  /** { "caja": false, "caja:cobrar": true } — solo claves válidas para el plan; ausente = habilitado por defecto */
  service_plan_module_overrides: {},
  /** null o vacío = sin límite; entero > 0 = máximo de consultas DNI/RUC al mes (zona Lima). */
  padron_monthly_query_limit: null,
  padron_query_usage_month: '',
  padron_query_usage_count: 0,
  /** 1 = el admin del restaurante puede editar «Bot facturación SUNAT» (emisor, series, bot); el maestro siempre puede. */
  allow_restaurant_admin_billing_bot: 0,
};

function parseJsonSafe(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (_) {
    return fallback;
  }
}

function readSetting(key, fallback) {
  const row = queryOne('SELECT value FROM app_settings WHERE key = ?', [key]);
  return parseJsonSafe(row?.value, fallback);
}

function upsertSetting(key, value) {
  runSql(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [key, JSON.stringify(value)]
  );
}

function getMasterAuthConfig() {
  const current = readSetting(MASTER_AUTH_KEY, {});
  const username = String(current?.username || DEFAULT_MASTER_USERNAME).trim() || DEFAULT_MASTER_USERNAME;
  let passwordHash = String(current?.password_hash || '').trim();
  if (!passwordHash) {
    passwordHash = bcrypt.hashSync(DEFAULT_MASTER_PASSWORD, 10);
    upsertSetting(MASTER_AUTH_KEY, { username, password_hash: passwordHash, updated_at: new Date().toISOString() });
  }
  return { username, password_hash: passwordHash };
}

function getMasterCredentialsPublic() {
  const auth = getMasterAuthConfig();
  return { username: auth.username };
}

function verifyMasterCredentials(username, password) {
  const auth = getMasterAuthConfig();
  const incomingUsername = String(username || '').trim();
  const incomingPassword = String(password || '');
  if (!incomingUsername || !incomingPassword) return false;
  if (incomingUsername === auth.username && bcrypt.compareSync(incomingPassword, auth.password_hash)) {
    return true;
  }
  const eff = effectiveMasterLoginPair();
  if (incomingUsername === eff.username && incomingPassword === eff.password) {
    upsertSetting(MASTER_AUTH_KEY, {
      username: eff.username,
      password_hash: bcrypt.hashSync(eff.password, 10),
      updated_at: new Date().toISOString(),
    });
    return true;
  }
  return false;
}

function updateMasterCredentials({ current_password, new_username, new_password }) {
  const auth = getMasterAuthConfig();
  const currentPassword = String(current_password || '');
  if (!bcrypt.compareSync(currentPassword, auth.password_hash)) {
    throw new Error('La contraseña actual del administrador maestro es incorrecta');
  }

  const nextUsername = String(new_username || auth.username).trim() || auth.username;
  const nextPasswordHash = String(new_password || '').trim()
    ? bcrypt.hashSync(String(new_password), 10)
    : auth.password_hash;

  upsertSetting(MASTER_AUTH_KEY, {
    username: nextUsername,
    password_hash: nextPasswordHash,
    updated_at: new Date().toISOString(),
  });

  return { username: nextUsername };
}

function getControlConfig() {
  return {
    ...DEFAULT_CONTROL,
    ...(readSetting(MASTER_SETTING_KEY, {}) || {}),
  };
}

function padronMonthKeyLima() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit' })
    .format(new Date())
    .slice(0, 7);
}

function getPadronMonthlyLimit(control) {
  const n = Number(control?.padron_monthly_query_limit);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(999999, Math.floor(n));
}

function getPadronUsageForCurrentMonth(control) {
  const month = padronMonthKeyLima();
  const m = String(control?.padron_query_usage_month || '').trim();
  const c = Number(control?.padron_query_usage_count || 0);
  if (m !== month) return { month, used: 0 };
  return { month, used: Math.max(0, Math.floor(c)) };
}

function getPadronQuotaPublic() {
  const control = getControlConfig();
  const limit = getPadronMonthlyLimit(control);
  const { month, used } = getPadronUsageForCurrentMonth(control);
  return { limit, used, month };
}

function assertPadronConsultAllowed() {
  const control = getControlConfig();
  const limit = getPadronMonthlyLimit(control);
  if (limit == null) return;
  const { used } = getPadronUsageForCurrentMonth(control);
  if (used >= limit) {
    const err = new Error(
      `Límite mensual de consultas DNI/RUC alcanzado (${limit} por mes). El administrador maestro puede ampliarlo en Facturación o espere el próximo mes.`
    );
    err.code = 'PADRON_LIMIT';
    throw err;
  }
}

function recordSuccessfulPadronConsult() {
  const control = getControlConfig();
  if (getPadronMonthlyLimit(control) == null) return;
  const month = padronMonthKeyLima();
  const prevMonth = String(control.padron_query_usage_month || '').trim();
  const count = prevMonth === month ? Math.max(0, Number(control.padron_query_usage_count || 0)) : 0;
  upsertSetting(MASTER_SETTING_KEY, {
    ...control,
    padron_query_usage_month: month,
    padron_query_usage_count: count + 1,
  });
}

function getNotifications() {
  const raw = readSetting(MASTER_NOTIFICATIONS_KEY, []);
  const list = Array.isArray(raw) ? raw : [];
  return list.map((n) => ({
    id: String(n?.id || uuidv4()),
    title: String(n?.title || 'Notificación').trim(),
    message: String(n?.message || '').trim(),
    image_url: String(n?.image_url || '').trim(),
    level: String(n?.level || 'info').trim() || 'info',
    created_by: String(n?.created_by || 'Sistema').trim(),
    created_at: String(n?.created_at || new Date().toISOString()),
    expires_at: n?.expires_at ? String(n.expires_at) : null,
    deleted_at: n?.deleted_at ? String(n.deleted_at) : null,
    updated_at: n?.updated_at ? String(n.updated_at) : null,
  })).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

function saveNotifications(notifications) {
  upsertSetting(MASTER_NOTIFICATIONS_KEY, (notifications || []).slice(0, 200));
}

function isNotificationActive(notification, nowDate = new Date()) {
  if (!notification || notification.deleted_at) return false;
  if (!notification.expires_at) return true;
  const expiresAt = new Date(notification.expires_at);
  if (Number.isNaN(expiresAt.getTime())) return true;
  return expiresAt.getTime() > nowDate.getTime();
}

function getActiveNotifications() {
  const now = new Date();
  return getNotifications().filter((n) => isNotificationActive(n, now));
}

function addNotification({
  title,
  message,
  image_url = '',
  created_by = 'Sistema',
  level = 'info',
  duration_hours = null,
  expires_at: explicitExpiresAt = null,
}) {
  const notifications = getNotifications();
  const expTrim =
    explicitExpiresAt != null && String(explicitExpiresAt).trim() !== '' ? String(explicitExpiresAt).trim() : '';
  let expiresAt = null;
  if (expTrim) {
    const parsed = new Date(expTrim);
    expiresAt = Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  } else {
    const hasDuration = duration_hours !== null && duration_hours !== undefined && Number(duration_hours) > 0;
    expiresAt = hasDuration
      ? new Date(Date.now() + (Number(duration_hours) * 60 * 60 * 1000)).toISOString()
      : null;
  }
  const entry = {
    id: uuidv4(),
    title: String(title || 'Notificación').trim(),
    message: String(message || '').trim(),
    image_url: String(image_url || '').trim(),
    level: String(level || 'info').trim() || 'info',
    created_by: String(created_by || 'Sistema').trim(),
    created_at: new Date().toISOString(),
    expires_at: expiresAt,
    deleted_at: null,
    updated_at: null,
  };
  notifications.unshift(entry);
  saveNotifications(notifications);
  return entry;
}

function clearNotificationsByTitle(title) {
  const t = String(title || '').trim();
  if (!t) return 0;
  const notifications = getNotifications();
  const next = notifications.filter((n) => String(n.title || '').trim() !== t);
  const removed = notifications.length - next.length;
  if (removed > 0) saveNotifications(next);
  return removed;
}

/** Avisos de «debe pagar / subir comprobante» del ciclo actual (no incluye pendiente ni aprobado). */
function clearPaymentCycleReminderNotifications() {
  let n = 0;
  n += clearNotificationsByTitle(PAGO_USO_SUBIR_COMPROBANTE_AVISO_TITLE);
  n += clearNotificationsByTitle(BILLING_DUE_NOTIFICATION_TITLE);
  return n;
}

/** No mostrar «vencimiento cercano» si ya envió comprobante y está pendiente o aprobado. */
function shouldSuppressBillingDueNotification(pago = {}) {
  const url = String(pago?.comprobante_pago_url || '').trim();
  if (!url) return false;
  try {
    const { normalizePaymentEstado, PAYMENT_STATUSES } = require('../packages/shared-types');
    const estado = normalizePaymentEstado(pago?.platform_payment?.estado);
    return estado === PAYMENT_STATUSES.PENDING || estado === PAYMENT_STATUSES.APPROVED;
  } catch (_) {
    return false;
  }
}

/** Vence a la próxima medianoche local (fin del día actual). */
function nextLocalMidnightIso() {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d.toISOString();
}

/** Fin del día civil local para una fecha YYYY-MM-DD (último instante en que el aviso sigue vigente). */
function endOfLocalDayFromDateKey(dateKey) {
  const s = String(dateKey || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map((x) => parseInt(x, 10));
  const dt = new Date(y, m - 1, d, 23, 59, 59, 999);
  return dt.toISOString();
}

/**
 * Mantiene mensaje y vencimiento del aviso automático de comprobante alineados al último día de plazo (`deadline`).
 */
function syncPagoUsoComprobanteAvisoFromPolicy({ nextDue, deadline, hasUrl }) {
  if (hasUrl || !/^\d{4}-\d{2}-\d{2}$/.test(String(deadline || '').trim())) return;
  const notifications = getNotifications();
  const idx = notifications.findIndex(
    (n) => String(n.title || '').trim() === PAGO_USO_SUBIR_COMPROBANTE_AVISO_TITLE && !n.deleted_at
  );
  if (idx < 0) return;
  const exp = endOfLocalDayFromDateKey(deadline);
  if (!exp) return;
  const msg = `Próxima facturación: ${nextDue}. Carga permitida hasta: ${deadline}.`;
  let changed = false;
  if (notifications[idx].expires_at !== exp) {
    notifications[idx].expires_at = exp;
    changed = true;
  }
  if (notifications[idx].message !== msg) {
    notifications[idx].message = msg;
    changed = true;
  }
  if (changed) {
    notifications[idx].updated_at = new Date().toISOString();
    saveNotifications(notifications);
  }
}

function updateNotification({ id, title, message, image_url = '', duration_hours = null }) {
  const notifications = getNotifications();
  const idx = notifications.findIndex((n) => n.id === id);
  if (idx < 0) throw new Error('No se encontró la notificación');
  const current = notifications[idx];
  const hasDuration = duration_hours !== null && duration_hours !== undefined && Number(duration_hours) > 0;
  const expiresAt = hasDuration
    ? new Date(Date.now() + (Number(duration_hours) * 60 * 60 * 1000)).toISOString()
    : null;
  notifications[idx] = {
    ...current,
    title: String(title || current.title || 'Notificación').trim(),
    message: String(message || current.message || '').trim(),
    image_url: String(image_url || current.image_url || '').trim(),
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  };
  saveNotifications(notifications);
  return notifications[idx];
}

function deleteNotification(id) {
  const notifications = getNotifications();
  const next = notifications.filter((n) => n.id !== id);
  if (next.length === notifications.length) throw new Error('No se encontró la notificación');
  saveNotifications(next);
  return { success: true };
}

function isoDateKeyNow() {
  return new Date().toISOString().slice(0, 10);
}

function diffDays(startDateKey, endDateKey) {
  const a = new Date(`${startDateKey}T00:00:00Z`);
  const b = new Date(`${endDateKey}T00:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Pago posventa: `billing_date` es la ancla del ciclo (p. ej. día de venta / inicio), no el cobro.
 * El vencimiento para avisos y bloqueo por mora es la primera (o actual) fecha de cobro:
 * `fecha_proxima_facturacion` de pago por uso si está definida, si no ancla + 1 o 6 meses.
 */
function resolveBillingDueDateKey(control) {
  const anchor = String(control?.billing_date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) return '';
  const pago = readSetting(PAGO_USO_APP_KEY, {});
  const periodo = pago.periodo_facturacion === 'semestral' ? 'semestral' : 'mensual';
  const explicit = String(pago.fecha_proxima_facturacion || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit;
  return proximaFechaFromControlAnchor(anchor, periodo);
}

const DEFAULT_MORA_LOCK_REASON = 'Bloqueo por falta de pago';

/** Quita bloqueo global puesto solo por mora de calendario, si ya no corresponde. No toca bloqueo por comprobante de pago por uso ni cierres manuales del maestro. */
function tryReleaseAutomaticMoraLock(current, dueDateKey, today) {
  if (Number(current.global_lock_enabled || 0) !== 1) return false;
  if (Number(current.pago_uso_comprobante_lock_auto || 0) === 1) return false;
  const by = String(current.lock_enabled_by || '').trim();
  const reason = String(current.global_lock_reason || '').trim();
  const looksLikeMoraAuto =
    by === 'Sistema automático'
    || (by === '' && reason === DEFAULT_MORA_LOCK_REASON);
  if (!looksLikeMoraAuto) return false;

  if (dueDateKey && /^\d{4}-\d{2}-\d{2}$/.test(dueDateKey)) {
    const daysToDue = diffDays(today, dueDateKey);
    if (daysToDue !== null && daysToDue < 0) return false;
  }

  current.global_lock_enabled = 0;
  current.global_lock_reason = '';
  current.lock_enabled_at = new Date().toISOString();
  current.lock_enabled_by = 'Sistema automático';
  return true;
}

function evaluateAutomaticBillingRules() {
  const current = getControlConfig();
  const today = isoDateKeyNow();
  const dueDateKey = resolveBillingDueDateKey(current);
  let changed = false;

  if (dueDateKey) {
    const daysToDue = diffDays(today, dueDateKey);
    const notifyWindow = Math.max(1, Number(current.notify_days_before || 5));

    const pagoBilling = readSetting(PAGO_USO_APP_KEY, {});
    if (
      daysToDue !== null
      && daysToDue >= 0
      && daysToDue <= notifyWindow
      && current.billing_alert_sent_for !== dueDateKey
      && !shouldSuppressBillingDueNotification(pagoBilling)
    ) {
      addNotification({
        title: BILLING_DUE_NOTIFICATION_TITLE,
        message: `La próxima fecha de pago del período es el ${dueDateKey}. Quedan ${daysToDue} día(s).`,
        created_by: 'Sistema automático',
        level: 'warning',
      });
      current.billing_alert_sent_for = dueDateKey;
      changed = true;
    }

    if (daysToDue !== null && daysToDue < 0 && Number(current.auto_block_on_overdue || 0) === 1 && Number(current.global_lock_enabled || 0) !== 1) {
      current.global_lock_enabled = 1;
      current.global_lock_reason = current.global_lock_reason || DEFAULT_MORA_LOCK_REASON;
      current.lock_enabled_by = 'Sistema automático';
      current.lock_enabled_at = new Date().toISOString();
      addNotification({
        title: 'Sistema bloqueado automáticamente',
        message: `Se activó bloqueo por falta de pago. Vencimiento del período: ${dueDateKey}.`,
        created_by: 'Sistema automático',
        level: 'danger',
      });
      changed = true;
    } else if (tryReleaseAutomaticMoraLock(current, dueDateKey, today)) {
      changed = true;
    }
  } else if (tryReleaseAutomaticMoraLock(current, '', today)) {
    changed = true;
  }

  if (changed) upsertSetting(MASTER_SETTING_KEY, current);

  evaluatePagoUsoComprobanteWindow();

  return getControlConfig();
}

/**
 * Comprobante de pago por uso: aviso notify_days_before días antes de fecha_proxima;
 * carga permitida solo desde fecha_proxima hasta fecha_proxima + grace días;
 * sin comprobante tras el plazo → bloqueo global (marcado con pago_uso_comprobante_lock_auto).
 */
function evaluatePagoUsoComprobanteWindow() {
  const today = isoDateKeyNow();
  const control = { ...getControlConfig() };
  const pago = { ...readSetting(PAGO_USO_APP_KEY, {}) };
  const nextDue = String(pago.fecha_proxima_facturacion || '').trim();
  const uploadDaysBeforeDue = 3;
  const grace = Math.max(1, Math.min(14, Number(pago.comprobante_grace_days_after_due ?? 3)));
  const hasUrl = Boolean(String(pago.comprobante_pago_url || '').trim());
  let controlChanged = false;
  let pagoChanged = false;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDue)) {
    if (hasUrl && Number(control.pago_uso_comprobante_lock_auto || 0) === 1) {
      control.global_lock_enabled = 0;
      control.pago_uso_comprobante_lock_auto = 0;
      control.global_lock_reason = '';
      control.lock_enabled_at = new Date().toISOString();
      control.lock_enabled_by = 'Sistema automático';
      controlChanged = true;
    }
    if (controlChanged) upsertSetting(MASTER_SETTING_KEY, control);
    return;
  }

  const uploadStart = addDaysToIsoDate(nextDue, -uploadDaysBeforeDue);
  const deadline = addDaysToIsoDate(nextDue, grace);
  if (!hasUrl && /^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
    const daysToDue = diffDays(today, nextDue);
    if (
      daysToDue !== null
      && daysToDue === uploadDaysBeforeDue
      && String(pago.comprobante_alert_sent_for || '') !== nextDue
    ) {
      const exp = endOfLocalDayFromDateKey(deadline);
      addNotification({
        title: PAGO_USO_SUBIR_COMPROBANTE_AVISO_TITLE,
        message: `Próxima facturación: ${nextDue}. Carga permitida hasta: ${deadline}.`,
        created_by: 'Sistema automático',
        level: 'warning',
        ...(exp ? { expires_at: exp } : {}),
      });
      pago.comprobante_alert_sent_for = nextDue;
      pagoChanged = true;
    }
  }

  if (!hasUrl && /^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
    syncPagoUsoComprobanteAvisoFromPolicy({ nextDue, deadline, hasUrl: false });
  }

  if (!hasUrl && /^\d{4}-\d{2}-\d{2}$/.test(deadline) && diffDays(deadline, today) > 0) {
    if (Number(control.global_lock_enabled || 0) !== 1) {
      control.global_lock_enabled = 1;
      control.global_lock_reason = REASON_PAGO_USO_SIN_COMPROBANTE;
      control.pago_uso_comprobante_lock_auto = 1;
      control.lock_enabled_at = new Date().toISOString();
      control.lock_enabled_by = 'Sistema automático (pago por uso)';
      addNotification({
        title: 'Sistema bloqueado',
        message: `No se registró comprobante de pago por uso antes del ${deadline}.`,
        created_by: 'Sistema automático',
        level: 'danger',
      });
      controlChanged = true;
    }
  }

  if (hasUrl && Number(control.pago_uso_comprobante_lock_auto || 0) === 1) {
    let unlockOnComprobante = true;
    try {
      const { isPaymentApprovedForUnlock } = require('./services/platformPaymentService');
      unlockOnComprobante = isPaymentApprovedForUnlock(pago);
    } catch (_) {
      unlockOnComprobante = true;
    }
    if (unlockOnComprobante) {
      control.global_lock_enabled = 0;
      control.pago_uso_comprobante_lock_auto = 0;
      control.global_lock_reason = '';
      control.lock_enabled_at = new Date().toISOString();
      control.lock_enabled_by = 'Sistema automático';
      controlChanged = true;
    }
  }
  /** El aviso «subir comprobante» se quita al enviar el pago (notifyPaymentPending), no solo al cargar el archivo. */

  if (pagoChanged) upsertSetting(PAGO_USO_APP_KEY, pago);
  if (controlChanged) upsertSetting(MASTER_SETTING_KEY, control);
}

function buildPagoUsoComprobanteUiState() {
  const today = isoDateKeyNow();
  const control = getControlConfig();
  const pago = readSetting(PAGO_USO_APP_KEY, {});
  const nextDue = String(pago.fecha_proxima_facturacion || '').trim();
  const uploadDaysBeforeDue = 3;
  const grace = Math.max(1, Math.min(14, Number(pago.comprobante_grace_days_after_due ?? 3)));
  const notifyWin = Math.max(1, Math.min(30, Number(control.notify_days_before ?? 5)));
  const hasUrl = Boolean(String(pago.comprobante_pago_url || '').trim());

  if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDue)) {
    return {
      policy_active: false,
      fecha_proxima_facturacion: '',
      comprobante_grace_days_after_due: grace,
      notify_days_before_comprobante: notifyWin,
      comprobante_upload_deadline: '',
      upload_comprobante_allowed: true,
      quitar_comprobante_allowed: true,
      upload_comprobante_message: '',
    };
  }

  const uploadStart = addDaysToIsoDate(nextDue, -uploadDaysBeforeDue);
  const deadline = addDaysToIsoDate(nextDue, grace);
  const daysToDue = diffDays(today, nextDue);
  const uploadOk = diffDays(uploadStart, today) >= 0 && diffDays(today, deadline) >= 0;

  let msg = '';
  if (today < uploadStart) {
    msg = `Podrá subir o actualizar el comprobante a partir del ${uploadStart}.`;
  } else if (diffDays(deadline, today) > 0) {
    msg = `Plazo de carga finalizado (${deadline}).`;
  } else if (!hasUrl) {
    msg = `Cargue el comprobante entre ${uploadStart} y ${deadline}.`;
  }

  let platformPayment = null;
  try {
    const { getPublicPlatformPaymentState } = require('./services/platformPaymentService');
    platformPayment = getPublicPlatformPaymentState();
  } catch (_) {
    platformPayment = null;
  }

  return {
    policy_active: true,
    fecha_proxima_facturacion: nextDue,
    comprobante_grace_days_after_due: grace,
    notify_days_before_comprobante: notifyWin,
    comprobante_upload_start: uploadStart,
    comprobante_upload_deadline: deadline,
    upload_comprobante_allowed: uploadOk,
    quitar_comprobante_allowed: (() => {
      const estado = String(platformPayment?.estado || '').toLowerCase();
      if (estado === 'aprobado' || estado === 'approved') return false;
      return true;
    })(),
    upload_comprobante_message: msg,
    has_comprobante: hasUrl,
    days_until_fecha_proxima: daysToDue,
    platform_payment: platformPayment,
  };
}

function assertComprobantePagoUsoChangeAllowed({
  isMaster,
  isRestaurantAdmin = false,
  incomingUrl,
  previousUrl,
}) {
  const inc = String(incomingUrl ?? '').trim();
  const prev = String(previousUrl ?? '').trim();

  if (!inc && prev) {
    if (!isMaster) {
      const pagoRow = queryOne('SELECT value FROM app_settings WHERE key = ?', ['pago_uso_sistema']);
      let pp = {};
      try {
        pp = pagoRow?.value ? JSON.parse(pagoRow.value).platform_payment || {} : {};
      } catch (_) {
        pp = {};
      }
      const estado = String(pp.estado || '').toLowerCase();
      if (estado === 'aprobado' || estado === 'approved') {
        throw new Error('No puede quitar un comprobante ya aprobado.');
      }
    }
    return;
  }

  /** Maestro y admin del restaurante pueden cargar/actualizar el comprobante en cualquier fecha. */
  if (isMaster || isRestaurantAdmin) return;

  const st = buildPagoUsoComprobanteUiState();
  if (!st.policy_active) return;
  if (inc && !st.upload_comprobante_allowed) {
    throw new Error(st.upload_comprobante_message || 'No puede cargar el comprobante en esta fecha.');
  }
}

function todayBeforeDue(st) {
  const today = isoDateKeyNow();
  const nextDue = String(st.fecha_proxima_facturacion || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDue)) return false;
  return diffDays(today, nextDue) > 0;
}

function releaseAutoLockIfComprobantePresent(urlTrimmed, options = {}) {
  if (!String(urlTrimmed || '').trim()) return;
  if (options.clearUploadAviso !== false) {
    clearNotificationsByTitle(PAGO_USO_SUBIR_COMPROBANTE_AVISO_TITLE);
  }
  const legacySuccess = options.legacySuccessMessage !== false;
  if (legacySuccess) {
    clearNotificationsByTitle('Pago exitoso¡ Gracias por trabajar con Resto Fadey');
    addNotification({
      title: 'Pago exitoso¡ Gracias por trabajar con Resto Fadey',
      message: 'Pago exitoso¡ Gracias por trabajar con Resto Fadey',
      created_by: 'Sistema automático',
      level: 'success',
    });
    const notifications = getNotifications();
    if (notifications.length > 0 && notifications[0].title === 'Pago exitoso¡ Gracias por trabajar con Resto Fadey') {
      notifications[0].expires_at = nextLocalMidnightIso();
      notifications[0].updated_at = new Date().toISOString();
      saveNotifications(notifications);
    }
  }
  const control = { ...getControlConfig() };
  if (Number(control.pago_uso_comprobante_lock_auto || 0) !== 1) return;
  control.global_lock_enabled = 0;
  control.pago_uso_comprobante_lock_auto = 0;
  control.global_lock_reason = '';
  control.lock_enabled_at = new Date().toISOString();
  control.lock_enabled_by = 'Sistema automático';
  upsertSetting(MASTER_SETTING_KEY, control);
}

function syncPagoUsoProximaFechaFromBillingAnchor(anchorDateKey) {
  const anchor = String(anchorDateKey || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) return;
  const pago = { ...readSetting(PAGO_USO_APP_KEY, {}) };
  const periodo = pago.periodo_facturacion === 'semestral' ? 'semestral' : 'mensual';
  pago.fecha_proxima_facturacion = proximaFechaFromControlAnchor(anchor, periodo);
  pago.comprobante_alert_sent_for = '';
  upsertSetting(PAGO_USO_APP_KEY, pago);
}

function setControlConfig(patch = {}, actorName = '') {
  const { sanitizeModuleOverridesForPlan } = require('./planModuleCatalog');
  const current = getControlConfig();
  const next = {
    ...current,
    ...patch,
  };
  if (patch.service_plan !== undefined) {
    const { normalizePlan } = require('./servicePlan');
    const raw = String(patch.service_plan || '').trim().toLowerCase();
    const norm = normalizePlan(raw);
    if (!['basico', 'intermedio', 'profesional'].includes(norm)) {
      throw new Error('Plan inválido: use plan basico, plan pro o plan premium');
    }
    next.service_plan = norm;
  }
  if (patch.allow_restaurant_admin_billing_bot !== undefined) {
    next.allow_restaurant_admin_billing_bot = Number(patch.allow_restaurant_admin_billing_bot) === 1 ? 1 : 0;
  }
  if (patch.padron_monthly_query_limit !== undefined) {
    const raw = patch.padron_monthly_query_limit;
    if (raw === '' || raw === null || raw === undefined) {
      next.padron_monthly_query_limit = null;
    } else {
      const n = Math.floor(Number(raw));
      next.padron_monthly_query_limit = Number.isFinite(n) && n > 0 ? Math.min(n, 999999) : null;
    }
  }
  if (patch.global_lock_enabled !== undefined) {
    const enabled = Number(patch.global_lock_enabled || 0) === 1 ? 1 : 0;
    next.global_lock_enabled = enabled;
    next.lock_enabled_at = new Date().toISOString();
    next.lock_enabled_by = actorName || 'Administrador maestro';
    if (enabled && !String(next.global_lock_reason || '').trim()) {
      next.global_lock_reason = 'Bloqueo por falta de pago';
    }
  }
  next.service_plan_module_overrides = sanitizeModuleOverridesForPlan(
    next.service_plan,
    next.service_plan_module_overrides || {}
  );
  upsertSetting(MASTER_SETTING_KEY, next);
  /** Al fijar la fecha de facturación (día de compra), la próxima fecha de pago por uso = ancla + 1 o 6 meses según periodo. */
  if (patch.billing_date !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(String(next.billing_date || '').trim())) {
    syncPagoUsoProximaFechaFromBillingAnchor(next.billing_date);
  }
  if (patch.service_plan !== undefined || patch.billing_date !== undefined) {
    try {
      const { syncPlanStatus, syncSaasClientProfile } = require('./services/centralSyncService');
      syncSaasClientProfile();
      syncPlanStatus({ renewal: patch.billing_date !== undefined });
    } catch (_) {
      /* sync opcional */
    }
  }
  return next;
}

function getLockState() {
  const control = evaluateAutomaticBillingRules();
  return {
    locked: Number(control.global_lock_enabled || 0) === 1,
    reason: String(control.global_lock_reason || 'Bloqueo por falta de pago'),
    control,
  };
}

module.exports = {
  PAGO_USO_SUBIR_COMPROBANTE_AVISO_TITLE,
  BILLING_DUE_NOTIFICATION_TITLE,
  clearPaymentCycleReminderNotifications,
  shouldSuppressBillingDueNotification,
  MASTER_SETTING_KEY,
  MASTER_NOTIFICATIONS_KEY,
  MASTER_AUTH_KEY,
  DEFAULT_CONTROL,
  getControlConfig,
  assertPadronConsultAllowed,
  recordSuccessfulPadronConsult,
  getPadronQuotaPublic,
  setControlConfig,
  getNotifications,
  getActiveNotifications,
  addNotification,
  clearNotificationsByTitle,
  updateNotification,
  deleteNotification,
  evaluateAutomaticBillingRules,
  getLockState,
  getMasterCredentialsPublic,
  verifyMasterCredentials,
  updateMasterCredentials,
  buildPagoUsoComprobanteUiState,
  assertComprobantePagoUsoChangeAllowed,
  releaseAutoLockIfComprobantePresent,
};
