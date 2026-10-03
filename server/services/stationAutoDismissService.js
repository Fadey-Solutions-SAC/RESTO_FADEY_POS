/**
 * Retira comandas que llevan X min sin PREPARAR ni LISTO en un área de producción
 * (solo áreas con el retiro automático activado en sus ajustes).
 */
const { queryAll, queryOne, runSql, logAudit } = require('../database');
const { getOrderWithItems } = require('../orderCreateService');
const { getOrderItemsWithProductionArea: getOrderItemsWithArea } = require('./orderItemsProductionService');
const { upsertOrderStationState } = require('./productionAreasService');
const {
  allRequiredStationsReady,
  getStationPreparingColumn,
  getStationReadyColumn,
  isLegacyStation,
  isStationMarkedPreparing,
  isStationMarkedReady,
  orderHasStationWork,
} = require('../utils/kitchenStationReady');
const { readAllAreaSettings } = require('./productionAreaSettingsService');
const { sqlBusinessNowExpr } = require('../utils/appDateTime');

function markStationReady(order, areaId, { io, reason = 'manual', minutes = null } = {}) {
  const orderId = order?.id;
  if (!orderId || isStationMarkedReady(order, areaId)) return null;

  if (isLegacyStation(areaId)) {
    runSql(
      `UPDATE orders SET ${getStationReadyColumn(areaId)} = datetime('now'), ${getStationPreparingColumn(areaId)} = NULL,
        updated_at = datetime('now') WHERE id = ?`,
      [orderId],
    );
  }
  upsertOrderStationState(orderId, areaId, {
    ready_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    preparing_at: null,
  });

  const refreshed = queryOne('SELECT * FROM orders WHERE id = ?', [orderId]);
  const refreshedItems = getOrderItemsWithArea(orderId);
  if (allRequiredStationsReady(refreshed, refreshedItems)) {
    const nextStatus = String(refreshed.payment_status || '') === 'paid' ? 'delivered' : 'ready';
    runSql("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?", [nextStatus, orderId]);
    if (order.type === 'delivery' && nextStatus === 'delivered') {
      runSql(
        "UPDATE delivery_assignments SET status = 'delivered', delivered_at = datetime('now') WHERE order_id = ? AND status != 'delivered'",
        [orderId],
      );
    }
  } else if (refreshed.status === 'pending') {
    runSql(
      "UPDATE orders SET status = 'preparing', preparing_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      [orderId],
    );
  }

  const updated = getOrderWithItems(orderId);
  if (io) {
    io.emit('order-update', updated);
    io.emit('order-ready', updated);
    if (reason === 'auto_dismiss') {
      io.emit('station-auto-dismiss', { areaId, orderId, order: updated, minutes });
    }
  }

  if (reason === 'auto_dismiss') {
    try {
      logAudit({
        actorUserId: '',
        actorName: 'Sistema (retiro automático)',
        action: 'order.station.auto_dismiss',
        resourceType: 'order',
        resourceId: orderId,
        details: { station: areaId, minutes },
      });
    } catch (_) {
      /* noop */
    }
  }

  return updated;
}

function processAreaAutoDismiss(areaId, minutes, { io } = {}) {
  const nowExpr = sqlBusinessNowExpr(queryOne);
  const orders = queryAll(`
    SELECT * FROM orders
    WHERE status IN ('pending', 'preparing', 'ready')
      AND IFNULL(TRIM(payment_status), 'pending') != 'paid'
      AND (
        kitchen_release_at IS NULL
        OR trim(kitchen_release_at) = ''
        OR datetime(kitchen_release_at) <= ${nowExpr}
      )
      AND kitchen_last_send_at IS NOT NULL
      AND trim(kitchen_last_send_at) != ''
      AND ((julianday('now') - julianday(trim(kitchen_last_send_at))) * 1440) >= ?
  `, [minutes]);

  const dismissed = [];
  for (const order of orders) {
    const areaItems = getOrderItemsWithArea(order.id);
    if (!orderHasStationWork(areaItems, areaId)) continue;
    if (isStationMarkedReady(order, areaId)) continue;
    if (isStationMarkedPreparing(order, areaId)) continue;
    markStationReady(order, areaId, { io, reason: 'auto_dismiss', minutes });
    dismissed.push(order.id);
  }
  return dismissed;
}

/** @param {{ io?: any, areaId?: string }} [opts] Sin areaId procesa todas las áreas activadas. */
function processStationAutoDismiss({ io, areaId } = {}) {
  const all = readAllAreaSettings();
  const targets = areaId ? [String(areaId).trim()] : Object.keys(all);
  const dismissed = [];
  for (const id of targets) {
    const settings = all[id];
    if (!settings?.autoDismissEnabled) continue;
    dismissed.push(...processAreaAutoDismiss(id, settings.autoDismissMinutes, { io }));
  }
  return dismissed;
}

module.exports = {
  markStationReady,
  processStationAutoDismiss,
};
