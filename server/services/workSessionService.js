/**
 * Jornadas laborales: varios dispositivos pueden compartir el mismo usuario.
 * - session_kind=jornada: inicio real de jornada (primer login del día / sin otra sesión abierta).
 * - session_kind=parallel: acceso adicional (monitoreo) mientras hay jornada abierta.
 * Reportes agregan MIN(login_at) … MAX(logout_at) o «activa» si queda algún dispositivo conectado.
 */
const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, runSql } = require('../database');
const {
  rawWorkedMinutesExpr,
  effectiveWorkedMinutesFromValues,
  parseDateKey,
} = require('../lib/workSessionSql');
const { STAFF_IDLE_LOGOUT_MINUTES } = require('../constants/staffSessionPolicy');

const TRACKABLE_STAFF_ROLES = new Set(['admin', 'cajero', 'mozo', 'cocina', 'bar', 'delivery']);

function initialAttendanceStatusForRole(role) {
  return String(role || '').toLowerCase() === 'admin' ? 'asistente' : 'pending';
}

function countOpenSessions(userId) {
  return Number(
    queryOne('SELECT COUNT(*) AS c FROM user_work_sessions WHERE user_id = ? AND logout_at IS NULL', [userId])?.c || 0
  );
}

function startWorkSession(user, photoLogin = null) {
  if (!user?.id) return { sessionTokenId: '', isParallel: false };

  const openCount = countOpenSessions(user.id);
  const isParallel = openCount > 0;
  const sessionTokenId = uuidv4();
  const sessionKind = isParallel ? 'parallel' : 'jornada';
  const att = isParallel ? 'asistente' : initialAttendanceStatusForRole(user.role);

  runSql(
    `INSERT INTO user_work_sessions
      (id, user_id, session_token_id, username, full_name, role, login_at, last_activity_at, photo_login, attendance_status, session_kind, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      uuidv4(),
      user.id,
      sessionTokenId,
      user.username,
      user.full_name,
      user.role,
      isParallel ? null : photoLogin,
      att,
      sessionKind,
    ]
  );

  return { sessionTokenId, isParallel };
}

function closeWorkSession(userId, sessionTokenId = '', closeReason = 'logout', photoLogout = null) {
  const uid = String(userId || '').trim();
  const sid = String(sessionTokenId || '').trim();
  if (!uid) return { closed: false, isParallel: false, wasLastOpen: false };

  const active = sid
    ? queryOne(
        'SELECT id, session_kind FROM user_work_sessions WHERE user_id = ? AND session_token_id = ? AND logout_at IS NULL LIMIT 1',
        [uid, sid]
      )
    : queryOne(
        'SELECT id, session_kind FROM user_work_sessions WHERE user_id = ? AND logout_at IS NULL ORDER BY login_at DESC LIMIT 1',
        [uid]
      );
  if (!active?.id) return { closed: false, isParallel: false, wasLastOpen: false };

  const openBefore = countOpenSessions(uid);
  const isParallel = String(active.session_kind || '') === 'parallel';
  const reason = isParallel ? 'parallel_logout' : closeReason;

  if (isParallel) {
    runSql(
      `UPDATE user_work_sessions
       SET logout_at = datetime('now'),
           worked_minutes = CAST((julianday('now') - julianday(login_at)) * 24 * 60 AS INTEGER),
           close_reason = ?,
           updated_at = datetime('now')
       WHERE id = ?`,
      [reason, active.id]
    );
  } else {
    runSql(
      `UPDATE user_work_sessions
       SET logout_at = datetime('now'),
           worked_minutes = CAST((julianday('now') - julianday(login_at)) * 24 * 60 AS INTEGER),
           close_reason = ?,
           photo_logout = COALESCE(?, photo_logout),
           updated_at = datetime('now')
       WHERE id = ?`,
      [reason, photoLogout, active.id]
    );
  }

  const wasLastOpen = openBefore <= 1;
  return { closed: true, isParallel, wasLastOpen };
}

/** Jornada abierta que coincide exactamente con el token JWT. */
function resolveJwtStaffSession(userId, sessionTokenId = '') {
  const uid = String(userId || '').trim();
  const sid = String(sessionTokenId || '').trim();
  if (!uid || !sid) return null;
  return queryOne(
    `SELECT id, user_id, login_at, last_activity_at, session_token_id
     FROM user_work_sessions
     WHERE user_id = ? AND session_token_id = ? AND logout_at IS NULL LIMIT 1`,
    [uid, sid]
  );
}

/** Jornada abierta del token JWT o, si no coincide, la más reciente del usuario. */
function resolveOpenStaffSession(userId, sessionTokenId = '') {
  const own = resolveJwtStaffSession(userId, sessionTokenId);
  if (own) return own;
  const uid = String(userId || '').trim();
  if (!uid) return null;
  return queryOne(
    `SELECT id, user_id, login_at, last_activity_at, session_token_id
     FROM user_work_sessions
     WHERE user_id = ? AND logout_at IS NULL ORDER BY login_at DESC LIMIT 1`,
    [uid]
  );
}

/** Reinicia el contador de inactividad (login u operación). */
function touchStaffSessionNow(userId, sessionTokenId = '') {
  const row = resolveJwtStaffSession(userId, sessionTokenId)
    || resolveOpenStaffSession(userId, sessionTokenId);
  if (!row?.id) return false;
  runSql(
    `UPDATE user_work_sessions SET last_activity_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
    [row.id]
  );
  return true;
}

