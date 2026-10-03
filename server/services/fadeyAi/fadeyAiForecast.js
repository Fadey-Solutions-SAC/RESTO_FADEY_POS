/**
 * IA Fadey — pronóstico por día de la semana (100 % local, historial del POS):
 * - días que normalmente no se abre caja (local cerrado),
 * - venta esperada de los próximos días y tendencia por día (mes reciente vs mes anterior),
 * - productos que más salen el día que viene, por área de producción,
 * - insumos de esas recetas con stock corto (o sugerencia de prepararlos si no usan almacén de insumos),
 * - productos de almacén (no transformados) que no alcanzan → aviso al administrador,
 * - sugerencia de cerrar un día que vende muy poco y viene bajando.
 */
const { queryAll, queryOne } = require('../../database');
const { getBusinessTodayDateKey, shiftBusinessDateKey, sqlBusinessTimestamp } = require('../../utils/appDateTime');
const { getPaidSalesEventSql } = require('../../utils/salesAccountGrouping');
const { resolveKardexInsumoLines } = require('../../utils/productKardexInsumos');
const { insumoNeedForLine } = require('../../utils/salesCogs');
const { readProductionAreas, resolveProductProductionAreaId } = require('../productionAreasService');

const WINDOW_DAYS = 56;
const RECENT_DAYS = 28;
const WD = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const WD_PLURAL = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];
/** Cargos que se venden como producto pero no se preparan (servicios, alquileres, roturas, cover…). */
const NON_PREP_RE = /\b(habitaci[oó]n(es)?|alquiler|roto|rotura|cover|entrada|servicio|propina|delivery|descorche|taper|envase|bolsa|cochera|estacionamiento|camping|ping\s?pong|piscina|karaoke)\b/i;

const PAID_WHERE = `o.status != 'cancelled'
  AND o.payment_status = 'paid'
  AND IFNULL(o.payment_method, '') NOT IN ('cortesia', 'cuenta_cliente')`;

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const money = (n) => `S/ ${Number(n || 0).toFixed(2)}`;
const fmtQty = (n) => (Number.isInteger(Number(n)) ? String(Number(n)) : Number(n).toFixed(2));

function dowOf(key) {
  return new Date(`${key}T12:00:00Z`).getUTCDay();
}

function shortDate(key) {
  const [, m, d] = String(key).split('-');
  return `${d}/${m}`;
}

function safeAll(sql, params = []) {
  try {
    return queryAll(sql, params) || [];
  } catch (_) {
    return [];
  }
}

/* ───────────── Análisis puro (sin base de datos) ───────────── */

/**
 * @param {{ today: string, dailySales: Array<{d:string,total:number,cnt:number}>, openDates: string[],
 *           productDaily: Array<{d:string,product_id:string,name:string,qty:number}> }} input
 */
