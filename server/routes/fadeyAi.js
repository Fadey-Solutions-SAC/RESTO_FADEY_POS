const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const {
  getStatus,
  chat,
  getHistory,
  bootstrapKnowledge,
  isFeatureEnabled,
} = require('../services/fadeyAi/fadeyAiChatService');

const router = express.Router();

const STAFF_ROLES = new Set([
  'admin', 'cajero', 'mozo', 'cocina', 'bar', 'delivery', 'produccion', 'master_admin',
]);

router.use(authenticateToken);

function requireStaff(req, res, next) {
  const role = String(req.user?.role || '').toLowerCase();
  if (req.user?.type === 'customer' || !STAFF_ROLES.has(role)) {
    return res.status(403).json({ error: 'Solo personal del restaurante' });
  }
  return next();
}

router.use(requireStaff);

router.get('/status', (req, res) => {
  try {
    res.json(getStatus());
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudo leer estado IA' });
  }
});

router.get('/history', (req, res) => {
  try {
    if (!isFeatureEnabled()) {
      return res.status(403).json({ error: 'IA Fadey desactivada' });
    }
    res.json({ messages: getHistory(req.user.id, Number(req.query.limit) || 40) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudo cargar historial' });
  }
});

router.post('/chat', async (req, res) => {
  try {
    const result = await chat(req.user, req.body?.message || req.body?.text || '');
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Error en el chat IA' });
  }
});

router.post('/bootstrap', (req, res) => {
  try {
    if (String(req.user?.role || '') !== 'master_admin' && String(req.user?.role || '') !== 'admin') {
      return res.status(403).json({ error: 'Sin permiso' });
    }
    if (!isFeatureEnabled()) {
      return res.status(403).json({ error: 'Active IA Fadey en Admin Maestro primero' });
    }
    const force = Boolean(req.body?.reset_learning);
    const state = bootstrapKnowledge({ forceLearningReset: force });
    res.json({ ok: true, state, status: getStatus() });
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudo inicializar conocimiento' });
  }
});

module.exports = router;
