/**
 * IA Fadey — «¿Qué productos debo comprar?»: lista de compras sugerida según stock,
 * mínimo y ritmo de venta de los últimos días (productos no transformables e insumos).
 */
const { queryOne } = require('../../database');
const { getBusinessTodayDateKey, shiftBusinessDateKey } = require('../../utils/appDateTime');
const { isNonTransformedLowStockSql, effectiveMinStock } = require('../../utils/productStockThreshold');
const { getPaidSalesEventSql } = require('../../utils/salesAccountGrouping');
const { normalizeSpanish, displayDateKey } = require('./fadeyAiDateParse');
const { canUseTool, deniedToolMessage } = require('./fadeyAiAccess');
const { PAID_WHERE, safeAll } = require('./fadeyAiBusinessAnalysis');

const SALES_WINDOW_DAYS = 14;
const COVER_DAYS = 7;

const PURCHASE_RE = /lista de (las )?compras?|compras? sugeridas?|sugerencias? de compras?|\b(que|cuales|cuanto|cuantos)\b.*\b(comprar|compro|compramos|reponer|repongo|reponemos|pedir al proveedor|abastecer|surtir)\b|\b(debo|tengo que|hay que|necesito|deberia|conviene) (comprar|reponer|abastecer)\b|\bque me falta (comprar)?\b/;

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const money = (n) => `S/ ${Number(n || 0).toFixed(2)}`;
const qty = (n) => (Number.isInteger(Number(n)) ? String(Number(n)) : Number(n).toFixed(2));

function isPurchaseQuestion(message) {
  const m = normalizeSpanish(String(message || '')).replace(/^[¿?¡!\s]+/, '');
  if (/^como\b/.test(m)) return false;
  return PURCHASE_RE.test(m);
}

function restaurantName() {
  try {
    return String(queryOne('SELECT name FROM restaurants LIMIT 1')?.name || '').trim();
  } catch (_) {
    return '';
  }
}

function buildPurchasePlan() {
  const today = getBusinessTodayDateKey(queryOne);
  const from = shiftBusinessDateKey(today, -(SALES_WINDOW_DAYS - 1));
  const ps = getPaidSalesEventSql();

  const sold = safeAll(
    `SELECT oi.product_id, SUM(oi.quantity) AS qty FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE ${PAID_WHERE} AND ${ps.ORDER_DATE} >= date(?) AND ${ps.ORDER_DATE} <= date(?)
       AND IFNULL(oi.product_id, '') != '' GROUP BY oi.product_id`,
    [from, today],
  );
  const soldById = new Map(sold.map((r) => [String(r.product_id), Number(r.qty || 0)]));

  const products = safeAll(
    `SELECT p.id, p.name, p.stock, p.min_stock, IFNULL(p.purchase_price, 0) AS purchase_price,
            CASE WHEN ${isNonTransformedLowStockSql('p')} THEN 1 ELSE 0 END AS low
     FROM products p
     WHERE IFNULL(p.is_active, 1) = 1 AND p.process_type = 'non_transformed'`,
  );

  const productRows = [];
  for (const p of products) {
    const stock = Number(p.stock || 0);
    const minimo = effectiveMinStock(p.min_stock);
    const daily = (soldById.get(String(p.id)) || 0) / SALES_WINDOW_DAYS;
    const daysLeft = daily > 0 ? stock / daily : null;
    const urgent = Number(p.low) === 1 || (daysLeft != null && daysLeft < 3);
    if (!urgent) continue;
    const target = Math.max(minimo * 2, Math.ceil(daily * COVER_DAYS) + minimo);
    const comprar = Math.max(1, Math.ceil(target - stock));
    const costo = r2(p.purchase_price);
    productRows.push({
      name: p.name,
      stock,
      minimo,
      venta_diaria: r2(daily),
      dias: daysLeft == null ? null : r2(daysLeft),
      comprar,
      costo,
      subtotal: r2(comprar * costo),
      prioridad: stock <= 0 ? 'Agotado' : stock <= minimo ? 'Bajo mínimo' : 'Se agota pronto',
    });
  }
  const rank = { Agotado: 0, 'Bajo mínimo': 1, 'Se agota pronto': 2 };
  productRows.sort((a, b) => rank[a.prioridad] - rank[b.prioridad] || b.venta_diaria - a.venta_diaria || a.name.localeCompare(b.name));

  const insumoRows = safeAll(
    `SELECT nombre, unidad_medida, stock_actual, stock_minimo, IFNULL(costo_promedio, 0) AS costo_promedio
     FROM insumos WHERE IFNULL(activo, 1) = 1 AND IFNULL(stock_minimo, 0) > 0 AND IFNULL(stock_actual, 0) <= stock_minimo
     ORDER BY nombre`,
  ).map((i) => {
    const stock = r2(i.stock_actual);
    const minimo = r2(i.stock_minimo);
    const comprar = r2(Math.max(minimo * 2 - stock, minimo));
    const costo = r2(i.costo_promedio);
    return {
      name: i.nombre,
      unidad: i.unidad_medida || '',
      stock,
      minimo,
      comprar,
      costo,
      subtotal: r2(comprar * costo),
      prioridad: stock <= 0 ? 'Agotado' : 'Bajo mínimo',
    };
  });

  return { today, from, productRows, insumoRows };
}

