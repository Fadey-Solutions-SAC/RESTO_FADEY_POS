const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, runSql, withTransaction } = require('../database');
const { getActiveCajaById } = require('../cajaSettings');
const { appendItemsToOrderInTransaction } = require('../orderCreateService');
const { getBusinessTodayDateKey, shiftBusinessDateKey } = require('../utils/appDateTime');

const LODGING_NOTE = 'hotel_lodging';
const DOC_TYPES = ['DNI', 'CE', 'Pasaporte', 'RUC'];

function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function assertHotelEnabled() {
  const row = queryOne('SELECT hotel_enabled FROM restaurants LIMIT 1');
  if (Number(row?.hotel_enabled) !== 1) {
    throw httpError('Hotelería no está habilitada en este restaurante', 403);
  }
}

function staffCajaId(user) {
  if (!user?.id) return '';
  const row = queryOne('SELECT caja_station_id FROM users WHERE id = ?', [user.id]);
  return String(row?.caja_station_id || user.caja_station_id || '').trim();
}

function assertCanOperateRoom(user, room) {
  const role = String(user?.role || '').toLowerCase();
  if (role === 'admin' || role === 'master_admin') return;
  if (role !== 'cajero') throw httpError('No puede operar habitaciones', 403);
  const mine = staffCajaId(user);
  const roomCaja = String(room?.caja_station_id || '').trim();
  if (!mine || !roomCaja || mine !== roomCaja) {
    throw httpError('Esta habitación pertenece a otra caja', 403);
  }
}

function lodgingLabel(room) {
  const nights = Math.max(0, Number(room?.nights) || 0);
  const number = String(room?.number || '').trim();
  return `Habitación ${number} · ${nights} noche${nights === 1 ? '' : 's'}`;
}

function sumItems(items) {
  return round2((items || []).reduce((s, it) => s + Number(it.subtotal || 0), 0));
}

function loadOrderBundle(orderId) {
  const id = String(orderId || '').trim();
  if (!id) return null;
  const order = queryOne('SELECT * FROM orders WHERE id = ?', [id]);
  if (!order) return null;
  const items = queryAll('SELECT * FROM order_items WHERE order_id = ? ORDER BY rowid ASC', [id]);
  const lodging = items.filter((it) => String(it.notes || '') === LODGING_NOTE);
  const products = items.filter((it) => String(it.notes || '') !== LODGING_NOTE);
  return {
    ...order,
    items,
    lodging_total: sumItems(lodging),
    products_total: sumItems(products),
    account_total: round2(Number(order.total || 0)),
  };
}

function decorateRoom(room) {
  if (!room) return null;
  const account = loadOrderBundle(room.current_order_id);
  const open = account
    && String(account.payment_status || 'pending') !== 'paid'
    && String(account.status || '') !== 'cancelled';
  return {
    ...room,
    caja_name: getActiveCajaById(room.caja_station_id)?.name || '',
    account: open ? account : null,
    account_total: open ? round2(Number(account.total || 0)) : 0,
  };
}

function listRooms(user) {
  assertHotelEnabled();
  let rooms = queryAll('SELECT * FROM hotel_rooms ORDER BY number ASC');
  const role = String(user?.role || '').toLowerCase();
  if (role === 'cajero') {
    const mine = staffCajaId(user);
    rooms = rooms.filter((r) => String(r.caja_station_id || '').trim() === mine);
  }
  return rooms.map(decorateRoom);
}

function getRoom(id, user) {
  assertHotelEnabled();
  const room = queryOne('SELECT * FROM hotel_rooms WHERE id = ?', [id]);
  if (!room) throw httpError('Habitación no encontrada', 404);
  assertCanOperateRoom(user, room);
  return decorateRoom(room);
}

function normalizeNumber(raw) {
  return String(raw || '').trim();
}

