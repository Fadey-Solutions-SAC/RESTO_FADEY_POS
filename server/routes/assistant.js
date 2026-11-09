const express = require('express');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { touchPosHeartbeat, getOperationStatus } = require('../assistantOperation');
const { getPrintAgentPresence, touchPrintAgent } = require('../printAgentPresence');

const router = express.Router();

router.use(authenticateToken, requireRole('admin', 'master_admin', 'cajero', 'mozo', 'cocina', 'bar', 'produccion'));

/** El POS (navegador) avisa que el sistema está en uso. */
router.post('/pos-heartbeat', (req, res) => {
  touchPosHeartbeat(req);
  res.json({ ok: true, ...getOperationStatus() });
});

/**
 * El APK consulta si debe estar activo.
 * También marca presencia del asistente móvil (como el poll de print-jobs).
 */
router.get('/operation-status', (req, res) => {
  touchPrintAgent(req, 'assistant/operation-status');
  res.json({
    ...getOperationStatus(),
    agent: getPrintAgentPresence(),
  });
});

module.exports = router;
