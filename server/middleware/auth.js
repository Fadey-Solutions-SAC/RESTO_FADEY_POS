const jwt = require('jsonwebtoken');
const { queryOne } = require('../database');
const { getLockState, getMasterCredentialsPublic } = require('../masterAdminService');
const { touchWorkSessionActivity } = require('../services/workActivityTracker');
const {
  ensureOpenWorkSession: ensureUserWorkSession,
  touchStaffSessionNow,
} = require('../services/workSessionService');
const {
  shouldRefreshStaffToken,
  buildRefreshedStaffToken,
  buildStaffToken,
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

    let newSessionId = null;
    try {
      newSessionId = ensureUserWorkSession(req.user);
    } catch (_) {
      /* noop */
    }
    if (newSessionId) {
      req.user.session_id = newSessionId;
      const reboundToken = buildStaffToken(user, newSessionId);
      if (reboundToken) res.setHeader('X-Refreshed-Token', reboundToken);
    }

    touchStaffSessionNow(req.user.id, req.user.session_id);
    touchWorkSessionActivity(req.user, { module: 'api', path: req.path }, { force: false });

    if (!newSessionId && shouldRefreshStaffToken(decoded)) {
      const refreshed = buildRefreshedStaffToken(req.user, user);
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

function isLoopbackRequest(req) {
  const raw = String(req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/i, '');
  return raw === '127.0.0.1' || raw === '::1' || raw === 'localhost';
}

/**
 * Impresión USB en esta PC: el panel (a veces en Vercel) envía un JWT del API remoto.
 * Ese token no coincide con JWT_SECRET local → "Token inválido".
 * En loopback se acepta igual que el asistente Electron (sin JWT).
 */
function authenticateTokenAllowLoopback(req, res, next) {
  if (!isLoopbackRequest(req)) return authenticateToken(req, res, next);
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    req.user = { id: 'loopback-printing', username: 'loopback', role: 'admin', full_name: 'Impresión local' };
    return next();
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded.role
      ? { ...decoded, role: decoded.role }
      : { ...decoded, role: 'admin' };
    return next();
  } catch (_) {
    req.user = { id: 'loopback-printing', username: 'loopback', role: 'admin', full_name: 'Impresión local' };
    return next();
  }
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
  authenticateTokenAllowLoopback,
  isLoopbackRequest,
  requireRole,
  optionalAuth,
  JWT_SECRET,
};
