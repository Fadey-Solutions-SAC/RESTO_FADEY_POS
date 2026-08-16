const express = require('express');
const { authenticateToken, requireRole } = require('../middleware/auth');
const {
  readProductionAreas,
  ensureProductionAreasSeeded,
  createProductionArea,
  updateProductionArea,
  deleteProductionArea,
  syncAreaUserLinksFromUsers,
  listActiveProductionAreas,
} = require('../services/productionAreasService');
const { queryAll } = require('../database');

const router = express.Router();

router.get('/', authenticateToken, (req, res) => {
  try {
    ensureProductionAreasSeeded();
    const areas = readProductionAreas();
    return res.json(areas);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'No se pudieron cargar las áreas' });
  }
});

router.get('/active', authenticateToken, (req, res) => {
  try {
    ensureProductionAreasSeeded();
    return res.json(listActiveProductionAreas());
  } catch (err) {
    return res.status(500).json({ error: err.message || 'No se pudieron cargar las áreas' });
  }
});

router.post('/', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    ensureProductionAreasSeeded();
    const row = createProductionArea({
      name: req.body?.name,
      encargado_user_ids: req.body?.encargado_user_ids,
    });
    const encargados = Array.isArray(req.body?.encargado_user_ids) ? req.body.encargado_user_ids : [];
    const { runSql } = require('../database');
    for (const uid of encargados) {
      runSql(
        `UPDATE users SET role = 'produccion', production_area_id = ? WHERE id = ?`,
        [row.id, uid]
      );
    }
    try { syncAreaUserLinksFromUsers(); } catch (_) { /* ignore */ }
    return res.status(201).json(row);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'No se pudo crear el área' });
  }
});

router.put('/:id', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const row = updateProductionArea(req.params.id, {
      name: req.body?.name,
      active: req.body?.active,
      encargado_user_ids: req.body?.encargado_user_ids,
    });
    const encargados = Array.isArray(req.body?.encargado_user_ids) ? req.body.encargado_user_ids : null;
    const { runSql } = require('../database');
    if (encargados) {
      const prev = queryAll(
        `SELECT id FROM users
         WHERE lower(trim(role)) IN ('produccion','cocina','bar')
           AND trim(coalesce(production_area_id,'')) = ?`,
        [row.id]
      );
      const keep = new Set(encargados.map(String));
      for (const u of prev || []) {
        if (!keep.has(String(u.id))) {
          runSql(`UPDATE users SET production_area_id = '' WHERE id = ?`, [u.id]);
        }
      }
      for (const uid of encargados) {
        runSql(
          `UPDATE users SET role = 'produccion', production_area_id = ? WHERE id = ?`,
          [row.id, uid]
        );
      }
    }
    try { syncAreaUserLinksFromUsers(); } catch (_) { /* ignore */ }
    return res.json(updateProductionArea(req.params.id, {}));
  } catch (err) {
    return res.status(400).json({ error: err.message || 'No se pudo actualizar el área' });
  }
});

router.delete('/:id', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const reassignTo = req.body?.reassignTo || req.query?.reassignTo;
    const areas = deleteProductionArea(req.params.id, { reassignTo });
    return res.json(areas);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'No se pudo eliminar el área' });
  }
});

router.get('/candidates/users', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const users = queryAll(
      `SELECT id, full_name, username, role, production_area_id, is_active
       FROM users
       WHERE lower(trim(role)) IN ('produccion', 'cocina', 'bar')
       ORDER BY full_name ASC`
    );
    return res.json(users);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'No se pudieron cargar usuarios' });
  }
});

module.exports = router;
