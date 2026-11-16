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

module.exports = router;
