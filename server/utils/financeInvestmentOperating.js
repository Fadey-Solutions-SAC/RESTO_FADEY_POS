/**
 * Inversión y gastos operativos — misma regla en Finanzas e Indicadores.
 *
 * Inversión del período = compras de productos de almacén e insumos en el rango de fechas.
 * El valor actual de stock (almacén + insumos) es una foto aparte, no entra en el período.
 * Gastos operativos = precio de compra e insumos de cada producto vendido
 *   + pérdidas + egresos de caja + pagos.
 */
const { queryOne, queryAll } = require('../database');
const { insumoValorInventario } = require('./insumoUnidadMedida');
const { INVENTORY_EXPENSE_PURCHASE_DATE_IE_SQL } = require('./inventoryPurchaseDate');

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

/** Compras de almacén e insumos en el rango (respeta Desde–Hasta). */
function sumPeriodPurchasesSplit(from, to, queryOneFn = queryOne) {
  const row = queryOneFn(
    `SELECT
       COALESCE(SUM(ie.total_cost), 0) AS total,
       COALESCE(SUM(CASE
         WHEN EXISTS (SELECT 1 FROM products p WHERE p.id = ie.product_id)
          AND NOT EXISTS (SELECT 1 FROM insumos i WHERE i.id = ie.product_id)
         THEN ie.total_cost ELSE 0 END), 0) AS products,
       COALESCE(SUM(CASE
         WHEN EXISTS (SELECT 1 FROM insumos i WHERE i.id = ie.product_id)
           OR (
             NOT EXISTS (SELECT 1 FROM products p WHERE p.id = ie.product_id)
             AND EXISTS (
               SELECT 1 FROM warehouse_locations w
               WHERE w.id = ie.warehouse_id AND IFNULL(w.linked_insumos, 0) = 1
             )
           )
         THEN ie.total_cost ELSE 0 END), 0) AS insumos
     FROM inventory_expenses ie
     WHERE ${INVENTORY_EXPENSE_PURCHASE_DATE_IE_SQL} BETWEEN date(?) AND date(?)`,
    [from, to]
  );
  const total = n(row?.total);
  const products = n(row?.products);
  const insumos = n(row?.insumos);
  return { total, products, insumos };
}

/** Solo compras del rango (productos de almacén e insumos). No suma el stock actual. */
function investmentFromParts({ purchases = 0 }) {
  return n(purchases);
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
  const investmentTotal = investmentFromParts({ purchases });
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
  sumPeriodPurchasesSplit,
};
