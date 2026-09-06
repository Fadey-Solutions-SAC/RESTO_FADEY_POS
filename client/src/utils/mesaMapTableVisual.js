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
  const date = String(dateStr || '').trim();
  const time = String(timeStr || '').trim().slice(0, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time)) return null;
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  if (!y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm)) return null;
  const dt = new Date(y, m - 1, d, hh, mm, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt.getTime();
}

/**
 * Antes de la hora de la reserva la mesa se muestra en gris (reservada),
 * aunque ya exista un pedido retenido para cocina.
 */
function isBeforeReservationTime(reservation) {
  if (!reservation) return false;
  const ms = parseReservationLocalMs(reservation.date, reservation.time);
  if (ms == null) return false;
  return Date.now() < ms;
}

/**
 * @param {object} table
 * @param {Map<string, object>} reservationByTableId
 * @param {Set<string>} precuentaTableIds
 */
export function getMesaMapVisualState(table, reservationByTableId, precuentaTableIds) {
  if (!table) return 'available';
  const tid = String(table.id || '').trim();
  const hasOrders = Boolean(table.orders?.length);
  if (table.union_id) {
    if (precuentaTableIds?.has?.(tid) && hasOrders) return 'precuenta';
    return 'united';
  }
  const dbStatus = String(table.status || 'available').toLowerCase();
  const reservation = reservationByTableId?.get?.(tid);
  const hasReservation = Boolean(reservation) || dbStatus === 'reserved';

  // Gris hasta la hora de la reserva; luego ocupada si hay pedido / estado.
  if (hasReservation && isBeforeReservationTime(reservation)) {
    return 'reserved';
  }

  if (precuentaTableIds?.has?.(tid) && hasOrders) return 'precuenta';
  if (hasOrders || dbStatus === 'occupied') return 'occupied';
  if (hasReservation) return 'reserved';
  return 'available';
}

/**
 * @param {Array<{ id?: string, date?: string, table_id?: string, status?: string }>} reservations
 */
export function buildReservationByTableIdForToday(reservations) {
  const today = localTodayKey();
  const map = new Map();
  for (const r of reservations || []) {
    const st = String(r?.status || '').toLowerCase();
    if (ACTIVE_RESERVATION_SKIP.has(st)) continue;
    const tid = String(r?.table_id || '').trim();
    if (!tid || String(r?.date || '') !== today) continue;
    map.set(tid, r);
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
