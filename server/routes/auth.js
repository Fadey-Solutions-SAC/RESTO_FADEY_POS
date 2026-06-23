const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { queryOne, runSql } = require('../database');
const { JWT_SECRET, authenticateToken } = require('../middleware/auth');
const {
  getLockState,
  verifyMasterCredentials,
  getMasterCredentialsPublic,
  getControlConfig,
  getPadronQuotaPublic,
} = require('../masterAdminService');
const { normalizePlan } = require('../servicePlan');
const { getEffectivePermissions, buildSubPermissions } = require('../planModuleCatalog');
const { advanceStaffChatCycleIfDue, markAllStaffOfflineIfNeeded } = require('../staffChatService');
const { getActiveCajaById } = require('../cajaSettings');
const {
  startWorkSession,
  closeWorkSession,
  countOpenSessions,
  ensureOpenWorkSession,
} = require('../services/workSessionService');
const { signStaffToken, signMasterToken, shouldRefreshStaffToken, buildRefreshedStaffToken } = require('../utils/staffJwt');
const { touchWorkSessionActivity } = require('../services/workActivityTracker');
const { STAFF_IDLE_LOGOUT_MINUTES } = require('../constants/staffSessionPolicy');

const router = express.Router();

const { getValidUiThemeId } = require('../uiThemeCatalog');

function readUiThemeFromStoredSettings() {
  return readUiAppearanceFromStoredSettings().ui_theme;
}

function readUiAppearanceFromStoredSettings() {
  const fallback = { ui_theme: 'corporate_blue', ui_theme_mode: 'light', ui_theme_custom: {} };
  const row = queryOne('SELECT value FROM app_settings WHERE key = ?', ['settings']);
  if (!row?.value) return fallback;
  try {
    const s = JSON.parse(row.value);
    const mode = String(s?.ui_theme_mode || 'light').trim();
    return {
      ui_theme: getValidUiThemeId(s?.ui_theme),
      ui_theme_mode: ['light', 'dark', 'auto'].includes(mode) ? mode : 'light',
      ui_theme_custom:
        s?.ui_theme_custom && typeof s.ui_theme_custom === 'object' && !Array.isArray(s.ui_theme_custom)
          ? s.ui_theme_custom
          : {},
    };
  } catch (_) {
    return fallback;
  }
}

const MAX_PHOTO_CHARS = 450000;
/** JPEG en base64 (data URL); por debajo suele ser captura truncada o inválida */
const MIN_PHOTO_CHARS = 120;

/** data:image/jpeg;base64,... — obligatorio para personal en login/cierre de jornada */
function normalizeAttendancePhoto(input) {
  const s = typeof input === 'string' ? input.trim() : '';
  if (s.length < MIN_PHOTO_CHARS || s.length > MAX_PHOTO_CHARS) return null;
  if (!s.startsWith('data:image/')) return null;
  if (!s.includes('base64,')) return null;
  return s;
}

const MODULE_IDS = [
  'escritorio', 'ventas', 'caja', 'mesas', 'reservas', 'auto_pedido', 'creditos', 'clientes',
  'productos', 'ofertas', 'descuentos', 'almacen', 'delivery', 'informes',
  'indicadores', 'mi_restaurant', 'configuracion', 'cocina', 'bar', 'tiempo_trabajado',
];
function isPermissionEnabled(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function getEmptyPermissions() {
  return MODULE_IDS.reduce((acc, id) => {
    acc[id] = false;
    return acc;
  }, {});
}

function getUserPermissions(userId) {
  const row = queryOne('SELECT permissions FROM user_permissions WHERE user_id = ?', [userId]);
  if (!row?.permissions) return getEmptyPermissions();
  let parsed = {};
  try {
    parsed = JSON.parse(row.permissions || '{}');
  } catch {
    parsed = {};
  }
  return MODULE_IDS.reduce((acc, id) => {
    acc[id] = isPermissionEnabled(parsed[id]);
    return acc;
  }, {});
}

/** Lee flags desde settings.jornada_laboral (migración desde requiere_foto_asistencia legacy). */
function readJornadaLaboralFlags() {
  const row = queryOne('SELECT value FROM app_settings WHERE key = ?', ['settings']);
  if (!row?.value) return { loginPhoto: false, logoutPhoto: false };
  try {
    const s = JSON.parse(row.value);
    const jl = s?.jornada_laboral && typeof s.jornada_laboral === 'object' ? s.jornada_laboral : {};
    const legacy = isPermissionEnabled(jl.requiere_foto_asistencia);
    const hasInicio = Object.prototype.hasOwnProperty.call(jl, 'requiere_foto_inicio_sesion');
    const hasFin = Object.prototype.hasOwnProperty.call(jl, 'requiere_foto_fin_jornada');
    const loginPhoto = hasInicio ? isPermissionEnabled(jl.requiere_foto_inicio_sesion) : legacy;
    const logoutPhoto = hasFin ? isPermissionEnabled(jl.requiere_foto_fin_jornada) : legacy;
    return { loginPhoto, logoutPhoto };
  } catch {
    return { loginPhoto: false, logoutPhoto: false };
  }
}

function buildMasterToken() {
  const master = getMasterCredentialsPublic();
  return signMasterToken({
    id: 'master-admin',
    username: master.username,
    role: 'master_admin',
    full_name: 'Administrador Maestro',
  });
}

router.get('/attendance-photos-required', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  const { loginPhoto, logoutPhoto } = readJornadaLaboralFlags();
  res.json({
    loginRequired: loginPhoto,
    logoutRequired: logoutPhoto,
    required: loginPhoto,
  });
});

