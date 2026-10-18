/** Una categoría = una carta. Máximo 10 productos activos. */

export const CARTA_MAX_PRODUCTS = 10;

export function isCatalogProductActive(product) {
  return Number(product?.is_active ?? 1) !== 0;
}

export function productsForCartaCategory(products, categoryId) {
  const id = String(categoryId || '').trim();
  if (!id) return [];
  return (Array.isArray(products) ? products : [])
    .filter((product) => isCatalogProductActive(product) && String(product.category_id || '') === id)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'));
}

function oneLine(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function formatCartaProductLine(product) {
  const name = oneLine(product?.name) || 'Producto';
  const description = oneLine(product?.description);
  const price = Number(product?.price);
  const pricePart = Number.isFinite(price) ? `  ${price}` : '';
  if (description) return `${name} | ${description}${pricePart}`;
  return `${name}${pricePart}`;
}

export function buildCartaTextFromCategory({ category, products } = {}) {
  const all = productsForCartaCategory(products, category?.id);
  const used = all.slice(0, CARTA_MAX_PRODUCTS);
  const title = oneLine(category?.name) || 'Nuestra carta';
  return {
    title,
    text: used.map(formatCartaProductLine).join('\n'),
    used: used.length,
    omitted: Math.max(0, all.length - used.length),
  };
}
