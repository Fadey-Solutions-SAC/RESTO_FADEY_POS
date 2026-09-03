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
  const hasReservation = reservationByTableId?.has?.(tid) || dbStatus === 'reserved';
  if (hasReservation && !hasOrders) return 'reserved';
  if (precuentaTableIds?.has?.(tid) && hasOrders) return 'precuenta';
  if (hasOrders || dbStatus === 'occupied') return 'occupied';
  if (hasReservation) return 'reserved';
  return 'available';
}

/**
 * @param {Array<{ id?: string, date?: string, table_id?: string, status?: string }>} reservations
 */
export function buildReservationByTableIdForToday(reservations) {
  const today = new Date().toISOString().slice(0, 10);
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
 * Número de sillas a dibujar (capacidad configurada o comensales de reserva).
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

/** Distribuye sillas en top, right, bottom, left. */
export function splitChairsPerSide(total) {
  const n = clampChairCount(total);
  // Layouts fijos para lectura clara en el mapa (arriba, derecha, abajo, izquierda).
  switch (n) {
    case 1:
      return [1, 0, 0, 0];
    case 2:
      // Extremos: una arriba y una abajo
      return [1, 0, 1, 0];
    case 3:
      // Abajo vacío
      return [1, 1, 0, 1];
    case 4:
      return [1, 1, 1, 1];
    case 5:
      // 2 arriba + 1 por costado/abajo (mismo tamaño visual vía CSS)
      return [2, 1, 1, 1];
    case 6:
      // Dos arriba y abajo, una a cada costado
      return [2, 1, 2, 1];
    case 7:
      return [2, 2, 2, 1];
    case 8:
      return [2, 2, 2, 2];
    case 9:
      return [3, 2, 2, 2];
    case 10:
      return [3, 2, 3, 2];
    case 11:
      return [3, 3, 3, 2];
    case 12:
      return [3, 3, 3, 3];
    default: {
      const sides = [0, 0, 0, 0];
      for (let i = 0; i < n; i += 1) sides[i % 4] += 1;
      return sides;
    }
  }
}

/** Máximo de sillas en un mismo lado (para tamaño uniforme). */
export function maxChairsOnAnySide(sides) {
  const list = Array.isArray(sides) ? sides : [];
  return Math.max(1, ...list.map((n) => Number(n) || 0), 1);
}

export function formatMesaMapTableNumber(table) {
  const num = table?.number;
  if (num != null && String(num).trim() !== '') {
    return String(num).padStart(2, '0');
  }
  const name = String(table?.name || '').trim();
  const m = name.match(/(\d+)/);
  if (m) return m[1].padStart(2, '0');
  return name.slice(0, 4) || '—';
}

export const MESA_MAP_STATE_LABELS = {
  available: 'Libre',
  occupied: 'Ocupada',
  precuenta: 'Pre-cuenta',
  reserved: 'Reservada',
  united: 'Mesa unida',
};
