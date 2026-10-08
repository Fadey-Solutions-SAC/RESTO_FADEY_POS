const router = require('express').Router();
const { queryAll, queryOne, resetOperationalData } = require('../database');
const { authenticateToken } = require('../middleware/auth');
const { buildPlanModuleTrees } = require('../planModuleCatalog');
const { PLAN_KEYS, PLAN_INFO } = require('../servicePlan');
const {
  PAGO_USO_SUBIR_COMPROBANTE_AVISO_TITLE,
  clearPaymentCycleReminderNotifications,
  shouldSuppressBillingDueNotification,
  getControlConfig,
  setControlConfig,
  getNotifications,
  getActiveNotifications,
  addNotification,
  updateNotification,
  deleteNotification,
  rememberCentralNoticeId,
  dismissAdminNotification,
  dismissAdminNotificationsBulk,
  evaluateAutomaticBillingRules,
  buildPagoUsoComprobanteUiState,
  getLockState,
  getMasterCredentialsPublic,
  updateMasterCredentials,
} = require('../masterAdminService');

router.use(authenticateToken);

async function refreshCentralNotices() {
  try {
    const { pullPlatformNotices } = require('../services/centralSyncService');
    await pullPlatformNotices();
  } catch (_) {
    /* la central puede estar caída; el POS sigue con lo ya guardado */
  }
}

async function syncNoticeOut(entry) {
  if (!entry || (!entry.broadcast && !entry.central_id)) return entry;
  try {
    const { pushPlatformNotice, updatePlatformNotice } = require('../services/centralSyncService');
    if (entry.central_id) {
      await updatePlatformNotice(entry.central_id, entry);
      return entry;
    }
    const remote = await pushPlatformNotice(entry);
    const remoteId = String(remote?.data?.id || remote?.data?.notice?.id || '').trim();
    if (!remoteId) return entry;
    return rememberCentralNoticeId(entry.id, remoteId) || { ...entry, central_id: remoteId };
  } catch (err) {
    console.warn('[central-notices]', err.message || err);
    return entry;
  }
}

router.get('/admin-notifications', async (req, res) => {
  const role = req.user?.role;
  const seesPagoUsoAviso = role === 'admin' || role === 'master_admin';
  try {
    await refreshCentralNotices();
  } catch (_) {
    /* opcional */
  }
  try {
    const { readPagoUso } = require('../services/platformPaymentService');
    if (shouldSuppressBillingDueNotification(readPagoUso())) {
      clearPaymentCycleReminderNotifications();
    }
  } catch (_) {
    /* opcional */
  }
  let list = getActiveNotifications().slice(0, 30);
  if (!seesPagoUsoAviso) {
    list = list.filter((n) => String(n.title || '').trim() !== PAGO_USO_SUBIR_COMPROBANTE_AVISO_TITLE
      && String(n.audience || '').trim() !== 'admin');
  }
  return res.json(list);
});

/** Quitar aviso: queda eliminado en el servidor (no solo en este navegador). */
router.post('/admin-notifications/:id/dismiss', (req, res) => {
  try {
    const result = dismissAdminNotification(req.params.id);
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'No se pudo quitar el aviso' });
  }
});

/** Migrar descartes viejos de localStorage → servidor. */
router.post('/admin-notifications/dismiss-bulk', (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    return res.json(dismissAdminNotificationsBulk(ids));
  } catch (err) {
    return res.status(400).json({ error: err.message || 'No se pudo migrar descartes' });
  }
});

/** Misma configuración que edita el maestro en «Fecha de facturación»; el admin del restaurante solo la consulta. */
router.get('/billing-schedule', (req, res) => {
  if (!['admin', 'master_admin'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'Sin permisos' });
  }
  const control = evaluateAutomaticBillingRules();
  return res.json({
    billing_date: String(control.billing_date || '').trim(),
    notify_days_before: Math.max(1, Math.min(30, Number(control.notify_days_before || 5))),
    auto_block_on_overdue: Number(control.auto_block_on_overdue || 0) === 1,
    pago_uso_comprobante: buildPagoUsoComprobanteUiState(),
  });
});

router.use((req, res, next) => {
  if (req.user?.role !== 'master_admin') {
    return res.status(403).json({ error: 'Acceso exclusivo para administrador maestro' });
  }
  return next();
});

