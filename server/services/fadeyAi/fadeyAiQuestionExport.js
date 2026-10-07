/**
 * Preguntas que los usuarios escriben a IA Fadey.
 * Se agrupan por categoría (caja, mozo, producción, administración) y, al cerrar
 * el día de negocio, se envían al panel central con la misma identidad que los pagos.
 * El recibidor esperado es POST {CENTRAL_API_URL}/api/ai-messages
 */
const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, runSql } = require('../../database');
const { businessNow } = require('./fadeyAiKnowledgeService');
const { readClientIdentity, isCentralSyncConfigured } = require('../../../packages/shared-config');
const { createCentralSyncClient } = require('../../../packages/shared-api');
const { getRestaurantContext } = require('../centralSyncService');

const CATEGORIES = [
  { id: 'caja', label: 'Caja' },
  { id: 'mozo', label: 'Mozo' },
  { id: 'produccion', label: 'Producción' },
  { id: 'administracion', label: 'Administración' },
];

const ROLE_CATEGORY = {
  cajero: 'caja',
  mozo: 'mozo',
  delivery: 'mozo',
  cocina: 'produccion',
  bar: 'produccion',
  produccion: 'produccion',
  admin: 'administracion',
  master_admin: 'administracion',
};

const MAX_TEXT = 1500;
const RETRY_MS = 30 * 60 * 1000;

let schemaReady = false;
let flushLock = false;

function ensureQuestionExportSchema() {
  if (schemaReady) return;
  runSql(`
    CREATE TABLE IF NOT EXISTS fadey_ai_training_questions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      user_name TEXT,
      user_role TEXT,
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      business_day TEXT NOT NULL,
      created_at TEXT NOT NULL,
      sent_at TEXT
    )
  `);
  runSql(`CREATE INDEX IF NOT EXISTS idx_fadey_ai_training_day ON fadey_ai_training_questions(business_day, category)`);
  runSql(`
    CREATE TABLE IF NOT EXISTS fadey_ai_training_sends (
      business_day TEXT PRIMARY KEY,
      status TEXT,
      error TEXT,
      sent_at TEXT,
      message_count INTEGER,
      last_attempt_at TEXT
    )
  `);
  try {
    runSql('ALTER TABLE fadey_ai_training_sends ADD COLUMN last_attempt_at TEXT');
  } catch (_) {
    /* columna ya existe */
  }
  schemaReady = true;
}

function categoryForRole(role) {
  const key = String(role || '').trim().toLowerCase();
  return ROLE_CATEGORY[key] || 'administracion';
}

function todayKey() {
  return String(businessNow() || '').slice(0, 10);
}

