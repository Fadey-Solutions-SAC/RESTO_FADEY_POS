const express = require('express');
const { queryAll, queryOne } = require('../database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { readLoyaltySurveyForm, saveLoyaltySurveyForm, loyaltyQuestionIds } = require('../loyaltySurveyQuestions');
const { emitStaffDataUpdate } = require('../socketBroadcast');
const { sendRouteError } = require('../utils/routeErrors');

const router = express.Router();

router.use(authenticateToken, requireRole('admin', 'cajero', 'master_admin'));

function parseAnswers(raw) {
  try {
    const o = JSON.parse(raw || '{}');
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

router.get('/form', (req, res) => {
  try {
    res.json(readLoyaltySurveyForm());
  } catch (err) {
    sendRouteError(res, req, err, 'No se pudo cargar el formato de la encuesta');
  }
});

router.put('/form', requireRole('admin', 'master_admin'), (req, res) => {
  try {
    const saved = saveLoyaltySurveyForm(req.body);
    emitStaffDataUpdate({ domain: 'loyalty' });
    res.json(saved);
  } catch (err) {
    sendRouteError(res, req, err, 'No se pudo guardar el formato de la encuesta');
  }
});

router.get('/qr-png', async (req, res) => {
  try {
    const data = String(req.query.data || '').trim();
    if (!data || data.length > 500) {
      return res.status(400).json({ error: 'Falta el enlace de la encuesta' });
    }
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=800x800&format=png&margin=12&data=${encodeURIComponent(data)}`;
    const r = await fetch(qrUrl);
    if (!r.ok) {
      return res.status(502).json({ error: 'No se pudo generar el QR. Intenta de nuevo.' });
    }
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', 'attachment; filename="qr-encuesta-fidelizacion.png"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(buf);
  } catch (err) {
    sendRouteError(res, req, err, 'No se pudo descargar el QR');
  }
});

router.get('/summary', (req, res) => {
  try {
    const form = readLoyaltySurveyForm();
    const qIds = loyaltyQuestionIds(form);
    const rows = queryAll(
      `SELECT id, customer_name, comment, rating, answers_json, created_at
       FROM loyalty_surveys
       ORDER BY datetime(created_at) DESC
       LIMIT 500`,
    );
    const n = rows.length;
    const sumRating = rows.reduce((s, r) => s + Number(r.rating || 0), 0);
    const avg = n ? Math.round((sumRating / n) * 10) / 10 : 0;
    const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const qSums = {};
    const qCounts = {};
    for (const id of qIds) {
      qSums[id] = 0;
      qCounts[id] = 0;
    }
    for (const row of rows) {
      const rt = Math.round(Number(row.rating || 0));
      if (dist[rt] != null) dist[rt] += 1;
      const ans = parseAnswers(row.answers_json);
      for (const id of qIds) {
        const v = Number(ans[id]);
        if (Number.isFinite(v) && v >= 1 && v <= 5) {
          qSums[id] += v;
          qCounts[id] += 1;
        }
      }
    }
    const questions = form.questions.map((q) => ({
      id: q.id,
      label: q.label,
      average: qCounts[q.id] ? Math.round((qSums[q.id] / qCounts[q.id]) * 10) / 10 : 0,
    }));
    const responses = rows.map((r) => ({
      id: r.id,
      customer_name: r.customer_name,
      comment: r.comment || '',
      rating: Number(r.rating || 0),
      answers: parseAnswers(r.answers_json),
      created_at: r.created_at,
    }));
    const totalRow = queryOne('SELECT COUNT(*) AS c FROM loyalty_surveys');
    res.json({
      count: Number(totalRow?.c || n),
      average: avg,
      distribution: dist,
      questions,
      responses,
    });
  } catch (err) {
    sendRouteError(res, req, err, 'No se pudo cargar el panel de fidelización');
  }
});

module.exports = router;
