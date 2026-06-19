const { RESERVATION_KITCHEN_PREP_MINUTES } = require('../constants/reservationTiming');
const { computeMinutesBeforeReservation } = require('./reservationDateTime');

function computeKitchenReleaseAtForReservation(date, time) {
  return computeMinutesBeforeReservation(date, time, RESERVATION_KITCHEN_PREP_MINUTES);
}

module.exports = {
  computeKitchenReleaseAtForReservation,
};
