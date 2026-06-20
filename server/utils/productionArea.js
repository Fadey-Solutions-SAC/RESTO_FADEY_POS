const BAR_TEXT_TOKENS = [
  'bebida',
  'bebidas',
  'trago',
  'tragos',
  'coctel',
  'cocteles',
  'cocktail',
  'cocktails',
];

function isBarText(value = '') {
  const text = String(value || '').toLowerCase();
  if (text.includes('bar ') || text.startsWith('bar/')) return true;
  return BAR_TEXT_TOKENS.some((token) => text.includes(token));
}

/** Área explícita del producto: 'cocina' | 'bar' | '' si no está definida. */
function normalizeProductionArea(raw) {
  const area = String(raw ?? '').trim().toLowerCase();
  if (area === 'bar' || area === 'cocina') return area;
  return '';
}

/**
 * ¿Este ítem va al panel de bar?
 * Prioridad: production_area del producto. Heurística por nombre solo si no hay área.
 */
function isBarProductionItem(item = {}) {
  const area = normalizeProductionArea(item.production_area);
  if (area === 'bar') return true;
  if (area === 'cocina') return false;
  const text = `${item.category_name_lc || ''} ${item.product_name || ''}`.trim();
  return isBarText(text);
}

function isKitchenProductionItem(item = {}) {
  return !isBarProductionItem(item);
}

function isBarOnlyOrderItems(items = []) {
  if (!Array.isArray(items) || items.length === 0) return false;
  return items.every(isBarProductionItem);
}

function orderHasBarItems(items = []) {
  return Array.isArray(items) && items.some(isBarProductionItem);
}

function orderHasKitchenItems(items = []) {
  return Array.isArray(items) && items.some(isKitchenProductionItem);
}

module.exports = {
  isBarText,
  normalizeProductionArea,
  isBarProductionItem,
  isKitchenProductionItem,
  isBarOnlyOrderItems,
  orderHasBarItems,
  orderHasKitchenItems,
};
