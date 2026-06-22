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

function isKitchenItemMarkedReady(item) {
  return Boolean(String(item?.station_cocina_ready_at || '').trim());
}

function allKitchenStationItemsReady(areaItems) {
  const kitchenItems = filterItemsForKitchenStation(areaItems, 'cocina');
  if (!kitchenItems.length) return true;
  return kitchenItems.every(isKitchenItemMarkedReady);
}

/** Cocina cerrada en su módulo cuando todos sus ítems están listos (independiente de bar). */
function isCocinaStationComplete(order, areaItems) {
  if (isStationMarkedReady(order, 'cocina')) return true;
  const kitchenItems = filterItemsForKitchenStation(areaItems, 'cocina');
  if (!kitchenItems.length) return true;
  return allKitchenStationItemsReady(areaItems);
}

/** Bar cerrado en su módulo (comanda completa en bar). */
function isBarStationComplete(order, areaItems) {
  if (isStationMarkedReady(order, 'bar')) return true;
  if (!orderHasBarItems(areaItems)) return true;
  return false;
}

function isStationCompleteForStation(order, areaItems, station) {
  return normalizeKitchenStation(station) === 'bar'
    ? isBarStationComplete(order, areaItems)
    : isCocinaStationComplete(order, areaItems);
}

function orderHasStationWork(areaItems, station) {
  const st = normalizeKitchenStation(station);
  if (st === 'bar') return orderHasBarItems(areaItems);
  return orderHasKitchenItems(areaItems);
}

/** Solo para POS/delivery: todas las estaciones con ítems terminaron (no afecta visibilidad por panel). */
function allRequiredStationsReady(order, areaItems) {
  const hasKitchen = orderHasKitchenItems(areaItems);
  const hasBar = orderHasBarItems(areaItems);
  if (hasKitchen && !isCocinaStationComplete(order, areaItems)) return false;
  if (hasBar && !isBarStationComplete(order, areaItems)) return false;
  return hasKitchen || hasBar;
}

/** Estado global «listo» incoherente con alguna estación pendiente → volver a preparación. */
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
    const areaItems = getAreaItems(o.id);
    if (isStationCompleteForStation(o, areaItems, st)) return;
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
  isKitchenItemMarkedReady,
  allKitchenStationItemsReady,
  isCocinaStationComplete,
  isBarStationComplete,
  isStationCompleteForStation,
  orderHasStationWork,
  allRequiredStationsReady,
  kitchenOrderNeedsRepair,
  filterKitchenOrdersForStation,
};
