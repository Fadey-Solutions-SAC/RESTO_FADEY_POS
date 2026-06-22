/** Minutos en «pendiente» sin pasar a preparando → alerta roja en panel. */
const KITCHEN_ARRIVAL_ALERT_MIN = 30;
/** Minutos en «preparando» (desde preparing_at) → alerta roja + monitoreo. */
const KITCHEN_PREP_ALERT_MIN = 30;

module.exports = {
  KITCHEN_ARRIVAL_ALERT_MIN,
  KITCHEN_PREP_ALERT_MIN,
};
