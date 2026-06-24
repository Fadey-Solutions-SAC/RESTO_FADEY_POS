const { queryAll, queryOne, runSql } = require('../database');
const { getOrderWithItems } = require('../orderCreateService');
const { getSocketIo, emitStaffDataUpdate } = require('../socketBroadcast');
const {
  RESERVATION_KITCHEN_PREP_MINUTES,
  RESERVATION_CAJA_VERIFY_MINUTES,
  RESERVATION_CAJA_ALERT_MAX_HOURS_AFTER,
  RESERVATION_SCHEDULER_INTERVAL_MS,
} = require('../constants/reservationTiming');
const {
  parseReservationLocalDateTime,
  reservationLocalSqlExpr,
} = require('./reservationDateTime');
const { scheduleKitchenBarAutoPrint } = require('./kitchenBarAutoPrintService');

let schedulerTimer = null;
let tickInFlight = false;

function reservationMarker(reservationId) {
  return `RESERVA_ID:${reservationId}`;
}

function hasAssignedTable(reservation) {
  return Boolean(String(reservation?.table_id || '').trim());
}

function getReservationTableLabel(reservation) {
  if (!hasAssignedTable(reservation)) return 'Sin mesa asignada';
  const table = queryOne('SELECT number, name, zone FROM tables WHERE id = ?', [reservation.table_id]);
  if (!table) return 'Mesa asignada';
  const base = table.name || `Mesa ${table.number}`;
  const zone = String(table.zone || '').trim();
  return zone ? `${base} (${zone})` : base;
}

function findLinkedOrders(reservationId) {
  const marker = `%${reservationMarker(reservationId)}%`;
  return queryAll(
    `SELECT * FROM orders
     WHERE notes LIKE ?
       AND status IN ('pending','preparing')
     ORDER BY created_at ASC`,
    [marker]
  );
}

function findAllLinkedOrders(reservationId) {
  const marker = `%${reservationMarker(reservationId)}%`;
  return queryAll(
    `SELECT * FROM orders
     WHERE notes LIKE ?
       AND status != 'cancelled'
     ORDER BY created_at ASC`,
    [marker]
  );
}

function isOrderOutOfKitchen(order) {
  const status = String(order?.status || '').toLowerCase();
  return status === 'ready' || status === 'delivered';
}

/**
 * El aviso a caja permanece hasta: pedido fuera de cocina (si hay pedido) o T+2 h.
 * La mesa ya asignada no omite el aviso: caja debe verificar mesa, zona, decoración, etc.
 */
function isReservationCajaAlertActive(reservation) {
  if (!reservation) return false;
  if (!['confirmed', 'pending'].includes(String(reservation.status || ''))) return false;
  if (!String(reservation.caja_verify_sent_at || '').trim()) return false;

  const resAt = parseReservationLocalDateTime(reservation.date, reservation.time);
  if (!resAt) return false;

  const maxUntil = new Date(resAt.getTime() + RESERVATION_CAJA_ALERT_MAX_HOURS_AFTER * 60 * 60 * 1000);
  if (new Date() >= maxUntil) return false;

  const linked = findAllLinkedOrders(reservation.id);
  if (linked.length > 0 && linked.every(isOrderOutOfKitchen)) return false;

  return true;
}

function releaseReservationKitchenOrders(reservation) {
  const linked = findLinkedOrders(reservation.id).filter((o) => String(o.kitchen_release_at || '').trim());
  if (linked.length === 0) {
    runSql(
      "UPDATE reservations SET kitchen_prep_sent_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND kitchen_prep_sent_at IS NULL",
      [reservation.id]
    );
    return { released: 0 };
  }

  const io = getSocketIo();
  let released = 0;
  for (const row of linked) {
    runSql(
      "UPDATE orders SET kitchen_release_at = NULL, updated_at = datetime('now') WHERE id = ?",
      [row.id]
    );
    const order = getOrderWithItems(row.id);
    if (order) {
      scheduleKitchenBarAutoPrint(order);
      if (io) {
        io.emit('new-order', { ...order, _reservation_release: true });
        io.emit('order-update', order);
      }
    }
    released += 1;
  }

  runSql(
    "UPDATE reservations SET kitchen_prep_sent_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
    [reservation.id]
  );
  emitStaffDataUpdate({ domain: 'reservations', action: 'kitchen_released', reservation_id: reservation.id });
  return { released };
}

function sendCajaReservationReminder(reservation) {
  const linkedAll = findAllLinkedOrders(reservation.id);
  if (linkedAll.length > 0 && linkedAll.every(isOrderOutOfKitchen)) {
    runSql(
      "UPDATE reservations SET caja_verify_sent_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      [reservation.id]
    );
    return null;
  }

  const linked = findLinkedOrders(reservation.id);
  const hasOrder = linked.length > 0;
  const tableLabel = getReservationTableLabel(reservation);
  const payload = {
    type: 'caja_verify',
    reservation: {
      id: reservation.id,
      client_name: reservation.client_name,
      phone: reservation.phone || '',
      date: reservation.date,
      time: String(reservation.time || '').slice(0, 5),
      guests: Number(reservation.guests || 0),
      table_label: tableLabel,
      has_order: hasOrder,
      order_count: linked.length,
      notes: reservation.notes || '',
    },
  };

  runSql(
    "UPDATE reservations SET caja_verify_sent_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
    [reservation.id]
  );

  const io = getSocketIo();
  if (io) io.emit('reservation-reminder', payload);
  emitStaffDataUpdate({ domain: 'reservations', action: 'caja_reminder', reservation_id: reservation.id });
  return payload;
}

