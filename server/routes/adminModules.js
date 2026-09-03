const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const { queryAll, queryOne, runSql, logAudit } = require('../database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const {
  getControlConfig,
  assertComprobantePagoUsoChangeAllowed,
  evaluateAutomaticBillingRules,
  assertPadronConsultAllowed,
  recordSuccessfulPadronConsult,
} = require('../masterAdminService');
const { getOrderWithItems } = require('../orderCreateService');
const { restoreNonTransformedStockForOrder } = require('../warehouseStock');
const { emitInventoryUpdate, emitStaffDataUpdate } = require('../socketBroadcast');
const { verifyAdminPassword } = require('../lib/adminPassword');

function broadcastStaffData(domain) {
  emitStaffDataUpdate({ domain: String(domain || '') });
}
const { consultarPadronPeru } = require('../peruConsultaPadron');
const { suggestComboProducts } = require('../services/comboSuggestService');
const { resolveRestaurantId, syncPrinterRoutesFromImpresoras, listPrinterRoutes } = require('../printerRoutesService');
const { computeKitchenReleaseAtForReservation } = require('../services/reservationKitchenHold');
const { getValidUiThemeId } = require('../uiThemeCatalog');

router.use(authenticateToken, requireRole('admin', 'cajero', 'mozo'));

const APP_CONFIG_ALLOWED_KEYS = [
  'regional',
  'series_contingencia',
  'contrato',
  'pagos_sistema',
  'pago_uso_sistema',
  'settings',
  'mi_restaurant',
];

function parseJsonSafe(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (_) {
    return fallback;
  }
}

function normalizeDocType(value) {
  const docType = String(value || '').trim();
  if (docType === '6') return '6';
  if (docType === '0') return '0';
  return '1';
}

function normalizeDocNumber(value) {
  return String(value || '').trim();
}

function validateCustomerDoc(docType, docNumber) {
  if (!docNumber) return;
  if (docType === '1' && !/^\d{8}$/.test(docNumber)) {
    throw new Error('DNI inválido, debe tener 8 dígitos');
  }
  if (docType === '6' && !/^\d{11}$/.test(docNumber)) {
    throw new Error('RUC inválido, debe tener 11 dígitos');
  }
}

function readAppSettingsObject() {
  const rows = queryAll('SELECT key, value FROM app_settings ORDER BY key ASC');
  const out = {};
  rows.forEach((row) => {
    out[row.key] = parseJsonSafe(row.value, {});
  });
  return out;
}

/** Fusiona regional (settings.regional tiene prioridad) y devuelve respuesta coherente al cliente. */
function readAppSettingsForClient() {
  const { mergeRegional } = require('../services/regionalFormatService');
  const out = readAppSettingsObject();
  const settings =
    out.settings && typeof out.settings === 'object' && !Array.isArray(out.settings)
      ? { ...out.settings }
      : {};
  const topRegional =
    out.regional && typeof out.regional === 'object' && !Array.isArray(out.regional) ? out.regional : {};
  const regional = mergeRegional({
    ...topRegional,
    ...(settings.regional && typeof settings.regional === 'object' ? settings.regional : {}),
  });
  return {
    ...out,
    regional,
    settings: { ...settings, regional },
    contrato: enrichContratoForClient(out.contrato),
  };
}

function enrichContratoForClient(raw) {
  try {
    const { publicContratoView } = require('../services/contractSignature/contractSignatureService');
    // Siempre desde store (texto base, firmas, text_locked). No altera otras keys de config.
    return publicContratoView();
  } catch (_) {
    return raw && typeof raw === 'object' ? raw : {};
  }
}

