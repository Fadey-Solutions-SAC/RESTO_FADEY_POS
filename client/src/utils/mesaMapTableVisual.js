/**
 * Estado visual de una mesa en el mapa de caja.
 * @typedef {'available'|'occupied'|'precuenta'|'reserved'|'united'} MesaMapVisualState
 */

const ACTIVE_RESERVATION_SKIP = new Set([
  'cancelled',
  'completed',
  'cancelada',
  'completada',
]);

function localTodayKey() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseReservationLocalMs(dateStr, timeStr) {
  const date = String(dateStr || '').trim().slice(0, 10);
  const time = String(timeStr || '').trim().slice(0, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time)) return null;
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  if (!y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm)) return null;
  const dt = new Date(y, m - 1, d, hh, mm, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt.getTime();
}

/** true si aún no llegó la hora de la reserva. */
function isBeforeReservationTime(reservation) {
  if (!reservation) return false;
  const ms = parseReservationLocalMs(reservation.date, reservation.time);
  if (ms == null) return false;
  return Date.now() < ms;
}

function isActiveReservationStatus(status) {
  return !ACTIVE_RESERVATION_SKIP.has(String(status || '').toLowerCase());
}

function findReservationForTable(tableId, reservationByTableId, reservationsList, orders) {
  const tid = String(tableId || '').trim();
  if (tid && reservationByTableId?.get?.(tid)) {
    return reservationByTableId.get(tid);
  }

  const list = Array.isArray(reservationsList) ? reservationsList : [];
  const today = localTodayKey();

  if (tid) {
    const byTable = list.find((r) => {
      if (!isActiveReservationStatus(r?.status)) return false;
      if (String(r?.table_id || '').trim() !== tid) return false;
      const rDate = String(r?.date || '').trim().slice(0, 10);
      if (rDate === today) return true;
      const ms = parseReservationLocalMs(r.date, r.time);
      return ms != null && ms > Date.now();
    });
    if (byTable) return byTable;
  }

  for (const o of orders || []) {
    const m = String(o?.notes || '').match(/RESERVA_ID:([0-9a-fA-F-]{8,})/i);
    if (!m) continue;
    const found = list.find((r) => String(r?.id || '') === String(m[1]));
    if (found && isActiveReservationStatus(found.status)) return found;
  }

  return null;
}

/**
 * @param {object} table
 * @param {Map<string, object>} reservationByTableId
 * @param {Set<string>} precuentaTableIds
 * @param {Array<object>} [reservationsList]
 */
export function getMesaMapVisualState(
  table,
  reservationByTableId,
  precuentaTableIds,
  reservationsList
) {
  if (!table) return 'available';
  const tid = String(table.id || '').trim();
  const orders = Array.isArray(table.orders) ? table.orders : [];
  const hasOrders = orders.length > 0 || Number(table.order_count || 0) > 0;

  if (table.union_id) {
    if (precuentaTableIds?.has?.(tid) && hasOrders) return 'precuenta';
    return 'united';
  }

  const dbStatus = String(table.status || 'available').toLowerCase();
  const reservation = findReservationForTable(
    tid,
    reservationByTableId,
    reservationsList,
    orders
  );

  // Reserva: gris hasta la hora exacta; al llegar → naranja. Nada más cambia ese color.
  if (reservation) {
    return isBeforeReservationTime(reservation) ? 'reserved' : 'occupied';
  }

  if (precuentaTableIds?.has?.(tid) && hasOrders) return 'precuenta';
  if (hasOrders || dbStatus === 'occupied') return 'occupied';
  if (dbStatus === 'reserved') return 'reserved';
  return 'available';
}

/**
 * @param {Array<{ id?: string, date?: string, table_id?: string, status?: string, time?: string }>} reservations
 */
export function buildReservationByTableIdForToday(reservations) {
  const today = localTodayKey();
  const map = new Map();
  const now = Date.now();
  for (const r of reservations || []) {
    if (!isActiveReservationStatus(r?.status)) continue;
    const tid = String(r?.table_id || '').trim();
    if (!tid) continue;
    const rDate = String(r?.date || '').trim().slice(0, 10);
    const resMs = parseReservationLocalMs(r.date, r.time);
    const isToday = rDate === today;
    const upcoming = resMs != null && resMs > now;
    if (!isToday && !upcoming) continue;
    const prev = map.get(tid);
    if (!prev) {
      map.set(tid, r);
      continue;
    }
    // Si hay varias, priorizar la más próxima aún no cumplida.
    const prevMs = parseReservationLocalMs(prev.date, prev.time);
    if (resMs != null && (prevMs == null || (resMs >= now && (prevMs < now || resMs < prevMs)))) {
      map.set(tid, r);
    }
  }
  return map;
}

/**
 * Capacidad a mostrar en el mapa (configurada o comensales de reserva).
 * @param {object} table
 * @param {Map<string, object>} reservationByTableId
 * @param {Array<object>} allTables
 */
export function getMesaMapChairCount(table, reservationByTableId, allTables = []) {
  if (!table) return 4;

  if (Array.isArray(table.union_member_ids) && table.union_member_ids.length > 1) {
    const byId = new Map((allTables || []).map((t) => [t.id, t]));
    let sum = 0;
    for (const mid of table.union_member_ids) {
      const member = byId.get(mid);
      const c = Number(member?.capacity);
      sum += Number.isFinite(c) && c > 0 ? c : 4;
    }
    return clampChairCount(sum);
  }

  const res = reservationByTableId?.get?.(String(table.id || '').trim());
  const guests = Number(res?.guests);
  if (Number.isFinite(guests) && guests > 0) return clampChairCount(guests);

  const cap = Number(table.capacity);
  return clampChairCount(Number.isFinite(cap) && cap > 0 ? cap : 4);
}

export function clampChairCount(n) {
  return Math.max(1, Math.min(12, Math.floor(Number(n) || 4)));
}

export function formatMesaMapTableNumber(table) {
  const num = table?.number;
  if (num != null && String(num).trim() !== '') {
    const raw = String(num).trim().replace(/^M/i, '');
    const n = /^\d+$/.test(raw) ? String(parseInt(raw, 10)) : raw;
    return `M${n}`;
  }
  const name = String(table?.name || '').trim();
  const m = name.match(/(\d+)/);
  if (m) return `M${String(parseInt(m[1], 10))}`;
  if (/^M/i.test(name)) return name.slice(0, 4);
  return name.slice(0, 4) || '—';
}

export const MESA_MAP_STATE_LABELS = {
  available: 'Libre',
  occupied: 'Ocupada',
  precuenta: 'Pre-cuenta',
  reserved: 'Reservada',
  united: 'Mesa unida',
};
