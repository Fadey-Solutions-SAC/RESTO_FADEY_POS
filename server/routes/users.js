const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, runSql } = require('../database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { getActiveCajaById, getFirstAutoAssignCajaId } = require('../cajaSettings');
const {
  rawWorkedMinutesExpr,
  effectiveWorkedMinutesExpr,
} = require('../lib/workSessionSql');
const { buildAnalyticsBundle } = require('../services/workProductivityService');
const {
  queryAggregatedJornadas,
  queryDeviceSessions,
  summarizeJornadas,
  parseDateKey,
  ensureOpenWorkSession,
} = require('../services/workSessionService');

const router = express.Router();
const VALID_ROLES = new Set(['admin', 'cajero', 'mozo', 'cocina', 'bar', 'delivery']);
const MODULE_IDS = [
  'escritorio', 'ventas', 'caja', 'mesas', 'reservas', 'auto_pedido', 'creditos', 'clientes',
  'productos', 'ofertas', 'descuentos', 'almacen', 'delivery', 'informes',
  'indicadores', 'mi_restaurant', 'configuracion', 'cocina', 'bar', 'tiempo_trabajado',
];
function isPermissionEnabled(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

const FINAL_ATTENDANCE = new Set(['asistente', 'justificado', 'ausente']);

function createEmptyPermissions() {
  return MODULE_IDS.reduce((acc, id) => {
    acc[id] = false;
    return acc;
  }, {});
}

function createFullPermissions() {
  return MODULE_IDS.reduce((acc, id) => {
    acc[id] = true;
    return acc;
  }, {});
}

function countCajerosExcluding(excludeUserId) {
  const ex = String(excludeUserId || '').trim();
  if (!ex) {
    return queryOne(`SELECT COUNT(*) as c FROM users WHERE lower(trim(coalesce(role, ''))) = 'cajero'`);
  }
  return queryOne(
    `SELECT COUNT(*) as c FROM users WHERE lower(trim(coalesce(role, ''))) = 'cajero' AND id != ?`,
    [ex]
  );
}

function normalizeCajaStationId(role, rawCajaId, { excludeUserId = '' } = {}) {
  const roleLc = String(role || '').trim().toLowerCase();
  if (roleLc !== 'cajero') return { caja_station_id: '' };
  let id = String(rawCajaId ?? '').trim();
  const exclude = String(excludeUserId || '').trim();
  const otherCajeros = Number(countCajerosExcluding(exclude)?.c || 0);

  if (!id) {
    if (otherCajeros === 0) {
      id = getFirstAutoAssignCajaId() || '';
      if (!id) {
        return { error: 'Debe existir al menos una caja activa en Configuración → Cajas.' };
      }
    } else {
      return { error: 'Seleccione la caja para este cajero' };
    }
  }
  if (!getActiveCajaById(id)) {
    return { error: 'La caja no existe o está inactiva. Créela o actívela en Configuración → Cajas.' };
  }
  const taken = queryOne(
    `SELECT id, full_name FROM users
     WHERE lower(trim(coalesce(role, ''))) = 'cajero'
       AND trim(coalesce(caja_station_id, '')) = ?
       AND id != ?
     LIMIT 1`,
    [id, exclude]
  );
  if (taken?.id) {
    return { error: `Esa caja ya está asignada a ${taken.full_name || 'otro cajero'}` };
  }
  return { caja_station_id: id };
}

router.get('/', authenticateToken, requireRole('admin'), (req, res) => {
  res.json(
    queryAll(
      `SELECT id, username, email, full_name, role, is_active, phone, avatar, caja_station_id,
        payroll_pay_mode, payroll_amount, payroll_schedule_note, payroll_payment_day, created_at
       FROM users ORDER BY created_at DESC`
    )
  );
});

router.post('/', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const username = String(req.body?.username || '').trim();
    const email = String(req.body?.email || '').trim();
    const password = String(req.body?.password || '');
    const fullName = String(req.body?.full_name || '').trim();
    const role = String(req.body?.role || '').trim().toLowerCase();
    const phone = String(req.body?.phone || '').trim();
    const isActive = req.body?.is_active === undefined ? 1 : (Number(req.body.is_active || 0) === 1 ? 1 : 0);
    if (!username || !email || !password || !fullName || !role) {
      return res.status(400).json({ error: 'Todos los campos son requeridos' });
    }
    if (!VALID_ROLES.has(role)) {
      return res.status(400).json({ error: 'Rol inválido' });
    }
    const existing = queryOne('SELECT id FROM users WHERE username = ? OR email = ?', [username, email]);
    if (existing) return res.status(400).json({ error: 'El usuario o email ya existe' });

    const cajaNorm = normalizeCajaStationId(role, req.body?.caja_station_id, { excludeUserId: '' });
    if (cajaNorm.error) return res.status(400).json({ error: cajaNorm.error });
    const cajaStationId = cajaNorm.caja_station_id;

    const restaurant = queryOne('SELECT id FROM restaurants LIMIT 1');
    const id = uuidv4();
    const hash = bcrypt.hashSync(password, 10);
    runSql(
      'INSERT INTO users (id, username, email, password_hash, full_name, role, restaurant_id, phone, is_active, caja_station_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, username, email, hash, fullName, role, restaurant?.id, phone, isActive, cajaStationId]
    );
    const permissionsObj =
      req.user?.role === 'master_admin' && role === 'admin'
        ? createFullPermissions()
        : createEmptyPermissions();
    runSql(
      'INSERT INTO user_permissions (id, user_id, permissions) VALUES (?, ?, ?)',
      [uuidv4(), id, JSON.stringify(permissionsObj)]
    );
    return res.status(201).json(
      queryOne(
        'SELECT id, username, email, full_name, role, is_active, phone, caja_station_id, created_at FROM users WHERE id = ?',
        [id]
      )
    );
  } catch (err) {
    return res.status(400).json({ error: err.message || 'No se pudo crear el usuario' });
  }
});