/** Minutos sin actividad solo en la jornada del token JWT (null = sin jornada ligada). */
function getStaffSessionIdleMinutes(userId, sessionTokenId = '') {
  const row = resolveJwtStaffSession(userId, sessionTokenId);
  if (!row) return null;
  const anchor = String(row.last_activity_at || '').trim() || String(row.login_at || '').trim();
  if (!anchor) return 0;
  const idle = queryOne(
    `SELECT CAST((julianday('now') - julianday(?)) * 24 * 60 AS INTEGER) AS idle_minutes`,
    [anchor]
  );
  return Math.max(0, Number(idle?.idle_minutes || 0));
}

/**
 * Cierra sesión si lleva ≥36 h sin actividad desde last_activity_at.
 * Cada login u operación reinicia ese contador (touchStaffSessionNow).
 * @returns {string|null} mensaje de error si debe bloquearse el acceso
 */
function enforceStaffIdleLogout(user) {
  if (!user?.id || !TRACKABLE_STAFF_ROLES.has(String(user.role || ''))) return null;

  const idleMinutes = getStaffSessionIdleMinutes(user.id, user.session_id);
  if (idleMinutes == null) return null;

  if (idleMinutes >= STAFF_IDLE_LOGOUT_MINUTES) {
    closeWorkSession(user.id, user.session_id, 'idle_auto_logout', null);
    return 'Sesión cerrada por inactividad (36 h). Inicie sesión nuevamente.';
  }
  return null;
}

/** Cierra jornadas abiertas sin actividad real (p. ej. cerró el navegador sin «Finalizar jornada»). */
function closeStaleOpenWorkSessions({ minIdleMinutes = STAFF_IDLE_LOGOUT_MINUTES } = {}) {
  const threshold = Math.max(60, Number(minIdleMinutes) || 0);
  const rows = queryAll(
    `SELECT s.id, s.user_id, s.session_token_id,
            CASE
              WHEN s.last_activity_at IS NULL OR trim(s.last_activity_at) = ''
                THEN CAST((julianday('now') - julianday(s.login_at)) * 24 * 60 AS INTEGER)
              ELSE CAST((julianday('now') - julianday(s.last_activity_at)) * 24 * 60 AS INTEGER)
            END AS idle_minutes
     FROM user_work_sessions s
     WHERE s.logout_at IS NULL`
  );
  let closed = 0;
  for (const row of rows || []) {
    if (Number(row.idle_minutes || 0) < threshold) continue;
    const result = closeWorkSession(row.user_id, row.session_token_id, 'stale_auto_close', null);
    if (result.closed) closed += 1;
  }
  return closed;
}

