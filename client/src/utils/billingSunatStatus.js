/** Estados SUNAT visibles en Informes, Caja y reintentos. */

export const BILLING_STATUS_LABEL = {
  local: 'Nota local',
  pending: 'Pendiente de envío',
  sent: 'Enviado a SUNAT',
  accepted: 'SUNAT aceptó (correcto)',
  error: 'Error / SUNAT rechazó',
};

export function billingStatusLabel(status) {
  const key = String(status || '').trim().toLowerCase();
  return BILLING_STATUS_LABEL[key] || (key || 'Sin estado');
}

export function billingStatusClass(status) {
  const key = String(status || '').trim().toLowerCase();
  if (key === 'accepted') return 'bg-emerald-100 text-emerald-700';
  if (key === 'error') return 'bg-red-100 text-red-700';
  if (key === 'local') return 'bg-[var(--ui-surface-2)] text-[var(--ui-body-text)]';
  if (key === 'sent') return 'bg-sky-100 text-sky-800';
  return 'bg-amber-100 text-amber-700';
}

export function billingFileIsOpenable(url) {
  const s = String(url || '').trim();
  if (!s) return false;
  return /^https?:\/\//i.test(s) || s.startsWith('/uploads/');
}
