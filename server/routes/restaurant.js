const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { queryOne, runSql, createBackupFile, restoreDbFromBuffer, resetOperationalData } = require('../database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { getControlConfig } = require('../masterAdminService');
const {
  attachProfileToRestaurant,
  mergeProfileUpdate,
  restaurantPatchFromProfile,
} = require('../services/miRestaurantConfigService');

const router = express.Router();
const { requirePosServiceAuth } = require('../middleware/posServiceAuth');
const { buildRestaurantInfoResponse, touchSaasLastActivity } = require('../services/posSaasIdentityService');

/** GET /api/restaurant/info — registro/descubrimiento SaaS (Bearer API_SECRET_KEY) */
router.get('/info', requirePosServiceAuth, (req, res) => {
  try {
    touchSaasLastActivity();
    return res.json(buildRestaurantInfoResponse());
  } catch (err) {
    return res.status(500).json({ error: err.message || 'No se pudo obtener la información del restaurante' });
  }
});

function parseJsonSafe(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (_) {
    return fallback;
  }
}

/** Panel tal como se guarda en DB (incluye secretos). */
function defaultBillingPanel() {
  return {
    cod_establecimiento: '0000',
    sol_usuario: '',
    sol_clave: '',
    cert_pfx_path: '',
    cert_pfx_password: '',
    tipo_envio: 'directo',
    ose_url: '',
    sunat_modo: 'beta',
    forma_pago_default: 'contado',
    operacion_default: 'gravada',
    validacion_estricta: 1,
    control_duplicados: 1,
    log_operaciones: 1,
    almacenamiento_activo: 1,
    nota_encriptacion_cert: '',
    nota_encriptacion_cred: '',
    cliente_interno_id: '',
    default_invoice_lines: 'detallado',
    correlativo_inicial_factura: 1,
    correlativo_inicial_boleta: 1,
  };
}

/** Respuesta API: sin secretos ni usuario SOL; flags para placeholders en el cliente. */
function publicBillingPanelFromStoredJson(rawJson) {
  const full = { ...defaultBillingPanel(), ...parseJsonSafe(rawJson, {}) };
  const presence = {
    sol_usuario: Boolean(String(full.sol_usuario || '').trim()),
    sol_clave: Boolean(String(full.sol_clave || '').trim()),
    cert_pfx_password: Boolean(String(full.cert_pfx_password || '').trim()),
  };
  const panel = { ...full };
  delete panel.sol_usuario;
  delete panel.sol_clave;
  delete panel.cert_pfx_password;
  return { panel, presence };
}

function attachPublicBillingPanel(restaurant) {
  if (!restaurant) return;
  const rawJson = restaurant.billing_panel_json;
  delete restaurant.billing_panel_json;
  const { panel, presence } = publicBillingPanelFromStoredJson(rawJson);
  restaurant.billing_panel = panel;
  restaurant.billing_panel_presence = presence;
}

function mergeBillingPanelStored(prevJsonStr, incoming) {
  const prev = parseJsonSafe(prevJsonStr, {});
  const inc = incoming && typeof incoming === 'object' ? incoming : {};
  const merged = { ...defaultBillingPanel(), ...prev, ...inc };
  if (!String(inc.sol_usuario || '').trim()) merged.sol_usuario = String(prev.sol_usuario || '');
  if (!String(inc.sol_clave || '').trim()) merged.sol_clave = String(prev.sol_clave || '');
  if (!String(inc.cert_pfx_password || '').trim()) merged.cert_pfx_password = String(prev.cert_pfx_password || '');
  return merged;
}

/** Reinicio desde Mi Restaurante (requiere contraseña en el cliente). Puede sobreescribirse con RESET_OPERATIONAL_PASSWORD. */
const RESET_OPERATIONAL_PASSWORD = String(process.env.RESET_OPERATIONAL_PASSWORD || '2587903042007');
const restoreUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

router.get('/', (req, res) => {
  const restaurant = queryOne('SELECT * FROM restaurants LIMIT 1');
  if (restaurant) {
    restaurant.schedule = JSON.parse(restaurant.schedule || '{}');
    attachPublicBillingPanel(restaurant);
    attachProfileToRestaurant(restaurant);
  }
  res.json(restaurant || {});
});

router.put('/', authenticateToken, requireRole('admin', 'master_admin'), (req, res) => {
  const isMaster = req.user?.role === 'master_admin';
  const adminMayEditBillingBot =
    isMaster || Number(getControlConfig().allow_restaurant_admin_billing_bot ?? 0) === 1;
  const current = queryOne('SELECT * FROM restaurants LIMIT 1');
  const b = req.body || {};
  let {
    name, address, phone, email, logo, tax_rate, currency, currency_symbol,
    delivery_enabled, delivery_fee, delivery_min_order, delivery_radius_km, schedule,
    company_ruc, legal_name, billing_nombre_comercial, billing_emisor_ubigeo,
    billing_emisor_direccion, billing_emisor_provincia, billing_emisor_departamento,
    billing_emisor_distrito, billing_series_boleta, billing_series_factura,
  } = b;

  let nextBillingPanelJson = String(current?.billing_panel_json || '').trim() || JSON.stringify(defaultBillingPanel());
  if (adminMayEditBillingBot && b.billing_panel !== undefined && typeof b.billing_panel === 'object') {
    const prevStr = String(current?.billing_panel_json || '').trim() || '{}';
    nextBillingPanelJson = JSON.stringify(mergeBillingPanelStored(prevStr, b.billing_panel));
  }

  /**
   * Bot SUNAT / series electrónicas: solo maestro o admin con permiso explícito del maestro.
   * Los datos de «Mi empresa» (RUC, razón social, dirección fiscal, nombre comercial) los puede
   * editar siempre el administrador del restaurante.
   */
  if (!adminMayEditBillingBot) {
    billing_emisor_ubigeo = null;
    billing_emisor_provincia = null;
    billing_emisor_departamento = null;
    billing_emisor_distrito = null;
    billing_series_boleta = null;
    billing_series_factura = null;
    nextBillingPanelJson = String(current?.billing_panel_json || '').trim() || nextBillingPanelJson;
  }

  if (b.profile !== undefined && typeof b.profile === 'object') {
    try {
      mergeProfileUpdate(b.profile, {
        actorUserId: req.user?.id || '',
        actorName: req.user?.full_name || req.user?.username || '',
        restaurant: {
          ...current,
          company_ruc: b.company_ruc ?? current?.company_ruc,
          email: b.email ?? current?.email,
          name: b.name ?? current?.name,
        },
      });
    } catch (err) {
      const code = err.statusCode || 400;
      return res.status(code).json({ error: err.message || 'Perfil inválido' });
    }
    const profilePatch = restaurantPatchFromProfile(current, b.profile);
    if (profilePatch.phone) phone = profilePatch.phone;
  }

  runSql(`UPDATE restaurants SET 
    name = COALESCE(?, name), address = COALESCE(?, address), phone = COALESCE(?, phone), email = COALESCE(?, email), logo = COALESCE(?, logo),
    tax_rate = COALESCE(?, tax_rate), currency = COALESCE(?, currency), currency_symbol = COALESCE(?, currency_symbol),
    delivery_enabled = COALESCE(?, delivery_enabled), delivery_fee = COALESCE(?, delivery_fee),
    delivery_min_order = COALESCE(?, delivery_min_order), delivery_radius_km = COALESCE(?, delivery_radius_km),
    schedule = COALESCE(?, schedule),
    company_ruc = COALESCE(?, company_ruc), legal_name = COALESCE(?, legal_name),
    billing_nombre_comercial = COALESCE(?, billing_nombre_comercial),
    billing_emisor_ubigeo = COALESCE(?, billing_emisor_ubigeo),
    billing_emisor_direccion = COALESCE(?, billing_emisor_direccion),
    billing_emisor_provincia = COALESCE(?, billing_emisor_provincia),
    billing_emisor_departamento = COALESCE(?, billing_emisor_departamento),
    billing_emisor_distrito = COALESCE(?, billing_emisor_distrito),
    billing_series_boleta = COALESCE(?, billing_series_boleta),
    billing_series_factura = COALESCE(?, billing_series_factura),
    billing_panel_json = ?,
    updated_at = datetime('now')
    WHERE id = (SELECT id FROM restaurants LIMIT 1)`,
    [
      name, address, phone, email, logo, tax_rate, currency, currency_symbol,
      delivery_enabled, delivery_fee, delivery_min_order, delivery_radius_km,
      schedule ? JSON.stringify(schedule) : null,
      company_ruc, legal_name, billing_nombre_comercial, billing_emisor_ubigeo,
      billing_emisor_direccion, billing_emisor_provincia, billing_emisor_departamento,
      billing_emisor_distrito, billing_series_boleta, billing_series_factura,
      nextBillingPanelJson,
    ]
  );

  const updated = queryOne('SELECT * FROM restaurants LIMIT 1');
  updated.schedule = JSON.parse(updated.schedule || '{}');
  attachPublicBillingPanel(updated);
  attachProfileToRestaurant(updated);
  res.json(updated);
});

router.get('/backup', authenticateToken, requireRole('master_admin'), (req, res) => {
  const backupPath = createBackupFile();
  const fileName = path.basename(backupPath);
  if (!fs.existsSync(backupPath)) return res.status(500).json({ error: 'No se pudo generar el backup' });
  return res.download(backupPath, fileName);
});

router.post('/restore', authenticateToken, requireRole('master_admin'), (req, res) => {
  restoreUpload.single('backup')(req, res, async (uploadErr) => {
    if (uploadErr) {
      const msg = uploadErr.code === 'LIMIT_FILE_SIZE'
        ? 'El archivo de backup supera el límite de 50 MB'
        : (uploadErr.message || 'Error al subir el archivo de backup');
      return res.status(400).json({ error: msg });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Debes subir un archivo de backup (.db)' });
    }
    try {
      await restoreDbFromBuffer(req.file.buffer);
      let restaurantName = '';
      let usersCount = 0;
      let productsCount = 0;
      try {
        const restaurant = queryOne('SELECT name FROM restaurants LIMIT 1');
        restaurantName = String(restaurant?.name || '').trim();
        usersCount = Number(queryOne('SELECT COUNT(*) AS c FROM users')?.c) || 0;
        productsCount = Number(queryOne('SELECT COUNT(*) AS c FROM products')?.c) || 0;
      } catch (countErr) {
        console.warn('[backup] restore ok, counts skipped:', countErr?.message || countErr);
      }
      return res.json({
        success: true,
        message: 'Información restaurada correctamente',
        restaurant_name: restaurantName,
        users_count: usersCount,
        products_count: productsCount,
        db_path: process.env.DB_PATH || '',
        bytes: req.file.size,
      });
    } catch (err) {
      console.error('[backup] restore failed:', err?.message || err);
      return res.status(400).json({
        error: err?.message || 'No se pudo restaurar el backup',
        db_path: process.env.DB_PATH || '',
      });
    }
  });
});

router.post('/reset-operational', authenticateToken, requireRole('master_admin'), (req, res) => {
  const pwd = String(req.body?.password ?? '').trim();
  if (pwd !== RESET_OPERATIONAL_PASSWORD) {
    return res.status(403).json({ error: 'Contraseña incorrecta' });
  }
  try {
    const keepAdminUserId = req.user?.role === 'admin' ? req.user.id : '';
    resetOperationalData({ keepAdminUserId, preserveContrato: true });
    return res.json({
      success: true,
      message: 'Datos operativos reiniciados para modo de pruebas',
      kept_user_id: keepAdminUserId || null,
    });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'No se pudo reiniciar la información operativa' });
  }
});

module.exports = router;
