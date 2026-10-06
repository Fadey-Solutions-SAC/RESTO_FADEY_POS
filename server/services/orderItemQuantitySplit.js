const { v4: uuidv4 } = require('uuid');
const { round2 } = require('../utils/paymentBreakdown');

function lineItemSubtotal(it) {
  const qty = Number(it.quantity || 0);
  const unit = Number(it.unit_price ?? 0);
  return Number(it.subtotal != null ? it.subtotal : unit * qty);
}

/**
 * Si se toman menos unidades que la línea (cobro o traslado parcial), deja el remanente en un ítem nuevo
 * (mismo pedido) y reduce la línea original a la cantidad tomada (conserva el id para anclas de descuento).
 * @returns {string[]} ids de líneas listas para mover/cobrar
 */
function materializePartialItemQuantitiesTx(tx, orderId, itemIds, quantitiesByItemId) {
  const qtyMap = quantitiesByItemId && typeof quantitiesByItemId === 'object' ? quantitiesByItemId : {};
  const movingIds = [];

  for (const itemId of itemIds) {
    const it = tx.queryOne('SELECT * FROM order_items WHERE id = ? AND order_id = ?', [itemId, orderId]);
    if (!it) throw new Error('Línea de pedido no encontrada al dividir cantidad');

    const maxQ = Math.max(1, Math.floor(Number(it.quantity) || 1));
    const raw = qtyMap[itemId];
    let takeQ = raw == null || raw === '' ? maxQ : Math.floor(Number(raw));
    if (!Number.isFinite(takeQ) || takeQ < 1) {
      throw new Error(`Cantidad inválida en «${it.product_name || 'producto'}»`);
    }
    if (takeQ > maxQ) takeQ = maxQ;

    if (takeQ >= maxQ) {
      movingIds.push(itemId);
      continue;
    }

    const unit = Number(it.unit_price || 0);
    const origSub = lineItemSubtotal(it);
    const moveSub = round2((origSub * takeQ) / maxQ);
    const remainQ = maxQ - takeQ;
    const remainSub = round2(origSub - moveSub);
    const remainId = uuidv4();

    const promoDiscount = Number(it.promo_discount || 0);
    const movePromo = round2((promoDiscount * takeQ) / maxQ);
    tx.run(
      `INSERT INTO order_items (
        id, order_id, product_id, product_name, variant_name, quantity, unit_price, subtotal, notes,
        original_unit_price, promo_discount, promotion_id, promotion_label,
        station_cocina_ready_at, station_bar_ready_at, kitchen_highlight_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        remainId,
        orderId,
        it.product_id,
        it.product_name,
        it.variant_name || '',
        remainQ,
        unit,
        remainSub,
        it.notes || '',
        it.original_unit_price != null ? it.original_unit_price : unit,
        round2(promoDiscount - movePromo),
        it.promotion_id || '',
        it.promotion_label || '',
        it.station_cocina_ready_at || null,
        it.station_bar_ready_at || null,
        it.kitchen_highlight_at || null,
      ]
    );
    tx.run('UPDATE order_items SET quantity = ?, subtotal = ?, promo_discount = ? WHERE id = ?', [takeQ, moveSub, movePromo, itemId]);
    movingIds.push(itemId);
  }

  return movingIds;
}

module.exports = { materializePartialItemQuantitiesTx };
