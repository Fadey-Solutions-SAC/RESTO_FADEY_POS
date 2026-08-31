const router = require('express').Router();
const { requirePosServiceAuth } = require('../middleware/posServiceAuth');
const { assertClientIdMatches, touchSaasLastActivity } = require('../services/posSaasIdentityService');
const { confirmLicenseFromSaas } = require('../services/platformPaymentService');

/** POST /api/license/confirm — confirmación de licencia/pago desde el panel SaaS */
router.post('/confirm', requirePosServiceAuth, (req, res) => {
  try {
    const access = assertClientIdMatches(req.body?.clientId);
    if (!access.ok) {
      return res.status(access.status).json({ ok: false, error: access.error });
    }
    touchSaasLastActivity();
    const result = confirmLicenseFromSaas({
      clientId: req.body?.clientId,
      status: req.body?.status,
      expirationDate: req.body?.expirationDate,
      message: req.body?.message,
    });
    if (!result.ok) {
      return res.status(result.status || 400).json({
        ok: false,
        error: result.error || 'No se pudo confirmar la licencia',
      });
    }
    return res.json({
      ok: true,
      message: result.message || 'Licencia actualizada',
      payment: result.payment,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message || 'Error al confirmar licencia',
    });
  }
});

module.exports = router;
