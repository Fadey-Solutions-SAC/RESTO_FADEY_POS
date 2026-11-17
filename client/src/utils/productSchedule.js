/**
 * Disponibilidad horaria de productos (espejo de server/services/productScheduleService.js).
 * La hora es la del restaurante (America/Lima), no la del navegador ni la del servidor.
 */

const BUSINESS_TZ = 'America/Lima';
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export const DAY_KEYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

export const SCHEDULE_PRESETS = {
  desayuno: { available_from: '07:00', available_to: '11:00' },
  almuerzo: { available_from: '12:00', available_to: '16:00' },
  cena: { available_from: '18:00', available_to: '23:00' },
  promocion: { available_from: '17:00', available_to: '19:00' },
};

const SCHEDULE_TYPE_LABELS = {
  desayuno: 'Desayuno',
  almuerzo: 'Almuerzo',
  cena: 'Cena',
  promocion: 'Promoción',
  personalizado: 'Horario personalizado',
};

function parseJsonDays(raw) {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) return raw;
  try {
    const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(p) ? p : [];
  } catch (_) {
    return [];
  }
}

export function parseTimeToMinutes(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export function formatMinutesToTime(mins) {
  const m = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export function normalizeAvailableDays(raw) {
  const valid = new Set(DAY_KEYS);
  return [...new Set(
    parseJsonDays(raw)
      .map((d) => String(d || '').toLowerCase().trim())
      .filter((d) => valid.has(d)),
  )];
}

function isScheduleEnabled(product) {
  return Number(product?.schedule_enabled || 0) === 1;
}

function isMinuteInWindow(currentMins, fromMins, toMins) {
  if (fromMins == null || toMins == null) return false;
  if (fromMins === toMins) return true;
  if (fromMins < toMins) return currentMins >= fromMins && currentMins < toMins;
  return currentMins >= fromMins || currentMins < toMins;
}

function isDayAllowed(product, dayKey) {
  const days = normalizeAvailableDays(product.available_days);
  if (days.length === 0) return true;
  return days.includes(dayKey);
}

export function scheduleTypeLabel(type, t) {
  if (t) {
    const key = `products.schedule.types.${String(type || 'personalizado').toLowerCase()}`;
    const tr = t(key, { defaultValue: '' });
    if (tr) return tr;
  }
  return SCHEDULE_TYPE_LABELS[String(type || 'personalizado').toLowerCase()] || SCHEDULE_TYPE_LABELS.personalizado;
}

function businessClock(date = new Date()) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: BUSINESS_TZ,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    });
    const map = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
    let hour = Number(map.hour);
    if (hour === 24) hour = 0;
    const dayIndex = WEEKDAYS[map.weekday];
    if (dayIndex == null || !Number.isFinite(hour)) throw new Error('clock');
    return { minutes: hour * 60 + Number(map.minute), dayIndex };
  } catch (_) {
    return { minutes: d.getHours() * 60 + d.getMinutes(), dayIndex: d.getDay() };
  }
}

export function evaluateProductSchedule(product, now = new Date()) {
  if (!product || !isScheduleEnabled(product)) {
    return { available: true, label: null };
  }

  const fromMins = parseTimeToMinutes(product.available_from);
  const toMins = parseTimeToMinutes(product.available_to);
  const from = product.available_from;
  const to = product.available_to;
  const label = scheduleTypeLabel(product.schedule_type);

  if (fromMins == null || toMins == null) {
    return { available: true, label };
  }

  const clock = businessClock(now);
  const dayKey = DAY_KEYS[clock.dayIndex];
  if (!isDayAllowed(product, dayKey)) {
    return {
      available: false,
      reason: 'no_day',
      label,
      available_from: from,
      available_to: to,
    };
  }

  if (isMinuteInWindow(clock.minutes, fromMins, toMins)) {
    return { available: true, label, available_from: from, available_to: to };
  }

  return {
    available: false,
    reason: 'outside_hours',
    label,
    available_from: from,
    available_to: to,
  };
}

export function isProductAvailableNow(product, now = new Date()) {
  return evaluateProductSchedule(product, now).available;
}

/** Oculta productos fuera de horario (modo por defecto en ventas). */
export function filterProductsForOrdering(products, now = new Date()) {
  return products.filter((p) => isProductAvailableNow(p, now));
}

export function getScheduleBadgeText(product, t) {
  if (!isScheduleEnabled(product)) return null;
  const st = evaluateProductSchedule(product);
  const label = scheduleTypeLabel(product.schedule_type, t);
  if (st.available && label) return label;
  if (!st.available && st.available_from) {
    return t
      ? t('products.schedule.availableFrom', { time: st.available_from })
      : `Desde ${st.available_from}`;
  }
  return label;
}

export function validateScheduleAgainstRestaurant(fields, restaurantSchedule, t) {
  const warnings = [];
  if (!Number(fields.schedule_enabled)) return warnings;

  const fromMins = parseTimeToMinutes(fields.available_from);
  const toMins = parseTimeToMinutes(fields.available_to);
  if (fromMins == null || toMins == null) return warnings;

  const schedule = restaurantSchedule || {};
  const days = normalizeAvailableDays(fields.available_days);
  const daysToCheck = days.length > 0 ? days : DAY_KEYS;

  for (const dayKey of daysToCheck) {
    const block = schedule[dayKey];
    if (!block?.enabled) {
      warnings.push(
        t
          ? t('products.schedule.warnClosedDay', { day: dayKey })
          : `El local está cerrado los ${dayKey}.`,
      );
    }
  }
  return warnings;
}

export function applySchedulePreset(type, current = {}) {
  const preset = SCHEDULE_PRESETS[type];
  if (!preset) return current;
  return {
    ...current,
    schedule_type: type,
    available_from: preset.available_from,
    available_to: preset.available_to,
  };
}
