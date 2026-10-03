/**
 * Mi perfil: datos propios, cambio de nombre/usuario/contraseña, horas, contrato y productividad.
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const { queryAll, queryOne, runSql } = require('../database');
const { authenticateToken } = require('../middleware/auth');
const { normalizeCatalogDisplayName } = require('../utils/catalogNameFormat');
const { getBusinessTodayDateKey, shiftBusinessDateKey, sqlBusinessTimestamp } = require('../utils/appDateTime');

const router = express.Router();
router.use(authenticateToken);

const PERIOD_DAYS = 30;
const MIN_PASSWORD_LENGTH = 6;

function profileKind(role) {
  const r = String(role || '').toLowerCase();
  if (r === 'mozo') return 'mozo';
  if (r === 'cajero') return 'caja';
  if (r === 'cocina' || r === 'bar' || r.startsWith('produccion')) return 'produccion';
  if (r === 'admin' || r === 'master_admin') return 'admin';
  return 'general';
}

function isRealUser(req) {
  return Boolean(req.user?.id) && req.user.id !== 'master-admin' && String(req.user.role || '') !== 'master_admin';
}

function dayKeys(from, to) {
  const out = [];
  for (let d = from; d <= to; d = shiftBusinessDateKey(d, 1)) out.push(d);
  return out;
}

function safeAll(sql, params) {
  try {
    return queryAll(sql, params) || [];
  } catch (_) {
    return [];
  }
}

function hoursSummary(userId, from, to) {
  try {
    const { buildHoursRollup, buildProductivityByUser } = require('../services/workProductivityService');
    const rollup = buildHoursRollup(from, to, userId);
    let totalMinutes = null;
    try {
      const all = buildProductivityByUser('2000-01-01', to, userId);
      const row = (all || []).find((r) => String(r.user_id) === String(userId)) || (all || [])[0];
      totalMinutes = row ? Number(row.worked_minutes || 0) : 0;
    } catch (_) {
      totalMinutes = null;
    }
    const byDay = new Map((rollup.daily || []).map((d) => [String(d.day).slice(0, 10), Number(d.minutes || 0)]));
    return {
      period_minutes: [...byDay.values()].reduce((s, n) => s + n, 0),
      weekly_minutes: Number(rollup.weekly_minutes || 0),
      monthly_minutes: Number(rollup.monthly_minutes || 0),
      total_minutes: totalMinutes,
      by_day: byDay,
    };
  } catch (_) {
    return { period_minutes: 0, weekly_minutes: 0, monthly_minutes: 0, total_minutes: null, by_day: new Map() };
  }
}

function contractSummary(restaurantId, userId) {
  try {
    const hr = require('../services/hrService');
    hr.ensureHrSchema();
    const emp = hr.employeeByUser(restaurantId, userId);
    if (!emp?.id) return { available: false, reason: 'Aún no tiene ficha de trabajador en Recursos humanos.' };
    const {
      readEmploymentContrato,
      publicEmploymentContratoView,
      employmentContractSummary,
    } = require('../services/employmentContractStore');
    const view = publicEmploymentContratoView(readEmploymentContrato(emp.id));
    const summary = employmentContractSummary(emp.id);
    return {
      available: true,
      employee_code: emp.employee_code || '',
      position: emp.position || '',
      contract_type: emp.contract_type || '',
      hire_date: emp.hire_date || '',
      status: summary?.label || view?.estado_firma || '',
      fully_signed: Boolean(summary?.fully_signed),
      employee_signed: Boolean(summary?.employee_signed),
      employer_signed: Boolean(summary?.employer_signed),
      signed_at: view?.firmado_en || null,
      pdf_url: view?.pdf_firmado_url || view?.pdf_original_url || '',
      text: String(view?.texto_contrato || ''),
    };
  } catch (err) {
    return { available: false, reason: 'No se pudo leer el contrato.' };
  }
}

function eventsByDay(userId, eventType, from, to) {
  const local = sqlBusinessTimestamp('e.created_at', queryOne);
  return safeAll(
    `SELECT DATE(${local}) AS day, e.ref_id, e.meta_json
     FROM user_work_activity_events e
     WHERE e.user_id = ? AND e.event_type = ?
       AND DATE(${local}) >= date(?) AND DATE(${local}) <= date(?)`,
    [userId, eventType, from, to],
  );
}

function parseMeta(raw) {
  try {
    return JSON.parse(raw || '{}') || {};
  } catch (_) {
    return {};
  }
}

function openedByDay(userId, from, to) {
  const local = sqlBusinessTimestamp('o.created_at', queryOne);
  return safeAll(
    `SELECT DATE(${local}) AS day,
            COUNT(*) AS comandas,
            COUNT(DISTINCT COALESCE(NULLIF(o.table_id, ''), NULLIF(o.table_number, ''), o.id)) AS cuentas,
            COALESCE(SUM(CASE WHEN o.payment_status = 'paid' AND o.status != 'cancelled' THEN o.total ELSE 0 END), 0) AS ventas
     FROM orders o
     WHERE o.created_by_user_id = ?
       AND o.status != 'cancelled'
       AND DATE(${local}) >= date(?) AND DATE(${local}) <= date(?)
     GROUP BY DATE(${local})`,
    [userId, from, to],
  );
}

function productivitySeries(userId, kind, from, to, hoursByDay) {
  const days = dayKeys(from, to);
  const base = new Map(days.map((d) => [d, {
    day: d, cuentas: 0, comandas: 0, ventas: 0, cobradas: 0, despachadas: 0, minutos_promedio: null, horas: 0,
  }]));
  for (const [d, minutes] of hoursByDay.entries()) {
    if (base.has(d)) base.get(d).horas = Math.round((minutes / 60) * 10) / 10;
  }

  if (kind === 'mozo' || kind === 'caja' || kind === 'admin' || kind === 'general') {
    for (const r of openedByDay(userId, from, to)) {
      const row = base.get(String(r.day));
      if (!row) continue;
      row.cuentas = Number(r.cuentas || 0);
      row.comandas = Number(r.comandas || 0);
      row.ventas = Number(r.ventas || 0);
    }
  }
  if (kind === 'caja' || kind === 'admin') {
    for (const e of eventsByDay(userId, 'sale_closed', from, to)) {
      const row = base.get(String(e.day));
      if (!row) continue;
      row.cobradas += Number(parseMeta(e.meta_json).order_count || 1);
    }
  }
  if (kind === 'produccion' || kind === 'admin') {
    const perDayOrder = new Map();
    for (const e of eventsByDay(userId, 'station_ready', from, to)) {
      const key = `${e.day}|${e.ref_id}`;
      const minutes = Number(parseMeta(e.meta_json).minutes);
      const prev = perDayOrder.get(key);
      const m = Number.isFinite(minutes) ? minutes : null;
      perDayOrder.set(key, { day: String(e.day), minutes: prev?.minutes != null && m != null ? Math.max(prev.minutes, m) : (m ?? prev?.minutes ?? null) });
    }
    const agg = new Map();
    for (const { day, minutes } of perDayOrder.values()) {
      const cur = agg.get(day) || { n: 0, sum: 0, timed: 0 };
      cur.n += 1;
      if (minutes != null) { cur.sum += minutes; cur.timed += 1; }
      agg.set(day, cur);
    }
    for (const [day, v] of agg.entries()) {
      const row = base.get(day);
      if (!row) continue;
      row.despachadas = v.n;
      row.minutos_promedio = v.timed ? Math.round((v.sum / v.timed) * 10) / 10 : null;
    }
  }
  return [...base.values()];
}

function productivitySummary(kind, series) {
  const sum = (k) => series.reduce((s, r) => s + Number(r[k] || 0), 0);
  const horas = sum('horas');
  const perHour = (n) => (horas > 0 ? Math.round((n / horas) * 100) / 100 : null);
  const timed = series.filter((r) => r.minutos_promedio != null && r.despachadas > 0);
  const avgMinutes = timed.length
    ? Math.round((timed.reduce((s, r) => s + r.minutos_promedio * r.despachadas, 0) / timed.reduce((s, r) => s + r.despachadas, 0)) * 10) / 10
    : null;
  const out = {
    horas: Math.round(horas * 10) / 10,
    cuentas: sum('cuentas'),
    comandas: sum('comandas'),
    ventas: Math.round(sum('ventas') * 100) / 100,
    cobradas: sum('cobradas'),
    despachadas: sum('despachadas'),
    minutos_promedio: avgMinutes,
  };
  if (kind === 'mozo') out.por_hora = perHour(out.cuentas);
  else if (kind === 'caja') out.por_hora = perHour(out.cobradas + out.cuentas);
  else if (kind === 'produccion') out.por_hora = perHour(out.despachadas);
  else out.por_hora = perHour(out.cuentas + out.cobradas + out.despachadas);
  return out;
}

/**
 * Resumen del perfil de un usuario del sistema (datos, horas, contrato y productividad).
 * Lo usan «Mi perfil» y el detalle del trabajador en Recursos humanos.
 */
