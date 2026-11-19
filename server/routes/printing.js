const router = require('express').Router();
const { authenticateTokenAllowLoopback, requireRole } = require('../middleware/auth');
const { loadConfig, saveConfig, normalizeConfig, ensurePrintingModules } = require('../printing/printerConfig');
const {
  parseConfirmPrintValue,
  readCajaSalePrintConfirm,
  writeCajaSalePrintConfirm,
} = require('../printing/cajaConfirmPrintSetting');
const { getPrinters, getNetworkPrinters } = require('../printing/printerDetector');
const { print, printTest, getPrinterStatus } = require('../printing/printerService');

router.use(authenticateTokenAllowLoopback, requireRole('admin', 'master_admin', 'cajero', 'mozo', 'cocina', 'bar', 'produccion'));

function withGlobalCajaConfirm(cfg) {
  const out = cfg && typeof cfg === 'object' ? { ...cfg } : {};
  const caja = out.caja && typeof out.caja === 'object' ? { ...out.caja } : {};
  caja.confirmPrint = readCajaSalePrintConfirm();
  out.caja = caja;
  return out;
}

function emitCajaConfirmPrint(io, enabled) {
  if (!io) return;
  const confirmPrint = Boolean(enabled);
  io.emit('printing-caja-confirm-print', { confirmPrint });
  try {
    io.emit('printing-config-update', withGlobalCajaConfirm(loadConfig()));
  } catch (_) {
    /* bridge sin archivo de config: igual se notificó el flag */
  }
}

/** Preferencia global del restaurante (SQLite). No depende del asistente local. */
router.get('/caja-confirm-print', requireRole('admin', 'master_admin', 'cajero', 'mozo'), (req, res) => {
  res.json({ confirmPrint: readCajaSalePrintConfirm() });
});

router.put('/caja-confirm-print', requireRole('admin', 'master_admin', 'cajero'), (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const raw = Object.prototype.hasOwnProperty.call(body, 'confirmPrint')
      ? body.confirmPrint
      : body.enabled;
    const next = writeCajaSalePrintConfirm(parseConfirmPrintValue(raw));
    emitCajaConfirmPrint(req.app.get('io'), next);
    res.json({ confirmPrint: next });
  } catch (err) {
    res.status(400).json({ error: err.message || 'No se pudo guardar la confirmación de impresión' });
  }
});

router.get('/config', requireRole('admin', 'master_admin', 'cajero', 'cocina', 'bar', 'produccion'), (req, res) => {
  try {
    const { listKnownProductionAreaIds } = require('../services/productionAreasService');
    ensurePrintingModules(listKnownProductionAreaIds());
  } catch (_) { /* noop */ }
  try {
    res.json(withGlobalCajaConfirm(loadConfig()));
  } catch (_) {
    res.json(withGlobalCajaConfirm({}));
  }
});

router.put('/config', requireRole('admin', 'master_admin', 'cajero', 'cocina', 'bar', 'produccion'), (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (body.caja && Object.prototype.hasOwnProperty.call(body.caja, 'confirmPrint')) {
      writeCajaSalePrintConfirm(parseConfirmPrintValue(body.caja.confirmPrint));
    }
    const next = withGlobalCajaConfirm(saveConfig(body));
    const io = req.app.get('io');
    if (io) {
      io.emit('printing-config-update', next);
      io.emit('printing-caja-confirm-print', { confirmPrint: Boolean(next?.caja?.confirmPrint) });
    }
    res.json(next);
  } catch (err) {
    res.status(400).json({ error: err.message || 'No se pudo guardar configuración de impresión' });
  }
});

router.get('/network-printers', requireRole('admin', 'master_admin', 'cajero', 'cocina', 'bar', 'produccion'), (req, res) => {
  try {
    res.json(getNetworkPrinters());
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudieron detectar impresoras de red' });
  }
});

router.get('/printers', requireRole('admin', 'master_admin', 'cajero', 'cocina', 'bar', 'produccion'), (req, res) => {
  const mod = String(req.query.module || '').trim().toLowerCase();
  const list = getPrinters();
  const items = list.map((p) => ({ name: p.name }));
  console.log(
    `[printing] GET /api/printing/printers → ${list.length} impresora(s) USB${mod ? ` (módulo solicitante: ${mod})` : ''}`,
  );
  res.json(items);
});

router.post('/print/:module', (req, res) => {
  const moduleName = String(req.params.module || '').trim();
  print(moduleName, req.body || {})
    .then((out) => res.json(out))
    .catch((err) => {
      console.error('[printing] error:', err.message || err);
      res.status(400).json({ error: err.message || 'No se pudo imprimir' });
    });
});

router.post('/test/:module', requireRole('admin', 'master_admin', 'cajero', 'cocina', 'bar', 'produccion'), (req, res) => {
  const moduleName = String(req.params.module || '').trim();
  printTest(moduleName)
    .then((out) => res.json(out))
    .catch((err) => {
      console.error('[printing] test error:', err.message || err);
      res.status(400).json({ error: err.message || 'No se pudo imprimir prueba' });
    });
});

router.get('/status/:module', requireRole('admin', 'master_admin', 'cajero', 'cocina', 'bar', 'produccion'), (req, res) => {
  const moduleName = String(req.params.module || '').trim();
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
