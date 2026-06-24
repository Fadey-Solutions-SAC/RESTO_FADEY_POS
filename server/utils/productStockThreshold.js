/** Umbral global cuando el producto no tiene min_stock configurado (> 0). */
const DEFAULT_NON_TRANSFORMED_MIN_STOCK = 10;

function parseProductMinStock(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function effectiveMinStock(minStock) {
  const min = parseProductMinStock(minStock);
  return min > 0 ? min : DEFAULT_NON_TRANSFORMED_MIN_STOCK;
}

function qualified(alias, column) {
  const a = String(alias || '').trim();
  return a ? `${a}.${column}` : column;
}

/** SQL: umbral efectivo por fila de producto (alias opcional, ej. `p`; vacío = columnas sin prefijo). */
function effectiveMinStockExpr(alias = '') {
  const minStock = qualified(alias, 'min_stock');
  return `CASE WHEN IFNULL(${minStock}, 0) > 0 THEN IFNULL(${minStock}, 0) ELSE ${DEFAULT_NON_TRANSFORMED_MIN_STOCK} END`;
}

/** SQL: producto no transformado con stock en o por debajo de su mínimo. */
function isNonTransformedLowStockSql(alias = '') {
  return `IFNULL(${qualified(alias, 'stock')}, 0) <= (${effectiveMinStockExpr(alias)})`;
}

function isProductLowStock(stock, minStock) {
  const s = Number(stock) || 0;
  return s <= effectiveMinStock(minStock);
}

/** Cantidad sugerida para reponer hasta el doble del mínimo (mín. 20 si el umbral es el default). */
function suggestedReplenishmentQty(stock, minStock) {
  const effective = effectiveMinStock(minStock);
  const target = Math.max(20, effective * 2);
  return Math.max(0, target - (Number(stock) || 0));
}

module.exports = {
  DEFAULT_NON_TRANSFORMED_MIN_STOCK,
  parseProductMinStock,
  effectiveMinStock,
  effectiveMinStockExpr,
  isNonTransformedLowStockSql,
  isProductLowStock,
  suggestedReplenishmentQty,
};