function analyzeHistory({ today, dailySales, openDates, productDaily }) {
  const end = shiftBusinessDateKey(today, -1);
  const salesBy = new Map(dailySales.map((r) => [r.d, { total: Number(r.total || 0), cnt: Number(r.cnt || 0) }]));
  const open = new Set(openDates);
  for (const r of dailySales) if (Number(r.total || 0) > 0) open.add(r.d);

  const activity = [...open].filter((d) => d <= end).sort();
  const windowStart = shiftBusinessDateKey(today, -WINDOW_DAYS);
  const start = activity.length && activity[0] > windowStart ? activity[0] : windowStart;
  const recentStart = shiftBusinessDateKey(today, -RECENT_DAYS);

  const days = [];
  for (let d = start; d <= end; d = shiftBusinessDateKey(d, 1)) days.push(d);

  const wd = Array.from({ length: 7 }, (_, dow) => ({
    dow, occ: 0, openCount: 0, recentOpen: 0, prevOpen: 0, recentSum: 0, prevSum: 0, cntSum: 0,
  }));
  for (const d of days) {
    const w = wd[dowOf(d)];
    w.occ += 1;
    if (!open.has(d)) continue;
    const s = salesBy.get(d) || { total: 0, cnt: 0 };
    w.openCount += 1;
    w.cntSum += s.cnt;
    if (d >= recentStart) { w.recentOpen += 1; w.recentSum += s.total; } else { w.prevOpen += 1; w.prevSum += s.total; }
  }

  let recentOpenDays = 0;
  let recentTotal = 0;
  for (const w of wd) {
    w.recentAvg = w.recentOpen ? w.recentSum / w.recentOpen : null;
    w.prevAvg = w.prevOpen ? w.prevSum / w.prevOpen : null;
    w.avgCnt = w.openCount ? w.cntSum / w.openCount : 0;
    w.closed = w.occ >= 3 && w.openCount / w.occ <= 0.25;
    w.trend = w.recentOpen >= 2 && w.prevOpen >= 2 && w.prevAvg > 0 ? (w.recentAvg - w.prevAvg) / w.prevAvg : null;
    if (w.recentAvg != null && w.prevAvg != null) w.expected = (2 * w.recentAvg + w.prevAvg) / 3;
    else w.expected = w.recentAvg ?? w.prevAvg ?? 0;
    recentOpenDays += w.recentOpen;
    recentTotal += w.recentSum;
  }
  const typicalDay = recentOpenDays ? recentTotal / recentOpenDays : 0;

  const totalOpen = wd.reduce((s, w) => s + w.openCount, 0);
  const productMap = new Map();
  for (const r of productDaily) {
    if (!open.has(r.d) || r.d < start || r.d > end) continue;
    const id = String(r.product_id || r.name);
    if (!productMap.has(id)) productMap.set(id, { id, name: r.name, total: 0, byDow: Array(7).fill(0) });
    const p = productMap.get(id);
    const q = Number(r.qty || 0);
    p.total += q;
    p.byDow[dowOf(r.d)] += q;
  }
  const products = [...productMap.values()].map((p) => ({
    ...p,
    avgDay: totalOpen ? p.total / totalOpen : 0,
    avgByDow: p.byDow.map((q, dow) => (wd[dow].openCount ? q / wd[dow].openCount : 0)),
  }));

  const closingSuggestions = wd
    .filter((w) => !w.closed && w.recentOpen >= 3 && typicalDay > 0 && w.recentAvg != null)
    .map((w) => ({ ...w, share: w.recentAvg / typicalDay }))
    .filter((w) => (w.share < 0.45 && (w.trend == null || w.trend <= -0.15)) || w.share < 0.3)
    .sort((a, b) => a.share - b.share);

  return {
    start, end, days: days.length, totalOpen, weekdays: wd, typicalDay, products, closingSuggestions,
    enoughData: totalOpen >= 7,
  };
}

/** Productos esperados para un día de la semana (top + los que suben ese día). */
function productsForDow(analysis, dow, limit = 8, minAvg = 1) {
  return analysis.products
    .map((p) => ({
      id: p.id,
      name: p.name,
      qty: Math.ceil(p.avgByDow[dow] - 1e-9),
      avg: p.avgByDow[dow],
      lift: p.avgDay > 0 ? p.avgByDow[dow] / p.avgDay : 0,
    }))
    .filter((p) => p.avg >= minAvg && !NON_PREP_RE.test(p.name))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, limit)
    .map((p) => ({ ...p, hot: p.lift >= 1.25 && p.avg >= 2 }));
}

/* ───────────── Datos ───────────── */

