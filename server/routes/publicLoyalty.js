const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { queryOne, runSql } = require('../database');
const { createRateLimiter } = require('../middleware/rateLimit');
const { emitStaffDataUpdate } = require('../socketBroadcast');
const { attachProfileToRestaurant } = require('../services/miRestaurantConfigService');
const { readLoyaltySurveyForm, loyaltyQuestionIds } = require('../loyaltySurveyQuestions');
const { sendRouteError } = require('../utils/routeErrors');

const router = express.Router();
const postLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 8 });

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

router.get('/form', (req, res) => {
  try {
    const form = readLoyaltySurveyForm();
    res.json({
      ...restaurantBranding(),
      ...form,
    });
  } catch (err) {
    sendRouteError(res, req, err, 'No se pudo cargar la encuesta');
  }
});

router.post('/', postLimiter, (req, res) => {
  try {
    const form = readLoyaltySurveyForm();
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const customerName = String(b.customer_name || '').trim().replace(/\s+/g, ' ');
    if (customerName.length < 2 || customerName.length > 80) {
      return res.status(400).json({ error: `Indica ${form.name_label.toLowerCase()} (entre 2 y 80 caracteres).` });
    }
    const comment = form.show_comment ? String(b.comment || '').trim().slice(0, 500) : '';
    const rating = clampRating(b.rating);
    if (rating == null) {
      return res.status(400).json({ error: `Elige una ${form.rating_label.toLowerCase()} de 1 a 5.` });
    }
    const answersIn = b.answers && typeof b.answers === 'object' ? b.answers : {};
    const answers = {};
    for (const id of loyaltyQuestionIds(form)) {
      const v = clampRating(answersIn[id]);
      if (v == null) {
        return res.status(400).json({ error: 'Completa todas las opciones de la experiencia (1 a 5).' });
      }
      answers[id] = v;
    }
    const id = uuidv4();
    runSql(
      `INSERT INTO loyalty_surveys (id, customer_name, comment, rating, answers_json, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      [id, customerName, comment, rating, JSON.stringify(answers)],
    );
    emitStaffDataUpdate({ domain: 'loyalty' });
    res.status(201).json({ success: true, id });
  } catch (err) {
    sendRouteError(res, req, err, 'No se pudo enviar la encuesta');
  }
});

module.exports = router;