router.put('/:id', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const current = queryOne(
      'SELECT id, username, email, full_name, role, phone, is_active, caja_station_id FROM users WHERE id = ?',
      [req.params.id]
    );
    if (!current?.id) return res.status(404).json({ error: 'Usuario no encontrado' });

    const username = req.body?.username === undefined ? current.username : String(req.body.username || '').trim();
    const email = req.body?.email === undefined ? current.email : String(req.body.email || '').trim();
    const fullName = req.body?.full_name === undefined ? current.full_name : String(req.body.full_name || '').trim();
    const role = req.body?.role === undefined ? current.role : String(req.body.role || '').trim().toLowerCase();
    const phone = req.body?.phone === undefined ? current.phone : String(req.body.phone || '').trim();
    const isActive = req.body?.is_active === undefined ? current.is_active : (Number(req.body.is_active || 0) === 1 ? 1 : 0);
    const password = String(req.body?.password || '').trim();
    const rawCaja =
      req.body?.caja_station_id === undefined ? current.caja_station_id : req.body.caja_station_id;

    if (!username || !email || !fullName || !role) {
      return res.status(400).json({ error: 'Usuario, email, nombre y rol son obligatorios' });
    }
    if (!VALID_ROLES.has(role)) {
      return res.status(400).json({ error: 'Rol inválido' });
    }

    const duplicated = queryOne(
      'SELECT id FROM users WHERE (username = ? OR email = ?) AND id != ? LIMIT 1',
      [username, email, req.params.id]
    );
    if (duplicated?.id) {
      return res.status(400).json({ error: 'El usuario o email ya está en uso por otro registro' });
    }

    if (password) {
      const hash = bcrypt.hashSync(password, 10);
      runSql('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.params.id]);
    }

    const cajaNorm = normalizeCajaStationId(role, rawCaja, { excludeUserId: req.params.id });
    if (cajaNorm.error) return res.status(400).json({ error: cajaNorm.error });
    const cajaStationId = cajaNorm.caja_station_id;

    runSql(
      'UPDATE users SET username = ?, email = ?, full_name = ?, role = ?, phone = ?, is_active = ?, caja_station_id = ? WHERE id = ?',
      [username, email, fullName, role, phone, isActive, cajaStationId, req.params.id]
    );

    const payrollPatch = {};
    if (req.body?.payroll_pay_mode !== undefined) {
      const m = String(req.body.payroll_pay_mode || '').trim().toLowerCase();
      if (!['', 'hora', 'jornada'].includes(m)) {
        return res.status(400).json({ error: 'Modo de nómina inválido (hora o jornada)' });
      }
      payrollPatch.payroll_pay_mode = m;
    }
    if (req.body?.payroll_amount !== undefined) {
      const pa = Number(req.body.payroll_amount);
      if (!Number.isFinite(pa) || pa < 0) {
        return res.status(400).json({ error: 'Monto de nómina inválido' });
      }
      payrollPatch.payroll_amount = pa;
    }
    if (req.body?.payroll_schedule_note !== undefined) {
      payrollPatch.payroll_schedule_note = String(req.body.payroll_schedule_note || '');
    }
    if (req.body?.payroll_payment_day !== undefined) {
      const d = parseInt(req.body.payroll_payment_day, 10);
      if (!Number.isFinite(d) || d < 0 || d > 31) {
        return res.status(400).json({ error: 'Día de pago inválido (0–31)' });
      }
      payrollPatch.payroll_payment_day = d;
    }
    if (Object.keys(payrollPatch).length) {
      const cols = Object.keys(payrollPatch);
      runSql(
        `UPDATE users SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
        [...cols.map((c) => payrollPatch[c]), req.params.id]
      );
    }

    return res.json(
      queryOne(
        `SELECT id, username, email, full_name, role, is_active, phone, caja_station_id,
          payroll_pay_mode, payroll_amount, payroll_schedule_note, payroll_payment_day, created_at
         FROM users WHERE id = ?`,
        [req.params.id]
      )
    );
  } catch (err) {
    return res.status(400).json({ error: err.message || 'No se pudo actualizar el usuario' });
  }
});

router.post('/:id/payroll-investment', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const user = queryOne(
      'SELECT id, full_name, payroll_pay_mode, payroll_amount FROM users WHERE id = ?',
      [req.params.id]
    );
    if (!user?.id) return res.status(404).json({ error: 'Usuario no encontrado' });
    const mode = String(user.payroll_pay_mode || '').toLowerCase();
    let amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      if (mode === 'hora') {
        const hours = Number(req.body?.hours);
        const rate = Number(user.payroll_amount || 0);
        if (!Number.isFinite(hours) || hours <= 0) {
          return res.status(400).json({ error: 'Indica las horas trabajadas para pago por hora' });
        }
        if (!Number.isFinite(rate) || rate <= 0) {
          return res.status(400).json({ error: 'Define la tarifa por hora en el perfil del usuario' });
        }
        amount = Math.round(hours * rate * 100) / 100;
      } else {
        amount = Math.round(Number(user.payroll_amount || 0) * 100) / 100;
      }
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'El monto de nómina debe ser mayor a cero' });
    }
    const concept = String(req.body?.concept || '').trim() || `Nómina: ${user.full_name || 'personal'}`.trim();
    const id = uuidv4();
    runSql(
      `INSERT INTO investment_movements (id, amount, concept, user_id, source, created_at)
       VALUES (?, ?, ?, ?, 'payroll', datetime('now'))`,
      [id, amount, concept, user.id]
    );
    const row = queryOne('SELECT * FROM investment_movements WHERE id = ?', [id]);
    res.status(201).json(row);
  } catch (err) {
    res.status(400).json({ error: err.message || 'No se pudo registrar el pago' });
  }
});

router.delete('/:id', authenticateToken, requireRole('admin'), (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
  runSql('DELETE FROM user_permissions WHERE user_id = ?', [req.params.id]);
  runSql('DELETE FROM users WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

/** Panel de productividad, alertas, rankings e IA operativa (extiende Tiempo trabajado). */
router.get('/work-analytics', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    ensureOpenWorkSession(req.user);
    res.json(buildAnalyticsBundle(req.query || {}));
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudo cargar analítica laboral' });
  }
});

router.get('/work-sessions', authenticateToken, requireRole('admin'), (req, res) => {
  ensureOpenWorkSession(req.user);
  const from = parseDateKey(req.query?.from);
  const to = parseDateKey(req.query?.to);
  const userId = String(req.query?.user_id || '').trim();

  const jornadas = queryAggregatedJornadas({ from, to, userId });
  const deviceSessions = queryDeviceSessions({ from, to, userId });
  const summary = summarizeJornadas(jornadas);

  res.json({
    filters: { from, to, user_id: userId || 'all' },
    jornadas,
    device_sessions: deviceSessions,
    sessions: jornadas,
    summary,
  });
});

router.get('/work-sessions/:sessionId/photos', authenticateToken, requireRole('admin'), (req, res) => {
  const sessionId = String(req.params.sessionId || '').trim();
  if (!sessionId) return res.status(400).json({ error: 'Sesión inválida' });
  const row = queryOne(
    'SELECT photo_login, photo_logout FROM user_work_sessions WHERE id = ? LIMIT 1',
    [sessionId]
  );
  if (!row) return res.status(404).json({ error: 'Sesión no encontrada' });
  res.json({
    photo_login: row.photo_login || null,
    photo_logout: row.photo_logout || null,
  });
});

/** Galería del día actual (hora local del servidor) por usuario. */
router.get('/attendance-gallery/:userId', authenticateToken, requireRole('admin'), (req, res) => {
  const userId = String(req.params.userId || '').trim();
  if (!userId) return res.status(400).json({ error: 'Usuario requerido' });
  const target = queryOne('SELECT id FROM users WHERE id = ?', [userId]);
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
  const day = parseDateKey(req.query?.date) || null;
  const dayFilter = day
    ? 'date(datetime(s.login_at, \'localtime\')) = date(?)'
    : "date(datetime(s.login_at, 'localtime')) = date('now', 'localtime')";
  const params = day ? [userId, day] : [userId];
  const sessions = queryAll(
    `SELECT s.id, s.login_at, s.logout_at, s.photo_login, s.photo_logout,
            COALESCE(s.attendance_status, 'pending') AS attendance_status
     FROM user_work_sessions s
     WHERE s.user_id = ? AND ${dayFilter}
     ORDER BY datetime(s.login_at) DESC
     LIMIT 50`,
    params
  );
  res.json({ sessions: sessions || [], date: day || 'today' });
});

/** Sesiones del día con asistencia pendiente de clasificar (solo admin). */
router.get('/attendance-review/today', authenticateToken, requireRole('admin'), (req, res) => {
  const rows = queryAll(
    `SELECT s.id, s.user_id, s.login_at, s.logout_at,
            COALESCE(s.attendance_status, 'pending') AS attendance_status,
            ${rawWorkedMinutesExpr('s')} AS raw_worked_minutes,
            COALESCE(NULLIF(u.full_name, ''), s.full_name) AS full_name,
            COALESCE(NULLIF(u.username, ''), s.username) AS username,
            COALESCE(NULLIF(u.role, ''), s.role) AS role
     FROM user_work_sessions s
     LEFT JOIN users u ON u.id = s.user_id
     WHERE date(datetime(s.login_at, 'localtime')) = date('now', 'localtime')
       AND COALESCE(s.attendance_status, 'pending') = 'pending'
       AND COALESCE(s.session_kind, 'jornada') = 'jornada'
       AND lower(coalesce(nullif(u.role, ''), nullif(s.role, ''), '')) != 'admin'
     ORDER BY datetime(s.login_at) ASC`
  );
  res.json({
    pending: rows || [],
    complete: !rows || rows.length === 0,
  });
});

/** Aplicar estado de asistencia por sesión (cualquier día, solo si sigue pendiente). */
router.post('/attendance-review/apply', authenticateToken, requireRole('admin'), (req, res) => {
  const items = req.body?.items;
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'Debe enviar items: [{ session_id, status }]' });
  }
  let n = 0;
  for (const it of items) {
    const sid = String(it.session_id || it.id || '').trim();
    const status = String(it.status || '').trim();
    if (!sid || !FINAL_ATTENDANCE.has(status)) continue;
    const row = queryOne(
      `SELECT s.id FROM user_work_sessions s
       LEFT JOIN users u ON u.id = s.user_id
       WHERE s.id = ?
         AND COALESCE(NULLIF(trim(s.attendance_status), ''), 'pending') = 'pending'
         AND lower(coalesce(nullif(u.role, ''), nullif(s.role, ''), '')) != 'admin'`,
      [sid]
    );
    if (!row?.id) continue;
    runSql(
      `UPDATE user_work_sessions SET attendance_status = ?, updated_at = datetime('now') WHERE id = ?`,
      [status, sid]
    );
    n += 1;
  }
  res.json({ success: true, updated: n });
});

/** Clasificar una jornada concreta (pendiente → asistente / justificado / ausente). No aplica al administrador. */
router.patch('/work-sessions/:sessionId/attendance', authenticateToken, requireRole('admin'), (req, res) => {
  const sessionId = String(req.params.sessionId || '').trim();
  const status = String(req.body?.status || '').trim();
  if (!sessionId || !FINAL_ATTENDANCE.has(status)) {
    return res.status(400).json({ error: 'Sesión o estado inválido' });
  }
  const row = queryOne(
    `SELECT s.id FROM user_work_sessions s
     LEFT JOIN users u ON u.id = s.user_id
     WHERE s.id = ?
       AND COALESCE(NULLIF(trim(s.attendance_status), ''), 'pending') = 'pending'
       AND lower(coalesce(nullif(u.role, ''), nullif(s.role, ''), '')) != 'admin'`,
    [sessionId]
  );
  if (!row?.id) {
    return res.status(404).json({ error: 'Sesión no encontrada, ya clasificada o es de un administrador (no requiere clasificación)' });
  }
  runSql(
    `UPDATE user_work_sessions SET attendance_status = ?, updated_at = datetime('now') WHERE id = ?`,
    [status, sessionId]
  );
  res.json({ success: true });
});

router.get('/:id/permissions', authenticateToken, requireRole('admin'), (req, res) => {
  const row = queryOne('SELECT permissions FROM user_permissions WHERE user_id = ?', [req.params.id]);
  const parsed = row ? JSON.parse(row.permissions || '{}') : {};
  const permissions = MODULE_IDS.reduce((acc, id) => {
    acc[id] = isPermissionEnabled(parsed[id]);
    return acc;
  }, {});
  res.json(permissions);
});

router.put('/:id/permissions', authenticateToken, requireRole('admin'), (req, res) => {
  const { permissions } = req.body;
  if (!permissions || typeof permissions !== 'object') return res.status(400).json({ error: 'Permisos inválidos' });
  const normalized = MODULE_IDS.reduce((acc, id) => {
    acc[id] = isPermissionEnabled(permissions[id]);
    return acc;
  }, {});
  const existing = queryOne('SELECT id FROM user_permissions WHERE user_id = ?', [req.params.id]);
  const json = JSON.stringify(normalized);
  if (existing) {
    runSql("UPDATE user_permissions SET permissions = ?, updated_at = datetime('now') WHERE user_id = ?", [json, req.params.id]);
  } else {
    runSql('INSERT INTO user_permissions (id, user_id, permissions) VALUES (?, ?, ?)', [uuidv4(), req.params.id, json]);
  }
  res.json({ success: true, permissions: normalized });
});

module.exports = router;
