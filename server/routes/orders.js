const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, runSql, withTransaction, logAudit } = require('../database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { assertPaymentMethodAllowed, normalizePaymentMethod } = require('../businessRules');
const { parsePaymentBreakdown, dominantPaymentMethod, round2 } = require('../utils/paymentBreakdown');
const { getOrderWithItems, createOrderInTransaction, replaceOrderLinesInTransaction, actorFromRequest } = require('../orderCreateService');
const { restoreNonTransformedStockForOrder } = require('../warehouseStock');
const kardexInventory = require('../services/kardexInventoryService');
const { emitInventoryUpdate, emitBillingDocumentUpdate } = require('../socketBroadcast');
const { recordWorkActivityEvent } = require('../services/workActivityTracker');
const { logRouteError, publicErrorMessage } = require('../utils/routeErrors');
const {
  userCanAccessKitchenApi,
  userCanAccessKitchenStation,
  resolveKitchenStation,
  userCanManageKitchenOrderForStation,
} = require('../services/staffModuleAccessService');

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
  return Math.max(
    0,
    Number(order?.subtotal || 0) + Number(order?.delivery_fee || 0)
  );
}

function isBarText(value = '') {
  const text = String(value || '').toLowerCase();
  return ['bar', 'bebida', 'bebidas', 'trago', 'tragos', 'coctel', 'cocteles', 'cocktail', 'cocktails'].some(token => text.includes(token));
}

function getOrderItemsWithArea(orderId) {
  return queryAll(
    `SELECT oi.*,
            p.production_area,
            LOWER(COALESCE(c.name, '')) as category_name_lc
     FROM order_items oi
     LEFT JOIN products p ON p.id = oi.product_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE oi.order_id = ?`,
    [orderId]
  );
}

function isBarItemRow(item) {
  if (String(item?.production_area || '').toLowerCase() === 'bar') return true;
  return isBarText(item?.category_name_lc) || isBarText(item?.product_name);
}

function isBarOnlyOrder(items = []) {
  if (!Array.isArray(items) || items.length === 0) return false;
  return items.every(isBarItemRow);
}

/** Ítems con production_area (Escritorio, listados, etc.) */
function attachOrderItemsWithProductArea(orders) {
  if (!Array.isArray(orders) || orders.length === 0) return;
  const placeholders = orders.map(() => '?').join(',');
  const ids = orders.map((o) => o.id);
  const allItems = queryAll(
    `SELECT oi.*, p.production_area
     FROM order_items oi
     LEFT JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id IN (${placeholders})`,
    ids
  );
  const byOrder = new Map();
  allItems.forEach((row) => {
    if (!byOrder.has(row.order_id)) byOrder.set(row.order_id, []);
    byOrder.get(row.order_id).push(row);
  });
  orders.forEach((o) => { o.items = byOrder.get(o.id) || []; });
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
  if (!['admin', 'cajero', 'mozo', 'cocina', 'bar'].includes(req.user.role)) {
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
  const { type } = req.query;
  let query = `SELECT * FROM orders WHERE status IN ('pending', 'preparing')
    AND (kitchen_release_at IS NULL OR trim(kitchen_release_at) = '' OR datetime(kitchen_release_at) <= datetime('now', 'localtime'))`;
  const params = [];
  if (type === 'delivery') query += " AND type = 'delivery'";
  else if (type === 'dine_in') query += " AND type = 'dine_in'";
  else if (type === 'salon') query += " AND type IN ('dine_in', 'pickup')";
  query += ' ORDER BY created_at ASC';

  const orders = queryAll(query, params);
  const filtered = [];
  orders.forEach(o => {
    const areaItems = getOrderItemsWithArea(o.id);
    const barOnly = isBarOnlyOrder(areaItems);
    if (stationRequested === 'bar' && !barOnly) return;
    if (stationRequested === 'cocina' && barOnly) return;
    o.items = areaItems.map(({ category_name_lc, ...item }) => item);
    filtered.push(o);
  });
  res.json(filtered);
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

router.put('/:id/lines', authenticateToken, requireRole('admin', 'cajero', 'mozo'), (req, res) => {
  const { items } = req.body || {};
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'El pedido debe tener al menos un producto' });
  }
  try {
    logOrderDebug(req, 'put_lines_start', {
      order_id: req.params.id,
      item_count: items.length,
    });
    const actor = actorFromRequest(req);
    withTransaction((tx) => replaceOrderLinesInTransaction(tx, req.params.id, items, actor));
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'notes')) {
      runSql('UPDATE orders SET notes = ?, updated_at = datetime(\'now\') WHERE id = ?', [
        String(req.body.notes ?? '').trim(),
        req.params.id,
      ]);
    }
    const order = getOrderWithItems(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Pedido no encontrado tras actualizar líneas' });
    }
    const io = req.app.get('io');
    if (io) {
      io.emit('order-update', order);
      /** Cocina/bar: mismo efecto que pedido nuevo para impresión automática (ítems añadidos a mesa existente). */
      io.emit('order-lines-updated', order);
    }
    emitInventoryUpdate({});
    logOrderDebug(req, 'put_lines_ok', { order_id: order.id, order_number: order.order_number });
    res.json(order);
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
    logOrderDebug(req, 'post_order_start', {
      item_count: items.length,
      type: req.body?.type,
      table_number: req.body?.table_number,
    });
    const orderId = uuidv4();
    const actor = actorFromRequest(req);
    const result = withTransaction((tx) =>
      createOrderInTransaction(tx, orderId, req.body, actor)
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
      if (!kitchenHeld) io.emit('new-order', order);
      io.emit('order-update', order);
    }
    emitInventoryUpdate({});
    recordWorkActivityEvent(req.user?.id, 'order_created', { module: 'pedidos', refId: order?.id });
    logOrderDebug(req, 'post_order_ok', { order_id: order.id, order_number: order.order_number });
    res.status(201).json(order);
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

