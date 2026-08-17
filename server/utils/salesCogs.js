/**
 * Costo de venta del período (entra en gastos operativos):
 * - no transformados: precio de compra × cantidad cobrada
 * - transformados: insumos descontados al cobrar (kardex) o receta × costo promedio
 */
const { queryOne, queryAll } = require('../database');
const { getPaidSalesEventSql } = require('./salesAccountGrouping');
const { getBusinessMonthKey } = require('./appDateTime');
const { resolveKardexInsumoLines } = require('./productKardexInsumos');
const { isUnidadUm, recipeQtyToStock } = require('./insumoUnidadMedida');

const PAID_ORDER_JOIN = `o.status != 'cancelled'
  AND o.payment_status = 'paid'
  AND IFNULL(o.payment_method, '') NOT IN ('cortesia', 'cuenta_cliente')`;

/** Producto cuyo costo ya sale por kardex (no duplicar con purchase_price). */
const PRODUCT_USES_INSUMO_SQL = `(
  TRIM(IFNULL(p.kardex_insumo_id, '')) != ''
  OR (
    TRIM(IFNULL(p.kardex_insumos, '')) != ''
    AND TRIM(IFNULL(p.kardex_insumos, '')) NOT IN ('[]', 'null')
  )
  OR EXISTS (
    SELECT 1 FROM recetas r
    WHERE r.product_id = p.id AND IFNULL(r.activo, 1) = 1
  )
)`;

function productHasInsumoLink(product, queryOneFn = queryOne) {
  if (!product) return false;
  if (String(product.kardex_insumo_id || '').trim()) return true;
  const raw = String(product.kardex_insumos || '').trim();
  if (raw && raw !== '[]' && raw !== 'null') return true;
  const rec = queryOneFn(
    `SELECT id FROM recetas WHERE product_id = ? AND IFNULL(activo, 1) = 1 LIMIT 1`,
    [product.id],
  );
  return Boolean(rec?.id);
}

function insumoNeedForLine(insumo, line, qtySold) {
  const qty = Number(line?.qty || 0) * Number(qtySold || 0);
  if (!(qty > 0)) return 0;
  if (isUnidadUm(insumo?.unidad_medida)) return qty;
  return recipeQtyToStock(line.qty, insumo?.unidad_medida) * Number(qtySold || 0);
}

function estimateInsumoCogsForProduct(product, qtySold, queryOneFn = queryOne) {
  const qty = Number(qtySold || 0);
  if (!product || !(qty > 0)) return 0;
  const lines = resolveKardexInsumoLines(product);
  let total = 0;
  if (lines.length) {
    for (const line of lines) {
      const ins = queryOneFn('SELECT * FROM insumos WHERE id = ?', [line.insumo_id]);
      if (!ins) continue;
      const need = insumoNeedForLine(ins, line, qty);
      total += need * Number(ins.costo_promedio || 0);
    }
    return total;
  }
  const rec = queryOneFn(
    `SELECT id FROM recetas WHERE product_id = ? AND IFNULL(activo, 1) = 1 LIMIT 1`,
    [product.id],
  );
  if (!rec?.id) return 0;
  const detRows = queryAll('SELECT * FROM receta_detalle WHERE receta_id = ?', [rec.id]) || [];
  for (const d of detRows) {
    const ins = queryOneFn('SELECT * FROM insumos WHERE id = ?', [d.insumo_id]);
    if (!ins) continue;
    const need = Number(d.cantidad_usada || 0) * qty;
    total += need * Number(ins.costo_promedio || 0);
  }
  return total;
}

function estimateComboOrProductInsumoCogs(item, queryOneFn = queryOne) {
  const qty = Number(item?.quantity || 0);
  if (!(qty > 0)) return 0;
  if (String(item.variant_name || '').toLowerCase() === 'combo') {
    const combo = queryOneFn(
      `SELECT id FROM combos WHERE name = ? AND IFNULL(active, 1) = 1 ORDER BY updated_at DESC LIMIT 1`,
      [String(item.product_name || '').trim()],
    );
    if (combo?.id) {
      const comps = queryAll(
        'SELECT product_id, quantity FROM combo_items WHERE combo_id = ?',
        [combo.id],
      );
      if (comps.length) {
        return comps.reduce((sum, c) => {
          const product = queryOneFn('SELECT * FROM products WHERE id = ?', [c.product_id]);
          return sum + estimateInsumoCogsForProduct(product, Number(c.quantity || 0) * qty, queryOneFn);
        }, 0);
      }
    }
  }
  const product = queryOneFn('SELECT * FROM products WHERE id = ?', [item.product_id]);
  return estimateInsumoCogsForProduct(product, qty, queryOneFn);
}

