const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, runSql, logAudit } = require('../database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { getOrderWithItems } = require('../orderCreateService');
const { ensureSalonesConfig, saveSalonesConfig, normalizeSalonesList } = require('../services/salonesConfigService');
const { loadActiveTableOrders, loadAllActiveTableOrdersWithItems, attachActiveOrdersToTables, deriveTableStatus } = require('../services/tableOrdersQueryService');
const { normalizeTableNumber, tableNumbersMatch } = require('../utils/tableNumberMatch');

router.use(authenticateToken);

router.get('/salones', (req, res) => {
  try {
    const tables = queryAll('SELECT id, zone, number FROM tables ORDER BY number ASC');
    const salones = ensureSalonesConfig(tables);
    res.json({ salones });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/salones', requireRole('admin'), (req, res) => {
  try {
    const raw = Array.isArray(req.body?.salones) ? req.body.salones : null;
    if (!raw) return res.status(400).json({ error: 'Se requiere salones: []' });
    const ids = new Set();
    for (const s of raw) {
      const id = String(s?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'Cada salón debe tener id' });
      if (ids.has(id)) return res.status(400).json({ error: `Salón duplicado: ${id}` });
      ids.add(id);
    }
    const salones = saveSalonesConfig(normalizeSalonesList(raw));
    const io = req.app.get('io');
    if (io) io.emit('salones-update', { salones });
    res.json({ salones });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/', (req, res) => {
  try {
    const tables = queryAll('SELECT * FROM tables ORDER BY number ASC');
    const activeOrders = loadAllActiveTableOrdersWithItems();
    attachActiveOrdersToTables(tables, activeOrders);
    res.json(tables);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const table = queryOne('SELECT * FROM tables WHERE id = ?', [req.params.id]);
    if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });
    const orders = loadActiveTableOrders(table);
    table.orders = orders;
    table.order_total = orders.reduce((sum, o) => sum + (o.total || 0), 0);
    table.status = deriveTableStatus(table, orders);
    res.json(table);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/status', requireRole('admin', 'cajero', 'mozo'), (req, res) => {
  try {
    const { status } = req.body;
    const table = queryOne('SELECT * FROM tables WHERE id = ?', [req.params.id]);
    if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });

    runSql('UPDATE tables SET status = ? WHERE id = ?', [status || table.status, req.params.id]);

    const updated = queryOne('SELECT * FROM tables WHERE id = ?', [req.params.id]);
    const io = req.app.get('io');
    if (io) io.emit('table-update', updated);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', requireRole('admin', 'cajero', 'mozo'), (req, res) => {
  try {
    const { number, name, capacity, zone } = req.body;
    if (!number) return res.status(400).json({ error: 'Número de mesa es requerido' });
    const existing = queryOne('SELECT id FROM tables WHERE number = ?', [number]);
    if (existing) return res.status(400).json({ error: `La mesa #${number} ya existe` });
    const restaurant = queryOne('SELECT id FROM restaurants LIMIT 1');
    const id = uuidv4();
    runSql('INSERT INTO tables (id, number, name, capacity, zone, restaurant_id) VALUES (?, ?, ?, ?, ?, ?)',
      [id, number, name || `Mesa ${number}`, capacity || 4, zone || 'principal', restaurant?.id]);
    const table = queryOne('SELECT * FROM tables WHERE id = ?', [id]);
    const io = req.app.get('io');
    if (io) io.emit('table-update', table);
    res.status(201).json(table);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', requireRole('admin', 'cajero', 'mozo'), (req, res) => {
  try {
    const { number, name, capacity, zone } = req.body;
    const table = queryOne('SELECT * FROM tables WHERE id = ?', [req.params.id]);
    if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });
    if (number && number !== table.number) {
      const dup = queryOne('SELECT id FROM tables WHERE number = ? AND id != ?', [number, req.params.id]);
      if (dup) return res.status(400).json({ error: `La mesa #${number} ya existe` });
    }
    runSql('UPDATE tables SET number = COALESCE(?, number), name = COALESCE(?, name), capacity = COALESCE(?, capacity), zone = COALESCE(?, zone) WHERE id = ?',
      [number, name, capacity, zone, req.params.id]);
    if (number && String(number) !== String(table.number)) {
      const nextNumber = String(number).trim();
      runSql(
        `UPDATE orders SET table_number = ?, customer_name = ?, updated_at = datetime('now')
         WHERE table_id = ? AND type = 'dine_in'
           AND status IN ('pending','preparing','ready')
           AND IFNULL(TRIM(payment_status), 'pending') != 'paid'`,
        [nextNumber, `Mesa ${nextNumber}`, req.params.id],
      );
    }
    const updated = queryOne('SELECT * FROM tables WHERE id = ?', [req.params.id]);
    const io = req.app.get('io');
    if (io) io.emit('table-update', updated);
    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', requireRole('admin', 'cajero', 'mozo'), (req, res) => {
  try {
    const table = queryOne('SELECT * FROM tables WHERE id = ?', [req.params.id]);
    if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });
    const active = queryAll(`SELECT id, table_number, table_id FROM orders WHERE status IN ('pending','preparing','ready') AND IFNULL(TRIM(payment_status), 'pending') != 'paid'`);
    const activeOnTable = active.filter((o) => {
      const orderTableId = String(o.table_id || '').trim();
      if (orderTableId) return orderTableId === table.id;
      return tableNumbersMatch(o.table_number, table.number);
    });
    if (activeOnTable.length > 0) return res.status(400).json({ error: 'No se puede eliminar una mesa con pedidos activos' });
    runSql('DELETE FROM tables WHERE id = ?', [req.params.id]);
    const io = req.app.get('io');
    if (io) io.emit('table-update', {});
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id/free', requireRole('admin', 'cajero'), (req, res) => {
  try {
    const table = queryOne('SELECT * FROM tables WHERE id = ?', [req.params.id]);
    if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });

    const activeOrders = loadActiveTableOrders(table);
    activeOrders.forEach((o) => {
      const ord = queryOne('SELECT status FROM orders WHERE id = ?', [o.id]);
      if (!ord) return;
      if (String(ord.status || '') === 'ready') {
        runSql("UPDATE orders SET status = 'delivered', updated_at = datetime('now') WHERE id = ?", [o.id]);
      }
    });

    const remaining = loadActiveTableOrders(table);
    if (remaining.length > 0) {
      return res.status(400).json({
        error: 'La mesa aún tiene pedidos activos. Entregue o anule los pedidos antes de liberar la mesa.',
      });
    }

    runSql("UPDATE tables SET status = 'available' WHERE id = ?", [req.params.id]);

    const updated = queryOne('SELECT * FROM tables WHERE id = ?', [req.params.id]);
    const io = req.app.get('io');
    if (io) {
      io.emit('table-update', updated);
      activeOrders.forEach((o) => {
        const full = getOrderWithItems(o.id);
        if (full) io.emit('order-update', full);
      });
    }
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/move-orders', requireRole('admin', 'cajero', 'mozo'), (req, res) => {
  try {
    const { source_table_id: sourceTableId, target_table_id: targetTableId, order_ids: orderIdsRaw } = req.body || {};
    if (!sourceTableId || !targetTableId) {
      return res.status(400).json({ error: 'Mesa origen y destino son requeridas' });
    }
    if (sourceTableId === targetTableId) {
      return res.status(400).json({ error: 'La mesa destino debe ser distinta a la mesa origen' });
    }

    const source = queryOne('SELECT * FROM tables WHERE id = ?', [sourceTableId]);
    const target = queryOne('SELECT * FROM tables WHERE id = ?', [targetTableId]);
    if (!source || !target) return res.status(404).json({ error: 'Mesa origen o destino no encontrada' });

    const activeOrders = loadActiveTableOrders(source);
    const requestedIds = Array.isArray(orderIdsRaw) ? orderIdsRaw.filter(Boolean) : [];
    const selected = requestedIds.length
      ? activeOrders.filter((o) => requestedIds.includes(o.id))
      : activeOrders;
    if (!selected.length) return res.status(400).json({ error: 'No hay pedidos activos para mover' });

    const targetActiveOrders = loadActiveTableOrders(target);
    const confirmMerge = req.body?.confirm_merge === true || req.body?.confirm_merge === 1 || req.body?.confirm_merge === '1';
    if (targetActiveOrders.length > 0 && !confirmMerge) {
      return res.status(409).json({
        error: `La mesa ${target.name || target.number} está ocupada (${targetActiveOrders.length} pedido(s) activo(s)). Confirme si desea unir la cuenta.`,
        code: 'TARGET_OCCUPIED',
        target_table: {
          id: target.id,
          number: target.number,
          name: target.name,
          order_count: targetActiveOrders.length,
        },
      });
    }

    const targetTableNumber = String(target.number ?? '').trim();
    selected.forEach((order) => {
      runSql(
        "UPDATE orders SET table_number = ?, table_id = ?, customer_name = ?, updated_at = datetime('now') WHERE id = ?",
        [targetTableNumber, target.id, `Mesa ${targetTableNumber}`, order.id]
      );
    });

    logAudit({
      actorUserId: req.user.id,
      actorName: req.user.full_name || req.user.username || '',
      action: 'table.move_orders',
      resourceType: 'table',
      resourceId: `${source.id}->${target.id}`,
      details: {
        moved_orders: selected.map((o) => o.id),
        confirm_merge: confirmMerge,
        target_had_orders: targetActiveOrders.length > 0,
      },
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('table-update', {});
      selected.forEach((o) => {
        const full = getOrderWithItems(o.id);
        if (full) io.emit('order-update', full);
      });
    }
    res.json({ success: true, moved: selected.length, source_table: source.number, target_table: target.number });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/merge', requireRole('admin', 'cajero', 'mozo'), (req, res) => {
  try {
    const { target_table_id: targetTableId, source_table_ids: sourceTableIds } = req.body || {};
    if (!targetTableId || !Array.isArray(sourceTableIds) || sourceTableIds.length === 0) {
      return res.status(400).json({ error: 'Mesa destino y mesas origen son requeridas' });
    }
    if (sourceTableIds.includes(targetTableId)) {
      return res.status(400).json({ error: 'La mesa destino no puede incluirse como origen' });
    }

    const target = queryOne('SELECT * FROM tables WHERE id = ?', [targetTableId]);
    if (!target) return res.status(404).json({ error: 'Mesa destino no encontrada' });

    let moved = 0;
    const mergedOrderIds = [];
    sourceTableIds.forEach((sourceId) => {
      const source = queryOne('SELECT * FROM tables WHERE id = ?', [sourceId]);
      if (!source) return;
      const activeOrders = loadActiveTableOrders(source);
      const targetTableNumber = String(target.number ?? '').trim();
      activeOrders.forEach((order) => {
        runSql(
          "UPDATE orders SET table_number = ?, table_id = ?, customer_name = ?, updated_at = datetime('now') WHERE id = ?",
          [targetTableNumber, target.id, `Mesa ${targetTableNumber}`, order.id]
        );
        mergedOrderIds.push(order.id);
        moved += 1;
      });
    });
    if (!moved) return res.status(400).json({ error: 'No se encontraron pedidos activos para unir' });

    logAudit({
      actorUserId: req.user.id,
      actorName: req.user.full_name || req.user.username || '',
      action: 'table.merge',
      resourceType: 'table',
      resourceId: target.id,
      details: { source_table_ids: sourceTableIds, moved_orders: moved },
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('table-update', {});
      mergedOrderIds.forEach((oid) => {
        const full = getOrderWithItems(oid);
        if (full) io.emit('order-update', full);
      });
    }
    res.json({ success: true, moved, target_table: target.number });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
