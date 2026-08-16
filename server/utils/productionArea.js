/**
 * Áreas de producción dinámicas. Mantiene compatibilidad cocina/bar.
 * Sin área válida en producto → cocina.
 */

function expandItemTargets(item = {}) {
  const combo = item._comboComponents;
  if (Array.isArray(combo) && combo.length > 0) return combo;
  return [item];
}

function normalizeProductionArea(raw) {
  const area = String(raw ?? '').trim();
  if (!area) return '';
  return area;
}

function resolveProductionArea(raw) {
  return normalizeProductionArea(raw) || 'cocina';
}

function itemProductionAreaId(item = {}) {
  return resolveProductionArea(item.production_area);
}

function isBarProductionItem(item = {}) {
  return itemProductionAreaId(item) === 'bar';
}

function isKitchenProductionItem(item = {}) {
  return itemProductionAreaId(item) === 'cocina';
}

function isBarOnlyOrderItems(items = []) {
  if (!Array.isArray(items) || items.length === 0) return false;
  return items.every((item) => expandItemTargets(item).every(isBarProductionItem));
}

function orderHasBarItems(items = []) {
  if (!Array.isArray(items) || items.length === 0) return false;
  return items.some((item) => expandItemTargets(item).some(isBarProductionItem));
}

function orderHasKitchenItems(items = []) {
  if (!Array.isArray(items) || items.length === 0) return false;
  return items.some((item) => expandItemTargets(item).some(isKitchenProductionItem));
}

/** Ítems visibles en un panel de área (id = cocina | bar | uuid). */
function filterItemsForKitchenStation(items, station) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const st = String(station || 'cocina').trim() || 'cocina';
  return items.filter((item) => {
    const targets = expandItemTargets(item);
    return targets.some((t) => itemProductionAreaId(t) === st);
  });
}

function orderHasStationWork(items, station) {
  return filterItemsForKitchenStation(items, station).length > 0;
}

function collectOrderProductionAreaIds(items = []) {
  const ids = new Set();
  for (const item of items || []) {
    for (const t of expandItemTargets(item)) {
      ids.add(itemProductionAreaId(t));
    }
  }
  return [...ids];
}

function stripKitchenItemMeta(item) {
  const { category_name_lc, ...rest } = item || {};
  return rest;
}

module.exports = {
  normalizeProductionArea,
  resolveProductionArea,
  itemProductionAreaId,
  isBarProductionItem,
  isKitchenProductionItem,
  isBarOnlyOrderItems,
  orderHasBarItems,
  orderHasKitchenItems,
  filterItemsForKitchenStation,
  orderHasStationWork,
  collectOrderProductionAreaIds,
  stripKitchenItemMeta,
  expandItemTargets,
};
