const { queryOne } = require('../database');
const { RESERVATION_KITCHEN_PREP_MINUTES } = require('../constants/reservationTiming');
const { normalizeReservationTime } = require('./reservationDateTime');
const { sqlBusinessNowExpr } = require('../utils/appDateTime');

/**
 * T−N minutos antes de la reserva, en hora de negocio (America/Lima),
 * no en localtime del servidor (UTC en Render).
 */
function computeKitchenReleaseAtForReservation(date, time) {
  const d = String(date || '').trim().slice(0, 10);
  const t = normalizeReservationTime(time);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{2}:\d{2}$/.test(t)) return null;
  const mins = Math.max(0, Number(RESERVATION_KITCHEN_PREP_MINUTES) || 0);
  const row = queryOne(
    `SELECT datetime(? || ' ' || ?, ?) AS release_at`,
    [d, t, `-${mins} minutes`]
  );
  const releaseAt = String(row?.release_at || '').trim();
  return releaseAt || null;
}

/** true si la liberación a cocina ya venció (o no hay hold). */
function isKitchenReleaseDue(releaseAt) {
  const ts = String(releaseAt || '').trim();
  if (!ts) return true;
  const nowExpr = sqlBusinessNowExpr(queryOne);
  const row = queryOne(
    `SELECT CASE WHEN datetime(?) <= ${nowExpr} THEN 1 ELSE 0 END AS due`,
    [ts]
  );
  return Number(row?.due) === 1;
}

module.exports = {
  computeKitchenReleaseAtForReservation,
  isKitchenReleaseDue,
};
