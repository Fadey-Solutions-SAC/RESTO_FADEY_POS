/**
 * IA Fadey — conceptos y fórmulas de gestión gastronómica.
 * Formato: definición, fórmula, valores del local (si hay datos), resultado e interpretación.
 * Si faltan datos o el denominador es cero, explica la limitación en vez de calcular.
 */
const { normalizeSpanish, displayDateKey } = require('./fadeyAiDateParse');
const { canUseTool } = require('./fadeyAiAccess');
const { safeAll } = require('./fadeyAiBusinessAnalysis');

const ASK_RE = /\b(que es|que son|que significa|significado|como (se )?calcul\w*|calcul(a|ar|o)|formula|definicion|define|explica\w*|cual es (mi|el|la)|cuanto es (mi|el|la)|como (obtengo|saco|mido))\b/;

const money = (n) => `S/ ${Number(n || 0).toFixed(2)}`;
const pct = (n) => `${Number(n || 0).toFixed(1)}%`;

function parseAmount(m) {
  const hit = m.match(/(?:costos?|gastos?)\s+fijos?[^\d]{0,25}(\d[\d.,]*)/) || m.match(/s\/\s*(\d[\d.,]*)/);
  if (!hit) return null;
  const n = Number(String(hit[1]).replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

const CONCEPTS = [
  {
    id: 'break_even',
    re: /punto de equilibrio/,
    always: true,
    es: {
      name: 'Punto de equilibrio',
      def: 'Nivel de ventas en el que los ingresos cubren los costos y gastos considerados (no ganas ni pierdes).',
      formula: 'Punto de equilibrio en ventas = costos fijos ÷ margen de contribución (en decimal). Con varios productos se usa el margen ponderado según tu mix de ventas.',
    },
    en: {
      name: 'Break-even point',
      def: 'Sales level at which revenue covers the costs and expenses considered (no profit, no loss).',
      formula: 'Break-even sales = fixed costs ÷ contribution margin (as a decimal). With many products, use the margin weighted by your sales mix.',
    },
    live(a, T, m) {
      if (a.grossMarginPct == null || !(a.costedRevenue > 0)) {
        return T('No puedo calcular tu margen ponderado: tus productos vendidos no tienen costo cargado (receta con insumos o precio de compra).',
          'I cannot calculate your weighted margin: your sold products have no cost loaded (recipe with ingredients or purchase price).');
      }
      const mc = a.grossMarginPct / 100;
      const fixed = parseAmount(m);
      const base = T(`Tu margen de contribución ponderado (${a.label}) es ${pct(a.grossMarginPct)}.`, `Your weighted contribution margin (${a.label}) is ${pct(a.grossMarginPct)}.`);
      if (!fixed) {
        return `${base} ${T('Dime tus costos fijos mensuales (alquiler, sueldos, servicios), por ejemplo «punto de equilibrio con costos fijos de 8000», y lo calculo.',
          'Tell me your monthly fixed costs (rent, salaries, utilities), e.g. “break even with fixed costs of 8000”, and I will calculate it.')}`;
      }
      const be = fixed / mc;
      const daily = be / 30;
      const monthlySales = (a.revenue / a.days) * 30;
      return `${base}\n${T('Valores', 'Values')}: ${money(fixed)} ÷ ${mc.toFixed(3)} = **${money(be)}** ${T('al mes', 'per month')} (≈ ${money(daily)} ${T('por día', 'per day')}).\n${T('Interpretación', 'Interpretation')}: ${T(`hoy vendes ≈ ${money(monthlySales)} al mes, ${monthlySales >= be ? 'por encima' : 'por debajo'} del punto de equilibrio.`, `you currently sell ≈ ${money(monthlySales)} per month, ${monthlySales >= be ? 'above' : 'below'} break-even.`)} ${T('El cálculo solo es tan exacto como los costos cargados y los costos fijos que me indicas.', 'The result is only as accurate as the loaded costs and the fixed costs you give me.')}`;
    },
  },
  {
    id: 'ticket',
    re: /ticket promedio/,
    es: { name: 'Ticket promedio', def: 'Lo que gasta en promedio cada cuenta.', formula: 'Ticket promedio = ventas netas ÷ transacciones completadas.' },
    en: { name: 'Average ticket', def: 'What each account spends on average.', formula: 'Average ticket = net sales ÷ completed transactions.' },
    live(a, T) {
      if (!a.orders.length) return T('No hay cuentas cobradas en el período: no calculo un valor engañoso.', 'There are no paid accounts in the period: I will not compute a misleading value.');
      return `${T('Valores', 'Values')} (${a.label}): ${money(a.revenue)} ÷ ${a.orders.length} = **${money(a.ticket)}**.\n${T('Interpretación: súbelo con venta complementaria (bebida, entrada, postre) y combos.', 'Interpretation: raise it with add-on sales (drink, starter, dessert) and combos.')}`;
    },
  },
  {
    id: 'net_sales',
    re: /ventas? netas?|ventas? brutas?|venta.{0,15}(cobro|cobrad)|diferencia entre venta/,
    es: { name: 'Ventas brutas, netas y cobros', def: 'Venta bruta es lo vendido antes de descuentos; venta neta es después de descuentos, devoluciones y ajustes; cobro es el dinero efectivamente recibido. Una venta registrada no siempre está cobrada.', formula: 'Ventas netas = ventas brutas − descuentos − devoluciones.' },
    en: { name: 'Gross sales, net sales and collections', def: 'Gross sales are sales before discounts; net sales are after discounts, returns and adjustments; collections are money actually received. A recorded sale is not always collected.', formula: 'Net sales = gross sales − discounts − returns.' },
    live(a, T) {
      return `${T('Valores', 'Values')} (${a.label}): ${T('cobrado', 'collected')} ${money(a.revenue)}${a.discounts > 0 ? ` · ${T('descuentos', 'discounts')} ${money(a.discounts)}` : ''}${Number(a.pending.cnt) > 0 ? ` · ${T('pendiente de cobro', 'pending collection')} ${money(a.pending.total)} (${a.pending.cnt})` : ''}.`;
    },
  },
  {
    id: 'contribution',
    re: /margen de contribucion|margen (bruto|unitario|por plato)/,
    es: { name: 'Margen de contribución', def: 'Lo que deja cada venta para cubrir gastos fijos y generar utilidad. No es la utilidad neta del restaurante.', formula: 'Unitario = precio neto − costo variable unitario. Porcentual = margen ÷ precio neto × 100.' },
    en: { name: 'Contribution margin', def: 'What each sale leaves to cover fixed costs and generate profit. It is not the restaurant net profit.', formula: 'Unit = net price − unit variable cost. Percentage = margin ÷ net price × 100.' },
    live(a, T) {
      if (a.grossMarginPct == null) return T('Tus productos vendidos no tienen costo cargado: no puedo calcularlo sin inventar cifras.', 'Your sold products have no cost loaded: I cannot calculate it without making up numbers.');
      return `${T('Valores', 'Values')} (${a.label}): (${money(a.costedRevenue)} − ${money(a.cogs)}) ÷ ${money(a.costedRevenue)} = **${pct(a.grossMarginPct)}**.`;
    },
  },
  {
    id: 'food_cost',
    re: /food ?cost|costo de (los )?alimentos/,
    es: { name: 'Costo de alimentos (food cost)', def: 'Qué parte de las ventas de comida se va en insumos. En restaurantes suele considerarse sano entre 28 y 35 %, según el tipo de negocio.', formula: 'Food cost % = costo de alimentos consumidos ÷ ventas de alimentos del mismo período × 100.' },
    en: { name: 'Food cost', def: 'Share of food sales spent on ingredients. Restaurants usually consider 28–35% healthy, depending on the concept.', formula: 'Food cost % = cost of food consumed ÷ food sales of the same period × 100.' },
    live(a, T) {
      const food = a.withCost.filter((p) => p.transformed);
      const rev = food.reduce((s, p) => s + p.price * p.qty, 0);
      const cost = food.reduce((s, p) => s + p.cost * p.qty, 0);
      if (!(rev > 0)) return T('No hay platos con receta de insumos vendidos en el período: vincula las recetas para calcularlo.', 'No dishes with ingredient recipes were sold in the period: link recipes to calculate it.');
      return `${T('Valores', 'Values')} (${a.label}): ${money(cost)} ÷ ${money(rev)} = **${pct((cost / rev) * 100)}** ${T('(según receta teórica, no incluye mermas no registradas).', '(based on theoretical recipes, excludes unrecorded waste).')}`;
    },
  },
  {
    id: 'markup',
    re: /recargo|markup|margen (vs|o|y) (recargo|markup)|diferencia entre margen/,
    es: { name: 'Margen vs. recargo', def: 'No son lo mismo: el margen se mide sobre el precio y el recargo sobre el costo.', formula: 'Margen % = (precio − costo) ÷ precio × 100. Recargo % = (precio − costo) ÷ costo × 100. Ejemplo: costo S/ 10, precio S/ 25 → margen 60 %, recargo 150 %.' },
    en: { name: 'Margin vs. markup', def: 'They are not the same: margin is measured on price, markup on cost.', formula: 'Margin % = (price − cost) ÷ price × 100. Markup % = (price − cost) ÷ cost × 100. Example: cost S/ 10, price S/ 25 → margin 60%, markup 150%.' },
  },
  {
    id: 'variation',
    re: /variacion porcentual|como calcul\w* (el )?(crecimiento|variacion)/,
    es: { name: 'Variación porcentual', def: 'Cuánto cambió un valor frente a otro período equivalente.', formula: 'Variación % = (valor actual − valor anterior) ÷ valor anterior × 100. Si el valor anterior es 0 no se calcula.' },
    en: { name: 'Percentage change', def: 'How much a value changed versus an equivalent period.', formula: 'Change % = (current − previous) ÷ previous × 100. Not calculated when the previous value is 0.' },
    live(a, T) {
      const prev = Number(a.prev.total);
      if (!(prev > 0)) return T('No hay ventas en el período anterior: no calculo la variación.', 'There are no sales in the previous period: I will not calculate the change.');
      return `${T('Valores (ventas cobradas)', 'Values (paid sales)')}: (${money(a.revenue)} − ${money(prev)}) ÷ ${money(prev)} = **${pct(((a.revenue - prev) / prev) * 100)}**.`;
    },
  },
  {
    id: 'cancel_rate',
    re: /tasa de (cancelacion|anulacion)/,
    es: { name: 'Tasa de cancelación', def: 'Porcentaje de pedidos que se cancelan.', formula: 'Tasa = pedidos cancelados ÷ pedidos creados × 100.' },
    en: { name: 'Cancellation rate', def: 'Share of orders that get cancelled.', formula: 'Rate = cancelled orders ÷ orders created × 100.' },
    live(a, T) {
      if (!(a.createdCount > 0)) return T('No hay pedidos creados en el período.', 'There are no orders created in the period.');
      return `${T('Valores', 'Values')} (${a.label}): ${a.cancelled.cnt} ÷ ${a.createdCount} = **${pct((Number(a.cancelled.cnt) / a.createdCount) * 100)}**. ${T('Revisa los motivos antes de atribuir causas.', 'Review the reasons before attributing causes.')}`;
    },
  },
  {
    id: 'labor_cost',
    re: /costo laboral|costo de (personal|planilla)/,
    es: { name: 'Costo laboral %', def: 'Qué parte de las ventas se va en sueldos y cargas del personal.', formula: 'Costo laboral % = costo laboral ÷ ventas netas × 100.' },
    en: { name: 'Labor cost %', def: 'Share of sales spent on staff wages and charges.', formula: 'Labor cost % = labor cost ÷ net sales × 100.' },
    live(a, T) {
      if (!(a.payroll > 0) || !(a.revenue > 0)) return T('No hay pagos de planilla registrados en el período: dime el costo laboral mensual y lo calculo.', 'No payroll payments are recorded in the period: tell me the monthly labor cost and I will calculate it.');
      return `${T('Valores (planilla registrada)', 'Values (recorded payroll)')}: ${money(a.payroll)} ÷ ${money(a.revenue)} = **${pct((a.payroll / a.revenue) * 100)}**.`;
    },
  },
  {
    id: 'turnover',
    re: /rotacion de (inventario|stock)|dias de inventario/,
    es: { name: 'Rotación y días de inventario', def: 'Cuántas veces se renueva el inventario y cuántos días dura.', formula: 'Rotación = costo de ventas ÷ inventario promedio. Días de inventario = inventario promedio ÷ costo de ventas diario promedio (con valoraciones compatibles).' },
    en: { name: 'Inventory turnover and days', def: 'How many times inventory is renewed and how many days it lasts.', formula: 'Turnover = cost of sales ÷ average inventory. Inventory days = average inventory ÷ average daily cost of sales (compatible valuations).' },
    live(a, T) {
      const inv = safeAll(`SELECT IFNULL(SUM(stock * IFNULL(purchase_price, 0)), 0) AS v FROM products WHERE IFNULL(is_active, 1) = 1 AND process_type = 'non_transformed'`)[0]?.v || 0;
      const ins = safeAll('SELECT IFNULL(SUM(stock_actual * IFNULL(costo_promedio, 0)), 0) AS v FROM insumos WHERE IFNULL(activo, 1) = 1')[0]?.v || 0;
      const value = Number(inv) + Number(ins);
      if (!(value > 0) || !(a.cogs > 0)) return T('Faltan costos de inventario o de ventas para calcularlo sin distorsión.', 'Inventory or sales costs are missing to calculate it without distortion.');
      const dailyCogs = a.cogs / a.days;
      return `${T('Valores (inventario actual como aproximación del promedio)', 'Values (current inventory as an approximation of the average)')}: ${T('rotación', 'turnover')} ${money(a.cogs)} ÷ ${money(value)} = **${(a.cogs / value).toFixed(2)}** ${T(`en ${a.days} días`, `in ${a.days} days`)}; ${T('días de inventario', 'inventory days')} ${money(value)} ÷ ${money(dailyCogs)} = **${(value / dailyCogs).toFixed(0)}**.`;
    },
  },
  {
    id: 'reorder',
    re: /punto de (reposicion|pedido|reorden)|stock de seguridad|que es (el )?stock minimo/,
    es: { name: 'Stock mínimo, de seguridad y punto de reposición', def: 'El stock de seguridad cubre imprevistos; el punto de reposición indica cuándo volver a comprar.', formula: 'Punto de reposición = demanda diaria × tiempo de entrega del proveedor (días) + stock de seguridad.' },
    en: { name: 'Minimum stock, safety stock and reorder point', def: 'Safety stock covers surprises; the reorder point tells you when to buy again.', formula: 'Reorder point = daily demand × supplier lead time (days) + safety stock.' },
  },
  {
    id: 'inventory_diff',
    re: /diferencia de inventario|faltante de inventario|sobrante de inventario/,
    es: { name: 'Diferencia de inventario', def: 'Una diferencia no confirma una causa: puede venir de errores de registro, unidades incorrectas, mermas, consumos no registrados, devoluciones o movimientos pendientes.', formula: 'Diferencia = stock físico − stock teórico (registrado).' },
    en: { name: 'Inventory difference', def: 'A difference does not confirm a cause: it may come from entry errors, wrong units, waste, unrecorded consumption, returns or pending movements.', formula: 'Difference = physical stock − theoretical (recorded) stock.' },
  },
  {
    id: 'occupancy',
    re: /ocupacion de (las )?mesas|rotacion de mesas/,
    es: { name: 'Ocupación de mesas', def: 'Qué parte del tiempo disponible las mesas estuvieron ocupadas.', formula: 'Ocupación % = tiempo ocupado ÷ tiempo disponible × 100.', note: 'Aún no calculo este indicador automáticamente: el POS no guarda el tiempo exacto de ocupación de cada mesa.' },
    en: { name: 'Table occupancy', def: 'Share of available time tables were occupied.', formula: 'Occupancy % = occupied time ÷ available time × 100.', note: 'I do not calculate this indicator automatically yet: the POS does not store exact table occupancy time.' },
  },
  {
    id: 'cash_flow',
    re: /flujo de caja|utilidad (vs|y|o) (flujo|caja)|diferencia entre utilidad/,
    es: { name: 'Flujo de caja vs. utilidad', def: 'La utilidad es ventas menos costos y gastos del período; el flujo de caja es el dinero que realmente entra y sale. Puedes tener utilidad y quedarte sin efectivo (por cuentas por cobrar, compras grandes o deudas).', formula: 'Flujo de caja = cobros − pagos del período.' },
    en: { name: 'Cash flow vs. profit', def: 'Profit is sales minus costs and expenses of the period; cash flow is the money that actually comes in and goes out. You can be profitable and run out of cash (receivables, large purchases or debts).', formula: 'Cash flow = collections − payments of the period.' },
  },
  {
    id: 'menu_engineering',
    re: /ingenieria de menu|matriz de (menu|carta)|clasifica\w* (mi|la) carta/,
    always: true,
    es: { name: 'Ingeniería de menú', def: 'Clasifica cada producto por popularidad y contribución: alta/alta (mantener calidad), alta popularidad y baja contribución (revisar receta, porción, costo y precio), baja popularidad y alta contribución (mejorar visibilidad y promoción), baja/baja (modificar, sustituir o retirar considerando su función en la carta).', formula: 'Popular = unidades ≥ 70 % del promedio del mix. Rentable = margen unitario ≥ margen promedio ponderado.' },
    en: { name: 'Menu engineering', def: 'Classifies each product by popularity and contribution: high/high (keep quality), high popularity and low contribution (review recipe, portion, cost and price), low popularity and high contribution (improve visibility and promotion), low/low (modify, replace or remove considering its role on the menu).', formula: 'Popular = units ≥ 70% of the mix average. Profitable = unit margin ≥ weighted average margin.' },
  },
  {
    id: 'recipe_cost',
    re: /costo de (la )?receta|costear (un |una |mis )?(plato|receta)|costeo/,
    es: { name: 'Costo de receta', def: 'Suma del costo de los ingredientes de un plato, considerando unidades, rendimientos y mermas.', formula: 'Costo de receta = Σ (cantidad usada ÷ rendimiento × costo unitario del insumo). En Resto-FADEY se calcula al vincular los insumos al producto con su cantidad y registrar las compras de cada insumo.' },
    en: { name: 'Recipe cost', def: 'Sum of the cost of a dish ingredients, considering units, yields and waste.', formula: 'Recipe cost = Σ (quantity used ÷ yield × ingredient unit cost). In Resto-FADEY it is calculated by linking ingredients to the product with their quantity and recording each ingredient purchase.' },
  },
  {
    id: 'upsell',
    re: /venta (complementaria|cruzada|sugerida|de mayor valor)|upsell|cross ?sell/,
    es: { name: 'Venta complementaria y de mayor valor', def: 'Complementaria: ofrecer un producto que acompaña la compra (bebida, postre). De mayor valor: ofrecer una alternativa de más precio que aporte más al cliente (tamaño grande, plato especial).', formula: 'Mide su efecto con el ticket promedio y el % de cuentas con más de un producto.' },
    en: { name: 'Add-on and upselling', def: 'Add-on: offering a product that complements the purchase (drink, dessert). Upselling: offering a higher-priced alternative that gives the customer more value (large size, special dish).', formula: 'Measure the effect with the average ticket and the % of accounts with more than one product.' },
  },
];

function findConcept(message) {
  const m = normalizeSpanish(String(message || '')).replace(/^[¿?¡!\s]+/, '');
  const concept = CONCEPTS.find((c) => c.re.test(m));
  if (!concept) return null;
  if (!concept.always && !ASK_RE.test(m)) return null;
  return { concept, m };
}

function buildConceptAnswer(message, user, { lang = 'es', analyzeFn, periodFn } = {}) {
  const hit = findConcept(message);
  if (!hit) return null;
  const { concept, m } = hit;
  const T = (es, en) => (lang === 'en' ? en : es);
  const txt = concept[lang === 'en' ? 'en' : 'es'];
  const lines = [`**${txt.name}**`, txt.def, '', `${T('Fórmula', 'Formula')}: ${txt.formula}`];
  if (txt.note) lines.push('', txt.note);
  if (concept.live && analyzeFn && canUseTool(user, 'business_insights')) {
    try {
      const period = periodFn(message);
      const a = analyzeFn(period);
      a.label = lang === 'en' && !period.explicit
        ? `last 30 days: ${displayDateKey(period.from)} → ${displayDateKey(period.to)}`
        : `${period.label || ''} ${displayDateKey(period.from)} → ${displayDateKey(period.to)}`.trim();
      const live = concept.live(a, T, m);
      if (live) lines.push('', `**${T('En tu restaurante', 'In your restaurant')}**`, live);
    } catch (_) {
      /* sin datos: se queda con la definición */
    }
  }
  return {
    reply: lines.join('\n'),
    sources: [{ kind: 'tool', title: 'business_concept', concept: concept.id }],
    translated: lang === 'en',
  };
}

module.exports = { buildConceptAnswer, findConcept };
