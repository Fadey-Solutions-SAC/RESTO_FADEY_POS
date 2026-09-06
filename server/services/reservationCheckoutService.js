/**
 * Al cobrar / liberar mesa: marcar reservas vinculadas como completed
 * para que el mapa vuelva a «Libre».
 */
const { queryAll, queryOne, runSql } = require('../database');
const { emitStaffDataUpdate } = require('../socketBroadcast');
const { loadActiveTableOrders } = require('./tableOrdersQueryService');

const ACTIVE_RES = new Set(['confirmed', 'pending', 'confirmada', 'pendiente']);

function extractReservaIdsFromOrders(orders) {
  const ids = new Set();
  for (const o of orders || []) {
    const notes = String(o?.notes || '');
    const m = notes.match(/RESERVA_ID:([0-9a-fA-F-]{8,})/i);
    if (m?.[1]) ids.add(String(m[1]));
  }
  return [...ids];
}

function todayKeyLima() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date());
}

function completeReservationById(reservationId) {
  const id = String(reservationId || '').trim();
  if (!id) return false;
  const row = queryOne('SELECT id, status, table_id FROM reservations WHERE id = ?', [id]);
  if (!row) return false;
  if (!ACTIVE_RES.has(String(row.status || '').toLowerCase())) return false;
  runSql(
    "UPDATE reservations SET status = 'completed', updated_at = datetime('now') WHERE id = ?",
    [id]
  );
  if (row.table_id) {
    const table = queryOne('SELECT id, status FROM tables WHERE id = ?', [row.table_id]);
    if (table && String(table.status || '').toLowerCase() === 'reserved') {
      const stillActive = loadActiveTableOrders(table);
      if (!stillActive.length) {
        runSql("UPDATE tables SET status = 'available' WHERE id = ?", [table.id]);
      }
    }
  }
  return true;
}

/**
 * Completa reservas ligadas a pedidos cobrados, si la mesa ya no tiene activos.
 * @param {Array<object>} paidOrders
 * @returns {string[]} ids de reservas completadas
 */
function completeReservationsAfterCheckout(paidOrders) {
  const completed = [];
  const reservaIds = extractReservaIdsFromOrders(paidOrders);
  for (const id of reservaIds) {
    if (completeReservationById(id)) completed.push(id);
  }

  const tableIds = new Set();
  for (const o of paidOrders || []) {
    const tid = String(o?.table_id || '').trim();
    if (tid) tableIds.add(tid);
  }
  // Pedidos viejos a veces solo tienen table_number
  for (const o of paidOrders || []) {
    const num = String(o?.table_number || '').trim();
    if (!num || String(o?.table_id || '').trim()) continue;
    const byNum = queryOne('SELECT id FROM tables WHERE number = ? OR name = ? LIMIT 1', [num, `Mesa ${num}`]);
    if (byNum?.id) tableIds.add(String(byNum.id));
  }

  const today = todayKeyLima();
  for (const tid of tableIds) {
    const table = queryOne('SELECT * FROM tables WHERE id = ?', [tid]);
    if (!table) continue;
    const remaining = loadActiveTableOrders(table);
    if (remaining.length > 0) continue;

    runSql("UPDATE tables SET status = 'available' WHERE id = ?", [tid]);

    const openRes = queryAll(
      `SELECT id FROM reservations
       WHERE table_id = ?
         AND substr(trim(date), 1, 10) = ?
         AND lower(status) IN ('confirmed','pending','confirmada','pendiente')`,
      [tid, today]
    );
    for (const r of openRes) {
      if (completeReservationById(r.id) && !completed.includes(r.id)) completed.push(r.id);
    }
  }

  if (completed.length) {
    emitStaffDataUpdate({ domain: 'reservations', action: 'completed_on_checkout', ids: completed });
    try {
      const { getSocketIo } = require('../socketBroadcast');
      const io = getSocketIo();
      if (io) io.emit('table-update', {});
    } catch (_) {
      /* ignore */
    }
  }
  return completed;
}

/**
 * Al liberar mesa manualmente: completar reservas del día de esa mesa.
 */
function completeReservationsForFreedTable(tableId) {
  const tid = String(tableId || '').trim();
  if (!tid) return [];
  const today = todayKeyLima();
  const openRes = queryAll(
    `SELECT id FROM reservations
     WHERE table_id = ?
       AND substr(trim(date), 1, 10) = ?
       AND lower(status) IN ('confirmed','pending','confirmada','pendiente')`,
    [tid, today]
  );
  const completed = [];
  for (const r of openRes) {
    if (completeReservationById(r.id)) completed.push(r.id);
  }
  if (completed.length) {
    emitStaffDataUpdate({ domain: 'reservations', action: 'completed_on_free', ids: completed });
  }
  return completed;
}

module.exports = {
  completeReservationsAfterCheckout,
  completeReservationsForFreedTable,
  completeReservationById,
};
