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

/** SQL: umbral efectivo por fila de producto (alias opcional, ej. `p`). */
function effectiveMinStockExpr(alias = 'p') {
  const a = alias;
  return `CASE WHEN IFNULL(${a}.min_stock, 0) > 0 THEN IFNULL(${a}.min_stock, 0) ELSE ${DEFAULT_NON_TRANSFORMED_MIN_STOCK} END`;
}

/** SQL: producto no transformado con stock en o por debajo de su mínimo. */
function isNonTransformedLowStockSql(alias = 'p') {
  return `IFNULL(${alias}.stock, 0) <= (${effectiveMinStockExpr(alias)})`;
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
