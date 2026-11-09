const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { queryAll, queryOne, runSql, persistCriticalDb } = require('../database');

const CLAIM_MS = 90000;

function parseJson(raw, fallback = {}) {
  try {
    const value = JSON.parse(raw || (fallback == null ? 'null' : JSON.stringify(fallback)));
    return value == null ? fallback : value;
  } catch (_) {
    return fallback;
  }
}

function claimIsFresh(claimedAt) {
  const at = Date.parse(String(claimedAt || ''));
  return Number.isFinite(at) && Date.now() - at < CLAIM_MS;
}

router.use(authenticateToken, requireRole('admin', 'master_admin', 'cajero', 'mozo', 'cocina', 'bar', 'produccion'));

/** Encolar trabajo de impresión para el asistente Android (cola en nube). */
router.post('/', (req, res) => {
  const moduleKey = String(req.body?.module || req.body?.moduleKey || 'caja').trim().toLowerCase() || 'caja';
  const payload = req.body?.payload != null ? req.body.payload : (req.body || {});
  const id = uuidv4();
  const now = new Date().toISOString();
  runSql(
    `INSERT INTO print_jobs (id, module, status, payload_json, result_json, claimed_at, created_at, updated_at)
     VALUES (?, ?, 'pending', ?, '', NULL, datetime('now'), datetime('now'))`,
    [id, moduleKey, JSON.stringify(payload || {})],
  );
  persistCriticalDb();
  res.status(201).json({ ok: true, id, module: moduleKey, status: 'pending', createdAt: now });
});

/** Listado corto para el poll del móvil. */
router.get('/pending', (req, res) => {
  const rows = queryAll(
    `SELECT id, module, status, claimed_at, updated_at
     FROM print_jobs
     WHERE status IN ('pending', 'claimed')
     ORDER BY created_at ASC
     LIMIT 20`,
  );
  const jobs = rows
    .filter((row) => {
      if (String(row.status) === 'claimed' && claimIsFresh(row.claimed_at)) return false;
      return true;
    })
    .map((row) => ({ id: row.id, module: row.module }));
  res.json({ jobs });
});

router.post('/:id/claim', (req, res) => {
  const job = queryOne('SELECT * FROM print_jobs WHERE id = ?', [req.params.id]);
  if (!job) return res.status(404).json({ error: 'Trabajo no encontrado' });
  const status = String(job.status || '').toLowerCase();
  if (status === 'printed' || status === 'done' || status === 'error') {
    return res.status(409).json({ error: 'El trabajo ya fue procesado' });
  }
  if (status === 'claimed' && claimIsFresh(job.claimed_at)) {
    return res.status(409).json({ error: 'Otro dispositivo ya reclamó este trabajo' });
  }
  const claimedAt = new Date().toISOString();
  runSql(
    `UPDATE print_jobs
     SET status = 'claimed', claimed_at = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [claimedAt, job.id],
  );
  persistCriticalDb();
  res.json({
    id: job.id,
    module: job.module,
    payload: parseJson(job.payload_json, {}),
    claimedAt,
  });
});

router.post('/:id/result', (req, res) => {
  const job = queryOne('SELECT * FROM print_jobs WHERE id = ?', [req.params.id]);
  if (!job) return res.status(404).json({ error: 'Trabajo no encontrado' });
  const ok = req.body?.ok !== false;
  const status = ok ? 'printed' : 'error';
  const result = {
    ok,
    error: req.body?.error || null,
    detail: req.body?.detail || null,
    at: new Date().toISOString(),
  };
  runSql(
    `UPDATE print_jobs
     SET status = ?, result_json = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [status, JSON.stringify(result), job.id],
  );
  persistCriticalDb();
  res.json({ ok: true, id: job.id, status });
});

router.post('/:id/release', (req, res) => {
  const job = queryOne('SELECT * FROM print_jobs WHERE id = ?', [req.params.id]);
  if (!job) return res.status(404).json({ error: 'Trabajo no encontrado' });
  if (String(job.status) !== 'claimed') return res.json({ ok: true, skipped: true });
  runSql(
    `UPDATE print_jobs
     SET status = 'pending', claimed_at = NULL, updated_at = datetime('now')
     WHERE id = ?`,
    [job.id],
  );
  persistCriticalDb();
  res.json({ ok: true });
});

router.get('/:id', (req, res) => {
  const job = queryOne('SELECT * FROM print_jobs WHERE id = ?', [req.params.id]);
  if (!job) return res.status(404).json({ error: 'Trabajo no encontrado' });
  res.json({
    id: job.id,
    module: job.module,
    status: job.status,
    payload: parseJson(job.payload_json, {}),
    result: parseJson(job.result_json, null),
    claimedAt: job.claimed_at,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  });
});

module.exports = router;
