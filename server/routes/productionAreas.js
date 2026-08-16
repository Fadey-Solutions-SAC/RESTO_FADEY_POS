const express = require('express');
const { authenticateToken, requireRole } = require('../middleware/auth');
const {
  readProductionAreas,
  ensureProductionAreasSeeded,
  createProductionArea,
  updateProductionArea,
  deleteProductionArea,
  listActiveProductionAreas,
  syncEncargadoUserRoles,
  enforceSingleEncargadoPerArea,
} = require('../services/productionAreasService');
const { queryAll, assignUserProductionRole } = require('../database');

const router = express.Router();

router.get('/', authenticateToken, (req, res) => {
  try {
    ensureProductionAreasSeeded();
    try { enforceSingleEncargadoPerArea(); } catch (_) { /* ignore */ }
    try { syncEncargadoUserRoles(); } catch (_) { /* ignore */ }
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
    for (const uid of encargados.slice(0, 1)) {
      assignUserProductionRole(uid, row.id);
    }
    return res.status(201).json(row);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'No se pudo crear el área' });
  }
});

router.put('/:id', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    ensureProductionAreasSeeded();
    const before = readProductionAreas().find((a) => a.id === String(req.params.id || '').trim());
    const prevIds = Array.isArray(before?.encargado_user_ids) ? before.encargado_user_ids : [];
    const row = updateProductionArea(req.params.id, {
      name: req.body?.name,
      active: req.body?.active,
      encargado_user_ids: req.body?.encargado_user_ids,
    });
    const encargados = Array.isArray(req.body?.encargado_user_ids)
      ? req.body.encargado_user_ids.slice(0, 1)
      : null;
    const { runSql } = require('../database');
    if (encargados) {
      const fromDb = queryAll(
        `SELECT id FROM users
         WHERE lower(trim(role)) IN ('produccion','cocina','bar')
           AND trim(coalesce(production_area_id,'')) = ?`,
        [row.id]
      );
      const keep = new Set(encargados.map(String));
      const toClear = new Set([
        ...prevIds.map(String),
        ...(fromDb || []).map((u) => String(u.id)),
      ]);
      for (const uid of toClear) {
        if (!keep.has(uid)) {
          runSql(`UPDATE users SET production_area_id = '' WHERE id = ?`, [uid]);
        }
      }
      for (const uid of encargados) {
        assignUserProductionRole(uid, row.id);
      }
    }
    try { enforceSingleEncargadoPerArea(); } catch (_) { /* ignore */ }
    return res.json(readProductionAreas().find((a) => a.id === row.id) || row);
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
    ensureProductionAreasSeeded();
    try { enforceSingleEncargadoPerArea(); } catch (_) { /* ignore */ }
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
