const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, runSql, logAudit } = require('../database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { getOrderWithItems } = require('../orderCreateService');
const { ensureSalonesConfig, saveSalonesConfig, normalizeSalonesList } = require('../services/salonesConfigService');

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
    tables.forEach(t => {
      const orders = queryAll(
        "SELECT * FROM orders WHERE table_number = ? AND status IN ('pending','preparing','ready') ORDER BY created_at DESC",
        [String(t.number)]
      );
      orders.forEach(o => {
        o.items = queryAll('SELECT * FROM order_items WHERE order_id = ?', [o.id]);
      });
      t.orders = orders;
      t.order_total = orders.reduce((sum, o) => sum + (o.total || 0), 0);
      t.order_count = orders.length;
      const hasActiveOrders = orders.length > 0;
      t.status = hasActiveOrders ? 'occupied' : 'available';
    });
    res.json(tables);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const table = queryOne('SELECT * FROM tables WHERE id = ?', [req.params.id]);
    if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });
    const orders = queryAll(
      "SELECT * FROM orders WHERE table_number = ? AND status IN ('pending','preparing','ready') ORDER BY created_at DESC",
      [String(table.number)]
    );
    orders.forEach(o => {
      o.items = queryAll('SELECT * FROM order_items WHERE order_id = ?', [o.id]);
    });
    table.orders = orders;
    table.order_total = orders.reduce((sum, o) => sum + (o.total || 0), 0);
    table.status = orders.length > 0 ? 'occupied' : 'available';
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
    const active = queryAll("SELECT id FROM orders WHERE table_number = ? AND status IN ('pending','preparing','ready')", [String(table.number)]);
    if (active.length > 0) return res.status(400).json({ error: 'No se puede eliminar una mesa con pedidos activos' });
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

    const activeOrders = queryAll(
      "SELECT id FROM orders WHERE table_number = ? AND status IN ('pending','preparing','ready')",
      [String(table.number)]
    );
    activeOrders.forEach(o => {
      runSql("UPDATE orders SET status = 'delivered', updated_at = datetime('now') WHERE id = ?", [o.id]);
    });

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

    const activeOrders = queryAll(
      "SELECT id, order_number FROM orders WHERE table_number = ? AND status IN ('pending','preparing','ready')",
      [String(source.number)]
    );
    const requestedIds = Array.isArray(orderIdsRaw) ? orderIdsRaw.filter(Boolean) : [];
    const selected = requestedIds.length
      ? activeOrders.filter(o => requestedIds.includes(o.id))
      : activeOrders;
    if (!selected.length) return res.status(400).json({ error: 'No hay pedidos activos para mover' });

    selected.forEach((order) => {
      runSql(
        "UPDATE orders SET table_number = ?, customer_name = ?, updated_at = datetime('now') WHERE id = ?",
        [String(target.number), `Mesa ${target.number}`, order.id]
      );
    });

    logAudit({
      actorUserId: req.user.id,
      actorName: req.user.full_name || req.user.username || '',
      action: 'table.move_orders',
      resourceType: 'table',
      resourceId: `${source.id}->${target.id}`,
      details: { moved_orders: selected.map(o => o.id) },
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
      const activeOrders = queryAll(
        "SELECT id FROM orders WHERE table_number = ? AND status IN ('pending','preparing','ready')",
        [String(source.number)]
      );
      activeOrders.forEach((order) => {
        runSql(
          "UPDATE orders SET table_number = ?, customer_name = ?, updated_at = datetime('now') WHERE id = ?",
          [String(target.number), `Mesa ${target.number}`, order.id]
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
