const {
  orderHasBarItems,
  orderHasKitchenItems,
  filterItemsForKitchenStation,
  collectOrderProductionAreaIds,
  orderHasStationWork: orderHasStationWorkFromItems,
} = require('./productionArea');
const { queryOne } = require('../database');

/** Cocina/bar legacy + áreas dinámicas vía order_station_state. */

function normalizeKitchenStation(station) {
  const s = String(station || '').trim();
  if (!s) return 'cocina';
  return s;
}

function isLegacyStation(station) {
  const st = normalizeKitchenStation(station);
  return st === 'cocina' || st === 'bar';
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

function readStationStateRow(orderId, areaId) {
  try {
    return queryOne(
      'SELECT preparing_at, ready_at FROM order_station_state WHERE order_id = ? AND area_id = ?',
      [String(orderId || '').trim(), String(areaId || '').trim()]
    );
  } catch {
    return null;
  }
}

function isStationMarkedReady(order, station) {
  const st = normalizeKitchenStation(station);
  if (isLegacyStation(st)) {
    const col = getStationReadyColumn(st);
    if (Boolean(String(order?.[col] || '').trim())) return true;
  }
  const row = readStationStateRow(order?.id, st);
  return Boolean(String(row?.ready_at || '').trim());
}

function isStationMarkedPreparing(order, station) {
  const st = normalizeKitchenStation(station);
  if (isLegacyStation(st)) {
    const col = getStationPreparingColumn(st);
    if (Boolean(String(order?.[col] || '').trim())) return true;
  }
  const row = readStationStateRow(order?.id, st);
  return Boolean(String(row?.preparing_at || '').trim());
}

function isKitchenItemMarkedReady(item) {
  return Boolean(String(item?.station_cocina_ready_at || '').trim());
}

function allKitchenStationItemsReady(areaItems) {
  const kitchenItems = filterItemsForKitchenStation(areaItems, 'cocina');
  if (!kitchenItems.length) return true;
  return kitchenItems.every(isKitchenItemMarkedReady);
}

function isCocinaStationComplete(order, areaItems) {
  if (isStationMarkedReady(order, 'cocina')) return true;
  const kitchenItems = filterItemsForKitchenStation(areaItems, 'cocina');
  if (!kitchenItems.length) return true;
  return allKitchenStationItemsReady(areaItems);
}

function isBarStationComplete(order, areaItems) {
  if (isStationMarkedReady(order, 'bar')) return true;
  if (!orderHasBarItems(areaItems)) return true;
  return false;
}

function isStationCompleteForStation(order, areaItems, station) {
  const st = normalizeKitchenStation(station);
  if (st === 'bar') return isBarStationComplete(order, areaItems);
  if (st === 'cocina') return isCocinaStationComplete(order, areaItems);
  if (isStationMarkedReady(order, st)) return true;
  const stationItems = filterItemsForKitchenStation(areaItems, st);
  return !stationItems.length;
}

function orderHasStationWork(areaItems, station) {
  return orderHasStationWorkFromItems(areaItems, station);
}

function allRequiredStationsReady(order, areaItems) {
  const areaIds = collectOrderProductionAreaIds(areaItems);
  if (!areaIds.length) return false;
  return areaIds.every((aid) => isStationCompleteForStation(order, areaItems, aid));
}

function kitchenOrderNeedsRepair(order, areaItems) {
  if (!order || order.status !== 'ready') return false;
  if (String(order.payment_status || 'pending') === 'paid') return false;
  return !allRequiredStationsReady(order, areaItems);
}

function filterKitchenOrdersForStation(orders, station, getAreaItems) {
  const st = normalizeKitchenStation(station);
  const filtered = [];
  orders.forEach((o) => {
    const areaItems = getAreaItems(o.id);
    if (isStationCompleteForStation(o, areaItems, st)) return;
    if (!orderHasStationWork(areaItems, st)) return;
    const stationItems = filterItemsForKitchenStation(areaItems, st);
    if (!stationItems.length) return;
    filtered.push({ order: o, stationItems });
  });
  return filtered;
}

module.exports = {
  normalizeKitchenStation,
  isLegacyStation,
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