function persistRegionalFromSettings(settingsRegional) {
  if (!settingsRegional || typeof settingsRegional !== 'object') return;
  const { mergeRegional } = require('../services/regionalFormatService');
  const { syncRegionalToRestaurant } = require('../services/systemConfigHubService');
  const regional = mergeRegional(settingsRegional);
  syncRegionalToRestaurant(regional);
  runSql(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ('regional', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [JSON.stringify(regional)]
  );
}

function mergeSettingsBlob(prevParsed, incoming) {
  const prev = prevParsed && typeof prevParsed === 'object' && !Array.isArray(prevParsed) ? prevParsed : {};
  const next = incoming && typeof incoming === 'object' && !Array.isArray(incoming) ? incoming : {};
  const merged = { ...prev, ...next };
  /** Cartas QR: solo se editan en Auto pedido; Configuración no debe borrarlas al guardar. */
  if (!Object.prototype.hasOwnProperty.call(next, 'auto_pedido_cartas') && Array.isArray(prev.auto_pedido_cartas)) {
    merged.auto_pedido_cartas = prev.auto_pedido_cartas;
  }
  try {
    const { shouldKeepPreviousCatalog } = require('../services/settingsCatalogRecover');
    if (shouldKeepPreviousCatalog(prev.cajas, next.cajas, 'cajas')) {
      merged.cajas = prev.cajas;
    }
    if (shouldKeepPreviousCatalog(prev.salones, next.salones, 'salones')) {
      merged.salones = prev.salones;
    }
  } catch (_) {
    /* recover opcional */
  }
  return merged;
}

function parseTimeToMinutes(timeValue) {
  const [h, m] = String(timeValue || '').split(':').map(v => Number(v));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function hasReservationConflict({ tableId, date, time, excludeId = '' }) {
  if (!tableId || !date || !time) return false;
  const targetMinutes = parseTimeToMinutes(time);
  if (targetMinutes === null) return false;
  const rows = queryAll(
    `SELECT id, time
     FROM reservations
     WHERE table_id = ?
       AND date = ?
       AND status IN ('confirmed', 'pending')
       AND id != ?`,
    [tableId, date, excludeId || '']
  );
  // Standard block window: 90 minutes per reservation.
  return rows.some((row) => {
    const existingMinutes = parseTimeToMinutes(row.time);
    if (existingMinutes === null) return false;
    return Math.abs(existingMinutes - targetMinutes) < 90;
  });
}

router.get('/config/app', requireRole('admin', 'master_admin'), (req, res) => {
  try {
    const { recoverCajasAndSalonesIfResetToDefaults } = require('../services/settingsCatalogRecover');
    recoverCajasAndSalonesIfResetToDefaults();
  } catch (_) {
    /* historial opcional */
  }
  res.json(readAppSettingsForClient());
});

/** Guarda solo tema visual del restaurante (settings.ui_theme*). */
router.put('/config/appearance', requireRole('admin', 'master_admin'), (req, res) => {
  try {
    const incoming = req.body && typeof req.body === 'object' ? req.body : {};
    const prevRow = queryOne('SELECT value FROM app_settings WHERE key = ?', ['settings']);
    const beforeState = readAppSettingsObject();
    const settingsObj = parseJsonSafe(prevRow?.value, {});

    if (incoming.ui_theme !== undefined) {
      settingsObj.ui_theme = getValidUiThemeId(incoming.ui_theme);
    }
    if (incoming.ui_theme_mode !== undefined) {
      const mode = String(incoming.ui_theme_mode || 'light').trim();
      settingsObj.ui_theme_mode = ['light', 'dark', 'auto'].includes(mode) ? mode : 'light';
    }
    if (incoming.ui_theme_custom !== undefined) {
      settingsObj.ui_theme_custom =
        incoming.ui_theme_custom && typeof incoming.ui_theme_custom === 'object' && !Array.isArray(incoming.ui_theme_custom)
          ? incoming.ui_theme_custom
          : {};
    }

    runSql(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      ['settings', JSON.stringify(settingsObj)]
    );

    const { saveDb } = require('../database');
    saveDb();

    const out = readAppSettingsObject();
    const historyId = uuidv4();
    runSql(
      `INSERT INTO app_settings_history (id, actor_user_id, actor_name, changed_keys, before_state, after_state, details)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        historyId,
        req.user.id,
        req.user.full_name || req.user.username || '',
        JSON.stringify(['settings']),
        JSON.stringify(beforeState),
        JSON.stringify(out),
        JSON.stringify({ source: 'config_appearance_put', fields: Object.keys(incoming) }),
      ]
    );
    logAudit({
      actorUserId: req.user.id,
      actorName: req.user.full_name || req.user.username || '',
      action: 'app_settings.update',
      resourceType: 'app_settings',
      resourceId: 'appearance',
      details: { updated_keys: ['settings'], history_id: historyId, fields: Object.keys(incoming) },
    });
    broadcastStaffData('app_config');
    res.json(readAppSettingsForClient());
  } catch (err) {
    res.status(400).json({ error: err.message || 'No se pudo guardar la apariencia' });
  }
});

/** Hub de configuración: contexto en vivo por sección (Indicadores, operación, regional). */
router.get('/config/hub', requireRole('admin', 'master_admin'), (req, res) => {
  try {
    const { buildConfigHub } = require('../services/systemConfigHubService');
    res.json(buildConfigHub());
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudo cargar el hub de configuración' });
  }
});

router.post('/config/regional-preview', requireRole('admin', 'master_admin'), (req, res) => {
  try {
    const { buildPreview, mergeRegional } = require('../services/regionalFormatService');
    const { readRegional } = require('../services/systemConfigHubService');
    const incoming = req.body?.regional && typeof req.body.regional === 'object' ? req.body.regional : null;
    const regional = incoming ? mergeRegional(incoming) : readRegional();
    res.json(buildPreview(regional));
  } catch (err) {
    res.status(400).json({ error: err.message || 'Vista previa inválida' });
  }
});

/** Guarda solo configuración regional (settings.regional + clave regional en BD). */
router.put('/config/regional', requireRole('admin', 'master_admin'), (req, res) => {
  try {
    const incoming = req.body?.regional;
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      return res.status(400).json({ error: 'Se requiere regional: { país, idioma, moneda, … }' });
    }
    const { mergeRegional } = require('../services/regionalFormatService');
    const regional = mergeRegional(incoming);

    const prevRow = queryOne('SELECT value FROM app_settings WHERE key = ?', ['settings']);
    const settingsObj = parseJsonSafe(prevRow?.value, {});
    settingsObj.regional = regional;

    runSql(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      ['settings', JSON.stringify(settingsObj)]
    );
    persistRegionalFromSettings(regional);

    const { saveDb } = require('../database');
    saveDb();

    broadcastStaffData('app_config');
    res.json({ ok: true, regional });
  } catch (err) {
    res.status(400).json({ error: err.message || 'No se pudo guardar la configuración regional' });
  }
});

/** Guarda solo configuración regional (settings.regional + clave regional en BD). */
router.put('/config/regional', requireRole('admin', 'master_admin'), (req, res) => {
  try {
    const incoming = req.body?.regional;
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      return res.status(400).json({ error: 'Se requiere body.regional con la configuración regional' });
    }
    const { mergeRegional } = require('../services/regionalFormatService');
    const regional = mergeRegional(incoming);

    const prevRow = queryOne('SELECT value FROM app_settings WHERE key = ?', ['settings']);
    const settingsObj = parseJsonSafe(prevRow?.value, {});
    settingsObj.regional = regional;
    runSql(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      ['settings', JSON.stringify(settingsObj)]
    );
    persistRegionalFromSettings(regional);

    broadcastStaffData('app_config');
    res.json({ ok: true, regional });
  } catch (err) {
    res.status(400).json({ error: err.message || 'No se pudo guardar la configuración regional' });
  }
});

/** Guarda solo configuración regional (evita sobrescribir todo el blob `settings` por error). */
router.put('/config/regional', requireRole('admin', 'master_admin'), (req, res) => {
  try {
    const incoming = req.body?.regional;
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      return res.status(400).json({ error: 'Se requiere body.regional como objeto' });
    }
    const { mergeRegional } = require('../services/regionalFormatService');
    const regional = mergeRegional(incoming);

    const prevRow = queryOne('SELECT value FROM app_settings WHERE key = ?', ['settings']);
    const settingsObj = parseJsonSafe(prevRow?.value, {});
    settingsObj.regional = regional;

    runSql(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      ['settings', JSON.stringify(settingsObj)]
    );
    persistRegionalFromSettings(regional);

    const { saveDb } = require('../database');
    saveDb();

    logAudit({
      actorUserId: req.user.id,
      actorName: req.user.full_name || req.user.username || '',
      action: 'app_settings.regional',
      resourceType: 'app_settings',
      resourceId: 'regional',
      details: { language: regional.language, currency_code: regional.currency_code },
    });

    broadcastStaffData('app_config');
    res.json({ ok: true, regional });
  } catch (err) {
    res.status(400).json({ error: err.message || 'No se pudo guardar la configuración regional' });
  }
});

/** Rutas de impresión persistidas (tabla printer_routes, por restaurant_id). */
router.get('/printer-routes', requireRole('admin', 'master_admin'), (req, res) => {
  try {
    res.json({ routes: listPrinterRoutes(resolveRestaurantId(req.user)) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudieron leer las rutas' });
  }
});

function normalizeAutoPedidoCartas(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c, i) => ({
      id: String(c.id || '').trim() || uuidv4(),
      name: String(c.name || '').trim() || `Carta ${i + 1}`,
      url: String(c.url || '').trim(),
      sort: Number.isFinite(Number(c.sort)) ? Number(c.sort) : i,
    }))
    .filter((c) => c.url)
    .sort((a, b) => a.sort - b.sort);
}

function readAutoPedidoCartasFromDb() {
  const settingsObj = parseJsonSafe(queryOne('SELECT value FROM app_settings WHERE key = ?', ['settings'])?.value, {});
  return normalizeAutoPedidoCartas(settingsObj.auto_pedido_cartas);
}

function tryRecoverAutoPedidoCartasFromHistory() {
  const rows = queryAll(
    `SELECT before_state, after_state FROM app_settings_history ORDER BY datetime(created_at) DESC LIMIT 80`
  );
  for (const row of rows) {
    for (const col of ['before_state', 'after_state']) {
      const state = parseJsonSafe(row[col], null);
      if (!state || typeof state !== 'object') continue;
      const cartas = normalizeAutoPedidoCartas(state.settings?.auto_pedido_cartas);
      if (cartas.length > 0) return cartas;
    }
  }
  return [];
}

function persistAutoPedidoCartas(cartas) {
  const prevRow = queryOne('SELECT value FROM app_settings WHERE key = ?', ['settings']);
  const settingsObj = parseJsonSafe(prevRow?.value, {});
  settingsObj.auto_pedido_cartas = cartas;
  runSql(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    ['settings', JSON.stringify(settingsObj)]
  );
  const { saveDb } = require('../database');
  saveDb();
}

router.get('/auto-pedido/cartas', (req, res) => {
  const settingsObj = parseJsonSafe(queryOne('SELECT value FROM app_settings WHERE key = ?', ['settings'])?.value, {});
  let cartas = readAutoPedidoCartasFromDb();
  const rawCartas = settingsObj.auto_pedido_cartas;
  if (!cartas.length && rawCartas === undefined) {
    const recovered = tryRecoverAutoPedidoCartasFromHistory();
    if (recovered.length) {
      persistAutoPedidoCartas(recovered);
      broadcastStaffData('auto_pedido_cartas');
      cartas = recovered;
    }
  }
  res.json({ cartas });
});

router.put('/auto-pedido/cartas', requireRole('admin'), (req, res) => {
  try {
    const cartasIn = req.body?.cartas;
    if (!Array.isArray(cartasIn)) return res.status(400).json({ error: 'Se esperaba cartas: []' });
    const normalized = normalizeAutoPedidoCartas(cartasIn);
    persistAutoPedidoCartas(normalized);
    logAudit({
      actorUserId: req.user.id,
      actorName: req.user.full_name || req.user.username || '',
      action: 'app_settings.auto_pedido_cartas',
      resourceType: 'app_settings',
      resourceId: 'settings',
      details: { count: normalized.length },
    });
    broadcastStaffData('auto_pedido_cartas');
    res.json({ cartas: normalized });
  } catch (err) {
    res.status(400).json({ error: err.message || 'No se pudo guardar' });
  }
});

router.get('/config/app/history', requireRole('admin'), (req, res) => {
  const limit = Math.min(Math.max(Number(req.query?.limit || 20), 1), 100);
  const offset = Math.max(Number(req.query?.offset || 0), 0);
  const section = String(req.query?.section || '').trim();
  const actor = String(req.query?.actor || '').trim();
  const q = String(req.query?.q || '').trim();
  const where = [];
  const params = [];
  if (section && section !== 'all') {
    where.push('changed_keys LIKE ?');
    params.push(`%"${section}"%`);
  }
  if (actor && actor !== 'all') {
    if (actor === '__empty__') {
      where.push("TRIM(COALESCE(actor_name, '')) = ''");
    } else {
      where.push('actor_name = ?');
      params.push(actor);
    }
  }
  if (q) {
    where.push('(actor_name LIKE ? OR changed_keys LIKE ? OR details LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const countRow = queryOne(
    `SELECT COUNT(*) as total
     FROM app_settings_history
     ${whereSql}`,
    params
  ) || { total: 0 };
  const rows = queryAll(
    `SELECT id, actor_user_id, actor_name, changed_keys, before_state, after_state, details, created_at
     FROM app_settings_history
     ${whereSql}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const history = rows.map((row) => ({
    ...row,
    changed_keys: parseJsonSafe(row.changed_keys, []),
    before_state: parseJsonSafe(row.before_state, {}),
    after_state: parseJsonSafe(row.after_state, {}),
    details: parseJsonSafe(row.details, {}),
  }));
  res.json({
    items: history,
    total: Number(countRow.total || 0),
    limit,
    offset,
  });
});

router.put('/config/app', requireRole('admin', 'master_admin'), (req, res) => {
  try {
  const payload = { ...(req.body || {}) };
  const isMaster = req.user?.role === 'master_admin';

  if (payload.contrato !== undefined && !isMaster) {
    return res.status(403).json({ error: 'Solo el administrador maestro puede modificar el contrato del servicio.' });
  }
  if (payload.contrato !== undefined && isMaster) {
    const { mergeContratoForConfigPut, readContrato } = require('../services/contratoStore');
    payload.contrato = mergeContratoForConfigPut(readContrato(), payload.contrato);
  }

  const billingBotUnlocked =
    isMaster || Number(getControlConfig().allow_restaurant_admin_billing_bot ?? 0) === 1;
  if (!isMaster) {
    const keys = Object.keys(payload).filter((k) => payload[k] !== undefined);
    if (keys.includes('series_contingencia') && !billingBotUnlocked) {
      return res.status(403).json({
        error:
          'Solo el administrador maestro puede modificar las series de contingencia, salvo que active la edición del bot SUNAT para administradores del restaurante.',
      });
    }
    /** Admin del restaurante: solo puede actualizar la URL del comprobante de pago por uso; el resto lo conserva la BD. */
    if (payload.pago_uso_sistema !== undefined) {
      const previous = queryOne('SELECT value FROM app_settings WHERE key = ?', ['pago_uso_sistema']);
      const prevParsed = parseJsonSafe(previous?.value, {});
      const inc = payload.pago_uso_sistema && typeof payload.pago_uso_sistema === 'object' ? payload.pago_uso_sistema : {};
      const prevUrl = String(prevParsed.comprobante_pago_url || '').trim();
      const nextUrl = String(inc.comprobante_pago_url ?? prevParsed.comprobante_pago_url ?? '').trim();
      assertComprobantePagoUsoChangeAllowed({
        isMaster: false,
        isRestaurantAdmin: req.user?.role === 'admin',
        incomingUrl: nextUrl,
        previousUrl: prevUrl,
      });
      let nextPago = {
        ...prevParsed,
        comprobante_pago_url: nextUrl,
      };
      if (inc.monto_comprobante !== undefined && inc.monto_comprobante !== null && inc.monto_comprobante !== '') {
        const montoRaw = Number(inc.monto_comprobante);
        if (Number.isFinite(montoRaw) && montoRaw > 0) {
          nextPago.monto_comprobante = Math.round(montoRaw * 100) / 100;
        }
      }
      if (nextUrl && nextUrl !== prevUrl) {
        const { applyNewComprobanteUploadToPago } = require('../services/platformPaymentService');
        nextPago = applyNewComprobanteUploadToPago(nextPago, nextUrl, prevUrl);
      }
      payload.pago_uso_sistema = nextPago;
    }
  }

  if (isMaster && payload.pago_uso_sistema !== undefined) {
    const { proximaFechaFromControlAnchor } = require('../pagoUsoBillingSync');
    const anchor = String(getControlConfig().billing_date || '').trim();
    const prevParsed = parseJsonSafe(queryOne('SELECT value FROM app_settings WHERE key = ?', ['pago_uso_sistema'])?.value, {});
    const inc = payload.pago_uso_sistema && typeof payload.pago_uso_sistema === 'object' ? payload.pago_uso_sistema : {};
    const merged = { ...prevParsed, ...inc };
    const nextPeriodo = merged.periodo_facturacion === 'semestral' ? 'semestral' : 'mensual';
    const prevPeriodo = prevParsed.periodo_facturacion === 'semestral' ? 'semestral' : 'mensual';
    const periodoChanged = nextPeriodo !== prevPeriodo;
    if (/^\d{4}-\d{2}-\d{2}$/.test(anchor) && (periodoChanged || !String(merged.fecha_proxima_facturacion || '').trim())) {
      merged.fecha_proxima_facturacion = proximaFechaFromControlAnchor(anchor, nextPeriodo);
    }
    if (merged.comprobante_grace_days_after_due !== undefined) {
      const g = Number(merged.comprobante_grace_days_after_due);
      merged.comprobante_grace_days_after_due = Number.isFinite(g)
        ? Math.max(1, Math.min(14, Math.round(g)))
        : (prevParsed.comprobante_grace_days_after_due ?? 3);
    }
    if (merged.precio_plan !== undefined && merged.precio_plan !== null && merged.precio_plan !== '') {
      const precio = Number(merged.precio_plan);
      if (Number.isFinite(precio) && precio >= 0) {
        merged.precio_plan = Math.round(precio * 100) / 100;
      } else {
        merged.precio_plan = prevParsed.precio_plan ?? '';
      }
    }
    if (merged.numero_telefono !== undefined) {
      merged.numero_telefono = String(merged.numero_telefono || '').trim().slice(0, 40);
    }
    const prevUrlMaster = String(prevParsed.comprobante_pago_url || '').trim();
    const nextUrlMaster = String(merged.comprobante_pago_url || '').trim();
    if (nextUrlMaster && nextUrlMaster !== prevUrlMaster) {
      const { applyNewComprobanteUploadToPago } = require('../services/platformPaymentService');
      payload.pago_uso_sistema = applyNewComprobanteUploadToPago(merged, nextUrlMaster, prevUrlMaster);
    } else {
      payload.pago_uso_sistema = merged;
    }
  }

  const beforeState = readAppSettingsObject();
  const changedKeys = [];
  const updatedKeys = [];
  APP_CONFIG_ALLOWED_KEYS.forEach((key) => {
    if (payload[key] === undefined) return;
    updatedKeys.push(key);
    const previous = queryOne('SELECT value FROM app_settings WHERE key = ?', [key]);
    const prevParsed = parseJsonSafe(previous?.value, {});
    const incoming = payload[key] || {};
    const nextParsed = key === 'settings' ? mergeSettingsBlob(prevParsed, incoming) : incoming;
    if (JSON.stringify(prevParsed) !== JSON.stringify(nextParsed)) {
      changedKeys.push(key);
    }
    runSql(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      [key, JSON.stringify(nextParsed)]
    );
  });
  const out = readAppSettingsObject();
  let historyId = '';
  if (changedKeys.length) {
    historyId = uuidv4();
    runSql(
      `INSERT INTO app_settings_history (id, actor_user_id, actor_name, changed_keys, before_state, after_state, details)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        historyId,
        req.user.id,
        req.user.full_name || req.user.username || '',
        JSON.stringify(changedKeys),
        JSON.stringify(beforeState),
        JSON.stringify(out),
        JSON.stringify({ source: 'config_app_put' }),
      ]
    );
  }
  if (updatedKeys.length) {
    logAudit({
      actorUserId: req.user.id,
      actorName: req.user.full_name || req.user.username || '',
      action: 'app_settings.update',
      resourceType: 'app_settings',
      resourceId: changedKeys.join(',') || updatedKeys.join(','),
      details: {
        updated_keys: updatedKeys,
        changed_keys: changedKeys,
        history_id: historyId || null,
      },
    });
  }
  if (updatedKeys.includes('pago_uso_sistema')) {
    evaluateAutomaticBillingRules();
    const urlAfter = String(out.pago_uso_sistema?.comprobante_pago_url || '').trim();
    const urlBefore = String(beforeState.pago_uso_sistema?.comprobante_pago_url || '').trim();
    if (urlAfter && urlAfter !== urlBefore) {
      try {
        const { isCentralSyncConfigured } = require('../../packages/shared-config');
        const { legacyConfirmComprobanteOnUpload } = require('../services/platformPaymentService');
        if (!isCentralSyncConfigured()) {
          legacyConfirmComprobanteOnUpload(urlAfter);
        }
      } catch (err) {
        console.warn('[platform-payment]:', err.message || err);
      }
    }
  }
  if (changedKeys.includes('settings') || updatedKeys.includes('settings')) {
    try {
      const s = out.settings || {};
      if (Array.isArray(s.impresoras)) {
        syncPrinterRoutesFromImpresoras(resolveRestaurantId(req.user), s.impresoras);
      }
    } catch (e) {
      console.error('[printer_routes] sync desde settings:', e.message || e);
    }
  }
  if (changedKeys.length) {
    broadcastStaffData('app_config');
  }
  if (updatedKeys.includes('settings') || updatedKeys.includes('regional')) {
    try {
      const regional = out.settings?.regional || out.regional;
      persistRegionalFromSettings(regional);
    } catch (e) {
      console.error('[config] sync regional:', e.message || e);
    }
  }
  res.json(readAppSettingsForClient());
  } catch (err) {
    res.status(400).json({ error: err.message || 'No se pudo guardar' });
  }
});

router.post('/config/app/rollback/:historyId', requireRole('admin'), (req, res) => {
  const history = queryOne('SELECT * FROM app_settings_history WHERE id = ?', [req.params.historyId]);
  if (!history) return res.status(404).json({ error: 'No se encontró el historial solicitado' });
  const beforeRollback = readAppSettingsObject();
  const targetState = parseJsonSafe(history.before_state, null);
  if (!targetState || typeof targetState !== 'object') {
    return res.status(400).json({ error: 'El historial no contiene un estado válido para restaurar' });
  }
  const restoredKeys = [];
  APP_CONFIG_ALLOWED_KEYS.forEach((key) => {
    if (targetState[key] === undefined) return;
    restoredKeys.push(key);
    runSql(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      [key, JSON.stringify(targetState[key] || {})]
    );
  });
  const afterRollback = readAppSettingsObject();
  const rollbackHistoryId = uuidv4();
  runSql(
    `INSERT INTO app_settings_history (id, actor_user_id, actor_name, changed_keys, before_state, after_state, details)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      rollbackHistoryId,
      req.user.id,
      req.user.full_name || req.user.username || '',
      JSON.stringify(restoredKeys),
      JSON.stringify(beforeRollback),
      JSON.stringify(afterRollback),
      JSON.stringify({ source: 'rollback', source_history_id: req.params.historyId }),
    ]
  );
  logAudit({
    actorUserId: req.user.id,
    actorName: req.user.full_name || req.user.username || '',
    action: 'app_settings.rollback',
    resourceType: 'app_settings',
    resourceId: req.params.historyId,
    details: {
      restored_keys: restoredKeys,
      new_history_id: rollbackHistoryId,
    },
  });
  if (restoredKeys.includes('settings') || restoredKeys.includes('regional')) {
    try {
      const regional = afterRollback.settings?.regional || afterRollback.regional;
      persistRegionalFromSettings(regional);
    } catch (e) {
      console.error('[config] sync regional rollback:', e.message || e);
    }
  }
  if (restoredKeys.length) {
    broadcastStaffData('app_config');
  }
  res.json(readAppSettingsForClient());
});

router.get('/customers', requireRole('admin', 'cajero'), (req, res) => {
  const q = String(req.query?.q || '').trim();
  let sql = 'SELECT id, name, email, phone, address, doc_type, doc_number, created_at FROM customers';
  const params = [];
  if (q) {
    sql += ' WHERE name LIKE ? OR email LIKE ? OR phone LIKE ? OR doc_number LIKE ?';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY created_at DESC LIMIT 500';
  const customers = queryAll(sql, params);
  customers.forEach((c) => {
    const stats = queryOne(
      `SELECT COUNT(CASE WHEN status != 'cancelled' AND payment_status = 'paid' AND IFNULL(payment_method, '') != 'cortesia' THEN 1 END) as visits,
              COALESCE(SUM(CASE WHEN status != 'cancelled' AND payment_status = 'paid' AND IFNULL(payment_method, '') != 'cortesia' THEN total ELSE 0 END), 0) as total_spent,
              MAX(created_at) as last_visit
       FROM orders
       WHERE customer_id = ?`,
      [c.id]
    ) || { visits: 0, total_spent: 0, last_visit: null };
    c.visits = Number(stats.visits || 0);
    c.total_spent = Number(stats.total_spent || 0);
    c.last_visit = stats.last_visit || '-';
  });
  res.json(customers);
});

router.get('/customers/by-document', requireRole('admin', 'cajero', 'mozo'), (req, res) => {
  const docNumber = normalizeDocNumber(req.query?.doc_number);
  if (!docNumber) return res.json(null);
  const customer = queryOne(
    `SELECT id, name, email, phone, address, doc_type, doc_number, created_at
     FROM customers
     WHERE doc_number = ?
     LIMIT 1`,
    [docNumber]
  );
  res.json(customer || null);
});

/** Consulta nombre/dirección por DNI o RUC (padrón vía API; token PERU_CONSULTAS_TOKEN en servidor). */
router.get('/consulta-padron', async (req, res) => {
  try {
    assertPadronConsultAllowed();
    const docType = normalizeDocType(req.query?.doc_type);
    const numero = normalizeDocNumber(req.query?.numero);
    const out = await consultarPadronPeru(docType, numero);
    recordSuccessfulPadronConsult();
    res.json(out);
  } catch (err) {
    const code = err.code === 'NO_TOKEN' ? 503 : err.code === 'PADRON_LIMIT' ? 429 : 400;
    res.status(code).json({ error: err.message || 'Consulta no disponible' });
  }
});

router.post('/customers', requireRole('admin', 'cajero'), (req, res) => {
  const { name, email, phone = '', address = '', password = 'cliente123', doc_type, doc_number } = req.body || {};
  const cleanName = String(name || '').trim();
  if (!cleanName) return res.status(400).json({ error: 'Nombre es requerido' });
  const cleanDocType = normalizeDocType(doc_type);
  const cleanDocNumber = normalizeDocNumber(doc_number);
  try {
    validateCustomerDoc(cleanDocType, cleanDocNumber);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const cleanEmail = String(email || '').trim().toLowerCase();
  const fallbackEmail = cleanDocNumber
    ? `cliente.${cleanDocNumber}@local.resto`
    : `cliente.${Date.now()}@local.resto`;
  const nextEmail = cleanEmail || fallbackEmail;
  const existing = queryOne('SELECT id FROM customers WHERE email = ?', [nextEmail]);
  if (existing) return res.status(400).json({ error: 'Ya existe un cliente con ese email' });
  if (cleanDocNumber) {
    const existingByDoc = queryOne('SELECT id FROM customers WHERE doc_number = ?', [cleanDocNumber]);
    if (existingByDoc) return res.status(400).json({ error: 'Ya existe un cliente con ese DNI/RUC' });
  }
  const id = uuidv4();
  const hash = bcrypt.hashSync(String(password), 10);
  runSql(
    'INSERT INTO customers (id, name, email, password_hash, phone, address, doc_type, doc_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, cleanName, nextEmail, hash, phone, address, cleanDocType, cleanDocNumber]
  );
  logAudit({
    actorUserId: req.user.id,
    actorName: req.user.full_name || req.user.username || '',
    action: 'customer.create',
    resourceType: 'customer',
    resourceId: id,
    details: { email: nextEmail, doc_type: cleanDocType, doc_number: cleanDocNumber },
  });
  broadcastStaffData('customers');
  res.status(201).json(queryOne('SELECT id, name, email, phone, address, doc_type, doc_number, created_at FROM customers WHERE id = ?', [id]));
});

router.put('/customers/:id', requireRole('admin', 'cajero'), (req, res) => {
  const customer = queryOne('SELECT * FROM customers WHERE id = ?', [req.params.id]);
  if (!customer) return res.status(404).json({ error: 'Cliente no encontrado' });
  const { name, email, phone, address, password, doc_type, doc_number } = req.body || {};
  const nextDocType = doc_type !== undefined ? normalizeDocType(doc_type) : normalizeDocType(customer.doc_type);
  const nextDocNumber = doc_number !== undefined ? normalizeDocNumber(doc_number) : normalizeDocNumber(customer.doc_number);
  try {
    validateCustomerDoc(nextDocType, nextDocNumber);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (email && email !== customer.email) {
    const dup = queryOne('SELECT id FROM customers WHERE email = ? AND id != ?', [String(email).trim().toLowerCase(), req.params.id]);
    if (dup) return res.status(400).json({ error: 'Ya existe un cliente con ese email' });
  }
  if (nextDocNumber !== normalizeDocNumber(customer.doc_number || '')) {
    const dupDoc = queryOne('SELECT id FROM customers WHERE doc_number = ? AND id != ?', [nextDocNumber, req.params.id]);
    if (dupDoc) return res.status(400).json({ error: 'Ya existe un cliente con ese DNI/RUC' });
  }
  runSql(
    `UPDATE customers
     SET name = COALESCE(?, name),
         email = COALESCE(?, email),
         phone = COALESCE(?, phone),
         address = COALESCE(?, address),
         doc_type = ?,
         doc_number = ?
     WHERE id = ?`,
    [name, email ? String(email).trim().toLowerCase() : email, phone, address, nextDocType, nextDocNumber, req.params.id]
  );
  if (password && String(password).trim()) {
    const hash = bcrypt.hashSync(String(password), 10);
    runSql('UPDATE customers SET password_hash = ? WHERE id = ?', [hash, req.params.id]);
  }
  broadcastStaffData('customers');
  res.json(queryOne('SELECT id, name, email, phone, address, doc_type, doc_number, created_at FROM customers WHERE id = ?', [req.params.id]));
});

router.delete('/customers/:id', requireRole('admin'), (req, res) => {
  const customer = queryOne('SELECT id FROM customers WHERE id = ?', [req.params.id]);
  if (!customer) return res.status(404).json({ error: 'Cliente no encontrado' });
  const ordersCount = queryOne('SELECT COUNT(*) as c FROM orders WHERE customer_id = ?', [req.params.id]);
  if (Number(ordersCount?.c || 0) > 0) {
    return res.status(400).json({ error: 'No se puede eliminar: el cliente tiene pedidos registrados' });
  }
  runSql('DELETE FROM customers WHERE id = ?', [req.params.id]);
  broadcastStaffData('customers');
  res.json({ success: true });
});

router.get('/reservations', (req, res) => {
  res.json(queryAll('SELECT * FROM reservations ORDER BY date DESC, time DESC, created_at DESC LIMIT 300'));
});

router.post('/reservations', (req, res) => {
  const { client_name, phone = '', date, time, guests = 2, table_id = '', notes = '', status = 'confirmed' } = req.body || {};
  if (!client_name || !date || !time) return res.status(400).json({ error: 'Nombre, fecha y hora son requeridos' });
  if (!['confirmed', 'pending', 'cancelled', 'completed'].includes(String(status))) {
    return res.status(400).json({ error: 'Estado de reserva inválido' });
  }
  if (table_id && hasReservationConflict({ tableId: table_id, date, time })) {
    return res.status(400).json({ error: 'La mesa seleccionada ya tiene una reserva cercana en ese horario' });
  }
  const id = uuidv4();
  runSql(
    'INSERT INTO reservations (id, client_name, phone, date, time, guests, table_id, notes, status, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, client_name, phone, date, time, Number(guests || 2), table_id, notes, status, req.user.id]
  );
  logAudit({ actorUserId: req.user.id, actorName: req.user.full_name || req.user.username || '', action: 'reservation.create', resourceType: 'reservation', resourceId: id });
  broadcastStaffData('reservations');
  res.status(201).json(queryOne('SELECT * FROM reservations WHERE id = ?', [id]));
});

router.put('/reservations/:id', (req, res) => {
  const existing = queryOne('SELECT * FROM reservations WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Reserva no encontrada' });
  const { client_name, phone, date, time, guests, table_id, notes, status } = req.body || {};
  const nextDate = date || existing.date;
  const nextTime = time || existing.time;
  const nextTableId = table_id === undefined ? existing.table_id : table_id;
  const nextStatus = status || existing.status;
  if (!['confirmed', 'pending', 'cancelled', 'completed'].includes(String(nextStatus))) {
    return res.status(400).json({ error: 'Estado de reserva inválido' });
  }
  if (nextTableId && ['confirmed', 'pending'].includes(String(nextStatus)) && hasReservationConflict({
    tableId: nextTableId,
    date: nextDate,
    time: nextTime,
    excludeId: req.params.id,
  })) {
    return res.status(400).json({ error: 'La mesa seleccionada ya tiene una reserva cercana en ese horario' });
  }
  const safeValue = (value) => (value === undefined ? null : value);
  const safeGuests = guests === undefined || guests === null || Number.isNaN(Number(guests))
    ? null
    : Number(guests);
  const scheduleChanged =
    String(nextDate) !== String(existing.date) || String(nextTime).slice(0, 5) !== String(existing.time || '').slice(0, 5);
  const resetScheduleFlags = scheduleChanged && ['confirmed', 'pending'].includes(String(nextStatus));
  runSql(
    `UPDATE reservations
     SET client_name = COALESCE(?, client_name), phone = COALESCE(?, phone), date = COALESCE(?, date), time = COALESCE(?, time),
         guests = COALESCE(?, guests), table_id = COALESCE(?, table_id), notes = COALESCE(?, notes), status = COALESCE(?, status),
         kitchen_prep_sent_at = CASE WHEN ? THEN NULL ELSE kitchen_prep_sent_at END,
         caja_verify_sent_at = CASE WHEN ? THEN NULL ELSE caja_verify_sent_at END,
         updated_at = datetime('now')
     WHERE id = ?`,
    [
      safeValue(client_name),
      safeValue(phone),
      safeValue(date),
      safeValue(time),
      safeGuests,
      safeValue(table_id),
      safeValue(notes),
      safeValue(status),
      resetScheduleFlags ? 1 : 0,
      resetScheduleFlags ? 1 : 0,
      req.params.id,
    ]
  );

  if (resetScheduleFlags) {
    const marker = `RESERVA_ID:${req.params.id}`;
    const kitchenReleaseAt = computeKitchenReleaseAtForReservation(nextDate, nextTime);
    const linkedHeld = queryAll(
      "SELECT id FROM orders WHERE notes LIKE ? AND status IN ('pending','preparing') AND kitchen_release_at IS NOT NULL",
      [`%${marker}%`]
    );
    for (const row of linkedHeld) {
      runSql(
        "UPDATE orders SET kitchen_release_at = ?, updated_at = datetime('now') WHERE id = ?",
        [kitchenReleaseAt, row.id]
      );
    }
  }

  const tableAssignmentChanged =
    table_id !== undefined && String(nextTableId || '') !== String(existing.table_id || '');
  if (tableAssignmentChanged) {
    const marker = `RESERVA_ID:${req.params.id}`;
    const tableNumber = nextTableId
      ? String(queryOne('SELECT number FROM tables WHERE id = ?', [nextTableId])?.number || '')
      : '';
    const linkedForTable = queryAll(
      "SELECT id FROM orders WHERE notes LIKE ? AND status != 'cancelled'",
      [`%${marker}%`]
    );
    const io = req.app.get('io');
    for (const row of linkedForTable) {
      runSql(
        "UPDATE orders SET table_number = ?, updated_at = datetime('now') WHERE id = ?",
        [tableNumber, row.id]
      );
      if (io) {
        const updatedOrder = getOrderWithItems(row.id);
        if (updatedOrder) io.emit('order-update', updatedOrder);
      }
    }
  }

  if (String(nextStatus) === 'cancelled') {
    const marker = `RESERVA_ID:${req.params.id}`;
    const linkedOrders = queryAll(
      "SELECT id, status FROM orders WHERE notes LIKE ? AND status IN ('pending','preparing')",
      [`%${marker}%`]
    );
    const io = req.app.get('io');
    for (const row of linkedOrders) {
      restoreNonTransformedStockForOrder(row.id);
      runSql("UPDATE orders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?", [row.id]);
      logAudit({
        actorUserId: req.user.id,
        actorName: req.user.full_name || req.user.username || '',
        action: 'order.status.update',
        resourceType: 'order',
        resourceId: row.id,
        details: { from: row.status, to: 'cancelled', reason: 'reservation_cancelled' },
      });
      if (io) {
        const updatedOrder = getOrderWithItems(row.id);
        if (updatedOrder) io.emit('order-update', updatedOrder);
      }
    }
    if (linkedOrders.length > 0) emitInventoryUpdate({});
  }

  broadcastStaffData('reservations');
  res.json(queryOne('SELECT * FROM reservations WHERE id = ?', [req.params.id]));
});

router.delete('/reservations/:id', requireRole('admin', 'cajero'), (req, res) => {
  runSql('DELETE FROM reservations WHERE id = ?', [req.params.id]);
  broadcastStaffData('reservations');
  res.json({ success: true });
});

router.get('/credits', (req, res) => {
  const credits = queryAll('SELECT * FROM customer_credits ORDER BY created_at DESC LIMIT 300');
  credits.forEach(c => {
    c.payments = queryAll('SELECT * FROM credit_payments WHERE credit_id = ? ORDER BY created_at DESC', [c.id]);
  });
  res.json(credits);
});

router.post('/credits', requireRole('admin', 'cajero'), (req, res) => {
  const { client_name, phone = '', total = 0, items = '' } = req.body || {};
  if (!client_name || Number(total) <= 0) return res.status(400).json({ error: 'Cliente y monto total son requeridos' });
  const id = uuidv4();
  runSql(
    'INSERT INTO customer_credits (id, client_name, phone, total, paid, items, status, created_by_user_id) VALUES (?, ?, ?, ?, 0, ?, ?, ?)',
    [id, client_name, phone, Number(total), items, 'open', req.user.id]
  );
  broadcastStaffData('credits');
  res.status(201).json(queryOne('SELECT * FROM customer_credits WHERE id = ?', [id]));
});

router.post('/credits/:id/payments', requireRole('admin', 'cajero'), (req, res) => {
  const credit = queryOne('SELECT * FROM customer_credits WHERE id = ?', [req.params.id]);
  if (!credit) return res.status(404).json({ error: 'Crédito no encontrado' });
  const amount = Number(req.body?.amount || 0);
  if (amount <= 0) return res.status(400).json({ error: 'Monto inválido' });
  const nextPaid = Math.min(Number(credit.total || 0), Number(credit.paid || 0) + amount);
  const status = nextPaid >= Number(credit.total || 0) ? 'paid' : 'open';
  const paymentId = uuidv4();
  runSql('INSERT INTO credit_payments (id, credit_id, amount, created_by_user_id) VALUES (?, ?, ?, ?)', [paymentId, req.params.id, amount, req.user.id]);
  runSql('UPDATE customer_credits SET paid = ?, status = ?, updated_at = datetime(\'now\') WHERE id = ?', [nextPaid, status, req.params.id]);
  broadcastStaffData('credits');
  res.status(201).json(queryOne('SELECT * FROM customer_credits WHERE id = ?', [req.params.id]));
});

router.get('/discounts', (req, res) => {
  res.json(queryAll('SELECT * FROM discounts_catalog ORDER BY created_at DESC'));
});

router.post('/discounts', requireRole('admin'), (req, res) => {
  const { name, type = 'percentage', value = 0, applies_to = 'all', conditions = '', active = 1 } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });
  const id = uuidv4();
  runSql(
    'INSERT INTO discounts_catalog (id, name, type, value, applies_to, conditions, active) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, name, type, Number(value || 0), applies_to, conditions, active ? 1 : 0]
  );
  broadcastStaffData('discounts');
  res.status(201).json(queryOne('SELECT * FROM discounts_catalog WHERE id = ?', [id]));
});

router.put('/discounts/:id', requireRole('admin'), (req, res) => {
  const { name, type, value, applies_to, conditions, active } = req.body || {};
  runSql(
    `UPDATE discounts_catalog
     SET name = COALESCE(?, name), type = COALESCE(?, type), value = COALESCE(?, value), applies_to = COALESCE(?, applies_to),
         conditions = COALESCE(?, conditions), active = COALESCE(?, active), updated_at = datetime('now')
     WHERE id = ?`,
    [name, type, value, applies_to, conditions, active, req.params.id]
  );
  broadcastStaffData('discounts');
  res.json(queryOne('SELECT * FROM discounts_catalog WHERE id = ?', [req.params.id]));
});

router.delete('/discounts/:id', requireRole('admin'), (req, res) => {
  if (!verifyAdminPassword(req.body?.admin_password)) {
    return res.status(403).json({ error: 'Contraseña de administrador incorrecta' });
  }
  runSql('DELETE FROM discounts_catalog WHERE id = ?', [req.params.id]);
  broadcastStaffData('discounts');
  res.json({ success: true });
});

/** `products` en offers_catalog: JSON `["id1","id2"]` (ids reales de `products`). Acepta legacy texto separado por comas. */
function normalizeOfferProductsInput(raw) {
  if (raw == null || raw === '') return '[]';
  if (Array.isArray(raw)) {
    const ids = [...new Set(raw.map((x) => String(x).trim()).filter(Boolean))];
    return JSON.stringify(ids);
  }
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return '[]';
    if (t.startsWith('[')) {
      try {
        const arr = JSON.parse(t);
        if (Array.isArray(arr)) return normalizeOfferProductsInput(arr);
      } catch (_) {
        return '[]';
      }
    }
    return JSON.stringify(t.split(',').map((s) => s.trim()).filter(Boolean));
  }
  return '[]';
}

router.get('/offers', (req, res) => {
  res.json(queryAll('SELECT * FROM offers_catalog ORDER BY created_at DESC'));
});

router.post('/offers', requireRole('admin'), (req, res) => {
  const { name, description = '', type = 'promo', discount = 0, start_date = '', end_date = '', active = 1 } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });
  const raw = req.body?.product_ids !== undefined ? req.body.product_ids : req.body?.products;
  const products = normalizeOfferProductsInput(raw);
  const id = uuidv4();
  runSql(
    'INSERT INTO offers_catalog (id, name, description, type, discount, start_date, end_date, products, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, name, description, type, Number(discount || 0), start_date, end_date, products, active ? 1 : 0]
  );
  broadcastStaffData('offers');
  res.status(201).json(queryOne('SELECT * FROM offers_catalog WHERE id = ?', [id]));
});

router.put('/offers/:id', requireRole('admin'), (req, res) => {
  const { name, description, type, discount, start_date, end_date, products, product_ids, active } = req.body || {};
  const rawProducts = product_ids !== undefined ? product_ids : products;
  const productsVal = rawProducts !== undefined ? normalizeOfferProductsInput(rawProducts) : null;
  runSql(
    `UPDATE offers_catalog
     SET name = COALESCE(?, name), description = COALESCE(?, description), type = COALESCE(?, type), discount = COALESCE(?, discount),
         start_date = COALESCE(?, start_date), end_date = COALESCE(?, end_date), products = COALESCE(?, products), active = COALESCE(?, active),
         updated_at = datetime('now')
     WHERE id = ?`,
    [name, description, type, discount, start_date, end_date, productsVal, active, req.params.id]
  );
  broadcastStaffData('offers');
  res.json(queryOne('SELECT * FROM offers_catalog WHERE id = ?', [req.params.id]));
});

router.delete('/offers/:id', requireRole('admin'), (req, res) => {
  runSql('DELETE FROM offers_catalog WHERE id = ?', [req.params.id]);
  broadcastStaffData('offers');
  res.json({ success: true });
});

router.get('/combos', (req, res) => {
  const combos = queryAll('SELECT * FROM combos ORDER BY created_at DESC');
  combos.forEach(combo => {
    combo.items = queryAll(
      `SELECT ci.*, p.name as product_name
       FROM combo_items ci
       LEFT JOIN products p ON p.id = ci.product_id
       WHERE ci.combo_id = ?`,
      [combo.id]
    );
  });
  res.json(combos);
});

router.post('/combos/suggest', requireRole('admin'), async (req, res) => {
  try {
    const { product_ids = [] } = req.body || {};
    const suggestions = await suggestComboProducts(product_ids);
    res.json(suggestions);
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudieron generar sugerencias' });
  }
});

router.post('/combos', requireRole('admin'), (req, res) => {
  const { name, description = '', price = 0, active = 1, items = [] } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });
  const id = uuidv4();
  runSql('INSERT INTO combos (id, name, description, price, active) VALUES (?, ?, ?, ?, ?)', [id, name, description, Number(price || 0), active ? 1 : 0]);
  (Array.isArray(items) ? items : []).forEach((it) => {
    if (!it?.product_id) return;
    runSql('INSERT INTO combo_items (id, combo_id, product_id, quantity) VALUES (?, ?, ?, ?)', [uuidv4(), id, it.product_id, Number(it.quantity || 1)]);
  });
  broadcastStaffData('combos');
  res.status(201).json({ id });
});

