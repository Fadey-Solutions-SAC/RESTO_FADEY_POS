/**
 * Estado visual de una mesa en el mapa de caja.
 * @typedef {'available'|'occupied'|'precuenta'|'reserved'|'united'} MesaMapVisualState
 */

const BUSINESS_TZ = 'America/Lima';

const ACTIVE_RESERVATION_SKIP = new Set([
  'cancelled',
  'completed',
  'cancelada',
  'completada',
]);

function businessTodayKey(nowMs = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(nowMs));
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

/** Interpreta date+time de reserva como instante en America/Lima (igual que el servidor). */
function parseReservationBusinessMs(dateStr, timeStr) {
  const date = String(dateStr || '').trim().slice(0, 10);
  const rawTime = String(timeStr || '').trim();
  const timeMatch = rawTime.match(/^(\d{1,2}):(\d{2})/);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !timeMatch) return null;
  const hh = String(Number(timeMatch[1])).padStart(2, '0');
  const mm = timeMatch[2];
  // Lima es UTC−5 todo el año (sin DST).
  const dt = new Date(`${date}T${hh}:${mm}:00-05:00`);
  return Number.isNaN(dt.getTime()) ? null : dt.getTime();
}

/** true si aún no llegó la hora de la reserva (zona negocio). */
function isBeforeReservationTime(reservation, nowMs = Date.now()) {
  if (!reservation) return false;
  const ms = parseReservationBusinessMs(reservation.date, reservation.time);
  if (ms == null) return false;
  return nowMs < ms;
}

function isActiveReservationStatus(status) {
  return !ACTIVE_RESERVATION_SKIP.has(String(status || '').toLowerCase());
}

/**
 * Entre varias reservas de la misma mesa, priorizar la que ya empezó (o la más próxima).
 * Evita que una reserva futura deje la mesa en gris cuando ya pasó la hora de la actual.
 */
function pickBestReservationForNow(candidates, nowMs = Date.now()) {
  const list = (candidates || []).filter((r) => r && isActiveReservationStatus(r.status));
  if (!list.length) return null;
  let best = null;
  let bestScore = Infinity;
  for (const r of list) {
    const ms = parseReservationBusinessMs(r.date, r.time);
    if (ms == null) {
      if (!best) best = r;
      continue;
    }
    // Ya empezó: score = qué tan reciente (0 = justo ahora). Futura: +1e12 + espera.
    const score = ms <= nowMs ? nowMs - ms : 1e12 + (ms - nowMs);
    if (score < bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

function findReservationForTable(tableId, reservationByTableId, reservationsList, orders, nowMs = Date.now()) {
  const tid = String(tableId || '').trim();
  const today = businessTodayKey(nowMs);
  const list = Array.isArray(reservationsList) ? reservationsList : [];

  const fromMap = tid && reservationByTableId?.get?.(tid);
  const candidates = [];
  if (fromMap) candidates.push(fromMap);

  if (tid) {
    for (const r of list) {
      if (!isActiveReservationStatus(r?.status)) continue;
      if (String(r?.table_id || '').trim() !== tid) continue;
      const rDate = String(r?.date || '').trim().slice(0, 10);
      const ms = parseReservationBusinessMs(r.date, r.time);
      if (rDate === today || (ms != null && ms > nowMs)) {
        candidates.push(r);
      }
    }
  }

  for (const o of orders || []) {
    const m = String(o?.notes || '').match(/RESERVA_ID:([0-9a-fA-F-]{8,})/i);
    if (!m) continue;
    const found = list.find((r) => String(r?.id || '') === String(m[1]));
    if (found && isActiveReservationStatus(found.status)) candidates.push(found);
  }

  // Deduplicar por id
  const byId = new Map();
  for (const r of candidates) {
    const id = String(r?.id || '');
    if (id) byId.set(id, r);
    else byId.set(`anon-${byId.size}`, r);
  }
  return pickBestReservationForNow([...byId.values()], nowMs);
}

/**
 * @param {object} table
 * @param {Map<string, object>} reservationByTableId
 * @param {Set<string>} precuentaTableIds
 * @param {Array<object>} [reservationsList]
 * @param {number} [nowMs]
 */
export function getMesaMapVisualState(
  table,
  reservationByTableId,
  precuentaTableIds,
  reservationsList,
  nowMs = Date.now()
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
    orders,
    nowMs
  );

  // 1) Antes de la hora → gris (reservada), aunque aún no haya pedidos.
  if (reservation && isBeforeReservationTime(reservation, nowMs)) {
    return 'reserved';
  }

  // 2) Pedidos / precuenta / unida
  if (precuentaTableIds?.has?.(tid) && hasOrders) return 'precuenta';
  if (hasOrders || dbStatus === 'occupied') return 'occupied';

  // 3) Llegó la hora de reserva y sigue activa → naranja (ocupada) hasta cobrar/completar.
  if (reservation) {
    return 'occupied';
  }

  // 4) status reserved huérfano (sin reserva activa) → libre
  return 'available';
}

/**
 * @param {Array<{ id?: string, date?: string, table_id?: string, status?: string, time?: string }>} reservations
 * @param {number} [nowMs]
 */
export function buildReservationByTableIdForToday(reservations, nowMs = Date.now()) {
  const today = businessTodayKey(nowMs);
  const byTable = new Map();
  for (const r of reservations || []) {
    if (!isActiveReservationStatus(r?.status)) continue;
    const tid = String(r?.table_id || '').trim();
    if (!tid) continue;
    const rDate = String(r?.date || '').trim().slice(0, 10);
    const resMs = parseReservationBusinessMs(r.date, r.time);
    const isToday = rDate === today;
    const upcoming = resMs != null && resMs > nowMs;
    if (!isToday && !upcoming) continue;
    if (!byTable.has(tid)) byTable.set(tid, []);
    byTable.get(tid).push(r);
  }
  const map = new Map();
  for (const [tid, list] of byTable) {
    const best = pickBestReservationForNow(list, nowMs);
    if (best) map.set(tid, best);
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

/** Preferencia de etiqueta: 'number' | 'name' */
export function normalizeTableDisplayLabel(value) {
  return String(value || '').trim().toLowerCase() === 'name' ? 'name' : 'number';
}

/** Etiqueta larga para Caja, toasts, pedidos (ej. "BARRA" o "Mesa 100"). */
export function getTableDisplayLabel(table) {
  const mode = normalizeTableDisplayLabel(table?.display_label);
  const name = String(table?.name || '').trim();
  if (mode === 'name' && name) return name;
  const num = table?.number;
  if (num != null && String(num).trim() !== '') return `Mesa ${String(num).trim()}`;
  return name || 'Mesa';
}

/** Texto corto en el mapa de mesas (número M12 o nombre truncado). */
export function formatMesaMapTableNumber(table) {
  const mode = normalizeTableDisplayLabel(table?.display_label);
  const name = String(table?.name || '').trim();
  if (mode === 'name' && name) {
    return name.length > 8 ? `${name.slice(0, 7)}…` : name;
  }
  const num = table?.number;
  if (num != null && String(num).trim() !== '') {
    const raw = String(num).trim().replace(/^M/i, '');
    const n = /^\d+$/.test(raw) ? String(parseInt(raw, 10)) : raw;
    return `M${n}`;
  }
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
