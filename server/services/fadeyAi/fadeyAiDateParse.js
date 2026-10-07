/**
 * Interpreta períodos en español natural para la IA Fadey.
 * Función pura: recibe `today` (YYYY-MM-DD, día de negocio) y devuelve { scope, from, to, label, explicit }.
 */

const WEEKDAYS = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
};
const WEEKDAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const MONTHS = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};
const MONTH_NAMES = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MONTH_RE = Object.keys(MONTHS).join('|');
const WEEKDAY_RE = Object.keys(WEEKDAYS).join('|');

const NUMBER_WORDS = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, quince: 15, veinte: 20, treinta: 30,
};

function pad(n) {
  return String(n).padStart(2, '0');
}

function toKey(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function parseKey(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  return { y, m, d };
}

function keyToUtc(key) {
  const { y, m, d } = parseKey(key);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

function utcToKey(dt) {
  return toKey(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function shift(key, days) {
  const dt = keyToUtc(key);
  dt.setUTCDate(dt.getUTCDate() + days);
  return utcToKey(dt);
}

function weekday(key) {
  return keyToUtc(key).getUTCDay();
}

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function isValidDate(y, m, d) {
  return y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

function mondayOf(key) {
  const dow = weekday(key);
  return shift(key, -(dow === 0 ? 6 : dow - 1));
}

function display(key) {
  const { y, m, d } = parseKey(key);
  return `${pad(d)}/${pad(m)}/${y}`;
}

function dayLabel(key) {
  return `${WEEKDAY_NAMES[weekday(key)]} ${display(key)}`;
}

function normalize(message) {
  return String(message || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function day(key, label) {
  return { scope: 'day', from: key, to: key, label: label || dayLabel(key), explicit: true };
}

function range(from, to, label) {
  return { scope: 'range', from, to, label, explicit: true };
}

function wordToNumber(w) {
  if (/^\d+$/.test(w)) return Number(w);
  return NUMBER_WORDS[w] || 0;
}

/** Año de 2 o 4 dígitos; si falta, año actual (o anterior si la fecha quedaría en el futuro). */
function resolveYear(rawYear, m, d, today) {
  if (rawYear) {
    const y = Number(rawYear);
    return y < 100 ? 2000 + y : y;
  }
  const t = parseKey(today);
  const candidate = toKey(t.y, m, d);
  return candidate > today ? t.y - 1 : t.y;
}

/** Busca una fecha explícita en el texto; devuelve { key, index, length } o null. */
function findExplicitDates(m, today) {
  const found = [];
  const push = (key, index, length) => {
    if (key && !found.some((f) => f.index === index)) found.push({ key, index, length });
  };
  let r;

  const iso = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g;
  while ((r = iso.exec(m))) {
    const y = Number(r[1]); const mo = Number(r[2]); const d = Number(r[3]);
    if (isValidDate(y, mo, d)) push(toKey(y, mo, d), r.index, r[0].length);
  }

  const dmy = /\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/g;
  while ((r = dmy.exec(m))) {
    if (found.some((f) => r.index >= f.index && r.index < f.index + f.length)) continue;
    const d = Number(r[1]); const mo = Number(r[2]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    const y = resolveYear(r[3], mo, d, today);
    if (isValidDate(y, mo, d)) push(toKey(y, mo, d), r.index, r[0].length);
  }

  const words = new RegExp(`\\b(\\d{1,2}) (?:de )?(${MONTH_RE})(?: (?:de |del )?(\\d{4}))?\\b`, 'g');
  while ((r = words.exec(m))) {
    const d = Number(r[1]); const mo = MONTHS[r[2]];
    const y = resolveYear(r[3], mo, d, today);
    if (isValidDate(y, mo, d)) push(toKey(y, mo, d), r.index, r[0].length);
  }

  return found.sort((a, b) => a.index - b.index);
}

/** "el 20", "dia 20": día del mes actual (o del anterior si aún no llega). */
function findBareDayOfMonth(m, today) {
  const r = m.match(/\b(?:el dia|del dia|el|del|dia)\s+(\d{1,2})\b(?!\s*(?:dias|semanas|meses|horas|min|uds|unidades|productos|platos|%|[/.-]\d))/)
    || m.match(/^(\d{1,2})$/);
  if (!r) return null;
  const d = Number(r[1]);
  if (d < 1 || d > 31) return null;
  const t = parseKey(today);
  let y = t.y; let mo = t.m;
  if (d > t.d) {
    mo -= 1;
    if (mo < 1) { mo = 12; y -= 1; }
  }
  if (!isValidDate(y, mo, d)) return null;
  return toKey(y, mo, d);
}

function monthRange(y, mo, today) {
  const from = toKey(y, mo, 1);
  const last = toKey(y, mo, daysInMonth(y, mo));
  const to = last > today ? today : last;
  return { ...range(from, to, `${MONTH_NAMES[mo]} ${y}`), scope: 'month' };
}

function spanDays(from, to) {
  const a = keyToUtc(from);
  const b = keyToUtc(to);
  return Math.round((b - a) / 86400000) + 1;
}

function shiftMonth(y, m, delta) {
  let mo = m + delta;
  let yy = y;
  while (mo < 1) { mo += 12; yy -= 1; }
  while (mo > 12) { mo -= 12; yy += 1; }
  return { y: yy, m: mo };
}

/**
 * Período equivalente para comparar:
 * un día contra el mismo día de la semana anterior,
 * una semana contra la semana anterior (mismos días),
 * un mes contra el mismo tramo del mes anterior,
 * un año contra el mismo tramo del año anterior.
 */
function previousComparablePeriod(period) {
  const from = String(period?.from || '');
  const to = String(period?.to || '');
  if (!from || !to) return { from, to, label: 'el período anterior' };
  const scope = String(period.scope || '');

  if (scope === 'day' || scope === 'today' || scope === 'yesterday' || from === to) {
    const prev = shift(from, -7);
    const name = WEEKDAY_NAMES[weekday(prev)];
    return { from: prev, to: prev, scope: 'day', label: `el ${name} anterior (${display(prev)})` };
  }

  const weekend = weekday(from) === 6 && (to === shift(from, 1) || (weekday(to) === 0 && spanDays(from, to) <= 2));
  if (scope === 'weekend' || weekend) {
    const pf = shift(from, -7);
    const pt = shift(to, -7);
    return { from: pf, to: pt, scope: 'weekend', label: `el fin de semana anterior (${display(pf)} → ${display(pt)})` };
  }

  if (scope === 'week') {
    const pf = shift(from, -7);
    const pt = shift(to, -7);
    return { from: pf, to: pt, scope: 'week', label: `la semana anterior (${display(pf)} → ${display(pt)})` };
  }

  if (scope === 'month') {
    const a = parseKey(from);
    const b = parseKey(to);
    if (a.d === 1 && a.y === b.y && a.m === b.m) {
      const prev = shiftMonth(a.y, a.m, -1);
      const prevLast = daysInMonth(prev.y, prev.m);
      const full = b.d === daysInMonth(b.y, b.m);
      const endDay = full ? prevLast : Math.min(b.d, prevLast);
      const pf = toKey(prev.y, prev.m, 1);
      const pt = toKey(prev.y, prev.m, endDay);
      return {
        from: pf,
        to: pt,
        scope: 'month',
        label: full
          ? `${MONTH_NAMES[prev.m]} ${prev.y} (${display(pf)} → ${display(pt)})`
          : `los mismos días de ${MONTH_NAMES[prev.m]} (${display(pf)} → ${display(pt)})`,
      };
    }
  }

  if (scope === 'year') {
    const a = parseKey(from);
    const b = parseKey(to);
    const full = a.m === 1 && a.d === 1 && b.m === 12 && b.d === 31;
    const dim = daysInMonth(b.y - 1, b.m);
    const pf = toKey(a.y - 1, 1, 1);
    const pt = full ? toKey(a.y - 1, 12, 31) : toKey(b.y - 1, b.m, Math.min(b.d, dim));
    return {
      from: pf,
      to: pt,
      scope: 'year',
      label: full ? `el año ${a.y - 1}` : `el mismo tramo de ${a.y - 1} (${display(pf)} → ${display(pt)})`,
    };
  }

  const span = spanDays(from, to);
  const pt = shift(from, -1);
  const pf = shift(pt, -(span - 1));
  return {
    from: pf,
    to: pt,
    scope: 'range',
    label: `el período anterior equivalente (${display(pf)} → ${display(pt)})`,
  };
}

/**
 * @param {string} message
 * @param {string} today YYYY-MM-DD
 * @param {{ defaultScope?: 'today'|'month' }} [opts]
 */
function resolveNaturalPeriod(message, today, opts = {}) {
  const m = normalize(message);
  const t = parseKey(today);

  // Rangos con fechas explícitas: "del 10/09 al 20/09", "entre el 1 y el 15 de septiembre".
  const dates = findExplicitDates(m, today);
  if (dates.length >= 2 && /\b(al|a|hasta|y)\b|-/.test(m.slice(dates[0].index, dates[1].index + 1))) {
    const [a, b] = [dates[0].key, dates[1].key].sort();
    return range(a, b, `del ${display(a)} al ${display(b)}`);
  }
  const rangeDays = m.match(new RegExp(`\\b(?:del|entre el|desde el)\\s+(\\d{1,2})\\s+(?:al|y el|hasta el)\\s+(\\d{1,2})\\s+(?:de\\s+)?(${MONTH_RE})(?:\\s+(?:de\\s+|del\\s+)?(\\d{4}))?`));
  if (rangeDays) {
    const mo = MONTHS[rangeDays[3]];
    const d1 = Number(rangeDays[1]); const d2 = Number(rangeDays[2]);
    const y = resolveYear(rangeDays[4], mo, Math.min(d1, d2), today);
    if (isValidDate(y, mo, d1) && isValidDate(y, mo, d2)) {
      const a = toKey(y, mo, Math.min(d1, d2)); const b = toKey(y, mo, Math.max(d1, d2));
      return range(a, b, `del ${display(a)} al ${display(b)}`);
    }
  }
  if (dates.length === 1) return day(dates[0].key);

  if (/\bantier\b|\banteayer\b|\bantes de ayer\b/.test(m)) return day(shift(today, -2), `anteayer (${dayLabel(shift(today, -2))})`);
  if (/\bayer\b/.test(m)) return day(shift(today, -1), `ayer (${dayLabel(shift(today, -1))})`);
  if (/\bmanana\b/.test(m) && !/\b(en la|de la|por la|esta) manana\b/.test(m)) {
    return { scope: 'today', from: today, to: today, label: 'hoy', explicit: false };
  }

  const haceDias = m.match(/\bhace (\d+|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|quince|veinte|treinta) (dias?|semanas?|mes(?:es)?)\b/);
  if (haceDias) {
    const n = wordToNumber(haceDias[1]);
    const unit = haceDias[2];
    if (n > 0) {
      if (/^dia/.test(unit)) return day(shift(today, -n), `hace ${n} día(s) (${dayLabel(shift(today, -n))})`);
      if (/^semana/.test(unit)) {
        const from = mondayOf(shift(today, -7 * n));
        return { ...range(from, shift(from, 6), `semana de hace ${n} (${display(from)} → ${display(shift(from, 6))})`), scope: 'week' };
      }
      let y = t.y; let mo = t.m - n;
      while (mo < 1) { mo += 12; y -= 1; }
      return monthRange(y, mo, today);
    }
  }

  // Día de la semana: "último domingo", "domingo pasado", "el lunes", "este viernes", "penúltimo sábado".
  const wd = m.match(new RegExp(`\\b(penultimo|ultimo|este|esta|el|del|los|pasado)?\\s*(${WEEKDAY_RE})\\b(\\s+(pasado|anterior|ultimo))?`));
  if (wd) {
    const target = WEEKDAYS[wd[2]];
    const pre = wd[1] || '';
    const post = wd[4] || '';
    const dowToday = weekday(today);
    let back = (dowToday - target + 7) % 7;
    const strictPast = /ultimo|penultimo|pasado/.test(pre) || /pasado|anterior|ultimo/.test(post);
    if (strictPast && back === 0) back = 7;
    if (/este|esta/.test(pre)) {
      const monday = mondayOf(today);
      const key = shift(monday, target === 0 ? 6 : target - 1);
      if (key <= today) return day(key, `este ${WEEKDAY_NAMES[target]} (${display(key)})`);
      back = (dowToday - target + 7) % 7 || 7;
    }
    if (/penultimo/.test(pre)) back += 7;
    const key = shift(today, -back);
    const tag = /penultimo/.test(pre) ? 'penúltimo' : strictPast ? 'último' : 'el';
    return day(key, `${tag} ${WEEKDAY_NAMES[target]} (${display(key)})`);
  }

  if (/\bfin(?:es)? de semana\b/.test(m)) {
    const pasado = /pasado|anterior|ultimo/.test(m);
    const dow = weekday(today);
    let sat = shift(today, -((dow - 6 + 7) % 7));
    if (pasado && sat >= shift(today, -1) && dow !== 1) sat = shift(sat, -7);
    const sun = shift(sat, 1) > today ? today : shift(sat, 1);
    return { ...range(sat, sun, `fin de semana (${display(sat)} → ${display(sun)})`), scope: 'weekend' };
  }

  if (/ultim[oa]s?\s+(\d+|siete|quince|treinta)\s*dias/.test(m)) {
    const n = wordToNumber(m.match(/ultim[oa]s?\s+(\d+|siete|quince|treinta)\s*dias/)[1]) || 7;
    const from = shift(today, -(n - 1));
    return { ...range(from, today, `últimos ${n} días (${display(from)} → ${display(today)})`), scope: 'rolling' };
  }
  if (/semana pasada|la semana anterior|ultima semana/.test(m)) {
    const from = shift(mondayOf(today), -7);
    const to = shift(from, 6);
    return { ...range(from, to, `la semana pasada (${display(from)} → ${display(to)})`), scope: 'week' };
  }
  if (/esta semana|semana actual|de la semana\b|\bsemana\b/.test(m) && !/\bmes\b/.test(m)) {
    const from = mondayOf(today);
    return { ...range(from, today, `esta semana (${display(from)} → ${display(today)})`), scope: 'week' };
  }

  if (/mes pasado|mes anterior|ultimo mes/.test(m)) {
    let y = t.y; let mo = t.m - 1;
    if (mo < 1) { mo = 12; y -= 1; }
    return { ...monthRange(y, mo, today), scope: 'month' };
  }
  const namedMonth = m.match(new RegExp(`\\b(?:mes de |en |de |del )?(${MONTH_RE})(?:\\s+(?:de |del )?(\\d{4}))?\\b`));
  if (namedMonth) {
    const mo = MONTHS[namedMonth[1]];
    let y = namedMonth[2] ? Number(namedMonth[2]) : t.y;
    if (!namedMonth[2] && mo > t.m) y -= 1;
    return { ...monthRange(y, mo, today), scope: 'month' };
  }
  if (/\b(este\s+)?mes\b|del mes|mes actual|lo que va del mes/.test(m)) {
    return { ...range(toKey(t.y, t.m, 1), today, `este mes (${pad(t.m)}/${t.y})`), scope: 'month' };
  }
  if (/ano pasado|ano anterior/.test(m)) {
    return { ...range(toKey(t.y - 1, 1, 1), toKey(t.y - 1, 12, 31), `año ${t.y - 1}`), scope: 'year' };
  }
  if (/este ano|del ano|en el ano|lo que va del ano/.test(m)) {
    return { ...range(toKey(t.y, 1, 1), today, `año ${t.y}`), scope: 'year' };
  }

  const bare = findBareDayOfMonth(m, today);
  if (bare) return day(bare);

  if (/\bhoy\b|\bde hoy\b/.test(m)) return { scope: 'today', from: today, to: today, label: 'hoy', explicit: true };
  if (/\b(del|este|el|en el) periodo\b/.test(m)) {
    return { ...range(toKey(t.y, t.m, 1), today, `este mes (${pad(t.m)}/${t.y})`), scope: 'month' };
  }

  if (opts.defaultScope === 'month') {
    return { scope: 'month', from: toKey(t.y, t.m, 1), to: today, label: `este mes (${pad(t.m)}/${t.y})`, explicit: false };
  }
  return { scope: 'today', from: today, to: today, label: 'hoy', explicit: false };
}

module.exports = {
  resolveNaturalPeriod,
  previousComparablePeriod,
  normalizeSpanish: normalize,
  displayDateKey: display,
};