function sumSoldPurchasePriceCogs(dateWhereSql, params = [], queryOneFn = queryOne) {
  try {
    const row = queryOneFn(
      `SELECT COALESCE(SUM(oi.quantity * p.purchase_price), 0) AS total
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN products p ON p.id = oi.product_id
       WHERE ${PAID_ORDER_JOIN}
         AND ${dateWhereSql}
         AND p.purchase_price IS NOT NULL
         AND p.purchase_price > 0
         AND NOT ${PRODUCT_USES_INSUMO_SQL}`,
      params,
    );
    return Number(row?.total || 0);
  } catch (_) {
    return 0;
  }
}

function sumKardexRecordedForPaidOrders(dateWhereSql, params = [], queryOneFn = queryOne) {
  try {
    const row = queryOneFn(
      `SELECT COALESCE(SUM(k.costo_total), 0) AS total
       FROM kardex k
       INNER JOIN orders o ON o.id = k.referencia_id
       WHERE k.tipo_movimiento = 'salida'
         AND k.referencia IN ('venta', 'venta_masa')
         AND ${PAID_ORDER_JOIN}
         AND ${dateWhereSql}`,
      params,
    );
    return Number(row?.total || 0);
  } catch (_) {
    return 0;
  }
}

function estimateKardexCogsFromPaidItems(dateWhereSql, params = []) {
  try {
    const items = queryAll(
      `SELECT oi.product_id, oi.product_name, oi.variant_name, oi.quantity
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       LEFT JOIN products p ON p.id = oi.product_id
       WHERE ${PAID_ORDER_JOIN}
         AND ${dateWhereSql}
         AND (
           LOWER(IFNULL(oi.variant_name, '')) = 'combo'
           OR ${PRODUCT_USES_INSUMO_SQL}
         )`,
      params,
    );
    return (items || []).reduce((sum, item) => sum + estimateComboOrProductInsumoCogs(item), 0);
  } catch (_) {
    return 0;
  }
}

function sumKardexSaleCogs(dateWhereSql, params = [], queryOneFn = queryOne) {
  const recorded = sumKardexRecordedForPaidOrders(dateWhereSql, params, queryOneFn);
  const estimated = estimateKardexCogsFromPaidItems(dateWhereSql, params);
  return recorded > 1e-9 ? recorded : estimated;
}

function sumSalesCogsForRange(from, to, queryOneFn = queryOne) {
  const ps = getPaidSalesEventSql(queryOneFn);
  const orderDate = `${ps.ORDER_DATE} BETWEEN date(?) AND date(?)`;
  const params = [from, to];
  const purchase_cogs = sumSoldPurchasePriceCogs(orderDate, params, queryOneFn);
  const kardex_cogs = sumKardexSaleCogs(orderDate, params, queryOneFn);
  return {
    purchase_cogs,
    kardex_cogs,
    total: purchase_cogs + kardex_cogs,
  };
}

function sumSalesCogsForMonth(queryOneFn = queryOne) {
  const ps = getPaidSalesEventSql(queryOneFn);
  const month = getBusinessMonthKey(queryOneFn);
  const purchase_cogs = sumSoldPurchasePriceCogs(`${ps.ORDER_MONTH} = ${ps.MONTH}`, [], queryOneFn);
  const kardex_cogs = sumKardexSaleCogs(`${ps.ORDER_MONTH} = ${ps.MONTH}`, [], queryOneFn);
  return {
    purchase_cogs,
    kardex_cogs,
    total: purchase_cogs + kardex_cogs,
  };
}

function sumSalesCogsSinceDaysAgo(days, queryOneFn = queryOne) {
  const ps = getPaidSalesEventSql(queryOneFn);
  const n = Math.max(0, Number(days) || 0);
  const dateSql = `${ps.ORDER_DATE} >= date(${ps.TODAY}, '-${n} days')`;
  const purchase_cogs = sumSoldPurchasePriceCogs(dateSql, [], queryOneFn);
  const kardex_cogs = sumKardexSaleCogs(dateSql, [], queryOneFn);
  return {
    purchase_cogs,
    kardex_cogs,
    total: purchase_cogs + kardex_cogs,
  };
}

module.exports = {
  sumSalesCogsForRange,
  sumSalesCogsForMonth,
  sumSalesCogsSinceDaysAgo,
  productHasInsumoLink,
};
