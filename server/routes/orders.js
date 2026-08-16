const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, runSql, withTransaction, logAudit } = require('../database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { assertPaymentMethodAllowed, normalizePaymentMethod, classifySalesAdjustment } = require('../businessRules');
const { parsePaymentBreakdown, dominantPaymentMethod, round2 } = require('../utils/paymentBreakdown');
const { appendOrderRemovalNote, hasCompleteOrderItemRemovals, computeQuantityRemovals, removalsFromOrderItemRows } = require('../utils/orderLineRemoval');
const { insertProductRemovals } = require('../services/productRemovalLogService');
const { getOrderChargeBase } = require('../utils/orderChargeBase');
const { getOrderWithItems, createOrMergeTableOrderInTransaction, replaceOrderLinesInTransaction, actorFromRequest } = require('../orderCreateService');
const { loadActiveTableOrders, deriveTableStatus } = require('../services/tableOrdersQueryService');
const { restoreNonTransformedStockForOrder } = require('../warehouseStock');
const kardexInventory = require('../services/kardexInventoryService');
const { emitInventoryUpdate, emitBillingDocumentUpdate } = require('../socketBroadcast');
const { recordWorkActivityEvent } = require('../services/workActivityTracker');
const { logRouteError, publicErrorMessage } = require('../utils/routeErrors');
const { sqlBusinessTimestamp, getBusinessTodayDateKey } = require('../utils/appDateTime');
const {
  userCanAccessKitchenApi,
  userCanAccessKitchenStation,
  resolveKitchenStation,
  userCanManageKitchenOrderForStation,
} = require('../services/staffModuleAccessService');
const { userCanEliminarLiberarMesa, userCanAjusteBarAutoDismiss } = require('../lib/cajaPermissions');
const { orderHasBarItems, orderHasKitchenItems, stripKitchenItemMeta, filterItemsForKitchenStation } = require('../utils/productionArea');
const { getOrderItemsWithProductionArea, enrichOrderItemsWithComboAreas } = require('../services/orderItemsProductionService');
const { ensureOrdersSchema } = require('../utils/ensureOrdersSchema');
const { upsertOrderStationState } = require('../services/productionAreasService');
const {
  allRequiredStationsReady,
  kitchenOrderNeedsRepair,
  filterKitchenOrdersForStation,
  normalizeKitchenStation,
  isLegacyStation,
  getStationReadyColumn,
  getStationPreparingColumn,
  isStationMarkedReady,
  isStationMarkedPreparing,
  isKitchenItemMarkedReady,
  allKitchenStationItemsReady,
  isCocinaStationComplete,
  isStationCompleteForStation,
  orderHasStationWork,
} = require('../utils/kitchenStationReady');

const DEBUG_ORDERS = String(process.env.DEBUG_ORDERS || process.env.LOG_LEVEL || '')
  .toLowerCase()
  .includes('debug');

function logOrderDebug(req, msg, extra = {}) {
  if (!DEBUG_ORDERS) return;
  console.log(
    JSON.stringify({
      level: 'debug',
      msg: 'orders_route',
      detail: msg,
      request_id: req?.requestId,
      path: req?.originalUrl,
      user_id: req?.user?.id,
      role: req?.user?.role,
      ...extra,
    }),
  );
}

const router = express.Router();
const ORDER_TRANSITIONS = {
  pending: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['delivered', 'cancelled'],
  /** Anulación administrativa desde Ventas (venta cerrada / entregada); solo admin/cajero (validación abajo). */
  delivered: ['cancelled'],
  cancelled: [],
};

function getChargeBase(order) {
  return getOrderChargeBase(order, order?.items);
}

function getOrderItemsWithArea(orderId) {
  return getOrderItemsWithProductionArea(orderId);
}

/** Ítems con production_area (Escritorio, listados, etc.) */
function attachOrderItemsWithProductArea(orders) {
  if (!Array.isArray(orders) || orders.length === 0) return;
  const placeholders = orders.map(() => '?').join(',');
  const ids = orders.map((o) => o.id);
  const allItems = queryAll(
    `SELECT oi.*,
            COALESCE(NULLIF(TRIM(p.production_area), ''), 'cocina') as production_area,
            LOWER(COALESCE(c.name, '')) as category_name_lc
     FROM order_items oi
     LEFT JOIN products p ON p.id = oi.product_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE oi.order_id IN (${placeholders})`,
    ids
  );
  const byOrder = new Map();
  allItems.forEach((row) => {
    if (!byOrder.has(row.order_id)) byOrder.set(row.order_id, []);
    byOrder.get(row.order_id).push(row);
  });
  orders.forEach((o) => {
    o.items = enrichOrderItemsWithComboAreas(byOrder.get(o.id) || []);
  });
}

router.get('/', authenticateToken, (req, res) => {
  if (req.user.role === 'mozo') {
    return res.json([]);
  }
  const { status, type, date, limit: lim } = req.query;
  let query = 'SELECT * FROM orders WHERE 1=1';
  const params = [];

  if (req.user.type === 'customer') { query += ' AND customer_id = ?'; params.push(req.user.id); }
  if (req.user.role === 'delivery') {
    const uid = req.user.id;
    query += ` AND type = 'delivery' AND status != 'cancelled' AND (
      (
        COALESCE(payment_status, '') != 'paid'
        AND (delivery_driver_completed_at IS NULL OR delivery_driver_completed_at = '')
        AND (
          delivery_driver_started_at IS NULL OR delivery_driver_started_at = ''
          OR delivery_route_driver_id = ?
        )
      )
      OR (
        delivery_route_driver_id = ?
        AND delivery_driver_completed_at IS NOT NULL AND TRIM(delivery_driver_completed_at) != ''
        AND date(delivery_driver_completed_at) = date('now')
      )
    )`;
    params.push(uid, uid);
  } else {
    if (status) { query += ' AND status = ?'; params.push(status); }
    if (type) { query += ' AND type = ?'; params.push(type); }
    if (date) { query += ' AND DATE(created_at) = ?'; params.push(date); }
  }
  query += ' ORDER BY created_at DESC';
  if (lim) { query += ' LIMIT ?'; params.push(parseInt(lim)); }

  const orders = queryAll(query, params);
  attachOrderItemsWithProductArea(orders);
  res.json(orders);
});

router.get('/active', authenticateToken, (req, res) => {
  if (req.user.type === 'customer') {
    return res.status(403).json({ error: 'No tienes permisos para ver pedidos activos globales' });
  }
  if (!['admin', 'cajero', 'mozo', 'cocina', 'bar', 'produccion'].includes(req.user.role)) {
    return res.status(403).json({ error: 'No tienes permisos para esta acción' });
  }
  const orders = queryAll(`SELECT * FROM orders WHERE status IN ('pending', 'preparing', 'ready') ORDER BY CASE status WHEN 'pending' THEN 1 WHEN 'preparing' THEN 2 WHEN 'ready' THEN 3 END, created_at ASC`);
  attachOrderItemsWithProductArea(orders);
  res.json(orders);
});

router.get('/kitchen', authenticateToken, (req, res) => {
  if (req.user.type === 'customer') {
    return res.status(403).json({ error: 'No tienes permisos para cocina' });
  }
  if (!userCanAccessKitchenApi(req.user)) {
    return res.status(403).json({ error: 'No tienes permisos para cocina/bar' });
  }
  const stationRequested = resolveKitchenStation(req.user, req.query.station);
  if (!userCanAccessKitchenStation(req.user, stationRequested)) {
    return res.status(403).json({ error: 'No tienes permiso para este panel de producción' });
  }
  if (stationRequested === 'bar') {
    const { processBarAutoDismiss } = require('../services/barAutoDismissService');
    processBarAutoDismiss({ io: req.app.get('io') });
  }
  const { type } = req.query;
  let query = `SELECT * FROM orders WHERE status IN ('pending', 'preparing', 'ready')
    AND IFNULL(TRIM(payment_status), 'pending') != 'paid'
    AND (kitchen_release_at IS NULL OR trim(kitchen_release_at) = '' OR datetime(kitchen_release_at) <= datetime('now', 'localtime'))`;
  const params = [];
  if (type === 'delivery') query += " AND type = 'delivery'";
  else if (type === 'dine_in') query += " AND type = 'dine_in'";
  else if (type === 'salon') query += " AND type IN ('dine_in', 'pickup')";
  query += ' ORDER BY created_at ASC';

  const orders = queryAll(query, params);
  try {
    const { syncOperationalDelays } = require('../services/operationalDelayService');
    syncOperationalDelays();
  } catch (_) {
    /* ignore */
  }
  const filtered = filterKitchenOrdersForStation(orders, stationRequested, getOrderItemsWithArea);
  res.json(
    filtered.map(({ order: o, stationItems }) => {
      o.items = stationItems.map(stripKitchenItemMeta);
      return o;
    }),
  );
});

function parseKitchenHistoryDate(input) {
  const v = String(input || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
}

router.get('/kitchen/dispatched', authenticateToken, (req, res) => {
  if (req.user.type === 'customer') {
    return res.status(403).json({ error: 'No tienes permisos para cocina' });
  }
  if (!userCanAccessKitchenApi(req.user)) {
    return res.status(403).json({ error: 'No tienes permisos para cocina/bar' });
  }
  const stationRequested = resolveKitchenStation(req.user, req.query.station);
  if (!userCanAccessKitchenStation(req.user, stationRequested)) {
    return res.status(403).json({ error: 'No tienes permiso para este panel de producción' });
  }
  const dateKey = parseKitchenHistoryDate(req.query.date) || getBusinessTodayDateKey(queryOne);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 100));
  const { type } = req.query;
  const legacy = isLegacyStation(stationRequested);
  const readyCol = legacy ? getStationReadyColumn(stationRequested) : null;

  let orders = [];
  if (legacy && readyCol) {
    const readyAtBusiness = sqlBusinessTimestamp(`o.${readyCol}`, queryOne);
    let query = `SELECT o.*, o.${readyCol} AS station_dispatched_at
      FROM orders o
      WHERE trim(coalesce(o.${readyCol}, '')) != ''
        AND date(${readyAtBusiness}) = date(?)`;
    const params = [dateKey];
    if (type === 'delivery') query += " AND o.type = 'delivery'";
    else if (type === 'dine_in') query += " AND o.type = 'dine_in'";
    else if (type === 'salon') query += " AND o.type IN ('dine_in', 'pickup')";
    query += ` ORDER BY datetime(o.${readyCol}) DESC LIMIT ?`;
    params.push(limit);
    orders = queryAll(query, params);
  } else {
    const readyAtBusiness = sqlBusinessTimestamp('oss.ready_at', queryOne);
    let query = `SELECT o.*, oss.ready_at AS station_dispatched_at
      FROM order_station_state oss
      JOIN orders o ON o.id = oss.order_id
      WHERE oss.area_id = ?
        AND trim(coalesce(oss.ready_at, '')) != ''
        AND date(${readyAtBusiness}) = date(?)`;
    const params = [stationRequested, dateKey];
    if (type === 'delivery') query += " AND o.type = 'delivery'";
    else if (type === 'dine_in') query += " AND o.type = 'dine_in'";
    else if (type === 'salon') query += " AND o.type IN ('dine_in', 'pickup')";
    query += ' ORDER BY datetime(oss.ready_at) DESC LIMIT ?';
    params.push(limit);
    orders = queryAll(query, params);
  }

  const result = [];
  for (const o of orders) {
    const areaItems = getOrderItemsWithArea(o.id);
    if (!orderHasStationWork(areaItems, stationRequested)) continue;
    o.station_dispatched_at = o.station_dispatched_at || (readyCol ? o[readyCol] : null);
    o.items = filterItemsForKitchenStation(areaItems, stationRequested).map(stripKitchenItemMeta);
    result.push(o);
  }
  res.json(result);
});

