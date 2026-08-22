const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { queryOne, queryAll, runSql } = require('../database');
const { authenticateToken } = require('../middleware/auth');
const {
  advanceStaffChatCycleIfDue,
  getCurrentCycleId,
} = require('../staffChatService');

const router = express.Router();
const STAFF_ROLES = new Set(['admin', 'cajero', 'mozo', 'cocina', 'bar', 'delivery', 'produccion']);
const MAX_BODY = 2000;

function staffOnly(req, res, next) {
  if (req.user?.type === 'customer' || req.user?.role === 'master_admin') {
    return res.status(403).json({ error: 'Mensajería solo para personal del restaurante' });
  }
  if (!STAFF_ROLES.has(req.user?.role)) {
    return res.status(403).json({ error: 'No autorizado' });
  }
  next();
}

router.use(authenticateToken);
router.use(staffOnly);

router.get('/state', (req, res) => {
  advanceStaffChatCycleIfDue();
  const row = queryOne(
    'SELECT cycle_id, cycle_started_at, all_staff_offline_at FROM internal_chat_state WHERE id = 1'
  );
  res.json({
    cycle_id: Number(row?.cycle_id || 1),
    cycle_started_at: row?.cycle_started_at || null,
    all_staff_offline_at: row?.all_staff_offline_at || null,
  });
});

router.get('/recipients', (req, res) => {
  const me = String(req.user.id || '').trim();
  const rows = queryAll(
    `SELECT id, username, full_name, role FROM users
     WHERE is_active = 1 AND id != ?
       AND lower(trim(coalesce(role, ''))) IN ('admin','cajero','mozo','cocina','bar','delivery','produccion')
     ORDER BY full_name COLLATE NOCASE`,
    [me]
  );
  res.json(rows || []);
});

router.get('/messages', (req, res) => {
  advanceStaffChatCycleIfDue();
  const cycleId = getCurrentCycleId();
  const mode = String(req.query.mode || 'group').toLowerCase();
  const me = String(req.user.id || '').trim();

  if (mode === 'group') {
    const rows = queryAll(
      `SELECT m.id, m.cycle_id, m.sender_id, m.recipient_id, m.body, m.created_at,
              u.full_name AS sender_name, u.username AS sender_username
       FROM staff_internal_messages m
       LEFT JOIN users u ON u.id = m.sender_id
       WHERE m.cycle_id = ? AND m.recipient_id IS NULL
       ORDER BY datetime(m.created_at) ASC
       LIMIT 500`,
      [cycleId]
    );
    return res.json({ cycle_id: cycleId, messages: rows || [] });
  }

  const other = String(req.query.with_user || '').trim();
  if (!other) {
    return res.status(400).json({ error: 'Indique el usuario para el chat privado' });
  }
  const rows = queryAll(
    `SELECT m.id, m.cycle_id, m.sender_id, m.recipient_id, m.body, m.created_at,
            u.full_name AS sender_name, u.username AS sender_username
     FROM staff_internal_messages m
     LEFT JOIN users u ON u.id = m.sender_id
     WHERE m.cycle_id = ?
       AND m.recipient_id IS NOT NULL
       AND (
         (m.sender_id = ? AND m.recipient_id = ?)
         OR (m.sender_id = ? AND m.recipient_id = ?)
       )
     ORDER BY datetime(m.created_at) ASC
     LIMIT 500`,
    [cycleId, me, other, other, me]
  );
  res.json({ cycle_id: cycleId, messages: rows || [], with_user: other });
});

router.post('/messages', (req, res) => {
  advanceStaffChatCycleIfDue();
  const cycleId = getCurrentCycleId();
  const me = String(req.user.id || '').trim();
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'El mensaje no puede estar vacío' });
  if (body.length > MAX_BODY) return res.status(400).json({ error: `Máximo ${MAX_BODY} caracteres` });

  const recipientRaw = req.body?.recipient_id;
  let recipientId = null;
  if (recipientRaw != null && String(recipientRaw).trim() !== '') {
    recipientId = String(recipientRaw).trim();
    if (recipientId === me) return res.status(400).json({ error: 'No puede enviarse un mensaje privado a sí mismo' });
    const peer = queryOne('SELECT id FROM users WHERE id = ? AND is_active = 1', [recipientId]);
    if (!peer) return res.status(400).json({ error: 'Usuario destino no válido' });
  }

  const id = uuidv4();
  runSql(
    `INSERT INTO staff_internal_messages (id, cycle_id, sender_id, recipient_id, body, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    [id, cycleId, me, recipientId, body]
  );

  const row = queryOne(
    `SELECT m.id, m.cycle_id, m.sender_id, m.recipient_id, m.body, m.created_at,
            u.full_name AS sender_name, u.username AS sender_username
     FROM staff_internal_messages m
     LEFT JOIN users u ON u.id = m.sender_id
     WHERE m.id = ?`,
    [id]
  );

  const io = req.app.get('io');
  if (io && row) {
    const payload = { ...row, scope: recipientId ? 'private' : 'group' };
    if (!recipientId) {
      io.to('staff-broadcast').emit('staff-chat-message', payload);
    } else {
      io.to(`staff-${recipientId}`).emit('staff-chat-message', payload);
      io.to(`staff-${me}`).emit('staff-chat-message', payload);
    }
  }

  res.status(201).json(row);
});

module.exports = router;
