/** Área de producción dinámica (id). Sin selección → cocina. */

function expandItemTargets(item = {}) {
  const combo = item._comboComponents;
  if (Array.isArray(combo) && combo.length > 0) return combo;
  return [item];
}

export function normalizeProductionArea(raw) {
  const area = String(raw ?? '').trim();
  if (!area) return '';
  return area;
}

function resolveProductionArea(raw) {
  return normalizeProductionArea(raw) || 'cocina';
}

export function itemProductionAreaId(item = {}) {
  return resolveProductionArea(item.production_area);
}

export function isBarProductionItem(item = {}) {
  return itemProductionAreaId(item) === 'bar';
}

export function isKitchenProductionItem(item = {}) {
  return itemProductionAreaId(item) === 'cocina';
}

export function isBarProductionItemForStation(item, station) {
  const st = String(station || '').trim() || 'cocina';
  return itemProductionAreaId(item) === st;
}

export function isKitchenProductionItemForStation(item, station) {
  return isBarProductionItemForStation(item, station);
}

export function isBarOnlyOrderItems(items = []) {
  if (!Array.isArray(items) || items.length === 0) return false;
  return items.every((item) => expandItemTargets(item).every(isBarProductionItem));
}

export function orderHasBarItems(items = []) {
  if (!Array.isArray(items) || items.length === 0) return false;
  return items.some((item) => expandItemTargets(item).some(isBarProductionItem));
}

export function orderHasKitchenItems(items = []) {
  if (!Array.isArray(items) || items.length === 0) return false;
  return items.some((item) => expandItemTargets(item).some(isKitchenProductionItem));
}

export function filterItemsForKitchenStation(items, station) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const st = String(station || 'cocina').trim() || 'cocina';
  return items.filter((item) => {
    const targets = expandItemTargets(item);
    return targets.some((t) => itemProductionAreaId(t) === st);
  });
}

export function collectOrderProductionAreaIds(items = []) {
  const ids = new Set();
  for (const item of items || []) {
    for (const t of expandItemTargets(item)) {
      ids.add(itemProductionAreaId(t));
    }
  }
  return [...ids];
}

export function isKitchenItemMarkedReady(item = {}) {
  return Boolean(String(item?.station_cocina_ready_at || '').trim());
}

export function isProductionStationMarkedReady(order = {}, station = 'cocina') {
  const st = String(station || '').trim() || 'cocina';
  if (st === 'bar') return Boolean(String(order?.station_bar_ready_at || '').trim());
  if (st === 'cocina') return Boolean(String(order?.station_cocina_ready_at || '').trim());
  const map = order?.order_stations || order?.station_states;
  if (Array.isArray(map)) {
    const row = map.find((r) => String(r?.area_id || '') === st);
    return Boolean(String(row?.ready_at || '').trim());
  }
  return Boolean(String(order?.[`station_${st}_ready_at`] || '').trim());
}

/** Comanda con trabajo pendiente en cocina (misma lógica que panel cocina / Escritorio). */
export function orderPendingForKitchenStation(order = {}) {
  if (!orderHasKitchenItems(order.items)) return false;
  if (isProductionStationMarkedReady(order, 'cocina')) return false;
  const kitchenItems = filterItemsForKitchenStation(order.items || [], 'cocina');
  if (!kitchenItems.length) return false;
  return kitchenItems.some((item) => !isKitchenItemMarkedReady(item));
}

/** Comanda con trabajo pendiente en bar (comanda completa en bar). */
export function orderPendingForBarStation(order = {}) {
  if (!orderHasBarItems(order.items)) return false;
  return !isProductionStationMarkedReady(order, 'bar');
}

export function isActiveProductionQueueOrder(order = {}) {
  if (!order) return false;
  if (!['pending', 'preparing', 'ready'].includes(String(order.status || ''))) return false;
  if (String(order.payment_status || 'pending') === 'paid') return false;
  return true;
}