const {
  readBarStationSettings,
  saveBarStationSettings,
} = require('../services/barStationSettingsService');

router.get('/bar-station-settings', authenticateToken, (req, res) => {
  const role = String(req.user?.role || '').toLowerCase();
  const canRead =
    ['admin', 'bar', 'master_admin'].includes(role) || userCanAjusteBarAutoDismiss(req.user);
  if (!canRead) {
    return res.status(403).json({ error: 'No tienes permiso para ver ajustes de bar' });
  }
  res.json(readBarStationSettings());
});

router.put('/bar-station-settings', authenticateToken, (req, res) => {
  const role = String(req.user?.role || '').toLowerCase();
  const canWrite =
    ['admin', 'bar', 'master_admin'].includes(role) || userCanAjusteBarAutoDismiss(req.user);
  if (!canWrite) {
    return res.status(403).json({ error: 'No tienes permiso para cambiar ajustes de bar' });
  }
  try {
    const saved = saveBarStationSettings(req.body || {});
    const io = req.app.get('io');
    if (io) io.emit('bar-station-settings-update', saved);
    res.json(saved);
  } catch (err) {
    logRouteError(req, err, { phase: 'bar-station-settings' });
    res.status(400).json({ error: publicErrorMessage(err, 'No se pudo guardar ajustes de bar') });
  }
});

