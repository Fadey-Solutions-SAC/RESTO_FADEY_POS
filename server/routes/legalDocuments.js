const express = require('express');
const { authenticateToken, requireRole } = require('../middleware/auth');
const legal = require('../services/legalDocumentsService');

const router = express.Router();

router.use(authenticateToken, requireRole('admin', 'master_admin', 'cajero'));

router.get('/', (req, res) => {
  try {
    legal.ensureLegalDocumentsSchema();
    const documents = legal.catalogWithStatus(req.user?.id);
    res.json({
      documents,
      pending: documents.filter((d) => d.pending_acceptance),
      versions: legal.versionsOverview(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al listar documentos legales' });
  }
});

router.get('/acceptances', (req, res) => {
  try {
    const rows = legal.listAcceptances({
      documentId: req.query.document_id || '',
      limit: req.query.limit,
    });
    res.json({ acceptances: rows });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al listar aceptaciones' });
  }
});

router.get('/:id', (req, res) => {
  try {
    const doc = legal.documentDetail(req.params.id, req.user?.id);
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al obtener el documento' });
  }
});

router.post('/:id/accept', (req, res) => {
  try {
    const result = legal.acceptDocument(req.params.id, req.user, req);
    res.json(result);
  } catch (err) {
    const status = Number(err.status) || 400;
    res.status(status).json({ error: err.message || 'No se pudo registrar la aceptación' });
  }
});

module.exports = router;
