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
  reservationKitchenReleaseSqlExpr,
} = require('./reservationDateTime');
const { scheduleKitchenBarAutoPrint } = require('./kitchenBarAutoPrintService');
const { sqlBusinessNowExpr } = require('../utils/appDateTime');

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

function markCajaVerifySent(reservationId) {
  runSql(
    "UPDATE reservations SET caja_verify_sent_at = datetime('now', 'localtime'), updated_at = datetime('now') WHERE id = ?",
    [reservationId]
  );
}

/**
 * Aviso a caja activo en ventana [T−20 min, T+2 h].
 * No se cancela por pedido listo: caja debe verificar mesa, zona, decoración, etc.
 */
function isReservationCajaAlertActive(reservation, now = new Date()) {
  if (!reservation) return false;
  if (!['confirmed', 'pending'].includes(String(reservation.status || ''))) return false;

  const resAt = parseReservationLocalDateTime(reservation.date, reservation.time);
  if (!resAt) return false;

  const windowStart = new Date(resAt.getTime() - RESERVATION_CAJA_VERIFY_MINUTES * 60_000);
  const maxUntil = new Date(resAt.getTime() + RESERVATION_CAJA_ALERT_MAX_HOURS_AFTER * 60 * 60 * 1000);
  if (now < windowStart) return false;
  if (now >= maxUntil) return false;
  return true;
}

function releaseReservationKitchenOrders(reservation) {
  const linkedPending = findLinkedOrders(reservation.id);
  if (linkedPending.length === 0) {
    return { released: 0 };
  }

  // Al vencer T−30: liberar todo hold, aunque el timestamp guardado diga lo contrario.
  const held = linkedPending.filter((o) => String(o.kitchen_release_at || '').trim());
  if (held.length === 0) {
    runSql(
      "UPDATE reservations SET kitchen_prep_sent_at = datetime('now', 'localtime'), updated_at = datetime('now') WHERE id = ? AND kitchen_prep_sent_at IS NULL",
      [reservation.id]
    );
    return { released: 0 };
  }

  const io = getSocketIo();
  let released = 0;
  for (const row of held) {
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
    "UPDATE reservations SET kitchen_prep_sent_at = datetime('now', 'localtime'), updated_at = datetime('now') WHERE id = ?",
    [reservation.id]
  );
  emitStaffDataUpdate({ domain: 'reservations', action: 'kitchen_released', reservation_id: reservation.id });
  return { released };
}

/**
 * Libera holds cuyo kitchen_release_at ya venció (seguridad aunque el scheduler falle).
 */
function releaseAllDueKitchenHolds() {
  const nowExpr = sqlBusinessNowExpr(queryOne);
  const due = queryAll(
    `SELECT * FROM orders
     WHERE status IN ('pending','preparing')
       AND kitchen_release_at IS NOT NULL
       AND trim(kitchen_release_at) != ''
       AND datetime(kitchen_release_at) <= ${nowExpr}
     ORDER BY created_at ASC
     LIMIT 80`
  );
  return emitReleasedOrders(due, 'kitchen_released_due');
}

/**
 * Liberación autoritativa por T−N de la reserva (SQL), aunque kitchen_release_at
 * esté mal calculado o en el futuro. Es lo que debe disparar al llegar a −30 min.
 */
function releaseHoldsByReservationSchedule() {
  const releaseExpr = reservationKitchenReleaseSqlExpr('r', RESERVATION_KITCHEN_PREP_MINUTES);
  const nowExpr = sqlBusinessNowExpr(queryOne);
  const due = queryAll(
    `SELECT o.*
     FROM orders o
     INNER JOIN reservations r ON o.notes LIKE ('%' || 'RESERVA_ID:' || r.id || '%')
     WHERE r.status IN ('confirmed','pending')
       AND o.status IN ('pending','preparing')
       AND o.kitchen_release_at IS NOT NULL
       AND trim(o.kitchen_release_at) != ''
       AND ${releaseExpr} <= ${nowExpr}
     ORDER BY o.created_at ASC
     LIMIT 80`
  );
  return emitReleasedOrders(due, 'kitchen_released_schedule');
}

