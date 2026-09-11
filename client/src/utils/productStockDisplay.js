/** Umbral global cuando el producto no tiene min_stock configurado (> 0). */
export const DEFAULT_NON_TRANSFORMED_MIN_STOCK = 10;

export function parseProductMinStock(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

export function effectiveProductMinStock(minStock) {
  const min = parseProductMinStock(minStock);
  return min > 0 ? min : DEFAULT_NON_TRANSFORMED_MIN_STOCK;
}

export function isProductLowStock(stock, minStock) {
  const s = Number(stock) || 0;
  return s <= effectiveProductMinStock(minStock);
}

/** `normal` | `low` | `out` */
export function productStockStatus(stock, minStock) {
  const s = Number(stock) || 0;
  if (s <= 0) return 'out';
  if (isProductLowStock(s, minStock)) return 'low';
  return 'normal';
}

/**
 * En pedidos solo mostramos stock cuando el producto es inventario vendible:
 * - Debe ser explícitamente `non_transformed`.
 * - Si tiene stock 0 y no tiene almacén asignado, se trata como plato / dato incompleto → no mostrar
 *   (evita "Stock: 0" en platos transformados mal clasificados).
 * - Con almacén y stock 0 sí se muestra (agotado).
 */
export function showStockInOrderingUI(product) {
  if (!product) return false;
  if (product.is_combo) return false;
  const pt = String(product.process_type ?? '').trim().toLowerCase();
  if (pt !== 'non_transformed') return false;
  const stock = Number(product.stock);
  const warehouseId = String(product.stock_warehouse_id ?? '').trim();
  if (warehouseId) return true;
  if (Number.isFinite(stock) && stock > 0) return true;
  return false;
}

/** Precio unitario en catálogo de pedidos (productos y combos). */
export function orderingProductUnitPrice(product) {
  if (!product) return 0;
  const raw = product.price ?? product.unit_price ?? product.sale_price;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export function formatOrderingStockQty(stock) {
  const n = Number(stock);
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  return n.toFixed(2).replace(/\.?0+$/, '');
}