router.post('/:id/delivery-driver-action', authenticateToken, requireRole('delivery'), (req, res) => {
  const action = String(req.body?.action || '').trim().toLowerCase();
  if (!['start', 'complete'].includes(action)) {
    return res.status(400).json({ error: 'Acción inválida (use start o complete)' });
  }
  const order = queryOne('SELECT * FROM orders WHERE id = ?', [req.params.id]);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  if (order.type !== 'delivery') return res.status(400).json({ error: 'Solo aplica a pedidos delivery' });
  if (order.status === 'cancelled') return res.status(400).json({ error: 'Pedido anulado' });

  if (action === 'start') {
    if (String(order.delivery_driver_started_at || '').trim()) {
      return res.status(400).json({ error: 'Este pedido ya fue iniciado por reparto' });
    }
    if (String(order.delivery_driver_completed_at || '').trim()) {
      return res.status(400).json({ error: 'Este pedido ya figura como completado en ruta' });
    }
    runSql(
      "UPDATE orders SET delivery_driver_started_at = datetime('now'), delivery_route_driver_id = ?, updated_at = datetime('now') WHERE id = ?",
      [req.user.id, req.params.id]
    );
  } else {
    if (String(order.delivery_route_driver_id || '') !== String(req.user.id)) {
      return res.status(403).json({ error: 'Solo quien inició la ruta puede marcarlo como listo' });
    }
    if (!String(order.delivery_driver_started_at || '').trim()) {
      return res.status(400).json({ error: 'Debe iniciar la entrega antes de marcar listo' });
    }
    if (String(order.delivery_driver_completed_at || '').trim()) {
      return res.status(400).json({ error: 'Ya consta como completado en su ruta' });
    }
    runSql(
      "UPDATE orders SET delivery_driver_completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      [req.params.id]
    );
  }

  const updated = getOrderWithItems(req.params.id);
  const io = req.app.get('io');
  if (io) io.emit('order-update', updated);
  res.json(updated);
});

router.put('/:id/lines', authenticateToken, requireRole('admin', 'cajero', 'mozo', 'master_admin'), (req, res) => {
  const { items } = req.body || {};
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'El pedido debe tener al menos un producto' });
  }
  const orderBefore = queryOne('SELECT * FROM orders WHERE id = ?', [req.params.id]);
  if (!orderBefore) return res.status(404).json({ error: 'Pedido no encontrado' });
  const existingItems = queryAll(
    'SELECT product_id, product_name, variant_name, quantity, unit_price, notes FROM order_items WHERE order_id = ?',
    [req.params.id],
  );
  const removalReason = String(req.body?.removal_reason || '').trim();
  const requiresRemovalReason = hasCompleteOrderItemRemovals(existingItems, items);
  const actorRole = String(req.user?.role || '').toLowerCase();
  const isAdminRole = actorRole === 'admin' || actorRole === 'master_admin';
  const canRemoveLines = isAdminRole || (actorRole === 'cajero' && userCanEliminarLiberarMesa(req.user));
  if (requiresRemovalReason && !canRemoveLines) {
    return res.status(403).json({ error: 'Solo caja (admin o cajero autorizado) puede eliminar productos del pedido.' });
  }
  if (requiresRemovalReason && removalReason.length < 3) {
    return res.status(400).json({
      error: 'Indique el motivo al eliminar un producto de la mesa (mínimo 3 caracteres).',
    });
  }
  try {
    logOrderDebug(req, 'put_lines_start', {
      order_id: req.params.id,
      item_count: items.length,
    });
    const actor = actorFromRequest(req);
    const lineResult = withTransaction((tx) =>
      replaceOrderLinesInTransaction(tx, req.params.id, items, actor),
    );
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'notes')) {
      runSql('UPDATE orders SET notes = ?, updated_at = datetime(\'now\') WHERE id = ?', [
        String(req.body.notes ?? '').trim(),
        req.params.id,
      ]);
    }
    if (requiresRemovalReason && removalReason.length >= 3) {
      const current = queryOne('SELECT notes FROM orders WHERE id = ?', [req.params.id]);
      const nextNotes = appendOrderRemovalNote(current?.notes, removalReason);
      runSql('UPDATE orders SET notes = ?, updated_at = datetime(\'now\') WHERE id = ?', [
        nextNotes,
        req.params.id,
      ]);
    }
    const removedLines = computeQuantityRemovals(existingItems, items);
    if (removedLines.length > 0 && removalReason.length >= 3) {
      try {
        insertProductRemovals(removedLines, orderBefore, actor, removalReason);
      } catch (logErr) {
        logRouteError(req, logErr, { order_id: req.params.id, phase: 'product_removal_log' });
      }
      try {
        logAudit({
          actorUserId: req.user?.id || '',
          actorName: req.user?.full_name || req.user?.username || '',
          action: 'order.products_removed',
          resourceType: 'order',
          resourceId: req.params.id,
          details: {
            order_number: orderBefore.order_number,
            removal_reason: removalReason,
            table_number: orderBefore.table_number,
            lines_removed: removedLines.length,
          },
        });
      } catch (auditErr) {
        logRouteError(req, auditErr, { order_id: req.params.id, phase: 'audit_removal' });
      }
    } else if (requiresRemovalReason && removalReason.length >= 3) {
      try {
        logAudit({
          actorUserId: req.user?.id || '',
          actorName: req.user?.full_name || req.user?.username || '',
          action: 'order.products_removed',
          resourceType: 'order',
          resourceId: req.params.id,
          details: {
            order_number: orderBefore.order_number,
            removal_reason: removalReason,
            table_number: orderBefore.table_number,
          },
        });
      } catch (auditErr) {
        logRouteError(req, auditErr, { order_id: req.params.id, phase: 'audit_removal' });
      }
    }
    const resultOrderId = lineResult?.orderId || req.params.id;
    const order = getOrderWithItems(resultOrderId);
    if (!order) {
      return res.status(404).json({ error: 'Pedido no encontrado tras actualizar líneas' });
    }
    const io = req.app.get('io');
    if (io) {
      if (lineResult?.splitFrom) {
        io.emit('new-order', order);
        const previous = getOrderWithItems(lineResult.splitFrom);
        if (previous) io.emit('order-update', previous);
      } else {
        io.emit('order-update', order);
        io.emit('order-lines-updated', {
          order,
          new_item_ids: lineResult?.newItemIds || [],
          merged: true,
        });
      }
    }
    emitInventoryUpdate({});
    logOrderDebug(req, 'put_lines_ok', { order_id: order.id, order_number: order.order_number });
    res.json({ ...order, new_item_ids: lineResult?.newItemIds || [] });
  } catch (err) {
    logRouteError(req, err, { order_id: req.params.id, item_count: items?.length });
    const status = err.message && !/interno|base de datos/i.test(err.message) ? 400 : 500;
    res.status(status).json({
      error: publicErrorMessage(
        err,
        status >= 500
          ? 'No se pudo enviar el pedido a cocina/bar. Intente nuevamente.'
          : 'No se pudo actualizar el pedido',
      ),
    });
  }
});

