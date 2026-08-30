const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { requireBearerApiSecret } = require('../../../../packages/shared-auth');
const { queryOne, runSql } = require('../database');
const { upsertClient } = require('../services/clientRegistry');

const router = express.Router();
const apiSecret = () => process.env.API_SECRET_KEY;

router.use(requireBearerApiSecret(apiSecret()));

router.post('/events', (req, res) => {
  const {
    clientId,
    restaurantId,
    webServiceId,
    licenseKey,
    eventType,
    payload,
    sourceWebServiceUrl,
  } = req.body || {};
  if (!clientId || !webServiceId || !eventType) {
    return res.status(400).json({ error: 'clientId, webServiceId y eventType son requeridos' });
  }
  upsertClient({
    clientId,
    restaurantId: restaurantId || clientId,
    webServiceId,
    licenseKey,
    sourceWebServiceUrl: sourceWebServiceUrl || payload?.renderUrl || '',
    restaurantName: payload?.restaurantName || payload?.restaurante || '',
    plan: payload?.plan,
  });
  const id = uuidv4();
  runSql(
    `INSERT INTO sync_events (id, client_id, web_service_id, event_type, payload_json)
     VALUES (?, ?, ?, ?, ?)`,
    [id, clientId, webServiceId, eventType, JSON.stringify(payload || {})]
  );
  if (eventType === 'plan_status' || eventType === 'plan_renewal') {
    const plan = String(payload?.plan || 'profesional');
    runSql(
      `UPDATE clients SET plan = ?, updated_at = datetime('now') WHERE client_id = ?`,
      [plan, clientId]
    );
    runSql(
      `INSERT INTO licenses (client_id, license_key, plan, status, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(client_id) DO UPDATE SET
         license_key = excluded.license_key,
         plan = excluded.plan,
         status = excluded.status,
         updated_at = datetime('now')`,
      [clientId, licenseKey || '', plan, payload?.locked ? 'suspended' : 'active']
    );
  }
  if (eventType === 'client_profile') {
    const plan = String(payload?.plan || '').trim();
    const status = String(payload?.licenseStatus || '').toLowerCase();
    const licenseStatus =
      status === 'suspendido' || status === 'suspended' || payload?.locked
        ? 'suspended'
        : 'active';
    if (plan) {
      runSql(
        `UPDATE clients SET plan = ?, license_status = ?, updated_at = datetime('now') WHERE client_id = ?`,
        [plan, licenseStatus, clientId],
      );
    } else {
      runSql(
        `UPDATE clients SET license_status = ?, updated_at = datetime('now') WHERE client_id = ?`,
        [licenseStatus, clientId],
      );
    }
    if (payload?.expirationDate) {
      runSql(
        `INSERT INTO licenses (client_id, license_key, plan, status, expires_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(client_id) DO UPDATE SET
           plan = COALESCE(excluded.plan, licenses.plan),
           status = excluded.status,
           expires_at = COALESCE(excluded.expires_at, licenses.expires_at),
           updated_at = datetime('now')`,
        [
          clientId,
          licenseKey || clientId,
          plan || 'plan premium',
          licenseStatus,
          String(payload.expirationDate).slice(0, 10),
        ],
      );
    }
  }
  if (eventType === 'license_activity') {
    runSql(
      `UPDATE licenses SET status = ?, updated_at = datetime('now') WHERE client_id = ?`,
      [String(payload?.status || 'active'), clientId]
    );
  }
  return res.json({ ok: true, eventId: id });
});

router.post('/users', (req, res) => {
  const { clientId, user } = req.body || {};
  if (!clientId || !user?.email || !user?.passwordHash) {
    return res.status(400).json({ error: 'clientId, user.email y user.passwordHash requeridos' });
  }
  const email = String(user.email).trim().toLowerCase();
  const existing = queryOne('SELECT id FROM central_users WHERE email = ?', [email]);
  if (existing?.id) {
    runSql(
      `UPDATE central_users SET
         username = ?, full_name = ?, password_hash = ?, client_id = ?,
         role = ?, is_active = ?, updated_at = datetime('now')
       WHERE email = ?`,
      [
        user.username || '',
        user.fullName || '',
        user.passwordHash,
        clientId,
        user.role === 'admin' ? 'client_admin' : 'client_staff',
        user.isActive === false ? 0 : 1,
        email,
      ]
    );
    return res.json({ ok: true, userId: existing.id, updated: true });
  }
  const id = uuidv4();
  runSql(
    `INSERT INTO central_users (id, email, username, full_name, password_hash, role, client_id, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      email,
      user.username || '',
      user.fullName || '',
      user.passwordHash,
      user.role === 'admin' ? 'client_admin' : 'client_staff',
      clientId,
      user.isActive === false ? 0 : 1,
    ]
  );
  return res.json({ ok: true, userId: id, created: true });
});

module.exports = router;
