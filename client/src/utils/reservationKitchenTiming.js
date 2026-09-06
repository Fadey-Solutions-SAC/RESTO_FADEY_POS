/** Debe coincidir con server/constants/reservationTiming.js */
export const RESERVATION_KITCHEN_PREP_MINUTES = 30;

/**
 * @returns {{ due: boolean, releaseAt: Date|null, label: string }}
 */
export function getReservationKitchenReleaseInfo(dateStr, timeStr, now = new Date()) {
  const d = String(dateStr || '').trim();
  const t = String(timeStr || '').trim().slice(0, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{2}:\d{2}$/.test(t)) {
    return { due: true, releaseAt: null, label: '' };
  }
  const [yy, mm, dd] = d.split('-').map(Number);
  const [hh, mi] = t.split(':').map(Number);
  const reservationAt = new Date(yy, mm - 1, dd, hh, mi, 0, 0);
  if (Number.isNaN(reservationAt.getTime())) {
    return { due: true, releaseAt: null, label: '' };
  }
  const releaseAt = new Date(reservationAt.getTime() - RESERVATION_KITCHEN_PREP_MINUTES * 60 * 1000);
  const due = releaseAt.getTime() <= now.getTime();
  if (due) {
    return { due: true, releaseAt, label: 'Pedido ya puede ir a cocina' };
  }
  const pad = (n) => String(n).padStart(2, '0');
  const sameDay =
    releaseAt.getFullYear() === now.getFullYear()
    && releaseAt.getMonth() === now.getMonth()
    && releaseAt.getDate() === now.getDate();
  const timeLabel = `${pad(releaseAt.getHours())}:${pad(releaseAt.getMinutes())}`;
  const dayLabel = sameDay
    ? 'hoy'
    : `${pad(releaseAt.getDate())}/${pad(releaseAt.getMonth() + 1)}`;
  return {
    due: false,
    releaseAt,
    label: `Cocina desde ${timeLabel} (${dayLabel}) · ${RESERVATION_KITCHEN_PREP_MINUTES} min antes`,
  };
}

export function reservationNotesHaveOrder(notes) {
  return /pedido\s+solicitado\s*:/i.test(String(notes || ''));
}
