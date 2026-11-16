const express = require('express');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { getOrderWithItems } = require('../orderCreateService');
const { emitInventoryUpdate } = require('../socketBroadcast');
const hotel = require('../services/hotelService');

const router = express.Router();

function sendError(res, err) {
  const status = err.status || 400;
  return res.status(status).json({ error: err.message || 'No se pudo completar la operación' });
}

router.use(authenticateToken, requireRole('admin', 'cajero', 'mozo', 'recepcionista', 'master_admin'));

router.get('/rooms', (req, res) => {
  try {
    res.json(hotel.listRooms(req.user));
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/rooms/:id', (req, res) => {
  try {
    res.json(hotel.getRoom(req.params.id, req.user));
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/rooms', (req, res) => {
  try {
    res.status(201).json(hotel.createRoom(req.body || {}, req.user));
  } catch (err) {
    sendError(res, err);
  }
});

router.put('/rooms/:id', (req, res) => {
  try {
    res.json(hotel.updateRoom(req.params.id, req.body || {}, req.user));
  } catch (err) {
    sendError(res, err);
  }
});

router.delete('/rooms/:id', (req, res) => {
  try {
    res.json(hotel.deleteRoom(req.params.id, req.user));
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/rooms/:id/check-in', (req, res) => {
  try {
    const room = hotel.checkIn(req.params.id, req.body || {}, req.user);
    res.status(201).json(room);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/rooms/:id/stay', (req, res) => {
  try {
    res.json(hotel.updateStay(req.params.id, req.body || {}, req.user));
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/rooms/:id/items', (req, res) => {
  try {
    const result = hotel.addItems(req.params.id, req.body?.items, req.user);
    const order = getOrderWithItems(result.orderId);
    const io = req.app.get('io');
    if (io && order) {
      io.emit('order-lines-updated', { order, new_item_ids: result.newItemIds || [], merged: true });
      io.emit('order-update', order);
    }
    try {
      const { scheduleKitchenBarAutoPrint } = require('../services/kitchenBarAutoPrintService');
      scheduleKitchenBarAutoPrint(order, {
        newItemIds: result.newItemIds || [],
        fromLinesUpdate: true,
      });
    } catch (_) {
      /* la cuenta queda cargada aunque la comanda no salga en este momento */
    }
    emitInventoryUpdate({});
    res.status(200).json(result.room);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/rooms/:id/maintenance', (req, res) => {
  try {
    const enabled = req.body?.enabled === true || req.body?.enabled === 1 || req.body?.enabled === '1';
    res.json(hotel.setMaintenance(req.params.id, enabled, req.user));
  } catch (err) {
    sendError(res, err);
  }
});

const bookings = require('../services/hotelBookingService');

router.get('/room-types', (req, res) => {
  try {
    res.json(bookings.listRoomTypes());
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/room-types', (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'master_admin') {
      return res.status(403).json({ error: 'Solo el administrador crea tipos de habitación' });
    }
    res.status(201).json(bookings.saveRoomType(req.body || {}));
  } catch (err) {
    sendError(res, err);
  }
});

router.put('/room-types/:id', (req, res) => {
  try {
    res.json(bookings.saveRoomType(req.body || {}, req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/availability', (req, res) => {
  try {
    res.json(bookings.searchAvailability({
      checkIn: req.query.checkin || req.query.check_in,
      checkOut: req.query.checkout || req.query.check_out,
      adults: req.query.adultos || req.query.adults,
      children: req.query.ninos || req.query.children,
    }));
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/bookings', (req, res) => {
  try {
    res.json(bookings.listBookings({ from: req.query.from || '' }));
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/bookings', (req, res) => {
  try {
    res.status(201).json(bookings.createBooking(req.body || {}, { user: req.user }));
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/bookings/:id/confirm', (req, res) => {
  try {
    res.json(bookings.confirmBooking(req.params.id, req.body || {}));
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/bookings/:id/check-in', (req, res) => {
  try {
    res.json(bookings.checkInBooking(req.params.id, req.user));
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/bookings/:id/cancel', (req, res) => {
  try {
    res.json(bookings.cancelBooking(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
