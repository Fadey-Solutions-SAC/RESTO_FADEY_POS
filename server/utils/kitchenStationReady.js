const {
  orderHasBarItems,
  orderHasKitchenItems,
  filterItemsForKitchenStation,
} = require('./productionArea');

/** Cocina y bar son independientes: misma comanda, ítems y botones por estación. */

function normalizeKitchenStation(station) {
  return station === 'bar' ? 'bar' : 'cocina';
}

function getStationReadyColumn(station) {
  return normalizeKitchenStation(station) === 'bar'
    ? 'station_bar_ready_at'
    : 'station_cocina_ready_at';
}

function getStationPreparingColumn(station) {
  return normalizeKitchenStation(station) === 'bar'
    ? 'station_bar_preparing_at'
    : 'station_cocina_preparing_at';
}

function isStationMarkedReady(order, station) {
  const col = getStationReadyColumn(station);
  return Boolean(String(order?.[col] || '').trim());
}

function isStationMarkedPreparing(order, station) {
  const col = getStationPreparingColumn(station);
  return Boolean(String(order?.[col] || '').trim());
}

function orderHasStationWork(areaItems, station) {
  const st = normalizeKitchenStation(station);
  if (st === 'bar') return orderHasBarItems(areaItems);
  return orderHasKitchenItems(areaItems);
}

function allRequiredStationsReady(order, areaItems) {
  const hasKitchen = orderHasKitchenItems(areaItems);
  const hasBar = orderHasBarItems(areaItems);
  if (hasKitchen && !isStationMarkedReady(order, 'cocina')) return false;
  if (hasBar && !isStationMarkedReady(order, 'bar')) return false;
  return hasKitchen || hasBar;
}

/** Comanda global «listo» pero estaciones sin cerrar → reabrir en preparación. */
function kitchenOrderNeedsRepair(order, areaItems) {
  if (!order || order.status !== 'ready') return false;
  if (String(order.payment_status || 'pending') === 'paid') return false;
  return !allRequiredStationsReady(order, areaItems);
}

/** Comandas visibles: bloque con ítems de esta estación aún no listos. */
function filterKitchenOrdersForStation(orders, station, getAreaItems) {
  const st = normalizeKitchenStation(station);
  const filtered = [];
  orders.forEach((o) => {
    if (isStationMarkedReady(o, st)) return;
    const areaItems = getAreaItems(o.id);
    if (st === 'bar' && !orderHasBarItems(areaItems)) return;
    if (st === 'cocina' && !orderHasKitchenItems(areaItems)) return;
    const stationItems = filterItemsForKitchenStation(areaItems, st);
    if (!stationItems.length) return;
    filtered.push({ order: o, stationItems });
  });
  return filtered;
}

module.exports = {
  normalizeKitchenStation,
  getStationReadyColumn,
  getStationPreparingColumn,
  isStationMarkedReady,
  isStationMarkedPreparing,
  orderHasStationWork,
  allRequiredStationsReady,
  kitchenOrderNeedsRepair,
  filterKitchenOrdersForStation,
};
