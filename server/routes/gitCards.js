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
  enrollStaffCustomer,
  listPromotions,
  getPromotionDetail,
  createPromotion,
  updatePromotion,
  setPromotionStatus,
  archivePromotion,
  searchCatalogProducts,
  previewPromotionCard,
  quoteDiscountRewardForOrder,
  applyDiscountRewardToOrder,
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
      inactive_cards: summary.inactive_cards,
      near_complete: summary.near_complete,
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

router.get('/promotions', requireRole('admin', 'cajero'), (req, res) => {
  try {
    processExpirations();
    res.json(listPromotions());
  } catch (err) {
    sendErr(res, err);
  }
});

router.get('/promotions/products', requireRole('admin', 'cajero'), (req, res) => {
  try {
    res.json({ rows: searchCatalogProducts(req.query?.q) });
  } catch (err) {
    sendErr(res, err);
  }
});

router.post('/promotions/preview', requireRole('admin', 'cajero'), (req, res) => {
  try {
    res.json({ card: previewPromotionCard(req.body || {}) });
  } catch (err) {
    sendErr(res, err);
  }
});

router.get('/promotions/:id', requireRole('admin', 'cajero'), (req, res) => {
  try {
    res.json({ promotion: getPromotionDetail(req.params.id) });
  } catch (err) {
    sendErr(res, err);
  }
});

router.post('/promotions', requireRole('admin'), (req, res) => {
  try {
    const promotion = createPromotion(req.body || {}, req.user || {}, { activate: req.body?.activate === true });
    emitStaffDataUpdate({ domain: 'git_cards' });
    res.status(201).json({ promotion });
  } catch (err) {
    sendErr(res, err);
  }
});

router.put('/promotions/:id', requireRole('admin'), (req, res) => {
  try {
    const promotion = updatePromotion(req.params.id, req.body || {}, req.user || {});
    emitStaffDataUpdate({ domain: 'git_cards' });
    res.json({ promotion });
  } catch (err) {
    sendErr(res, err);
  }
});

router.post('/promotions/:id/activate', requireRole('admin'), (req, res) => {
  try {
    const promotion = setPromotionStatus(req.params.id, 'active', req.user || {});
    emitStaffDataUpdate({ domain: 'git_cards' });
    res.json({ promotion });
  } catch (err) {
    sendErr(res, err);
  }
});

router.post('/promotions/:id/pause', requireRole('admin'), (req, res) => {
  try {
    const promotion = setPromotionStatus(req.params.id, 'paused', req.user || {});
    emitStaffDataUpdate({ domain: 'git_cards' });
    res.json({ promotion });
  } catch (err) {
    sendErr(res, err);
  }
});

router.post('/promotions/:id/end', requireRole('admin'), (req, res) => {
  try {
    const promotion = setPromotionStatus(req.params.id, 'ended', req.user || {});
    emitStaffDataUpdate({ domain: 'git_cards' });
    res.json({ promotion });
  } catch (err) {
    sendErr(res, err);
  }
});

router.delete('/promotions/:id', requireRole('admin'), (req, res) => {
  try {
    const result = archivePromotion(req.params.id, req.user || {});
    emitStaffDataUpdate({ domain: 'git_cards' });
    res.json(result);
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

router.post('/members/enroll', requireRole('admin', 'cajero'), (req, res) => {
  try {
    const result = enrollStaffCustomer(req.body || {}, req.user || {});
    emitStaffDataUpdate({ domain: 'git_cards' });
    emitStaffDataUpdate({ domain: 'customers' });
    res.status(result.created_customer ? 201 : 200).json(result);
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
    emitStaffDataUpdate({ domain: 'inventory' });
    res.json({ reward });
  } catch (err) {
    sendErr(res, err);
  }
});

router.post('/rewards/:id/quote-discount', requireRole('admin', 'cajero'), (req, res) => {
  try {
    res.json(quoteDiscountRewardForOrder(req.params.id, req.body?.order_id));
  } catch (err) {
    sendErr(res, err);
  }
});

router.post('/rewards/:id/apply-discount', requireRole('admin', 'cajero'), (req, res) => {
  try {
    const result = applyDiscountRewardToOrder(req.params.id, req.body?.order_id, req.user || {});
    emitStaffDataUpdate({ domain: 'git_cards' });
    emitStaffDataUpdate({ domain: 'orders' });
    res.json(result);
  } catch (err) {
    sendErr(res, err);
  }
});

module.exports = router;