router.put('/:id/status', authenticateToken, requireRole('admin', 'cajero', 'mozo', 'cocina', 'bar', 'delivery'), (req, res) => {
  try {
  const { status, cancellation_reason: cancellationReasonRaw } = req.body;
  const valid = ['pending', 'preparing', 'ready', 'delivered', 'cancelled'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Estado inválido' });

  const order = queryOne('SELECT * FROM orders WHERE id = ?', [req.params.id]);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });

  if (req.user.role === 'mozo' && order.type === 'delivery') {
    return res.status(403).json({ error: 'Los mozos solo pueden crear pedidos de delivery; no gestionar su estado.' });
  }

  /** Delivery: pendiente → preparación → listo — cocina/bar o quien tenga ese módulo. */
  if (order.type === 'delivery' && (status === 'preparing' || status === 'ready')) {
    const areaItems = getOrderItemsWithArea(order.id);
    const barOnly = isBarOnlyOrder(areaItems);
    if (!userCanManageKitchenOrderForStation(req.user, barOnly)) {
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
      const barOnly = isBarOnlyOrder(areaItems);
      if (!userCanManageKitchenOrderForStation(req.user, barOnly)) {
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
  if (!allowedNext.includes(status)) {
    return res.status(400).json({ error: `Transición inválida: ${order.status} -> ${status}` });
  }

  if (status === 'cancelled' && order.status !== 'cancelled') {
    const reason = String(cancellationReasonRaw || '').trim();
    const mustReason =
      order.status === 'delivered' || String(order.payment_status || '') === 'paid';
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
    runSql(
      "UPDATE orders SET status = 'preparing', preparing_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      [req.params.id],
    );
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
  const io = req.app.get('io');
  if (io) { io.emit('order-update', updated); if (status === 'ready') io.emit('order-ready', updated); }
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
  setParts.push("updated_at = datetime('now')");
  params.push(req.params.id);

  const docPm = nextPaymentMethod !== null ? nextPaymentMethod : order.payment_method;
  const wasPaid = String(order.payment_status || '') === 'paid';
  const nextPayEffective =
    payment_status !== undefined && payment_status !== null
      ? String(payment_status)
      : String(order.payment_status || '');
  const applyKardexAfter = nextPayEffective === 'paid' && String(order.status || '') === 'delivered';

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

module.exports = router;
