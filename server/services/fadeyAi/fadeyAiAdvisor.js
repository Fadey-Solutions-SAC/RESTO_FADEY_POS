/**
 * IA Fadey — asesor de negocio: «¿cómo vendo más?», «¿cómo mejoro mis ganancias?».
 * Cruza ventas, márgenes (precio de venta vs costo de insumos / precio de compra), días y horas,
 * combos, canales, clientes, anulaciones y precios de insumos para armar un plan adaptado al local.
 */
const { queryOne } = require('../../database');
const { getPaidSalesEventSql } = require('../../utils/salesAccountGrouping');
const { getBusinessTodayDateKey, shiftBusinessDateKey, sqlBusinessTimestamp } = require('../../utils/appDateTime');
const { resolveNaturalPeriod, normalizeSpanish, displayDateKey, previousComparablePeriod } = require('./fadeyAiDateParse');
const { canUseTool, deniedToolMessage } = require('./fadeyAiAccess');
const {
  PAID_WHERE,
  safeAll,
  daysBetween,
  periodHeading,
  customerStats,
  loadPaidOrderRows,
  unitCostBreakdown,
  insumoPriceTrends,
} = require('./fadeyAiBusinessAnalysis');

const ADVICE_RE = new RegExp([
  '\\bvender mas\\b', '\\bganar mas\\b', '\\bmas (ganancias?|utilidad(es)?|clientes|ventas)\\b',
  '\\b(mejorar|mejoro|mejoramos|aumentar|aumento|aumentamos|subir|subo|incrementar|incremento|maximizar|potenciar|impulsar|crecer)\\b.{0,25}\\b(ventas?|ganancias?|utilidad(es)?|rentabilidad|margen|margenes|negocio|ingresos|ticket|restaurante|local)\\b',
  '\\b(consejos?|ideas?|estrategias?|recomendaciones?|plan)\\b.{0,20}\\b(vender|ventas|ganancias?|negocio|crecer)\\b',
  '\\bque (hago|puedo hacer|debo hacer|me recomiendas)\\b.{0,20}\\b(vender|ventas|ganar|ganancias?|negocio|crecer)\\b',
  '\\bpor que (bajaron|bajan|caen|cayeron) (mis |las )?ventas\\b',
].join('|'));

const WEEKDAYS = {
  es: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
};

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const money = (n) => `S/ ${Number(n || 0).toFixed(2)}`;
const pct = (n) => `${Number(n || 0).toFixed(1)}%`;
const hourLabel = (h) => `${String(h).padStart(2, '0')}:00`;

function isAdviceQuestion(message) {
  const m = normalizeSpanish(String(message || '')).replace(/^[¿?¡!\s]+/, '');
  return ADVICE_RE.test(m);
}

function detectFocus(m) {
  const profit = /ganancia|ganar|utilidad|rentab|margen|costo|precio/.test(m);
  const sales = /vender|ventas?|clientes|crecer|ticket|ingresos/.test(m);
  if (profit && !sales) return 'profit';
  if (sales && !profit) return 'sales';
  return 'general';
}

function restaurantName() {
  try {
    return String(queryOne('SELECT name FROM restaurants LIMIT 1')?.name || '').trim();
  } catch (_) {
    return '';
  }
}

function resolveAdvicePeriod(message) {
  const today = getBusinessTodayDateKey(queryOne);
  const p = resolveNaturalPeriod(message, today, { defaultScope: 'month' });
  if (p.explicit && daysBetween(p.from, p.to) >= 7) return p;
  return { from: shiftBusinessDateKey(today, -29), to: today, label: 'últimos 30 días', explicit: false };
}

