/** Área explícita del producto: 'cocina' | 'bar'. Sin selección → cocina (igual que en Productos). */
export function normalizeProductionArea(raw) {
  const area = String(raw ?? '').trim().toLowerCase();
  if (area === 'bar' || area === 'cocina') return area;
  return '';
}

function resolveProductionArea(raw) {
  return normalizeProductionArea(raw) || 'cocina';
}

/** Destino según la selección del producto en catálogo (Cocina / Bar). */
export function isBarProductionItem(item = {}) {
  return resolveProductionArea(item.production_area) === 'bar';
}

export function isKitchenProductionItem(item = {}) {
  return resolveProductionArea(item.production_area) === 'cocina';
}

function expandItemTargets(item = {}) {
  const combo = item._comboComponents;
  if (Array.isArray(combo) && combo.length > 0) return combo;
  return [item];
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

export function isBarProductionItemForStation(item = {}) {
  return expandItemTargets(item).some(isBarProductionItem);
}

export function isKitchenProductionItemForStation(item = {}) {
  return expandItemTargets(item).some(isKitchenProductionItem);
}
