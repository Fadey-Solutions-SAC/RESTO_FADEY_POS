const router = require('express').Router();
const { queryAll, queryOne, resetOperationalData } = require('../database');
const { authenticateToken } = require('../middleware/auth');
const { buildPlanModuleTrees } = require('../planModuleCatalog');
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
  evaluateAutomaticBillingRules,
  buildPagoUsoComprobanteUiState,
  getLockState,
  getMasterCredentialsPublic,
  updateMasterCredentials,
} = require('../masterAdminService');

router.use(authenticateToken);

router.get('/admin-notifications', (req, res) => {
  const role = req.user?.role;
  const seesPagoUsoAviso = role === 'admin' || role === 'master_admin';
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
    list = list.filter((n) => String(n.title || '').trim() !== PAGO_USO_SUBIR_COMPROBANTE_AVISO_TITLE);
  }
  return res.json(list);
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

router.get('/dashboard', (req, res) => {
  const control = evaluateAutomaticBillingRules();
  const notifications = getNotifications().slice(0, 50);
  const adminUsers = queryAll(
    `SELECT id, username, email, full_name, role, is_active, created_at
     FROM users
     WHERE role = 'admin'
     ORDER BY created_at DESC`
  );
  res.json({
    control,
    lock: getLockState(),
    notifications,
    admin_users: adminUsers,
    master_credentials: getMasterCredentialsPublic(),
    plan_module_trees: buildPlanModuleTrees(),
  });
});

router.put('/control', (req, res) => {
  const next = setControlConfig(req.body || {}, req.user?.full_name || req.user?.username || 'Administrador maestro');
  res.json(next);
});

router.post('/notifications', (req, res) => {
  const { title, message, image_url = '', duration_hours = null } = req.body || {};
  if (!title || !message) {
    return res.status(400).json({ error: 'Título y mensaje son obligatorios' });
  }
  const saved = addNotification({
    title,
    message,
    image_url,
    duration_hours,
    created_by: req.user?.full_name || req.user?.username || 'Administrador maestro',
  });
  return res.status(201).json(saved);
});

router.put('/notifications/:id', (req, res) => {
  const { title, message, image_url = '', duration_hours = null } = req.body || {};
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
    });
    return res.json(updated);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.delete('/notifications/:id', (req, res) => {
  try {
    const result = deleteNotification(req.params.id);
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
  const buyer = queryOne('SELECT id, role FROM users WHERE id = ?', [buyerId]);
  if (!buyer || buyer.role !== 'admin') {
    return res.status(400).json({ error: 'El usuario seleccionado no es un administrador válido.' });
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

module.exports = router;
