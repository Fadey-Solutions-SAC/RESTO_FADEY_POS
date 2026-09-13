const { v4: uuidv4 } = require('uuid');
const { round2 } = require('../utils/paymentBreakdown');
const { getTableDisplayLabel } = require('../utils/tableDisplayLabel');
const { orderBelongsToTable } = require('./tableOrdersQueryService');

function lineItemSubtotal(it) {
  const qty = Number(it.quantity || 0);
  const unit = Number(it.unit_price ?? 0);
  return Number(it.subtotal != null ? it.subtotal : unit * qty);
}

function sumLinesSubtotal(items) {
  return (items || []).reduce((s, it) => s + lineItemSubtotal(it), 0);
}

function bumpOrderSequenceTx(tx) {
  tx.run('UPDATE order_sequence SET current_number = current_number + 1 WHERE id = 1');
  const r = tx.queryOne('SELECT current_number FROM order_sequence WHERE id = 1');
  return Number(r?.current_number || 0);
}

function recalcOrderMoneyTx(tx, orderId) {
  const items = tx.queryAll('SELECT * FROM order_items WHERE order_id = ?', [orderId]);
  const subtotal = sumLinesSubtotal(items);
  const o = tx.queryOne('SELECT delivery_fee, discount FROM orders WHERE id = ?', [orderId]);
  if (!o) return false;
  if (!items.length) {
    tx.run('DELETE FROM electronic_documents WHERE order_id = ?', [orderId]);
    tx.run('DELETE FROM orders WHERE id = ?', [orderId]);
    return false;
  }
  const delivery = Number(o.delivery_fee || 0);
  const base = Math.max(0, subtotal + delivery);
  const disc = Math.min(Number(o.discount || 0), base);
  const total = Math.max(0, base - disc);
  tx.run(
    `UPDATE orders SET subtotal = ?, tax = 0, discount = ?, total = ?, updated_at = datetime('now') WHERE id = ?`,
    [subtotal, disc, total, orderId],
  );
  return true;
}

function cloneOrderForItemSplitTx(tx, sourceId, newOrderId, newOrderNumber, childDiscount, targetMeta) {
  const saleDocumentNumber = `001-${String(newOrderNumber).padStart(8, '0')}`;
  const tableNumber = targetMeta?.table_number ?? null;
  const tableId = targetMeta?.table_id ?? null;
  const customerName = targetMeta?.customer_name ?? null;
  tx.run(
    `INSERT INTO orders (
      id, order_number, customer_id, customer_name, restaurant_id, type, status,
      subtotal, tax, discount, delivery_fee, total,
      payment_method, payment_status, table_number, table_id, delivery_address, delivery_lat, delivery_lng,
      notes, sale_document_type, sale_document_number, created_by_user_id, created_by_user_name,
      delivery_driver_started_at, delivery_driver_completed_at, delivery_route_driver_id,
      delivery_payment_modality, cancellation_reason, payment_breakdown
    )
    SELECT
      ?, ?, customer_id, COALESCE(?, customer_name), restaurant_id, type, status,
      0, 0, ?, 0, 0,
      payment_method, 'pending', COALESCE(?, table_number), COALESCE(?, table_id), delivery_address, delivery_lat, delivery_lng,
      notes, sale_document_type, ?, created_by_user_id, created_by_user_name,
      delivery_driver_started_at, delivery_driver_completed_at, delivery_route_driver_id,
      delivery_payment_modality, cancellation_reason, NULL
    FROM orders WHERE id = ?`,
    [
      newOrderId,
      newOrderNumber,
      customerName,
      childDiscount,
      tableNumber,
      tableId,
      saleDocumentNumber,
      sourceId,
    ],
  );
}

