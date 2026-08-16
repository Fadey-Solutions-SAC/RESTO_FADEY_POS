const { queryAll, queryOne, ensureOrdersPaidAtColumns } = require('../database');
const {
  SALES_ADJUSTMENT_WHERE_SQL,
  classifySalesAdjustment,
  parseAdjustmentReasonFromNotes,
  adjustmentDiscountAmount,
  adjustmentAmountCharged,
} = require('../businessRules');
const { orderHasKardexVenta } = require('./kardexBackfillService');
const { listProductRemovals, enrichRemovalForReport } = require('./productRemovalLogService');
const { sqlBusinessTimestamp } = require('../utils/appDateTime');
const { paidAtSql } = require('../utils/salesAccountGrouping');

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function enrichAdjustmentOrder(o) {
  const items = queryAll('SELECT * FROM order_items WHERE order_id = ?', [o.id]);
  const kind = classifySalesAdjustment(o);
  const discountAmount = adjustmentDiscountAmount(o);
  const amountCharged = adjustmentAmountCharged(o);
  const grossSubtotal = Math.max(0, Number(o.subtotal || 0) + Number(o.delivery_fee || 0));
  return {
    ...o,
    items,
    adjustment_kind: kind,
    adjustment_reason: parseAdjustmentReasonFromNotes(o.notes),
    discount_amount: discountAmount,
    amount_charged: amountCharged,
    gross_subtotal: grossSubtotal,
    reference_amount: discountAmount,
    kardex_applied: orderHasKardexVenta(o.id),
    sales_money_impact: kind === 'cortesia' ? 0 : amountCharged,
  };
}

function listSalesAdjustments({ from, to, limit = 500 } = {}) {
  ensureOrdersPaidAtColumns();
  const eventAt = paidAtSql('');
  const eventDate = `DATE(${sqlBusinessTimestamp(eventAt, queryOne)})`;
  const params = [];
  let dateSql = '';
  if (from) {
    dateSql += ` AND ${eventDate} >= date(?)`;
    params.push(from);
  }
  if (to) {
    dateSql += ` AND ${eventDate} <= date(?)`;
    params.push(to);
  }
  const cap = Math.min(Math.max(Number(limit) || 500, 1), 2000);
  const rows = queryAll(
    `SELECT * FROM orders
     WHERE status != 'cancelled'
       AND payment_status = 'paid'
       AND ${SALES_ADJUSTMENT_WHERE_SQL}
       ${dateSql}
     ORDER BY ${eventAt} DESC
     LIMIT ${cap}`,
    params
  );
  const orderRows = (rows || []).map(enrichAdjustmentOrder);
  const removalRows = listProductRemovals({ from, to, limit: cap }).map(enrichRemovalForReport);
  return [...orderRows, ...removalRows]
    .sort((a, b) => {
      const ta = new Date(
        a.row_source === 'product_removal'
          ? (a.created_at || a.updated_at || 0)
          : (a.paid_at || a.created_at || a.updated_at || 0),
      ).getTime();
      const tb = new Date(
        b.row_source === 'product_removal'
          ? (b.created_at || b.updated_at || 0)
          : (b.paid_at || b.created_at || b.updated_at || 0),
      ).getTime();
      if (ta !== tb) return ta - tb;
      return String(a.id || '').localeCompare(String(b.id || ''));
    })
    .slice(0, cap);
}

function summarizeSalesAdjustments(orders = []) {
  let courtesyCount = 0;
  let discountCount = 0;
  let eliminadoCount = 0;
  let courtesyReference = 0;
  let discountAmountTotal = 0;
  let eliminadoReference = 0;
  let amountChargedTotal = 0;
  let kardexPending = 0;

  for (const o of orders) {
    const kind = o.adjustment_kind || classifySalesAdjustment(o);
    const disc = Number(o.discount_amount ?? adjustmentDiscountAmount(o));
    const charged = Number(o.amount_charged ?? adjustmentAmountCharged(o));
    if (kind === 'cortesia') {
      courtesyCount += 1;
      courtesyReference += disc;
    } else if (kind === 'descuento') {
      discountCount += 1;
      discountAmountTotal += disc;
      amountChargedTotal += charged;
    } else if (kind === 'eliminado') {
      eliminadoCount += 1;
      eliminadoReference += Number(o.reference_amount ?? o.discount_amount ?? disc);
    }
    if (kind !== 'eliminado' && !o.kardex_applied) kardexPending += 1;
  }

  return {
    count: orders.length,
    courtesy_count: courtesyCount,
    discount_count: discountCount,
    eliminado_count: eliminadoCount,
    courtesy_reference_total: round2(courtesyReference),
    discount_amount_total: round2(discountAmountTotal),
    eliminado_reference_total: round2(eliminadoReference),
    amount_charged_total: round2(amountChargedTotal),
    /** Monto que NO ingresa como venta adicional (cortesías + parte descontada). */
    not_counted_as_extra_sales: round2(courtesyReference + discountAmountTotal),
    kardex_pending: kardexPending,
  };
}

module.exports = {
  listSalesAdjustments,
  summarizeSalesAdjustments,
  SALES_ADJUSTMENT_WHERE_SQL,
};