function loadHistory(today) {
  const ps = getPaidSalesEventSql();
  const from = shiftBusinessDateKey(today, -WINDOW_DAYS);
  const end = shiftBusinessDateKey(today, -1);
  const dailySales = safeAll(
    `SELECT ${ps.ORDER_DATE} AS d, COUNT(*) AS cnt, IFNULL(SUM(o.total), 0) AS total
     FROM orders o WHERE ${PAID_WHERE} AND ${ps.ORDER_DATE} >= date(?) AND ${ps.ORDER_DATE} <= date(?)
     GROUP BY d`,
    [from, end],
  );
  const regLocal = sqlBusinessTimestamp('cr.opened_at', queryOne);
  const openDates = safeAll(
    `SELECT DISTINCT DATE(${regLocal}) AS d FROM cash_registers cr
     WHERE cr.opened_at IS NOT NULL AND DATE(${regLocal}) >= date(?) AND DATE(${regLocal}) <= date(?)`,
    [from, end],
  ).map((r) => r.d).filter(Boolean);
  const productDaily = safeAll(
    `SELECT ${ps.ORDER_DATE} AS d, IFNULL(oi.product_id, '') AS product_id, oi.product_name AS name,
            SUM(oi.quantity) AS qty
     FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE ${PAID_WHERE} AND ${ps.ORDER_DATE} >= date(?) AND ${ps.ORDER_DATE} <= date(?)
       AND IFNULL(oi.variant_name, '') != 'combo'
     GROUP BY d, IFNULL(oi.product_id, ''), oi.product_name`,
    [from, end],
  );
  return { dailySales, openDates, productDaily };
}

let CACHE = { key: '', at: 0, value: null };

function getAnalysis() {
  const today = getBusinessTodayDateKey(queryOne);
  if (CACHE.value && CACHE.key === today && Date.now() - CACHE.at < 10 * 60 * 1000) return CACHE.value;
  const value = { today, ...analyzeHistory({ today, ...loadHistory(today) }) };
  CACHE = { key: today, at: Date.now(), value };
  return value;
}

function loadProducts(ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Map();
  const rows = safeAll(`SELECT * FROM products WHERE id IN (${list.map(() => '?').join(',')})`, list);
  return new Map(rows.map((p) => [String(p.id), p]));
}

function usesInsumoStore() {
  try {
    return Number(queryOne('SELECT COUNT(*) AS n FROM insumos WHERE IFNULL(activo, 1) = 1')?.n || 0) > 0;
  } catch (_) {
    return false;
  }
}

/** Necesidad de insumos para `qty` unidades del producto: [{ insumo, need }]. */
function insumoNeeds(product, qty) {
  const out = [];
  const lines = resolveKardexInsumoLines(product);
  if (lines.length) {
    for (const line of lines) {
      const ins = queryOne('SELECT * FROM insumos WHERE id = ?', [line.insumo_id]);
      if (ins) out.push({ insumo: ins, need: insumoNeedForLine(ins, line, qty) });
    }
    return out;
  }
  const rec = queryOne('SELECT id FROM recetas WHERE product_id = ? AND IFNULL(activo, 1) = 1 LIMIT 1', [product.id]);
  if (!rec?.id) return out;
  for (const d of safeAll('SELECT * FROM receta_detalle WHERE receta_id = ?', [rec.id])) {
    const ins = queryOne('SELECT * FROM insumos WHERE id = ?', [d.insumo_id]);
    if (ins) out.push({ insumo: ins, need: Number(d.cantidad_usada || 0) * qty });
  }
  return out;
}

function stockStatus(stock, need, min) {
  if (need <= 0) return null;
  if (stock < need) return 'falta';
  if (stock - need < Math.max(Number(min || 0), need * 0.5)) return 'poco';
  return null;
}

/** Próximos días a preparar: hoy (si aún es temprano) y los siguientes abiertos. */
function upcomingTargets(analysis, { count = 2, includeToday = true } = {}) {
  const hour = Number(String(require('./fadeyAiKnowledgeService').businessNow()).slice(11, 13)) || 0;
  const out = [];
  const skippedClosed = [];
  const first = includeToday && hour < 15 ? 0 : 1;
  for (let i = first; i <= 6 && out.length < count; i += 1) {
    const date = shiftBusinessDateKey(analysis.today, i);
    const dow = dowOf(date);
    const w = analysis.weekdays[dow];
    const target = { date, dow, offset: i, closed: w.closed, expected: r2(w.expected), trend: w.trend };
    if (w.closed) { skippedClosed.push(target); continue; }
    out.push(target);
  }
  return { targets: out, skippedClosed };
}

