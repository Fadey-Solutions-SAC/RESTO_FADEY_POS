/**
 * Mesas disponibles para asignar a una reserva (excluye ocupadas y reservadas del día).
 */

const ACTIVE_RES_STATUS = new Set(['confirmed', 'pending', 'confirmada', 'pendiente']);

function parseTimeToMinutes(timeValue) {
  const [h, m] = String(timeValue || '').split(':').map((v) => Number(v));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function tableHasActiveOrders(table) {
  const orders = Array.isArray(table?.orders) ? table.orders : [];
  if (orders.length > 0) return true;
  if (Number(table?.order_count || 0) > 0) return true;
  const st = String(table?.status || '').toLowerCase();
  return st === 'occupied' || st === 'ocupada';
}

/** Reserva activa en la misma mesa el mismo día (cualquier hora). */
function tableHasReservationThatDay(tableId, reservations, { date, excludeReservationId = '' }) {
  const tid = String(tableId || '').trim();
  const day = String(date || '').trim().slice(0, 10);
  if (!tid || !day) return false;

  return (reservations || []).some((r) => {
    if (!ACTIVE_RES_STATUS.has(String(r?.status || '').toLowerCase())) return false;
    if (excludeReservationId && String(r.id) === String(excludeReservationId)) return false;
    if (String(r?.table_id || '').trim() !== tid) return false;
    return String(r?.date || '').trim().slice(0, 10) === day;
  });
}

function tableHasConflictingReservation(tableId, reservations, { date, time, excludeReservationId = '' }) {
  const tid = String(tableId || '').trim();
  const day = String(date || '').trim().slice(0, 10);
  const targetMinutes = parseTimeToMinutes(time);
  if (!tid || !day) return false;

  return (reservations || []).some((r) => {
    if (!ACTIVE_RES_STATUS.has(String(r?.status || '').toLowerCase())) return false;
    if (excludeReservationId && String(r.id) === String(excludeReservationId)) return false;
    if (String(r?.table_id || '').trim() !== tid) return false;
    if (String(r?.date || '').trim().slice(0, 10) !== day) return false;
    if (targetMinutes == null) return true;
    const existingMinutes = parseTimeToMinutes(r.time);
    if (existingMinutes == null) return true;
    return Math.abs(existingMinutes - targetMinutes) < 90;
  });
}

/**
 * @param {object} opts
 * @param {Array} opts.tables
 * @param {Array} opts.reservations
 * @param {string} opts.date
 * @param {string} opts.time
 * @param {string} [opts.excludeReservationId] reserva actual (al editar/asignar)
 * @param {string} [opts.includeTableId] siempre incluir (mesa ya asignada a esta reserva)
 */
export function filterTablesForReservationSelect({
  tables = [],
  reservations = [],
  date,
  time,
  excludeReservationId = '',
  includeTableId = '',
} = {}) {
  const keepId = String(includeTableId || '').trim();
  return (tables || []).filter((t) => {
    const tid = String(t?.id || '').trim();
    if (!tid) return false;
    if (keepId && tid === keepId) return true;
    if (tableHasActiveOrders(t)) return false;
    // Cualquier reserva del mismo día en esa mesa la bloquea (ocupada/reservada).
    if (tableHasReservationThatDay(tid, reservations, { date, excludeReservationId })) {
      return false;
    }
    if (tableHasConflictingReservation(tid, reservations, { date, time, excludeReservationId })) {
      return false;
    }
    const st = String(t?.status || '').toLowerCase();
    if (
      st === 'reserved'
      || st === 'reservada'
      || st === 'occupied'
      || st === 'ocupada'
      || st === 'maintenance'
      || st === 'mantenimiento'
    ) {
      return false;
    }
    return true;
  });
}
