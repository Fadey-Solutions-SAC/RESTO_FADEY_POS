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

/** Stock máximo (0 = sin máximo configurado). */
function parseProductMaxStock(value) {
  return parseProductMinStock(value);
}

/** Valida que el máximo (si se configuró) no sea menor que el mínimo. */
function validateMinMaxStock(minStock, maxStock) {
  const min = parseProductMinStock(minStock);
  const max = parseProductMaxStock(maxStock);
  if (max > 0 && max < min) {
    return { ok: false, error: `El stock máximo (${max}) no puede ser menor que el mínimo (${min})` };
  }
  return { ok: true, min, max };
}

/** Meta de reposición: el máximo si está configurado; si no, el doble del mínimo (mín. 20). */
function replenishmentTarget(minStock, maxStock) {
  const max = parseProductMaxStock(maxStock);
  if (max > 0) return max;
  return Math.max(20, effectiveMinStock(minStock) * 2);
}

/** Cantidad sugerida para reponer hasta la meta (máximo configurado o doble del mínimo). */
function suggestedReplenishmentQty(stock, minStock, maxStock = 0) {
  return Math.max(0, replenishmentTarget(minStock, maxStock) - (Number(stock) || 0));
}

module.exports = {
  DEFAULT_NON_TRANSFORMED_MIN_STOCK,
  parseProductMinStock,
  parseProductMaxStock,
  validateMinMaxStock,
  replenishmentTarget,
  effectiveMinStock,
  effectiveMinStockExpr,
  isNonTransformedLowStockSql,
  isProductLowStock,
  suggestedReplenishmentQty,
};
