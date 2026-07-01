const { v4: uuidv4 } = require('uuid');
const { queryAll, runSql } = require('../database');

const REMOVAL_DATE_SQL = "DATE(datetime(created_at, 'localtime'))";

function insertProductRemovals(removals, order, actor, removalReason) {
  const reason = String(removalReason || '').trim() || 'Sin motivo registrado';
  const actorId = String(actor?.user?.id || actor?.id || '').trim();
  const actorName = String(
    actor?.user?.full_name || actor?.user?.username || actor?.full_name || actor?.username || '',
  ).trim();
  for (const row of removals || []) {
    const qty = Math.max(0, Number(row.quantity_removed || 0));
    if (qty <= 0) continue;
    runSql(
      `INSERT INTO order_product_removals (
        id, order_id, order_number, product_id, product_name, quantity_removed,
        unit_price, line_total, removal_reason, table_number, order_type,
        actor_user_id, actor_name, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        uuidv4(),
        String(order?.id || '').trim(),
        Number(order?.order_number || 0) || null,
        String(row.product_id || '').trim() || null,
        String(row.product_name || 'Producto').trim() || 'Producto',
        qty,
        Number(row.unit_price || 0),
        Number(row.line_total || 0),
        reason,
        String(order?.table_number || '').trim() || null,
        String(order?.type || '').trim() || null,
        actorId || null,
        actorName || null,
      ],
    );
  }
}

function listProductRemovals({ from, to, limit = 500 } = {}) {
  const params = [];
  let dateSql = '';
  if (from) {
    dateSql += ` AND ${REMOVAL_DATE_SQL} >= date(?)`;
    params.push(from);
  }
  if (to) {
    dateSql += ` AND ${REMOVAL_DATE_SQL} <= date(?)`;
    params.push(to);
  }
  const cap = Math.min(Math.max(Number(limit) || 500, 1), 2000);
  return queryAll(
    `SELECT * FROM order_product_removals
     WHERE 1=1 ${dateSql}
     ORDER BY created_at DESC
     LIMIT ${cap}`,
    params,
  );
}

function enrichRemovalForReport(row) {
  const lineTotal = Number(row.line_total || 0);
  return {
    id: row.id,
    row_source: 'product_removal',
    adjustment_kind: 'eliminado',
    order_id: row.order_id,
    order_number: row.order_number,
    table_number: row.table_number,
    type: row.order_type || 'dine_in',
    created_by_user_name: row.actor_name || '—',
    customer_name: '',
    updated_at: row.created_at,
    created_at: row.created_at,
    adjustment_reason: row.removal_reason || '',
    reference_amount: lineTotal,
    discount_amount: lineTotal,
    amount_charged: 0,
    items: [
      {
        product_id: row.product_id,
        product_name: row.product_name,
        quantity: Number(row.quantity_removed || 0),
        unit_price: Number(row.unit_price || 0),
        subtotal: lineTotal,
      },
    ],
    kardex_applied: null,
    sales_money_impact: 0,
    payment_status: 'n/a',
    status: 'logged',
  };
}

function deleteProductRemoval(id) {
  runSql('DELETE FROM order_product_removals WHERE id = ?', [id]);
}

module.exports = {
  insertProductRemovals,
  listProductRemovals,
  enrichRemovalForReport,
  deleteProductRemoval,
};