function relativeLabel(t) {
  if (t.offset === 0) return `hoy ${WD[t.dow]} ${shortDate(t.date)}`;
  if (t.offset === 1) return `mañana ${WD[t.dow]} ${shortDate(t.date)}`;
  if (t.offset === 2) return `pasado mañana ${WD[t.dow]} ${shortDate(t.date)}`;
  return `el ${WD[t.dow]} ${shortDate(t.date)}`;
}

/**
 * Plan de preparación por área para un día.
 * @returns {{ areaProducts: Map<string, Array>, areaInsumos: Map<string, Array>, areaNoRecipe: Map<string, Array>, storeAlerts: Array }}
 */
function buildDayPlan(analysis, dow) {
  const expected = productsForDow(analysis, dow, 300, 0.5);
  const products = loadProducts(expected.map((p) => p.id));
  const storeMode = usesInsumoStore();
  const areaProducts = new Map();
  const areaInsumoNeed = new Map();
  const areaNoRecipe = new Map();
  const storeAlerts = [];
  const push = (map, key, val) => { if (!map.has(key)) map.set(key, []); map.get(key).push(val); };

  for (const e of expected) {
    const p = products.get(String(e.id));
    if (p && Number(p.is_active ?? 1) === 0) continue;
    const area = resolveProductProductionAreaId(p?.production_area);
    const nonTransformed = String(p?.process_type || '') === 'non_transformed';
    if (nonTransformed) {
      const stock = Number(p.stock || 0);
      const min = Number(p.min_stock || 0);
      const max = Number(p.max_stock || 0);
      const status = stockStatus(stock, e.qty, min);
      if (status) {
        storeAlerts.push({ name: e.name, stock, need: e.qty, min, max, restock: max > 0 ? Math.max(0, max - stock) : 0, status });
      }
      continue;
    }
    if (areaProducts.get(area)?.length >= 8) continue;
    push(areaProducts, area, e);
    if (!p) continue;
    const needs = storeMode ? insumoNeeds(p, e.qty) : [];
    if (!needs.length) {
      push(areaNoRecipe, area, e);
      continue;
    }
    if (!areaInsumoNeed.has(area)) areaInsumoNeed.set(area, new Map());
    const m = areaInsumoNeed.get(area);
    for (const { insumo, need } of needs) {
      const key = String(insumo.id);
      if (!m.has(key)) m.set(key, { insumo, need: 0, products: new Set() });
      const row = m.get(key);
      row.need += need;
      row.products.add(e.name);
    }
  }

  const areaInsumos = new Map();
  for (const [area, m] of areaInsumoNeed) {
    const rows = [];
    for (const { insumo, need, products: prods } of m.values()) {
      const stock = Number(insumo.stock_actual || 0);
      const status = stockStatus(stock, need, insumo.stock_minimo);
      if (!status) continue;
      rows.push({
        name: insumo.nombre,
        unit: insumo.unidad_medida || '',
        stock: r2(stock),
        need: r2(need),
        status,
        products: [...prods].slice(0, 3),
      });
    }
    rows.sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'falta' ? -1 : 1));
    areaInsumos.set(area, rows);
  }
  return { areaProducts, areaInsumos, areaNoRecipe, storeAlerts, storeMode };
}

/* ───────────── API para el panel de producción ───────────── */

function buildAreaPrepPlan(areaId) {
  const analysis = getAnalysis();
  const area = String(areaId || '').trim() || 'cocina';
  const areaInfo = readProductionAreas().find((a) => a.id === area);
  if (!analysis.enoughData) {
    return { ok: true, area, area_name: areaInfo?.name || area, enough_data: false, targets: [] };
  }
  const { targets, skippedClosed } = upcomingTargets(analysis, { count: 2 });
  const out = targets.map((t) => {
    const plan = buildDayPlan(analysis, t.dow);
    return {
      date: t.date,
      dow: t.dow,
      offset: t.offset,
      products: (plan.areaProducts.get(area) || []).map((p) => ({ name: p.name, qty: p.qty, hot: p.hot })),
      insumos: plan.areaInsumos.get(area) || [],
      no_recipe: (plan.areaNoRecipe.get(area) || []).map((p) => ({ name: p.name, qty: p.qty })),
      uses_insumo_store: plan.storeMode,
    };
  }).filter((t) => t.products.length);
  return {
    ok: true,
    area,
    area_name: areaInfo?.name || area,
    enough_data: true,
    targets: out,
    closed_days: skippedClosed.map((t) => ({ date: t.date, dow: t.dow, offset: t.offset })),
  };
}

