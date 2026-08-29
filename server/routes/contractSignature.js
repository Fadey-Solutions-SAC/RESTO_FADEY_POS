const express = require('express');
const { authenticateToken, requireRole } = require('../middleware/auth');
const {
  ensureSignatureTables,
  prepareSignature,
  completeSignature,
  getSignatureStatus,
  validateContractSignature,
  partyFromRole,
  getMobileSession,
  submitMobileSignature,
  getRequestPollStatus,
} = require('../services/contractSignature/contractSignatureService');
const { readContrato } = require('../services/contratoStore');

const router = express.Router();

/**
 * Canal móvil (token de sesión). Sin JWT: el temporary_token es el secreto de corta vida.
 * El PIN del DNIe NUNCA debe enviarse aquí.
 */
router.get('/sign/mobile/:token', (req, res) => {
  try {
    ensureSignatureTables();
    res.json(getMobileSession(req.params.token));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Sesión inválida' });
  }
});

router.post('/sign/mobile/:token', async (req, res) => {
  try {
    ensureSignatureTables();
    const result = await submitMobileSignature(req.params.token, req.body || {});
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({
      error: err.message || 'No se pudo registrar la firma móvil',
      code: err.code || undefined,
    });
  }
});

router.use(authenticateToken);
router.use(requireRole('admin', 'master_admin'));

router.get('/', (req, res) => {
  try {
    try {
      ensureSignatureTables();
    } catch (_) {
      /* tablas opcionales: no tumbar lectura del contrato */
    }
    const status = getSignatureStatus();
    res.json({
      ...status,
      my_party: partyFromRole(req.user?.role),
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Error al leer el contrato' });
  }
});

router.get('/signature', (req, res) => {
  try {
    res.json(getSignatureStatus());
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Error al leer firmas' });
  }
});

router.post('/signature/validate', (req, res) => {
  try {
    res.json(validateContractSignature());
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Error al validar' });
  }
});

/** Inicia firma: genera PDF definitivo + hash + sesión móvil. */
router.post('/sign', async (req, res) => {
  try {
    const result = await prepareSignature({
      user: req.user,
      party: req.body?.party,
      documentNumber: req.body?.document_number,
      signerName: req.body?.signer_name,
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'No se pudo iniciar la firma' });
  }
});

/** Completa con MOCK (si permitido) o responde 202 si debe esperarse NFC móvil. */
router.post('/sign/complete', async (req, res) => {
  try {
    const result = await completeSignature({
      user: req.user,
      requestId: req.body?.request_id,
      temporaryToken: req.body?.temporary_token,
      ackReviewed: Boolean(req.body?.ack_reviewed),
      documentNumber: req.body?.document_number,
      signerName: req.body?.signer_name,
      useMock: Boolean(req.body?.use_mock),
    });
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({
      error: err.message || 'No se pudo completar la firma',
      code: err.code || undefined,
      awaiting_mobile: status === 202 || err.code === 'AWAITING_MOBILE_NFC',
    });
  }
});

/** Poll desde el navegador mientras el teléfono firma. */
router.get('/sign/status/:requestId', (req, res) => {
  try {
    res.json(getRequestPollStatus(req.params.requestId, req.user));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Error al consultar estado' });
  }
});

router.get('/raw', (req, res) => {
  res.json(readContrato());
});

module.exports = router;
