const router = require('express').Router();
const { logAudit, queryOne } = require('../database');
const { resolveRegionalTimezone } = require('../utils/appDateTime');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { emitStaffDataUpdate } = require('../socketBroadcast');
const promotionService = require('../services/promotionService');

function broadcastPromotions() {
  emitStaffDataUpdate({ domain: 'promotions' });
}

function sendError(res, err, fallback) {
  const status = Number(err?.status) || 500;
  res.status(status).json({ error: err?.message || fallback });
}

function audit(req, action, resourceId, details = {}) {
  logAudit({
    actorUserId: req.user?.id || '',
    actorName: req.user?.full_name || req.user?.username || '',
    action,
    resourceType: 'promotion',
    resourceId,
    details,
  });
}

/** Público (Pedido QR, carta del cliente, Mesas y Caja): solo lectura de promociones vigentes. */
router.get('/active', (req, res) => {
  try {
    res.json({
      promotions: promotionService.getActivePromotionsForClients(),
      timezone: resolveRegionalTimezone(queryOne),
      server_time: new Date().toISOString(),
    });
  } catch (err) {
    sendError(res, err, 'No se pudieron cargar las promociones');
  }
});

router.use(authenticateToken, requireRole('admin'));

router.get('/', (req, res) => {
  try {
    res.json(promotionService.listPromotionsWithStats());
  } catch (err) {
    sendError(res, err, 'No se pudieron cargar las promociones');
  }
});

router.get('/:id', (req, res) => {
  try {
    const detail = promotionService.getPromotionDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: 'Promoción no encontrada' });
    res.json(detail);
  } catch (err) {
    sendError(res, err, 'No se pudo cargar la promoción');
  }
});

router.post('/', (req, res) => {
  try {
    const created = promotionService.createPromotion(req.body || {}, req.user?.id || '');
    audit(req, 'promotion.create', created.id, { name: created.name, type: created.type, value: created.value });
    broadcastPromotions();
    res.status(201).json(created);
  } catch (err) {
    sendError(res, err, 'No se pudo crear la promoción');
  }
});

router.put('/:id', (req, res) => {
  try {
    const updated = promotionService.updatePromotion(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Promoción no encontrada' });
    audit(req, 'promotion.update', updated.id, { name: updated.name });
    broadcastPromotions();
    res.json(updated);
  } catch (err) {
    sendError(res, err, 'No se pudo actualizar la promoción');
  }
});

router.patch('/:id/status', (req, res) => {
  try {
    const updated = promotionService.setPromotionStatus(req.params.id, String(req.body?.status || ''));
    if (!updated) return res.status(404).json({ error: 'Promoción no encontrada' });
    audit(req, updated.status === 'paused' ? 'promotion.pause' : 'promotion.activate', updated.id);
    broadcastPromotions();
    res.json(updated);
  } catch (err) {
    sendError(res, err, 'No se pudo cambiar el estado');
  }
});

router.post('/:id/duplicate', (req, res) => {
  try {
    const copy = promotionService.duplicatePromotion(req.params.id, req.user?.id || '');
    if (!copy) return res.status(404).json({ error: 'Promoción no encontrada' });
    audit(req, 'promotion.duplicate', copy.id, { from: req.params.id });
    broadcastPromotions();
    res.status(201).json(copy);
  } catch (err) {
    sendError(res, err, 'No se pudo duplicar la promoción');
  }
});

router.delete('/:id', (req, res) => {
  try {
    const ok = promotionService.deletePromotion(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Promoción no encontrada' });
    audit(req, 'promotion.delete', req.params.id);
    broadcastPromotions();
    res.json({ success: true });
  } catch (err) {
    sendError(res, err, 'No se pudo eliminar la promoción');
  }
});

module.exports = router;