function assertUniqueNumber(number, exceptId) {
  const key = number.toLowerCase();
  const rows = queryAll('SELECT id, number FROM hotel_rooms');
  const dup = rows.find((r) => String(r.number || '').trim().toLowerCase() === key && r.id !== exceptId);
  if (dup) throw httpError(`La habitación ${number} ya existe`);
}

function resolveCaja(cajaId) {
  const id = String(cajaId || '').trim();
  const caja = getActiveCajaById(id);
  if (!caja) throw httpError('Seleccione una caja activa para la habitación');
  return caja.id;
}

function createRoom(body, user) {
  assertHotelEnabled();
  const number = normalizeNumber(body?.number);
  if (!number) throw httpError('El número de habitación es obligatorio');
  assertUniqueNumber(number, '');
  const rate = round2(body?.nightly_rate);
  if (!(rate > 0)) throw httpError('Indique el costo por noche');
  const cajaId = resolveCaja(body?.caja_station_id);
  const role = String(user?.role || '').toLowerCase();
  if (role !== 'admin' && role !== 'master_admin') {
    throw httpError('Solo el administrador crea habitaciones', 403);
  }
  const restaurant = queryOne('SELECT id FROM restaurants LIMIT 1');
  const id = uuidv4();
  const capacity = Math.max(1, Math.floor(Number(body?.capacity) || 2));
  runSql(
    `INSERT INTO hotel_rooms (
      id, number, name, floor, capacity, nightly_rate, status, caja_station_id, restaurant_id, notes
    ) VALUES (?, ?, ?, ?, ?, ?, 'available', ?, ?, ?)`,
    [
      id,
      number,
      String(body?.name || '').trim() || `Habitación ${number}`,
      String(body?.floor || '').trim(),
      capacity,
      rate,
      cajaId,
      restaurant?.id || '',
      String(body?.notes || '').trim(),
    ]
  );
  return getRoom(id, user);
}

function updateRoom(id, body, user) {
  assertHotelEnabled();
  const current = queryOne('SELECT * FROM hotel_rooms WHERE id = ?', [id]);
  if (!current) throw httpError('Habitación no encontrada', 404);
  const role = String(user?.role || '').toLowerCase();
  if (role !== 'admin' && role !== 'master_admin') {
    throw httpError('Solo el administrador edita la ficha de la habitación', 403);
  }
  const number = body?.number != null ? normalizeNumber(body.number) : current.number;
  if (!number) throw httpError('El número de habitación es obligatorio');
  assertUniqueNumber(number, id);
  const rate = body?.nightly_rate != null ? round2(body.nightly_rate) : Number(current.nightly_rate || 0);
  if (!(rate > 0)) throw httpError('Indique el costo por noche');
  if (current.status === 'occupied' && Math.abs(rate - Number(current.nightly_rate || 0)) > 0.001) {
    throw httpError('No cambie el costo por noche mientras la habitación está ocupada');
  }
  const cajaId = body?.caja_station_id != null ? resolveCaja(body.caja_station_id) : String(current.caja_station_id || '').trim();
  if (current.status === 'occupied' && cajaId !== String(current.caja_station_id || '').trim()) {
    throw httpError('No cambie la caja mientras la habitación está ocupada');
  }
  runSql(
    `UPDATE hotel_rooms SET
      number = ?, name = ?, floor = ?, capacity = ?, nightly_rate = ?, caja_station_id = ?, notes = ?,
      updated_at = datetime('now')
     WHERE id = ?`,
    [
      number,
      String(body?.name ?? current.name ?? '').trim() || `Habitación ${number}`,
      String(body?.floor ?? current.floor ?? '').trim(),
      Math.max(1, Math.floor(Number(body?.capacity ?? current.capacity) || 2)),
      rate,
      cajaId,
      String(body?.notes ?? current.notes ?? '').trim(),
      id,
    ]
  );
  return getRoom(id, user);
}

