/** Eventos permitidos hacia la plataforma central (no operativos del restaurante). */
const SYNC_EVENT_TYPES = Object.freeze({
  PAYMENT: 'payment',
  VOUCHER: 'voucher',
  PLAN_RENEWAL: 'plan_renewal',
  PLAN_STATUS: 'plan_status',
  LICENSE_ACTIVITY: 'license_activity',
  USER_LOGIN: 'user_login',
  USER_ACTIVE: 'user_active',
  CLIENT_PROFILE: 'client_profile',
});

const PAYMENT_STATUSES = Object.freeze({
  PENDING: 'pendiente',
  APPROVED: 'aprobado',
  REJECTED: 'rechazado',
});

/** Acepta español o inglés legacy y devuelve pendiente | aprobado | rechazado | null */
function normalizePaymentEstado(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (!v) return null;
  if (['pendiente', 'pending', 'p'].includes(v)) return PAYMENT_STATUSES.PENDING;
  if (['aprobado', 'approved', 'a'].includes(v)) return PAYMENT_STATUSES.APPROVED;
  if (['rechazado', 'rejected', 'r'].includes(v)) return PAYMENT_STATUSES.REJECTED;
  return null;
}

const LICENSE_STATUSES = Object.freeze({
  ACTIVE: 'active',
  GRACE: 'grace',
  EXPIRED: 'expired',
  SUSPENDED: 'suspended',
});

const SERVICE_PLANS = Object.freeze({
  BASICO: 'basico',
  INTERMEDIO: 'intermedio',
  PROFESIONAL: 'profesional',
});

module.exports = {
  SYNC_EVENT_TYPES,
  PAYMENT_STATUSES,
  normalizePaymentEstado,
  LICENSE_STATUSES,
  SERVICE_PLANS,
};
