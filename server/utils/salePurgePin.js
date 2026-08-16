/** PIN para eliminar una venta observada de todo el sistema. */
const SALE_PURGE_PIN = '2546';

function verifySalePurgePin(pin) {
  return String(pin || '').trim() === SALE_PURGE_PIN;
}

module.exports = { SALE_PURGE_PIN, verifySalePurgePin };
