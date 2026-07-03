/**
 * Ventas cobradas asociadas a un turno de caja (apertura → cierre o ahora).
 */
const { queryAll, queryOne } = require('../database');
const { addOrderToSalesTotals } = require('../utils/paymentBreakdown');

const SALES_EVENT_AT_SQL = 'COALESCE(paid_at, updated_at, created_at)';

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function normalizeRegisterArg(registerOrOpenedAt) {
  if (registerOrOpenedAt && typeof registerOrOpenedAt === 'object') {
    return {
      id: String(registerOrOpenedAt.id || '').trim(),
      opened_at: registerOrOpenedAt.opened_at,
      closed_at: registerOrOpenedAt.closed_at || null,
    };
  }
  return {
    id: '',
    opened_at: registerOrOpenedAt,
    closed_at: null,
  };
}

function buildRegisterSalesSql(register) {
  const id = String(register?.id || '').trim();
  const openedAt = register?.opened_at;
  const closedAt = register?.closed_at || null;
  if (!openedAt) return null;

  const baseWhere = `status != 'cancelled'
    AND payment_status = 'paid'
    AND IFNULL(payment_method, '') NOT IN ('cortesia', 'cuenta_cliente')`;

  if (id) {
    const params = [id, openedAt];
    let legacyEnd = '';
    if (closedAt) {
      legacyEnd = ` AND ${SALES_EVENT_AT_SQL} <= ?`;
      params.push(closedAt);
    }
    return {
      sql: `SELECT total, payment_method, payment_breakdown, tip_amount
            FROM orders
            WHERE ${baseWhere}
              AND (
                IFNULL(cash_register_id, '') = ?
                OR (
                  IFNULL(cash_register_id, '') = ''
                  AND ${SALES_EVENT_AT_SQL} >= ?${legacyEnd}
                )
              )`,
      params,
    };
  }

  const params = [openedAt];
  let endSql = '';
  if (closedAt) {
    endSql = ` AND ${SALES_EVENT_AT_SQL} <= ?`;
    params.push(closedAt);
  }
  return {
    sql: `SELECT total, payment_method, payment_breakdown, tip_amount
          FROM orders
          WHERE ${baseWhere}
            AND ${SALES_EVENT_AT_SQL} >= ?${endSql}`,
    params,
  };
}

function emptySalesTotals() {
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

/** Pedidos pagados del turno (preferir cash_register_id; legacy por fecha). */
function queryRegisterSessionSales(registerOrOpenedAt) {
  const register = normalizeRegisterArg(registerOrOpenedAt);
  const built = buildRegisterSalesSql(register);
  if (!built) return emptySalesTotals();
  const rows = queryAll(built.sql, built.params) || [];
  return aggregatePaidOrders(rows);
}

/** Pedidos pagados dentro de un turno ya cerrado. */
function queryRegisterSessionSalesBetween(openedAt, closedAt, registerId = '') {
  const sales = queryRegisterSessionSales({
    id: registerId,
    opened_at: openedAt,
    closed_at: closedAt,
  });
  return {
    total_sales: sales.total_sales,
    order_count: sales.order_count,
  };
}

function getMovementTotals(registerId) {
  return queryOne(
    `SELECT
      COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as total_income,
      COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as total_expense
     FROM cash_movements
     WHERE register_id = ?`,
    [registerId],
  ) || { total_income: 0, total_expense: 0 };
}

function getCashNoteTotals(registerId) {
  const row = queryOne(
    `SELECT
      COALESCE(SUM(CASE WHEN note_type = 'credit' THEN amount ELSE 0 END), 0) as notes_credit,
      COALESCE(SUM(CASE WHEN note_type = 'debit' THEN amount ELSE 0 END), 0) as notes_debit
     FROM cash_notes
     WHERE register_id = ?`,
    [registerId],
  ) || { notes_credit: 0, notes_debit: 0 };
  return {
    notes_credit: round2(Number(row.notes_credit || 0)),
    notes_debit: round2(Number(row.notes_debit || 0)),
  };
}

/** Efectivo que debe haber en caja al arqueo (solo efectivo físico + propinas en caja). */
function computeExpectedCash(register, sales, movements, notes) {
  return round2(
    Number(register?.opening_amount || 0)
      + Number(sales?.total_cash || 0)
      + Number(sales?.total_tips || 0)
      + Number(movements?.total_income || 0)
      - Number(movements?.total_expense || 0)
      + Number(notes?.notes_credit || 0)
      - Number(notes?.notes_debit || 0),
  );
}

module.exports = {
  queryRegisterSessionSales,
  queryRegisterSessionSalesBetween,
  getMovementTotals,
  getCashNoteTotals,
  computeExpectedCash,
  SALES_EVENT_AT_SQL,
};
