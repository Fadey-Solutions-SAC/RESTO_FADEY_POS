const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./jwtSecret');

/** Personal del restaurante: sesión larga hasta cierre explícito (renovable). */
const STAFF_JWT_EXPIRES_IN = String(process.env.JWT_STAFF_EXPIRES_IN || '30d').trim() || '30d';

/** Renovar si quedan menos de 7 días (sliding session). */
const REFRESH_IF_TTL_BELOW_SEC = 7 * 24 * 60 * 60;

function signStaffToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: STAFF_JWT_EXPIRES_IN });
}

function signMasterToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: STAFF_JWT_EXPIRES_IN });
}

function shouldRefreshStaffToken(decoded) {
  if (!decoded?.exp) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  const ttl = decoded.exp - nowSec;
  if (ttl <= 0) return false;
  if (ttl < REFRESH_IF_TTL_BELOW_SEC) return true;
  const iat = Number(decoded.iat) || 0;
  if (iat > 0 && nowSec - iat >= 3600) return true;
  return false;
}

function buildRefreshedStaffToken(decoded, userRow) {
  if (!decoded?.id || decoded.type === 'customer' || decoded.role === 'master_admin') return null;
  if (!userRow || Number(userRow.is_active || 0) !== 1) return null;
  return signStaffToken({
    id: userRow.id,
    username: userRow.username,
    role: userRow.role,
    restaurant_id: userRow.restaurant_id,
    full_name: userRow.full_name,
    session_id: decoded.session_id || '',
  });
}

module.exports = {
  STAFF_JWT_EXPIRES_IN,
  signStaffToken,
  signMasterToken,
  shouldRefreshStaffToken,
  buildRefreshedStaffToken,
};