function buildSessionDateWhere(alias, from, to, params) {
  const parts = [];
  if (from) {
    parts.push(`date(datetime(${alias}.login_at, 'localtime')) >= date(?)`);
    params.push(from);
  }
  if (to) {
    parts.push(`date(datetime(${alias}.login_at, 'localtime')) <= date(?)`);
    params.push(to);
  }
  return parts.length ? parts.join(' AND ') : '1=1';
}

function queryAggregatedJornadas({ from, to, userId }) {
  const params = [];
  const sw = buildSessionDateWhere('s', from, to, params);
  const userFilter = userId && userId !== 'all' ? ' AND s.user_id = ?' : '';
  if (userId && userId !== 'all') params.push(userId);

  const rows = queryAll(
    `SELECT
      s.user_id,
      date(datetime(s.login_at, 'localtime')) AS work_day,
      MIN(s.login_at) AS login_at,
      CASE WHEN SUM(CASE WHEN s.logout_at IS NULL THEN 1 ELSE 0 END) > 0 THEN NULL ELSE MAX(s.logout_at) END AS logout_at,
      CASE WHEN SUM(CASE WHEN s.logout_at IS NULL THEN 1 ELSE 0 END) > 0
        THEN CAST((julianday('now') - julianday(MIN(s.login_at))) * 24 * 60 AS INTEGER)
        ELSE CAST((julianday(MAX(s.logout_at)) - julianday(MIN(s.login_at))) * 24 * 60 AS INTEGER)
      END AS raw_worked_minutes,
      COUNT(*) AS device_sessions_count,
      SUM(CASE WHEN COALESCE(s.session_kind, 'jornada') = 'parallel' THEN 1 ELSE 0 END) AS parallel_sessions_count
     FROM user_work_sessions s
     WHERE ${sw}${userFilter}
     GROUP BY s.user_id, date(datetime(s.login_at, 'localtime'))
     ORDER BY MIN(s.login_at) DESC`,
    params
  );

  return (rows || []).map((row) => {
    const primary = queryOne(
      `SELECT s.id, s.attendance_status, s.role, u.role AS user_role,
              CASE WHEN length(COALESCE(s.photo_login, '')) > 10 THEN 1 ELSE 0 END AS has_photo_login,
              CASE WHEN length(COALESCE(s.photo_logout, '')) > 10 THEN 1 ELSE 0 END AS has_photo_logout
       FROM user_work_sessions s
       LEFT JOIN users u ON u.id = s.user_id
       WHERE s.user_id = ? AND s.login_at = ?
         AND COALESCE(s.session_kind, 'jornada') = 'jornada'
       LIMIT 1`,
      [row.user_id, row.login_at]
    ) || queryOne(
      `SELECT s.id, s.attendance_status, s.role, u.role AS user_role,
              CASE WHEN length(COALESCE(s.photo_login, '')) > 10 THEN 1 ELSE 0 END AS has_photo_login,
              CASE WHEN length(COALESCE(s.photo_logout, '')) > 10 THEN 1 ELSE 0 END AS has_photo_logout
       FROM user_work_sessions s
       LEFT JOIN users u ON u.id = s.user_id
       WHERE s.user_id = ? AND s.login_at = ?
       LIMIT 1`,
      [row.user_id, row.login_at]
    );

    const user = queryOne('SELECT full_name, username, role FROM users WHERE id = ?', [row.user_id]);
    const role = user?.role || primary?.user_role || primary?.role || '';
    const workedMinutes = effectiveWorkedMinutesFromValues({
      rawMinutes: Number(row.raw_worked_minutes || 0),
      attendanceStatus: primary?.attendance_status || 'pending',
      role,
    });

    return {
      id: primary?.id || `${row.user_id}_${row.work_day}`,
      user_id: row.user_id,
      full_name: user?.full_name || '',
      username: user?.username || '',
      role,
      work_day: row.work_day,
      login_at: row.login_at,
      logout_at: row.logout_at,
      raw_worked_minutes: Number(row.raw_worked_minutes || 0),
      worked_minutes: workedMinutes,
      attendance_status: primary?.attendance_status || 'pending',
      has_photo_login: Number(primary?.has_photo_login || 0),
      has_photo_logout: Number(primary?.has_photo_logout || 0),
      device_sessions_count: Number(row.device_sessions_count || 0),
      parallel_sessions_count: Number(row.parallel_sessions_count || 0),
      is_aggregated_jornada: true,
    };
  });
}