function splitOrderItemsToTargetTableTx(tx, sourceOrderId, selectedItemIds, targetMeta) {
  const order = tx.queryOne('SELECT * FROM orders WHERE id = ?', [sourceOrderId]);
  if (!order) throw new Error(`Pedido no encontrado: ${sourceOrderId}`);
  if (order.status === 'cancelled') throw new Error(`Pedido anulado: ${order.order_number}`);
  if (order.status === 'delivered' && order.payment_status === 'paid') {
    throw new Error(`El pedido #${order.order_number} ya está cobrado`);
  }

  const allItems = tx.queryAll('SELECT * FROM order_items WHERE order_id = ?', [sourceOrderId]);
  const selSet = new Set(selectedItemIds);
  const moving = allItems.filter((it) => selSet.has(it.id));
  if (!moving.length) throw new Error('No hay productos seleccionados para mover');

  if (moving.length === allItems.length) {
    tx.run(
      `UPDATE orders SET table_number = ?, table_id = ?, customer_name = ?, updated_at = datetime('now') WHERE id = ?`,
      [targetMeta.table_number, targetMeta.table_id, targetMeta.customer_name, sourceOrderId],
    );
    recalcOrderMoneyTx(tx, sourceOrderId);
    return sourceOrderId;
  }

  const oldSub = sumLinesSubtotal(allItems);
  const childSub = sumLinesSubtotal(moving);
  const oldDisc = Number(order.discount || 0);
  const childDisc = oldSub > 0 ? round2(oldDisc * (childSub / oldSub)) : 0;
  const parentDisc = round2(Math.max(0, oldDisc - childDisc));

  const newOrderId = uuidv4();
  const newOrderNumber = bumpOrderSequenceTx(tx);
  cloneOrderForItemSplitTx(tx, sourceOrderId, newOrderId, newOrderNumber, childDisc, targetMeta);

  const ph = moving.map(() => '?').join(',');
  tx.run(`UPDATE order_items SET order_id = ? WHERE id IN (${ph})`, [newOrderId, ...moving.map((m) => m.id)]);

  tx.run('UPDATE orders SET discount = ? WHERE id = ?', [parentDisc, sourceOrderId]);
  recalcOrderMoneyTx(tx, sourceOrderId);
  recalcOrderMoneyTx(tx, newOrderId);
  return newOrderId;
}

/**
 * Mueve productos (order_items) de la mesa origen a la mesa destino.
 * Si se mueven todos los ítems de un pedido, se traslada el pedido completo.
 */
function moveOrderItemsBetweenTablesTx(tx, { sourceTable, targetTable, orderItemIds }) {
  const uniq = [...new Set((orderItemIds || []).map((x) => String(x || '').trim()).filter(Boolean))];
  if (!uniq.length) throw new Error('Selecciona al menos un producto para mover');

  const targetMeta = {
    table_number: String(targetTable.number ?? '').trim(),
    table_id: targetTable.id,
    customer_name: getTableDisplayLabel(targetTable),
  };

  const ph = uniq.map(() => '?').join(',');
  const rows = tx.queryAll(
    `SELECT oi.id AS item_id, oi.order_id, o.status, o.payment_status, o.order_number,
            o.table_id, o.table_number
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE oi.id IN (${ph})`,
    uniq,
  );
  if (rows.length !== uniq.length) {
    throw new Error('Uno o más productos no existen o ya no están en la cuenta');
  }

  for (const row of rows) {
    if (row.status === 'cancelled') {
      throw new Error(`No puedes mover productos del pedido anulado #${row.order_number}`);
    }
    if (row.status === 'delivered' && row.payment_status === 'paid') {
      throw new Error(`El pedido #${row.order_number} ya está cobrado`);
    }
    const pseudoOrder = { table_id: row.table_id, table_number: row.table_number };
    if (!orderBelongsToTable(pseudoOrder, sourceTable)) {
      throw new Error('Los productos seleccionados no pertenecen a la mesa origen');
    }
  }

  const byOrder = new Map();
  for (const row of rows) {
    if (!byOrder.has(row.order_id)) byOrder.set(row.order_id, []);
    byOrder.get(row.order_id).push(row.item_id);
  }

  const movedOrderIds = [];
  const affectedOrderIds = new Set();
  for (const [orderId, itemIds] of byOrder) {
    affectedOrderIds.add(orderId);
    const movedId = splitOrderItemsToTargetTableTx(tx, orderId, itemIds, targetMeta);
    movedOrderIds.push(movedId);
    affectedOrderIds.add(movedId);
  }

  return {
    moved_order_ids: [...new Set(movedOrderIds)],
    moved_item_count: uniq.length,
    affected_order_ids: [...affectedOrderIds],
  };
}

module.exports = {
  moveOrderItemsBetweenTablesTx,
};
