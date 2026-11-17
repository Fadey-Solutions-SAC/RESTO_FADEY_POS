/**
 * Disponibilidad horaria de productos (desayuno, almuerzo, cena, promos).
 * Soporta ventanas que cruzan medianoche y validación vs horario del local.
 * La hora es la del restaurante (America/Lima por defecto), no el reloj del servidor.
 */

const { resolveRegionalTimezone, shiftBusinessDateKey, DEFAULT_TIMEZONE } = require('../utils/appDateTime');
const promotionEngine = require('../../packages/shared-types/promotionEngine');

const DAY_KEYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

const SCHEDULE_TYPES = new Set(['desayuno', 'almuerzo', 'cena', 'promocion', 'personalizado']);

const SCHEDULE_PRESETS = {
  desayuno: { available_from: '07:00', available_to: '11:00' },
  almuerzo: { available_from: '12:00', available_to: '16:00' },
  cena: { available_from: '18:00', available_to: '23:00' },
  promocion: { available_from: '17:00', available_to: '19:00' },
};

function parseJsonSafe(value, fallback) {
  if (value == null || value === '') return fallback;
  if (Array.isArray(value)) return value;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

function parseRestaurantSchedule(scheduleJson) {
  try {
    return typeof scheduleJson === 'string' ? JSON.parse(scheduleJson || '{}') : scheduleJson || {};
  } catch (_) {
    return {};
  }
}

/** "HH:MM" o "H:MM" → minutos desde medianoche; null si inválido. */
function parseTimeToMinutes(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function formatMinutesToTime(mins) {
  const m = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

let cachedTimeZone = '';
let cachedTimeZoneAt = 0;

/** Zona regional del local. Se relee cada 15 s por si cambia en Configuración. */
function businessTimeZone() {
  const nowMs = Date.now();
  if (cachedTimeZone && nowMs - cachedTimeZoneAt < 15000) return cachedTimeZone;
  try {
    const { queryOne } = require('../database');
    cachedTimeZone = resolveRegionalTimezone(queryOne) || DEFAULT_TIMEZONE;
  } catch (_) {
    cachedTimeZone = DEFAULT_TIMEZONE;
  }
  cachedTimeZoneAt = nowMs;
  return cachedTimeZone;
}

/** Reloj del negocio: minutos del día y día de semana (0 = domingo) en la zona del local. */
function businessClock(date = new Date()) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const clock = promotionEngine.clockFromDate(d, businessTimeZone());
  return {
    dateKey: clock.dateKey,
    minutes: clock.minutes,
    dayIndex: clock.dow,
  };
}

function dowFromDateKey(dateKey) {
  const [y, m, d] = String(dateKey || '').split('-').map((n) => Number(n));
  if (!y || !m || !d) return 0;
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
}

function normalizeAvailableDays(raw) {
  const arr = parseJsonSafe(raw, []);
  const valid = new Set(DAY_KEYS);
  const out = arr
    .map((d) => String(d || '').toLowerCase().trim())
    .filter((d) => valid.has(d));
  return [...new Set(out)];
}

function isScheduleEnabled(product) {
  return Number(product?.schedule_enabled || 0) === 1;
}

/** Ventana [from, to): cruza medianoche si from >= to (y no son iguales). */
function isMinuteInWindow(currentMins, fromMins, toMins) {
  if (fromMins == null || toMins == null) return false;
  if (fromMins === toMins) return true;
  if (fromMins < toMins) {
    return currentMins >= fromMins && currentMins < toMins;
  }
  return currentMins >= fromMins || currentMins < toMins;
}

function productScheduleWindow(product) {
  const fromMins = parseTimeToMinutes(product.available_from);
  const toMins = parseTimeToMinutes(product.available_to);
  return { fromMins, toMins, from: product.available_from, to: product.available_to };
}

function isDayAllowed(product, dayKey) {
  const days = normalizeAvailableDays(product.available_days);
  if (days.length === 0) return true;
  return days.includes(dayKey);
}

function scheduleTypeLabel(type) {
  const t = String(type || 'personalizado').toLowerCase();
  const labels = {
    desayuno: 'Desayuno',
    almuerzo: 'Almuerzo',
    cena: 'Cena',
    promocion: 'Promoción',
    personalizado: 'Horario personalizado',
  };
  return labels[t] || labels.personalizado;
}

/**
 * @returns {{ available: boolean, reason?: string, label?: string, available_from?: string, available_to?: string, next_available_hint?: string }}
 */
function evaluateProductSchedule(product, now = new Date(), restaurantSchedule = null) {
  if (!product || !isScheduleEnabled(product)) {
    return { available: true, label: null };
  }

  const { fromMins, toMins, from, to } = productScheduleWindow(product);
  if (fromMins == null || toMins == null) {
    return { available: true, label: scheduleTypeLabel(product.schedule_type) };
  }

  const clock = businessClock(now);
  const dayKey = DAY_KEYS[clock.dayIndex];
  const label = scheduleTypeLabel(product.schedule_type);

  if (!isDayAllowed(product, dayKey)) {
    return {
      available: false,
      reason: 'no_day',
      label,
      available_from: from,
      available_to: to,
      next_available_hint: buildNextAvailableHint(product, clock),
    };
  }

  const inWindow = isMinuteInWindow(clock.minutes, fromMins, toMins);

  if (inWindow) {
    return { available: true, label, available_from: from, available_to: to };
  }

  return {
    available: false,
    reason: 'outside_hours',
    label,
    available_from: from,
    available_to: to,
    next_available_hint: buildNextAvailableHint(product, clock),
  };
}

function buildNextAvailableHint(product, clock) {
  const { from } = productScheduleWindow(product);
  if (!from) return null;
  const fromMins = parseTimeToMinutes(product.available_from);
  if (fromMins == null) return from;
  for (let d = 0; d < 8; d += 1) {
    const dateKey = d === 0 ? clock.dateKey : shiftBusinessDateKey(clock.dateKey, d);
    const dayKey = DAY_KEYS[d === 0 ? clock.dayIndex : dowFromDateKey(dateKey)];
    if (!isDayAllowed(product, dayKey)) continue;
    if (d === 0 && clock.minutes >= fromMins) continue;
    const timeStr = formatMinutesToTime(fromMins);
    if (d === 0) return timeStr;
    return `${dayKey} ${timeStr}`;
  }
  return from;
}

function isProductAvailableNow(product, now = new Date(), restaurantSchedule = null) {
  return evaluateProductSchedule(product, now, restaurantSchedule).available;
}

function attachScheduleStatus(product, now = new Date(), restaurantSchedule = null) {
  const status = evaluateProductSchedule(product, now, restaurantSchedule);
  product.schedule_status = status;
  product.schedule_available = status.available;
  return product;
}

function filterAvailableProducts(products, now = new Date(), restaurantSchedule = null) {
  return products.filter((p) => isProductAvailableNow(p, now, restaurantSchedule));
}

function assertProductAvailableForOrder(product, now = new Date(), restaurantSchedule = null) {
  const status = evaluateProductSchedule(product, now, restaurantSchedule);
  if (status.available) return;
  const from = status.available_from || '';
  const label = status.label ? `${status.label}: ` : '';
  throw new Error(
    `${label}${product.name} no está disponible en este horario${from ? ` (desde ${from})` : ''}`
  );
}

function parseScheduleFieldsFromBody(body) {
  const schedule_enabled = Number(body.schedule_enabled) === 1 ? 1 : 0;
  let schedule_type = String(body.schedule_type || 'personalizado').toLowerCase().trim();
  if (!SCHEDULE_TYPES.has(schedule_type)) schedule_type = 'personalizado';

  let available_from = String(body.available_from ?? '').trim();
  let available_to = String(body.available_to ?? '').trim();

  if (schedule_enabled && schedule_type !== 'personalizado' && SCHEDULE_PRESETS[schedule_type]) {
    if (!available_from) available_from = SCHEDULE_PRESETS[schedule_type].available_from;
    if (!available_to) available_to = SCHEDULE_PRESETS[schedule_type].available_to;
  }

  const available_days = normalizeAvailableDays(body.available_days);
  const available_days_json = JSON.stringify(available_days);

  return {
    schedule_enabled,
    schedule_type,
    available_from,
    available_to,
    available_days: available_days_json,
  };
}

function validateScheduleConfig(fields, restaurantScheduleJson) {
  const warnings = [];
  if (!fields.schedule_enabled) {
    return { ok: true, warnings, fields };
  }

  const fromMins = parseTimeToMinutes(fields.available_from);
  const toMins = parseTimeToMinutes(fields.available_to);
  if (fromMins == null || toMins == null) {
    return { ok: false, error: 'Indica hora de inicio y fin válidas (HH:MM)' };
  }

  const schedule = parseRestaurantSchedule(restaurantScheduleJson);
  const days = normalizeAvailableDays(fields.available_days);
  const daysToCheck = days.length > 0 ? days : DAY_KEYS.slice(1).concat(['domingo']);

  for (const dayKey of daysToCheck) {
    const block = schedule[dayKey];
    if (!block?.enabled) {
      warnings.push(`El local está cerrado los ${dayKey}; el producto no será visible ese día.`);
      continue;
    }
    const openM = parseTimeToMinutes(block.open);
    const closeM = parseTimeToMinutes(block.close);
    if (openM == null || closeM == null) continue;

    if (!isWindowWithinRestaurant(fromMins, toMins, openM, closeM)) {
      warnings.push(
        `El horario del producto (${fields.available_from}–${fields.available_to}) puede quedar fuera del horario del local (${block.open}–${block.close}) el ${dayKey}.`
      );
    }
  }

  return { ok: true, warnings, fields };
}

/** Producto [from,to) contenido en horario local [open,close) sin cruce de medianoche en local. */
function isWindowWithinRestaurant(fromMins, toMins, openMins, closeMins) {
  if (openMins == null || closeMins == null) return true;
  if (openMins === closeMins) return true;
  if (openMins < closeMins) {
    if (fromMins < toMins) {
      return fromMins >= openMins && toMins <= closeMins;
    }
    return false;
  }
  return true;
}

function normalizeProductScheduleColumns(product) {
  if (!product || typeof product !== 'object') return product;
  product.schedule_enabled = Number(product.schedule_enabled || 0);
  product.available_days = normalizeAvailableDays(product.available_days);
  if (!product.schedule_type) product.schedule_type = 'personalizado';
  return product;
}

module.exports = {
  DAY_KEYS,
  SCHEDULE_PRESETS,
  SCHEDULE_TYPES,
  parseRestaurantSchedule,
  parseTimeToMinutes,
  formatMinutesToTime,
  normalizeAvailableDays,
  isScheduleEnabled,
  evaluateProductSchedule,
  isProductAvailableNow,
  attachScheduleStatus,
  filterAvailableProducts,
  assertProductAvailableForOrder,
  parseScheduleFieldsFromBody,
  validateScheduleConfig,
  scheduleTypeLabel,
  normalizeProductScheduleColumns,
};
