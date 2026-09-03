const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, runSql, logAudit } = require('../database');
const { getRawUserPermissionsJson } = require('../lib/cajaPermissions');
const { isPermissionEnabled } = require('../planModuleCatalog');
const calc = require('./hrAttendanceCalc');
const { ensureHrSchema } = require('../utils/ensureHrSchema');

const EMP_STATUSES = new Set(['active', 'inactive', 'suspended']);
const LEAVE_TYPES = new Set(['personal', 'medico', 'comision', 'vacaciones', 'descanso', 'otro']);
const LEAVE_STATUSES = new Set(['pending', 'approved', 'rejected']);
const DOUBLE_SCAN_SECONDS = 25;
const HR_SETTINGS_KEY = 'hr_settings';

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function newPlainToken() {
  return crypto.randomBytes(16).toString('base64url');
}

function aesKey() {
  const secret = process.env.JWT_SECRET || process.env.HR_TOKEN_SECRET || 'resto-fadey-hr';
  return crypto.createHash('sha256').update(String(secret), 'utf8').digest();
}

function encryptToken(token) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey(), iv);
  const enc = Buffer.concat([cipher.update(String(token), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptToken(cipherText) {
  const raw = String(cipherText || '').trim();
  if (!raw) return '';
  try {
    const buf = Buffer.from(raw, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

function qrPayload(token) {
  return `RFHR:${token}`;
}

async function renderQrPng(payload) {
  const QRCode = require('qrcode');
  return QRCode.toBuffer(String(payload), {
    type: 'png',
    width: 512,
    margin: 2,
    errorCorrectionLevel: 'M',
  });
}

function defaultHrSettings() {
  return {
    require_branch_match: true,
    geofence_enabled: false,
    allow_attendance_without_gps: true,
    geofence_radius_m: 250,
    /** 1 = jornada por QR (hr_attendance); 0 = cuenta login→logout (user_work_sessions). */
    asistencia_qr_activa: 1,
  };
}

function isFlagOn(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

/** Si la clave no existe aún, se considera activa (comportamiento actual). */
function isAsistenciaQrActiva() {
  const s = getHrSettings();
  if (!Object.prototype.hasOwnProperty.call(s, 'asistencia_qr_activa')) return true;
  return isFlagOn(s.asistencia_qr_activa);
}

function setAsistenciaQrActiva(active, actor) {
  return saveHrSettings({ asistencia_qr_activa: active ? 1 : 0 }, actor);
}

function getHrSettings() {
  const row = queryOne('SELECT value FROM app_settings WHERE key = ?', [HR_SETTINGS_KEY]);
  if (!row?.value) return defaultHrSettings();
  try {
    return { ...defaultHrSettings(), ...JSON.parse(row.value) };
  } catch {
    return defaultHrSettings();
  }
}

function saveHrSettings(patch, actor) {
  const next = { ...getHrSettings(), ...(patch || {}) };
  const existing = queryOne('SELECT key FROM app_settings WHERE key = ?', [HR_SETTINGS_KEY]);
  const json = JSON.stringify(next);
  if (existing) runSql('UPDATE app_settings SET value = ?, updated_at = datetime(\'now\') WHERE key = ?', [json, HR_SETTINGS_KEY]);
  else runSql('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime(\'now\'))', [HR_SETTINGS_KEY, json]);
  logAudit({
    actorUserId: actor?.id,
    actorName: actor?.full_name || actor?.username,
    action: 'hr.settings.update',
    resourceType: 'hr_settings',
    details: next,
  });
  return next;
}

function restaurantIdOf(user) {
  if (user?.restaurant_id) return String(user.restaurant_id);
  const row = user?.id ? queryOne('SELECT restaurant_id FROM users WHERE id = ?', [user.id]) : null;
  if (row?.restaurant_id) return String(row.restaurant_id);
  const r = queryOne('SELECT id FROM restaurants LIMIT 1');
  return String(r?.id || '');
}

function isHrAdmin(user) {
  const role = String(user?.role || '').toLowerCase();
  if (role === 'admin' || role === 'master_admin') return true;
  const perms = getRawUserPermissionsJson(user?.id);
  return isPermissionEnabled(perms.tiempo_trabajado);
}

function parseDays(raw) {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v.map(Number).filter((n) => n >= 0 && n <= 6) : [0, 1, 2, 3, 4, 5];
  } catch {
    return [0, 1, 2, 3, 4, 5];
  }
}

function listBranches(restaurantId) {
  const row = queryOne("SELECT value FROM app_settings WHERE key = 'settings'");
  let settings = {};
  try {
    settings = row?.value ? JSON.parse(row.value) : {};
  } catch {
    settings = {};
  }
  const locales = Array.isArray(settings.locales) ? settings.locales : [];
  if (!locales.length) {
    return [{ id: 'principal', name: 'Principal', active: true, restaurant_id: restaurantId }];
  }
  return locales.map((l, i) => ({
    id: String(l.id || '').trim() || `locale_${i}`,
    name: String(l.name || '').trim() || `Local ${i + 1}`,
    active: Number(l.active ?? 1) === 1,
    restaurant_id: restaurantId,
  }));
}

function clientIp(req) {
  const xf = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || String(req?.ip || req?.socket?.remoteAddress || '').replace(/^::ffff:/, '');
}

function ensureDefaultSchedule(restaurantId) {
  const existing = queryOne('SELECT id FROM hr_schedules WHERE restaurant_id = ? ORDER BY created_at ASC LIMIT 1', [restaurantId]);
  if (existing?.id) return existing.id;
  const id = uuidv4();
  runSql(
    `INSERT INTO hr_schedules (id, restaurant_id, name, start_time, end_time, tolerance_in_minutes, tolerance_out_minutes, break_minutes, work_days, max_hours)
     VALUES (?, ?, ?, '08:00', '17:00', 10, 10, 60, ?, 8)`,
    [id, restaurantId, 'Horario restaurante', JSON.stringify([0, 1, 2, 3, 4, 5])]
  );
  return id;
}

function syncEmployeesFromUsers(restaurantId) {
  ensureHrSchema();
  const defaultSchedule = ensureDefaultSchedule(restaurantId);
  const users = queryAll(
    `SELECT id, full_name, role, phone, is_active, restaurant_id FROM users
     WHERE restaurant_id = ?
        OR (IFNULL(trim(restaurant_id), '') = '' AND IFNULL(?, '') != '')`,
    [restaurantId, restaurantId]
  );
  const branches = listBranches(restaurantId);
  const defaultBranch = branches[0]?.id || 'principal';
  for (const u of users || []) {
    const found = queryOne('SELECT id, status FROM hr_employees WHERE user_id = ?', [u.id]);
    if (found?.id) continue;
    const id = uuidv4();
    const active = Number(u.is_active || 0) === 1;
    runSql(
      `INSERT INTO hr_employees (id, user_id, restaurant_id, branch_id, employee_code, position, department, status, schedule_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        u.id,
        restaurantId,
        defaultBranch,
        String(u.role || '').toUpperCase(),
        String(u.role || ''),
        '',
        active ? 'active' : 'inactive',
        defaultSchedule,
      ]
    );
  }
}

function employeePublic(row, extra = {}) {
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    restaurant_id: row.restaurant_id,
    full_name: row.full_name,
    username: row.username,
    role: row.role,
    phone: row.phone || '',
    document_id: row.document_id || '',
    position: row.position || '',
    department: row.department || '',
    branch_id: row.branch_id || '',
    hire_date: row.hire_date || '',
    contract_type: row.contract_type || 'planilla',
    status: row.status,
    schedule_id: row.schedule_id || '',
    schedule_name: row.schedule_name || '',
    employee_code: row.employee_code || '',
    photo_url: row.photo_url || '',
    user_active: Number(row.user_active ?? row.is_active ?? 1) === 1,
    qr_active: Number(row.qr_active || 0) === 1,
    ...extra,
  };
}

function listEmployees(restaurantId, { q = '', status = '', branch_id = '' } = {}) {
  syncEmployeesFromUsers(restaurantId);
  const params = [restaurantId];
  let where = 'e.restaurant_id = ?';
  if (status) {
    where += ' AND e.status = ?';
    params.push(status);
  }
  if (branch_id) {
    where += ' AND e.branch_id = ?';
    params.push(branch_id);
  }
  if (q) {
    where += ' AND (u.full_name LIKE ? OR u.username LIKE ? OR IFNULL(e.document_id,\'\') LIKE ? OR IFNULL(e.position,\'\') LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  const rows = queryAll(
    `SELECT e.*, u.full_name, u.username, u.role, u.phone, u.is_active AS user_active,
            s.name AS schedule_name,
            (SELECT MAX(c.active) FROM hr_qr_credentials c WHERE c.employee_id = e.id) AS qr_active
     FROM hr_employees e
     JOIN users u ON u.id = e.user_id
     LEFT JOIN hr_schedules s ON s.id = e.schedule_id
     WHERE ${where}
     ORDER BY u.full_name COLLATE NOCASE ASC`,
    params
  );
  return (rows || []).map((r) => employeePublic(r));
}

function getEmployee(restaurantId, employeeId) {
  const row = queryOne(
    `SELECT e.*, u.full_name, u.username, u.role, u.phone, u.is_active AS user_active, s.name AS schedule_name,
            (SELECT MAX(c.active) FROM hr_qr_credentials c WHERE c.employee_id = e.id) AS qr_active
     FROM hr_employees e
     JOIN users u ON u.id = e.user_id
     LEFT JOIN hr_schedules s ON s.id = e.schedule_id
     WHERE e.id = ? AND e.restaurant_id = ?`,
    [employeeId, restaurantId]
  );
  return employeePublic(row);
}

function employeeByUser(restaurantId, userId) {
  syncEmployeesFromUsers(restaurantId);
  const row = queryOne(
    `SELECT e.*, u.full_name, u.username, u.role, u.phone, u.is_active AS user_active, s.name AS schedule_name
     FROM hr_employees e
     JOIN users u ON u.id = e.user_id
     LEFT JOIN hr_schedules s ON s.id = e.schedule_id
     WHERE e.user_id = ? AND e.restaurant_id = ?`,
    [userId, restaurantId]
  );
  return employeePublic(row);
}

function updateEmployee(restaurantId, employeeId, patch, actor) {
  const cur = queryOne('SELECT * FROM hr_employees WHERE id = ? AND restaurant_id = ?', [employeeId, restaurantId]);
  if (!cur) {
    const err = new Error('Trabajador no encontrado');
    err.status = 404;
    throw err;
  }
  const status = patch.status != null ? String(patch.status) : cur.status;
  if (!EMP_STATUSES.has(status)) {
    const err = new Error('Estado inválido');
    err.status = 400;
    throw err;
  }
  if (status !== 'active') revokeEmployeeQr(employeeId);
  runSql(
    `UPDATE hr_employees SET
      document_id = ?, position = ?, department = ?, branch_id = ?, hire_date = ?,
      contract_type = ?, status = ?, schedule_id = ?, employee_code = ?, photo_url = ?,
      updated_at = datetime('now')
     WHERE id = ?`,
    [
      patch.document_id != null ? String(patch.document_id).trim() : cur.document_id,
      patch.position != null ? String(patch.position).trim() : cur.position,
      patch.department != null ? String(patch.department).trim() : cur.department,
      patch.branch_id != null ? String(patch.branch_id).trim() : cur.branch_id,
      patch.hire_date != null ? String(patch.hire_date).trim() : cur.hire_date,
      patch.contract_type != null ? String(patch.contract_type).trim() : cur.contract_type,
      status,
      patch.schedule_id != null ? String(patch.schedule_id).trim() : cur.schedule_id,
      patch.employee_code != null ? String(patch.employee_code).trim() : cur.employee_code,
      patch.photo_url != null ? String(patch.photo_url).trim() : cur.photo_url,
      employeeId,
    ]
  );
  logAudit({
    actorUserId: actor?.id,
    actorName: actor?.full_name || actor?.username,
    action: 'hr.employee.update',
    resourceType: 'hr_employees',
    resourceId: employeeId,
    details: patch,
  });
  return getEmployee(restaurantId, employeeId);
}

function listSchedules(restaurantId) {
  ensureDefaultSchedule(restaurantId);
  return queryAll('SELECT * FROM hr_schedules WHERE restaurant_id = ? ORDER BY name COLLATE NOCASE', [restaurantId]) || [];
}

function saveSchedule(restaurantId, body, id = '') {
  const name = String(body?.name || '').trim();
  if (!name) {
    const err = new Error('El nombre del horario es obligatorio');
    err.status = 400;
    throw err;
  }
  const days = Array.isArray(body.work_days) ? body.work_days : parseDays(body.work_days);
  const payload = [
    name,
    String(body.start_time || '08:00').slice(0, 5),
    String(body.end_time || '17:00').slice(0, 5),
    Math.max(0, Number(body.tolerance_in_minutes ?? 10) || 0),
    Math.max(0, Number(body.tolerance_out_minutes ?? 10) || 0),
    Math.max(0, Number(body.break_minutes ?? 60) || 0),
    JSON.stringify(days),
    Number(body.max_hours ?? 8) || 8,
    body.overtime_after_minutes == null || body.overtime_after_minutes === ''
      ? null
      : Number(body.overtime_after_minutes),
  ];
  if (id) {
    const cur = queryOne('SELECT id FROM hr_schedules WHERE id = ? AND restaurant_id = ?', [id, restaurantId]);
    if (!cur) {
      const err = new Error('Horario no encontrado');
      err.status = 404;
      throw err;
    }
    runSql(
      `UPDATE hr_schedules SET name=?, start_time=?, end_time=?, tolerance_in_minutes=?, tolerance_out_minutes=?,
        break_minutes=?, work_days=?, max_hours=?, overtime_after_minutes=?, updated_at=datetime('now')
       WHERE id=?`,
      [...payload, id]
    );
    return queryOne('SELECT * FROM hr_schedules WHERE id = ?', [id]);
  }
  const nid = uuidv4();
  runSql(
    `INSERT INTO hr_schedules (id, restaurant_id, name, start_time, end_time, tolerance_in_minutes, tolerance_out_minutes, break_minutes, work_days, max_hours, overtime_after_minutes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [nid, restaurantId, ...payload]
  );
  return queryOne('SELECT * FROM hr_schedules WHERE id = ?', [nid]);
}

function assignSchedule({ restaurantId, scheduleId, employeeIds = [], department = '' }) {
  const sch = queryOne('SELECT id FROM hr_schedules WHERE id = ? AND restaurant_id = ?', [scheduleId, restaurantId]);
  if (!sch) {
    const err = new Error('Horario no encontrado');
    err.status = 404;
    throw err;
  }
  if (department) {
    runSql('UPDATE hr_employees SET schedule_id = ?, updated_at = datetime(\'now\') WHERE restaurant_id = ? AND department = ?', [
      scheduleId, restaurantId, department,
    ]);
  }
  for (const eid of employeeIds || []) {
    runSql('UPDATE hr_employees SET schedule_id = ?, updated_at = datetime(\'now\') WHERE id = ? AND restaurant_id = ?', [
      scheduleId, String(eid), restaurantId,
    ]);
  }
  return { ok: true };
}

function revokeEmployeeQr(employeeId) {
  runSql(
    `UPDATE hr_qr_credentials SET active = 0, revoked_at = datetime('now') WHERE employee_id = ? AND active = 1`,
    [employeeId]
  );
}

function issueQr(restaurantId, employeeId, actor) {
  const emp = getEmployee(restaurantId, employeeId);
  if (!emp) {
    const err = new Error('Trabajador no encontrado');
    err.status = 404;
    throw err;
  }
  if (emp.status !== 'active' || !emp.user_active) {
    const err = new Error('Solo se genera QR para trabajadores activos');
    err.status = 400;
    throw err;
  }
  revokeEmployeeQr(employeeId);
  const token = newPlainToken();
  runSql(
    `INSERT INTO hr_qr_credentials (id, employee_id, token_hash, active, token_cipher) VALUES (?, ?, ?, 1, ?)`,
    [uuidv4(), employeeId, hashToken(token), encryptToken(token)]
  );
  logAudit({
    actorUserId: actor?.id,
    actorName: actor?.full_name || actor?.username,
    action: 'hr.qr.issue',
    resourceType: 'hr_qr_credentials',
    resourceId: employeeId,
  });
  return {
    token,
    payload: qrPayload(token),
    employee: emp,
    active: true,
  };
}

async function qrBundle(restaurantId, employeeId) {
  const status = qrStatus(restaurantId, employeeId);
  if (!status) return null;
  const row = queryOne(
    `SELECT token_cipher, active FROM hr_qr_credentials WHERE employee_id = ? ORDER BY created_at DESC LIMIT 1`,
    [employeeId]
  );
  const token = Number(row?.active || 0) === 1 ? decryptToken(row?.token_cipher) : '';
  const payload = token ? qrPayload(token) : '';
  let png_base64 = '';
  if (payload) {
    try {
      const buf = await renderQrPng(payload);
      png_base64 = Buffer.from(buf).toString('base64');
    } catch (err) {
      const e = new Error('No se pudo generar la imagen QR. Instale la dependencia qrcode.');
      e.status = 500;
      e.cause = err;
      throw e;
    }
  }
  return { ...status, payload: payload || null, png_base64, needs_regenerate: Boolean(status.active && !token) };
}

function qrStatus(restaurantId, employeeId) {
  const emp = getEmployee(restaurantId, employeeId);
  if (!emp) return null;
  const row = queryOne(
    `SELECT id, active, created_at, revoked_at FROM hr_qr_credentials WHERE employee_id = ? ORDER BY created_at DESC LIMIT 1`,
    [employeeId]
  );
  return {
    employee: emp,
    has_credential: Boolean(row),
    active: Number(row?.active || 0) === 1,
    created_at: row?.created_at || null,
    revoked_at: row?.revoked_at || null,
  };
}

function deactivateQr(restaurantId, employeeId, actor) {
  const emp = getEmployee(restaurantId, employeeId);
  if (!emp) {
    const err = new Error('Trabajador no encontrado');
    err.status = 404;
    throw err;
  }
  revokeEmployeeQr(employeeId);
  logAudit({
    actorUserId: actor?.id,
    actorName: actor?.full_name || actor?.username,
    action: 'hr.qr.deactivate',
    resourceType: 'hr_qr_credentials',
    resourceId: employeeId,
  });
  return qrStatus(restaurantId, employeeId);
}

function scheduleOfEmployee(emp) {
  if (!emp?.schedule_id) return queryOne('SELECT * FROM hr_schedules WHERE restaurant_id = ? ORDER BY created_at ASC LIMIT 1', [emp.restaurant_id]);
  return queryOne('SELECT * FROM hr_schedules WHERE id = ?', [emp.schedule_id]);
}

function openAttendance(employeeId) {
  return queryOne(
    `SELECT * FROM hr_attendance WHERE employee_id = ? AND check_out_at IS NULL ORDER BY check_in_at DESC LIMIT 1`,
    [employeeId]
  );
}

function approvedLeaveToday(employeeId, date) {
  return queryOne(
    `SELECT id, type FROM hr_leave_requests
     WHERE employee_id = ? AND status = 'approved' AND start_date <= ? AND end_date >= ?
     LIMIT 1`,
    [employeeId, date, date]
  );
}

function findEmployeeByToken(plainOrPayload, restaurantId) {
  let token = String(plainOrPayload || '').trim();
  if (token.startsWith('RFHR:')) token = token.slice(5);
  if (!token) return null;
  const cred = queryOne(
    `SELECT c.*, e.restaurant_id, e.status AS emp_status, e.branch_id, e.user_id
     FROM hr_qr_credentials c
     JOIN hr_employees e ON e.id = c.employee_id
     WHERE c.token_hash = ? AND c.active = 1`,
    [hashToken(token)]
  );
  if (!cred) return null;
  if (String(cred.restaurant_id) !== String(restaurantId)) return { foreign: true };
  return cred;
}

function fillAttendanceHours(row, schedule) {
  if (!row?.check_in_at || !row?.check_out_at) return row;
  const overnight = calc.isOvernightSchedule(schedule.start_time, schedule.end_time);
  const hours = calc.computeWorkedAndOvertime({
    checkInSql: row.check_in_at,
    checkOutSql: row.check_out_at,
    breakMinutes: Number(schedule.break_minutes || 0),
    maxHours: Number(schedule.max_hours || 8),
    overtimeAfterMinutes: schedule.overtime_after_minutes,
  });
  const early = calc.computeEarlyLeaveMinutes(row.check_out_at, schedule.end_time, overnight);
  return { ...row, ...hours, early_leave_minutes: early };
}

function lastAttendanceInstant(row) {
  return row?.check_out_at || row?.check_in_at || row?.updated_at || '';
}

function scanAttendance({ restaurantId, token, branchId, deviceId, ip }) {
  if (!isAsistenciaQrActiva()) {
    const err = new Error('La marcación por QR está desactivada. La jornada se cuenta por inicio y fin de sesión.');
    err.status = 403;
    throw err;
  }
  const settings = getHrSettings();
  const cred = findEmployeeByToken(token, restaurantId);
  if (!cred) {
    const err = new Error('QR inválido o desactivado');
    err.status = 400;
    throw err;
  }
  if (cred.foreign) {
    const err = new Error('El QR no pertenece a esta empresa');
    err.status = 403;
    throw err;
  }
  const emp = getEmployee(restaurantId, cred.employee_id);
  if (!emp || emp.status !== 'active' || !emp.user_active) {
    const err = new Error('Trabajador inactivo o suspendido');
    err.status = 403;
    throw err;
  }
  const branches = listBranches(restaurantId);
  const branch = String(branchId || emp.branch_id || branches[0]?.id || '');
  if (settings.require_branch_match && emp.branch_id && branch && emp.branch_id !== branch) {
    const err = new Error('Sede incorrecta para este trabajador');
    err.status = 403;
    throw err;
  }
  const nowSql = calc.jsNowSql();
  const open = openAttendance(emp.id);
  const lastAt = lastAttendanceInstant(open) || queryOne(
    `SELECT check_out_at, check_in_at, updated_at FROM hr_attendance WHERE employee_id = ? ORDER BY created_at DESC LIMIT 1`,
    [emp.id]
  );
  const prevSql = open ? lastAttendanceInstant(open) : lastAttendanceInstant(lastAt);
  if (prevSql) {
    const secs = calc.diffSecondsSql(prevSql, nowSql);
    if (secs >= 0 && secs < DOUBLE_SCAN_SECONDS) {
      const err = new Error('Espere un momento antes de volver a marcar');
      err.status = 429;
      throw err;
    }
  }
  const schedule = scheduleOfEmployee({ ...emp, restaurant_id: restaurantId }) || {
    start_time: '08:00',
    end_time: '17:00',
    break_minutes: 60,
    max_hours: 8,
    tolerance_in_minutes: 10,
    work_days: '[1,2,3,4,5,6]',
  };

  if (open && !open.check_out_at) {
    const overnight = calc.isOvernightSchedule(schedule.start_time, schedule.end_time);
    const hours = calc.computeWorkedAndOvertime({
      checkInSql: open.check_in_at,
      checkOutSql: nowSql,
      breakMinutes: Number(schedule.break_minutes || 0),
      maxHours: Number(schedule.max_hours || 8),
      overtimeAfterMinutes: schedule.overtime_after_minutes,
    });
    const early = calc.computeEarlyLeaveMinutes(nowSql, schedule.end_time, overnight);
    let status = open.status === 'late' || open.status === 'late_justified' ? open.status : 'on_time';
    if (open.status === 'open') {
      status = calc.attendanceStatus({
        lateMinutes: open.late_minutes,
        toleranceMinutes: schedule.tolerance_in_minutes,
        justified: Number(open.late_justified) === 1,
      });
    }
    runSql(
      `UPDATE hr_attendance SET check_out_at=?, worked_minutes=?, break_minutes=?, overtime_minutes=?,
        early_leave_minutes=?, status=?, device_id=?, ip_address=?, updated_at=datetime('now')
       WHERE id=?`,
      [
        nowSql,
        hours.worked_minutes,
        hours.break_minutes,
        hours.overtime_minutes,
        early,
        status,
        String(deviceId || ''),
        String(ip || ''),
        open.id,
      ]
    );
    const saved = queryOne('SELECT * FROM hr_attendance WHERE id = ?', [open.id]);
    return {
      action: 'check_out',
      title: '¡Salida registrada!',
      employee: emp,
      attendance: saved,
      display: {
        check_in: open.check_in_at,
        check_out: nowSql,
        worked: calc.minutesToHm(hours.worked_minutes),
        overtime: calc.minutesToHm(hours.overtime_minutes),
      },
    };
  }

  const overnight = calc.isOvernightSchedule(schedule.start_time, schedule.end_time);
  const workDate = calc.workDateForCheckIn(nowSql, schedule.start_time, schedule.end_time);
  const leave = approvedLeaveToday(emp.id, workDate);
  const late = calc.computeLateMinutes(nowSql, schedule.start_time, overnight);
  const status = leave
    ? 'leave'
    : calc.attendanceStatus({ lateMinutes: late, toleranceMinutes: schedule.tolerance_in_minutes });
  const id = uuidv4();
  runSql(
    `INSERT INTO hr_attendance (
      id, employee_id, restaurant_id, branch_id, work_date, check_in_at, scheduled_start, scheduled_end,
      late_minutes, status, device_id, ip_address, source, break_minutes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'qr', ?)`,
    [
      id,
      emp.id,
      restaurantId,
      branch,
      workDate,
      nowSql,
      schedule.start_time,
      schedule.end_time,
      late,
      status,
      String(deviceId || ''),
      String(ip || ''),
      Number(schedule.break_minutes || 0),
    ]
  );
  const saved = queryOne('SELECT * FROM hr_attendance WHERE id = ?', [id]);
  return {
    action: 'check_in',
    title: '¡Ingreso registrado!',
    employee: emp,
    attendance: saved,
    display: {
      check_in: nowSql,
      schedule: schedule.start_time,
      late_minutes: late,
      status,
      on_time: status === 'on_time' || (status === 'open' && late <= Number(schedule.tolerance_in_minutes || 0)),
    },
  };
}

function listAttendance(restaurantId, filters = {}) {
  const params = [restaurantId];
  let where = 'a.restaurant_id = ?';
  if (filters.from) {
    where += ' AND a.work_date >= ?';
    params.push(filters.from);
  }
  if (filters.to) {
    where += ' AND a.work_date <= ?';
    params.push(filters.to);
  }
  if (filters.employee_id) {
    where += ' AND a.employee_id = ?';
    params.push(filters.employee_id);
  }
  if (filters.user_id) {
    where += ' AND e.user_id = ?';
    params.push(filters.user_id);
  }
  if (filters.branch_id) {
    where += ' AND a.branch_id = ?';
    params.push(filters.branch_id);
  }
  if (filters.department) {
    where += ' AND e.department = ?';
    params.push(filters.department);
  }
  if (filters.position) {
    where += ' AND e.position = ?';
    params.push(filters.position);
  }
  if (filters.status) {
    where += ' AND a.status = ?';
    params.push(filters.status);
  }
  if (filters.q) {
    where += ' AND (u.full_name LIKE ? OR u.username LIKE ?)';
    const like = `%${filters.q}%`;
    params.push(like, like);
  }
  const page = Math.max(1, Number(filters.page || 1));
  const limit = Math.min(100, Math.max(10, Number(filters.limit || 25)));
  const offset = (page - 1) * limit;
  const total = queryOne(
    `SELECT COUNT(*) AS c FROM hr_attendance a
     JOIN hr_employees e ON e.id = a.employee_id
     JOIN users u ON u.id = e.user_id
     WHERE ${where}`,
    params
  );
  const rows = queryAll(
    `SELECT a.*, u.full_name, u.username, e.position, e.department, e.branch_id AS emp_branch
     FROM hr_attendance a
     JOIN hr_employees e ON e.id = a.employee_id
     JOIN users u ON u.id = e.user_id
     WHERE ${where}
     ORDER BY a.work_date DESC, a.check_in_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return {
    items: rows || [],
    total: Number(total?.c || 0),
    page,
    limit,
  };
}

function dashboard(restaurantId) {
  syncEmployeesFromUsers(restaurantId);
  const today = calc.jsTodayDate();
  const monthStart = `${today.slice(0, 7)}-01`;
  const registered = queryOne('SELECT COUNT(*) AS c FROM hr_employees WHERE restaurant_id = ? AND status = \'active\'', [restaurantId]);
  const present = queryOne(
    `SELECT COUNT(*) AS c FROM hr_attendance a
     JOIN hr_employees e ON e.id = a.employee_id
     WHERE a.restaurant_id = ? AND a.work_date = ? AND a.check_in_at IS NOT NULL AND a.check_out_at IS NULL`,
    [restaurantId, today]
  );
  const checkedToday = queryOne(
    `SELECT COUNT(DISTINCT employee_id) AS c FROM hr_attendance WHERE restaurant_id = ? AND work_date = ? AND check_in_at IS NOT NULL`,
    [restaurantId, today]
  );
  const lateToday = queryOne(
    `SELECT COUNT(*) AS c FROM hr_attendance WHERE restaurant_id = ? AND work_date = ? AND status IN ('late','late_justified')`,
    [restaurantId, today]
  );
  const hoursToday = queryOne(
    `SELECT COALESCE(SUM(worked_minutes),0) AS m, COALESCE(SUM(overtime_minutes),0) AS ot FROM hr_attendance WHERE restaurant_id = ? AND work_date = ?`,
    [restaurantId, today]
  );
  const activeEmps = Number(registered?.c || 0);
  const presentN = Number(checkedToday?.c || 0);
  const absent = Math.max(0, activeEmps - presentN);
  const monthHours = queryOne(
    `SELECT COALESCE(SUM(worked_minutes),0) AS m FROM hr_attendance WHERE restaurant_id = ? AND work_date >= ?`,
    [restaurantId, monthStart]
  );
  const byDay = queryAll(
    `SELECT work_date AS date, COUNT(*) AS attendance, COALESCE(SUM(CASE WHEN late_minutes > 10 THEN 1 ELSE 0 END),0) AS late,
            COALESCE(SUM(worked_minutes),0) AS worked_minutes
     FROM hr_attendance WHERE restaurant_id = ? AND work_date >= date('now','-13 days')
     GROUP BY work_date ORDER BY work_date ASC`,
    [restaurantId]
  );
  const byDept = queryAll(
    `SELECT CASE WHEN trim(IFNULL(e.department,'')) = '' THEN IFNULL(e.position, u.role) ELSE e.department END AS area,
            COUNT(*) AS c
     FROM hr_employees e JOIN users u ON u.id = e.user_id
     WHERE e.restaurant_id = ? AND e.status = 'active'
     GROUP BY area ORDER BY c DESC`,
    [restaurantId]
  );
  return {
    today,
    cards: {
      registered: activeEmps,
      present: Number(present?.c || 0),
      working: Number(present?.c || 0),
      checked_today: presentN,
      absent,
      late_today: Number(lateToday?.c || 0),
      worked_minutes_today: Number(hoursToday?.m || 0),
      overtime_minutes_today: Number(hoursToday?.ot || 0),
      worked_minutes_month: Number(monthHours?.m || 0),
    },
    charts: {
      by_day: byDay || [],
      by_area: byDept || [],
    },
  };
}

function manualAttendance(restaurantId, body, actor) {
  const employeeId = String(body.employee_id || '').trim();
  const emp = getEmployee(restaurantId, employeeId);
  if (!emp) {
    const err = new Error('Trabajador no encontrado');
    err.status = 404;
    throw err;
  }
  const reason = String(body.reason || '').trim();
  if (!reason) {
    const err = new Error('Indique el motivo de la corrección');
    err.status = 400;
    throw err;
  }
  const workDate = String(body.work_date || calc.jsTodayDate()).slice(0, 10);
  const checkIn = body.check_in_at ? String(body.check_in_at) : null;
  const checkOut = body.check_out_at ? String(body.check_out_at) : null;
  let row = queryOne(
    'SELECT * FROM hr_attendance WHERE employee_id = ? AND work_date = ? ORDER BY check_in_at DESC LIMIT 1',
    [employeeId, workDate]
  );
  const schedule = scheduleOfEmployee({ ...emp, restaurant_id: restaurantId }) || {
    start_time: '08:00', end_time: '17:00', break_minutes: 60, max_hours: 8, tolerance_in_minutes: 10,
  };
  const oldValues = row || {};
  if (!row) {
    const id = uuidv4();
    runSql(
      `INSERT INTO hr_attendance (id, employee_id, restaurant_id, branch_id, work_date, check_in_at, check_out_at, scheduled_start, scheduled_end, source, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', 'on_time')`,
      [id, employeeId, restaurantId, emp.branch_id || '', workDate, checkIn, checkOut, schedule.start_time, schedule.end_time]
    );
    row = queryOne('SELECT * FROM hr_attendance WHERE id = ?', [id]);
  }
  const nextIn = checkIn || row.check_in_at;
  const nextOut = checkOut === undefined ? row.check_out_at : checkOut;
  const overnight = calc.isOvernightSchedule(schedule.start_time, schedule.end_time);
  const late = nextIn ? calc.computeLateMinutes(nextIn, schedule.start_time, overnight) : 0;
  const hours = nextIn && nextOut
    ? calc.computeWorkedAndOvertime({
      checkInSql: nextIn,
      checkOutSql: nextOut,
      breakMinutes: Number(schedule.break_minutes || 0),
      maxHours: Number(schedule.max_hours || 8),
      overtimeAfterMinutes: schedule.overtime_after_minutes,
    })
    : { worked_minutes: 0, overtime_minutes: 0, break_minutes: Number(schedule.break_minutes || 0) };
  const status = calc.attendanceStatus({
    lateMinutes: late,
    toleranceMinutes: schedule.tolerance_in_minutes,
    justified: Boolean(body.late_justified),
  });
  runSql(
    `UPDATE hr_attendance SET check_in_at=?, check_out_at=?, worked_minutes=?, overtime_minutes=?, break_minutes=?,
      late_minutes=?, late_justified=?, late_justification=?, status=?, source='manual', updated_at=datetime('now')
     WHERE id=?`,
    [
      nextIn, nextOut, hours.worked_minutes, hours.overtime_minutes, hours.break_minutes,
      late, body.late_justified ? 1 : 0, String(body.late_justification || ''),
      nextOut ? status : (status === 'on_time' ? 'open' : status),
      row.id,
    ]
  );
  const updated = queryOne('SELECT * FROM hr_attendance WHERE id = ?', [row.id]);
  runSql(
    `INSERT INTO hr_attendance_adjustments (id, attendance_id, actor_user_id, reason, old_values, new_values)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [uuidv4(), row.id, actor.id, reason, JSON.stringify(oldValues), JSON.stringify(updated)]
  );
  logAudit({
    actorUserId: actor.id,
    actorName: actor.full_name || actor.username,
    action: 'hr.attendance.manual',
    resourceType: 'hr_attendance',
    resourceId: row.id,
    details: { reason },
  });
  return updated;
}

function justifyLate(restaurantId, attendanceId, justification, actor) {
  const row = queryOne(
    `SELECT a.* FROM hr_attendance a JOIN hr_employees e ON e.id = a.employee_id
     WHERE a.id = ? AND e.restaurant_id = ?`,
    [attendanceId, restaurantId]
  );
  if (!row) {
    const err = new Error('Registro no encontrado');
    err.status = 404;
    throw err;
  }
  runSql(
    `UPDATE hr_attendance SET late_justified=1, late_justification=?, status='late_justified', updated_at=datetime('now') WHERE id=?`,
    [String(justification || '').trim(), attendanceId]
  );
  logAudit({
    actorUserId: actor.id,
    actorName: actor.full_name || actor.username,
    action: 'hr.attendance.justify',
    resourceType: 'hr_attendance',
    resourceId: attendanceId,
  });
  return queryOne('SELECT * FROM hr_attendance WHERE id = ?', [attendanceId]);
}

function listLeaves(restaurantId, filters = {}) {
  const params = [restaurantId];
  let where = 'e.restaurant_id = ?';
  if (filters.status) {
    where += ' AND l.status = ?';
    params.push(filters.status);
  }
  if (filters.employee_id) {
    where += ' AND l.employee_id = ?';
    params.push(filters.employee_id);
  }
  return queryAll(
    `SELECT l.*, u.full_name, e.department, e.position
     FROM hr_leave_requests l
     JOIN hr_employees e ON e.id = l.employee_id
     JOIN users u ON u.id = e.user_id
     WHERE ${where}
     ORDER BY l.start_date DESC`,
    params
  ) || [];
}

function createLeave(restaurantId, body, actor, { asAdmin } = {}) {
  const employeeId = String(body.employee_id || '').trim();
  const emp = getEmployee(restaurantId, employeeId);
  if (!emp) {
    const err = new Error('Trabajador no encontrado');
    err.status = 404;
    throw err;
  }
  const type = String(body.type || 'personal');
  if (!LEAVE_TYPES.has(type)) {
    const err = new Error('Tipo de permiso inválido');
    err.status = 400;
    throw err;
  }
  const id = uuidv4();
  runSql(
    `INSERT INTO hr_leave_requests (id, employee_id, restaurant_id, type, start_date, end_date, reason, notes, status, approved_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, employeeId, restaurantId, type,
      String(body.start_date || '').slice(0, 10),
      String(body.end_date || body.start_date || '').slice(0, 10),
      String(body.reason || '').trim(),
      String(body.notes || '').trim(),
      asAdmin && body.status && LEAVE_STATUSES.has(body.status) ? body.status : 'pending',
      asAdmin && body.status === 'approved' ? actor.id : '',
    ]
  );
  return queryOne('SELECT * FROM hr_leave_requests WHERE id = ?', [id]);
}

function setLeaveStatus(restaurantId, leaveId, status, actor) {
  if (!LEAVE_STATUSES.has(status)) {
    const err = new Error('Estado inválido');
    err.status = 400;
    throw err;
  }
  const row = queryOne(
    `SELECT l.* FROM hr_leave_requests l JOIN hr_employees e ON e.id = l.employee_id WHERE l.id = ? AND e.restaurant_id = ?`,
    [leaveId, restaurantId]
  );
  if (!row) {
    const err = new Error('Permiso no encontrado');
    err.status = 404;
    throw err;
  }
  runSql(
    `UPDATE hr_leave_requests SET status=?, approved_by=?, updated_at=datetime('now') WHERE id=?`,
    [status, actor.id, leaveId]
  );
  return queryOne('SELECT * FROM hr_leave_requests WHERE id = ?', [leaveId]);
}

function reports(restaurantId, { from, to, kind = 'daily' } = {}) {
  const start = from || calc.jsTodayDate();
  const end = to || start;
  const rows = queryAll(
    `SELECT a.*, u.full_name, e.position, e.department
     FROM hr_attendance a
     JOIN hr_employees e ON e.id = a.employee_id
     JOIN users u ON u.id = e.user_id
     WHERE a.restaurant_id = ? AND a.work_date >= ? AND a.work_date <= ?
     ORDER BY u.full_name, a.work_date`,
    [restaurantId, start, end]
  ) || [];
  const byEmp = new Map();
  for (const r of rows) {
    if (!byEmp.has(r.employee_id)) {
      byEmp.set(r.employee_id, {
        employee_id: r.employee_id,
        full_name: r.full_name,
        position: r.position,
        days: 0,
        worked_minutes: 0,
        overtime_minutes: 0,
        late_minutes: 0,
        late_count: 0,
      });
    }
    const g = byEmp.get(r.employee_id);
    g.days += 1;
    g.worked_minutes += Number(r.worked_minutes || 0);
    g.overtime_minutes += Number(r.overtime_minutes || 0);
    g.late_minutes += Number(r.late_minutes || 0);
    if (Number(r.late_minutes || 0) > 0) g.late_count += 1;
  }
  return {
    kind,
    from: start,
    to: end,
    records: rows,
    by_employee: [...byEmp.values()],
  };
}

function absences(restaurantId, date) {
  const day = date || calc.jsTodayDate();
  const wd = calc.weekdayMonday0(day);
  const emps = queryAll(
    `SELECT e.id, e.schedule_id, e.status, u.full_name, s.work_days
     FROM hr_employees e
     JOIN users u ON u.id = e.user_id
     LEFT JOIN hr_schedules s ON s.id = e.schedule_id
     WHERE e.restaurant_id = ? AND e.status = 'active' AND u.is_active = 1`,
    [restaurantId]
  ) || [];
  const marked = new Set(
    (queryAll('SELECT employee_id FROM hr_attendance WHERE restaurant_id = ? AND work_date = ?', [restaurantId, day]) || [])
      .map((r) => r.employee_id)
  );
  const leave = new Set(
    (queryAll(
      `SELECT employee_id FROM hr_leave_requests WHERE restaurant_id = ? AND status = 'approved' AND start_date <= ? AND end_date >= ?`,
      [restaurantId, day, day]
    ) || []).map((r) => r.employee_id)
  );
  const missing = [];
  for (const e of emps) {
    const days = parseDays(e.work_days);
    if (days.length && !days.includes(wd)) continue;
    if (marked.has(e.id) || leave.has(e.id)) continue;
    missing.push({ employee_id: e.id, full_name: e.full_name, date: day, status: 'absent' });
  }
  return missing;
}

function meToday(restaurantId, userId) {
  const emp = employeeByUser(restaurantId, userId);
  if (!emp) {
    const err = new Error('No hay ficha de trabajador para este usuario');
    err.status = 404;
    throw err;
  }
  const today = calc.jsTodayDate();
  const schedule = scheduleOfEmployee({ ...emp, restaurant_id: restaurantId });
  const open = openAttendance(emp.id);
  const todayRows = queryAll(
    `SELECT * FROM hr_attendance WHERE employee_id = ? AND work_date = ? ORDER BY check_in_at DESC`,
    [emp.id, today]
  ) || [];
  const history = listAttendance(restaurantId, { user_id: userId, limit: 30, page: 1 });
  const leaves = listLeaves(restaurantId, { employee_id: emp.id });
  return {
    employee: emp,
    schedule,
    today,
    open,
    today_records: todayRows,
    history: history.items,
    leaves,
  };
}

function adjustmentsOf(attendanceId, restaurantId) {
  const row = queryOne(
    `SELECT a.id FROM hr_attendance a JOIN hr_employees e ON e.id = a.employee_id
     WHERE a.id = ? AND e.restaurant_id = ?`,
    [attendanceId, restaurantId]
  );
  if (!row) return [];
  return queryAll(
    `SELECT adj.*, u.full_name AS actor_name
     FROM hr_attendance_adjustments adj
     LEFT JOIN users u ON u.id = adj.actor_user_id
     WHERE adj.attendance_id = ?
     ORDER BY adj.created_at DESC`,
    [attendanceId]
  ) || [];
}

module.exports = {
  ensureHrSchema,
  restaurantIdOf,
  isHrAdmin,
  listBranches,
  clientIp,
  getHrSettings,
  saveHrSettings,
  isAsistenciaQrActiva,
  setAsistenciaQrActiva,
  listEmployees,
  getEmployee,
  employeeByUser,
  updateEmployee,
  listSchedules,
  saveSchedule,
  assignSchedule,
  issueQr,
  qrStatus,
  qrBundle,
  deactivateQr,
  scanAttendance,
  listAttendance,
  dashboard,
  manualAttendance,
  justifyLate,
  listLeaves,
  createLeave,
  setLeaveStatus,
  reports,
  absences,
  meToday,
  adjustmentsOf,
  calc,
};
