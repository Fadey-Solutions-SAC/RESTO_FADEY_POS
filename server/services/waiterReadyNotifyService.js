/**
 * Aviso al mozo que tomó el pedido cuando un área lo marca LISTO («Pedido Mesa 5 está listo»).
 * Se envía solo a su sala de socket (`staff-<id>`), nunca a todo el personal.
 */
const { attachTableDisplayLabels } = require('../utils/tableDisplayLabel');
const { readProductionAreas } = require('./productionAreasService');
const { getOrderItemsWithProductionArea } = require('./orderItemsProductionService');
const { collectOrderProductionAreaIds } = require('../utils/productionArea');
const { isStationCompleteForStation } = require('../utils/kitchenStationReady');

function orderPlaceLabel(order) {
  const type = String(order?.type || '').trim();
  if (type === 'dine_in') {
    const copy = { ...order };
    attachTableDisplayLabels(copy);
    if (copy.table_display_label) return copy.table_display_label;
    const num = String(order?.table_number || '').trim();
    return num ? `Mesa ${num}` : 'Mesa';
  }
  if (type === 'delivery') return 'Delivery';
  if (type === 'takeaway' || type === 'pickup' || type === 'para_llevar') return 'Para llevar';
  return 'Pedido';
}

function areaName(areaId) {
  const id = String(areaId || '').trim();
  return readProductionAreas().find((a) => a.id === id)?.name || (id ? id.charAt(0).toUpperCase() + id.slice(1) : '');
}

/**
 * @param {*} io
 * @param {object} order Pedido actualizado (con items).
 * @param {{ station?: string, actorUserId?: string }} [opts]
 */
function notifyWaiterOrderReady(io, order, { station = '', actorUserId = '' } = {}) {
  try {
    const waiterId = String(order?.created_by_user_id || '').trim();
    if (!io || !order?.id || !waiterId) return null;
    if (actorUserId && String(actorUserId) === waiterId) return null;

    const areaItems = getOrderItemsWithProductionArea(order.id);
    const areaIds = collectOrderProductionAreaIds(areaItems);
    const pendingAreas = areaIds.filter((aid) => !isStationCompleteForStation(order, areaItems, aid));
    const allReady = pendingAreas.length === 0;
    const place = orderPlaceLabel(order);
    const stationName = areaName(station);
    const orderNumber = order.order_number != null ? String(order.order_number) : '';

    const payload = {
      order_id: order.id,
      order_number: orderNumber,
      type: order.type || '',
      table_number: order.table_number || '',
      place,
      station: station || '',
      station_name: stationName,
      all_ready: allReady,
      pending_areas: pendingAreas.map(areaName),
      message: allReady
        ? `Pedido ${place} está listo`
        : `${stationName ? `${stationName}: ` : ''}${place} está listo (falta ${pendingAreas.map(areaName).join(', ')})`,
      at: new Date().toISOString(),
    };
    io.to(`staff-${waiterId}`).emit('waiter-order-ready', payload);
    return payload;
  } catch (err) {
    console.error('[waiter-ready-notify]', err?.message || err);
    return null;
  }
}

module.exports = { notifyWaiterOrderReady, orderPlaceLabel };