function emitReleasedOrders(rows, action) {
  if (!rows?.length) return { released: 0 };
  const io = getSocketIo();
  let released = 0;
  const seen = new Set();
  for (const row of rows) {
    if (!row?.id || seen.has(row.id)) continue;
    seen.add(row.id);
    runSql(
      "UPDATE orders SET kitchen_release_at = NULL, updated_at = datetime('now') WHERE id = ?",
      [row.id]
    );
    const order = getOrderWithItems(row.id);
    if (order) {
      try {
        scheduleKitchenBarAutoPrint(order);
      } catch (_) {
        /* noop */
      }
      if (io) {
        io.emit('new-order', { ...order, _reservation_release: true });
        io.emit('order-update', order);
      }
    }
    const m = String(row.notes || '').match(/RESERVA_ID:([0-9a-fA-F-]{8,})/i);
    if (m?.[1]) {
      runSql(
        "UPDATE reservations SET kitchen_prep_sent_at = datetime('now', 'localtime'), updated_at = datetime('now') WHERE id = ?",
        [m[1]]
      );
    }
    released += 1;
  }
  if (released > 0) {
    emitStaffDataUpdate({ domain: 'reservations', action });
    console.log(`[reservation-scheduler] ${action}: ${released} pedido(s) a cocina`);
  }
  return { released };
}

function sendCajaReservationReminder(reservation) {
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

  markCajaVerifySent(reservation.id);

  const io = getSocketIo();
  if (io) io.emit('reservation-reminder', payload);
  emitStaffDataUpdate({ domain: 'reservations', action: 'caja_reminder', reservation_id: reservation.id });
  return payload;
}