/* ───────────── Texto para chat / avisos ───────────── */

function trendText(trend) {
  if (trend == null || Math.abs(trend) < 0.1) return '';
  return trend > 0 ? ` (↑ ${Math.round(trend * 100)}% vs mes anterior)` : ` (↓ ${Math.round(-trend * 100)}% vs mes anterior)`;
}

function closedDaysLine(analysis) {
  const closed = analysis.weekdays.filter((w) => w.closed).map((w) => WD_PLURAL[w.dow]);
  if (!closed.length) return '';
  return `Días que normalmente no se abre caja (local cerrado): ${closed.join(', ')}. No los cuento en el pronóstico.`;
}

function closingSuggestionLines(analysis) {
  return analysis.closingSuggestions.slice(0, 2).map((w) => {
    const pct = Math.round(w.share * 100);
    const drop = w.trend != null && w.trend < -0.1 ? ` y vienen bajando ${Math.round(-w.trend * 100)}% frente al mes anterior` : '';
    return `💡 Los ${WD_PLURAL[w.dow]} venden en promedio ${money(w.recentAvg)} (solo ${pct}% de un día normal de ${money(analysis.typicalDay)})${drop}. `
      + `Si abrir ese día te cuesta más de lo que deja (personal, luz, gas, merma), conviene evaluar cerrar los ${WD_PLURAL[w.dow]} o abrir medio turno.`;
  });
}

function storeAlertText(a) {
  const restock = a.restock > 0 ? ` → repón ~${fmtQty(a.restock)} (hasta su máximo ${fmtQty(a.max)})` : '';
  if (a.status === 'falta') return `${a.name}: ⚠ no alcanza — stock ${fmtQty(a.stock)}, se venden ~${a.need}${restock}`;
  if (a.min > 0 && a.stock < a.min) return `${a.name}: stock ${fmtQty(a.stock)}, ya bajo su mínimo (${fmtQty(a.min)}); se venden ~${a.need}${restock}`;
  if (a.min > 0 && a.stock === a.min) return `${a.name}: stock ${fmtQty(a.stock)}, justo en su mínimo; se venden ~${a.need}${restock}`;
  return `${a.name}: stock ${fmtQty(a.stock)}, quedaría bajo su mínimo tras vender ~${a.need}${restock}`;
}

function sortedStoreAlerts(plan) {
  return plan.storeAlerts.slice().sort((x, y) => (x.status === y.status ? y.need - x.need : x.status === 'falta' ? -1 : 1));
}

function areaName(id) {
  return readProductionAreas().find((a) => a.id === id)?.name || id;
}

function dayPlanLines(analysis, t, { includeStore = true } = {}) {
  const plan = buildDayPlan(analysis, t.dow);
  const lines = [];
  for (const [area, prods] of plan.areaProducts) {
    if (!prods.length) continue;
    const list = prods.slice(0, 6).map((p) => `${p.name} ~${p.qty}${p.hot ? ' ↑' : ''}`).join(', ');
    lines.push(`**${areaName(area)}** — suele salir: ${list}.`);
    const ins = plan.areaInsumos.get(area) || [];
    ins.slice(0, 6).forEach((i) => {
      const u = i.unit ? ` ${i.unit}` : '';
      lines.push(i.status === 'falta'
        ? `  ⚠ ${i.name}: no alcanza — tienes ${fmtQty(i.stock)}${u}, se necesitan ~${fmtQty(i.need)}${u} (${i.products.join(', ')}).`
        : `  • ${i.name}: te queda poco — ${fmtQty(i.stock)}${u} para ~${fmtQty(i.need)}${u} (${i.products.join(', ')}).`);
    });
    const noRec = plan.areaNoRecipe.get(area) || [];
    if (noRec.length) {
      lines.push(`  Prepara los insumos de: ${noRec.slice(0, 6).map((p) => `${p.name} (~${p.qty})`).join(', ')}${plan.storeMode ? ' (sin receta vinculada)' : ''}.`);
    }
  }
  if (includeStore && plan.storeAlerts.length) {
    lines.push(`**Almacén (administrador)** — reponer:`);
    sortedStoreAlerts(plan).slice(0, 8).forEach((a) => lines.push(`  • ${storeAlertText(a)}.`));
  }
  return { lines, plan };
}

