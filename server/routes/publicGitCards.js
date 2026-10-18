const express = require('express');
const { createRateLimiter } = require('../middleware/rateLimit');
const { queryOne } = require('../database');
const {
  ensureGitCardsTables,
  findAccessByToken,
  publicCardPayload,
  recordSurvey,
  customerHasSurvey,
  getConfig,
  processExpirations,
} = require('../gitCardsService');

const router = express.Router();
const getLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 40 });
const postLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 8 });

function loadCustomerByToken(token) {
  ensureGitCardsTables();
  const access = findAccessByToken(token);
  if (!access) return null;
  const customer = queryOne(
    'SELECT id, name, phone, doc_number FROM customers WHERE id = ?',
    [access.customer_id],
  );
  return customer || null;
}

router.get('/:token', getLimiter, (req, res) => {
  try {
    processExpirations();
    const customer = loadCustomerByToken(req.params.token);
    if (!customer) return res.status(404).json({ error: 'Enlace no válido' });
    const config = getConfig();
    const card = publicCardPayload(customer, { includeContact: false });
    res.json({
      card,
      rewards: card.rewards_public || [],
      next_step: card.next_step,
      survey_required: config.survey_required,
      survey_done: customerHasSurvey(customer, { created_at: 'now' }),
      survey_url: '/encuesta',
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudo abrir GIT Cards' });
  }
});

router.post('/:token/survey', postLimiter, (req, res) => {
  try {
    const customer = loadCustomerByToken(req.params.token);
    if (!customer) return res.status(404).json({ error: 'Enlace no válido' });
    if (customerHasSurvey(customer, { created_at: 'now' })) {
      return res.json({ ok: true, already: true });
    }
    recordSurvey(customer.id, {
      rating: req.body?.rating,
      comment: String(req.body?.comment || '').slice(0, 400),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudo guardar la encuesta' });
  }
});

module.exports = router;
