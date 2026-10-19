const express = require('express');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { emitStaffDataUpdate } = require('../socketBroadcast');
const {
  ensureGitCardsTables,
  getConfig,
  saveConfig,
  listMembers,
  getMemberProfile,
  decideAdvance,
  redeemReward,
  adminDashboardSummary,
  cardStyles,
  processExpirations,
  listEligibleCajaClients,
  previewCajaGitCustomer,
} = require('../gitCardsService');

const router = express.Router();

router.use(authenticateToken);
router.use((req, res, next) => {
  try {
    ensureGitCardsTables();
    next();
  } catch (err) {
    return res.status(500).json({ error: err.message || 'No se pudo iniciar GIT Cards' });
  }
});

function sendErr(res, err) {
  const status = Number(err?.status || 500);
  return res.status(status).json({
    error: err?.message || 'Error en GIT Cards',
    errors: err?.errors || undefined,
  });
}

router.get('/summary', requireRole('admin', 'cajero'), (req, res) => {
  try {
    processExpirations();
    const summary = adminDashboardSummary();
    res.json({
      enrolled: summary.registered,
      registered: summary.registered,
      active_cards: summary.active_cards,
      pending_purchases: summary.pending_purchases,
      available_rewards: summary.available_rewards,
      config: getConfig(),
    });
  } catch (err) {
    sendErr(res, err);
  }
});

router.get('/config', requireRole('admin', 'cajero'), (req, res) => {
  try {
    res.json({
      config: getConfig(),
      styles: cardStyles(),
    });
  } catch (err) {
    sendErr(res, err);
  }
});

router.put('/config', requireRole('admin'), (req, res) => {
  try {
    const config = saveConfig(req.body || {}, req.user || {});
    emitStaffDataUpdate({ domain: 'git_cards' });
    res.json({ config });
  } catch (err) {
    sendErr(res, err);
  }
});

router.get('/caja/clients', requireRole('admin', 'cajero'), (req, res) => {
  try {
    processExpirations();
    res.json(listEligibleCajaClients(req.query?.q));
  } catch (err) {
    sendErr(res, err);
  }
});

router.get('/caja/clients/:customerId/preview', requireRole('admin', 'cajero'), (req, res) => {
  try {
    processExpirations();
    res.json(previewCajaGitCustomer(req.params.customerId));
  } catch (err) {
    sendErr(res, err);
  }
});

router.get('/members', requireRole('admin', 'cajero'), (req, res) => {
  try {
    res.json(listMembers({
      q: req.query?.q,
      status: req.query?.status,
      page: req.query?.page,
      pageSize: req.query?.page_size,
    }));
  } catch (err) {
    sendErr(res, err);
  }
});

router.get('/members/:customerId', requireRole('admin', 'cajero'), (req, res) => {
  try {
    res.json(getMemberProfile(req.params.customerId));
  } catch (err) {
    sendErr(res, err);
  }
});

router.post('/advances/:id/approve', requireRole('admin', 'cajero'), (req, res) => {
  try {
    const result = decideAdvance(req.params.id, 'approve', '', req.user || {});
    emitStaffDataUpdate({ domain: 'git_cards' });
    res.json(result);
  } catch (err) {
    sendErr(res, err);
  }
});

router.post('/advances/:id/reject', requireRole('admin', 'cajero'), (req, res) => {
  try {
    const result = decideAdvance(req.params.id, 'reject', req.body?.reason, req.user || {});
    emitStaffDataUpdate({ domain: 'git_cards' });
    res.json(result);
  } catch (err) {
    sendErr(res, err);
  }
});

router.post('/rewards/:id/redeem', requireRole('admin', 'cajero'), (req, res) => {
  try {
    const reward = redeemReward(req.params.id, req.user || {});
    emitStaffDataUpdate({ domain: 'git_cards' });
    res.json({ reward });
  } catch (err) {
    sendErr(res, err);
  }
});

module.exports = router;
