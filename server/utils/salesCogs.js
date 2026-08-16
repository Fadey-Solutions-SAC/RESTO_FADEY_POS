/**
 * Costo de venta del período:
 * - productos con precio de compra (sin receta/insumo kardex)
 * - insumos descontados en kardex al cobrar (receta o vínculo directo)
 */
const { queryOne } = require('../database');
const { getPaidSalesEventSql } = require('./salesAccountGrouping');
const { sqlBusinessTimestamp, getBusinessMonthKey } = require('./appDateTime');

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

function kardexBusinessDateSql(queryOneFn = queryOne) {
  return `DATE(${sqlBusinessTimestamp('COALESCE(fecha, created_at)', queryOneFn)})`;
}

function kardexBusinessMonthSql(queryOneFn = queryOne) {
  return `strftime('%Y-%m', ${sqlBusinessTimestamp('COALESCE(fecha, created_at)', queryOneFn)})`;
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

function sumKardexSaleCogs(dateWhereSql, params = [], queryOneFn = queryOne) {
  try {
    const row = queryOneFn(
      `SELECT COALESCE(SUM(costo_total), 0) AS total FROM kardex
       WHERE tipo_movimiento = 'salida'
         AND referencia IN ('venta', 'venta_masa')
         AND ${dateWhereSql}`,
      params,
    );
    return Number(row?.total || 0);
  } catch (_) {
    return 0;
  }
}

function sumSalesCogsForRange(from, to, queryOneFn = queryOne) {
  const ps = getPaidSalesEventSql(queryOneFn);
  const orderDate = `${ps.ORDER_DATE} BETWEEN date(?) AND date(?)`;
  const kDate = `${kardexBusinessDateSql(queryOneFn)} BETWEEN date(?) AND date(?)`;
  const params = [from, to];
  const purchase_cogs = sumSoldPurchasePriceCogs(orderDate, params, queryOneFn);
  const kardex_cogs = sumKardexSaleCogs(kDate, params, queryOneFn);
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
  const kardex_cogs = sumKardexSaleCogs(`${kardexBusinessMonthSql(queryOneFn)} = ?`, [month], queryOneFn);
  return {
    purchase_cogs,
    kardex_cogs,
    total: purchase_cogs + kardex_cogs,
  };
}

function sumSalesCogsSinceDaysAgo(days, queryOneFn = queryOne) {
  const ps = getPaidSalesEventSql(queryOneFn);
  const n = Math.max(0, Number(days) || 0);
  const purchase_cogs = sumSoldPurchasePriceCogs(
    `${ps.ORDER_DATE} >= date(${ps.TODAY}, '-${n} days')`,
    [],
    queryOneFn,
  );
  const kardex_cogs = sumKardexSaleCogs(
    `${kardexBusinessDateSql(queryOneFn)} >= date(${ps.TODAY}, '-${n} days')`,
    [],
    queryOneFn,
  );
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
};
