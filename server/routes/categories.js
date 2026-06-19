const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, runSql } = require('../database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { emitStaffDataUpdate } = require('../socketBroadcast');
const { logRouteError, publicErrorMessage, sendRouteError } = require('../utils/routeErrors');
const { normalizeCatalogDisplayName } = require('../utils/catalogNameFormat');

const router = express.Router();

router.get('/', (req, res) => {
  try {
    res.json(
      queryAll(
        `SELECT c.*, COUNT(p.id) as product_count FROM categories c
         LEFT JOIN products p ON p.category_id = c.id AND p.is_active = 1
         GROUP BY c.id ORDER BY c.sort_order ASC`,
      ),
    );
  } catch (err) {
    sendRouteError(res, req, err, 'No se pudieron cargar las categorías');
  }
});

router.get('/active', (req, res) => {
  try {
    res.json(
      queryAll(
        `SELECT c.*, COUNT(p.id) as product_count FROM categories c
         LEFT JOIN products p ON p.category_id = c.id AND p.is_active = 1
         WHERE c.is_active = 1
         GROUP BY c.id ORDER BY c.sort_order ASC`,
      ),
    );
  } catch (err) {
    sendRouteError(res, req, err, 'No se pudieron cargar las categorías activas');
  }
});

router.post('/', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const name = normalizeCatalogDisplayName(req.body?.name);
    const description = String(req.body?.description || '').trim();
    const image = String(req.body?.image || '').trim();
    if (!name) return res.status(400).json({ error: 'Nombre es requerido' });

    const dup = queryOne(
      'SELECT id FROM categories WHERE lower(trim(name)) = lower(trim(?)) LIMIT 1',
      [name],
    );
    if (dup) return res.status(400).json({ error: 'Ya existe una categoría con ese nombre' });

    const maxSort = queryOne('SELECT MAX(sort_order) as m FROM categories');
    const restaurant = queryOne('SELECT id FROM restaurants LIMIT 1');
    if (!restaurant?.id) {
      return res.status(400).json({ error: 'Configure el restaurante antes de crear categorías' });
    }
    const id = uuidv4();
    runSql(
      'INSERT INTO categories (id, name, description, image, restaurant_id, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
      [id, name, description, image, restaurant.id, (maxSort?.m || 0) + 1],
    );
    emitStaffDataUpdate({ domain: 'catalog' });
    res.status(201).json(queryOne('SELECT * FROM categories WHERE id = ?', [id]));
  } catch (err) {
    sendRouteError(res, req, err, 'No se pudo crear la categoría');
  }
});

router.put('/:id', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'ID de categoría inválido' });

    const existing = queryOne('SELECT * FROM categories WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'Categoría no encontrada' });

    const name =
      req.body?.name !== undefined
        ? normalizeCatalogDisplayName(req.body.name)
        : normalizeCatalogDisplayName(existing.name);
    if (!name) return res.status(400).json({ error: 'El nombre es requerido' });

    const description =
      req.body?.description !== undefined
        ? String(req.body.description || '')
        : String(existing.description || '');
    const image =
      req.body?.image !== undefined ? String(req.body.image || '') : String(existing.image || '');
    const is_active =
      req.body?.is_active !== undefined
        ? Number(req.body.is_active) === 1 || req.body.is_active === true
          ? 1
          : 0
        : Number(existing.is_active ?? 1);
    const sort_order =
      req.body?.sort_order !== undefined && Number.isFinite(Number(req.body.sort_order))
        ? Number(req.body.sort_order)
        : Number(existing.sort_order || 0);

    const dup = queryOne(
      'SELECT id FROM categories WHERE lower(trim(name)) = lower(trim(?)) AND id != ? LIMIT 1',
      [name, id],
    );
    if (dup) return res.status(400).json({ error: 'Ya existe otra categoría con ese nombre' });

    runSql(
      'UPDATE categories SET name = ?, description = ?, image = ?, is_active = ?, sort_order = ? WHERE id = ?',
      [name, description, image, is_active, sort_order, id],
    );
    emitStaffDataUpdate({ domain: 'catalog' });
    res.json(queryOne('SELECT * FROM categories WHERE id = ?', [id]));
  } catch (err) {
    logRouteError(req, err, { category_id: req.params.id });
    res.status(500).json({ error: publicErrorMessage(err, 'Error al actualizar la categoría. Intente nuevamente.') });
  }
});

/** Unifica categorías: mueve productos de origen a destino y elimina la origen. */
router.post('/:id/merge', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const sourceId = String(req.params.id || '').trim();
    const targetId = String(req.body?.target_category_id || '').trim();
    if (!sourceId || !targetId) {
      return res.status(400).json({ error: 'Se requiere categoría origen y destino' });
    }
    if (sourceId === targetId) {
      return res.status(400).json({ error: 'La categoría destino debe ser distinta' });
    }

    const source = queryOne('SELECT * FROM categories WHERE id = ?', [sourceId]);
    const target = queryOne('SELECT * FROM categories WHERE id = ?', [targetId]);
    if (!source) return res.status(404).json({ error: 'Categoría origen no encontrada' });
    if (!target) return res.status(404).json({ error: 'Categoría destino no encontrada' });

    const moved = queryOne('SELECT COUNT(*) as c FROM products WHERE category_id = ?', [sourceId]);
    runSql('UPDATE products SET category_id = ? WHERE category_id = ?', [targetId, sourceId]);
    runSql('DELETE FROM categories WHERE id = ?', [sourceId]);

    emitStaffDataUpdate({ domain: 'catalog' });
    res.json({
      success: true,
      target_category_id: targetId,
      target_category_name: target.name,
      products_moved: Number(moved?.c || 0),
    });
  } catch (err) {
    sendRouteError(res, req, err, 'No se pudo unificar la categoría');
  }
});

router.delete('/:id', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'ID de categoría inválido' });
    const existing = queryOne('SELECT id FROM categories WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'Categoría no encontrada' });

    const inUse = queryOne('SELECT id FROM products WHERE category_id = ? LIMIT 1', [id]);
    if (inUse) {
      return res.status(400).json({
        error: 'No se puede eliminar: hay productos asignados a esta categoría',
      });
    }

    runSql('DELETE FROM categories WHERE id = ?', [id]);
    emitStaffDataUpdate({ domain: 'catalog' });
    res.json({ success: true });
  } catch (err) {
    sendRouteError(res, req, err, 'No se pudo eliminar la categoría');
  }
});

module.exports = router;
