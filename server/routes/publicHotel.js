const express = require('express');
const { createRateLimiter } = require('../middleware/rateLimit');
const bookings = require('../services/hotelBookingService');

const router = express.Router();
const limiter = createRateLimiter({ windowMs: 60 * 1000, max: 30 });

function sendError(res, err) {
  return res.status(err.status || 400).json({ error: err.message || 'No se pudo completar la reserva' });
}

function requireHotelKey(req, res, next) {
  const expected = String(process.env.HOTEL_PUBLIC_API_KEY || '').trim();
  if (!expected) return next();
  const sent = String(req.get('x-api-key') || '').trim();
  if (sent && sent === expected) return next();
  return res.status(401).json({ error: 'API key inválida' });
}

router.use(limiter, requireHotelKey);

router.get('/disponibilidad', (req, res) => {
  try {
    const found = bookings.searchAvailability({
      checkIn: req.query.checkin || req.query.check_in,
      checkOut: req.query.checkout || req.query.check_out,
      adults: req.query.adultos || req.query.adults || 1,
      children: req.query.ninos || req.query.children || 0,
    });
    res.json({
      checkin: found.check_in,
      checkout: found.check_out,
      noches: found.nights,
      tipos: found.types,
    });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/reservar', (req, res) => {
  try {
    const body = req.body || {};
    const created = bookings.createBooking({
      ...body,
      origen: body.origen || body.canal_origen || req.query.origen,
    }, { publicHold: true });
    res.status(201).json({
      ...created,
      hold_minutos: bookings.HOLD_MINUTES,
      resumen_url: `/reservar?codigo=${encodeURIComponent(created.codigo_reserva || '')}`,
    });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/reserva/:codigo', (req, res) => {
  try {
    const booking = bookings.loadBooking(req.params.codigo, { byCode: true });
    res.json(bookings.publicView(booking));
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
