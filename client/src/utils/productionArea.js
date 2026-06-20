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

export function isBarText(value = '') {
  const text = String(value || '').toLowerCase();
  if (text.includes('bar ') || text.startsWith('bar/')) return true;
  return BAR_TEXT_TOKENS.some((token) => text.includes(token));
}

/** Área explícita del producto: 'cocina' | 'bar' | '' si no está definida. */
export function normalizeProductionArea(raw) {
  const area = String(raw ?? '').trim().toLowerCase();
  if (area === 'bar' || area === 'cocina') return area;
  return '';
}

/**
 * ¿Este ítem va al panel de bar?
 * Prioridad: production_area del producto. Heurística por nombre solo si no hay área.
 */
export function isBarProductionItem(item = {}) {
  const area = normalizeProductionArea(item.production_area);
  if (area === 'bar') return true;
  if (area === 'cocina') return false;
  const text = `${item.category_name_lc || ''} ${item.product_name || ''} ${item.notes || ''}`.trim();
  return isBarText(text);
}

export function isKitchenProductionItem(item = {}) {
  return !isBarProductionItem(item);
}

export function isBarOnlyOrderItems(items = []) {
  if (!Array.isArray(items) || items.length === 0) return false;
  return items.every(isBarProductionItem);
}

export function orderHasBarItems(items = []) {
  return Array.isArray(items) && items.some(isBarProductionItem);
}

export function orderHasKitchenItems(items = []) {
  return Array.isArray(items) && items.some(isKitchenProductionItem);
}