/** Mantiene viva la sesión mientras la pestaña está abierta (caja, cocina, etc.). */
router.post('/heartbeat', authenticateToken, (req, res) => {
  if (req.user?.type === 'customer' || req.user?.role === 'master_admin') {
    return res.json({ ok: true });
  }
  touchWorkSessionActivity(req.user, { module: 'heartbeat', path: '/auth/heartbeat' });
  res.json({ ok: true, idle_logout_minutes: STAFF_IDLE_LOGOUT_MINUTES });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });

  if (verifyMasterCredentials(username, password)) {
    const master = getMasterCredentialsPublic();
    const token = buildMasterToken();
    return res.json({
      token,
      user: {
        id: 'master-admin',
        username: master.username,
        email: '',
        full_name: 'Administrador Maestro',
        role: 'master_admin',
        avatar: '',
        ...readUiAppearanceFromStoredSettings(),
      },
    });
  }

  const lock = getLockState();
  if (lock.locked) {
    return res.status(423).json({ error: lock.reason || 'Sistema bloqueado por falta de pago' });
  }

  const user = queryOne('SELECT * FROM users WHERE username = ? AND is_active = 1', [username]);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }
  if (String(user.role || '').toLowerCase() === 'cajero') {
    const cid = String(user.caja_station_id || '').trim();
    if (!cid) {
      return res.status(403).json({
        error:
          'Su usuario cajero no tiene una caja asignada. El administrador debe vincularlo en Configuración → Usuarios.',
      });
    }
    const caja = getActiveCajaById(cid);
    if (!caja) {
      return res.status(403).json({
        error:
          'La caja asignada a este usuario no está disponible o está inactiva. Revise Configuración → Cajas y Usuarios.',
      });
    }
  }
  const photoLogin = normalizeAttendancePhoto(req.body?.photo_login);
  const { loginPhoto, logoutPhoto } = readJornadaLaboralFlags();
  const openBeforeLogin = countOpenSessions(user.id);
  const isParallelLogin = openBeforeLogin > 0;
  if (loginPhoto && !isParallelLogin) {
    if (!photoLogin) {
      return res.status(400).json({ error: 'Debe tomarse una foto para registrar el inicio de jornada' });
    }
  }
  const { sessionTokenId } = startWorkSession(user, photoLogin || null);
  advanceStaffChatCycleIfDue();

  const token = signStaffToken({
    id: user.id,
    username: user.username,
    role: user.role,
    restaurant_id: user.restaurant_id,
    full_name: user.full_name,
    session_id: sessionTokenId,
  });

  const control = getControlConfig();
  const plan = normalizePlan(control.service_plan);
  const moduleOverrides = control.service_plan_module_overrides || {};
  const permissions = getEffectivePermissions(plan, user.role, getUserPermissions(user.id), moduleOverrides);
  const sub_permissions = buildSubPermissions(plan, moduleOverrides, permissions);
  const padron_quota = getPadronQuotaPublic();
  try {
    const { syncUserLogin } = require('../services/centralSyncService');
    syncUserLogin(user, user.password_hash);
  } catch (_) {
    /* sync opcional */
  }
  const cajaMeta =
    String(user.role || '').toLowerCase() === 'cajero'
      ? (() => {
          const c = getActiveCajaById(user.caja_station_id);
          return { caja_station_id: String(user.caja_station_id || '').trim(), caja_name: c?.name || '' };
        })()
      : { caja_station_id: '', caja_name: '' };
  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      avatar: user.avatar,
      permissions,
      sub_permissions,
      padron_quota,
      service_plan: plan,
      ...readUiAppearanceFromStoredSettings(),
      ...cajaMeta,
    },
  });
});

