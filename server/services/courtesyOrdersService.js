const { queryAll } = require('../database');
const {
  COURTESY_ORDER_WHERE_SQL,
  parseCourtesyReasonFromNotes,
  courtesyReferenceAmount,
} = require('../businessRules');

const SALES_EVENT_AT_SQL = 'COALESCE(updated_at, created_at)';
const SALES_EVENT_LOCAL_SQL = `datetime(${SALES_EVENT_AT_SQL}, 'localtime')`;
const SALES_EVENT_DATE_SQL = `DATE(${SALES_EVENT_LOCAL_SQL})`;

function listCourtesyOrders({ from, to, limit = 500 } = {}) {
  const params = [];
  let dateSql = '';
  if (from) {
    dateSql += ` AND ${SALES_EVENT_DATE_SQL} >= date(?)`;
    params.push(from);
  }
  if (to) {
    dateSql += ` AND ${SALES_EVENT_DATE_SQL} <= date(?)`;
    params.push(to);
  }
  const cap = Math.min(Math.max(Number(limit) || 500, 1), 2000);
  const rows = queryAll(
    `SELECT * FROM orders
     WHERE status != 'cancelled'
       AND ${COURTESY_ORDER_WHERE_SQL}
       ${dateSql}
     ORDER BY ${SALES_EVENT_AT_SQL} DESC
     LIMIT ${cap}`,
    params
  );
  return (rows || []).map((o) => {
    const items = queryAll('SELECT * FROM order_items WHERE order_id = ?', [o.id]);
    const referenceAmount = courtesyReferenceAmount(o);
    return {
      ...o,
      items,
      courtesy_reason: parseCourtesyReasonFromNotes(o.notes),
      reference_amount: referenceAmount,
      amount_charged: 0,
    };
  });
}

function summarizeCourtesyOrders(orders = []) {
  const referenceTotal = orders.reduce((s, o) => s + Number(o.reference_amount || 0), 0);
  return {
    count: orders.length,
    reference_total: Math.round((referenceTotal + Number.EPSILON) * 100) / 100,
    money_impact: 0,
  };
}

module.exports = {
  listCourtesyOrders,
  summarizeCourtesyOrders,
  COURTESY_ORDER_WHERE_SQL,
};
