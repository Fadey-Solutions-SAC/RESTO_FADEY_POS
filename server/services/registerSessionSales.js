/**
 * Ventas cobradas asociadas a un turno de caja (apertura → cierre o ahora).
 */
const { queryAll, queryOne } = require('../database');
const { addOrderToSalesTotals } = require('../utils/paymentBreakdown');

const SALES_EVENT_AT_SQL = 'COALESCE(updated_at, created_at)';

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function aggregatePaidOrders(rows) {
  const totals = {
    total_sales: 0,
    total_cash: 0,
    total_yape: 0,
    total_plin: 0,
    total_card: 0,
    total_online: 0,
    total_tips: 0,
    order_count: 0,
  };
  (rows || []).forEach((row) => {
    totals.order_count += 1;
    addOrderToSalesTotals(row, totals);
  });
  return {
    total_sales: round2(totals.total_sales),
    total_cash: round2(totals.total_cash),
    total_yape: round2(totals.total_yape),
    total_plin: round2(totals.total_plin),
    total_card: round2(totals.total_card),
    total_online: round2(totals.total_online),
    total_tips: round2(Number(totals.total_tips || 0)),
    order_count: Number(totals.order_count || 0),
  };
}

/** Pedidos pagados desde la apertura del turno (caja abierta). */
function queryRegisterSessionSales(openedAt) {
  if (!openedAt) {
    return {
      total_sales: 0,
      total_cash: 0,
      total_yape: 0,
      total_plin: 0,
      total_card: 0,
      total_online: 0,
      total_tips: 0,
      order_count: 0,
    };
  }
  const rows =
    queryAll(
      `SELECT total, payment_method, payment_breakdown, tip_amount
       FROM orders
       WHERE ${SALES_EVENT_AT_SQL} >= ?
         AND status != 'cancelled'
         AND payment_status = 'paid'
         AND IFNULL(payment_method, '') != 'cortesia'`,
      [openedAt]
    ) || [];
  return aggregatePaidOrders(rows);
}

/** Pedidos pagados dentro de un turno ya cerrado. */
function queryRegisterSessionSalesBetween(openedAt, closedAt) {
  if (!openedAt) {
    return {
      total_sales: 0,
      order_count: 0,
    };
  }
  const params = [openedAt];
  let endSql = '';
  if (closedAt) {
    endSql = ` AND ${SALES_EVENT_AT_SQL} <= ?`;
    params.push(closedAt);
  }
  const row = queryOne(
    `SELECT COUNT(*) AS order_count, COALESCE(SUM(total), 0) AS total_sales
     FROM orders
     WHERE ${SALES_EVENT_AT_SQL} >= ?
       AND status != 'cancelled'
       AND payment_status = 'paid'
       AND IFNULL(payment_method, '') != 'cortesia'${endSql}`,
    params
  );
  return {
    total_sales: round2(Number(row?.total_sales || 0)),
    order_count: Number(row?.order_count || 0),
  };
}

module.exports = {
  queryRegisterSessionSales,
  queryRegisterSessionSalesBetween,
};