router.get('/dashboard', async (req, res) => {
  await refreshCentralNotices();
  const control = evaluateAutomaticBillingRules();
  const notifications = getNotifications().slice(0, 50);
  const adminUsers = queryAll(
    `SELECT id, username, email, full_name, role, is_active, is_buyer_admin, created_at
     FROM users
     WHERE role = 'admin' AND COALESCE(is_buyer_admin, 0) = 1
     ORDER BY created_at DESC`
  );
  res.json({
    control,
    lock: getLockState(),
    notifications,
    admin_users: adminUsers,
    master_credentials: getMasterCredentialsPublic(),
    plan_module_trees: buildPlanModuleTrees(),
    plan_catalog: PLAN_KEYS.map((key) => ({ key, ...PLAN_INFO[key] })),
    active_users_count: Number(queryOne(
      `SELECT COUNT(*) AS n FROM users WHERE IFNULL(is_active, 1) = 1 AND role != 'master_admin'`,
    )?.n || 0),
  });
});

router.put('/control', (req, res) => {
  const next = setControlConfig(req.body || {}, req.user?.full_name || req.user?.username || 'Administrador maestro');
  res.json(next);
});

router.post('/notifications', async (req, res) => {
  const { title, message, image_url = '', duration_hours = null, audience = 'all', target_plans = [] } = req.body || {};
  if (!title || !message) {
    return res.status(400).json({ error: 'Título y mensaje son obligatorios' });
  }
  try {
    const saved = addNotification({
      title,
      message,
      image_url,
      duration_hours,
      audience: audience === 'plans' ? 'plans' : 'all',
      target_plans,
      broadcast: true,
      created_by: req.user?.full_name || req.user?.username || 'Administrador maestro',
    });
    const synced = await syncNoticeOut(saved);
    return res.status(201).json(synced);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'No se pudo publicar' });
  }
});

router.put('/notifications/:id', async (req, res) => {
  const { title, message, image_url = '', duration_hours = null, audience = 'all', target_plans = [] } = req.body || {};
  if (!title || !message) {
    return res.status(400).json({ error: 'Título y mensaje son obligatorios' });
  }
  try {
    const updated = updateNotification({
      id: req.params.id,
      title,
      message,
      image_url,
      duration_hours,
      audience: audience === 'plans' ? 'plans' : audience === 'admin' ? 'admin' : 'all',
      target_plans,
    });
    const synced = await syncNoticeOut(updated);
    return res.json(synced);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.delete('/notifications/:id', async (req, res) => {
  try {
    const result = deleteNotification(req.params.id);
    if (result.central_id) {
      try {
        const { deletePlatformNotice } = require('../services/centralSyncService');
        await deletePlatformNotice(result.central_id);
      } catch (err) {
        console.warn('[central-notices]', err.message || err);
      }
    }
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.put('/credentials', (req, res) => {
  const { current_password, new_username, new_password } = req.body || {};
  if (!current_password) {
    return res.status(400).json({ error: 'La contraseña actual es obligatoria' });
  }
  if (!String(new_username || '').trim() && !String(new_password || '').trim()) {
    return res.status(400).json({ error: 'Debes enviar nuevo usuario o nueva contraseña' });
  }
  try {
    const updated = updateMasterCredentials({ current_password, new_username, new_password });
    return res.json(updated);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post('/factory-reset', (req, res) => {
  const { buyer_admin_user_id = '', confirm_text = '' } = req.body || {};
  if (String(confirm_text || '').trim().toUpperCase() !== 'LIMPIAR') {
    return res.status(400).json({ error: 'Confirmación inválida. Escribe LIMPIAR para continuar.' });
  }
  const buyerId = String(buyer_admin_user_id || '').trim();
  if (!buyerId) {
    return res.status(400).json({ error: 'Debes seleccionar el administrador comprador a conservar.' });
  }
  const buyer = queryOne(
    'SELECT id, role, COALESCE(is_buyer_admin, 0) AS is_buyer_admin FROM users WHERE id = ?',
    [buyerId],
  );
  if (!buyer || buyer.role !== 'admin' || Number(buyer.is_buyer_admin) !== 1) {
    return res.status(400).json({ error: 'Seleccione un administrador dueño (creado desde el maestro).' });
  }
  try {
    resetOperationalData({ keepAdminUserId: buyerId });
    return res.json({
      success: true,
      message: 'Base limpiada correctamente. La app quedó lista para nueva configuración del comprador.',
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'No se pudo limpiar la base' });
  }
});

router.post('/ai-messages/test', async (req, res) => {
  if (req.user?.role !== 'master_admin') {
    return res.status(403).json({ error: 'Solo el administrador maestro puede enviar esta prueba.' });
  }
  try {
    const { sendWrittenMessagesTest } = require('../services/fadeyAi/fadeyAiQuestionExport');
    const result = await sendWrittenMessagesTest();
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'No se pudo enviar la prueba.' });
  }
});

module.exports = router;
