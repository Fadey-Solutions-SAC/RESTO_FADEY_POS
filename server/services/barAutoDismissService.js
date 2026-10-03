/**
 * Compatibilidad: el retiro automático ahora es por área (stationAutoDismissService).
 */
const { markStationReady, processStationAutoDismiss } = require('./stationAutoDismissService');

function markBarStationReady(order, opts = {}) {
  return markStationReady(order, 'bar', opts);
}

function processBarAutoDismiss({ io } = {}) {
  return processStationAutoDismiss({ io, areaId: 'bar' });
}

module.exports = {
  processBarAutoDismiss,
  markBarStationReady,
};