router.put('/combos/:id', requireRole('admin'), (req, res) => {
  const { name, description, price, active, items = null } = req.body || {};
  runSql(
    `UPDATE combos
     SET name = COALESCE(?, name), description = COALESCE(?, description), price = COALESCE(?, price), active = COALESCE(?, active),
         updated_at = datetime('now')
     WHERE id = ?`,
    [name, description, price, active, req.params.id]
  );
  if (Array.isArray(items)) {
    runSql('DELETE FROM combo_items WHERE combo_id = ?', [req.params.id]);
    items.forEach((it) => {
      if (!it?.product_id) return;
      runSql('INSERT INTO combo_items (id, combo_id, product_id, quantity) VALUES (?, ?, ?, ?)', [uuidv4(), req.params.id, it.product_id, Number(it.quantity || 1)]);
    });
  }
  broadcastStaffData('combos');
  res.json({ success: true });
});

router.delete('/combos/:id', requireRole('admin'), (req, res) => {
  runSql('DELETE FROM combo_items WHERE combo_id = ?', [req.params.id]);
  runSql('DELETE FROM combos WHERE id = ?', [req.params.id]);
  broadcastStaffData('combos');
  res.json({ success: true });
});

router.get('/modifiers', (req, res) => {
  const modifiers = queryAll('SELECT * FROM modifiers ORDER BY created_at DESC');
  modifiers.forEach((m) => {
    m.options = queryAll('SELECT * FROM modifier_options WHERE modifier_id = ?', [m.id]).map(o => o.option_name);
  });
  res.json(modifiers);
});