function runReservationSchedulerTick() {
  if (tickInFlight) return;
  tickInFlight = true;
  try {
    const resExpr = reservationLocalSqlExpr('r');
    const reservations = queryAll(
      `SELECT * FROM reservations r
       WHERE r.status IN ('confirmed','pending')
         AND ${resExpr} >= datetime('now', 'localtime', '-3 hours')
         AND ${resExpr} <= datetime('now', 'localtime', '+2 days')
       ORDER BY r.date ASC, r.time ASC`
    );

    const now = new Date();
    for (const reservation of reservations) {
      const resAt = parseReservationLocalDateTime(reservation.date, reservation.time);
      if (!resAt) continue;

      const kitchenReleaseAt = new Date(resAt.getTime() - RESERVATION_KITCHEN_PREP_MINUTES * 60_000);
      const cajaReminderAt = new Date(resAt.getTime() - RESERVATION_CAJA_VERIFY_MINUTES * 60_000);

      if (!String(reservation.kitchen_prep_sent_at || '').trim() && now >= kitchenReleaseAt) {
        releaseReservationKitchenOrders(reservation);
      }
      if (!String(reservation.caja_verify_sent_at || '').trim() && now >= cajaReminderAt) {
        sendCajaReservationReminder(reservation);
      }
    }
  } catch (err) {
    console.warn('[reservation-scheduler] tick error:', err.message || err);
  } finally {
    tickInFlight = false;
  }
}

function buildReservationCajaAlert(reservation) {
  const linked = findAllLinkedOrders(reservation.id);
  const activeKitchen = linked.filter((o) => !isOrderOutOfKitchen(o));
  const timeLabel = String(reservation.time || '').slice(0, 5);
  const tableLabel = getReservationTableLabel(reservation);
  let orderHint = '';
  if (linked.length > 0) {
    orderHint = activeKitchen.length > 0
      ? ` Pedido en cocina (${activeKitchen.length}).`
      : ' Pedido listo en cocina.';
  }
  const notesHint = String(reservation.notes || '').trim()
    ? ' Revise notas de la reserva (decoración, zona, etc.).'
    : '';
  const tableAction = hasAssignedTable(reservation)
    ? ` ${tableLabel}: verifique que la mesa y el salón estén listos.`
    : ' Asigne mesa y verifique preparativos.';
  return {
    id: `reserva_caja_${reservation.id}`,
    severity: 'warning',
    title: 'Reserva próxima — verificar preparativos',
    message: `${reservation.client_name} · ${reservation.date} ${timeLabel} · ${Number(reservation.guests || 0)} persona(s).${tableAction}${orderHint}${notesHint}`,
    linkTo: '/admin/reservas',
    linkLabel: 'Ver reservas',
  };
}

/**
 * Alertas operativas para caja: persisten hasta pedido listo (si hay) o T+2 h.
 */
function getReservationCajaOperationalAlerts() {
  const resExpr = reservationLocalSqlExpr('r');
  const maxAfterHours = RESERVATION_CAJA_ALERT_MAX_HOURS_AFTER;
  const rows = queryAll(
    `SELECT r.* FROM reservations r
     WHERE r.status IN ('confirmed','pending')
       AND r.caja_verify_sent_at IS NOT NULL
       AND trim(r.caja_verify_sent_at) != ''
       AND ${resExpr} <= datetime('now', 'localtime', '+${maxAfterHours} hours')
       AND datetime(r.caja_verify_sent_at) >= datetime('now', 'localtime', '-${maxAfterHours + 2} hours')
     ORDER BY r.date ASC, r.time ASC
     LIMIT 30`
  );

  return rows.filter(isReservationCajaAlertActive).map(buildReservationCajaAlert);
}

function startReservationScheduler() {
  if (schedulerTimer) return;
  runReservationSchedulerTick();
  schedulerTimer = setInterval(runReservationSchedulerTick, RESERVATION_SCHEDULER_INTERVAL_MS);
  if (typeof schedulerTimer.unref === 'function') schedulerTimer.unref();
  console.log(
    `[reservation-scheduler] activo (cocina −${RESERVATION_KITCHEN_PREP_MINUTES} min, caja −${RESERVATION_CAJA_VERIFY_MINUTES} min, aviso caja hasta +${RESERVATION_CAJA_ALERT_MAX_HOURS_AFTER} h)`
  );
}

module.exports = {
  startReservationScheduler,
  runReservationSchedulerTick,
  getReservationCajaOperationalAlerts,
  isReservationCajaAlertActive,
  releaseReservationKitchenOrders,
  sendCajaReservationReminder,
};
