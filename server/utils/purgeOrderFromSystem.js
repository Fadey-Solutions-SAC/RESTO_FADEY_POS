const { withTransaction, queryOne } = require('../database');
const { restoreNonTransformedStockForOrder } = require('../warehouseStock');
const kardexInventory = require('../services/kardexInventoryService');

function tryRun(tx, sql, params = []) {
  try {
    tx.run(sql, params);
  } catch (_) {
    /* tabla o columna opcional */
  }
}

function deleteOrderRelatedRows(tx, orderId) {
  tx.run('DELETE FROM order_items WHERE order_id = ?', [orderId]);
  tx.run('DELETE FROM electronic_documents WHERE order_id = ?', [orderId]);
  tx.run('DELETE FROM delivery_assignments WHERE order_id = ?', [orderId]);
  tryRun(tx, 'DELETE FROM finance_loss_events WHERE order_id = ?', [orderId]);
  tryRun(tx, 'DELETE FROM order_station_state WHERE order_id = ?', [orderId]);
  tryRun(tx, 'DELETE FROM operational_delay_events WHERE order_id = ?', [orderId]);
  tryRun(tx, 'DELETE FROM order_product_removals WHERE order_id = ?', [orderId]);
  tryRun(tx, 'UPDATE tables SET current_order_id = NULL WHERE current_order_id = ?', [orderId]);
}

/**
 * Quita el pedido y sus rastros (ítems, comprobantes, observaciones, cocina, delivery).
 * Si no estaba anulado, revierte kardex y stock de almacén.
 */
function purgeOrdersFromSystem(orders, { userId } = {}) {
  const list = (Array.isArray(orders) ? orders : []).filter((o) => o?.id);
  if (!list.length) return { deleted: [] };

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
      deleteOrderRelatedRows(tx, order.id);
      tx.run('DELETE FROM orders WHERE id = ?', [order.id]);
    }
  });

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
