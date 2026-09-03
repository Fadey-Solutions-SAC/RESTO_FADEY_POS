const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/rateLimit');
const hr = require('../services/hrService');
const exportHr = require('../services/hrExport');

const router = express.Router();
const scanLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 40 });

router.use(authenticateToken);
router.use((req, res, next) => {
  try {
    hr.ensureHrSchema();
  } catch (_) {
    /* noop */
  }
  next();
});

function rid(req) {
  return hr.restaurantIdOf(req.user);
}

function requireHrAdmin(req, res, next) {
  if (!hr.isHrAdmin(req.user)) {
    return res.status(403).json({ error: 'No tienes permisos de recursos humanos' });
  }
  return next();
}

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

router.get('/branches', asyncHandler(async (req, res) => {
  res.json(hr.listBranches(rid(req)));
}));

router.get('/settings', requireHrAdmin, asyncHandler(async (req, res) => {
  res.json(hr.getHrSettings());
}));

router.put('/settings', requireHrAdmin, asyncHandler(async (req, res) => {
  res.json(hr.saveHrSettings(req.body || {}, req.user));
}));

router.get('/dashboard', requireHrAdmin, asyncHandler(async (req, res) => {
  res.json(hr.dashboard(rid(req)));
}));

router.get('/employees', requireHrAdmin, asyncHandler(async (req, res) => {
  res.json(hr.listEmployees(rid(req), {
    q: req.query.q || '',
    status: req.query.status || '',
    branch_id: req.query.branch_id || '',
  }));
}));

router.get('/employees/:id', requireHrAdmin, asyncHandler(async (req, res) => {
  const emp = hr.getEmployee(rid(req), req.params.id);
  if (!emp) return res.status(404).json({ error: 'Trabajador no encontrado' });
  return res.json(emp);
}));

router.patch('/employees/:id', requireHrAdmin, asyncHandler(async (req, res) => {
  res.json(hr.updateEmployee(rid(req), req.params.id, req.body || {}, req.user));
}));

router.get('/employees/:id/qr', requireHrAdmin, asyncHandler(async (req, res) => {
  const data = await hr.qrBundle(rid(req), req.params.id);
  if (!data) return res.status(404).json({ error: 'Trabajador no encontrado' });
  return res.json(data);
}));

router.post('/employees/:id/qr/regenerate', requireHrAdmin, asyncHandler(async (req, res) => {
  const issued = hr.issueQr(rid(req), req.params.id, req.user);
  const bundle = await hr.qrBundle(rid(req), req.params.id);
  return res.json({ ...issued, png_base64: bundle?.png_base64 || '' });
}));

router.post('/employees/:id/qr/deactivate', requireHrAdmin, asyncHandler(async (req, res) => {
  res.json(hr.deactivateQr(rid(req), req.params.id, req.user));
}));

router.get('/schedules', requireHrAdmin, asyncHandler(async (req, res) => {
  res.json(hr.listSchedules(rid(req)));
}));

router.post('/schedules', requireHrAdmin, asyncHandler(async (req, res) => {
  res.status(201).json(hr.saveSchedule(rid(req), req.body || {}));
}));

router.put('/schedules/:id', requireHrAdmin, asyncHandler(async (req, res) => {
  res.json(hr.saveSchedule(rid(req), req.body || {}, req.params.id));
}));

router.post('/schedules/:id/assign', requireHrAdmin, asyncHandler(async (req, res) => {
  res.json(hr.assignSchedule({
    restaurantId: rid(req),
    scheduleId: req.params.id,
    employeeIds: req.body?.employee_ids || [],
    department: req.body?.department || '',
  }));
}));

router.post('/attendance/scan', scanLimiter, asyncHandler(async (req, res) => {
  const result = hr.scanAttendance({
    restaurantId: rid(req),
    token: req.body?.token || req.body?.payload || '',
    branchId: req.body?.branch_id || '',
    deviceId: req.body?.device_id || '',
    ip: hr.clientIp(req),
  });
  res.json(result);
}));

router.get('/attendance', requireHrAdmin, asyncHandler(async (req, res) => {
  res.json(hr.listAttendance(rid(req), {
    from: req.query.from,
    to: req.query.to,
    employee_id: req.query.employee_id,
    user_id: req.query.user_id,
    branch_id: req.query.branch_id,
    department: req.query.department,
    position: req.query.position,
    status: req.query.status,
    q: req.query.q,
    page: req.query.page,
    limit: req.query.limit,
  }));
}));