function buildPurchaseReport(plan) {
  const { today, from, productRows, insumoRows } = plan;
  const totalProducts = productRows.reduce((s, r) => s + r.subtotal, 0);
  const totalInsumos = insumoRows.reduce((s, r) => s + r.subtotal, 0);
  const report = {
    type: 'compras',
    title: 'Lista de compras sugerida',
    subtitle: `Stock al ${displayDateKey(today)}`,
    from,
    to: today,
    restaurant: restaurantName(),
    generated_at: new Date().toISOString(),
    kpis: [
      { label: 'Productos por comprar', value: productRows.length, format: 'int' },
      { label: 'Insumos por comprar', value: insumoRows.length, format: 'int' },
      { label: 'Agotados', value: [...productRows, ...insumoRows].filter((r) => r.prioridad === 'Agotado').length, format: 'int' },
      { label: 'Inversión estimada', value: r2(totalProducts + totalInsumos), format: 'money' },
    ],
    charts: [
      {
        id: 'buy',
        type: 'hbar',
        title: 'Cantidad sugerida a comprar',
        format: 'number',
        data: [...productRows, ...insumoRows].slice(0, 12).map((r) => ({ name: r.name, value: r.comprar })),
      },
      {
        id: 'stock',
        type: 'bar',
        title: 'Stock actual vs mínimo',
        format: 'number',
        series: [{ key: 'value', label: 'Stock' }, { key: 'value2', label: 'Mínimo' }],
        data: productRows.slice(0, 12).map((r) => ({ name: r.name, value: r.stock, value2: r.minimo })),
      },
    ].filter((c) => c.data.length),
    tables: [
      {
        title: 'Productos por comprar',
        columns: [
          { key: 'name', label: 'Producto' },
          { key: 'prioridad', label: 'Prioridad' },
          { key: 'stock', label: 'Stock', format: 'number' },
          { key: 'minimo', label: 'Mínimo', format: 'number' },
          { key: 'venta_diaria', label: 'Venta diaria', format: 'number' },
          { key: 'comprar', label: 'Comprar', format: 'number' },
          { key: 'costo', label: 'Costo unit.', format: 'money' },
          { key: 'subtotal', label: 'Subtotal', format: 'money' },
        ],
        rows: productRows,
        totals: { name: 'TOTAL', subtotal: r2(totalProducts) },
      },
      {
        title: 'Insumos por comprar',
        columns: [
          { key: 'name', label: 'Insumo' },
          { key: 'unidad', label: 'Unidad' },
          { key: 'prioridad', label: 'Prioridad' },
          { key: 'stock', label: 'Stock', format: 'number' },
          { key: 'minimo', label: 'Mínimo', format: 'number' },
          { key: 'comprar', label: 'Comprar', format: 'number' },
          { key: 'costo', label: 'Costo prom.', format: 'money' },
          { key: 'subtotal', label: 'Subtotal', format: 'money' },
        ],
        rows: insumoRows,
        totals: { name: 'TOTAL', subtotal: r2(totalInsumos) },
      },
    ].filter((t) => t.rows.length),
    insights: [],
  };
  const out = [...productRows, ...insumoRows].filter((r) => r.prioridad === 'Agotado');
  if (out.length) report.insights.push(`Agotados, comprar primero: ${out.slice(0, 6).map((r) => r.name).join(', ')}.`);
  const noCost = [...productRows, ...insumoRows].filter((r) => !(r.costo > 0)).length;
  if (noCost) report.insights.push(`${noCost} artículo(s) sin costo registrado: la inversión estimada sale incompleta.`);
  report.insights.push(`Cantidades calculadas para cubrir ${COVER_DAYS} días de venta más el stock mínimo, según lo vendido en los últimos ${SALES_WINDOW_DAYS} días.`);
  return report;
}