function buildStaffProfile(userId, restaurantId) {
  const user = queryOne(
    'SELECT id, username, full_name, role, email, phone, created_at FROM users WHERE id = ?',
    [userId],
  );
  if (!user) return null;
  const today = getBusinessTodayDateKey(queryOne);
  const from = shiftBusinessDateKey(today, -(PERIOD_DAYS - 1));
  const kind = profileKind(user.role);
  const hours = hoursSummary(user.id, from, today);
  const series = productivitySeries(user.id, kind, from, today, hours.by_day);
  return {
    user: {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role,
      email: /@no-email\.local$/i.test(String(user.email || '')) ? '' : user.email,
      phone: user.phone || '',
      created_at: user.created_at,
    },
    kind,
    period: { from, to: today, days: PERIOD_DAYS },
    hours: {
      period_minutes: hours.period_minutes,
      weekly_minutes: hours.weekly_minutes,
      monthly_minutes: hours.monthly_minutes,
      total_minutes: hours.total_minutes,
    },
    contract: contractSummary(restaurantId, user.id),
    productivity: {
      series,
      summary: productivitySummary(kind, series),
    },
  };
}

router.get('/', (req, res) => {
  try {
    const today = getBusinessTodayDateKey(queryOne);
    const from = shiftBusinessDateKey(today, -(PERIOD_DAYS - 1));
    const kind = profileKind(req.user.role);

    if (!isRealUser(req)) {
      return res.json({
        user: { id: req.user.id, username: req.user.username, full_name: req.user.full_name, role: req.user.role },
        editable: false,
        kind,
        period: { from, to: today, days: PERIOD_DAYS },
        hours: null,
        contract: { available: false, reason: 'El administrador maestro no tiene contrato de trabajador.' },
        productivity: null,
      });
    }

    const hr = require('../services/hrService');
    const profile = buildStaffProfile(req.user.id, hr.restaurantIdOf(req.user));
    if (!profile) return res.status(404).json({ error: 'Usuario no encontrado' });
    return res.json({ ...profile, editable: true });
  } catch (err) {
    console.error('[profile] GET', err);
    return res.status(500).json({ error: 'No se pudo cargar tu perfil' });
  }
});

