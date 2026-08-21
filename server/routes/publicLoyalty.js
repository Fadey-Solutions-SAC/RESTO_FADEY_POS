const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { queryOne, queryAll, runSql, ensureLoyaltySurveysTable } = require('../database');
const { createRateLimiter } = require('../middleware/rateLimit');
const { emitStaffDataUpdate } = require('../socketBroadcast');
const { attachProfileToRestaurant } = require('../services/miRestaurantConfigService');
const { readLoyaltySurveyForm, loyaltyQuestionIds } = require('../loyaltySurveyQuestions');
const { sendRouteError } = require('../utils/routeErrors');

const router = express.Router();
const postLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 8 });

const AREA_VALUES = new Set(['restaurante', 'hotel', 'ambos']);

function clampRating(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n);
  if (r < 1 || r > 5) return null;
  return r;
}

function restaurantBranding() {
  const restaurant = queryOne('SELECT * FROM restaurants LIMIT 1') || {};
  if (restaurant.id) attachProfileToRestaurant(restaurant);
  const cover = String(
    restaurant?.profile_effective?.branding?.encuesta_cover_image
    || restaurant?.profile?.branding?.encuesta_cover_image
    || '',
  ).trim();
  return {
    restaurant_name: String(restaurant.name || '').trim() || 'Resto Fadey App',
    logo: String(restaurant.logo || '').trim(),
    cover_image: cover,
  };
}

function listActiveWaiters() {
  const rows = queryAll(
    `SELECT id, full_name, username
     FROM users
     WHERE lower(trim(COALESCE(role, ''))) = 'mozo'
       AND CAST(COALESCE(is_active, 1) AS INTEGER) = 1
     ORDER BY lower(COALESCE(full_name, username, '')) ASC`,
  ) || [];
  return rows.map((u) => ({
    id: String(u.id || '').trim(),
    full_name: String(u.full_name || u.username || '').trim() || 'Mozo',
  })).filter((u) => u.id);
}

function resolveWaiter(waiterUserId) {
  const id = String(waiterUserId || '').trim();
  if (!id) return null;
  const user = queryOne(
    `SELECT id, full_name, username, role, is_active
     FROM users WHERE id = ? LIMIT 1`,
    [id],
  );
  if (!user) return null;
  if (String(user.role || '').toLowerCase().trim() !== 'mozo') return null;
  if (Number(user.is_active || 0) !== 1) return null;
  return {
    id: String(user.id),
    full_name: String(user.full_name || user.username || '').trim() || 'Mozo',
  };
}

function parseIdList(raw, allowedIds) {
  const allowed = new Set(allowedIds);
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const item of list) {
    const id = String(item || '').trim();
    if (!id || !allowed.has(id) || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

router.get('/form', (req, res) => {
  try {
    ensureLoyaltySurveysTable();
    const form = readLoyaltySurveyForm();
    res.json({
      ...restaurantBranding(),
      ...form,
      waiters: listActiveWaiters(),
    });
  } catch (err) {
    sendRouteError(res, req, err, 'No se pudo cargar la encuesta');
  }
});

router.get('/waiters', (req, res) => {
  try {
    res.json(listActiveWaiters());
  } catch (err) {
    sendRouteError(res, req, err, 'No se pudieron cargar los mozos');
  }
});

router.post('/', postLimiter, (req, res) => {
  try {
    ensureLoyaltySurveysTable();
    const form = readLoyaltySurveyForm();
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const customerName = String(b.customer_name || '').trim().replace(/\s+/g, ' ');
    if (customerName.length < 2 || customerName.length > 80) {
      return res.status(400).json({ error: `Indica ${form.name_label.toLowerCase()} (entre 2 y 80 caracteres).` });
    }

    const waiters = listActiveWaiters();
    let waiterId = '';
    let waiterName = '';
    if (waiters.length) {
      const waiter = resolveWaiter(b.waiter_user_id || b.waiter_id);
      if (!waiter) {
        return res.status(400).json({
          error: `Selecciona ${String(form.waiter_label || 'el mozo').toLowerCase()}.`,
        });
      }
      waiterId = waiter.id;
      waiterName = waiter.full_name;
    }

    const visitDate = String(b.visit_date || '').trim().slice(0, 32);
    const visitArea = String(b.visit_area || '').trim().toLowerCase();
    if (!AREA_VALUES.has(visitArea)) {
      return res.status(400).json({ error: `Selecciona ${String(form.area_label || 'el área').toLowerCase()}.` });
    }
    const partySize = Math.round(Number(b.party_size));
    if (!Number.isFinite(partySize) || partySize < 1 || partySize > 200) {
      return res.status(400).json({ error: `Indica ${String(form.party_size_label || 'el número de personas').toLowerCase()}.` });
    }

    const answersIn = b.answers && typeof b.answers === 'object' ? b.answers : {};
    const answers = {};
    for (const id of loyaltyQuestionIds(form)) {
      const v = clampRating(answersIn[id]);
      if (v == null) {
        return res.status(400).json({ error: 'Complete todas las calificaciones de experiencia.' });
      }
      answers[id] = v;
    }

    const likedIds = (form.liked_options || []).map((o) => o.id);
    const improveIds = (form.improve_options || []).map((o) => o.id);
    const liked = parseIdList(b.liked, likedIds);
    const improve = parseIdList(b.improve, improveIds);
    const likedOther = String(b.liked_other || '').trim().slice(0, 120);
    const improveOther = String(b.improve_other || '').trim().slice(0, 120);

    const overall = clampRating(answers.experiencia_general)
      || clampRating(b.rating)
      || Math.round(
        Object.values(answers).reduce((s, v) => s + v, 0) / Math.max(1, Object.keys(answers).length),
      );

    const comment = form.show_comment ? String(b.comment || '').trim().slice(0, 800) : '';

    const id = uuidv4();
    const insertSql = `INSERT INTO loyalty_surveys
        (id, customer_name, comment, rating, answers_json, waiter_user_id, waiter_name,
         visit_date, visit_area, party_size, liked_json, improve_json, liked_other, improve_other, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`;
    const insertParams = [
      id,
      customerName,
      comment,
      overall,
      JSON.stringify(answers),
      waiterId,
      waiterName,
      visitDate,
      visitArea,
      partySize,
      JSON.stringify(liked),
      JSON.stringify(improve),
      likedOther,
      improveOther,
    ];
    try {
      runSql(insertSql, insertParams);
    } catch (insertErr) {
      const msg = String(insertErr?.message || insertErr);
      if (/no such column|has no column/i.test(msg)) {
        console.warn('[loyalty] INSERT sin columnas; migrando y reintentando:', msg);
        ensureLoyaltySurveysTable();
        runSql(insertSql, insertParams);
      } else {
        throw insertErr;
      }
    }
    emitStaffDataUpdate({ domain: 'loyalty' });
    res.status(201).json({ success: true, id });
  } catch (err) {
    sendRouteError(res, req, err, 'No se pudo enviar la encuesta');
  }
});

module.exports = router;
