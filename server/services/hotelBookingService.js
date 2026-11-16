const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, runSql, withTransaction } = require('../database');
const { getBusinessTodayDateKey, shiftBusinessDateKey } = require('../utils/appDateTime');
const hotel = require('./hotelService');

const CHANNELS = ['recepcion', 'web', 'instagram', 'facebook', 'whatsapp', 'tiktok'];
const DOC_TYPES = ['DNI', 'CE', 'Pasaporte', 'RUC'];
const HOLD_MINUTES = 15;

function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function dateKey(raw) {
  const key = String(raw || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw httpError('Use fechas en formato AAAA-MM-DD');
  return key;
}

function nightsBetween(checkIn, checkOut) {
  let nights = 0;
  let cursor = checkIn;
  while (cursor < checkOut && nights < 366) {
    nights += 1;
    cursor = shiftBusinessDateKey(cursor, 1);
  }
  return nights;
}

function weekday(date) {
  const [y, m, d] = date.split('-').map((n) => Number(n));
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
}

function quoteNights(nightly, weekend, checkIn, checkOut) {
  let total = 0;
  let cursor = checkIn;
  while (cursor < checkOut) {
    const day = weekday(cursor);
    const useWeekend = (day === 5 || day === 6) && Number(weekend) > 0;
    total += useWeekend ? Number(weekend) : Number(nightly || 0);
    cursor = shiftBusinessDateKey(cursor, 1);
  }
  return round2(total);
}

function parseJsonList(raw) {
  try {
    const parsed = JSON.parse(String(raw || '[]'));
    return Array.isArray(parsed) ? parsed.map((x) => String(x || '').trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function assertRange(checkIn, checkOut) {
  const start = dateKey(checkIn);
  const end = dateKey(checkOut);
  if (!(end > start)) throw httpError('La salida debe ser posterior a la entrada');
  const nights = nightsBetween(start, end);
  if (nights < 1 || nights > 60) throw httpError('La estadía puede ser de 1 a 60 noches');
  return { checkIn: start, checkOut: end, nights };
}

function normalizeChannel(raw, fallback = 'web') {
  const id = String(raw || '').trim().toLowerCase();
  if (CHANNELS.includes(id)) return id;
  return fallback;
}

function guestFromBody(body, { requireDoc = true } = {}) {
  const guestName = String(body?.guest_name || body?.nombre || '').trim();
  const docType = String(body?.guest_doc_type || body?.tipo_documento || 'DNI').trim();
  const docNumber = String(body?.guest_doc_number || body?.numero_documento || '').trim();
  const phone = String(body?.guest_phone || body?.telefono || body?.whatsapp || '').trim();
  const email = String(body?.guest_email || body?.correo || '').trim();
  const nationality = String(body?.nationality || body?.nacionalidad || '').trim();
  const arrival = String(body?.arrival_time || body?.hora_llegada || '').trim();
  if (!guestName) throw httpError('Indique el nombre del huésped');
  if (!DOC_TYPES.includes(docType)) throw httpError('Tipo de documento no válido');
  if (requireDoc && !docNumber) throw httpError('Indique el número de documento');
  if (!phone) throw httpError('Indique el teléfono o WhatsApp');
  return { guestName, docType, docNumber, phone, email, nationality, arrival };
}

function nowIso() {
  return new Date().toISOString();
}

function holdUntil() {
  return new Date(Date.now() + HOLD_MINUTES * 60 * 1000).toISOString();
}

function blockingSql(exceptId) {
  const except = exceptId ? 'AND b.id != ?' : '';
  return `
    SELECT br.room_id
    FROM hotel_booking_rooms br
    JOIN hotel_bookings b ON b.id = br.booking_id
    WHERE IFNULL(br.released, 0) = 0
      AND b.check_in < ?
      AND b.check_out > ?
      AND (
        b.status IN ('confirmada', 'check_in')
        OR (b.status = 'pendiente_pago' AND IFNULL(b.expires_at, '') > ?)
      )
      ${except}
  `;
}

function blockedRoomIds(checkIn, checkOut, exceptId = '') {
  const params = [checkOut, checkIn, nowIso()];
  if (exceptId) params.push(exceptId);
  return new Set(queryAll(blockingSql(exceptId), params).map((row) => String(row.room_id)));
}

function roomCanHost(room, checkIn, adults, children) {
  if (!room) return false;
  if (room.status === 'maintenance') return false;
  const pax = Math.max(1, Number(adults || 1) + Number(children || 0));
  if (Number(room.capacity || 0) > 0 && Number(room.capacity) < pax) return false;
  if (room.status === 'occupied') {
    const out = String(room.check_out || '').trim();
    if (!out || checkIn < out) return false;
  }
  return true;
}

function listCandidateRooms(checkIn, checkOut, { adults = 1, children = 0, typeId = '', exceptId = '' } = {}) {
  const blocked = blockedRoomIds(checkIn, checkOut, exceptId);
  return queryAll('SELECT * FROM hotel_rooms ORDER BY number ASC').filter((room) => {
    if (typeId && String(room.room_type_id || '') !== typeId) return false;
    if (blocked.has(String(room.id))) return false;
    return roomCanHost(room, checkIn, adults, children);
  });
}

function decorateType(row, freeCount, checkIn, checkOut) {
  const nightly = Number(row.nightly_rate || 0);
  const weekend = Number(row.weekend_rate || 0);
  return {
    id: row.id,
    nombre: row.name,
    descripcion: row.description || '',
    capacidad_adultos: Number(row.adults || 0),
    capacidad_ninos: Number(row.children || 0),
    precio_noche: nightly,
    precio_fin_semana: weekend,
    amenidades: parseJsonList(row.amenities_json),
    imagenes: parseJsonList(row.images_json),
    cantidad_libre: freeCount,
    precio_total: quoteNights(nightly, weekend, checkIn, checkOut),
    noches: nightsBetween(checkIn, checkOut),
  };
}

function searchAvailability({ checkIn, checkOut, adults = 1, children = 0 }) {
  hotel.assertHotelEnabled();
  const range = assertRange(checkIn, checkOut);
  const paxAdults = Math.max(1, Math.floor(Number(adults) || 1));
  const paxChildren = Math.max(0, Math.floor(Number(children) || 0));
  const types = queryAll('SELECT * FROM hotel_room_types WHERE IFNULL(active, 1) = 1 ORDER BY name ASC');
  const availableTypes = types
    .filter((type) => Number(type.adults || 0) >= paxAdults && Number(type.children || 0) >= paxChildren)
    .map((type) => {
      const free = listCandidateRooms(range.checkIn, range.checkOut, {
        adults: paxAdults,
        children: paxChildren,
        typeId: type.id,
      });
      return decorateType(type, free.length, range.checkIn, range.checkOut);
    })
    .filter((type) => type.cantidad_libre > 0);
  const rooms = listCandidateRooms(range.checkIn, range.checkOut, {
    adults: paxAdults,
    children: paxChildren,
  }).map((room) => ({
    id: room.id,
    number: room.number,
    name: room.name,
    floor: room.floor,
    nightly_rate: Number(room.nightly_rate || 0),
    room_type_id: room.room_type_id || '',
    caja_name: String(room.caja_station_id || '').trim() ? '' : 'Recepción',
  }));
  return {
    check_in: range.checkIn,
    check_out: range.checkOut,
    nights: range.nights,
    adults: paxAdults,
    children: paxChildren,
    types: availableTypes,
    rooms,
  };
}

function makeCode() {
  for (let i = 0; i < 8; i += 1) {
    const code = `RES-${Math.floor(1000 + Math.random() * 9000)}`;
    if (!queryOne('SELECT id FROM hotel_bookings WHERE code = ?', [code])) return code;
  }
  return `RES-${String(Date.now()).slice(-6)}`;
}

function hotelWhatsapp() {
  const restaurant = queryOne('SELECT name, phone FROM restaurants LIMIT 1') || {};
  let whatsapp = String(restaurant.phone || '').replace(/\D/g, '');
  try {
    const row = queryOne("SELECT value FROM app_settings WHERE key = 'mi_restaurant' LIMIT 1");
    const parsed = JSON.parse(row?.value || '{}');
    const fromSettings = String(parsed?.general?.whatsapp || '').replace(/\D/g, '');
    if (fromSettings) whatsapp = fromSettings;
  } catch (_) {
    /* el teléfono del local alcanza */
  }
  return { name: restaurant.name || 'Hotel', whatsapp };
}

function whatsappUrl(booking) {
  const hotelInfo = hotelWhatsapp();
  const digits = hotelInfo.whatsapp;
  if (!digits) return '';
  const text = [
    `Hola, soy ${booking.guest_name}.`,
    `Reserva ${booking.code}.`,
    `Entrada ${booking.check_in}, salida ${booking.check_out}.`,
    `Total hospedaje S/ ${Number(booking.lodging_total || 0).toFixed(2)}.`,
    'Adjunto el comprobante de pago.',
  ].join(' ');
  const phone = digits.startsWith('51') ? digits : `51${digits}`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

function loadBooking(idOrCode, { byCode = false } = {}) {
  const row = byCode
    ? queryOne('SELECT * FROM hotel_bookings WHERE code = ?', [String(idOrCode || '').trim().toUpperCase()])
    : queryOne('SELECT * FROM hotel_bookings WHERE id = ?', [idOrCode]);
  if (!row) throw httpError('Reserva no encontrada', 404);
  const rooms = queryAll(
    `SELECT br.*, r.number AS room_number, r.name AS room_name
     FROM hotel_booking_rooms br
     LEFT JOIN hotel_rooms r ON r.id = br.room_id
     WHERE br.booking_id = ?`,
    [row.id]
  );
  const guests = queryAll('SELECT * FROM hotel_booking_guests WHERE booking_id = ?', [row.id]);
  const expired = row.status === 'pendiente_pago' && String(row.expires_at || '') && String(row.expires_at) <= nowIso();
  return {
    ...row,
    code: row.code,
    expired,
    rooms,
    guests,
    whatsapp_url: whatsappUrl(row),
  };
}

function publicView(booking) {
  return {
    codigo_reserva: booking.code,
    estado: booking.expired ? 'expirada' : booking.status,
    fecha_checkin: booking.check_in,
    fecha_checkout: booking.check_out,
    huesped: booking.guest_name,
    total_hospedaje: Number(booking.lodging_total || 0),
    total_pagado: Number(booking.paid_total || 0),
    expira_en: booking.expires_at || '',
    habitaciones: (booking.rooms || []).map((room) => ({
      numero: room.room_number || '',
      nombre: room.room_name || '',
      tarifa: Number(room.agreed_rate || 0),
    })),
    whatsapp_url: booking.whatsapp_url || '',
  };
}

function insertBookingTx(tx, payload) {
  const id = uuidv4();
  tx.run(
    `INSERT INTO hotel_bookings (
      id, code, guest_name, guest_doc_type, guest_doc_number, guest_phone, guest_email, nationality, arrival_time,
      check_in, check_out, adults, children, channel, status, lodging_total, paid_total, notes, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      payload.code,
      payload.guest.guestName,
      payload.guest.docType,
      payload.guest.docNumber,
      payload.guest.phone,
      payload.guest.email,
      payload.guest.nationality,
      payload.guest.arrival,
      payload.checkIn,
      payload.checkOut,
      payload.adults,
      payload.children,
      payload.channel,
      payload.status,
      payload.lodgingTotal,
      payload.paidTotal || 0,
      payload.notes || '',
      payload.expiresAt || '',
    ]
  );
  for (const room of payload.rooms) {
    tx.run(
      'INSERT INTO hotel_booking_rooms (id, booking_id, room_id, agreed_rate) VALUES (?, ?, ?, ?)',
      [uuidv4(), id, room.id, room.rate]
    );
    tx.run(
      `INSERT INTO hotel_booking_guests (id, booking_id, room_id, full_name, doc_type, doc_number, nationality)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), id, room.id, payload.guest.guestName, payload.guest.docType, payload.guest.docNumber, payload.guest.nationality]
    );
  }
  return id;
}

function createBooking(body, { publicHold = false, user = null } = {}) {
  hotel.assertHotelEnabled();
  const range = assertRange(body?.check_in || body?.fecha_checkin, body?.check_out || body?.fecha_checkout);
  const guest = guestFromBody(body, { requireDoc: true });
  const adults = Math.max(1, Math.floor(Number(body?.adults ?? body?.cantidad_adultos) || 1));
  const children = Math.max(0, Math.floor(Number(body?.children ?? body?.cantidad_ninos) || 0));
  const channel = normalizeChannel(body?.channel || body?.canal_origen || body?.origen, publicHold ? 'web' : 'recepcion');
  const typeId = String(body?.room_type_id || body?.tipo_habitacion_id || '').trim();
  const requestedRoom = String(body?.room_id || body?.habitacion_id || '').trim();
  const notes = String(body?.notes || body?.observaciones || '').trim();
  const code = makeCode();

  const id = withTransaction((tx) => {
    const blocked = new Set(
      tx.queryAll(blockingSql(''), [range.checkOut, range.checkIn, nowIso()]).map((row) => String(row.room_id))
    );
    const rooms = tx.queryAll('SELECT * FROM hotel_rooms ORDER BY number ASC').filter((room) => {
      if (requestedRoom && room.id !== requestedRoom) return false;
      if (typeId && String(room.room_type_id || '') !== typeId) return false;
      if (blocked.has(String(room.id))) return false;
      return roomCanHost(room, range.checkIn, adults, children);
    });
    const chosen = requestedRoom ? rooms.filter((room) => room.id === requestedRoom) : rooms.slice(0, 1);
    if (!chosen.length) throw httpError('No hay habitación libre en esas fechas');
    let lodgingTotal = 0;
    const priced = chosen.map((room) => {
      let nightly = Number(room.nightly_rate || 0);
      let weekend = 0;
      if (room.room_type_id) {
        const type = tx.queryOne('SELECT * FROM hotel_room_types WHERE id = ?', [room.room_type_id]);
        if (type && Number(type.nightly_rate) > 0) {
          nightly = Number(type.nightly_rate);
          weekend = Number(type.weekend_rate || 0);
        }
      }
      const rate = quoteNights(nightly, weekend, range.checkIn, range.checkOut);
      lodgingTotal += rate;
      return { id: room.id, rate: round2(rate / range.nights) };
    });
    lodgingTotal = round2(lodgingTotal);
    const status = publicHold ? 'pendiente_pago' : 'confirmada';
    return insertBookingTx(tx, {
      code,
      guest,
      checkIn: range.checkIn,
      checkOut: range.checkOut,
      adults,
      children,
      channel,
      status,
      lodgingTotal,
      paidTotal: 0,
      notes,
      expiresAt: publicHold ? holdUntil() : '',
      rooms: priced,
    });
  });
  const booking = loadBooking(id);
  if (user) return booking;
  return publicView(booking);
}

function listBookings(query = {}) {
  hotel.assertHotelEnabled();
  const from = String(query.from || '').trim();
  const rows = queryAll('SELECT * FROM hotel_bookings ORDER BY check_in ASC, created_at DESC LIMIT 200');
  return rows
    .filter((row) => !from || String(row.check_out || '') >= from)
    .map((row) => loadBooking(row.id))
    .filter((row) => row.status !== 'cancelada' || query.include_cancelled);
}

function confirmBooking(id, body = {}) {
  hotel.assertHotelEnabled();
  const booking = loadBooking(id);
  if (booking.expired) throw httpError('La reserva ya venció. Créela de nuevo.');
  if (!['pendiente_pago', 'confirmada'].includes(booking.status)) {
    throw httpError('Esta reserva ya no se puede confirmar');
  }
  const paid = round2(body.paid_total ?? body.adelanto ?? booking.paid_total);
  runSql(
    "UPDATE hotel_bookings SET status = 'confirmada', paid_total = ?, expires_at = '', updated_at = datetime('now') WHERE id = ?",
    [paid, booking.id]
  );
  return loadBooking(booking.id);
}

function cancelBooking(id) {
  hotel.assertHotelEnabled();
  const booking = loadBooking(id);
  if (booking.status === 'check_in') throw httpError('La reserva ya tiene ingreso. Use la salida de la habitación.');
  runSql("UPDATE hotel_bookings SET status = 'cancelada', updated_at = datetime('now') WHERE id = ?", [booking.id]);
  return loadBooking(booking.id);
}

function checkInBooking(id, user) {
  hotel.assertHotelEnabled();
  const booking = loadBooking(id);
  if (booking.expired) throw httpError('La reserva venció. Confírmela de nuevo o cree otra.');
  if (!['confirmada', 'pendiente_pago'].includes(booking.status)) {
    throw httpError('Esta reserva no está lista para el ingreso');
  }
  const rooms = (booking.rooms || []).filter((room) => !Number(room.released));
  if (!rooms.length) throw httpError('La reserva no tiene habitaciones');
  for (const room of rooms) {
    hotel.checkIn(room.room_id, {
      guest_name: booking.guest_name,
      guest_doc_type: booking.guest_doc_type,
      guest_doc_number: booking.guest_doc_number,
      guest_phone: booking.guest_phone,
      guest_email: booking.guest_email,
      check_in: booking.check_in,
      check_out: booking.check_out,
      agreed_rate: room.agreed_rate,
    }, user);
  }
  runSql("UPDATE hotel_bookings SET status = 'check_in', expires_at = '', updated_at = datetime('now') WHERE id = ?", [booking.id]);
  return loadBooking(booking.id);
}

function saveRoomType(body, id = '') {
  hotel.assertHotelEnabled();
  const name = String(body?.name || body?.nombre || '').trim();
  if (!name) throw httpError('Indique el nombre del tipo');
  const nightly = round2(body?.nightly_rate ?? body?.precio_noche);
  if (!(nightly > 0)) throw httpError('Indique el precio por noche');
  const amenities = Array.isArray(body?.amenities || body?.amenidades)
    ? (body.amenities || body.amenidades)
    : String(body?.amenities || body?.amenidades || '').split(',').map((x) => x.trim()).filter(Boolean);
  const images = Array.isArray(body?.images || body?.imagenes)
    ? (body.images || body.imagenes)
    : String(body?.images || body?.imagenes || '').split(',').map((x) => x.trim()).filter(Boolean);
  const values = [
    name,
    String(body?.description || body?.descripcion || '').trim(),
    Math.max(1, Math.floor(Number(body?.adults ?? body?.capacidad_adultos) || 2)),
    Math.max(0, Math.floor(Number(body?.children ?? body?.capacidad_ninos) || 0)),
    nightly,
    round2(body?.weekend_rate ?? body?.precio_fin_semana),
    JSON.stringify(amenities),
    JSON.stringify(images),
    body?.active === false || body?.activo === false ? 0 : 1,
  ];
  if (id) {
    runSql(
      `UPDATE hotel_room_types SET
        name = ?, description = ?, adults = ?, children = ?, nightly_rate = ?, weekend_rate = ?,
        amenities_json = ?, images_json = ?, active = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [...values, id]
    );
    return queryOne('SELECT * FROM hotel_room_types WHERE id = ?', [id]);
  }
  const newId = uuidv4();
  const restaurant = queryOne('SELECT id FROM restaurants LIMIT 1');
  runSql(
    `INSERT INTO hotel_room_types (
      id, name, description, adults, children, nightly_rate, weekend_rate, amenities_json, images_json, active, restaurant_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [newId, ...values, restaurant?.id || '']
  );
  return queryOne('SELECT * FROM hotel_room_types WHERE id = ?', [newId]);
}

function listRoomTypes() {
  hotel.assertHotelEnabled();
  return queryAll('SELECT * FROM hotel_room_types ORDER BY name ASC').map((row) => ({
    ...row,
    amenities: parseJsonList(row.amenities_json),
    images: parseJsonList(row.images_json),
  }));
}

module.exports = {
  HOLD_MINUTES,
  searchAvailability,
  createBooking,
  listBookings,
  loadBooking,
  publicView,
  confirmBooking,
  cancelBooking,
  checkInBooking,
  saveRoomType,
  listRoomTypes,
  getBusinessTodayDateKey,
};
