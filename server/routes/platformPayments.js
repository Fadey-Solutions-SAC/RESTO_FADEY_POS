const router = require('express').Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const { getSyncStatus } = require('../services/centralSyncService');
const { mapCentralSyncError } = require('../services/saasPanelErrors');
const { assertComprobantePagoUsoChangeAllowed } = require('../masterAdminService');
const {
  getPublicPlatformPaymentState,
  pollAndApplyPaymentStatus,
  pushComprobanteToCentral,
  submitComprobanteToPanel,
  clearComprobanteDraft,
  readPagoUso,
} = require('../services/platformPaymentService');

router.use(authenticateToken, requireRole('admin', 'master_admin'));

const { getCentralSyncConfigDiagnostics } = require('../../packages/shared-config');

/** GET /api/platform-payments/diagnostic — por qué falla el envío (sin secretos) */
router.get('/diagnostic', (req, res) => {
  const { getPublicPlatformPaymentState } = require('../services/platformPaymentService');
  const diag = getCentralSyncConfigDiagnostics();
  const sync = getSyncStatus();
  const payment = getPublicPlatformPaymentState();
  return res.json({
    configured: diag.configured,
    missingEnvVars: diag.missing,
    centralPlatformUrl: sync.centralPlatformUrl,
    clientId: sync.clientId,
    hasPublicApiUrl: sync.hasPublicApiUrl,
    paymentsEndpoint: sync.paymentsEndpoint,
    lastSyncOk: payment.last_central_sync_ok,
    lastSyncError: payment.last_central_sync_error || null,
    checklist: [
      { ok: Boolean(sync.clientId), label: 'CLIENT_ID en Render' },
      { ok: diag.configured && !diag.missing.includes('API_SECRET_KEY'), label: 'API_SECRET_KEY (igual en POS y panel)' },
      { ok: Boolean(sync.centralPlatformUrl), label: 'CENTRAL_API_URL' },
      { ok: sync.hasPublicApiUrl, label: 'RENDER_PUBLIC_URL o NEXT_PUBLIC_API_URL (URL pública del POS)' },
      { ok: payment.last_central_sync_ok === true, label: 'Último envío al panel exitoso' },
    ],
  });
});

/** GET /api/platform-payments/status — estado local + sincronización con central */
router.get('/status', async (req, res) => {
  try {
    await pollAndApplyPaymentStatus();
    return res.json({
      ...getPublicPlatformPaymentState(),
      central_sync: getSyncStatus(),
    });
  } catch (err) {
    return res.status(200).json({
      ...getPublicPlatformPaymentState(),
      central_sync: getSyncStatus(),
      central_user_message: 'No se pudo consultar el estado del pago. Intente más tarde.',
    });
  }
});

/** POST /api/platform-payments/clear — quita comprobante (solo si no está aprobado) */
router.post('/clear', async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    const isMaster = role === 'master_admin';
    const isRestaurantAdmin = role === 'admin';
    const pago = readPagoUso();
    const previousUrl = String(pago.comprobante_pago_url || '').trim();
    assertComprobantePagoUsoChangeAllowed({
      isMaster,
      isRestaurantAdmin,
      incomingUrl: '',
      previousUrl,
    });
    const result = clearComprobanteDraft();
    return res.status(200).json({
      ok: result.ok,
      payment: getPublicPlatformPaymentState(),
      central_sync: getSyncStatus(),
      central_user_message: result.central_user_message || '',
    });
  } catch (err) {
    return res.status(200).json({
      ok: false,
      central_user_message: err.message || 'No se pudo quitar el comprobante.',
    });
  }
});

/** POST /api/platform-payments/submit — guarda URL y envía comprobante al panel SaaS */
router.post('/submit', async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    const isMaster = role === 'master_admin';
    const isRestaurantAdmin = role === 'admin';
    const incomingUrl = String(req.body?.comprobanteUrl || '').trim();
    const pago = readPagoUso();
    const previousUrl = String(pago.comprobante_pago_url || '').trim();
    const nextUrl = incomingUrl || previousUrl;
    if (!nextUrl) {
      return res.status(400).json({
        ok: false,
        central_user_message: 'Cargue un comprobante antes de enviar.',
      });
    }
    assertComprobantePagoUsoChangeAllowed({
      isMaster,
      isRestaurantAdmin,
      incomingUrl: nextUrl,
      previousUrl,
    });
    const monto = req.body?.monto != null && Number.isFinite(Number(req.body.monto))
      ? Number(req.body.monto)
      : null;
    const result = await submitComprobanteToPanel({
      comprobanteUrl: nextUrl,
      monto,
    });
    return res.status(result.ok ? 200 : 200).json({
      ok: result.ok,
      payment: result.payment || getPublicPlatformPaymentState(),
      central_sync: getSyncStatus(),
      central_user_message: result.central_user_message
        || (result.ok ? 'Comprobante enviado. Pendiente de aprobación.' : ''),
    });
  } catch (err) {
    return res.status(200).json({
      ok: false,
      payment: getPublicPlatformPaymentState(),
      central_sync: getSyncStatus(),
      central_user_message: err.message || 'No se pudo enviar el comprobante.',
    });
  }
});

/** POST /api/platform-payments/resync — reenvía comprobante a la plataforma central */
router.post('/resync', async (req, res) => {
  try {
    const result = await pushComprobanteToCentral();
    return res.json({
      sync: result,
      payment: getPublicPlatformPaymentState(),
      central_sync: getSyncStatus(),
      central_user_message: mapCentralSyncError(result),
    });
  } catch (err) {
    return res.status(200).json({
      payment: getPublicPlatformPaymentState(),
      central_sync: getSyncStatus(),
      central_user_message: 'No se pudo conectar. Use «Reintentar envío».',
    });
  }
});

module.exports = router;
