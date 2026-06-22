const router = require('express').Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const { loadConfig, saveConfig, normalizeConfig } = require('../printing/printerConfig');
const { getPrinters } = require('../printing/printerDetector');
const { print, printTest, getPrinterStatus } = require('../printing/printerService');

router.use(authenticateToken, requireRole('admin', 'master_admin', 'cajero', 'mozo', 'cocina', 'bar'));

router.get('/config', requireRole('admin', 'master_admin', 'cajero', 'cocina', 'bar'), (req, res) => {
  res.json(loadConfig());
});

router.put('/config', requireRole('admin', 'master_admin', 'cajero', 'cocina', 'bar'), (req, res) => {
  try {
    const next = saveConfig(req.body || {});
    const io = req.app.get('io');
    if (io) io.emit('printing-config-update', next);
    res.json(next);
  } catch (err) {
    res.status(400).json({ error: err.message || 'No se pudo guardar configuración de impresión' });
  }
});

router.get('/printers', requireRole('admin', 'master_admin', 'cajero', 'cocina', 'bar'), (req, res) => {
  const mod = String(req.query.module || '').trim().toLowerCase();
  const list = getPrinters();
  const items = list.map((p) => ({ name: p.name }));
  console.log(
    `[printing] GET /api/printing/printers → ${list.length} impresora(s) USB${mod ? ` (módulo solicitante: ${mod})` : ''}`,
  );
  res.json(items);
});

router.post('/print/:module', (req, res) => {
  const moduleName = String(req.params.module || '').toLowerCase();
  print(moduleName, req.body || {})
    .then((out) => res.json(out))
    .catch((err) => {
      console.error('[printing] error:', err.message || err);
      res.status(400).json({ error: err.message || 'No se pudo imprimir' });
    });
});

router.post('/test/:module', requireRole('admin', 'master_admin', 'cajero', 'cocina', 'bar'), (req, res) => {
  const moduleName = String(req.params.module || '').toLowerCase();
  printTest(moduleName)
    .then((out) => res.json(out))
    .catch((err) => {
      console.error('[printing] test error:', err.message || err);
      res.status(400).json({ error: err.message || 'No se pudo imprimir prueba' });
    });
});

router.get('/status/:module', requireRole('admin', 'master_admin', 'cajero', 'cocina', 'bar'), (req, res) => {
  const moduleName = String(req.params.module || '').toLowerCase();
  getPrinterStatus(moduleName)
    .then((status) => res.json(status))
    .catch((err) => {
      console.error('[printing] status error:', err.message || err);
      res.status(400).json({ error: err.message || 'No se pudo verificar estado de impresora' });
    });
});

router.get('/normalize-preview', requireRole('admin', 'master_admin'), (req, res) => {
  res.json(normalizeConfig(req.body || {}, { strict: false }));
});

module.exports = router;
