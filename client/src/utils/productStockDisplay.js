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
  const pt = String(product.process_type ?? '').trim().toLowerCase();
  if (pt !== 'non_transformed') return false;
  const stock = Number(product.stock);
  const warehouseId = String(product.stock_warehouse_id ?? '').trim();
  if (stock <= 0 && !warehouseId) return false;
  return true;
}