router.post('/logout', authenticateToken, (req, res) => {
  if (req.user?.type === 'customer' || req.user?.role === 'master_admin') {
    return res.json({ success: true, closed: false });
  }
  const { logoutPhoto } = readJornadaLaboralFlags();
  const photoLogout = normalizeAttendancePhoto(req.body?.photo_logout);
  const openCount = countOpenSessions(req.user?.id);
  const closingLastDevice = openCount <= 1;
  if (logoutPhoto && closingLastDevice) {
    if (!photoLogout) {
      return res.status(400).json({ error: 'Debe tomarse una foto para registrar el fin de jornada' });
    }
  }
  const { closed } = closeWorkSession(req.user?.id, req.user?.session_id, 'logout', photoLogout);
  markAllStaffOfflineIfNeeded();
  return res.json({ success: true, closed });
});

router.post('/customer/register', (req, res) => {
  const { name, email, password, phone, address } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Nombre, email y contraseña son requeridos' });
  const lock = getLockState();
  if (lock.locked) {
    return res.status(423).json({ error: lock.reason || 'Sistema bloqueado por falta de pago' });
  }

  const existing = queryOne('SELECT id FROM customers WHERE email = ?', [email]);
  if (existing) return res.status(400).json({ error: 'El email ya está registrado' });

  const id = uuidv4();
  const hash = bcrypt.hashSync(password, 10);
  runSql('INSERT INTO customers (id, name, email, password_hash, phone, address) VALUES (?, ?, ?, ?, ?, ?)', [id, name, email, hash, phone || '', address || '']);

  const token = jwt.sign({ id, email, name, type: 'customer' }, JWT_SECRET, { expiresIn: '7d' });
  res.json({
    token,
    customer: { id, name, email, phone, address, ...readUiAppearanceFromStoredSettings() },
  });
});

router.post('/customer/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña son requeridos' });
  const lock = getLockState();
  if (lock.locked) {
    return res.status(423).json({ error: lock.reason || 'Sistema bloqueado por falta de pago' });
  }

  const customer = queryOne('SELECT * FROM customers WHERE email = ?', [email]);
  if (!customer || !bcrypt.compareSync(password, customer.password_hash)) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  const token = jwt.sign({ id: customer.id, email: customer.email, name: customer.name, type: 'customer' }, JWT_SECRET, { expiresIn: '7d' });
  res.json({
    token,
    customer: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      address: customer.address,
      ...readUiAppearanceFromStoredSettings(),
    },
  });
});

router.get('/me', authenticateToken, (req, res) => {
  if (req.user.role === 'master_admin') {
    const master = getMasterCredentialsPublic();
    return res.json({
      id: 'master-admin',
      username: master.username,
      full_name: 'Administrador Maestro',
      role: 'master_admin',
      type: 'staff',
      ...readUiAppearanceFromStoredSettings(),
    });
  }
  if (req.user.type === 'customer') {
    const customer = queryOne('SELECT id, name, email, phone, address FROM customers WHERE id = ?', [req.user.id]);
    return res.json({ ...customer, type: 'customer', ...readUiAppearanceFromStoredSettings() });
  }
  ensureOpenWorkSession(req.user);
  const user = queryOne(
    'SELECT id, username, email, full_name, role, avatar, phone, caja_station_id FROM users WHERE id = ?',
    [req.user.id]
  );
  const control = getControlConfig();
  const plan = normalizePlan(control.service_plan);
  const moduleOverrides = control.service_plan_module_overrides || {};
  const permissions = getEffectivePermissions(plan, user.role, getUserPermissions(req.user.id), moduleOverrides);
  const sub_permissions = buildSubPermissions(plan, moduleOverrides, permissions);
  const padron_quota = getPadronQuotaPublic();
  const caja =
    String(user?.role || '').toLowerCase() === 'cajero'
      ? getActiveCajaById(user?.caja_station_id)
      : null;
  const payload = {
    ...user,
    permissions,
    sub_permissions,
    padron_quota,
    service_plan: plan,
    type: 'staff',
    caja_name: caja?.name || '',
    ...readUiAppearanceFromStoredSettings(),
  };
  if (shouldRefreshStaffToken(req.user)) {
    const refreshed = buildRefreshedStaffToken(req.user, user);
    if (refreshed) payload.token = refreshed;
  }
  res.json(payload);
});

module.exports = router;