function deleteRoom(id, user) {
  assertHotelEnabled();
  const room = queryOne('SELECT * FROM hotel_rooms WHERE id = ?', [id]);
  if (!room) throw httpError('Habitación no encontrada', 404);
  if (room.status === 'occupied') throw httpError('No se puede eliminar una habitación ocupada');
  const role = String(user?.role || '').toLowerCase();
  if (role !== 'admin' && role !== 'master_admin') {
    throw httpError('Solo el administrador elimina habitaciones', 403);
  }
  runSql('DELETE FROM hotel_rooms WHERE id = ?', [id]);
  return { ok: true };
}

function parseNights(raw) {
  const nights = Math.floor(Number(raw));
  if (!Number.isFinite(nights) || nights < 1 || nights > 365) {
    throw httpError('Indique las noches (1 a 365)');
  }
  return nights;
}

function guestFromBody(body) {
  const guestName = String(body?.guest_name || '').trim();
  const docType = String(body?.guest_doc_type || 'DNI').trim();
  const docNumber = String(body?.guest_doc_number || '').trim();
  const phone = String(body?.guest_phone || '').trim();
  const email = String(body?.guest_email || '').trim();
  if (!guestName) throw httpError('Indique el nombre del huésped');
  if (!DOC_TYPES.includes(docType)) throw httpError('Tipo de documento no válido');
  if (!docNumber) throw httpError('Indique el número de documento');
  if (!phone) throw httpError('Indique el teléfono del huésped');
  return { guestName, docType, docNumber, phone, email };
}

function writeLodgingLine(tx, orderId, room) {
  const nights = Math.max(1, Number(room.nights) || 1);
  const rate = round2(room.nightly_rate);
  const subtotal = round2(nights * rate);
  const name = lodgingLabel({ ...room, nights });
  const existing = tx.queryOne(
    "SELECT id FROM order_items WHERE order_id = ? AND notes = ? LIMIT 1",
    [orderId, LODGING_NOTE]
  );
  if (existing) {
    tx.run(
      `UPDATE order_items SET product_name = ?, quantity = ?, unit_price = ?, subtotal = ?, original_unit_price = ?
       WHERE id = ?`,
      [name, nights, rate, subtotal, rate, existing.id]
    );
    return;
  }
  tx.run(
    `INSERT INTO order_items (
      id, order_id, product_id, product_name, variant_name, quantity, unit_price, subtotal, notes,
      original_unit_price, promo_discount, promotion_id, promotion_label
    ) VALUES (?, ?, '', ?, 'hospedaje', ?, ?, ?, ?, ?, 0, '', '')`,
    [uuidv4(), orderId, name, nights, rate, subtotal, LODGING_NOTE, rate]
  );
}

function recalcOrderTotals(tx, orderId) {
  const items = tx.queryAll('SELECT subtotal FROM order_items WHERE order_id = ?', [orderId]);
  const subtotal = sumItems(items);
  const order = tx.queryOne('SELECT discount, delivery_fee FROM orders WHERE id = ?', [orderId]);
  const discount = Number(order?.discount || 0);
  const deliveryFee = Number(order?.delivery_fee || 0);
  const total = Math.max(0, round2(subtotal - discount + deliveryFee));
  tx.run(
    "UPDATE orders SET subtotal = ?, total = ?, updated_at = datetime('now') WHERE id = ?",
    [subtotal, total, orderId]
  );
  return total;
}

