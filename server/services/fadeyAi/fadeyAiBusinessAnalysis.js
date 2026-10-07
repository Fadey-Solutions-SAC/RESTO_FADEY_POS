/**
 * Análisis locales de la IA Fadey: clientes del período y costos/márgenes de la carta.
 */
const { queryAll, queryOne } = require('../../database');
const { getPaidSalesEventSql, metricsFromPaidOrdersWhere } = require('../../utils/salesAccountGrouping');
const { getBusinessTodayDateKey, shiftBusinessDateKey } = require('../../utils/appDateTime');
const { resolveKardexInsumoLines } = require('../../utils/productKardexInsumos');
const { insumoNeedForLine } = require('../../utils/salesCogs');
const { resolveNaturalPeriod, displayDateKey } = require('./fadeyAiDateParse');

const PAID_WHERE = `o.status != 'cancelled'
  AND o.payment_status = 'paid'
  AND IFNULL(o.payment_method, '') NOT IN ('cortesia', 'cuenta_cliente')`;

const WEEKDAY_LABELS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const CHANNEL_LABELS = { dine_in: 'Salón', delivery: 'Delivery', pickup: 'Para llevar' };
const GENERIC_CUSTOMER = /^(cliente|clientes|varios|publico( general)?|público( general)?|consumidor final|general|sin nombre|mesa\s*\d*|-|\.|n\/a|na)$/i;

const money = (n) => `S/ ${Number(n || 0).toFixed(2)}`;
const pct = (n) => `${Number(n || 0).toFixed(1)}%`;

function daysBetween(from, to) {
  const a = new Date(`${from}T12:00:00Z`);
  const b = new Date(`${to}T12:00:00Z`);
  return Math.round((b - a) / 86400000) + 1;
}

function periodRangeText(p) {
  return p.from === p.to ? displayDateKey(p.from) : `${displayDateKey(p.from)} → ${displayDateKey(p.to)}`;
}

/** "este mes (01/09/2026 → 29/09/2026)" sin paréntesis duplicados. */
function periodHeading(p) {
  const base = String(p.label || '').replace(/\s*\(.*\)\s*$/, '').trim();
  const rangeText = periodRangeText(p);
  if (!base || base.includes(displayDateKey(p.from))) return rangeText;
  return `${base}: ${rangeText}`;
}

function resolvePeriod(args, defaultScope) {
  const today = getBusinessTodayDateKey(queryOne);
  if (args.from) {
    const to = args.to || args.from;
    return { from: args.from, to, label: args.label || '', explicit: true };
  }
  return resolveNaturalPeriod(args.message || '', today, { defaultScope });
}

function safeAll(sql, params) {
  try {
    return queryAll(sql, params) || [];
  } catch (_) {
    return [];
  }
}

