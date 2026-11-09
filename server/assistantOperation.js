const { queryOne } = require('./database');

/** Heartbeat del POS en navegador (caja / panel abierto). */
const HEARTBEAT_FRESH_MS = 120_000;

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
 * Sistema en operación = hay caja abierta y/o el POS mandó heartbeat reciente.
 * El APK Android usa esto para arrancar/parar el servicio en segundo plano.
 */
function getOperationStatus() {
  const openRegisters = countOpenRegisters();
  const hbMs = lastPosHeartbeatAt ? Date.parse(lastPosHeartbeatAt) : NaN;
  const heartbeatFresh = Number.isFinite(hbMs) && Date.now() - hbMs < HEARTBEAT_FRESH_MS;
  const operating = openRegisters > 0 || heartbeatFresh;
  return {
    ok: true,
    operating,
    openRegisters,
    posHeartbeatAt: lastPosHeartbeatAt,
    heartbeatFresh,
    posUserId: lastPosUserId,
    posRole: lastPosRole,
    heartbeatWindowMs: HEARTBEAT_FRESH_MS,
    checkedAt: new Date().toISOString(),
  };
}

module.exports = {
  touchPosHeartbeat,
  getOperationStatus,
  HEARTBEAT_FRESH_MS,
};
