/**
 * Actualiza actividad de jornada abierta (sin alterar flujo de login/logout).
 * Cada toque reinicia el contador de 36 h de inactividad en last_activity_at.
 */

const { queryOne, runSql } = require('../database');
const { v4: uuidv4 } = require('uuid');
const { resolveOpenStaffSession, touchStaffSessionNow } = require('./workSessionService');

const TRACKABLE = new Set(['admin', 'cajero', 'mozo', 'cocina', 'bar', 'delivery']);
const lastTouchByUser = new Map();
const TOUCH_MS = 30_000;
const HEARTBEAT_EVENT_MS = 5 * 60_000;

function touchWorkSessionActivity(user, meta = {}, options = {}) {
  if (!user?.id || !TRACKABLE.has(user.role)) return;
  const uid = String(user.id);
  const sessionTokenId = String(user.session_id || '').trim();
  const now = Date.now();
  const force = options.force === true;

  if (!force) {
    const prev = lastTouchByUser.get(uid) || 0;
    if (now - prev < TOUCH_MS) return;
  }
  lastTouchByUser.set(uid, now);

  try {
    if (!touchStaffSessionNow(uid, sessionTokenId)) return;

    const open = resolveOpenStaffSession(uid, sessionTokenId);
    if (!open?.id) return;

    const lastEvt = queryOne(
      `SELECT created_at FROM user_work_activity_events
       WHERE user_id = ? AND event_type = 'heartbeat' ORDER BY datetime(created_at) DESC LIMIT 1`,
      [uid]
    );
    const lastEvtMs = lastEvt?.created_at ? Date.parse(String(lastEvt.created_at).replace(' ', 'T')) : 0;
    if (!lastEvtMs || now - lastEvtMs >= HEARTBEAT_EVENT_MS) {
      runSql(
        `INSERT INTO user_work_activity_events (id, user_id, session_id, event_type, module, ref_id, meta_json)
         VALUES (?, ?, ?, 'heartbeat', ?, '', ?)`,
        [uuidv4(), uid, open.id, String(meta.module || 'app').slice(0, 40), JSON.stringify({ path: meta.path || '' })]
      );
    }
  } catch (_) {
    /* best effort */
  }
}

/** Registro de evento operativo (venta, pedido, etc.) — reinicia contador al instante. */
function recordWorkActivityEvent(userId, eventType, { module = '', refId = '', meta = {}, sessionTokenId = '' } = {}) {
  const uid = String(userId || '').trim();
  if (!uid) return;
  try {
    const open = resolveOpenStaffSession(uid, sessionTokenId);
    runSql(
      `INSERT INTO user_work_activity_events (id, user_id, session_id, event_type, module, ref_id, meta_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        uid,
        open?.id || null,
        String(eventType || 'action').slice(0, 48),
        String(module || '').slice(0, 40),
        String(refId || '').slice(0, 80),
        JSON.stringify(meta || {}),
      ]
    );
    touchStaffSessionNow(uid, sessionTokenId || open?.session_token_id || '');
    lastTouchByUser.set(uid, Date.now());
  } catch (_) {
    /* noop */
  }
}

module.exports = { touchWorkSessionActivity, recordWorkActivityEvent };