function tableExists(name) {
  try {
    return Boolean(queryOne(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`, [name]));
  } catch (_) {
    return false;
  }
}

/* ─────────────────────────── Clientes ─────────────────────────── */

function customerKey(row) {
  const doc = String(row.doc_number || '').trim();
  if (doc && doc !== '00000000' && !/^0+$/.test(doc)) return { key: `doc:${doc}`, name: String(row.doc_name || row.customer_name || doc).trim() };
  if (row.customer_id) return { key: `id:${row.customer_id}`, name: String(row.customer_name || 'Cliente registrado').trim() };
  const name = String(row.customer_name || '').trim();
  if (!name || GENERIC_CUSTOMER.test(name)) return null;
  return { key: `name:${name.toLowerCase()}`, name };
}

function loadPaidOrderRows(ps, from, to) {
  const hasEdocs = tableExists('electronic_documents');
  return safeAll(
    `SELECT o.id, o.total, o.type, o.customer_id, o.customer_name,
            ${ps.ORDER_DATE} AS day,
            CAST(strftime('%H', ${ps.ORDER_LOCAL}) AS INTEGER) AS hour,
            CAST(strftime('%w', ${ps.ORDER_LOCAL}) AS INTEGER) AS dow
            ${hasEdocs ? ', ed.customer_doc_number AS doc_number, ed.customer_name AS doc_name' : ''}
     FROM orders o
     ${hasEdocs ? 'LEFT JOIN electronic_documents ed ON ed.order_id = o.id' : ''}
     WHERE ${PAID_WHERE}
       AND ${ps.ORDER_DATE} >= date(?) AND ${ps.ORDER_DATE} <= date(?)`,
    [from, to],
  );
}

function customerStats(rows) {
  const map = new Map();
  for (const r of rows) {
    const c = customerKey(r);
    if (!c) continue;
    const cur = map.get(c.key) || { key: c.key, name: c.name, spend: 0, orders: 0, days: new Set() };
    cur.spend += Number(r.total || 0);
    cur.orders += 1;
    cur.days.add(r.day);
    map.set(c.key, cur);
  }
  return [...map.values()].map((c) => ({ ...c, visits: c.days.size }));
}

function surveyStats(from, to) {
  if (!tableExists('loyalty_surveys')) return null;
  const rows = safeAll(
    `SELECT rating, party_size, improve_json, liked_json
     FROM loyalty_surveys
     WHERE date(COALESCE(NULLIF(visit_date, ''), created_at)) >= date(?)
       AND date(COALESCE(NULLIF(visit_date, ''), created_at)) <= date(?)`,
    [from, to],
  );
  if (!rows.length) return null;
  const count = (field) => {
    const tally = new Map();
    for (const r of rows) {
      let list = [];
      try { list = JSON.parse(r[field] || '[]'); } catch (_) { list = []; }
      for (const item of Array.isArray(list) ? list : []) {
        const k = String(item || '').trim();
        if (k) tally.set(k, (tally.get(k) || 0) + 1);
      }
    }
    return [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  };
  const parties = rows.map((r) => Number(r.party_size || 0)).filter((n) => n > 0);
  return {
    count: rows.length,
    avg_rating: rows.reduce((s, r) => s + Number(r.rating || 0), 0) / rows.length,
    avg_party: parties.length ? parties.reduce((s, n) => s + n, 0) / parties.length : null,
    improve: count('improve_json'),
    liked: count('liked_json'),
  };
}

function parseSurveyJson(raw, fallback) {
  try {
    const value = JSON.parse(raw || '');
    return value ?? fallback;
  } catch (_) {
    return fallback;
  }
}

/** Resumen de encuestas de un rango. null si la tabla no existe. count 0 si no hay respuestas. */
function summarizeSurveys(from, to) {
  if (!tableExists('loyalty_surveys')) return null;
  const { readLoyaltySurveyForm, attentionQuestionId, attentionScore } = require('../../loyaltySurveyQuestions');
  const form = readLoyaltySurveyForm();
  const attentionId = attentionQuestionId(form);
  const ranged = Boolean(from && to);
  const rows = safeAll(
    `SELECT rating, answers_json, waiter_user_id, waiter_name, liked_json, improve_json, liked_other, improve_other
     FROM loyalty_surveys
     ${ranged ? `WHERE date(COALESCE(NULLIF(visit_date, ''), created_at)) >= date(?)
       AND date(COALESCE(NULLIF(visit_date, ''), created_at)) <= date(?)` : ''}
     ORDER BY datetime(created_at) DESC
     LIMIT 500`,
    ranged ? [from, to] : [],
  );
  const questionLabel = new Map((form.questions || []).map((q) => [q.id, q.label]));
  const likedLabel = new Map((form.liked_options || []).map((o) => [o.id, o.label]));
  const improveLabel = new Map((form.improve_options || []).map((o) => [o.id, o.label]));
  const qSum = new Map();
  const qCount = new Map();
  const improve = new Map();
  const liked = new Map();
  const waiters = new Map();

  for (const row of rows) {
    const parsedAnswers = parseSurveyJson(row.answers_json, {});
    const answers = parsedAnswers && typeof parsedAnswers === 'object' && !Array.isArray(parsedAnswers) ? parsedAnswers : {};
    const improveList = parseSurveyJson(row.improve_json, []);
    const likedList = parseSurveyJson(row.liked_json, []);
    for (const [id, raw] of Object.entries(answers || {})) {
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 1 || value > 5) continue;
      qSum.set(id, (qSum.get(id) || 0) + value);
      qCount.set(id, (qCount.get(id) || 0) + 1);
    }
    for (const id of (Array.isArray(improveList) ? improveList : [])) {
      const key = String(id || '').trim();
      if (key) improve.set(key, (improve.get(key) || 0) + 1);
    }
    const improveOther = String(row.improve_other || '').trim();
    if (improveOther) improve.set(improveOther, (improve.get(improveOther) || 0) + 1);
    for (const id of (Array.isArray(likedList) ? likedList : [])) {
      const key = String(id || '').trim();
      if (key) liked.set(key, (liked.get(key) || 0) + 1);
    }
    const waiterId = String(row.waiter_user_id || '').trim();
    const rating = attentionScore(answers, attentionId);
    if (waiterId && rating != null) {
      const name = String(row.waiter_name || '').trim() || 'Personal';
      const cur = waiters.get(waiterId) || { name, count: 0, sum: 0 };
      cur.count += 1;
      cur.sum += rating;
      if (name && name !== 'Personal') cur.name = name;
      waiters.set(waiterId, cur);
    }
  }

  const aspects = [...qCount.entries()]
    .map(([id, count]) => ({
      label: questionLabel.get(id) || id,
      average: qSum.get(id) / count,
      count,
    }))
    .sort((a, b) => a.average - b.average || b.count - a.count);
  const improveRank = [...improve.entries()]
    .map(([id, count]) => ({ label: improveLabel.get(id) || id, count }))
    .sort((a, b) => b.count - a.count);
  const likedRank = [...liked.entries()]
    .map(([id, count]) => ({ label: likedLabel.get(id) || id, count }))
    .sort((a, b) => b.count - a.count);
  const staff = [...waiters.values()]
    .map((w) => ({ ...w, average: w.sum / w.count }))
    .sort((a, b) => b.average - a.average || b.count - a.count);
  const overall = rows.length
    ? rows.reduce((s, r) => s + Number(r.rating || 0), 0) / rows.length
    : 0;

  return {
    count: rows.length,
    overall,
    aspects,
    improveRank,
    likedRank,
    staff,
  };
}

function formatSurveySummary(summary, heading) {
  const lines = [heading || `**Encuestas de clientes** (${summary.count} respuesta${summary.count === 1 ? '' : 's'})`];
  lines.push(`Calificación general: ${summary.overall.toFixed(1)}/5.`);
  lines.push('', '**Aspectos a mejorar**');
  if (summary.aspects.length) {
    const weak = summary.aspects.filter((a) => a.average < 4);
    const focus = (weak.length ? weak : summary.aspects).slice(0, 3);
    focus.forEach((a, i) => {
      lines.push(`${i + 1}. ${a.label}: ${a.average.toFixed(1)}/5 (${a.count} respuesta${a.count === 1 ? '' : 's'})`);
    });
    const best = summary.aspects[summary.aspects.length - 1];
    if (best && summary.aspects.length > 1) {
      lines.push(`Lo mejor calificado: ${best.label} (${best.average.toFixed(1)}/5).`);
    }
  } else {
    lines.push('Las respuestas no traen calificación por aspecto.');
  }
  if (summary.improveRank.length) {
    lines.push(`Lo que más piden mejorar: ${summary.improveRank.slice(0, 3).map((x) => `${x.label} (${x.count})`).join(', ')}.`);
  }
  if (summary.likedRank.length) {
    lines.push(`Lo que más les gusta: ${summary.likedRank.slice(0, 3).map((x) => `${x.label} (${x.count})`).join(', ')}.`);
  }
  lines.push('', '**Personal mejor calificado**');
  if (summary.staff.length) {
    const top = summary.staff[0];
    lines.push(`Top: ${top.name} con ${top.average.toFixed(1)}/5 en ${top.count} encuesta${top.count === 1 ? '' : 's'}.`);
    summary.staff.slice(0, 5).forEach((w, i) => {
      lines.push(`${i + 1}. ${w.name}: ${w.average.toFixed(1)}/5 · ${w.count} encuesta${w.count === 1 ? '' : 's'}`);
    });
  } else {
    lines.push('Ninguna encuesta tiene personal marcado, así que no hay un top todavía.');
  }
  return lines.join('\n');
}

/** Lee las respuestas reales de Fidelización. Con from/to limita al período pedido. */
function toolSurveyInsights(from, to) {
  const summary = summarizeSurveys(from, to);
  if (!summary) {
    return { ok: true, text: 'Aún no hay encuestas guardadas en Fidelización.' };
  }
  if (!summary.count) {
    const range = from && to ? ` del ${from} al ${to}` : '';
    return {
      ok: true,
      text: `El módulo de encuestas está activo, pero no hay respuestas${range}. Cuando los clientes completen el QR, aquí verás qué aspectos mejorar y qué personal sale mejor calificado.`,
    };
  }
  const heading = from && to
    ? `**Encuestas de clientes** (${summary.count} respuesta${summary.count === 1 ? '' : 's'}, ${from} al ${to})`
    : `**Encuestas de clientes** (${summary.count} respuesta${summary.count === 1 ? '' : 's'})`;
  return { ok: true, text: formatSurveySummary(summary, heading) };
}

function toolCustomerInsights(args = {}) {
  const period = resolvePeriod(args, 'month');
  const ps = getPaidSalesEventSql();
  const { previousComparablePeriod } = require('./fadeyAiDateParse');
  const prevPeriod = previousComparablePeriod(period);
  const prevTo = prevPeriod.to;
  const prevFrom = prevPeriod.from;

  const where = `${ps.ORDER_DATE} >= date(?) AND ${ps.ORDER_DATE} <= date(?)`;
  const cur = metricsFromPaidOrdersWhere(where, [period.from, period.to]);
  const prev = metricsFromPaidOrdersWhere(where, [prevFrom, prevTo]);
  const rows = loadPaidOrderRows(ps, period.from, period.to);
  const title = `**Análisis de clientes** (${periodHeading(period)})`;

  if (!cur.orders) {
    return {
      ok: true,
      text: `${title}\nNo hay cuentas cobradas en este período. Prueba con otro rango, por ejemplo «clientes del mes pasado» o «clientes del 01/09 al 15/09».`,
    };
  }

  const avgTicket = cur.sales / cur.orders;
  const prevTicket = prev.orders ? prev.sales / prev.orders : null;
  const accountsDelta = prev.orders ? ((cur.orders - prev.orders) / prev.orders) * 100 : null;

  const customers = customerStats(rows);
  const identifiedOrders = customers.reduce((s, c) => s + c.orders, 0);
  const identifiedShare = rows.length ? (identifiedOrders / rows.length) * 100 : 0;
  const repeat = customers.filter((c) => c.visits >= 2);
  const topSpend = [...customers].sort((a, b) => b.spend - a.spend).slice(0, 5);

  let newCount = 0;
  if (customers.length) {
    const prevRows = loadPaidOrderRows(ps, '2000-01-01', shiftBusinessDateKey(period.from, -1));
    const seen = new Set(prevRows.map((r) => customerKey(r)?.key).filter(Boolean));
    newCount = customers.filter((c) => !seen.has(c.key)).length;
  }

  const byChannel = new Map();
  const byDow = new Map();
  const byHour = new Map();
  for (const r of rows) {
    const ch = CHANNEL_LABELS[r.type] || 'Otros';
    byChannel.set(ch, (byChannel.get(ch) || 0) + Number(r.total || 0));
    if (Number.isFinite(r.dow)) byDow.set(r.dow, (byDow.get(r.dow) || 0) + 1);
    if (Number.isFinite(r.hour)) byHour.set(r.hour, (byHour.get(r.hour) || 0) + 1);
  }
  const dowSorted = [...byDow.entries()].sort((a, b) => b[1] - a[1]);
  const hourSorted = [...byHour.entries()].sort((a, b) => b[1] - a[1]);
  const surveysRaw = surveyStats(period.from, period.to);
  const { isPlanModuleEnabled } = require('./fadeyAiAccess');
  const surveys = surveysRaw && isPlanModuleEnabled('fidelizacion') ? surveysRaw : null;

  const lines = [title];
  lines.push(`Cuentas atendidas: ${cur.orders}${accountsDelta != null ? ` (${accountsDelta >= 0 ? '+' : ''}${accountsDelta.toFixed(1)}% vs ${prevPeriod.label})` : ''}.`);
  lines.push(`Ticket promedio: ${money(avgTicket)}${prevTicket != null ? ` (antes ${money(prevTicket)})` : ''}. Total cobrado: ${money(cur.sales)}.`);
  if (byChannel.size > 1 || (byChannel.size === 1 && !byChannel.has('Salón'))) {
    const parts = [...byChannel.entries()].sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${pct((v / cur.sales) * 100)}`);
    lines.push(`Canales: ${parts.join(' · ')}.`);
  }
  if (dowSorted.length) {
    const best = dowSorted[0];
    const worst = dowSorted[dowSorted.length - 1];
    lines.push(`Día con más clientes: ${WEEKDAY_LABELS[best[0]]} (${best[1]} cuenta(s))${dowSorted.length > 1 ? ` · más flojo: ${WEEKDAY_LABELS[worst[0]]} (${worst[1]})` : ''}.`);
  }
  if (hourSorted.length) {
    const h = hourSorted[0][0];
    lines.push(`Hora pico: ${String(h).padStart(2, '0')}:00–${String((h + 1) % 24).padStart(2, '0')}:00.`);
  }

  lines.push('', '**Clientes identificados**');
  if (customers.length) {
    lines.push(`${customers.length} cliente(s) con nombre o documento (${pct(identifiedShare)} de las cuentas) · nuevos: ${newCount} · recurrentes: ${repeat.length}.`);
    topSpend.forEach((c, i) => {
      lines.push(`${i + 1}. ${c.name}: ${money(c.spend)} · ${c.visits} visita(s)`);
    });
  } else {
    lines.push('Ninguna cuenta tiene nombre de cliente o documento (boleta/factura), así que no se puede medir recurrencia.');
  }

  if (surveys) {
    lines.push('', '**Opinión de clientes (encuestas)**');
    lines.push(`${surveys.count} encuesta(s) · calificación promedio ${surveys.avg_rating.toFixed(1)}/5${surveys.avg_party ? ` · grupo promedio ${surveys.avg_party.toFixed(1)} persona(s)` : ''}.`);
    if (surveys.liked.length) lines.push(`Lo que más gusta: ${surveys.liked.map(([k, n]) => `${k} (${n})`).join(', ')}.`);
    if (surveys.improve.length) lines.push(`Lo que piden mejorar: ${surveys.improve.map(([k, n]) => `${k} (${n})`).join(', ')}.`);
  }

  const tips = [];
  if (identifiedShare < 30) tips.push('Pide nombre o DNI al cobrar (o emite boleta con documento): con menos del 30 % de clientes identificados no se puede fidelizar ni medir recurrencia.');
  if (customers.length >= 5 && repeat.length / customers.length < 0.2) tips.push('Menos del 20 % de clientes vuelve: prueba una tarjeta de puntos, un descuento en la segunda visita o un mensaje de agradecimiento por WhatsApp.');
  if (topSpend.length && repeat.length) tips.push(`Premia a tus mejores clientes (${topSpend.slice(0, 2).map((c) => c.name).join(', ')}) con un detalle o cortesía: retener cuesta menos que captar.`);
  if (prevTicket != null && avgTicket < prevTicket * 0.95) tips.push('El ticket promedio bajó: sugiere entradas, postres o bebidas al tomar el pedido y arma combos con margen.');
  if (dowSorted.length > 2) tips.push(`Refuerza promociones el ${WEEKDAY_LABELS[dowSorted[dowSorted.length - 1][0]]}, que es el día más flojo, y asegura personal completo el ${WEEKDAY_LABELS[dowSorted[0][0]]}.`);
  if (accountsDelta != null && accountsDelta < -10) tips.push('Vienen menos clientes que en el período anterior: revisa reseñas, tiempos de atención y visibilidad en redes.');
  if (surveys && surveys.avg_rating < 4) tips.push('La calificación promedio está por debajo de 4/5: atiende primero lo que más piden mejorar en las encuestas.');
  if (tips.length) {
    lines.push('', '**Recomendaciones**');
    tips.slice(0, 5).forEach((t, i) => lines.push(`${i + 1}. ${t}`));
  }

  return {
    ok: true,
    text: lines.join('\n'),
    from: period.from,
    to: period.to,
    accounts: cur.orders,
    identified: customers.length,
  };
}

/* ─────────────────────────── Costos ─────────────────────────── */

function recipeLinesForProduct(product, insumoById) {
  const lines = resolveKardexInsumoLines(product).map((l) => ({ insumo_id: l.insumo_id, qty: l.qty, modo: l.modo, fromRecipe: false }));
  if (lines.length) return lines;
  const rec = queryOne(`SELECT id FROM recetas WHERE product_id = ? AND IFNULL(activo, 1) = 1 LIMIT 1`, [product.id]);
  if (!rec?.id) return [];
  return safeAll('SELECT insumo_id, cantidad_usada FROM receta_detalle WHERE receta_id = ?', [rec.id])
    .filter((d) => insumoById.has(d.insumo_id))
    .map((d) => ({ insumo_id: d.insumo_id, qty: Number(d.cantidad_usada || 0), fromRecipe: true }));
}

function unitCostBreakdown(product, insumoById) {
  const lines = recipeLinesForProduct(product, insumoById);
  if (lines.length) {
    const parts = [];
    let total = 0;
    let missingCost = 0;
    for (const line of lines) {
      const ins = insumoById.get(line.insumo_id);
      if (!ins) continue;
      const need = line.fromRecipe ? line.qty : insumoNeedForLine(ins, line, 1);
      const unit = Number(ins.costo_promedio || 0);
      if (!(unit > 0)) missingCost += 1;
      const cost = need * unit;
      total += cost;
      parts.push({ insumo_id: ins.id, name: ins.nombre, cost });
    }
    return { source: 'insumos', cost: total, parts, missingCost };
  }
  const pp = Number(product.purchase_price || 0);
  if (pp > 0) return { source: 'compra', cost: pp, parts: [], missingCost: 0 };
  return { source: 'none', cost: 0, parts: [], missingCost: 0 };
}

function insumoPriceTrends(insumoById) {
  const rows = safeAll(
    `SELECT id_insumo,
            AVG(CASE WHEN date(fecha) >= date('now', '-30 days') THEN costo_unitario END) AS recent,
            AVG(CASE WHEN date(fecha) < date('now', '-30 days') AND date(fecha) >= date('now', '-120 days') THEN costo_unitario END) AS before
     FROM kardex
     WHERE tipo_movimiento = 'entrada' AND costo_unitario > 0
     GROUP BY id_insumo`,
  );
  return rows
    .filter((r) => Number(r.recent) > 0 && Number(r.before) > 0)
    .map((r) => ({
      name: insumoById.get(r.id_insumo)?.nombre || r.id_insumo,
      change: ((Number(r.recent) - Number(r.before)) / Number(r.before)) * 100,
    }))
    .filter((r) => Math.abs(r.change) >= 8)
    .sort((a, b) => b.change - a.change);
}

function toolCostInsights(args = {}) {
  const today = getBusinessTodayDateKey(queryOne);
  const period = args.from
    ? resolvePeriod(args, 'month')
    : (() => {
      const p = resolveNaturalPeriod(args.message || '', today, { defaultScope: 'month' });
      if (p.explicit) return p;
      const from = shiftBusinessDateKey(today, -29);
      return { from, to: today, label: 'últimos 30 días', explicit: false };
    })();
  const ps = getPaidSalesEventSql();

  const insumos = safeAll('SELECT id, nombre, unidad_medida, costo_promedio FROM insumos WHERE IFNULL(activo, 1) = 1');
  const insumoById = new Map(insumos.map((i) => [i.id, i]));
  const products = safeAll(
    `SELECT * FROM products
     WHERE IFNULL(is_active, 1) = 1 AND IFNULL(price, 0) > 0`,
  );
  if (!products.length) {
    return { ok: true, text: '**Costos y márgenes**\nNo hay productos activos con precio para analizar.' };
  }

  const soldRows = safeAll(
    `SELECT oi.product_id, SUM(oi.quantity) AS qty, SUM(oi.subtotal) AS revenue
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE ${PAID_WHERE}
       AND ${ps.ORDER_DATE} >= date(?) AND ${ps.ORDER_DATE} <= date(?)
       AND IFNULL(oi.product_id, '') != ''
     GROUP BY oi.product_id`,
    [period.from, period.to],
  );
  const soldById = new Map(soldRows.map((r) => [r.product_id, { qty: Number(r.qty || 0), revenue: Number(r.revenue || 0) }]));

  const analyzed = [];
  const noCost = [];
  const insumoSpend = new Map();
  for (const p of products) {
    const bd = unitCostBreakdown(p, insumoById);
    const sold = soldById.get(p.id) || { qty: 0, revenue: 0 };
    if (bd.source === 'none' || !(bd.cost > 0)) {
      noCost.push({ name: p.name, qty: sold.qty, transformed: p.process_type !== 'non_transformed' });
      continue;
    }
    const price = Number(p.price || 0);
    const margin = price - bd.cost;
    const costPct = (bd.cost / price) * 100;
    analyzed.push({
      name: p.name,
      price,
      cost: bd.cost,
      margin,
      costPct,
      source: bd.source,
      qty: sold.qty,
      profit: margin * sold.qty,
      parts: bd.parts,
      missingCost: bd.missingCost,
    });
    for (const part of bd.parts) {
      const cur = insumoSpend.get(part.name) || 0;
      insumoSpend.set(part.name, cur + part.cost * sold.qty);
    }
  }

  const lines = [`**Costos de producción y márgenes** (ventas ${periodHeading(period)})`];

  if (!analyzed.length) {
    lines.push(`Ningún producto tiene costo cargado (${noCost.length} sin receta/insumos ni precio de compra).`);
    lines.push('Para que pueda sugerir mejoras: en Productos vincula los insumos de cada plato (con su cantidad) y registra el precio de compra de bebidas y envasados; en Almacén registra las compras de insumos para calcular su costo promedio.');
    return { ok: true, text: lines.join('\n') };
  }

  const soldAnalyzed = analyzed.filter((a) => a.qty > 0);
  const revenue = soldAnalyzed.reduce((s, a) => s + a.price * a.qty, 0);
  const cogs = soldAnalyzed.reduce((s, a) => s + a.cost * a.qty, 0);
  const transformedSold = soldAnalyzed.filter((a) => a.source === 'insumos');
  const foodRevenue = transformedSold.reduce((s, a) => s + a.price * a.qty, 0);
  const foodCost = transformedSold.reduce((s, a) => s + a.cost * a.qty, 0);

  if (revenue > 0) {
    lines.push(`Costo de lo vendido: ${money(cogs)} de ${money(revenue)} en ventas (${pct((cogs / revenue) * 100)}). Margen bruto: ${money(revenue - cogs)}.`);
  }
  if (foodRevenue > 0) {
    const fc = (foodCost / foodRevenue) * 100;
    lines.push(`Food cost de platos preparados: ${pct(fc)} ${fc > 35 ? '(alto; lo sano en restaurantes es 28–35 %)' : fc < 22 ? '(muy bajo; revisa que las recetas tengan todos los insumos)' : '(dentro del rango sano 28–35 %)'}.`);
  }

  const highCost = analyzed
    .filter((a) => (a.source === 'insumos' ? a.costPct > 38 : a.costPct > 75))
    .sort((a, b) => (b.qty * b.cost) - (a.qty * a.cost))
    .slice(0, 5);
  if (highCost.length) {
    lines.push('', '**Productos con margen bajo** (costo / precio)');
    highCost.forEach((a, i) => {
      const target = a.source === 'insumos' ? 0.32 : 0.6;
      const suggested = Math.ceil((a.cost / target) * 2) / 2;
      const topPart = [...a.parts].sort((x, y) => y.cost - x.cost)[0];
      lines.push(`${i + 1}. ${a.name}: costo ${money(a.cost)} de ${money(a.price)} (${pct(a.costPct)})${a.qty ? ` · ${a.qty} vendidos` : ''}. Precio sugerido ≈ ${money(suggested)}${topPart ? `; insumo más caro: ${topPart.name} (${money(topPart.cost)})` : ''}.`);
    });
  }

  const best = [...soldAnalyzed].sort((a, b) => b.profit - a.profit).slice(0, 5);
  if (best.length) {
    lines.push('', '**Los que más ganancia dejan**');
    best.forEach((a, i) => lines.push(`${i + 1}. ${a.name}: ${money(a.margin)} por unidad × ${a.qty} = ${money(a.profit)} (costo ${pct(a.costPct)})`));
  }

  // Ingeniería de menú: popularidad vs margen por unidad.
  if (soldAnalyzed.length >= 4) {
    const totalQty = soldAnalyzed.reduce((s, a) => s + a.qty, 0);
    const popLimit = (totalQty / soldAnalyzed.length) * 0.7;
    const avgMargin = soldAnalyzed.reduce((s, a) => s + a.margin * a.qty, 0) / totalQty;
    const groups = { estrella: [], caballo: [], enigma: [], perro: [] };
    for (const a of soldAnalyzed) {
      const popular = a.qty >= popLimit;
      const profitable = a.margin >= avgMargin;
      groups[popular && profitable ? 'estrella' : popular ? 'caballo' : profitable ? 'enigma' : 'perro'].push(a.name);
    }
    lines.push('', '**Ingeniería de menú**');
    if (groups.estrella.length) lines.push(`Estrellas (se venden y dejan margen, cuídalos): ${groups.estrella.slice(0, 5).join(', ')}.`);
    if (groups.caballo.length) lines.push(`Populares con poco margen (sube precio poco a poco o ajusta porción/insumos): ${groups.caballo.slice(0, 5).join(', ')}.`);
    if (groups.enigma.length) lines.push(`Buen margen pero se venden poco (destácalos en la carta o que el mozo los recomiende): ${groups.enigma.slice(0, 5).join(', ')}.`);
    if (groups.perro.length) lines.push(`Poco vendidos y poco margen (antes de retirarlos revisa si cumplen otro rol: complemento, opción para un público o insumo compartido; prueba rediseño, porción o precio): ${groups.perro.slice(0, 5).join(', ')}.`);
  }

  const spendSorted = [...insumoSpend.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const trends = insumoPriceTrends(insumoById);
  if (spendSorted.length || trends.length) {
    lines.push('', '**Insumos**');
    if (spendSorted.length) {
      const totalSpend = spendSorted.reduce((s, [, v]) => s + v, 0);
      lines.push(`Donde se va el costo: ${spendSorted.slice(0, 5).map(([k, v]) => `${k} ${pct((v / totalSpend) * 100)}`).join(' · ')}. Negociar precio o buscar proveedor para estos insumos es lo que más impacto tiene.`);
    }
    const up = trends.filter((t) => t.change > 0).slice(0, 4);
    const down = trends.filter((t) => t.change < 0).slice(0, 3);
    if (up.length) lines.push(`Subieron de precio (últimos 30 días vs antes): ${up.map((t) => `${t.name} +${t.change.toFixed(0)}%`).join(', ')}. Revisa el precio de los platos que los usan.`);
    if (down.length) lines.push(`Bajaron de precio: ${down.map((t) => `${t.name} ${t.change.toFixed(0)}%`).join(', ')}. Buen momento para comprar o mejorar la porción.`);
  }

  const tips = [];
  const withMissing = analyzed.filter((a) => a.missingCost > 0);
  if (withMissing.length) tips.push(`${withMissing.length} producto(s) usan insumos sin costo promedio (${withMissing.slice(0, 3).map((a) => a.name).join(', ')}): registra la compra de esos insumos para que el costo sea real.`);
  const noCostSold = noCost.filter((n) => n.qty > 0).sort((a, b) => b.qty - a.qty);
  if (noCost.length) tips.push(`${noCost.length} producto(s) no tienen costo${noCostSold.length ? `, entre ellos algunos que sí se venden (${noCostSold.slice(0, 3).map((n) => n.name).join(', ')})` : ''}: vincula su receta o precio de compra.`);
  const tooCheap = analyzed.filter((a) => a.source === 'insumos' && a.costPct < 15 && a.qty > 0).slice(0, 3);
  if (tooCheap.length) tips.push(`Platos con costo muy bajo (${tooCheap.map((a) => a.name).join(', ')}): verifica la receta; si está completa, puedes mejorar la calidad del insumo o la presentación sin perder margen.`);
  if (highCost.length) tips.push('Para bajar costos sin perder calidad: estandariza porciones con balanza y fichas técnicas, aprovecha mermas en guarniciones o salsas y compra por volumen los insumos de mayor rotación.');
  tips.push('Para mejorar la calidad: mantén insumos frescos rotando stock (primero en entrar, primero en salir) y revisa las encuestas de clientes sobre sabor y presentación.');
  lines.push('', '**Recomendaciones**');
  tips.slice(0, 5).forEach((t, i) => lines.push(`${i + 1}. ${t}`));

  return {
    ok: true,
    text: lines.join('\n'),
    analyzed: analyzed.length,
    without_cost: noCost.length,
  };
}

module.exports = {
  toolCustomerInsights,
  toolCostInsights,
  toolSurveyInsights,
  summarizeSurveys,
  PAID_WHERE,
  CHANNEL_LABELS,
  WEEKDAY_LABELS,
  daysBetween,
  periodHeading,
  safeAll,
  customerKey,
  customerStats,
  loadPaidOrderRows,
  unitCostBreakdown,
  insumoPriceTrends,
};