function buildPurchaseAnswer(message, user) {
  if (!isPurchaseQuestion(message)) return null;
  if (!canUseTool(user, 'low_stock')) {
    return { reply: deniedToolMessage('low_stock'), sources: [{ kind: 'tool', title: 'permission_denied' }] };
  }
  const plan = buildPurchasePlan();
  const { productRows, insumoRows, today } = plan;
  if (!productRows.length && !insumoRows.length) {
    return {
      reply: `No necesitas comprar nada por ahora: ningún producto ni insumo está bajo su mínimo ni se agota en los próximos 3 días (stock al ${displayDateKey(today)}).`,
      sources: [{ kind: 'tool', title: 'purchase_plan' }],
    };
  }
  const report = buildPurchaseReport(plan);
  const lines = [`**Lista de compras sugerida** — stock al ${displayDateKey(today)}`, ''];
  if (productRows.length) {
    lines.push(`**Productos (${productRows.length})**`);
    productRows.slice(0, 10).forEach((r, i) => {
      const pace = r.venta_diaria > 0 ? ` · vendes ~${qty(r.venta_diaria)}/día` : '';
      const cost = r.costo > 0 ? ` (≈ ${money(r.subtotal)})` : '';
      lines.push(`${i + 1}. ${r.name} — stock ${qty(r.stock)} / mín. ${qty(r.minimo)}${pace} → comprar **${qty(r.comprar)}**${cost}`);
    });
    if (productRows.length > 10) lines.push(`…y ${productRows.length - 10} más en el detalle.`);
    lines.push('');
  }
  if (insumoRows.length) {
    lines.push(`**Insumos (${insumoRows.length})**`);
    insumoRows.slice(0, 10).forEach((r, i) => {
      const u = r.unidad ? ` ${r.unidad}` : '';
      const cost = r.costo > 0 ? ` (≈ ${money(r.subtotal)})` : '';
      lines.push(`${i + 1}. ${r.name} — stock ${qty(r.stock)}${u} / mín. ${qty(r.minimo)}${u} → comprar **${qty(r.comprar)}${u}**${cost}`);
    });
    if (insumoRows.length > 10) lines.push(`…y ${insumoRows.length - 10} más en el detalle.`);
    lines.push('');
  }
  const total = report.kpis.find((k) => k.format === 'money')?.value || 0;
  if (total > 0) lines.push(`Inversión estimada: **${money(total)}**`);
  lines.push(`Cálculo: cubre ${COVER_DAYS} días de venta más el stock mínimo (según los últimos ${SALES_WINDOW_DAYS} días).`);
  lines.push('Limitaciones: se basa en el stock registrado en el sistema; no considera compras en camino ni el tiempo de entrega del proveedor. Verifica el stock físico antes de comprar.');
  lines.push('¿Deseas descargar el informe? Elige **Excel** o **PDF** (incluye gráficos y todo el detalle).');
  return {
    reply: lines.join('\n'),
    sources: [{ kind: 'tool', title: 'report', report_type: 'compras', report }],
    options: ['Descargar en Excel', 'Descargar en PDF'],
  };
}

module.exports = { isPurchaseQuestion, buildPurchaseAnswer };