router.get('/attendance/today', requireHrAdmin, asyncHandler(async (req, res) => {
  const today = hr.calc.jsTodayDate();
  res.json(hr.listAttendance(rid(req), { from: today, to: today, limit: 200, page: 1 }));
}));

router.get('/attendance/history', requireHrAdmin, asyncHandler(async (req, res) => {
  res.json(hr.listAttendance(rid(req), {
    from: req.query.from,
    to: req.query.to,
    employee_id: req.query.employee_id,
    branch_id: req.query.branch_id,
    department: req.query.department,
    position: req.query.position,
    status: req.query.status,
    q: req.query.q,
    page: req.query.page,
    limit: req.query.limit,
  }));
}));

router.post('/attendance/manual', requireHrAdmin, asyncHandler(async (req, res) => {
  res.status(201).json(hr.manualAttendance(rid(req), req.body || {}, req.user));
}));

router.post('/attendance/:id/justify', requireHrAdmin, asyncHandler(async (req, res) => {
  res.json(hr.justifyLate(rid(req), req.params.id, req.body?.justification || req.body?.reason || '', req.user));
}));

router.get('/attendance/:id/adjustments', requireHrAdmin, asyncHandler(async (req, res) => {
  res.json(hr.adjustmentsOf(req.params.id, rid(req)));
}));

router.get('/absences', requireHrAdmin, asyncHandler(async (req, res) => {
  res.json(hr.absences(rid(req), req.query.date));
}));

router.get('/leave-requests', requireHrAdmin, asyncHandler(async (req, res) => {
  res.json(hr.listLeaves(rid(req), {
    status: req.query.status,
    employee_id: req.query.employee_id,
  }));
}));

router.post('/leave-requests', asyncHandler(async (req, res) => {
  const restaurantId = rid(req);
  const asAdmin = hr.isHrAdmin(req.user);
  let employeeId = String(req.body?.employee_id || '').trim();
  if (!asAdmin) {
    const mine = hr.employeeByUser(restaurantId, req.user.id);
    if (!mine) return res.status(404).json({ error: 'No hay ficha de trabajador' });
    employeeId = mine.id;
  }
  const created = hr.createLeave(restaurantId, { ...req.body, employee_id: employeeId }, req.user, { asAdmin });
  res.status(201).json(created);
}));

router.patch('/leave-requests/:id', requireHrAdmin, asyncHandler(async (req, res) => {
  const status = String(req.body?.status || '').trim();
  res.json(hr.setLeaveStatus(rid(req), req.params.id, status, req.user));
}));

router.get('/reports', requireHrAdmin, asyncHandler(async (req, res) => {
  const restaurantId = rid(req);
  const kind = String(req.query.kind || 'daily');
  let from = req.query.from;
  let to = req.query.to;
  const today = hr.calc.jsTodayDate();
  if (!from || !to) {
    if (kind === 'weekly') {
      const d = new Date(`${today}T12:00:00`);
      const dow = (d.getDay() + 6) % 7;
      d.setDate(d.getDate() - dow);
      from = hr.calc.jsTodayDate(d);
      to = today;
    } else if (kind === 'monthly') {
      from = `${today.slice(0, 7)}-01`;
      to = today;
    } else {
      from = today;
      to = today;
    }
  }
  const report = hr.reports(restaurantId, { from, to, kind });
  const absences = hr.absences(restaurantId, to);
  const format = String(req.query.format || 'json').toLowerCase();
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="asistencia-${from}-${to}.csv"`);
    return res.send(exportHr.buildCsv(report, absences));
  }
  if (format === 'xlsx' || format === 'excel') {
    res.setHeader('Content-Type', 'application/vnd.ms-excel');
    res.setHeader('Content-Disposition', `attachment; filename="asistencia-${from}-${to}.xls"`);
    return res.send(exportHr.buildExcelXml(report, absences));
  }
  if (format === 'pdf') {
    const buf = await exportHr.buildPdf(report, absences);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="asistencia-${from}-${to}.pdf"`);
    return res.send(buf);
  }
  return res.json({ ...report, absences });
}));

router.get('/me', asyncHandler(async (req, res) => {
  res.json(hr.meToday(rid(req), req.user.id));
}));

router.get('/me/history', asyncHandler(async (req, res) => {
  res.json(hr.listAttendance(rid(req), {
    user_id: req.user.id,
    from: req.query.from,
    to: req.query.to,
    page: req.query.page,
    limit: req.query.limit || 50,
  }));
}));

module.exports = router;
