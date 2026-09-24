const { withTransaction, queryOne, queryAll, runSql } = require('../database');
const { restoreNonTransformedStockForOrder } = require('../warehouseStock');
const kardexInventory = require('../services/kardexInventoryService');

function tryRun(tx, sql, params = []) {
  try {
    tx.run(sql, params);
  } catch (_) {
    /* tabla o columna opcional */
  }
}

function deleteOrderRelatedRows(tx, orderId, orderNumber) {
  const oid = String(orderId || '');
  const onum = String(orderNumber || '');

  tx.run('DELETE FROM order_items WHERE order_id = ?', [oid]);
  tx.run('DELETE FROM electronic_documents WHERE order_id = ?', [oid]);
  tx.run('DELETE FROM delivery_assignments WHERE order_id = ?', [oid]);
  tryRun(tx, 'DELETE FROM finance_loss_events WHERE order_id = ?', [oid]);
  tryRun(tx, 'DELETE FROM order_station_state WHERE order_id = ?', [oid]);
  tryRun(tx, 'DELETE FROM operational_delay_events WHERE order_id = ?', [oid]);
  tryRun(tx, 'DELETE FROM order_product_removals WHERE order_id = ?', [oid]);
  tryRun(tx, 'DELETE FROM kitchen_ticket_prints WHERE order_id = ?', [oid]);
  tryRun(tx, 'DELETE FROM print_jobs WHERE order_id = ?', [oid]);
  tryRun(tx, 'UPDATE tables SET current_order_id = NULL WHERE current_order_id = ?', [oid]);

  // Actividad / auditoría ligada al pedido (sin dejar rastro).
  tryRun(tx, 'DELETE FROM user_work_activity_events WHERE ref_id = ?', [oid]);
  if (onum) {
    tryRun(tx, "DELETE FROM user_work_activity_events WHERE IFNULL(meta, '') LIKE ?", [`%${onum}%`]);
  }
  tryRun(
    tx,
    `DELETE FROM audit_logs
     WHERE resource_id = ?
        OR resource_id LIKE ?
        OR IFNULL(details, '') LIKE ?`,
    [oid, `%${oid}%`, `%"${oid}"%`],
  );
}

function refreshProductSalesAfterPurge(productIds) {
  const ids = [...new Set((productIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  for (const pid of ids) {
    const lastSale = queryOne(
      `SELECT MAX(datetime(COALESCE(o.paid_at, o.updated_at, o.created_at))) AS sold_at
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE oi.product_id = ?
         AND o.status != 'cancelled'
         AND o.payment_status = 'paid'`,
      [pid],
    );
    if (lastSale?.sold_at) {
      runSql(
        `UPDATE products
         SET last_paid_sale_at = ?,
             idle_sales_days = MAX(0, CAST(
               julianday(date('now', 'localtime'))
               - julianday(date(?, 'localtime'))
             AS INTEGER)),
             updated_at = datetime('now')
         WHERE id = ?`,
        [lastSale.sold_at, lastSale.sold_at, pid],
      );
    } else {
      runSql(
        `UPDATE products
         SET last_paid_sale_at = NULL,
             idle_sales_days = MAX(0, CAST(
               julianday(date('now', 'localtime'))
               - julianday(date(COALESCE(catalog_listed_at, created_at), 'localtime'))
             AS INTEGER)),
             updated_at = datetime('now')
         WHERE id = ?`,
        [pid],
      );
    }
  }
}

/**
 * Quita el pedido y sus rastros (ítems, comprobantes, observaciones, cocina, delivery, auditoría).
 * Revierte kardex y stock. No deja venta anulada ni registro de la eliminación.
 */
function purgeOrdersFromSystem(orders, { userId } = {}) {
  const list = (Array.isArray(orders) ? orders : []).filter((o) => o?.id);
  if (!list.length) return { deleted: [] };

  const productIds = [];
  for (const order of list) {
    const items = queryAll(
      `SELECT DISTINCT TRIM(product_id) AS product_id
       FROM order_items
       WHERE order_id = ? AND product_id IS NOT NULL AND TRIM(product_id) != ''`,
      [order.id],
    ) || [];
    items.forEach((r) => {
      if (r?.product_id) productIds.push(String(r.product_id));
    });
  }

  const needStock = list.filter((o) => String(o.status || '') !== 'cancelled');
  if (needStock.length) {
    withTransaction((tx) => {
      for (const order of needStock) {
        kardexInventory.revertirSalidasVentaPedido(tx, order.id, userId);
      }
    });
    for (const order of needStock) {
      restoreNonTransformedStockForOrder(order.id);
    }
  }

  withTransaction((tx) => {
    for (const order of list) {
      deleteOrderRelatedRows(tx, order.id, order.order_number);
      tx.run('DELETE FROM orders WHERE id = ?', [order.id]);
    }
  });

  try {
    refreshProductSalesAfterPurge(productIds);
  } catch (_) {
    /* no bloquear purga */
  }

  return { deleted: list.map((o) => o.id) };
}

function loadOrdersByIds(ids) {
  const unique = [...new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean))];
  return unique.map((id) => queryOne('SELECT * FROM orders WHERE id = ?', [id])).filter(Boolean);
}

module.exports = {
  deleteOrderRelatedRows,
  purgeOrdersFromSystem,
  loadOrdersByIds,
};
