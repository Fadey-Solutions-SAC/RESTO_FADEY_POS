/**
 * Tiempos de automatización de reservas.
 * Futuro: leer desde app_settings (p. ej. settings.reservations.kitchen_prep_minutes).
 */
const RESERVATION_KITCHEN_PREP_MINUTES = 45;
const RESERVATION_CAJA_VERIFY_MINUTES = 20;

/** Tras la hora de la reserva, el aviso a caja deja de mostrarse como máximo a las 2 h. */
const RESERVATION_CAJA_ALERT_MAX_HOURS_AFTER = 2;

/** Intervalo del job en servidor (ms). */
const RESERVATION_SCHEDULER_INTERVAL_MS = 60_000;

module.exports = {
  RESERVATION_KITCHEN_PREP_MINUTES,
  RESERVATION_CAJA_VERIFY_MINUTES,
  RESERVATION_CAJA_ALERT_MAX_HOURS_AFTER,
  RESERVATION_SCHEDULER_INTERVAL_MS,
};