router.get('/:id', authenticateToken, (req, res) => {
  const order = getOrderWithItems(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  if (req.user.type === 'customer' && order.customer_id !== req.user.id) {
    return res.status(403).json({ error: 'No tienes acceso a este pedido' });
  }
  if (req.user.role === 'delivery') {
    if (order.type !== 'delivery') {
      return res.status(403).json({ error: 'No tienes acceso a este pedido' });
    }
    const mine = String(order.delivery_route_driver_id || '') === String(req.user.id);
    const visibleStatuses = ['pending', 'preparing', 'ready'];
    let allow = visibleStatuses.includes(order.status);
    if (!allow && mine && String(order.delivery_driver_completed_at || '').trim()) {
      const raw = String(order.delivery_driver_completed_at).replace(' ', 'T');
      const d = new Date(raw.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw}Z`);
      const t = new Date();
      allow =
        Number.isFinite(d.getTime()) &&
        d.getFullYear() === t.getFullYear() &&
        d.getMonth() === t.getMonth() &&
        d.getDate() === t.getDate();
    }
    if (!allow) {
      return res.status(403).json({ error: 'No tienes acceso a este pedido' });
    }
  }
  res.json(order);
});

router.post('/', authenticateToken, (req, res) => {
  const { items, payment_method } = req.body || {};
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'El pedido debe tener al menos un producto' });
  }
  const requestedPaymentMethod = String(payment_method || '').trim().toLowerCase();
  if (requestedPaymentMethod) {
    try {
      assertPaymentMethodAllowed(requestedPaymentMethod, { allowOnline: true });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }
  try {
    ensureOrdersSchema();
    logOrderDebug(req, 'post_order_start', {
      item_count: items.length,
      type: req.body?.type,
      table_number: req.body?.table_number,
    });
    let orderId = String(req.body?.id || '').trim();
    if (orderId) {
      const existing = getOrderWithItems(orderId);
      if (existing) {
        return res.status(200).json({
          ...existing,
          merged_into_existing: false,
          new_item_ids: [],
          replayed: true,
        });
      }
    } else {
      orderId = uuidv4();
    }
    const actor = actorFromRequest(req);
    const body = orderId && req.body?.id
      ? { ...req.body, offline_force_new: true }
      : req.body;
    const result = withTransaction((tx) =>
      createOrMergeTableOrderInTransaction(tx, orderId, body, actor)
    );

    const order = getOrderWithItems(result.orderId);
    if (!order) {
      return res.status(500).json({ error: 'El pedido se creó pero no se pudo recuperar. Recargue la pantalla.' });
    }
    const io = req.app.get('io');
    const kitchenHeld = String(order.kitchen_release_at || '').trim()
      && queryOne(
        "SELECT CASE WHEN datetime(?) > datetime('now', 'localtime') THEN 1 ELSE 0 END AS held",
        [String(order.kitchen_release_at).trim()]
      )?.held === 1;
    if (io) {
      if (result.merged) {
        if (!kitchenHeld) {
          io.emit('order-lines-updated', {
            order,
            new_item_ids: result.newItemIds || [],
            merged: true,
          });
        }
      } else if (!kitchenHeld) {
        io.emit('new-order', order);
      }
      io.emit('order-update', order);
    }
    if (io && String(order.type || '') === 'dine_in') {
      const tableId = String(order.table_id || '').trim();
      if (tableId) {
        const tableRow = queryOne('SELECT * FROM tables WHERE id = ?', [tableId]);
        if (tableRow) {
          const tableOrders = loadActiveTableOrders(tableRow);
          io.emit('table-update', {
            ...tableRow,
            orders: tableOrders,
            order_total: tableOrders.reduce((s, o) => s + (o.total || 0), 0),
            order_count: tableOrders.length,
            status: deriveTableStatus(tableRow, tableOrders),
          });
        }
      } else {
        io.emit('table-update', {});
      }
    }
    emitInventoryUpdate({});
    recordWorkActivityEvent(req.user?.id, 'order_created', { module: 'pedidos', refId: order?.id });
    logOrderDebug(req, 'post_order_ok', { order_id: order.id, order_number: order.order_number, merged: result.merged });
    res.status(result.merged ? 200 : 201).json({
      ...order,
      merged_into_existing: Boolean(result.merged),
      new_item_ids: result.newItemIds || [],
    });
  } catch (err) {
    logRouteError(req, err, { item_count: items?.length, type: req.body?.type });
    const status =
      err.message && !/interno|base de datos|guardar la base/i.test(String(err.message))
        ? 400
        : 500;
    res.status(status).json({
      error: publicErrorMessage(
        err,
        status >= 500
          ? 'No se pudo enviar el pedido a cocina/bar. Intente nuevamente.'
          : 'No se pudo crear el pedido',
      ),
    });
  }
});

router.put('/:id/status', authenticateToken, requireRole('admin', 'cajero', 'mozo', 'cocina', 'bar', 'produccion', 'delivery', 'master_admin'), (req, res) => {
  try {
  const { status, cancellation_reason: cancellationReasonRaw, station: stationRaw, order_item_id: orderItemIdRaw } = req.body;
  const orderItemId = String(orderItemIdRaw || '').trim();
  const valid = ['pending', 'preparing', 'ready', 'delivered', 'cancelled'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Estado inválido' });
  const stationRequested = resolveKitchenStation(req.user, stationRaw || req.query.station);
  const stationFromClient = String(stationRaw || req.query?.station || '').trim();
  const roleLc = String(req.user.role || '').toLowerCase();
  const isDedicatedStationRole = roleLc === 'cocina' || roleLc === 'bar' || roleLc === 'produccion';
  const isKitchenStaff = ['admin', 'cajero', 'mozo', 'cocina', 'bar', 'produccion', 'master_admin'].includes(roleLc);
  const stationExplicit = Boolean(stationFromClient);
  const isKitchenFlow =
    (status === 'preparing' || status === 'ready')
    && (isKitchenStaff || isDedicatedStationRole || stationExplicit);
  const isStationPreparingRequest = status === 'preparing' && isKitchenFlow;
  const isStationReadyRequest = status === 'ready' && isKitchenFlow;

  const order = queryOne('SELECT * FROM orders WHERE id = ?', [req.params.id]);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });

  const stationSt = normalizeKitchenStation(stationRequested);
  const areaItemsAtStart = getOrderItemsWithArea(order.id);
  if (kitchenOrderNeedsRepair(order, areaItemsAtStart)) {
    runSql(
      "UPDATE orders SET status = 'preparing', preparing_at = COALESCE(preparing_at, datetime('now')), updated_at = datetime('now') WHERE id = ?",
      [order.id],
    );
    order.status = 'preparing';
  }

  /** Evita error por doble clic o pantalla desincronizada entre estaciones. */
  if (status === 'preparing') {
    if (isStationPreparingRequest) {
      if (isStationMarkedPreparing(order, stationSt)) {
        return res.json(getOrderWithItems(req.params.id));
      }
      if (stationSt === 'cocina' && isCocinaStationComplete(order, areaItemsAtStart)) {
        return res.json(getOrderWithItems(req.params.id));
      }
      if (stationSt !== 'cocina' && isStationMarkedReady(order, stationSt)) {
        return res.json(getOrderWithItems(req.params.id));
      }
    } else if (['preparing', 'delivered'].includes(order.status)) {
      return res.json(getOrderWithItems(req.params.id));
    }
  }
  if (status === 'ready') {
    if (order.status === 'delivered') {
      return res.json(getOrderWithItems(req.params.id));
    }
    if (isStationReadyRequest && stationSt === 'cocina' && orderItemId) {
      const kitchenItems = filterItemsForKitchenStation(areaItemsAtStart, 'cocina');
      const targetItem = kitchenItems.find((i) => i.id === orderItemId);
      if (targetItem && isKitchenItemMarkedReady(targetItem)) {
        return res.json(getOrderWithItems(req.params.id));
      }
    } else if (isStationReadyRequest && stationSt !== 'cocina' && isStationMarkedReady(order, stationSt)) {
      return res.json(getOrderWithItems(req.params.id));
    } else if (isStationReadyRequest && stationSt === 'cocina' && isCocinaStationComplete(order, areaItemsAtStart)) {
      return res.json(getOrderWithItems(req.params.id));
    }
  }

  if (req.user.role === 'mozo' && order.type === 'delivery') {
    return res.status(403).json({ error: 'Los mozos solo pueden crear pedidos de delivery; no gestionar su estado.' });
  }

  /** Delivery: pendiente → preparación → listo — cocina/bar o quien tenga ese módulo. */
  if (order.type === 'delivery' && (status === 'preparing' || status === 'ready')) {
    const areaItems = getOrderItemsWithArea(order.id);
    if (!userCanManageKitchenOrderForStation(req.user, areaItems, stationRequested)) {
      return res.status(403).json({ error: 'No tienes permiso para actualizar la preparación de este pedido' });
    }
  }

  if (req.user.role === 'delivery') {
    if (order.type !== 'delivery') {
      return res.status(403).json({ error: 'El rol delivery solo puede actualizar pedidos delivery' });
    }
    if (status !== 'delivered' || order.status !== 'ready') {
      return res.status(403).json({ error: 'El rol delivery solo puede marcar como entregado un pedido listo' });
    }
    if (status === 'cancelled') {
      return res.status(403).json({ error: 'El rol delivery no puede cancelar pedidos' });
    }
    const activeAssignment = queryOne(
      "SELECT id, driver_id FROM delivery_assignments WHERE order_id = ? AND status != 'delivered' ORDER BY assigned_at DESC LIMIT 1",
      [order.id]
    );
    if (activeAssignment && activeAssignment.driver_id !== req.user.id) {
      return res.status(403).json({ error: 'Este pedido está asignado a otro repartidor' });
    }
  }
  if (status === 'cancelled' && order.status === 'delivered') {
    if (!['admin', 'cajero'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Solo administración o caja pueden anular una venta ya entregada.' });
    }
  }

  if (['preparing', 'ready'].includes(status)) {
    const role = String(req.user.role || '').toLowerCase();
    if (['cocina', 'bar', 'cajero', 'mozo'].includes(role)) {
      const areaItems = getOrderItemsWithArea(order.id);
      if (!userCanManageKitchenOrderForStation(req.user, areaItems, stationRequested)) {
        return res.status(403).json({ error: 'No tienes permiso para actualizar este pedido en cocina/bar' });
      }
    }
  }

  if (req.user.role === 'bar' || req.user.role === 'cocina') {
    if (!['preparing', 'ready'].includes(status)) {
      return res.status(403).json({ error: 'Cocina/Bar solo pueden mover pedidos a preparación o listo' });
    }
  }
  const allowedNext = ORDER_TRANSITIONS[order.status] || [];
  if (status === 'delivered' && String(order.status || '') === 'delivered') {
    return res.json(getOrderWithItems(req.params.id));
  }
  const pickupPaidToDelivered =
    status === 'delivered' &&
    String(order.type || '') === 'pickup' &&
    String(order.payment_status || '') === 'paid' &&
    ['pending', 'preparing', 'ready'].includes(String(order.status || ''));
  if (isKitchenFlow) {
    if (['cancelled', 'delivered'].includes(order.status)) {
      return res.status(400).json({ error: `Transición inválida: ${order.status} -> ${status}` });
    }
    if (status === 'preparing') {
      const areaItemsPrep = getOrderItemsWithArea(order.id);
      if (!orderHasStationWork(areaItemsPrep, stationSt)) {
        return res.status(400).json({ error: 'Este pedido no tiene ítems para esta estación' });
      }
    }
    if (status === 'ready') {
      if (stationSt === 'cocina') {
        if (!orderItemId) {
          return res.status(400).json({ error: 'Marque cada producto como listo' });
        }
        if (!isStationMarkedPreparing(order, stationSt)) {
          return res.status(400).json({ error: 'Marque la comanda en preparación antes de listo' });
        }
        const kitchenItems = filterItemsForKitchenStation(getOrderItemsWithArea(order.id), 'cocina');
        if (!kitchenItems.some((i) => i.id === orderItemId)) {
          return res.status(400).json({ error: 'Este producto no pertenece a cocina en esta comanda' });
        }
      } else if (!isStationMarkedPreparing(order, stationSt)) {
        return res.status(400).json({ error: 'Marque la comanda en preparación antes de listo' });
      }
    }
  } else if (!pickupPaidToDelivered && !allowedNext.includes(status)) {
    return res.status(400).json({ error: `Transición inválida: ${order.status} -> ${status}` });
  }

  if (status === 'cancelled' && order.status === 'cancelled') {
    return res.json(getOrderWithItems(req.params.id));
  }

  if (status === 'cancelled' && order.status !== 'cancelled') {
    const reason = String(cancellationReasonRaw || '').trim();
    const isUnpaidActive =
      ['pending', 'preparing', 'ready'].includes(String(order.status || '')) &&
      String(order.payment_status || 'pending') !== 'paid';
    const mustReason =
      order.status === 'delivered' ||
      String(order.payment_status || '') === 'paid' ||
      isUnpaidActive;
    const canCancelUnpaidActive =
      ['admin', 'master_admin'].includes(roleLc)
      || (roleLc === 'cajero' && userCanEliminarLiberarMesa(req.user));
    if (isUnpaidActive && !canCancelUnpaidActive) {
      return res.status(403).json({
        error: 'Solo caja (admin o cajero autorizado) puede quitar productos o liberar la mesa.',
      });
    }
    if (mustReason && reason.length < 3) {
      return res.status(400).json({ error: 'Indique el motivo de anulación (mínimo 3 caracteres).' });
    }
    try {
      withTransaction((tx) => {
        kardexInventory.revertirSalidasVentaPedido(tx, order.id, req.user.id);
      });
    } catch (err) {
      return res.status(400).json({ error: err.message || 'No se pudo revertir el kardex de esta venta' });
    }
    restoreNonTransformedStockForOrder(order.id);
    const itemsBeforeCancel = queryAll('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
    if (itemsBeforeCancel.length && reason.length >= 3) {
      try {
        const cancelActor = {
          user: {
            id: req.user?.id,
            full_name: req.user?.full_name,
            username: req.user?.username,
          },
        };
        insertProductRemovals(
          removalsFromOrderItemRows(itemsBeforeCancel),
          order,
          cancelActor,
          reason,
        );
      } catch (logErr) {
        logRouteError(req, logErr, { order_id: order.id, phase: 'product_removal_cancel' });
      }
    }
    runSql(
      "UPDATE orders SET status = 'cancelled', cancellation_reason = ?, updated_at = datetime('now') WHERE id = ?",
      [reason, req.params.id]
    );
    emitInventoryUpdate({});
  } else if (status === 'delivered' && String(order.payment_status || '') === 'paid') {
    try {
      withTransaction((tx) => {
        tx.run("UPDATE orders SET status = 'delivered', updated_at = datetime('now') WHERE id = ?", [req.params.id]);
        if (order.type === 'delivery') {
          tx.run(
            "UPDATE delivery_assignments SET status = 'delivered', delivered_at = datetime('now') WHERE order_id = ? AND status != 'delivered'",
            [order.id]
          );
        }
        kardexInventory.aplicarSalidasVentaPedido(tx, order.id, req.user.id);
      });
    } catch (err) {
      return res.status(400).json({ error: err.message || 'No se pudo aplicar salidas de kardex' });
    }
    emitInventoryUpdate({});
  } else if (status === 'preparing') {
    if (isKitchenFlow) {
      if (isLegacyStation(stationSt)) {
        const prepCol = getStationPreparingColumn(stationSt);
        const readyCol = getStationReadyColumn(stationSt);
        runSql(
          `UPDATE orders SET ${prepCol} = datetime('now'), ${readyCol} = NULL, updated_at = datetime('now') WHERE id = ?`,
          [req.params.id],
        );
        if (stationSt === 'cocina') {
          const kitchenIds = filterItemsForKitchenStation(getOrderItemsWithArea(order.id), 'cocina').map((i) => i.id);
          if (kitchenIds.length) {
            const ph = kitchenIds.map(() => '?').join(',');
            runSql(`UPDATE order_items SET station_cocina_ready_at = NULL WHERE id IN (${ph})`, kitchenIds);
          }
        }
      }
      upsertOrderStationState(req.params.id, stationSt, {
        preparing_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
        ready_at: null,
      });
      if (['pending', 'ready'].includes(order.status)) {
        runSql(
          "UPDATE orders SET status = 'preparing', preparing_at = COALESCE(preparing_at, datetime('now')), updated_at = datetime('now') WHERE id = ?",
          [req.params.id],
        );
      }
    } else {
      runSql(
        `UPDATE orders SET status = 'preparing', preparing_at = datetime('now'),
         station_cocina_ready_at = NULL, station_bar_ready_at = NULL,
         station_cocina_preparing_at = datetime('now'), station_bar_preparing_at = datetime('now'),
         updated_at = datetime('now') WHERE id = ?`,
        [req.params.id],
      );
    }
  } else if (status === 'ready') {
    const st = stationSt;
    const areaItems = getOrderItemsWithArea(order.id);

    if (isKitchenFlow && st === 'cocina' && orderItemId) {
      runSql(
        "UPDATE order_items SET station_cocina_ready_at = datetime('now') WHERE id = ? AND order_id = ?",
        [orderItemId, req.params.id],
      );
      const refreshedItems = getOrderItemsWithArea(order.id);
      if (allKitchenStationItemsReady(refreshedItems)) {
        runSql(
          `UPDATE orders SET station_cocina_ready_at = datetime('now'), station_cocina_preparing_at = NULL, updated_at = datetime('now') WHERE id = ?`,
          [req.params.id],
        );
        upsertOrderStationState(req.params.id, 'cocina', {
          ready_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
          preparing_at: null,
        });
      }
    } else if (isKitchenFlow) {
      if (orderHasStationWork(areaItems, st) && !isStationMarkedReady(order, st)) {
        if (isLegacyStation(st)) {
          const readyCol = getStationReadyColumn(st);
          const prepCol = getStationPreparingColumn(st);
          runSql(
            `UPDATE orders SET ${readyCol} = datetime('now'), ${prepCol} = NULL, updated_at = datetime('now') WHERE id = ?`,
            [req.params.id],
          );
        }
        upsertOrderStationState(req.params.id, st, {
          ready_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
          preparing_at: null,
        });
      }
    } else {
      runSql(
        `UPDATE orders SET station_cocina_ready_at = datetime('now'), station_bar_ready_at = datetime('now'),
         station_cocina_preparing_at = NULL, station_bar_preparing_at = NULL,
         updated_at = datetime('now') WHERE id = ?`,
        [req.params.id],
      );
    }

    const refreshed = queryOne('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    const refreshedItems = getOrderItemsWithArea(order.id);
    if (allRequiredStationsReady(refreshed, refreshedItems)) {
      const nextStatus = String(refreshed.payment_status || '') === 'paid' ? 'delivered' : 'ready';
      runSql(
        'UPDATE orders SET status = ?, updated_at = datetime(\'now\') WHERE id = ?',
        [nextStatus, req.params.id],
      );
      if (order.type === 'delivery' && nextStatus === 'delivered') {
        runSql(
          "UPDATE delivery_assignments SET status = 'delivered', delivered_at = datetime('now') WHERE order_id = ? AND status != 'delivered'",
          [order.id],
        );
      }
    } else if (refreshed.status === 'pending') {
      runSql(
        "UPDATE orders SET status = 'preparing', preparing_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
        [req.params.id],
      );
    }
  } else {
    runSql("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?", [status, req.params.id]);
    if (order.type === 'delivery' && status === 'delivered') {
      runSql(
        "UPDATE delivery_assignments SET status = 'delivered', delivered_at = datetime('now') WHERE order_id = ? AND status != 'delivered'",
        [order.id]
      );
    }
  }
  try {
    const auditDetails = {
      from: order.status,
      to: status,
    };
    if (status === 'ready' && isStationReadyRequest) {
      auditDetails.station = stationSt;
      if (orderItemId) auditDetails.order_item_id = orderItemId;
    }
    if (status === 'preparing' && isStationPreparingRequest) {
      auditDetails.station = stationSt;
    }
    if (status === 'cancelled') {
      const reason = String(cancellationReasonRaw || '').trim();
      if (reason) auditDetails.cancellation_reason = reason;
    }
    logAudit({
      actorUserId: req.user.id,
      actorName: req.user.full_name || req.user.username || '',
      action: 'order.status.update',
      resourceType: 'order',
      resourceId: req.params.id,
      details: auditDetails,
    });
  } catch (auditErr) {
    logRouteError(req, auditErr, { order_id: req.params.id, phase: 'audit' });
  }

  const updated = getOrderWithItems(req.params.id);
  try {
    const { syncOperationalDelays } = require('../services/operationalDelayService');
    syncOperationalDelays();
  } catch (_) {
    /* no bloquear cambio de estado */
  }
  const io = req.app.get('io');
  if (io) {
    io.emit('order-update', updated);
    const refreshedItems = getOrderItemsWithArea(req.params.id);
    const stationDone =
      status === 'ready'
      && isStationCompleteForStation(updated, refreshedItems, stationSt);
    if (stationDone) io.emit('order-ready', updated);
  }
  res.json(updated);
  } catch (err) {
    logRouteError(req, err, { order_id: req.params.id, phase: 'status' });
    res.status(500).json({
      error: publicErrorMessage(err, 'No se pudo actualizar el estado del pedido. Intente nuevamente.'),
    });
  }
});

router.put('/:id/payment', authenticateToken, requireRole('admin', 'cajero', 'mozo'), (req, res) => {
  const { payment_method, payment_status, payment_breakdown: paymentBreakdownBody } = req.body || {};
  const order = queryOne('SELECT * FROM orders WHERE id = ?', [req.params.id]);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });

  let paymentBreakdownObj = null;
  if (paymentBreakdownBody != null && typeof paymentBreakdownBody === 'object' && !Array.isArray(paymentBreakdownBody)) {
    paymentBreakdownObj = parsePaymentBreakdown(JSON.stringify(paymentBreakdownBody));
  } else if (typeof paymentBreakdownBody === 'string' && paymentBreakdownBody.trim()) {
    paymentBreakdownObj = parsePaymentBreakdown(paymentBreakdownBody);
  }

  const tipInBody = req.body?.tip_amount !== undefined && req.body?.tip_amount !== null;

  if (payment_status && !['pending', 'paid', 'refunded'].includes(String(payment_status))) {
    return res.status(400).json({ error: 'Estado de pago inválido' });
  }

  let nextPaymentMethod = null;
  let nextBreakdown = undefined;

  if (paymentBreakdownObj) {
    try {
      for (const k of Object.keys(paymentBreakdownObj)) {
        assertPaymentMethodAllowed(k, { allowOnline: true });
      }
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    const orderTotal = round2(Number(order.total || 0));
    const splitSum = round2(
      Object.values(paymentBreakdownObj).reduce((acc, v) => acc + round2(Number(v) || 0), 0)
    );
    if (Math.abs(splitSum - orderTotal) > 0.05) {
      return res.status(400).json({
        error: `El multipago (S/ ${splitSum.toFixed(2)}) debe coincidir con el total del pedido (S/ ${orderTotal.toFixed(2)})`,
      });
    }
    nextPaymentMethod = dominantPaymentMethod(paymentBreakdownObj);
    nextBreakdown = JSON.stringify(paymentBreakdownObj);
  } else if (payment_method) {
    nextPaymentMethod = normalizePaymentMethod(payment_method, { allowOnline: true, fallback: order.payment_method || 'efectivo' });
    try {
      assertPaymentMethodAllowed(nextPaymentMethod, { allowOnline: true });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    nextBreakdown = null;
  }

  if (nextPaymentMethod === null && nextBreakdown === undefined && (payment_status === undefined || payment_status === null)) {
    return res.status(400).json({ error: 'Sin cambios de pago' });
  }

  const wasPaid = String(order.payment_status || '') === 'paid';
  const nextPayEffective =
    payment_status !== undefined && payment_status !== null
      ? String(payment_status)
      : String(order.payment_status || '');

  const setParts = [];
  const params = [];
  if (nextPaymentMethod !== null) {
    setParts.push('payment_method = ?');
    params.push(nextPaymentMethod);
  }
  if (nextBreakdown !== undefined) {
    setParts.push('payment_breakdown = ?');
    params.push(nextBreakdown);
  }
  if (tipInBody) {
    const tip = round2(Math.max(0, Number(req.body.tip_amount)));
    setParts.push('tip_amount = ?');
    params.push(tip);
  }
  if (payment_status !== undefined && payment_status !== null) {
    setParts.push('payment_status = ?');
    params.push(payment_status);
  }
  if (nextPayEffective === 'paid' && !wasPaid) {
    const role = String(req.user?.role || '').toLowerCase();
    const openReg = queryOne(
      'SELECT id FROM cash_registers WHERE user_id = ? AND closed_at IS NULL',
      [req.user.id],
    );
    if (role === 'cajero' && !openReg?.id) {
      return res.status(400).json({ error: 'Debe abrir caja antes de registrar cobros' });
    }
    if (openReg?.id) {
      setParts.push('cash_register_id = ?');
      params.push(openReg.id);
    }
    setParts.push("paid_at = COALESCE(paid_at, datetime('now'))");
  }
  setParts.push("updated_at = datetime('now')");
  params.push(req.params.id);

  const docPm = nextPaymentMethod !== null ? nextPaymentMethod : order.payment_method;
  const projectedAdjustmentKind = nextPayEffective === 'paid'
    ? classifySalesAdjustment({
      ...order,
      payment_status: nextPayEffective,
      payment_method: docPm,
    })
    : null;
  /** Venta rápida / mostrador: cobrar cierra el pedido pickup en la misma operación. */
  const isPickupSaleCloseout =
    nextPayEffective === 'paid' &&
    !wasPaid &&
    String(order.type || '') === 'pickup' &&
    ['pending', 'preparing', 'ready'].includes(String(order.status || ''));
  if (isPickupSaleCloseout) {
    setParts.push("status = 'delivered'");
  }
  const applyKardexAfter =
    (nextPayEffective === 'paid' && String(order.status || '') === 'delivered') ||
    isPickupSaleCloseout ||
    (nextPayEffective === 'paid' && !wasPaid && (projectedAdjustmentKind === 'cortesia' || projectedAdjustmentKind === 'descuento'));

  if (applyKardexAfter) {
    try {
      withTransaction((tx) => {
        tx.run(`UPDATE orders SET ${setParts.join(', ')} WHERE id = ?`, params);
        if (nextPaymentMethod !== null || nextBreakdown !== undefined) {
          tx.run(
            "UPDATE electronic_documents SET payment_method = ?, updated_at = datetime('now') WHERE order_id = ?",
            [docPm, req.params.id]
          );
        }
        kardexInventory.aplicarSalidasVentaPedido(tx, req.params.id, req.user.id);
        if (nextPayEffective === 'paid' && !wasPaid && String(docPm || '') !== 'cuenta_cliente') {
          const { assignSaleNumberToOrderIdsTx } = require('../services/saleNumberService');
          assignSaleNumberToOrderIdsTx(tx, [req.params.id]);
        }
      });
    } catch (err) {
      return res.status(400).json({ error: err.message || 'No se pudo aplicar salidas de kardex' });
    }
  } else {
    runSql(`UPDATE orders SET ${setParts.join(', ')} WHERE id = ?`, params);
    if (nextPaymentMethod !== null || nextBreakdown !== undefined) {
      runSql(
        "UPDATE electronic_documents SET payment_method = ?, updated_at = datetime('now') WHERE order_id = ?",
        [docPm, req.params.id]
      );
    }
    if (nextPayEffective === 'paid' && !wasPaid && String(docPm || '') !== 'cuenta_cliente') {
      withTransaction((tx) => {
        const { assignSaleNumberToOrderIdsTx } = require('../services/saleNumberService');
        assignSaleNumberToOrderIdsTx(tx, [req.params.id]);
      });
    }
  }
  if (nextPaymentMethod !== null || nextBreakdown !== undefined) {
    const docRow = queryOne('SELECT * FROM electronic_documents WHERE order_id = ? LIMIT 1', [req.params.id]);
    if (docRow?.id) {
      emitBillingDocumentUpdate({
        id: docRow.id,
        order_id: docRow.order_id,
        order_number: docRow.order_number,
        doc_type: docRow.doc_type,
        full_number: docRow.full_number,
        provider_status: docRow.provider_status,
        provider_message: docRow.provider_message,
        pdf_url: docRow.pdf_url,
        updated_at: docRow.updated_at,
      });
    }
  }
  const fresh = getOrderWithItems(req.params.id);
  const io = req.app.get('io');
  if (io) io.emit('order-update', fresh);
  if (applyKardexAfter) emitInventoryUpdate({});
  if (nextPayEffective === 'paid' && !wasPaid) {
    try {
      const { markProductsSoldOnPaidOrder } = require('../services/productSalesTrackingService');
      markProductsSoldOnPaidOrder(req.params.id);
    } catch (err) {
      console.warn('[product-sales-idle] venta cobrada no registrada:', err.message || err);
    }
  }
  res.json(fresh);
});

router.put('/:id/discount', authenticateToken, requireRole('admin', 'cajero', 'mozo'), (req, res) => {
  const { discount, reason } = req.body;
  const order = queryOne('SELECT * FROM orders WHERE id = ?', [req.params.id]);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  if (discount === undefined || discount === null || Number.isNaN(Number(discount))) {
    return res.status(400).json({ error: 'Descuento inválido' });
  }

  const baseTotal = getChargeBase(order);
  const safeDiscount = Math.max(0, Math.min(Number(discount), baseTotal));
  const newTotal = Math.max(0, baseTotal - safeDiscount);
  const discountNote = reason ? ` [DESCUENTO: ${reason}]` : '';

  runSql(
    "UPDATE orders SET discount = ?, total = ?, notes = COALESCE(notes, '') || ?, updated_at = datetime('now') WHERE id = ?",
    [safeDiscount, newTotal, discountNote, req.params.id]
  );
  logAudit({
    actorUserId: req.user.id,
    actorName: req.user.full_name || req.user.username || '',
    action: 'order.discount.update',
    resourceType: 'order',
    resourceId: req.params.id,
    details: { discount: safeDiscount, reason: reason || '' },
  });

  const updatedOrder = getOrderWithItems(req.params.id);
  const io = req.app.get('io');
  if (io) io.emit('order-update', updatedOrder);
  res.json(updatedOrder);
});

/** Elimina del sistema una venta ya anulada (solo administrador). */
router.delete('/:id', authenticateToken, requireRole('admin', 'master_admin'), (req, res) => {
  const order = queryOne('SELECT * FROM orders WHERE id = ?', [req.params.id]);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  if (String(order.status || '') !== 'cancelled') {
    return res.status(400).json({ error: 'Solo se pueden eliminar ventas anuladas del sistema' });
  }
  try {
    withTransaction((tx) => {
      tx.run('DELETE FROM order_items WHERE order_id = ?', [order.id]);
      tx.run('DELETE FROM electronic_documents WHERE order_id = ?', [order.id]);
      tx.run('DELETE FROM delivery_assignments WHERE order_id = ?', [order.id]);
      try {
        tx.run('DELETE FROM finance_loss_events WHERE order_id = ?', [order.id]);
      } catch (_) {
        /* tabla opcional */
      }
      tx.run('DELETE FROM orders WHERE id = ?', [order.id]);
    });
    logAudit({
      actorUserId: req.user?.id || '',
      actorName: req.user?.full_name || req.user?.username || '',
      action: 'order.purge_cancelled',
      resourceType: 'order',
      resourceId: order.id,
      details: {
        order_number: order.order_number,
        cancellation_reason: order.cancellation_reason || '',
      },
    });
    const io = req.app.get('io');
    if (io) io.emit('order-update', { id: order.id, deleted: true, order_number: order.order_number });
    res.json({ success: true, id: order.id });
  } catch (err) {
    logRouteError(req, err, { order_id: req.params.id, phase: 'purge' });
    res.status(500).json({ error: publicErrorMessage(err, 'No se pudo eliminar la venta anulada') });
  }
});

module.exports = router;
