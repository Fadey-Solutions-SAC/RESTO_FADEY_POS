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

router.get('/asistencia-qr-mode', asyncHandler(async (req, res) => {
  res.json({ active: hr.isAsistenciaQrActiva() });
}));

router.put('/asistencia-qr-mode', requireHrAdmin, asyncHandler(async (req, res) => {
  const { verifyAdminPassword } = require('../lib/adminPassword');
  if (!verifyAdminPassword(req.body?.admin_password)) {
    return res.status(403).json({ error: 'Contraseña de administrador incorrecta' });
  }
  const active = Boolean(req.body?.active);
  hr.setAsistenciaQrActiva(active, req.user);
  return res.json({ active: hr.isAsistenciaQrActiva() });
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

router.get('/employees/:id/contract', requireHrAdmin, asyncHandler(async (req, res) => {
  const emp = hr.getEmployee(rid(req), req.params.id);
  if (!emp) return res.status(404).json({ error: 'Trabajador no encontrado' });
  const {
    readEmploymentContrato,
    publicEmploymentContratoView,
    writeEmploymentContrato,
  } = require('../services/employmentContractStore');
  const raw = readEmploymentContrato(req.params.id);
  // Persist default text on first open so firmas tienen base estable.
  if (!String(raw.texto_contrato || '').trim()) {
    writeEmploymentContrato(req.params.id, raw);
  }
  return res.json({
    employee_id: emp.id,
    employee_name: emp.full_name,
    contract_type: emp.contract_type,
    contrato: publicEmploymentContratoView(readEmploymentContrato(req.params.id)),
  });
}));

router.put('/employees/:id/contract', requireHrAdmin, asyncHandler(async (req, res) => {
  const emp = hr.getEmployee(rid(req), req.params.id);
  if (!emp) return res.status(404).json({ error: 'Trabajador no encontrado' });
  const {
    readEmploymentContrato,
    writeEmploymentContrato,
    publicEmploymentContratoView,
    isFullySigned,
  } = require('../services/employmentContractStore');
  const { isTextLocked } = require('../services/contratoStore');
  const prev = readEmploymentContrato(req.params.id);
  if (isFullySigned(prev) || isTextLocked(prev)) {
    return res.status(409).json({
      error: 'El texto del contrato está bloqueado porque hay firmas o el contrato ya está firmado.',
      contrato: publicEmploymentContratoView(prev),
    });
  }
  const next = {
    ...prev,
    texto_contrato: String(req.body?.texto_contrato ?? prev.texto_contrato ?? ''),
  };
  // Al editar texto sin firmas, limpiar PDF/hash previos.
  next.document_hash = '';
  next.pdf_original_url = '';
  next.pdf_firmado_url = '';
  next.estado_firma = 'borrador';
  writeEmploymentContrato(req.params.id, next);
  return res.json({
    employee_id: emp.id,
    contrato: publicEmploymentContratoView(readEmploymentContrato(req.params.id)),
  });
}));

router.post('/employees/:id/contract/sign', requireHrAdmin, asyncHandler(async (req, res) => {
  const emp = hr.getEmployee(rid(req), req.params.id);
  if (!emp) return res.status(404).json({ error: 'Trabajador no encontrado' });
  const { prepareSignature } = require('../services/contractSignature/contractSignatureService');
  const result = await prepareSignature({
    user: req.user,
    party: req.body?.party,
    documentNumber: req.body?.document_number,
    signerName: req.body?.signer_name,
    employeeId: emp.id,
  });
  res.status(201).json(result);
}));

router.post('/employees/:id/contract/sign/complete', requireHrAdmin, asyncHandler(async (req, res) => {
  const emp = hr.getEmployee(rid(req), req.params.id);
  if (!emp) return res.status(404).json({ error: 'Trabajador no encontrado' });
  const { completeSignature } = require('../services/contractSignature/contractSignatureService');
  try {
    const result = await completeSignature({
      user: req.user,
      requestId: req.body?.request_id,
      temporaryToken: req.body?.temporary_token,
      ackReviewed: Boolean(req.body?.ack_reviewed),
      documentNumber: req.body?.document_number,
      signerName: req.body?.signer_name,
      useMock: Boolean(req.body?.use_mock),
    });
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({
      error: err.message || 'No se pudo completar la firma',
      code: err.code || undefined,
      awaiting_mobile: status === 202 || err.code === 'AWAITING_MOBILE_NFC',
    });
  }
}));

router.get('/employees/:id/contract/sign/status/:requestId', requireHrAdmin, asyncHandler(async (req, res) => {
  const emp = hr.getEmployee(rid(req), req.params.id);
  if (!emp) return res.status(404).json({ error: 'Trabajador no encontrado' });
  const { getRequestPollStatus } = require('../services/contractSignature/contractSignatureService');
  res.json(getRequestPollStatus(req.params.requestId, req.user));
}));

router.get('/attendance-qr', requireHrAdmin, asyncHandler(async (req, res) => {
  let bundle = await hr.sharedQrBundle();
  if (!bundle?.has_credential) {
    hr.issueSharedQr(req.user);
    bundle = await hr.sharedQrBundle();
  }
  res.json(bundle);
}));

router.post('/attendance-qr/regenerate', requireHrAdmin, asyncHandler(async (req, res) => {
  hr.issueSharedQr(req.user);
  const bundle = await hr.sharedQrBundle();
  res.json(bundle);
}));

router.post('/attendance-qr/deactivate', requireHrAdmin, asyncHandler(async (req, res) => {
  res.json(hr.deactivateSharedQr(req.user));
}));

router.get('/employees/:id/qr', requireHrAdmin, asyncHandler(async (req, res) => {
  const data = await hr.sharedQrBundle();
  if (!data) return res.status(404).json({ error: 'Trabajador no encontrado' });
  return res.json(data);
}));

router.post('/employees/:id/qr/regenerate', requireHrAdmin, asyncHandler(async (req, res) => {
  hr.issueSharedQr(req.user);
  const bundle = await hr.sharedQrBundle();
  return res.json(bundle);
}));

router.post('/employees/:id/qr/deactivate', requireHrAdmin, asyncHandler(async (req, res) => {
  res.json(hr.deactivateSharedQr(req.user));
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
    userId: req.user?.id,
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
