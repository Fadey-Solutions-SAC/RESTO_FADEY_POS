/**
 * Avisos de reserva en caja: toast descartable + historial en Avisos hasta cerrar sesión.
 * sessionStorage se limpia al logout (y al cerrar la pestaña).
 */

const DISMISSED_KEY = 'rf_reserva_caja_toast_dismissed_v1';
const AVISOS_KEY = 'rf_reserva_caja_avisos_v1';
export const RESERVA_CAJA_AVISOS_EVENT = 'rf-reserva-caja-avisos-changed';

function readJson(key, fallback) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode */
  }
}

function emitChanged() {
  try {
    window.dispatchEvent(new CustomEvent(RESERVA_CAJA_AVISOS_EVENT));
  } catch {
    /* noop */
  }
}

export function reservationCajaToastId(reservationIdOrAlertId) {
  const raw = String(reservationIdOrAlertId || '').trim();
  if (!raw) return '';
  return raw.startsWith('reserva_caja_') ? raw : `reserva_caja_${raw}`;
}

export function getDismissedReservationCajaToastIds() {
  const list = readJson(DISMISSED_KEY, []);
  return new Set((Array.isArray(list) ? list : []).map(String));
}

export function isReservationCajaToastDismissed(alertId) {
  const id = reservationCajaToastId(alertId);
  if (!id) return false;
  return getDismissedReservationCajaToastIds().has(id);
}

export function dismissReservationCajaToast(alertIdOrReservationId) {
  const id = reservationCajaToastId(alertIdOrReservationId);
  if (!id) return;
  const next = getDismissedReservationCajaToastIds();
  next.add(id);
  writeJson(DISMISSED_KEY, [...next]);
  emitChanged();
}

/** Guarda/actualiza el aviso en historial de sesión (panel Avisos). */
export function archiveReservationCajaAviso({ id, title, message, created_at } = {}) {
  const alertId = reservationCajaToastId(id);
  if (!alertId) return;
  const list = readJson(AVISOS_KEY, []);
  const rows = Array.isArray(list) ? list : [];
  const idx = rows.findIndex((r) => String(r?.id) === alertId);
  const row = {
    id: alertId,
    title: String(title || 'Aviso de reserva').trim() || 'Aviso de reserva',
    message: String(message || '').trim(),
    created_at: created_at || (idx >= 0 ? rows[idx].created_at : new Date().toISOString()),
    source: 'reservation_caja',
  };
  if (idx >= 0) rows[idx] = { ...rows[idx], ...row };
  else rows.unshift(row);
  writeJson(AVISOS_KEY, rows.slice(0, 40));
  emitChanged();
}

export function getSessionReservationCajaAvisos() {
  const list = readJson(AVISOS_KEY, []);
  return (Array.isArray(list) ? list : []).filter((r) => r?.id);
}

export function removeSessionReservationCajaAviso(alertId) {
  const id = reservationCajaToastId(alertId);
  if (!id) return;
  const list = readJson(AVISOS_KEY, []);
  const rows = (Array.isArray(list) ? list : []).filter((r) => String(r?.id) !== id);
  writeJson(AVISOS_KEY, rows);
  dismissReservationCajaToast(id);
  emitChanged();
}

/** Llamar al cerrar sesión. */
export function clearReservationCajaAvisosSession() {
  try {
    sessionStorage.removeItem(DISMISSED_KEY);
    sessionStorage.removeItem(AVISOS_KEY);
  } catch {
    /* noop */
  }
  emitChanged();
}