const MAX_FORECAST_AHEAD = 62;

/**
 * Convierte lo pedido en el chat en una fecha concreta desde hoy.
 * @param {{offset?:number, dow?:number, next?:boolean, day?:number, month?:number|null}} spec
 */
function resolveForecastTarget(today, spec) {
  let offset = null;
  if (Number.isInteger(spec?.offset)) offset = spec.offset;
  else if (Number.isInteger(spec?.dow)) {
    const from = spec.next ? 1 : 0;
    for (let i = from; i < from + 7; i += 1) {
      if (dowOf(shiftBusinessDateKey(today, i)) === spec.dow) { offset = i; break; }
    }
  } else if (Number.isInteger(spec?.day)) {
    for (let i = 0; i <= MAX_FORECAST_AHEAD; i += 1) {
      const [, mm, dd] = shiftBusinessDateKey(today, i).split('-').map(Number);
      if (dd === spec.day && (spec.month == null || mm === spec.month)) { offset = i; break; }
    }
  }
  if (offset == null || offset < 0 || offset > MAX_FORECAST_AHEAD) return null;
  const date = shiftBusinessDateKey(today, offset);
  return { date, dow: dowOf(date), offset };
}

function dayListLabel(t) {
  const name = t.offset === 0 ? 'Hoy' : t.offset === 1 ? 'Mañana' : WD[t.dow].charAt(0).toUpperCase() + WD[t.dow].slice(1);
  return `${name} ${shortDate(t.date)}`;
}

function dayListLine(a, t, showMoney) {
  const w = a.weekdays[t.dow];
  if (w.closed) return `• ${dayListLabel(t)}: cerrado (no se abre caja normalmente)`;
  return `• ${dayListLabel(t)}: ${showMoney ? `~${money(w.expected)}${trendText(w.trend)}` : `~${Math.round(w.avgCnt)} pedido(s)`}`;
}

/**
 * Respuesta de chat: pronóstico de un día concreto, de varios días pedidos o de los próximos N días (+ preparación).
 * @param {{ targets?: Array<object>, days?: number|null, focusDow?: number|null, showMoney?: boolean, includeStore?: boolean }} opts
 */
