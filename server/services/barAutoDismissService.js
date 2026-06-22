/**
 * Bar: retira comandas que llevan 30+ min sin PREPARAR ni LISTO (solo si está activado en ajustes).
 */
const { queryAll, queryOne, runSql, logAudit } = require('../database');
const { getOrderWithItems } = require('../orderCreateService');
const { getOrderItemsWithArea } = require('../services/orderItemsProductionService');
const { orderHasBarItems } = require('../utils/productionArea');
const {
  allRequiredStationsReady,
  isStationMarkedPreparing,
  isStationMarkedReady,
} = require('../utils/kitchenStationReady');
const {
  readBarStationSettings,
  BAR_AUTO_DISMISS_MINUTES,
} = require('./barStationSettingsService');

function anchorMsForOrder(order) {
  const raw = String(order?.kitchen_last_send_at || order?.created_at || '').trim();
  if (!raw) return null;
  const safe = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const withZone = /Z$|[+-]\d{2}:\d{2}$/.test(safe) ? safe : `${safe}Z`;
  const d = new Date(withZone);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function markBarStationReady(order, { io, reason = 'manual' } = {}) {
  const orderId = order.id;
  if (!orderId || isStationMarkedReady(order, 'bar')) return null;

  runSql(
    `UPDATE orders SET station_bar_ready_at = datetime('now'), station_bar_preparing_at = NULL, updated_at = datetime('now') WHERE id = ?`,
    [orderId],
  );

  const refreshed = queryOne('SELECT * FROM orders WHERE id = ?', [orderId]);
  const refreshedItems = getOrderItemsWithArea(orderId);
  if (allRequiredStationsReady(refreshed, refreshedItems)) {
    const nextStatus = String(refreshed.payment_status || '') === 'paid' ? 'delivered' : 'ready';
    runSql(
      "UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?",
      [nextStatus, orderId],
    );
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
    if (reason === 'auto_dismiss_30m') {
      io.emit('bar-auto-dismiss', { orderId, order: updated });
    }
  }

  if (reason === 'auto_dismiss_30m') {
    try {
      logAudit({
        actorUserId: '',
        actorName: 'Sistema (bar auto)',
        action: 'order.bar.auto_dismiss',
        resourceType: 'order',
        resourceId: orderId,
        details: { minutes: BAR_AUTO_DISMISS_MINUTES },
      });
    } catch (_) {
      /* noop */
    }
  }

  return updated;
}

function processBarAutoDismiss({ io } = {}) {
  const settings = readBarStationSettings();
  if (!settings.autoDismissPendingAfter30Min) return [];

  const maxAgeMs = BAR_AUTO_DISMISS_MINUTES * 60 * 1000;
  const now = Date.now();

  const orders = queryAll(`
    SELECT * FROM orders
    WHERE status IN ('pending', 'preparing', 'ready')
      AND IFNULL(TRIM(payment_status), 'pending') != 'paid'
      AND (
        kitchen_release_at IS NULL
        OR trim(kitchen_release_at) = ''
        OR datetime(kitchen_release_at) <= datetime('now', 'localtime')
      )
  `);

  const dismissed = [];
  for (const order of orders) {
    const areaItems = getOrderItemsWithArea(order.id);
    if (!orderHasBarItems(areaItems)) continue;
    if (isStationMarkedReady(order, 'bar')) continue;
    if (isStationMarkedPreparing(order, 'bar')) continue;

    const anchorMs = anchorMsForOrder(order);
    if (anchorMs == null || now - anchorMs < maxAgeMs) continue;

    markBarStationReady(order, { io, reason: 'auto_dismiss_30m' });
    dismissed.push(order.id);
  }

  return dismissed;
}

module.exports = {
  processBarAutoDismiss,
  markBarStationReady,
  anchorMsForOrder,
};
