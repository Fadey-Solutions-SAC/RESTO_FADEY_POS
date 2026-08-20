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

function buildWaiterRatings(rows) {
  const byWaiter = new Map();
  for (const row of rows) {
    const wid = String(row.waiter_user_id || '').trim();
    if (!wid) continue;
    const name = String(row.waiter_name || '').trim() || 'Mozo';
    const rating = Number(row.rating || 0);
    if (!Number.isFinite(rating) || rating < 1) continue;
    let entry = byWaiter.get(wid);
    if (!entry) {
      entry = { waiter_user_id: wid, waiter_name: name, count: 0, sum: 0 };
      byWaiter.set(wid, entry);
    }
    entry.count += 1;
    entry.sum += rating;
    if (name && name !== 'Mozo') entry.waiter_name = name;
  }
  return [...byWaiter.values()]
    .map((e) => ({
      waiter_user_id: e.waiter_user_id,
      waiter_name: e.waiter_name,
      count: e.count,
      average: e.count ? Math.round((e.sum / e.count) * 10) / 10 : 0,
    }))
    .sort((a, b) => b.average - a.average || b.count - a.count || a.waiter_name.localeCompare(b.waiter_name, 'es'));
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

function parseJsonList(raw) {
  try {
    const o = JSON.parse(raw || '[]');
    return Array.isArray(o) ? o.map((x) => String(x || '').trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

router.get('/summary', (req, res) => {
  try {
    const form = readLoyaltySurveyForm();
    const qIds = loyaltyQuestionIds(form);
    const rows = queryAll(
      `SELECT id, customer_name, comment, rating, answers_json, waiter_user_id, waiter_name,
              visit_date, visit_area, party_size, liked_json, improve_json, liked_other, improve_other, created_at
       FROM loyalty_surveys
       ORDER BY datetime(created_at) DESC
       LIMIT 500`,
    ) || [];
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
    const likedCounts = {};
    const improveCounts = {};
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
      for (const id of parseJsonList(row.liked_json)) {
        likedCounts[id] = (likedCounts[id] || 0) + 1;
      }
      for (const id of parseJsonList(row.improve_json)) {
        improveCounts[id] = (improveCounts[id] || 0) + 1;
      }
    }
    const questions = form.questions.map((q) => ({
      id: q.id,
      label: q.label,
      average: qCounts[q.id] ? Math.round((qSums[q.id] / qCounts[q.id]) * 10) / 10 : 0,
    }));
    const liked_summary = (form.liked_options || []).map((o) => ({
      id: o.id,
      label: o.label,
      count: likedCounts[o.id] || 0,
    }));
    const improve_summary = (form.improve_options || []).map((o) => ({
      id: o.id,
      label: o.label,
      count: improveCounts[o.id] || 0,
    }));
    const labelByLiked = Object.fromEntries((form.liked_options || []).map((o) => [o.id, o.label]));
    const labelByImprove = Object.fromEntries((form.improve_options || []).map((o) => [o.id, o.label]));
    const responses = rows.map((r) => {
      const liked = parseJsonList(r.liked_json);
      const improve = parseJsonList(r.improve_json);
      return {
        id: r.id,
        customer_name: r.customer_name,
        comment: r.comment || '',
        rating: Number(r.rating || 0),
        answers: parseAnswers(r.answers_json),
        waiter_user_id: String(r.waiter_user_id || '').trim(),
        waiter_name: String(r.waiter_name || '').trim(),
        visit_date: String(r.visit_date || '').trim(),
        visit_area: String(r.visit_area || '').trim(),
        party_size: Number(r.party_size || 0),
        liked,
        improve,
        liked_labels: liked.map((id) => labelByLiked[id] || id),
        improve_labels: improve.map((id) => labelByImprove[id] || id),
        liked_other: String(r.liked_other || '').trim(),
        improve_other: String(r.improve_other || '').trim(),
        created_at: r.created_at,
      };
    });
    const waiters = buildWaiterRatings(rows);
    const totalRow = queryOne('SELECT COUNT(*) AS c FROM loyalty_surveys');
    res.json({
      count: Number(totalRow?.c || n),
      average: avg,
      distribution: dist,
      questions,
      liked_summary,
      improve_summary,
      waiters,
      responses,
    });
  } catch (err) {
    sendRouteError(res, req, err, 'No se pudo cargar el panel de fidelización');
  }
});

/** Calificaciones por mozo (también usado en Recursos humanos). */
router.get('/waiter-ratings', (req, res) => {
  try {
    const rows = queryAll(
      `SELECT waiter_user_id, waiter_name, rating, created_at
       FROM loyalty_surveys
       WHERE trim(COALESCE(waiter_user_id, '')) != ''
       ORDER BY datetime(created_at) DESC
       LIMIT 2000`,
    ) || [];
    const waiters = buildWaiterRatings(rows);
    const mozos = queryAll(
      `SELECT id, full_name, username, is_active
       FROM users
       WHERE lower(trim(COALESCE(role, ''))) = 'mozo'
       ORDER BY lower(COALESCE(full_name, username, '')) ASC`,
    ) || [];
    const byId = new Map(waiters.map((w) => [w.waiter_user_id, w]));
    const staff = mozos.map((m) => {
      const id = String(m.id || '').trim();
      const hit = byId.get(id);
      return {
        waiter_user_id: id,
        waiter_name: String(m.full_name || m.username || '').trim() || 'Mozo',
        is_active: Number(m.is_active || 0) === 1,
        count: hit?.count || 0,
        average: hit?.average || 0,
      };
    });
    for (const w of waiters) {
      if (!staff.some((s) => s.waiter_user_id === w.waiter_user_id)) {
        staff.push({ ...w, is_active: false });
      }
    }
    staff.sort((a, b) => b.average - a.average || b.count - a.count || a.waiter_name.localeCompare(b.waiter_name, 'es'));
    res.json({ waiters: staff });
  } catch (err) {
    sendRouteError(res, req, err, 'No se pudieron cargar las calificaciones de mozos');
  }
});

module.exports = router;
