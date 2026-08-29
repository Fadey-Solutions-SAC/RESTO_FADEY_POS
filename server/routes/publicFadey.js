/**
 * Endpoints públicos (sin login) para descubrimiento del web service Resto FADEY.
 * Usados por restofadey.pe / Fadey Solutions al vincular un cliente.
 */
const express = require('express');
const {
  buildPublicRestaurantDiscoveryPayload,
  touchSaasLastActivity,
} = require('../services/posSaasIdentityService');

const router = express.Router();

function sendDiscovery(req, res) {
  try {
    touchSaasLastActivity();
    return res.json(buildPublicRestaurantDiscoveryPayload());
  } catch (err) {
    return res.status(500).json({ error: err.message || 'No se pudo obtener el perfil del restaurante' });
  }
}

/** GET /api/fadey/restaurant | /fadey/restaurant */
router.get('/restaurant', sendDiscovery);

module.exports = router;