function forecastAnswer({ targets: specs = [], days = null, focusDow = null, showMoney = true, includeStore = true } = {}) {
  const a = getAnalysis();
  if (!a.enoughData) {
    return 'Aún no tengo suficiente historial para pronosticar (necesito al menos 7 días con caja abierta y ventas). Sigue registrando ventas y vuelve a preguntarme.';
  }
  const requested = (specs.length ? specs : focusDow != null ? [{ dow: focusDow, next: false }] : [])
    .map((s) => resolveForecastTarget(a.today, s))
    .filter(Boolean)
    .filter((t, i, list) => list.findIndex((x) => x.offset === t.offset) === i)
    .sort((x, y) => x.offset - y.offset);

  const lines = [];
  if (requested.length === 1) {
    const t = requested[0];
    const w = a.weekdays[t.dow];
    lines.push(`**Pronóstico para ${relativeLabel(t)}**`);
    if (w.closed) {
      lines.push(`Normalmente los ${WD_PLURAL[t.dow]} no se abre caja (el local cierra), así que no espero ventas.`);
    } else {
      if (showMoney) lines.push(`Venta esperada: ~${money(w.expected)}${trendText(w.trend)} · ~${Math.round(w.avgCnt)} pedido(s).`);
      lines.push(...dayPlanLines(a, t, { includeStore }).lines);
    }
  } else if (requested.length > 1) {
    lines.push(`**Pronóstico para ${requested.map(relativeLabel).join(', ').replace(/, ([^,]*)$/, ' y $1')}**`);
    requested.forEach((t) => lines.push(dayListLine(a, t, showMoney)));
    const first = requested.find((t) => !a.weekdays[t.dow].closed);
    if (first) {
      lines.push('', `**Prepara para ${relativeLabel(first)}:**`);
      lines.push(...dayPlanLines(a, first, { includeStore }).lines);
    }
  } else {
    const count = Math.min(14, Math.max(1, Number(days) || 7));
    lines.push(`**Pronóstico de los próximos ${count} días**`);
    for (let i = 0; i < count; i += 1) {
      const date = shiftBusinessDateKey(a.today, i);
      lines.push(dayListLine(a, { date, dow: dowOf(date), offset: i }, showMoney));
    }
    const { targets } = upcomingTargets(a, { count: 1 });
    if (targets[0]) {
      lines.push('', `**Prepara para ${relativeLabel(targets[0])}:**`);
      lines.push(...dayPlanLines(a, targets[0], { includeStore }).lines);
    }
    const peak = a.weekdays.filter((w) => !w.closed && w.openCount).sort((x, y) => y.expected - x.expected)[0];
    if (peak && showMoney) lines.push('', `Día más fuerte: ${WD[peak.dow]} (~${money(peak.expected)}).`);
  }
  const closed = closedDaysLine(a);
  if (closed) lines.push('', closed);
  if (showMoney) {
    const sugg = closingSuggestionLines(a);
    if (sugg.length) lines.push('', ...sugg);
  }
  lines.push('', `Cálculo: promedio de cada día de la semana en las últimas ${Math.round(a.days / 7)} semana(s), dando más peso al último mes. ↑ = se vende más de lo normal ese día.`);
  return lines.join('\n');
}

function closedDaysAnswer() {
  const a = getAnalysis();
  if (!a.enoughData) return 'Aún no tengo suficiente historial de caja para saber qué días cierran.';
  const closed = a.weekdays.filter((w) => w.closed);
  const lines = [];
  if (closed.length) {
    lines.push(`Según el historial de caja, normalmente no se abre los **${closed.map((w) => WD_PLURAL[w.dow]).join(', ')}** (${closed.map((w) => `${w.openCount} de ${w.occ}`).join(', ')} abiertos).`);
    lines.push('Esos días no los cuento al pronosticar ventas ni al pedirte preparar insumos.');
  } else {
    lines.push('No detecto un día fijo de descanso: se abrió caja todos los días de la semana en el período analizado.');
  }
  lines.push(`Período analizado: ${a.days} días.`);
  return lines.join('\n');
}