function recordUserAiQuestion({ userId, content, createdAt } = {}) {
  const text = String(content || '').trim().slice(0, MAX_TEXT);
  const uid = String(userId || '').trim();
  if (!text || !uid) return null;
  ensureQuestionExportSchema();
  const user = queryOne('SELECT full_name, role FROM users WHERE id = ?', [uid]);
  const role = String(user?.role || '').trim().toLowerCase();
  const created = String(createdAt || businessNow());
  const id = uuidv4();
  runSql(
    `INSERT INTO fadey_ai_training_questions
      (id, user_id, user_name, user_role, category, content, business_day, created_at, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      id,
      uid,
      String(user?.full_name || '').trim() || 'Usuario',
      role,
      categoryForRole(role),
      text,
      created.slice(0, 10),
      created,
    ],
  );
  return id;
}

function rowsForDay(day) {
  ensureQuestionExportSchema();
  return queryAll(
    `SELECT id, user_id, user_name, user_role, category, content, created_at, sent_at
     FROM fadey_ai_training_questions
     WHERE business_day = ?
     ORDER BY created_at ASC, rowid ASC`,
    [day],
  ) || [];
}

function groupRows(rows) {
  const byCat = new Map(CATEGORIES.map((c) => [c.id, new Map()]));
  for (const row of rows) {
    const cat = byCat.has(row.category) ? row.category : 'administracion';
    const users = byCat.get(cat);
    const uid = String(row.user_id || '');
    if (!users.has(uid)) {
      users.set(uid, {
        userId: uid,
        name: String(row.user_name || 'Usuario'),
        role: String(row.user_role || ''),
        messages: [],
      });
    }
    users.get(uid).messages.push({
      id: row.id,
      at: row.created_at,
      text: row.content,
    });
  }
  return CATEGORIES.map((c) => ({
    id: c.id,
    label: c.label,
    users: [...byCat.get(c.id).values()],
  })).filter((g) => g.users.length > 0);
}

function buildDayPayload(day, rows) {
  const identity = readClientIdentity();
  let restaurantName = '';
  try {
    restaurantName = String(getRestaurantContext()?.restaurant?.name || '').trim();
  } catch (_) {
    restaurantName = '';
  }
  const groups = groupRows(rows);
  const messageCount = rows.length;
  return {
    clientId: identity.clientId,
    webServiceId: identity.webServiceId || identity.clientId,
    licenseKey: identity.licenseKey || identity.clientId,
    sourceWebServiceUrl: identity.publicApiUrl || null,
    restaurantName,
    businessDay: day,
    batchId: `ai-messages:${identity.webServiceId || identity.clientId}:${day}`,
    purpose: 'ai_training',
    sentAt: new Date().toISOString(),
    messageCount,
    categories: groups.map((g) => ({
      id: g.id,
      label: g.label,
      users: g.users.map((u) => ({
        userId: u.userId,
        name: u.name,
        role: u.role,
        messages: u.messages.map((m) => ({ id: m.id, at: m.at, text: m.text })),
      })),
    })),
  };
}

function markDaySent(day, messageCount) {
  const now = businessNow();
  runSql(
    `UPDATE fadey_ai_training_questions SET sent_at = ? WHERE business_day = ?`,
    [now, day],
  );
  runSql(
    `INSERT INTO fadey_ai_training_sends (business_day, status, error, sent_at, message_count, last_attempt_at)
     VALUES (?, 'enviado', '', ?, ?, ?)
     ON CONFLICT(business_day) DO UPDATE SET
       status = 'enviado', error = '', sent_at = excluded.sent_at,
       message_count = excluded.message_count, last_attempt_at = excluded.last_attempt_at`,
    [day, now, messageCount, now],
  );
}

function markDayFailed(day, error, messageCount) {
  const now = businessNow();
  runSql(
    `INSERT INTO fadey_ai_training_sends (business_day, status, error, sent_at, message_count, last_attempt_at)
     VALUES (?, 'pendiente', ?, NULL, ?, ?)
     ON CONFLICT(business_day) DO UPDATE SET
       status = 'pendiente', error = excluded.error,
       message_count = excluded.message_count, last_attempt_at = excluded.last_attempt_at`,
    [day, String(error || 'No se pudo enviar').slice(0, 400), messageCount, now],
  );
}

function daysWithUnsent(beforeDay) {
  ensureQuestionExportSchema();
  const rows = queryAll(
    `SELECT DISTINCT business_day
     FROM fadey_ai_training_questions
     WHERE sent_at IS NULL AND business_day < ?
     ORDER BY business_day ASC`,
    [beforeDay || '9999'],
  ) || [];
  return rows.map((r) => String(r.business_day || '')).filter(Boolean);
}

async function sendDay(day) {
  const rows = rowsForDay(day);
  if (!rows.length) return { ok: true, skipped: true, day, messageCount: 0 };
  const unsent = rows.some((r) => !r.sent_at);
  if (!unsent) return { ok: true, skipped: true, day, messageCount: rows.length, already: true };

  if (!isCentralSyncConfigured()) {
    markDayFailed(day, 'Conexión con el panel no configurada.', rows.length);
    return { ok: false, skipped: true, day, messageCount: rows.length, error: 'Conexión con el panel no configurada.' };
  }

  const payload = buildDayPayload(day, rows);
  const client = createCentralSyncClient();
  const res = await client.syncAiTrainingMessages(payload);
  if (res?.ok) {
    markDaySent(day, rows.length);
    return { ok: true, day, messageCount: rows.length };
  }
  const status = Number(res?.status || 0);
  const error = status === 404
    ? 'El panel todavía no tiene el recibidor POST /api/ai-messages.'
    : (res?.data?.error || res?.error || (status ? `HTTP ${status}` : 'No se pudo enviar'));
  markDayFailed(day, error, rows.length);
  return { ok: false, day, messageCount: rows.length, error, status };
}

function lastAttemptIsRecent() {
  const row = queryOne(
    `SELECT last_attempt_at FROM fadey_ai_training_sends
     WHERE status = 'pendiente' AND last_attempt_at IS NOT NULL
     ORDER BY last_attempt_at DESC LIMIT 1`,
  );
  if (!row?.last_attempt_at) return false;
  const t = Date.parse(String(row.last_attempt_at).replace(' ', 'T'));
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < RETRY_MS;
}

/**
 * Envía los días ya cerrados. includeToday manda también el día en curso
 * (el panel reemplaza el lote de ese día).
 */
async function flushAiTrainingQuestions({ includeToday = false, force = false } = {}) {
  if (flushLock) return { ok: false, busy: true };
  flushLock = true;
  try {
    ensureQuestionExportSchema();
    const today = todayKey();
    const days = daysWithUnsent(includeToday ? '9999-99-99' : today);
    if (!force && !includeToday && days.length && lastAttemptIsRecent()) {
      return { ok: false, delayed: true, days };
    }
    const results = [];
    for (const day of days) {
      results.push(await sendDay(day));
    }
    pruneOldQuestions();
    return { ok: results.every((r) => r.ok || r.skipped), results, days };
  } finally {
    flushLock = false;
  }
}

function pruneOldQuestions() {
  const cutoff = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  runSql(
    `DELETE FROM fadey_ai_training_questions WHERE sent_at IS NOT NULL AND business_day < ?`,
    [cutoff],
  );
}

function getAiTrainingInbox() {
  ensureQuestionExportSchema();
  const today = todayKey();
  const identity = readClientIdentity();
  const groups = groupRows(rowsForDay(today));
  const pendingDays = daysWithUnsent(today);
  const lastSend = queryOne(
    `SELECT business_day, status, error, sent_at, message_count
     FROM fadey_ai_training_sends
     ORDER BY COALESCE(sent_at, business_day) DESC
     LIMIT 1`,
  );
  const todayCount = groups.reduce((n, g) => n + g.users.reduce((m, u) => m + u.messages.length, 0), 0);
  return {
    today,
    configured: isCentralSyncConfigured(),
    endpoint: `${identity.centralPlatformUrl || ''}/api/ai-messages`,
    webServiceId: identity.webServiceId || identity.clientId || '',
    todayCount,
    pendingDays,
    lastSend: lastSend
      ? {
          businessDay: lastSend.business_day,
          status: lastSend.status,
          error: lastSend.error || '',
          sentAt: lastSend.sent_at,
          messageCount: Number(lastSend.message_count || 0),
        }
      : null,
    groups: groups.map((g) => ({
      ...g,
      users: g.users.map((u) => ({
        ...u,
        count: u.messages.length,
        messages: u.messages.slice(-30),
      })),
    })),
  };
}

/**
 * Prueba del administrador maestro: envía ya las preguntas que él escribió
 * en este web service. No marca como enviadas las del resto del personal.
 */
async function sendOwnAiMessagesTest({ userId, userName, userRole } = {}) {
  ensureQuestionExportSchema();
  const uid = String(userId || '').trim();
  if (!uid) return { ok: false, error: 'No se identificó al administrador maestro.' };

  const rows = queryAll(
    `SELECT id, user_id, user_name, user_role, category, content, created_at, sent_at, business_day
     FROM fadey_ai_training_questions
     WHERE user_id = ?
     ORDER BY created_at ASC, rowid ASC`,
    [uid],
  ) || [];
  if (!rows.length) {
    return {
      ok: false,
      error: 'Todavía no hay preguntas tuyas en este web service. Escribe a la IA y vuelve a enviar la prueba.',
    };
  }
  if (!isCentralSyncConfigured()) {
    return {
      ok: false,
      messageCount: rows.length,
      error: 'Conexión con el panel no configurada. Esta prueba usa las mismas variables del pago del plan.',
    };
  }

  const named = rows.map((row) => ({
    ...row,
    user_name: String(row.user_name || '').trim() && row.user_name !== 'Usuario'
      ? row.user_name
      : (String(userName || '').trim() || 'Administrador maestro'),
    user_role: String(row.user_role || userRole || 'master_admin'),
    category: row.category || 'administracion',
  }));
  const day = todayKey();
  const payload = buildDayPayload(day, named);
  payload.test = true;
  payload.purpose = 'ai_training_test';
  payload.batchId = `ai-messages-test:${payload.webServiceId}:${uid}:${day}`;

  const client = createCentralSyncClient();
  const res = await client.syncAiTrainingMessages(payload);
  if (res?.ok) {
    const now = businessNow();
    const ids = named.map((row) => row.id);
    runSql(
      `UPDATE fadey_ai_training_questions SET sent_at = ? WHERE id IN (${ids.map(() => '?').join(',')})`,
      [now, ...ids],
    );
    return { ok: true, messageCount: named.length, businessDay: day };
  }

  const status = Number(res?.status || 0);
  const error = status === 404
    ? 'El panel todavía no tiene el recibidor POST /api/ai-messages.'
    : (res?.data?.error || res?.error || (status ? `HTTP ${status}` : 'No se pudo enviar'));
  return { ok: false, error, status, messageCount: named.length };
}

module.exports = {
  CATEGORIES,
  categoryForRole,
  recordUserAiQuestion,
  flushAiTrainingQuestions,
  getAiTrainingInbox,
  sendOwnAiMessagesTest,
  groupRows,
};
