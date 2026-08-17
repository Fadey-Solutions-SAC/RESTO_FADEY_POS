/**
 * Inversión y gastos operativos — misma regla en Finanzas e Indicadores.
 *
 * Inversión = compras + productos de almacén + insumos.
 * Gastos operativos = precio de compra e insumos de cada producto vendido
 *   + pérdidas + egresos de caja + pagos.
 */
const { queryOne, queryAll } = require('../database');
const { insumoValorInventario } = require('./insumoUnidadMedida');

function n(v) {
  return Number(v || 0);
}

function sumWarehouseProductsValue(queryOneFn = queryOne) {
  const row = queryOneFn(
    `SELECT COALESCE(SUM(stock * purchase_price), 0) AS total FROM products
     WHERE is_active = 1 AND purchase_price IS NOT NULL AND purchase_price > 0`
  );
  return n(row?.total);
}

function sumInsumosInventoryValue(queryAllFn = queryAll) {
  try {
    const rows = queryAllFn('SELECT * FROM insumos WHERE activo = 1') || [];
    return rows.reduce((sum, row) => sum + insumoValorInventario(row), 0);
  } catch (_) {
    return 0;
  }
}

function inventorySnapshotParts() {
  const warehouseProducts = sumWarehouseProductsValue();
  const insumos = sumInsumosInventoryValue();
  return {
    warehouseProducts,
    insumos,
    inventoryTotal: warehouseProducts + insumos,
  };
}

/** Compras del período + valor actual de productos de almacén + valor actual de insumos. */
function investmentFromParts({ purchases = 0, warehouseProducts = 0, insumos = 0 }) {
  return n(purchases) + n(warehouseProducts) + n(insumos);
}

/** Costo de cada producto (compra + insumos) + pérdidas + egresos + pagos. */
function operatingFromParts({
  productCogs = 0,
  kardexCogs = 0,
  lossEvents = 0,
  cashExpenses = 0,
  payroll = 0,
}) {
  return n(productCogs) + n(kardexCogs) + n(lossEvents) + n(cashExpenses) + n(payroll);
}

function composeFinanceTotals({
  purchases = 0,
  productCogs = 0,
  kardexCogs = 0,
  lossEvents = 0,
  cashExpenses = 0,
  payroll = 0,
  warehouseProducts,
  insumos,
}) {
  const snap =
    warehouseProducts != null && insumos != null
      ? { warehouseProducts: n(warehouseProducts), insumos: n(insumos) }
      : inventorySnapshotParts();
  const cogsTotal = n(productCogs) + n(kardexCogs);
  const investmentTotal = investmentFromParts({
    purchases,
    warehouseProducts: snap.warehouseProducts,
    insumos: snap.insumos,
  });
  const operatingExpenses = operatingFromParts({
    productCogs,
    kardexCogs,
    lossEvents,
    cashExpenses,
    payroll,
  });
  return {
    warehouse_products: snap.warehouseProducts,
    inventory_insumos: snap.insumos,
    inventory_total: snap.warehouseProducts + snap.insumos,
    cogs_total: cogsTotal,
    investment_total: investmentTotal,
    operating_expenses: operatingExpenses,
  };
}

module.exports = {
  n,
  sumWarehouseProductsValue,
  sumInsumosInventoryValue,
  inventorySnapshotParts,
  investmentFromParts,
  operatingFromParts,
  composeFinanceTotals,
};