function queryDeviceSessions({ from, to, userId }) {
  const params = [];
  const sw = buildSessionDateWhere('s', from, to, params);
  const userFilter = userId && userId !== 'all' ? ' AND s.user_id = ?' : '';
  if (userId && userId !== 'all') params.push(userId);
  const rawEx = rawWorkedMinutesExpr('s');

  return queryAll(
    `SELECT
      s.id,
      s.user_id,
      COALESCE(NULLIF(u.full_name, ''), s.full_name) AS full_name,
      COALESCE(NULLIF(u.username, ''), s.username) AS username,
      COALESCE(NULLIF(u.role, ''), s.role) AS role,
      s.login_at,
      s.logout_at,
      COALESCE(s.session_kind, 'jornada') AS session_kind,
      COALESCE(s.attendance_status, 'pending') AS attendance_status,
      ${rawEx} AS raw_worked_minutes,
      s.close_reason
     FROM user_work_sessions s
     LEFT JOIN users u ON u.id = s.user_id
     WHERE ${sw}${userFilter}
     ORDER BY s.login_at DESC
     LIMIT 300`,
    params
  );
}

function summarizeJornadas(jornadas) {
  const map = new Map();
  for (const j of jornadas || []) {
    const key = j.user_id;
    if (!map.has(key)) {
      map.set(key, {
        user_id: j.user_id,
        full_name: j.full_name,
        username: j.username,
        role: j.role,
        sessions_count: 0,
        total_minutes: 0,
      });
    }
    const acc = map.get(key);
    acc.sessions_count += 1;
    acc.total_minutes += Number(j.worked_minutes || 0);
  }
  return [...map.values()].sort((a, b) => b.total_minutes - a.total_minutes);
}

function ensureOpenWorkSession(user) {
  const trackableRoles = new Set(['admin', 'cajero', 'mozo', 'cocina', 'bar', 'delivery']);
  if (!user?.id || !trackableRoles.has(user.role)) return null;

  const sid = String(user.session_id || '').trim();
  if (sid) {
    const own = queryOne(
      'SELECT id FROM user_work_sessions WHERE user_id = ? AND session_token_id = ? AND logout_at IS NULL LIMIT 1',
      [user.id, sid]
    );
    if (own?.id) return null;
  }

  const existing = queryOne(
    'SELECT id FROM user_work_sessions WHERE user_id = ? AND logout_at IS NULL ORDER BY login_at DESC LIMIT 1',
    [user.id]
  );
  if (!sid && existing?.id) return null;

  const { sessionTokenId } = startWorkSession(user, null);
  touchStaffSessionNow(user.id, sessionTokenId);
  return sessionTokenId;
}

/** Repara jornadas abiertas sin last_activity_at (usuarios bloqueados tras migración). */
function backfillOpenSessionActivity() {
  runSql(
    `UPDATE user_work_sessions
     SET last_activity_at = datetime('now'), updated_at = datetime('now')
     WHERE logout_at IS NULL
       AND (last_activity_at IS NULL OR trim(last_activity_at) = '')`
  );
}

module.exports = {
  initialAttendanceStatusForRole,
  countOpenSessions,
  startWorkSession,
  closeWorkSession,
  closeStaleOpenWorkSessions,
  resolveOpenStaffSession,
  resolveJwtStaffSession,
  touchStaffSessionNow,
  getStaffSessionIdleMinutes,
  enforceStaffIdleLogout,
  ensureOpenWorkSession,
  backfillOpenSessionActivity,
  queryAggregatedJornadas,
  queryDeviceSessions,
  summarizeJornadas,
  parseDateKey,
};