function checkIn(id, body, user) {
  assertHotelEnabled();
  const room = queryOne('SELECT * FROM hotel_rooms WHERE id = ?', [id]);
  if (!room) throw httpError('Habitación no encontrada', 404);
  assertCanOperateRoom(user, room);
  if (room.status === 'maintenance') throw httpError('La habitación está en mantenimiento');
  if (room.status === 'occupied') throw httpError('La habitación ya está ocupada');
  if (!(Number(room.nightly_rate) > 0)) throw httpError('La habitación no tiene costo por noche');
  const guest = guestFromBody(body);
  const nights = parseNights(body?.nights);
  const checkIn = getBusinessTodayDateKey(queryOne);
  const checkOut = shiftBusinessDateKey(checkIn, nights);
  const restaurant = queryOne('SELECT id FROM restaurants LIMIT 1');
  const orderId = uuidv4();
  const tableLabel = `Hab ${room.number}`;

  withTransaction((tx) => {
    let seq = tx.queryOne('SELECT current_number FROM order_sequence WHERE id = 1');
    if (!seq) {
      tx.run('INSERT INTO order_sequence (id, current_number) VALUES (1, 0)');
      seq = { current_number: 0 };
    }
    const orderNumber = Number(seq.current_number || 0) + 1;
    tx.run('UPDATE order_sequence SET current_number = ? WHERE id = 1', [orderNumber]);
    const stay = { ...room, nights };
    const lodgingTotal = round2(nights * Number(room.nightly_rate || 0));
    tx.run(
      `INSERT INTO orders (
        id, order_number, customer_name, restaurant_id, type, status, subtotal, tax, discount, delivery_fee, total,
        payment_method, payment_status, table_number, notes, created_by_user_id, created_by_user_name, hotel_room_id
      ) VALUES (?, ?, ?, ?, 'dine_in', 'pending', ?, 0, 0, 0, ?, 'efectivo', 'pending', ?, ?, ?, ?, ?)`,
      [
        orderId,
        orderNumber,
        guest.guestName,
        restaurant?.id || '',
        lodgingTotal,
        lodgingTotal,
        tableLabel,
        `Habitación ${room.number}`,
        user?.id || '',
        user?.full_name || user?.username || '',
        room.id,
      ]
    );
    writeLodgingLine(tx, orderId, stay);
    recalcOrderTotals(tx, orderId);
    tx.run(
      `UPDATE hotel_rooms SET
        status = 'occupied', guest_name = ?, guest_doc_type = ?, guest_doc_number = ?, guest_phone = ?, guest_email = ?,
        check_in = ?, check_out = ?, nights = ?, current_order_id = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [
        guest.guestName, guest.docType, guest.docNumber, guest.phone, guest.email,
        checkIn, checkOut, nights, orderId, room.id,
      ]
    );
  });

  return getRoom(id, user);
}

function updateStay(id, body, user) {
  assertHotelEnabled();
  const room = queryOne('SELECT * FROM hotel_rooms WHERE id = ?', [id]);
  if (!room) throw httpError('Habitación no encontrada', 404);
  assertCanOperateRoom(user, room);
  if (room.status !== 'occupied') throw httpError('La habitación no está ocupada');
  const guest = guestFromBody({
    guest_name: body?.guest_name ?? room.guest_name,
    guest_doc_type: body?.guest_doc_type ?? room.guest_doc_type,
    guest_doc_number: body?.guest_doc_number ?? room.guest_doc_number,
    guest_phone: body?.guest_phone ?? room.guest_phone,
    guest_email: body?.guest_email ?? room.guest_email,
  });
  const nights = body?.nights != null ? parseNights(body.nights) : Math.max(1, Number(room.nights) || 1);
  const checkIn = String(room.check_in || '').trim() || getBusinessTodayDateKey(queryOne);
  const checkOut = shiftBusinessDateKey(checkIn, nights);
  const orderId = String(room.current_order_id || '').trim();
  if (!orderId) throw httpError('La habitación no tiene cuenta abierta');

  withTransaction((tx) => {
    const order = tx.queryOne('SELECT payment_status, status FROM orders WHERE id = ?', [orderId]);
    if (!order || String(order.payment_status || '') === 'paid' || order.status === 'cancelled') {
      throw httpError('La cuenta de la habitación ya no está abierta');
    }
    tx.run(
      `UPDATE hotel_rooms SET
        guest_name = ?, guest_doc_type = ?, guest_doc_number = ?, guest_phone = ?, guest_email = ?,
        nights = ?, check_in = ?, check_out = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [guest.guestName, guest.docType, guest.docNumber, guest.phone, guest.email, nights, checkIn, checkOut, id]
    );
    tx.run(
      "UPDATE orders SET customer_name = ?, updated_at = datetime('now') WHERE id = ?",
      [guest.guestName, orderId]
    );
    writeLodgingLine(tx, orderId, { ...room, nights });
    recalcOrderTotals(tx, orderId);
  });
  return getRoom(id, user);
}