function runReservationSchedulerTick() {
  if (tickInFlight) return;
  tickInFlight = true;
  try {
    // 1) Holds vencidos por su propio kitchen_release_at
    releaseAllDueKitchenHolds();
    // 2) Holds de reserva cuyo T−30 ya llegó (aunque el timestamp del hold esté mal)
    releaseHoldsByReservationSchedule();

    const resExpr = reservationLocalSqlExpr('r');
    const nowExpr = sqlBusinessNowExpr(queryOne);
    const reservations = queryAll(
      `SELECT * FROM reservations r
       WHERE r.status IN ('confirmed','pending')
         AND ${resExpr} >= ${sqlBusinessNowExpr(queryOne, '-3 hours')}
         AND ${resExpr} <= ${sqlBusinessNowExpr(queryOne, '+2 days')}
       ORDER BY r.date ASC, r.time ASC`
    );

    const now = new Date();
    const releaseExpr = reservationKitchenReleaseSqlExpr('r', RESERVATION_KITCHEN_PREP_MINUTES);

    for (const reservation of reservations) {
      const resAt = parseReservationLocalDateTime(reservation.date, reservation.time);
      if (!resAt) continue;

      const dueRow = queryOne(
        `SELECT CASE WHEN ${releaseExpr} <= ${nowExpr} THEN 1 ELSE 0 END AS due
         FROM reservations r WHERE r.id = ?`,
        [reservation.id]
      );
      const dueKitchen = Number(dueRow?.due) === 1;

      if (dueKitchen) {
        const heldLeft = findLinkedOrders(reservation.id).filter((o) =>
          String(o.kitchen_release_at || '').trim()
        );
        if (heldLeft.length > 0) {
          releaseReservationKitchenOrders(reservation);
        } else if (!String(reservation.kitchen_prep_sent_at || '').trim()) {
          // Pedidos ya visibles o sin hold: marcar bandera
          releaseReservationKitchenOrders(reservation);
        }
      }

      const cajaReminderAt = new Date(resAt.getTime() - RESERVATION_CAJA_VERIFY_MINUTES * 60_000);
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
    : ' Sin mesa asignada: asigne mesa y verifique preparativos.';
  return {
    id: `reserva_caja_${reservation.id}`,
    severity: 'warning',
    title: hasAssignedTable(reservation)
      ? 'Reserva próxima — verificar preparativos'
      : 'Reserva — asigne mesa y preparativos',
    message: `${reservation.client_name} · ${reservation.date} ${timeLabel} · ${Number(reservation.guests || 0)} persona(s).${tableAction}${orderHint}${notesHint}`,
    linkTo: '/admin/reservas',
    linkLabel: 'Ver reservas',
  };
}

/**
 * Alertas operativas para caja: ventana [T−20 min, T+2 h],
 * más reservas con pedido activo sin mesa asignada.
 */
function getReservationCajaOperationalAlerts() {
  try {
    releaseAllDueKitchenHolds();
    releaseHoldsByReservationSchedule();
  } catch (err) {
    console.warn('[reservation-caja-alerts] release:', err.message || err);
  }

  const resExpr = reservationLocalSqlExpr('r');
  const verifyMins = RESERVATION_CAJA_VERIFY_MINUTES;
  const maxAfterHours = RESERVATION_CAJA_ALERT_MAX_HOURS_AFTER;
  const rows = queryAll(
    `SELECT r.* FROM reservations r
     WHERE r.status IN ('confirmed','pending')
       AND ${resExpr} <= ${sqlBusinessNowExpr(queryOne, `+${verifyMins} minutes`)}
       AND ${resExpr} > ${sqlBusinessNowExpr(queryOne, `-${maxAfterHours} hours`)}
     ORDER BY r.date ASC, r.time ASC
     LIMIT 30`
  );

  const noTableWithOrder = queryAll(
    `SELECT r.* FROM reservations r
     WHERE r.status IN ('confirmed','pending')
       AND (r.table_id IS NULL OR trim(r.table_id) = '')
       AND ${resExpr} > ${sqlBusinessNowExpr(queryOne, `-${maxAfterHours} hours`)}
       AND ${resExpr} <= ${sqlBusinessNowExpr(queryOne, '+1 day')}
       AND EXISTS (
         SELECT 1 FROM orders o
         WHERE o.notes LIKE ('%' || 'RESERVA_ID:' || r.id || '%')
           AND o.status IN ('pending','preparing','ready')
       )
     ORDER BY r.date ASC, r.time ASC
     LIMIT 20`
  );

  const byId = new Map();
  for (const r of [...rows, ...noTableWithOrder]) {
    if (r?.id) byId.set(r.id, r);
  }

  const now = new Date();
  const active = [];
  for (const reservation of byId.values()) {
    const noTable = !hasAssignedTable(reservation);
    const inPrepWindow = isReservationCajaAlertActive(reservation, now);
    if (!inPrepWindow && !noTable) continue;

    if (!String(reservation.caja_verify_sent_at || '').trim()) {
      markCajaVerifySent(reservation.id);
      reservation.caja_verify_sent_at = new Date().toISOString();
      const linkedPending = findLinkedOrders(reservation.id);
      const io = getSocketIo();
      if (io) {
        io.emit('reservation-reminder', {
          type: noTable ? 'caja_assign_table' : 'caja_verify',
          reservation: {
            id: reservation.id,
            client_name: reservation.client_name,
            phone: reservation.phone || '',
            date: reservation.date,
            time: String(reservation.time || '').slice(0, 5),
            guests: Number(reservation.guests || 0),
            table_label: getReservationTableLabel(reservation),
            has_order: linkedPending.length > 0,
            order_count: linkedPending.length,
            needs_table: noTable,
            notes: reservation.notes || '',
          },
        });
      }
      emitStaffDataUpdate({ domain: 'reservations', action: 'caja_reminder', reservation_id: reservation.id });
    }
    active.push(buildReservationCajaAlert(reservation));
  }
  return active;
}

function startReservationScheduler() {
  if (schedulerTimer) return;
  runReservationSchedulerTick();
  // No usar unref(): el job de reservas debe seguir vivo mientras el servidor corra.
  schedulerTimer = setInterval(() => {
    try {
      runReservationSchedulerTick();
    } catch (err) {
      console.warn('[reservation-scheduler] interval error:', err.message || err);
    }
  }, RESERVATION_SCHEDULER_INTERVAL_MS);
  console.log(
    `[reservation-scheduler] activo cada ${RESERVATION_SCHEDULER_INTERVAL_MS / 1000}s (cocina −${RESERVATION_KITCHEN_PREP_MINUTES} min, caja −${RESERVATION_CAJA_VERIFY_MINUTES} min)`
  );
}

module.exports = {
  startReservationScheduler,
  runReservationSchedulerTick,
  releaseAllDueKitchenHolds,
  releaseHoldsByReservationSchedule,
  getReservationCajaOperationalAlerts,
  isReservationCajaAlertActive,
  releaseReservationKitchenOrders,
  sendCajaReservationReminder,
};
