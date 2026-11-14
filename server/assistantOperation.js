const { queryOne } = require('./database');
const { businessNowSqlLiteral } = require('./lib/workSessionSql');
const { closeExcessOpenSessions } = require('./services/workSessionService');

/** Heartbeat del POS en navegador (caja / panel abierto). */
const HEARTBEAT_FRESH_MS = 120_000;
/** El personal avisa cada 2 min con la pestaña visible. 6 min cubre un aviso perdido. */
const ACTIVE_USER_MINUTES = 6;

let lastPosHeartbeatAt = null;
let lastPosUserId = null;
let lastPosRole = null;

function touchPosHeartbeat(req) {
  lastPosHeartbeatAt = new Date().toISOString();
  lastPosUserId = req?.user?.id != null ? String(req.user.id) : null;
  lastPosRole = req?.user?.role != null ? String(req.user.role) : null;
}

function countOpenRegisters() {
  try {
    const row = queryOne(
      `SELECT COUNT(*) AS c FROM cash_registers WHERE closed_at IS NULL`,
    );
    return Number(row?.c || 0);
  } catch (_) {
    return 0;
  }
}

/**
 * Personas con la pestaña del sistema en uso.
 * El mismo usuario en dos equipos cuenta como uno (COUNT DISTINCT user_id).
 */
function countActiveUsers() {
  try {
    closeExcessOpenSessions();
  } catch (_) {
    /* la cuenta sigue aunque no se puedan cerrar duplicados */
  }
  try {
    const nowLit = businessNowSqlLiteral();
    const row = queryOne(
      `SELECT COUNT(DISTINCT user_id) AS c
       FROM user_work_sessions
       WHERE logout_at IS NULL
         AND CAST((julianday(${nowLit}) - julianday(
           COALESCE(NULLIF(trim(last_activity_at), ''), login_at)
         )) * 24 * 60 AS INTEGER) <= ?`,
      [ACTIVE_USER_MINUTES],
    );
    return Number(row?.c || 0);
  } catch (_) {
    return 0;
  }
}

/**
 * Hay usuario activo si alguien tiene la sesión abierta y reciente,
 * o el POS mandó heartbeat en los últimos 2 minutos.
 * Una caja abierta sin nadie no mantiene el asistente encendido.
 */
function getOperationStatus() {
  const openRegisters = countOpenRegisters();
  const activeUsers = countActiveUsers();
  const hbMs = lastPosHeartbeatAt ? Date.parse(lastPosHeartbeatAt) : NaN;
  const heartbeatFresh = Number.isFinite(hbMs) && Date.now() - hbMs < HEARTBEAT_FRESH_MS;
  const operating = activeUsers > 0 || heartbeatFresh;
  return {
    ok: true,
    operating,
    activeUsers,
    openRegisters,
    posHeartbeatAt: lastPosHeartbeatAt,
    heartbeatFresh,
    posUserId: lastPosUserId,
    posRole: lastPosRole,
    heartbeatWindowMs: HEARTBEAT_FRESH_MS,
    activeUserWindowMinutes: ACTIVE_USER_MINUTES,
    checkedAt: new Date().toISOString(),
  };
}

module.exports = {
  touchPosHeartbeat,
  getOperationStatus,
  HEARTBEAT_FRESH_MS,
  ACTIVE_USER_MINUTES,
};