router.put('/', (req, res) => {
  try {
    if (!isRealUser(req)) {
      return res.status(403).json({ error: 'Este usuario no se edita desde Mi perfil.' });
    }
    const current = queryOne('SELECT id, username, full_name, password_hash FROM users WHERE id = ?', [req.user.id]);
    if (!current) return res.status(404).json({ error: 'Usuario no encontrado' });

    const body = req.body || {};
    const fullName = body.full_name === undefined ? current.full_name : normalizeCatalogDisplayName(body.full_name || '');
    const username = body.username === undefined ? current.username : normalizeCatalogDisplayName(body.username || '');
    const newPassword = String(body.new_password || '');
    const currentPassword = String(body.current_password || '');

    if (!fullName || !username) {
      return res.status(400).json({ error: 'Nombre y usuario son obligatorios' });
    }
    const usernameChanged = String(username).trim().toLowerCase() !== String(current.username || '').trim().toLowerCase();
    if ((usernameChanged || newPassword) && !bcrypt.compareSync(currentPassword, current.password_hash || '')) {
      return res.status(400).json({ error: 'La contraseña actual no es correcta' });
    }
    if (newPassword && newPassword.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `La nueva contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres` });
    }
    if (usernameChanged) {
      const dup = queryOne(
        'SELECT id FROM users WHERE lower(trim(username)) = lower(?) AND id != ? LIMIT 1',
        [username, current.id],
      );
      if (dup?.id) return res.status(400).json({ error: 'Ese nombre de usuario ya está en uso' });
    }

    runSql(
      'UPDATE users SET full_name = ?, username = ? WHERE id = ?',
      [fullName, username, current.id],
    );
    if (newPassword) {
      runSql('UPDATE users SET password_hash = ? WHERE id = ?', [bcrypt.hashSync(newPassword, 10), current.id]);
    }
    try {
      const { emitStaffDataUpdate } = require('../socketBroadcast');
      emitStaffDataUpdate({ reason: 'profile_update', user_id: current.id });
    } catch (_) {
      /* noop */
    }
    return res.json({ ok: true, user: { id: current.id, full_name: fullName, username }, password_changed: Boolean(newPassword) });
  } catch (err) {
    console.error('[profile] PUT', err);
    return res.status(500).json({ error: 'No se pudo guardar tu perfil' });
  }
});

module.exports = router;
module.exports.buildStaffProfile = buildStaffProfile;