router.post('/modifiers', requireRole('admin'), (req, res) => {
  const { name, required = false, active = true, options = [] } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });
  const id = uuidv4();
  runSql('INSERT INTO modifiers (id, name, required, active) VALUES (?, ?, ?, ?)', [id, name, required ? 1 : 0, active ? 1 : 0]);
  (Array.isArray(options) ? options : []).forEach(opt => {
    if (!opt) return;
    runSql('INSERT INTO modifier_options (id, modifier_id, option_name) VALUES (?, ?, ?)', [uuidv4(), id, String(opt)]);
  });
  broadcastStaffData('modifiers');
  res.status(201).json({ id });
});

router.put('/modifiers/:id', requireRole('admin'), (req, res) => {
  const { name, required, active, options = null } = req.body || {};
  runSql(
    'UPDATE modifiers SET name = COALESCE(?, name), required = COALESCE(?, required), active = COALESCE(?, active), updated_at = datetime(\'now\') WHERE id = ?',
    [name, required, active, req.params.id]
  );
  if (Array.isArray(options)) {
    runSql('DELETE FROM modifier_options WHERE modifier_id = ?', [req.params.id]);
    options.forEach(opt => {
      if (!opt) return;
      runSql('INSERT INTO modifier_options (id, modifier_id, option_name) VALUES (?, ?, ?)', [uuidv4(), req.params.id, String(opt)]);
    });
  }
  broadcastStaffData('modifiers');
  res.json({ success: true });
});

router.delete('/modifiers/:id', requireRole('admin'), (req, res) => {
  runSql('DELETE FROM modifier_options WHERE modifier_id = ?', [req.params.id]);
  runSql('DELETE FROM modifiers WHERE id = ?', [req.params.id]);
  broadcastStaffData('modifiers');
  res.json({ success: true });
});

module.exports = router;