function addItems(id, items, user) {
  assertHotelEnabled();
  const room = queryOne('SELECT * FROM hotel_rooms WHERE id = ?', [id]);
  if (!room) throw httpError('Habitación no encontrada', 404);
  assertCanOperateRoom(user, room);
  if (room.status !== 'occupied') throw httpError('Primero registre el ingreso del huésped');
  const orderId = String(room.current_order_id || '').trim();
  if (!orderId) throw httpError('La habitación no tiene cuenta abierta');
  if (!Array.isArray(items) || !items.length) throw httpError('Agregue al menos un producto');

  const result = withTransaction((tx) => {
    const order = tx.queryOne('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!order || String(order.payment_status || '') === 'paid') {
      throw httpError('La cuenta de la habitación ya no está abierta');
    }
    return appendItemsToOrderInTransaction(tx, orderId, items, { kind: 'staff', user }, {});
  });
  return { room: getRoom(id, user), newItemIds: result?.newItemIds || [], orderId };
}

function setMaintenance(id, enabled, user) {
  assertHotelEnabled();
  const room = queryOne('SELECT * FROM hotel_rooms WHERE id = ?', [id]);
  if (!room) throw httpError('Habitación no encontrada', 404);
  if (room.status === 'occupied') throw httpError('No puede pasar a mantenimiento una habitación ocupada');
  const role = String(user?.role || '').toLowerCase();
  if (role !== 'admin' && role !== 'master_admin') {
    throw httpError('Solo el administrador cambia el mantenimiento', 403);
  }
  runSql(
    "UPDATE hotel_rooms SET status = ?, updated_at = datetime('now') WHERE id = ?",
    [enabled ? 'maintenance' : 'available', id]
  );
  return getRoom(id, user);
}

function releaseRoomTx(tx, hotelRoomId) {
  const id = String(hotelRoomId || '').trim();
  if (!id) return;
  tx.run(
    `UPDATE hotel_rooms SET
      status = 'available',
      guest_name = '', guest_doc_type = 'DNI', guest_doc_number = '', guest_phone = '', guest_email = '',
      check_in = '', check_out = '', nights = 0, current_order_id = '',
      updated_at = datetime('now')
     WHERE id = ?`,
    [id]
  );
}

function findRoomByNumber(raw) {
  const key = String(raw || '').trim().toLowerCase();
  if (!key) return null;
  const rooms = queryAll('SELECT * FROM hotel_rooms');
  return rooms.find((r) => String(r.number || '').trim().toLowerCase() === key) || null;
}

function openOrderForRoom(room) {
  if (!room || room.status !== 'occupied') return null;
  const id = String(room.current_order_id || '').trim();
  if (!id) return null;
  const order = queryOne(
    "SELECT * FROM orders WHERE id = ? AND IFNULL(payment_status, 'pending') != 'paid' AND status != 'cancelled'",
    [id]
  );
  return order || null;
}

module.exports = {
  LODGING_NOTE,
  DOC_TYPES,
  assertHotelEnabled,
  listRooms,
  getRoom,
  createRoom,
  updateRoom,
  deleteRoom,
  checkIn,
  updateStay,
  addItems,
  setMaintenance,
  releaseRoomTx,
  findRoomByNumber,
  openOrderForRoom,
};
