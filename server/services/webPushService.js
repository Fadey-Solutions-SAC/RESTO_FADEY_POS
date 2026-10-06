/**
 * Web Push: avisos al celular/PC del usuario aunque la pantalla esté apagada o el sistema cerrado.
 * Las claves VAPID se generan una vez y quedan en app_settings para que las suscripciones sigan válidas.
 */
const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, runSql } = require('../database');

const VAPID_SETTINGS_KEY = 'web_push_vapid';

let webpush = null;
try {
  webpush = require('web-push');
} catch (_) {
  webpush = null;
}

let tablesReady = false;
let vapidReady = false;
let publicKey = '';

function ensureTables() {
  if (tablesReady) return;
  runSql(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  runSql('CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id)');
  tablesReady = true;
}

function ensureVapid() {
  if (!webpush) return false;
  if (vapidReady) return true;
  let pub = String(process.env.VAPID_PUBLIC_KEY || '').trim();
  let priv = String(process.env.VAPID_PRIVATE_KEY || '').trim();
  if (!pub || !priv) {
    const row = queryOne('SELECT value FROM app_settings WHERE key = ?', [VAPID_SETTINGS_KEY]);
    try {
      const stored = row?.value ? JSON.parse(row.value) : null;
      if (stored?.publicKey && stored?.privateKey) {
        pub = stored.publicKey;
        priv = stored.privateKey;
      }
    } catch (_) {
      /* se regeneran abajo */
    }
  }
  if (!pub || !priv) {
    const keys = webpush.generateVAPIDKeys();
    pub = keys.publicKey;
    priv = keys.privateKey;
    runSql(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      [VAPID_SETTINGS_KEY, JSON.stringify({ publicKey: pub, privateKey: priv })],
    );
  }
  const subject = String(process.env.VAPID_SUBJECT || 'mailto:soporte@restofadey.com').trim();
  webpush.setVapidDetails(subject, pub, priv);
  publicKey = pub;
  vapidReady = true;
  return true;
}

function getPublicKey() {
  return ensureVapid() ? publicKey : '';
}

function saveSubscription(userId, sub, userAgent = '') {
  ensureTables();
  const endpoint = String(sub?.endpoint || '').trim();
  const p256dh = String(sub?.keys?.p256dh || '').trim();
  const auth = String(sub?.keys?.auth || '').trim();
  if (!userId || !endpoint || !p256dh || !auth) return false;
  const existing = queryOne('SELECT id FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
  if (existing) {
    runSql(
      `UPDATE push_subscriptions SET user_id = ?, p256dh = ?, auth = ?, user_agent = ?, updated_at = datetime('now') WHERE id = ?`,
      [String(userId), p256dh, auth, String(userAgent || '').slice(0, 300), existing.id],
    );
  } else {
    runSql(
      'INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), String(userId), endpoint, p256dh, auth, String(userAgent || '').slice(0, 300)],
    );
  }
  return true;
}

function removeSubscription(endpoint) {
  ensureTables();
  const ep = String(endpoint || '').trim();
  if (ep) runSql('DELETE FROM push_subscriptions WHERE endpoint = ?', [ep]);
}

/**
 * Envía un aviso push a todos los dispositivos suscritos del usuario.
 * @param {string} userId
 * @param {{ title: string, body?: string, tag?: string, url?: string, kind?: string }} payload
 */
async function sendPushToUser(userId, payload) {
  if (!userId || !ensureVapid()) return 0;
  ensureTables();
  const subs = queryAll('SELECT * FROM push_subscriptions WHERE user_id = ?', [String(userId)]);
  if (!subs.length) return 0;
  const body = JSON.stringify(payload || {});
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
        { TTL: 300, urgency: 'high', topic: String(payload?.tag || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || undefined },
      );
      sent += 1;
    } catch (err) {
      const code = Number(err?.statusCode || 0);
      if (code === 404 || code === 410) removeSubscription(s.endpoint);
      else console.warn('[web-push]', code || '', err?.message || err);
    }
  }));
  return sent;
}

module.exports = {
  getPublicKey,
  saveSubscription,
  removeSubscription,
  sendPushToUser,
};
