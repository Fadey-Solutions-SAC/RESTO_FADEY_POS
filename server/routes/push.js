const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { getPublicKey, saveSubscription, removeSubscription } = require('../services/webPushService');

const router = express.Router();
router.use(authenticateToken);

router.get('/public-key', (req, res) => {
  const key = getPublicKey();
  if (!key) return res.status(503).json({ error: 'Avisos push no disponibles en este servidor' });
  res.json({ publicKey: key });
});

router.post('/subscribe', (req, res) => {
  const ok = saveSubscription(req.user?.id, req.body?.subscription, req.get('user-agent'));
  if (!ok) return res.status(400).json({ error: 'Suscripción inválida' });
  res.json({ ok: true });
});

router.post('/unsubscribe', (req, res) => {
  removeSubscription(req.body?.endpoint);
  res.json({ ok: true });
});

module.exports = router;
