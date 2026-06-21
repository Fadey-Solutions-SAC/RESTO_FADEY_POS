/** Área explícita del producto: 'cocina' | 'bar'. Sin selección → cocina (igual que en Productos). */
function normalizeProductionArea(raw) {
  const area = String(raw ?? '').trim().toLowerCase();
  if (area === 'bar' || area === 'cocina') return area;
  return '';
}

function resolveProductionArea(raw) {
  return normalizeProductionArea(raw) || 'cocina';
}

/** Destino según la selección del producto en catálogo (Cocina / Bar). */
function isBarProductionItem(item = {}) {
  return resolveProductionArea(item.production_area) === 'bar';
}

function isKitchenProductionItem(item = {}) {
  return resolveProductionArea(item.production_area) === 'cocina';
}

function expandItemTargets(item = {}) {
  const combo = item._comboComponents;
  if (Array.isArray(combo) && combo.length > 0) return combo;
  return [item];
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

/** Ítems visibles en el panel cocina o bar (respeta combos mixtos). */
function filterItemsForKitchenStation(items, station) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const st = station === 'bar' ? 'bar' : 'cocina';
  return items.filter((item) => {
    const targets = expandItemTargets(item);
    if (st === 'bar') return targets.some(isBarProductionItem);
    return targets.some(isKitchenProductionItem);
  });
}

function stripKitchenItemMeta(item) {
  const { category_name_lc, ...rest } = item || {};
  return rest;
}

module.exports = {
  normalizeProductionArea,
  isBarProductionItem,
  isKitchenProductionItem,
  isBarOnlyOrderItems,
  orderHasBarItems,
  orderHasKitchenItems,
  filterItemsForKitchenStation,
  stripKitchenItemMeta,
};