/** «¿Conviene cerrar los miércoles?» / «los miércoles bajan». */
function weekdayAdviceAnswer(dow) {
  const a = getAnalysis();
  if (!a.enoughData) return 'Aún no tengo suficiente historial para evaluar ese día.';
  if (dow == null) {
    const sugg = closingSuggestionLines(a);
    const ranked = a.weekdays.filter((w) => !w.closed && w.recentAvg != null).sort((x, y) => x.recentAvg - y.recentAvg);
    const lines = ['**Venta promedio por día (último mes)**'];
    ranked.slice().reverse().forEach((w) => lines.push(`• ${WD[w.dow]}: ${money(w.recentAvg)}${trendText(w.trend)}`));
    const closed = closedDaysLine(a);
    if (closed) lines.push('', closed);
    lines.push('', ...(sugg.length ? sugg : ['Ningún día abierto vende tan poco como para recomendarte cerrarlo; refuerza el más flojo con promociones.']));
    return lines.join('\n');
  }
  const w = a.weekdays[dow];
  if (w.closed) return `Los ${WD_PLURAL[dow]} ya figuran como cerrados (no se abre caja normalmente).`;
  if (w.recentAvg == null) return `No hay ventas de ${WD_PLURAL[dow]} en el último mes para evaluarlo.`;
  const share = a.typicalDay > 0 ? w.recentAvg / a.typicalDay : 1;
  const lines = [`**Los ${WD_PLURAL[dow]}** — último mes: ${money(w.recentAvg)} por día (${Math.round(share * 100)}% de un día normal de ${money(a.typicalDay)})${trendText(w.trend)}.`];
  if (w.prevAvg != null) lines.push(`Mes anterior: ${money(w.prevAvg)} por día.`);
  if (a.closingSuggestions.some((s) => s.dow === dow)) {
    lines.push(`Recomendación: **evalúa cerrar los ${WD_PLURAL[dow]}** o abrir medio turno. Vende muy por debajo del resto de días${w.trend != null && w.trend < -0.1 ? ' y sigue bajando' : ''}; si el costo de abrir (personal, luz, gas, merma) supera lo que deja, cerrar mejora tu ganancia.`);
  } else if (w.trend != null && w.trend <= -0.15) {
    lines.push(`Vienen bajando, pero aún venden lo suficiente para no cerrar. Prueba una promoción o combo para los ${WD_PLURAL[dow]} y vuelve a revisar en 2–3 semanas.`);
  } else {
    lines.push(`No conviene cerrar: los ${WD_PLURAL[dow]} se mantienen dentro de lo normal.`);
  }
  return lines.join('\n');
}

/* ───────────── Avisos automáticos ───────────── */

/** Aviso diario al administrador: venta esperada, almacén corto e insumos que no alcanzan. */
function adminDailyNotice() {
  const a = getAnalysis();
  if (!a.enoughData) return null;
  const { targets } = upcomingTargets(a, { count: 1, includeToday: false });
  const t = targets[0];
  if (!t) return null;
  const { plan } = dayPlanLines(a, t);
  const parts = [`${relativeLabel(t).replace(/^./, (c) => c.toUpperCase())}: se esperan ~${money(t.expected)}${trendText(t.trend)}.`];
  if (plan.storeAlerts.length) {
    const store = sortedStoreAlerts(plan);
    const sinStock = store.filter((s) => s.status === 'falta').map((s) => s.name);
    const bajoMin = store.filter((s) => s.status !== 'falta').map((s) => `${s.name} (${fmtQty(s.stock)}/${fmtQty(s.min)})`);
    if (sinStock.length) parts.push(`Almacén sin stock suficiente: ${sinStock.slice(0, 4).join(', ')}.`);
    if (bajoMin.length) parts.push(`Almacén bajo mínimo (stock/mín.): ${bajoMin.slice(0, 4).join(', ')}.`);
  }
  const shortIns = [...plan.areaInsumos.values()].flat().filter((i) => i.status === 'falta');
  if (shortIns.length) parts.push(`Insumos que no alcanzan: ${shortIns.slice(0, 4).map((i) => i.name).join(', ')}.`);
  if (parts.length === 1) return null;
  return { key: `forecast-${t.date}`, message: parts.join(' ') };
}

/** Aviso semanal: día que conviene evaluar cerrar. */
function weeklyClosingNotice() {
  const a = getAnalysis();
  if (!a.enoughData || !a.closingSuggestions.length) return null;
  const w = a.closingSuggestions[0];
  return {
    key: `closing-${w.dow}`,
    message: `Los ${WD_PLURAL[w.dow]} venden ${money(w.recentAvg)} en promedio (${Math.round(w.share * 100)}% de un día normal)${w.trend != null && w.trend < -0.1 ? ` y bajaron ${Math.round(-w.trend * 100)}% vs el mes anterior` : ''}. Evalúa cerrar ese día o abrir medio turno.`,
  };
}

module.exports = {
  WD,
  WD_PLURAL,
  analyzeHistory,
  productsForDow,
  getAnalysis,
  buildAreaPrepPlan,
  forecastAnswer,
  closedDaysAnswer,
  weekdayAdviceAnswer,
  adminDailyNotice,
  weeklyClosingNotice,
};