function weekdayCounts(from, to) {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  const d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (d <= end) {
    counts[d.getUTCDay()] += 1;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return counts;
}

function analyze(period) {
  const ps = getPaidSalesEventSql();
  const days = daysBetween(period.from, period.to);
  const prevPeriod = previousComparablePeriod(period);
  const prevFrom = prevPeriod.from;
  const prevTo = prevPeriod.to;

  const orders = loadPaidOrderRows(ps, period.from, period.to);
  const revenue = orders.reduce((s, o) => s + Number(o.total || 0), 0);
  const prev = queryOne(
    `SELECT COUNT(*) AS cnt, IFNULL(SUM(o.total), 0) AS total FROM orders o
     WHERE ${PAID_WHERE} AND ${ps.ORDER_DATE} >= date(?) AND ${ps.ORDER_DATE} <= date(?)`,
    [prevFrom, prevTo],
  ) || { cnt: 0, total: 0 };
  const ticket = orders.length ? revenue / orders.length : 0;
  const prevTicket = Number(prev.cnt) ? Number(prev.total) / Number(prev.cnt) : 0;

  // Días de la semana (promedio por día, no total).
  const wdCount = weekdayCounts(period.from, period.to);
  const wdRevenue = [0, 0, 0, 0, 0, 0, 0];
  const hourRevenue = new Map();
  const channel = new Map();
  for (const o of orders) {
    const total = Number(o.total || 0);
    if (Number.isInteger(o.dow)) wdRevenue[o.dow] += total;
    if (Number.isInteger(o.hour)) hourRevenue.set(o.hour, (hourRevenue.get(o.hour) || 0) + total);
    const ch = o.type || 'dine_in';
    channel.set(ch, (channel.get(ch) || 0) + total);
  }
  const weekdays = wdRevenue.map((v, i) => ({ dow: i, avg: wdCount[i] ? v / wdCount[i] : 0, count: wdCount[i] }))
    .filter((w) => w.count > 0);
  const openDays = weekdays.filter((w) => w.avg > 0).sort((x, y) => y.avg - x.avg || x.dow - y.dow);
  const hours = [...hourRevenue.entries()].map(([h, v]) => ({ hour: h, total: v })).sort((a, b) => a.hour - b.hour);

  // Productos: ventas, costo y margen.
  const items = safeAll(
    `SELECT oi.order_id, oi.product_id, oi.product_name, oi.quantity, oi.subtotal
     FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE ${PAID_WHERE} AND ${ps.ORDER_DATE} >= date(?) AND ${ps.ORDER_DATE} <= date(?)
     LIMIT 60000`,
    [period.from, period.to],
  );
  const insumos = safeAll('SELECT id, nombre, unidad_medida, costo_promedio FROM insumos WHERE IFNULL(activo, 1) = 1');
  const insumoById = new Map(insumos.map((i) => [i.id, i]));
  const products = safeAll('SELECT * FROM products WHERE IFNULL(is_active, 1) = 1 AND IFNULL(price, 0) > 0');
  const soldById = new Map();
  const byOrder = new Map();
  for (const it of items) {
    const key = String(it.product_id || it.product_name);
    const cur = soldById.get(key) || { qty: 0, revenue: 0 };
    cur.qty += Number(it.quantity || 0);
    cur.revenue += Number(it.subtotal || 0);
    soldById.set(key, cur);
    const list = byOrder.get(it.order_id) || [];
    list.push(it.product_name);
    byOrder.set(it.order_id, list);
  }
  const productStats = [];
  let noCostSold = 0;
  for (const p of products) {
    const sold = soldById.get(String(p.id)) || { qty: 0, revenue: 0 };
    const bd = unitCostBreakdown(p, insumoById);
    const price = Number(p.price || 0);
    const hasCost = bd.source !== 'none' && bd.cost > 0;
    if (!hasCost && sold.qty > 0) noCostSold += 1;
    productStats.push({
      name: p.name,
      price,
      cost: hasCost ? bd.cost : null,
      margin: hasCost ? price - bd.cost : null,
      costPct: hasCost ? (bd.cost / price) * 100 : null,
      transformed: bd.source === 'insumos',
      qty: sold.qty,
      revenue: sold.revenue,
      topPart: hasCost ? [...bd.parts].sort((a, b) => b.cost - a.cost)[0] || null : null,
    });
  }
  const withCost = productStats.filter((p) => p.cost != null && p.qty > 0);
  const cogs = withCost.reduce((s, p) => s + p.cost * p.qty, 0);
  const costedRevenue = withCost.reduce((s, p) => s + p.price * p.qty, 0);
  const grossMarginPct = costedRevenue > 0 ? ((costedRevenue - cogs) / costedRevenue) * 100 : null;
  const unsold = productStats.filter((p) => p.qty === 0);

  // Combos: pares que más se piden juntos y cuentas de un solo producto.
  const pairs = new Map();
  let singleItem = 0;
  let itemsCount = 0;
  for (const list of byOrder.values()) {
    const uniq = [...new Set(list)];
    itemsCount += list.length;
    if (uniq.length === 1) singleItem += 1;
    if (uniq.length > 12) continue;
    for (let i = 0; i < uniq.length; i += 1) {
      for (let j = i + 1; j < uniq.length; j += 1) {
        const key = [uniq[i], uniq[j]].sort().join(' + ');
        pairs.set(key, (pairs.get(key) || 0) + 1);
      }
    }
  }
  const topPairs = [...pairs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const avgItemPrice = items.length ? items.reduce((s, it) => s + Number(it.subtotal || 0), 0) / Math.max(1, itemsCount) : 0;

  // Clientes, anulaciones, precios de insumos.
  const customers = customerStats(orders);
  const recurrent = customers.filter((c) => c.visits >= 2).length;
  const businessDay = `date(${sqlBusinessTimestamp('o.created_at', queryOne)})`;
  const cancelled = queryOne(
    `SELECT COUNT(*) AS cnt, IFNULL(SUM(o.total), 0) AS total FROM orders o
     WHERE o.status = 'cancelled' AND ${businessDay} >= date(?) AND ${businessDay} <= date(?)`,
    [period.from, period.to],
  ) || { cnt: 0, total: 0 };
  const trendsUp = insumoPriceTrends(insumoById).filter((t) => t.change > 0).slice(0, 4);

  const discounts = Number(queryOneSafe(
    `SELECT IFNULL(SUM(o.discount), 0) AS v FROM orders o
     WHERE ${PAID_WHERE} AND ${ps.ORDER_DATE} >= date(?) AND ${ps.ORDER_DATE} <= date(?)`,
    [period.from, period.to],
  )?.v || 0);
  const pending = queryOneSafe(
    `SELECT COUNT(*) AS cnt, IFNULL(SUM(o.total), 0) AS total FROM orders o
     WHERE o.status != 'cancelled' AND IFNULL(o.payment_status, 'pending') = 'pending'
       AND ${businessDay} >= date(?) AND ${businessDay} <= date(?)`,
    [period.from, period.to],
  ) || { cnt: 0, total: 0 };
  const createdCount = Number(queryOneSafe(
    `SELECT COUNT(*) AS cnt FROM orders o WHERE ${businessDay} >= date(?) AND ${businessDay} <= date(?)`,
    [period.from, period.to],
  )?.cnt || 0);
  const movDay = `date(${sqlBusinessTimestamp('created_at', queryOne)})`;
  const cashExpenses = Number(queryOneSafe(
    `SELECT IFNULL(SUM(amount), 0) AS v FROM cash_movements WHERE type = 'expense' AND ${movDay} >= date(?) AND ${movDay} <= date(?)`,
    [period.from, period.to],
  )?.v || 0);
  const payroll = Number(queryOneSafe(
    `SELECT IFNULL(SUM(amount), 0) AS v FROM investment_movements WHERE ${movDay} >= date(?) AND ${movDay} <= date(?)`,
    [period.from, period.to],
  )?.v || 0);

  return {
    period, days, orders, revenue, ticket, prev, prevTicket, prevLabel: prevPeriod.label,
    weekdays, openDays, hours, channel,
    productStats, withCost, grossMarginPct, cogs, costedRevenue, noCostSold, unsold,
    topPairs, singleItem, orderCount: byOrder.size, avgItemPrice,
    customers, recurrent, cancelled, trendsUp,
    discounts, pending, createdCount, cashExpenses, payroll,
    businessType: detectBusinessType(products),
    priceByName: new Map(products.map((p) => [p.name, p])),
    insumoById,
  };
}

function queryOneSafe(sql, params) {
  try {
    return queryOne(sql, params);
  } catch (_) {
    return null;
  }
}

const BUSINESS_TYPES = [
  { id: 'cevicheria', re: /ceviche|tiradito|leche de tigre|jalea|chicharron de pescado|causa/, min: 0.12 },
  { id: 'polleria', re: /pollo a la brasa|brasa|1\/4 (de )?pollo|1\/2 pollo|pollo entero|mostrito/, min: 0.12 },
  { id: 'pizzeria', re: /pizza|calzone/, min: 0.15 },
  { id: 'cafeteria', re: /\bcafe\b|capuccino|cappuccino|latte|espresso|americano|frappe|mocaccino|torta|cheesecake|pie de/, min: 0.25 },
  { id: 'comida_rapida', re: /hamburguesa|salchipapa|hot ?dog|broaster|alitas|papas fritas|sandwich/, min: 0.2 },
  { id: 'menu', re: /\bmenu\b|menu del dia|menu ejecutivo|entrada \+ segundo/, min: 0.08 },
  { id: 'bar', re: /pisco|cerveza|chilcano|coctel|cocktail|whisk|\bron\b|vodka|tequila|\bvino\b|sangria|mojito|gin/, min: 0.45 },
];

function detectBusinessType(products) {
  const names = products.map((p) => normalizeSpanish(String(p.name || '')));
  if (names.length < 5) return null;
  let best = null;
  for (const t of BUSINESS_TYPES) {
    const share = names.filter((n) => t.re.test(n)).length / names.length;
    if (share >= t.min && (!best || share / t.min > best.score)) best = { id: t.id, score: share / t.min };
  }
  return best?.id || null;
}

const BUSINESS_TIPS = {
  cevicheria: {
    es: ['Cevichería: controla frescura y cadena de frío, mide el rendimiento del pescado (kg comprado vs porciones servidas) y planifica compras diarias para evitar mermas de perecibles.'],
    en: ['Cevichería: control freshness and the cold chain, measure fish yield (kg bought vs portions served) and plan daily purchases to avoid perishable waste.'],
  },
  polleria: {
    es: ['Pollería: mide el rendimiento por pollo (porciones por unidad), estandariza porciones y guarniciones y produce por tandas según la demanda de cada hora.'],
    en: ['Chicken restaurant: measure yield per chicken (portions per unit), standardize portions and sides, and cook in batches following hourly demand.'],
  },
  pizzeria: {
    es: ['Pizzería: controla el rendimiento de masa y el gramaje de cada ingrediente por tamaño, y calcula el costo de entrega por canal.'],
    en: ['Pizzeria: control dough yield and the weight of each topping per size, and calculate delivery cost per channel.'],
  },
  cafeteria: {
    es: ['Cafetería: costea cada bebida (café, leche, vaso), impulsa la venta complementaria bebida + pastelería y refuerza las horas de mayor demanda.'],
    en: ['Café: cost each drink (coffee, milk, cup), push drink + pastry add-ons and reinforce peak-demand hours.'],
  },
  comida_rapida: {
    es: ['Comida rápida: prioriza velocidad y estandarización, arma combos por canal e incluye el costo de envases en el precio de delivery y para llevar.'],
    en: ['Fast food: prioritize speed and standardization, build combos per channel and include packaging cost in delivery and takeaway prices.'],
  },
  menu: {
    es: ['Restaurante de menú: costea cada ración, planifica la producción diaria según la venta promedio del día y controla sobrantes para no perder margen.'],
    en: ['Set-menu restaurant: cost each portion, plan daily production from the average sales of that weekday and control leftovers to protect margin.'],
  },
  bar: {
    es: ['Bar: estandariza la medida de cada trago con receta, controla inventario y mermas de botellas y cumple las normas de venta de alcohol.'],
    en: ['Bar: standardize each drink measure with a recipe, control bottle inventory and waste, and comply with alcohol sales rules.'],
  },
};

function buildActions(a, lang) {
  const T = (es, en) => (lang === 'en' ? en : es);
  const WD = WEEKDAYS[lang === 'en' ? 'en' : 'es'];
  const actions = [];
  const push = (kind, tags, title, detail, impact = 0) => actions.push({ kind, tags, title, detail, impact: r2(impact) });

  // 1. Precios de productos populares con margen bajo.
  const lowMargin = a.withCost
    .filter((p) => (p.transformed ? p.costPct > 38 : p.costPct > 70))
    .sort((x, y) => y.cost * y.qty - x.cost * x.qty)
    .slice(0, 3);
  if (lowMargin.length) {
    let impact = 0;
    const parts = lowMargin.map((p) => {
      const target = p.transformed ? 0.32 : 0.55;
      const suggested = Math.max(p.price + 0.5, Math.ceil((p.cost / target) * 2) / 2);
      const capped = Math.min(suggested, r2(p.price * 1.15));
      impact += (capped - p.price) * p.qty;
      return T(
        `${p.name}: cuesta ${money(p.cost)} y lo vendes a ${money(p.price)} (${pct(p.costPct)} de costo) → súbelo a ${money(capped)}${p.topPart ? ` o revisa ${p.topPart.name}, su insumo más caro (${money(p.topPart.cost)})` : ''}`,
        `${p.name}: costs ${money(p.cost)} and sells for ${money(p.price)} (${pct(p.costPct)} cost) → raise it to ${money(capped)}${p.topPart ? ` or review ${p.topPart.name}, its most expensive ingredient (${money(p.topPart.cost)})` : ''}`,
      );
    });
    push('price', ['profit'], T('Ajusta precios de lo que se vende con poco margen', 'Adjust prices of items that sell with low margin'),
      `${parts.join('; ')}. ${T('Sube como máximo 10–15 % de una vez para no espantar clientes.', 'Raise at most 10–15% at a time so you do not scare customers away.')}`, impact);
  }

  // 2. Combos para subir el ticket.
  if (a.orderCount >= 10) {
    const singleShare = (a.singleItem / a.orderCount) * 100;
    const pair = a.topPairs[0];
    if (singleShare >= 25 || pair) {
      const impact = a.orderCount * 0.2 * a.avgItemPrice;
      let pairText = '';
      if (pair) {
        pairText = T(`Lo que más se pide junto es **${pair[0]}** (${pair[1]} veces).`, `The most common pair is **${pair[0]}** (${pair[1]} times).`);
        const parts = pair[0].split(' + ').map((n) => a.productStats.find((p) => p.name === n));
        if (parts.length === 2 && parts.every(Boolean)) {
          const separate = parts[0].price + parts[1].price;
          const comboPrice = Math.floor(separate * 0.92 * 2) / 2;
          if (parts.every((p) => p.cost != null)) {
            const comboCost = parts[0].cost + parts[1].cost;
            const comboMargin = ((comboPrice - comboCost) / comboPrice) * 100;
            const separateMargin = ((separate - comboCost) / separate) * 100;
            pairText += ' ' + T(
              `Combo sugerido a ${money(comboPrice)} (por separado ${money(separate)}, 8 % de descuento): costo ${money(comboCost)}, margen de contribución ${pct(comboMargin)} frente a ${pct(separateMargin)} por separado. ${comboMargin >= 50 ? 'Es rentable si hace que más clientes pidan los dos productos.' : 'El margen queda ajustado: aplícalo solo en horas flojas o baja el descuento.'}`,
              `Suggested combo at ${money(comboPrice)} (separately ${money(separate)}, 8% off): cost ${money(comboCost)}, contribution margin ${pct(comboMargin)} versus ${pct(separateMargin)} separately. ${comboMargin >= 50 ? 'It pays off if it makes more customers order both items.' : 'The margin gets tight: apply it only in slow hours or lower the discount.'}`,
            );
          } else {
            pairText += ' ' + T(`Combo sugerido a ${money(comboPrice)} (por separado ${money(separate)}); carga el costo de ambos productos para confirmar que el margen resultante conviene.`,
              `Suggested combo at ${money(comboPrice)} (separately ${money(separate)}); load the cost of both products to confirm the resulting margin is worth it.`);
          }
        }
      }
      push('combo', ['sales', 'profit'], T('Sube el ticket promedio con combos y venta sugerida', 'Raise the average ticket with combos and upselling'),
        `${singleShare >= 25 ? `${T(`El ${pct(singleShare)} de las cuentas lleva un solo producto.`, `${pct(singleShare)} of accounts have a single product.`)} ` : ''}${pairText} ${T('Pide al mozo ofrecer siempre bebida, entrada o postre. Si 1 de cada 5 cuentas suma un producto más, ganarías aprox.', 'Ask waiters to always offer a drink, starter or dessert. If 1 in 5 accounts adds one more item, you would earn approx.')} ${money(impact)} ${T('más en el período.', 'more in the period.')}`,
        impact);
    }
  }

  // 3. Platos rentables que se venden poco (enigmas).
  if (a.withCost.length >= 4) {
    const totalQty = a.withCost.reduce((s, p) => s + p.qty, 0);
    const avgQty = totalQty / a.withCost.length;
    const avgMargin = a.withCost.reduce((s, p) => s + p.margin * p.qty, 0) / Math.max(1, totalQty);
    const puzzles = a.withCost.filter((p) => p.qty < avgQty * 0.7 && p.margin >= avgMargin).sort((x, y) => y.margin - x.margin).slice(0, 3);
    if (puzzles.length) {
      const impact = puzzles.reduce((s, p) => s + p.margin * Math.max(p.qty * 0.5, 5), 0);
      push('promote', ['sales', 'profit'], T('Impulsa los platos que más ganancia dejan pero se venden poco', 'Push the dishes that leave the most profit but sell little'),
        `${puzzles.map((p) => T(`${p.name} (deja ${money(p.margin)} por unidad, ${p.qty} vendidos)`, `${p.name} (leaves ${money(p.margin)} per unit, ${p.qty} sold)`)).join(', ')}. ${T('Ponlos primero en la carta y en el QR, con foto, y que el mozo los recomiende.', 'Put them first on the menu and QR, with a photo, and have waiters recommend them.')}`,
        impact);
    }
    const stars = a.withCost.filter((p) => p.qty >= avgQty * 0.7 && p.margin >= avgMargin).sort((x, y) => y.margin * y.qty - x.margin * x.qty).slice(0, 3);
    if (stars.length) {
      push('stars', ['profit', 'sales'], T('Cuida tus productos estrella', 'Protect your star products'),
        `${stars.map((p) => p.name).join(', ')} ${T('se venden mucho y dejan buen margen: mantén su calidad, nunca te quedes sin stock de sus insumos y úsalos como gancho en promociones.', 'sell a lot and leave good margin: keep their quality, never run out of their ingredients and use them as the hook in promotions.')}`);
    }
  }

  // 4. Día flojo.
  if (a.openDays.length >= 3) {
    const best = a.openDays[0];
    const weak = a.openDays[a.openDays.length - 1];
    const avgDay = a.openDays.reduce((s, w) => s + w.avg, 0) / a.openDays.length;
    if (best.avg > 0 && weak.avg < best.avg * 0.6) {
      const impact = Math.max(0, (avgDay * 0.8 - weak.avg) * weak.count);
      push('weekday', ['sales'], T(`Levanta los ${WD[weak.dow]}`, `Lift your ${WD[weak.dow]}s`),
        T(`Un ${WD[weak.dow]} vendes en promedio ${money(weak.avg)}, frente a ${money(best.avg)} un ${WD[best.dow]}. Lanza una promo solo para ese día (menú del día, 2x1 en bebidas, descuento para grupos) y anúnciala en redes y WhatsApp.`,
          `On ${WD[weak.dow]} you sell ${money(weak.avg)} on average, versus ${money(best.avg)} on ${WD[best.dow]}. Launch a promo only for that day (daily set menu, 2-for-1 drinks, group discount) and announce it on social media and WhatsApp.`),
        impact);
    }
  }

  // 5. Horas valle y hora pico.
  if (a.hours.length >= 4) {
    const peak = [...a.hours].sort((x, y) => y.total - x.total)[0];
    const valley = a.hours.slice(1, -1).filter((h) => h.total < peak.total * 0.25).slice(0, 3);
    if (valley.length) {
      push('hours', ['sales'], T('Aprovecha las horas flojas', 'Use your slow hours'),
        T(`Tu hora pico es ${hourLabel(peak.hour)}; en ${valley.map((h) => hourLabel(h.hour)).join(', ')} casi no vendes. Prueba un happy hour, café + postre o precio especial para llevar en esas horas, y asegura personal completo en la hora pico.`,
          `Your peak hour is ${hourLabel(peak.hour)}; at ${valley.map((h) => hourLabel(h.hour)).join(', ')} you barely sell. Try a happy hour, coffee + dessert or a takeaway special in those hours, and make sure you are fully staffed at peak time.`));
    }
  }

  // 6. Canales.
  if (a.revenue > 0) {
    const share = (k) => ((a.channel.get(k) || 0) / a.revenue) * 100;
    const offsite = share('delivery') + share('pickup');
    if (offsite < 10) {
      push('channel', ['sales'], T('Abre ventas fuera del salón', 'Open sales beyond dine-in'),
        T(`Delivery y para llevar son solo el ${pct(offsite)} de tus ventas. Comparte la carta QR por WhatsApp, activa pedidos para llevar y ofrece 2–3 platos pensados para delivery: vendes más sin necesitar más mesas.`,
          `Delivery and takeaway are only ${pct(offsite)} of your sales. Share the QR menu on WhatsApp, enable takeaway orders and offer 2–3 delivery-friendly dishes: you sell more without needing more tables.`));
    }
  }

  // 7. Clientes recurrentes.
  if (a.orders.length >= 20) {
    const identifiedShare = (a.customers.length / a.orders.length) * 100;
    const recShare = a.customers.length ? (a.recurrent / a.customers.length) * 100 : 0;
    if (identifiedShare < 30 || recShare < 25) {
      push('loyalty', ['sales'], T('Haz que los clientes vuelvan', 'Make customers come back'),
        identifiedShare < 30
          ? T(`Solo identificas al cliente en el ${pct(identifiedShare)} de las cuentas. Pide nombre/DNI o WhatsApp al cobrar y usa la encuesta y fidelización: un cliente que vuelve cuesta mucho menos que uno nuevo.`,
            `You only identify the customer in ${pct(identifiedShare)} of accounts. Ask for name/ID or WhatsApp when charging and use the survey and loyalty program: a returning customer costs much less than a new one.`)
          : T(`Solo el ${pct(recShare)} de tus clientes identificados volvió en el período. Ofrece un beneficio en la segunda visita (postre o bebida gratis) y escríbeles por WhatsApp con tus promociones.`,
            `Only ${pct(recShare)} of your identified customers came back in the period. Offer a perk on the second visit (free dessert or drink) and message them your promotions on WhatsApp.`));
    }
  }

  // 8. Anulaciones.
  const cancelRate = a.createdCount > 0 ? (Number(a.cancelled.cnt) / a.createdCount) * 100 : null;
  if (cancelRate != null && cancelRate > 3) {
    push('voids', ['profit'], T('Reduce las anulaciones', 'Reduce voided orders'),
      T(`Tasa de cancelación: ${pct(cancelRate)} (${a.cancelled.cnt} de ${a.createdCount} pedidos creados, ${money(a.cancelled.total)}). Revisa los motivos registrados antes de sacar conclusiones: pueden ser errores al tomar el pedido, demoras, productos agotados o cambios del cliente.`,
        `Cancellation rate: ${pct(cancelRate)} (${a.cancelled.cnt} of ${a.createdCount} orders created, ${money(a.cancelled.total)}). Review the recorded reasons before drawing conclusions: they may be order-taking mistakes, delays, out-of-stock items or customer changes.`),
      Number(a.cancelled.total) * 0.5);
  }

  // 9. Insumos que subieron de precio.
  if (a.trendsUp.length) {
    push('supplies', ['profit'], T('Controla los insumos que subieron', 'Watch ingredients that went up'),
      T(`Subieron de precio: ${a.trendsUp.map((t) => `${t.name} +${t.change.toFixed(0)}%`).join(', ')}. Compara proveedores, compra por volumen lo de más rotación y revisa el precio de los platos que los usan.`,
        `Price increases: ${a.trendsUp.map((t) => `${t.name} +${t.change.toFixed(0)}%`).join(', ')}. Compare suppliers, buy high-turnover items in bulk and review the price of dishes that use them.`));
  }

  // 10. Carta demasiado larga.
  if (a.unsold.length >= 5 && a.productStats.length) {
    const share = (a.unsold.length / a.productStats.length) * 100;
    if (share >= 20) {
      push('menu', ['profit', 'sales'], T('Revisa la carta', 'Review the menu'),
        T(`${a.unsold.length} producto(s) (${pct(share)} de la carta) no se vendieron en el período, por ejemplo ${a.unsold.slice(0, 4).map((p) => p.name).join(', ')}. Antes de retirarlos evalúa si cumplen una función (identidad del local, temporada, clientes que los piden): mejora su visibilidad o presentación, y solo si siguen sin venderse, reemplázalos. Una carta más corta compra menos insumos y pierde menos por merma.`,
          `${a.unsold.length} product(s) (${pct(share)} of the menu) did not sell in the period, for example ${a.unsold.slice(0, 4).map((p) => p.name).join(', ')}. Before removing them, check whether they play a role (restaurant identity, season, customers who ask for them): improve their visibility or presentation, and only replace them if they still do not sell. A shorter menu needs fewer ingredients and wastes less.`));
    }
  }

  // 11. Datos incompletos.
  if (a.noCostSold > 0) {
    push('data', ['profit'], T('Completa los costos para ver tu ganancia real', 'Complete costs to see your real profit'),
      T(`${a.noCostSold} producto(s) que sí se venden no tienen receta con insumos ni precio de compra. Complétalos en Productos para que pueda calcular exactamente cuánto ganas en cada uno.`,
        `${a.noCostSold} product(s) that do sell have no recipe with ingredients or purchase price. Complete them in Products so I can calculate exactly how much you earn on each.`));
  }

  return actions;
}

function orderActions(actions, focus) {
  const priority = {
    sales: ['combo', 'weekday', 'promote', 'hours', 'channel', 'loyalty', 'stars', 'menu', 'price', 'voids', 'supplies', 'data'],
    profit: ['price', 'combo', 'promote', 'supplies', 'voids', 'menu', 'stars', 'data', 'weekday', 'hours', 'channel', 'loyalty'],
    general: ['price', 'combo', 'weekday', 'promote', 'hours', 'voids', 'supplies', 'channel', 'loyalty', 'menu', 'stars', 'data'],
  }[focus];
  return [...actions].sort((x, y) => {
    if (focus !== 'general' && x.tags.includes(focus) !== y.tags.includes(focus)) return x.tags.includes(focus) ? -1 : 1;
    if (x.impact !== y.impact) return y.impact - x.impact;
    return priority.indexOf(x.kind) - priority.indexOf(y.kind);
  });
}

/** Hechos medidos en los datos y, por separado, hipótesis que el dueño debe verificar. */
function diagnose(a, actions, lang, delta) {
  const T = (es, en) => (lang === 'en' ? en : es);
  const WD = WEEKDAYS[lang === 'en' ? 'en' : 'es'];
  const kinds = new Set(actions.map((x) => x.kind));
  const facts = [];
  const causes = [];
  if (delta != null && delta < -5) {
    facts.push(T(`Las ventas cobradas bajaron ${Math.abs(delta).toFixed(1)}% frente al período anterior.`, `Paid sales fell ${Math.abs(delta).toFixed(1)}% versus the previous period.`));
    causes.push(T('Menos clientes, menos consumo por cuenta, productos agotados, cambios de precio o competencia/temporada. Compara el número de cuentas y el ticket para saber cuál pesa más.',
      'Fewer customers, lower spend per account, out-of-stock items, price changes or competition/season. Compare account count and ticket to see which weighs more.'));
  }
  if (kinds.has('combo') && a.orderCount && (a.singleItem / a.orderCount) >= 0.25) {
    facts.push(T(`El ${pct((a.singleItem / a.orderCount) * 100)} de las cuentas lleva un solo producto.`, `${pct((a.singleItem / a.orderCount) * 100)} of accounts contain a single product.`));
    causes.push(T('Puede que no se ofrezcan complementos al tomar el pedido o que la carta no muestre combos.', 'Add-ons may not be offered when taking the order, or the menu may not show combos.'));
  }
  if (kinds.has('price')) {
    const n = a.withCost.filter((p) => (p.transformed ? p.costPct > 38 : p.costPct > 70)).length;
    facts.push(T(`${n} producto(s) vendidos tienen un costo alto respecto a su precio.`, `${n} sold product(s) have a high cost relative to their price.`));
    causes.push(T('Precio desactualizado frente al costo de los insumos, porciones más grandes que la receta o receta con cantidades mal registradas.', 'Price not updated to ingredient cost, portions larger than the recipe, or recipe quantities recorded incorrectly.'));
  }
  if (kinds.has('weekday') && a.openDays.length >= 2) {
    const weak = a.openDays[a.openDays.length - 1];
    facts.push(T(`Los ${WD[weak.dow]} son el día más flojo (${money(weak.avg)} en promedio).`, `${WD[weak.dow]} is the slowest day (${money(weak.avg)} on average).`));
  }
  if (kinds.has('voids')) {
    causes.push(T('Las anulaciones pueden venir de errores de registro, demoras, productos agotados o cambios del cliente; no deben atribuirse a una persona sin revisar cada caso.', 'Voids may come from entry errors, delays, out-of-stock items or customer changes; do not attribute them to a person without reviewing each case.'));
  }
  if (kinds.has('data')) {
    facts.push(T(`${a.noCostSold} producto(s) vendidos no tienen costo cargado.`, `${a.noCostSold} sold product(s) have no cost loaded.`));
  }
  return { facts: facts.slice(0, 4), causes: causes.slice(0, 3) };
}

function buildAdvisorAnswer(message, user, { lang = 'es' } = {}) {
  if (!isAdviceQuestion(message)) return null;
  if (!canUseTool(user, 'business_insights')) {
    return { reply: deniedToolMessage('business_insights'), sources: [{ kind: 'tool', title: 'permission_denied' }] };
  }
  const T = (es, en) => (lang === 'en' ? en : es);
  const WD = WEEKDAYS[lang === 'en' ? 'en' : 'es'];
  const m = normalizeSpanish(message);
  const focus = detectFocus(m);
  const period = resolveAdvicePeriod(message);
  const a = analyze(period);
  const heading = lang === 'en' && !period.explicit
    ? `last 30 days: ${displayDateKey(period.from)} → ${displayDateKey(period.to)}`
    : periodHeading(period);

  const title = {
    sales: T('Plan para vender más', 'Plan to sell more'),
    profit: T('Plan para mejorar tus ganancias', 'Plan to improve your profits'),
    general: T('Plan para mejorar tu negocio', 'Plan to improve your business'),
  }[focus];

  if (a.orders.length < 5) {
    return {
      reply: [
        `**${title}**`,
        T(`Aún tengo pocas ventas registradas (${a.orders.length} cuenta(s) en ${heading}) para darte un plan con números.`,
          `I still have too few recorded sales (${a.orders.length} account(s) in ${heading}) to give you a plan with numbers.`),
        '',
        T('Mientras tanto, lo que más funciona en restaurantes:', 'Meanwhile, what works best in restaurants:'),
        T('1. Carga el costo de cada plato (receta con insumos o precio de compra) para conocer tu margen real.', '1. Load the cost of each dish (recipe with ingredients or purchase price) to know your real margin.'),
        T('2. Arma 2–3 combos con tus platos más pedidos y ofrece siempre bebida y postre.', '2. Build 2–3 combos with your most ordered dishes and always offer a drink and dessert.'),
        T('3. Comparte tu carta QR por WhatsApp y redes, y registra a tus clientes para que vuelvan.', '3. Share your QR menu on WhatsApp and social media, and register customers so they come back.'),
      ].join('\n'),
      sources: [{ kind: 'tool', title: 'business_advice' }],
      translated: lang === 'en',
    };
  }

  const actions = orderActions(buildActions(a, lang), focus).slice(0, 6);
  const delta = Number(a.prev.total) > 0 ? ((a.revenue - Number(a.prev.total)) / Number(a.prev.total)) * 100 : null;
  const ticketDelta = a.prevTicket > 0 ? ((a.ticket - a.prevTicket) / a.prevTicket) * 100 : null;

  const totalImpact = actions.reduce((s, x) => s + x.impact, 0);
  const costCoverage = a.revenue > 0 ? (a.costedRevenue / a.revenue) * 100 : 0;
  const cancelRate = a.createdCount > 0 ? (Number(a.cancelled.cnt) / a.createdCount) * 100 : null;
  const contribution = a.costedRevenue - a.cogs;
  const expenses = a.cashExpenses + a.payroll;
  const signed = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

  // SITUACIÓN
  const situation = [];
  if (delta != null) {
    situation.push(T(`Tus ventas cobradas ${delta >= 0 ? 'subieron' : 'bajaron'} ${Math.abs(delta).toFixed(1)}% frente a ${a.prevLabel || 'el período anterior'}`,
      `Your paid sales ${delta >= 0 ? 'rose' : 'fell'} ${Math.abs(delta).toFixed(1)}% versus ${a.prevLabel || 'the previous equivalent period'}`));
  } else {
    situation.push(T('No hay ventas del período anterior para comparar', 'There are no sales in the previous period to compare'));
  }
  if (a.grossMarginPct != null) {
    situation.push(T(`y tu margen de contribución estimado es ${pct(a.grossMarginPct)}`, `and your estimated contribution margin is ${pct(a.grossMarginPct)}`));
  }
  const lines = [`**${title}** — ${heading}`, '', `**${T('Situación', 'Situation')}**`, `${situation.join(' ')}.`];

  // DATOS
  lines.push('', `**${T('Datos', 'Data')}** (${T('fuente: ventas del sistema en el período', 'source: system sales in the period')})`);
  lines.push(`• ${T('Ventas cobradas (ya descontados los descuentos; sin anuladas ni cortesías)', 'Paid sales (after discounts; excluding voided and complimentary)')}: ${money(a.revenue)} · ${a.orders.length} ${T('cuentas', 'accounts')}${delta != null ? ` (${signed(delta)})` : ''}`);
  if (a.discounts > 0) lines.push(`• ${T('Descuentos otorgados', 'Discounts given')}: ${money(a.discounts)}`);
  if (Number(a.pending.cnt) > 0) {
    lines.push(`• ${T('Pendiente de cobro (no incluido en ventas cobradas)', 'Pending collection (not included in paid sales)')}: ${money(a.pending.total)} · ${a.pending.cnt} ${T('cuenta(s)', 'account(s)')}`);
  }
  lines.push(`• ${T('Ticket promedio = ventas cobradas ÷ cuentas', 'Average ticket = paid sales ÷ accounts')} = ${money(a.ticket)}${ticketDelta != null ? ` (${signed(ticketDelta)})` : ''}`);
  if (a.grossMarginPct != null) {
    lines.push(`• ${T('Margen de contribución = (ventas − costo de insumos o de compra) ÷ ventas', 'Contribution margin = (sales − ingredient or purchase cost) ÷ sales')} = ${pct(a.grossMarginPct)} (${money(contribution)}; ${T(`calculado sobre el ${pct(costCoverage)} de las ventas que tiene costo cargado`, `based on the ${pct(costCoverage)} of sales that have a cost loaded`)})`);
  }
  if (expenses > 0) {
    lines.push(`• ${T('Gastos registrados en el sistema (egresos de caja + planilla)', 'Expenses recorded in the system (cash expenses + payroll)')}: ${money(expenses)} → ${T('resultado aproximado', 'approximate result')} ${money(contribution - expenses)}. ${T('No es la utilidad neta: faltan los gastos que no se registran en el POS (alquiler, servicios, impuestos).', 'This is not net profit: expenses not recorded in the POS (rent, utilities, taxes) are missing.')}`);
  } else if (a.grossMarginPct != null) {
    lines.push(`• ${T('No hay gastos fijos registrados: el margen de contribución no equivale a la utilidad neta del restaurante.', 'No fixed expenses are recorded: contribution margin is not the restaurant net profit.')}`);
  }
  if (cancelRate != null) lines.push(`• ${T('Tasa de cancelación = cancelados ÷ pedidos creados', 'Cancellation rate = cancelled ÷ orders created')} = ${pct(cancelRate)}`);
  if (a.openDays.length >= 2) {
    const best = a.openDays[0];
    lines.push(`• ${T('Mejor día', 'Best day')}: ${WD[best.dow]} (${money(best.avg)} ${T('en promedio', 'on average')})`);
  }

  // PROBLEMAS Y CAUSAS
  const { facts, causes } = diagnose(a, actions, lang, delta);
  if (facts.length) {
    lines.push('', `**${T('Problemas detectados (hechos)', 'Issues found (facts)')}**`);
    facts.forEach((f) => lines.push(`• ${f}`));
  }
  if (causes.length) {
    lines.push('', `**${T('Causas posibles (por verificar)', 'Possible causes (to verify)')}**`);
    causes.forEach((c) => lines.push(`• ${c}`));
  }

  // RECOMENDACIONES
  lines.push('', `**${T('Recomendaciones (en orden de prioridad)', 'Recommendations (by priority)')}**`);
  actions.forEach((act, i) => {
    lines.push(`${i + 1}. **${act.title}**${act.impact > 0 ? ` — ${T('impacto estimado', 'estimated impact')} ≈ ${money(act.impact)}` : ''}`);
    lines.push(`   ${act.detail}`);
  });
  const tip = a.businessType ? BUSINESS_TIPS[a.businessType]?.[lang === 'en' ? 'en' : 'es']?.[0] : null;
  if (tip) lines.push(`• ${T('Según tu carta', 'Based on your menu')} — ${tip}`);

  // IMPACTO
  lines.push('', `**${T('Impacto estimado', 'Estimated impact')}**`);
  if (totalImpact > 0) {
    lines.push(T(`Aprox. **${money(totalImpact)}** adicionales en un período similar.`, `Approx. **${money(totalImpact)}** extra in a similar period.`));
  }
  lines.push(T(
    'Supuestos: se mantiene el volumen de ventas actual; las subidas de precio no pasan de 15 %; 1 de cada 5 cuentas suma un producto con la venta sugerida; se evita la mitad de las anulaciones.',
    'Assumptions: current sales volume holds; price increases stay under 15%; 1 in 5 accounts adds an item through upselling; half of the voids are avoided.',
  ));
  lines.push(T(
    `Riesgos: subir precios puede bajar la cantidad vendida y un descuento solo conviene si aumenta el volumen. Es una estimación, no una garantía (incertidumbre ${a.orders.length < 80 || costCoverage < 60 ? 'alta' : 'media'}).`,
    `Risks: raising prices may reduce quantity sold, and a discount only pays off if volume grows. This is an estimate, not a guarantee (${a.orders.length < 80 || costCoverage < 60 ? 'high' : 'medium'} uncertainty).`,
  ));
  const limits = [];
  if (costCoverage < 90 && a.revenue > 0) limits.push(T(`solo el ${pct(costCoverage)} de las ventas tiene costo cargado`, `only ${pct(costCoverage)} of sales have a cost loaded`));
  if (a.days < 28) limits.push(T(`el período es corto (${a.days} días)`, `the period is short (${a.days} days)`));
  if (limits.length) lines.push(`${T('Limitaciones', 'Limitations')}: ${limits.join('; ')}.`);

  // PLAN Y MEDICIÓN
  lines.push('', `**${T('Plan y medición', 'Plan and measurement')}**`);
  lines.push(T(`1. Esta semana aplica las recomendaciones 1${actions.length > 1 ? ' y 2' : ''}.`, `1. This week apply recommendation${actions.length > 1 ? 's 1 and 2' : ' 1'}.`));
  lines.push(T(
    `2. Durante 2 a 4 semanas mide el ticket promedio (hoy ${money(a.ticket)}), las ventas cobradas (hoy ${money(a.revenue)} en ${a.days} días)${a.grossMarginPct != null ? `, el margen de contribución (hoy ${pct(a.grossMarginPct)})` : ''}${cancelRate != null ? ` y la tasa de cancelación (hoy ${pct(cancelRate)})` : ''}.`,
    `2. For 2 to 4 weeks track the average ticket (now ${money(a.ticket)}), paid sales (now ${money(a.revenue)} in ${a.days} days)${a.grossMarginPct != null ? `, contribution margin (now ${pct(a.grossMarginPct)})` : ''}${cancelRate != null ? ` and cancellation rate (now ${pct(cancelRate)})` : ''}.`,
  ));
  lines.push(T('3. Vuelve a preguntarme para comparar los resultados con estas cifras.', '3. Ask me again to compare results against these figures.'));
  lines.push('', T('¿Quieres el detalle en **Excel** o **PDF**?', 'Want the detail in **Excel** or **PDF**?'));

  const report = {
    type: 'asesoria',
    lang,
    title,
    subtitle: heading,
    from: period.from,
    to: period.to,
    restaurant: restaurantName(),
    generated_at: new Date().toISOString(),
    kpis: [
      { label: T('Ventas', 'Sales'), value: r2(a.revenue), format: 'money', delta: delta != null ? r2(delta) : null },
      { label: T('Cuentas', 'Accounts'), value: a.orders.length, format: 'int' },
      { label: T('Ticket promedio', 'Average ticket'), value: r2(a.ticket), format: 'money', delta: ticketDelta != null ? r2(ticketDelta) : null },
      ...(a.grossMarginPct != null ? [{ label: T('Margen bruto', 'Gross margin'), value: r2(a.grossMarginPct), format: 'pct' }] : []),
      ...(totalImpact > 0 ? [{ label: T('Potencial estimado', 'Estimated potential'), value: r2(totalImpact), format: 'money' }] : []),
    ],
    charts: [
      {
        id: 'weekday', type: 'bar', format: 'money',
        title: T('Venta promedio por día de la semana', 'Average sales by weekday'),
        data: a.weekdays.map((w) => ({ name: WD[w.dow], value: r2(w.avg) })),
      },
      {
        id: 'hours', type: 'line', format: 'money',
        title: T('Ventas por hora', 'Sales by hour'),
        data: a.hours.map((h) => ({ name: hourLabel(h.hour), value: r2(h.total) })),
      },
      {
        id: 'profit', type: 'hbar', format: 'money',
        title: T('Productos que más ganancia dejan', 'Products that leave the most profit'),
        data: [...a.withCost].sort((x, y) => y.margin * y.qty - x.margin * x.qty).slice(0, 10).map((p) => ({ name: p.name, value: r2(p.margin * p.qty) })),
      },
    ].filter((c) => c.data.length && c.data.some((d) => d.value > 0)),
    tables: [
      {
        title: T('Plan de acción', 'Action plan'),
        columns: [
          { key: 'n', label: '#' },
          { key: 'accion', label: T('Acción', 'Action') },
          { key: 'detalle', label: T('Detalle', 'Detail') },
          { key: 'impacto', label: T('Impacto estimado', 'Estimated impact'), format: 'money' },
        ],
        rows: actions.map((x, i) => ({ n: i + 1, accion: x.title, detalle: x.detail.replace(/\*\*/g, ''), impacto: x.impact || null })),
      },
      {
        title: T('Margen por producto', 'Margin by product'),
        columns: [
          { key: 'name', label: T('Producto', 'Product') },
          { key: 'qty', label: T('Vendidos', 'Sold'), format: 'int' },
          { key: 'price', label: T('Precio', 'Price'), format: 'money' },
          { key: 'cost', label: T('Costo', 'Cost'), format: 'money' },
          { key: 'costPct', label: T('Costo %', 'Cost %'), format: 'pct' },
          { key: 'margin', label: T('Margen unit.', 'Unit margin'), format: 'money' },
          { key: 'profit', label: T('Ganancia', 'Profit'), format: 'money' },
        ],
        rows: [...a.withCost].sort((x, y) => y.margin * y.qty - x.margin * x.qty).map((p) => ({
          name: p.name, qty: p.qty, price: r2(p.price), cost: r2(p.cost), costPct: r2(p.costPct), margin: r2(p.margin), profit: r2(p.margin * p.qty),
        })),
      },
    ].filter((t) => t.rows.length),
    insights: actions.slice(0, 3).map((x) => x.title),
  };

  return {
    reply: lines.join('\n'),
    sources: [{ kind: 'tool', title: 'report', report_type: 'asesoria', report }],
    options: lang === 'en' ? ['Download Excel', 'Download PDF'] : ['Descargar en Excel', 'Descargar en PDF'],
    translated: lang === 'en',
  };
}

module.exports = { isAdviceQuestion, buildAdvisorAnswer, analyze, resolveAdvicePeriod };
