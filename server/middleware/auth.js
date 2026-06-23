const jwt = require('jsonwebtoken');
const { queryOne } = require('../database');
const { getLockState, getMasterCredentialsPublic } = require('../masterAdminService');
const { touchWorkSessionActivity } = require('../services/workActivityTracker');
const { ensureOpenWorkSession: ensureUserWorkSession, enforceStaffIdleLogout } = require('../services/workSessionService');
const {
  shouldRefreshStaffToken,
  buildRefreshedStaffToken,
} = require('../utils/staffJwt');
const { JWT_SECRET } = require('../utils/jwtSecret');

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token de acceso requerido' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role === 'master_admin') {
      const masterPub = getMasterCredentialsPublic();
      req.user = {
        id: decoded.id || 'master-admin',
        username: decoded.username || masterPub.username || 'Romero25879',
        role: 'master_admin',
        full_name: decoded.full_name || 'Administrador Maestro',
      };
      return next();
    }
    if (decoded.type === 'customer') {
      const lock = getLockState();
      if (lock.locked) {
        return res.status(423).json({ error: lock.reason || 'Sistema bloqueado por falta de pago' });
      }
      const customer = queryOne('SELECT id, name, email FROM customers WHERE id = ?', [decoded.id]);
      if (!customer) return res.status(401).json({ error: 'Cliente no encontrado o inactivo' });
      req.user = decoded;
      return next();
    }
    const user = queryOne('SELECT id, username, role, full_name, is_active, restaurant_id FROM users WHERE id = ?', [decoded.id]);
    if (!user || Number(user.is_active || 0) !== 1) {
      return res.status(401).json({ error: 'Usuario no autorizado' });
    }
    req.user = {
      ...decoded,
      role: user.role,
      username: user.username,
      full_name: user.full_name,
    };
    try {
      ensureUserWorkSession(req.user);
    } catch (_) {
      /* noop */
    }
    const idleMsg = enforceStaffIdleLogout(req.user);
    if (idleMsg) {
      return res.status(401).json({ error: idleMsg, code: 'SESSION_IDLE_TIMEOUT' });
    }
    touchWorkSessionActivity(req.user, { module: 'api', path: req.path });
    if (shouldRefreshStaffToken(decoded)) {
      const refreshed = buildRefreshedStaffToken(decoded, user);
      if (refreshed) res.setHeader('X-Refreshed-Token', refreshed);
    }
    const lock = getLockState();
    if (lock.locked) {
      return res.status(423).json({ error: lock.reason || 'Sistema bloqueado por falta de pago' });
    }
    next();
  } catch (err) {
    if (err?.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expirado' });
    }
    return res.status(401).json({ error: 'Token inválido' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'No autenticado' });
    }
    if (req.user.role === 'master_admin') return next();
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'No tienes permisos para esta acción' });
    }
    next();
  };
}

function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      // ignore
    }
  }
  next();
}

module.exports = {
  authenticateToken,
  requireRole,
  optionalAuth,
  JWT_SECRET,
};
