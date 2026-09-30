/**
 * IA Fadey — informes estructurados (KPIs + gráficos + tablas) para el chat,
 * con descarga en Excel o PDF desde el cliente.
 */
const { queryOne } = require('../../database');
const { getPaidSalesEventSql, metricsFromPaidOrdersWhere } = require('../../utils/salesAccountGrouping');
const { getBusinessTodayDateKey, shiftBusinessDateKey, sqlBusinessTimestamp } = require('../../utils/appDateTime');
const { isNonTransformedLowStockSql, effectiveMinStock } = require('../../utils/productStockThreshold');
const { resolveNaturalPeriod, normalizeSpanish, displayDateKey } = require('./fadeyAiDateParse');
const { canUseTool, deniedToolMessage } = require('./fadeyAiAccess');
const {
  PAID_WHERE,
  CHANNEL_LABELS,
  WEEKDAY_LABELS,
  daysBetween,
  periodHeading,
  safeAll,
  customerStats,
  loadPaidOrderRows,
  unitCostBreakdown,
} = require('./fadeyAiBusinessAnalysis');

const PAY_LABELS = {
  efectivo: 'Efectivo',
  yape: 'Yape',
  plin: 'Plin',
  tarjeta: 'Tarjeta',
  online: 'Online',
  transferencia: 'Transferencia',
  mixto: 'Mixto',
};

const REPORT_RE = /\b(informe|informes|reporte|reportes|report|grafic[oa]s?|estadisticas?)\b/;
const DOWNLOAD_ONLY_RE = /^(descargar?\s*)?(en\s*)?(excel|pdf)[.!]*$/;

const money = (n) => `S/ ${Number(n || 0).toFixed(2)}`;
const pct = (n) => `${Number(n || 0).toFixed(1)}%`;
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;

function detectReportType(m) {
  if (/\b(costo|costos|margen|margenes|food ?cost|rentabilidad|ganancia)\b/.test(m)) return 'costos';
  if (/\b(inventario|stock|almacen|insumos?|existencias)\b/.test(m)) return 'inventario';
  if (/\b(cliente|clientes|fidelizacion|recurrentes?)\b/.test(m)) return 'clientes';
  if (/\b(personal|mesero|meseros|mozo|mozos|empleados?|trabajadores|productividad)\b/.test(m)) return 'personal';
  if (/\b(producto|productos|platos?|carta|categorias?|mas vendidos?)\b/.test(m)) return 'productos';
  return 'ventas';
}

const TYPE_TOOL = {
  ventas: 'sales_summary',
  productos: 'sales_summary',
  clientes: 'customer_insights',
  personal: 'sales_summary',
  costos: 'cost_insights',
  inventario: 'low_stock',
};

function isReportRequest(message) {
  const m = normalizeSpanish(String(message || '')).replace(/^[¿?¡!\s]+/, '');
  return REPORT_RE.test(m);
}

function isDownloadOnlyMessage(message) {
  const m = normalizeSpanish(String(message || '')).replace(/^[¿?¡!\s]+/, '');
  return DOWNLOAD_ONLY_RE.test(m);
}

function resolvePeriod(message) {
  const today = getBusinessTodayDateKey(queryOne);
  return resolveNaturalPeriod(message || '', today, { defaultScope: 'month' });
}

function previousPeriod(p) {
  const span = daysBetween(p.from, p.to);
  const to = shiftBusinessDateKey(p.from, -1);
  return { from: shiftBusinessDateKey(to, -(span - 1)), to };
}

function dateRangeKeys(from, to) {
  const out = [];
  let cur = from;
  let guard = 0;
  while (cur <= to && guard < 400) {
    out.push(cur);
    cur = shiftBusinessDateKey(cur, 1);
    guard += 1;
  }
  return out;
}

function deltaPct(cur, prev) {
  if (!(prev > 0)) return null;
  return r2(((cur - prev) / prev) * 100);
}

function restaurantName() {
  return String(queryOne('SELECT name FROM restaurants LIMIT 1')?.name || '').trim();
}

function baseReport(type, title, period) {
  return {
    type,
    title,
    subtitle: periodHeading(period),
    from: period.from,
    to: period.to,
    restaurant: restaurantName(),
    generated_at: new Date().toISOString(),
    kpis: [],
    charts: [],
    tables: [],
    insights: [],
  };
}

function rangeWhere(ps) {
  return `${ps.ORDER_DATE} >= date(?) AND ${ps.ORDER_DATE} <= date(?)`;
}

/* ───────────────────────── Ventas ───────────────────────── */

function buildSalesReport(period) {
  const ps = getPaidSalesEventSql();
  const where = rangeWhere(ps);
  const prev = previousPeriod(period);
  const cur = metricsFromPaidOrdersWhere(where, [period.from, period.to]);
  const before = metricsFromPaidOrdersWhere(where, [prev.from, prev.to]);
  const report = baseReport('ventas', 'Informe de ventas', period);
  const ticket = cur.orders ? cur.sales / cur.orders : 0;
  const prevTicket = before.orders ? before.sales / before.orders : 0;

  const pending = queryOne(
    `SELECT COUNT(*) AS cnt, IFNULL(SUM(o.total), 0) AS total FROM orders o
     WHERE o.status != 'cancelled' AND o.payment_status = 'pending'
       AND IFNULL(o.payment_method, '') NOT IN ('cortesia', 'cuenta_cliente') AND ${where}`,
    [period.from, period.to],
  ) || {};
  const cancelled = queryOne(
    `SELECT COUNT(*) AS cnt, IFNULL(SUM(o.total), 0) AS total FROM orders o WHERE o.status = 'cancelled' AND ${where}`,
    [period.from, period.to],
  ) || {};

  report.kpis = [
    { label: 'Ventas cobradas', value: r2(cur.sales), format: 'money', delta: deltaPct(cur.sales, before.sales) },
    { label: 'Cuentas', value: cur.orders, format: 'int', delta: deltaPct(cur.orders, before.orders) },
    { label: 'Ticket promedio', value: r2(ticket), format: 'money', delta: deltaPct(ticket, prevTicket) },
    { label: 'Comandas', value: Number(cur.comandas || 0), format: 'int' },
    { label: 'Pendiente de cobro', value: r2(pending.total), format: 'money' },
    { label: 'Anuladas', value: Number(cancelled.cnt || 0), format: 'int' },
  ];

  const span = daysBetween(period.from, period.to);
  const byMonth = span > 62;
  const dayRows = safeAll(
    `SELECT ${byMonth ? ps.ORDER_MONTH : ps.ORDER_DATE} AS k, COUNT(*) AS cnt, IFNULL(SUM(o.total), 0) AS total
     FROM orders o WHERE ${PAID_WHERE} AND ${where}
     GROUP BY k ORDER BY k`,
    [period.from, period.to],
  );
  const dayMap = new Map(dayRows.map((r) => [r.k, r]));
  const keys = byMonth ? dayRows.map((r) => r.k) : dateRangeKeys(period.from, period.to);
  const daily = keys.map((k) => {
    const row = dayMap.get(k) || { cnt: 0, total: 0 };
    const total = Number(row.total || 0);
    const cnt = Number(row.cnt || 0);
    return {
      name: byMonth ? k : displayDateKey(k).slice(0, 5),
      fecha: byMonth ? k : displayDateKey(k),
      cuentas: cnt,
      ventas: r2(total),
      ticket: cnt ? r2(total / cnt) : 0,
    };
  });

  const orderRows = loadPaidOrderRows(ps, period.from, period.to);
  const hourMap = new Map();
  const channelMap = new Map();
  for (const r of orderRows) {
    if (Number.isFinite(r.hour)) {
      const h = hourMap.get(r.hour) || { cnt: 0, total: 0 };
      h.cnt += 1;
      h.total += Number(r.total || 0);
      hourMap.set(r.hour, h);
    }
    const ch = CHANNEL_LABELS[r.type] || 'Otros';
    channelMap.set(ch, (channelMap.get(ch) || 0) + Number(r.total || 0));
  }
  const hours = [...hourMap.entries()].sort((a, b) => a[0] - b[0]).map(([h, v]) => ({
    name: `${String(h).padStart(2, '0')}:00`,
    hora: `${String(h).padStart(2, '0')}:00 – ${String((h + 1) % 24).padStart(2, '0')}:00`,
    cuentas: v.cnt,
    ventas: r2(v.total),
  }));

  const payRows = safeAll(
    `SELECT lower(IFNULL(NULLIF(trim(o.payment_method), ''), 'efectivo')) AS method, COUNT(*) AS cnt, IFNULL(SUM(o.total), 0) AS total
     FROM orders o WHERE ${PAID_WHERE} AND ${where}
     GROUP BY method ORDER BY total DESC`,
    [period.from, period.to],
  );
  const payTotal = payRows.reduce((s, r) => s + Number(r.total || 0), 0);
  const payments = payRows.map((r) => ({
    name: PAY_LABELS[r.method] || r.method,
    cobros: Number(r.cnt || 0),
    monto: r2(r.total),
    participacion: payTotal ? r2((Number(r.total || 0) / payTotal) * 100) : 0,
  }));

  const topRows = safeAll(
    `SELECT oi.product_name AS name, SUM(oi.quantity) AS qty, SUM(oi.subtotal) AS revenue
     FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE ${PAID_WHERE} AND ${where}
     GROUP BY oi.product_name ORDER BY revenue DESC LIMIT 15`,
    [period.from, period.to],
  );
  const itemsTotal = topRows.reduce((s, r) => s + Number(r.revenue || 0), 0);
  const top = topRows.map((r) => ({
    name: r.name,
    cantidad: Number(r.qty || 0),
    ventas: r2(r.revenue),
    participacion: itemsTotal ? r2((Number(r.revenue || 0) / itemsTotal) * 100) : 0,
  }));

  const waiterRows = safeAll(
    `SELECT COALESCE(NULLIF(trim(o.created_by_user_name), ''), 'Sin mesero') AS name, COUNT(*) AS cnt, IFNULL(SUM(o.total), 0) AS total
     FROM orders o WHERE ${PAID_WHERE} AND ${where}
     GROUP BY name ORDER BY total DESC LIMIT 12`,
    [period.from, period.to],
  );
  const waiters = waiterRows.map((r) => ({
    name: r.name,
    cuentas: Number(r.cnt || 0),
    ventas: r2(r.total),
    ticket: Number(r.cnt) ? r2(Number(r.total) / Number(r.cnt)) : 0,
  }));

  const channels = [...channelMap.entries()].sort((a, b) => b[1] - a[1]).map(([name, v]) => ({ name, value: r2(v) }));

  report.charts = [
    { id: 'daily', type: daily.length > 1 ? 'line' : 'bar', title: byMonth ? 'Ventas por mes' : 'Ventas por día', format: 'money', data: daily.map((d) => ({ name: d.name, value: d.ventas })) },
    { id: 'payments', type: 'pie', title: 'Formas de pago', format: 'money', data: payments.map((p) => ({ name: p.name, value: p.monto })) },
    { id: 'hours', type: 'bar', title: 'Ventas por hora', format: 'money', data: hours.map((h) => ({ name: h.name, value: h.ventas })) },
    { id: 'top', type: 'hbar', title: 'Top 10 productos (S/)', format: 'money', data: top.slice(0, 10).map((t) => ({ name: t.name, value: t.ventas })) },
    ...(channels.length > 1 ? [{ id: 'channels', type: 'pie', title: 'Ventas por canal', format: 'money', data: channels }] : []),
    ...(waiters.length ? [{ id: 'waiters', type: 'bar', title: 'Ventas por mesero', format: 'money', data: waiters.map((w) => ({ name: w.name, value: w.ventas })) }] : []),
  ].filter((c) => c.data.length);

  report.tables = [
    {
      title: byMonth ? 'Ventas por mes' : 'Ventas por día',
      columns: [
        { key: 'fecha', label: byMonth ? 'Mes' : 'Fecha' },
        { key: 'cuentas', label: 'Cuentas', format: 'int' },
        { key: 'ventas', label: 'Ventas', format: 'money' },
        { key: 'ticket', label: 'Ticket prom.', format: 'money' },
      ],
      rows: daily,
      totals: { fecha: 'TOTAL', cuentas: daily.reduce((s, d) => s + d.cuentas, 0), ventas: r2(daily.reduce((s, d) => s + d.ventas, 0)) },
    },
    {
      title: 'Productos más vendidos',
      columns: [
        { key: 'name', label: 'Producto' },
        { key: 'cantidad', label: 'Cantidad', format: 'int' },
        { key: 'ventas', label: 'Ventas', format: 'money' },
        { key: 'participacion', label: '% del total', format: 'pct' },
      ],
      rows: top,
    },
    {
      title: 'Formas de pago',
      columns: [
        { key: 'name', label: 'Método' },
        { key: 'cobros', label: 'Cobros', format: 'int' },
        { key: 'monto', label: 'Monto', format: 'money' },
        { key: 'participacion', label: '%', format: 'pct' },
      ],
      rows: payments,
    },
    {
      title: 'Ventas por mesero',
      columns: [
        { key: 'name', label: 'Mesero' },
        { key: 'cuentas', label: 'Cuentas', format: 'int' },
        { key: 'ventas', label: 'Ventas', format: 'money' },
        { key: 'ticket', label: 'Ticket prom.', format: 'money' },
      ],
      rows: waiters,
    },
    {
      title: 'Ventas por hora',
      columns: [
        { key: 'hora', label: 'Hora' },
        { key: 'cuentas', label: 'Cuentas', format: 'int' },
        { key: 'ventas', label: 'Ventas', format: 'money' },
      ],
      rows: hours,
    },
  ].filter((t) => t.rows.length);

  const insights = [];
  const dSales = deltaPct(cur.sales, before.sales);
  if (dSales != null) insights.push(`Las ventas ${dSales >= 0 ? 'subieron' : 'bajaron'} ${Math.abs(dSales).toFixed(1)}% frente al período anterior (${money(before.sales)}).`);
  const bestDay = [...daily].sort((a, b) => b.ventas - a.ventas)[0];
  if (bestDay?.ventas > 0) insights.push(`Mejor ${byMonth ? 'mes' : 'día'}: ${bestDay.fecha} con ${money(bestDay.ventas)} (${bestDay.cuentas} cuentas).`);
  const peak = [...hours].sort((a, b) => b.ventas - a.ventas)[0];
  if (peak) insights.push(`Hora pico: ${peak.hora} (${money(peak.ventas)}). Asegura personal completo en ese horario.`);
  if (payments[0]) insights.push(`Forma de pago principal: ${payments[0].name} (${pct(payments[0].participacion)} de lo cobrado).`);
  if (top[0]) insights.push(`Producto que más factura: ${top[0].name} (${money(top[0].ventas)}, ${top[0].cantidad} und.).`);
  if (Number(pending.total) > 0) insights.push(`Hay ${money(pending.total)} pendientes de cobro en ${Number(pending.cnt || 0)} cuenta(s).`);
  if (Number(cancelled.cnt) > 0) insights.push(`${Number(cancelled.cnt)} pedido(s) anulados por ${money(cancelled.total)}: revisa los motivos de anulación.`);
  report.insights = insights;
  return report;
}

/* ───────────────────────── Productos ───────────────────────── */

function buildProductsReport(period) {
  const ps = getPaidSalesEventSql();
  const where = rangeWhere(ps);
  const report = baseReport('productos', 'Informe de productos', period);
  const rows = safeAll(
    `SELECT oi.product_name AS name, COALESCE(c.name, 'Sin categoría') AS category,
            SUM(oi.quantity) AS qty, SUM(oi.subtotal) AS revenue
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     LEFT JOIN products p ON p.id = oi.product_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE ${PAID_WHERE} AND ${where}
     GROUP BY oi.product_name, category ORDER BY revenue DESC LIMIT 200`,
    [period.from, period.to],
  );
  const total = rows.reduce((s, r) => s + Number(r.revenue || 0), 0);
  const units = rows.reduce((s, r) => s + Number(r.qty || 0), 0);
  const products = rows.map((r) => ({
    name: r.name,
    categoria: r.category,
    cantidad: Number(r.qty || 0),
    ventas: r2(r.revenue),
    precio_prom: Number(r.qty) ? r2(Number(r.revenue) / Number(r.qty)) : 0,
    participacion: total ? r2((Number(r.revenue || 0) / total) * 100) : 0,
  }));
  const catMap = new Map();
  for (const p of products) {
    const c = catMap.get(p.categoria) || { cantidad: 0, ventas: 0, productos: 0 };
    c.cantidad += p.cantidad;
    c.ventas += p.ventas;
    c.productos += 1;
    catMap.set(p.categoria, c);
  }
  const categories = [...catMap.entries()].sort((a, b) => b[1].ventas - a[1].ventas).map(([name, c]) => ({
    name,
    productos: c.productos,
    cantidad: c.cantidad,
    ventas: r2(c.ventas),
    participacion: total ? r2((c.ventas / total) * 100) : 0,
  }));
  const byQty = [...products].sort((a, b) => b.cantidad - a.cantidad);
  const top10Share = products.slice(0, 10).reduce((s, p) => s + p.participacion, 0);

  report.kpis = [
    { label: 'Ventas de productos', value: r2(total), format: 'money' },
    { label: 'Unidades vendidas', value: units, format: 'int' },
    { label: 'Productos distintos', value: products.length, format: 'int' },
    { label: 'Categorías', value: categories.length, format: 'int' },
    { label: 'Peso del top 10', value: r2(top10Share), format: 'pct' },
  ];
  report.charts = [
    { id: 'rev', type: 'hbar', title: 'Top 10 por ventas (S/)', format: 'money', data: products.slice(0, 10).map((p) => ({ name: p.name, value: p.ventas })) },
    { id: 'qty', type: 'hbar', title: 'Top 10 por unidades', format: 'int', data: byQty.slice(0, 10).map((p) => ({ name: p.name, value: p.cantidad })) },
    { id: 'cat', type: 'pie', title: 'Ventas por categoría', format: 'money', data: categories.map((c) => ({ name: c.name, value: c.ventas })) },
  ].filter((c) => c.data.length);
  report.tables = [
    {
      title: 'Ventas por producto',
      columns: [
        { key: 'name', label: 'Producto' },
        { key: 'categoria', label: 'Categoría' },
        { key: 'cantidad', label: 'Cantidad', format: 'int' },
        { key: 'precio_prom', label: 'Precio prom.', format: 'money' },
        { key: 'ventas', label: 'Ventas', format: 'money' },
        { key: 'participacion', label: '% del total', format: 'pct' },
      ],
      rows: products,
      totals: { name: 'TOTAL', cantidad: units, ventas: r2(total) },
    },
    {
      title: 'Ventas por categoría',
      columns: [
        { key: 'name', label: 'Categoría' },
        { key: 'productos', label: 'Productos', format: 'int' },
        { key: 'cantidad', label: 'Unidades', format: 'int' },
        { key: 'ventas', label: 'Ventas', format: 'money' },
        { key: 'participacion', label: '%', format: 'pct' },
      ],
      rows: categories,
    },
  ].filter((t) => t.rows.length);
  if (products[0]) report.insights.push(`El producto que más factura es ${products[0].name} (${money(products[0].ventas)}, ${pct(products[0].participacion)} del total).`);
  if (byQty[0]) report.insights.push(`El más pedido es ${byQty[0].name} con ${byQty[0].cantidad} unidades.`);
  if (categories[0]) report.insights.push(`La categoría más fuerte es ${categories[0].name} (${pct(categories[0].participacion)} de las ventas).`);
  if (top10Share > 70) report.insights.push(`El top 10 concentra el ${pct(top10Share)} de las ventas: la carta depende de pocos platos; asegura su stock y calidad.`);
  const slow = products.filter((p) => p.cantidad <= 2);
  if (slow.length >= 3) report.insights.push(`${slow.length} productos se vendieron 2 veces o menos: evalúa destacarlos o retirarlos de la carta.`);
  return report;
}

/* ───────────────────────── Clientes ───────────────────────── */

function buildCustomersReport(period) {
  const ps = getPaidSalesEventSql();
  const where = rangeWhere(ps);
  const prev = previousPeriod(period);
  const cur = metricsFromPaidOrdersWhere(where, [period.from, period.to]);
  const before = metricsFromPaidOrdersWhere(where, [prev.from, prev.to]);
  const report = baseReport('clientes', 'Informe de clientes', period);
  const rows = loadPaidOrderRows(ps, period.from, period.to);
  const customers = customerStats(rows);
  const identifiedOrders = customers.reduce((s, c) => s + c.orders, 0);
  const repeat = customers.filter((c) => c.visits >= 2);
  const ticket = cur.orders ? cur.sales / cur.orders : 0;

  const dow = new Map();
  const hour = new Map();
  const channel = new Map();
  for (const r of rows) {
    if (Number.isFinite(r.dow)) {
      const d = dow.get(r.dow) || { cnt: 0, total: 0 };
      d.cnt += 1;
      d.total += Number(r.total || 0);
      dow.set(r.dow, d);
    }
    if (Number.isFinite(r.hour)) hour.set(r.hour, (hour.get(r.hour) || 0) + 1);
    const ch = CHANNEL_LABELS[r.type] || 'Otros';
    channel.set(ch, (channel.get(ch) || 0) + 1);
  }
  const dowRows = [1, 2, 3, 4, 5, 6, 0].map((d) => {
    const v = dow.get(d) || { cnt: 0, total: 0 };
    return { name: WEEKDAY_LABELS[d], cuentas: v.cnt, ventas: r2(v.total), ticket: v.cnt ? r2(v.total / v.cnt) : 0 };
  });
  const hourRows = [...hour.entries()].sort((a, b) => a[0] - b[0]).map(([h, n]) => ({ name: `${String(h).padStart(2, '0')}:00`, cuentas: n }));
  const topCustomers = [...customers].sort((a, b) => b.spend - a.spend).slice(0, 25).map((c) => ({
    name: c.name,
    visitas: c.visits,
    cuentas: c.orders,
    gasto: r2(c.spend),
    ticket: c.orders ? r2(c.spend / c.orders) : 0,
  }));

  report.kpis = [
    { label: 'Cuentas atendidas', value: cur.orders, format: 'int', delta: deltaPct(cur.orders, before.orders) },
    { label: 'Ticket promedio', value: r2(ticket), format: 'money', delta: deltaPct(ticket, before.orders ? before.sales / before.orders : 0) },
    { label: 'Clientes identificados', value: customers.length, format: 'int' },
    { label: '% cuentas identificadas', value: rows.length ? r2((identifiedOrders / rows.length) * 100) : 0, format: 'pct' },
    { label: 'Clientes recurrentes', value: repeat.length, format: 'int' },
  ];
  report.charts = [
    { id: 'dow', type: 'bar', title: 'Cuentas por día de la semana', format: 'int', data: dowRows.map((d) => ({ name: d.name, value: d.cuentas })) },
    { id: 'hour', type: 'bar', title: 'Cuentas por hora', format: 'int', data: hourRows.map((h) => ({ name: h.name, value: h.cuentas })) },
    { id: 'channel', type: 'pie', title: 'Cuentas por canal', format: 'int', data: [...channel.entries()].map(([name, value]) => ({ name, value })) },
    { id: 'top', type: 'hbar', title: 'Top 10 clientes por gasto', format: 'money', data: topCustomers.slice(0, 10).map((c) => ({ name: c.name, value: c.gasto })) },
  ].filter((c) => c.data.length && c.data.some((d) => d.value > 0));
  report.tables = [
    {
      title: 'Mejores clientes',
      columns: [
        { key: 'name', label: 'Cliente' },
        { key: 'visitas', label: 'Visitas', format: 'int' },
        { key: 'cuentas', label: 'Cuentas', format: 'int' },
        { key: 'gasto', label: 'Gasto total', format: 'money' },
        { key: 'ticket', label: 'Ticket prom.', format: 'money' },
      ],
      rows: topCustomers,
    },
    {
      title: 'Clientes por día de la semana',
      columns: [
        { key: 'name', label: 'Día' },
        { key: 'cuentas', label: 'Cuentas', format: 'int' },
        { key: 'ventas', label: 'Ventas', format: 'money' },
        { key: 'ticket', label: 'Ticket prom.', format: 'money' },
      ],
      rows: dowRows,
    },
  ].filter((t) => t.rows.length);
  const busiest = [...dowRows].sort((a, b) => b.cuentas - a.cuentas);
  if (busiest[0]?.cuentas) report.insights.push(`Día con más clientes: ${busiest[0].name} (${busiest[0].cuentas} cuentas); más flojo: ${busiest[busiest.length - 1].name}.`);
  if (rows.length && identifiedOrders / rows.length < 0.3) report.insights.push('Menos del 30 % de cuentas tiene cliente identificado: pide nombre o DNI al cobrar para medir fidelización.');
  if (customers.length >= 5) report.insights.push(`${pct((repeat.length / customers.length) * 100)} de los clientes identificados volvió más de una vez.`);
  if (topCustomers[0]) report.insights.push(`Mejor cliente: ${topCustomers[0].name} (${money(topCustomers[0].gasto)} en ${topCustomers[0].visitas} visita(s)).`);
  return report;
}

/* ───────────────────────── Personal ───────────────────────── */

function buildStaffReport(period) {
  const ps = getPaidSalesEventSql();
  const where = rangeWhere(ps);
  const report = baseReport('personal', 'Informe de personal', period);
  const waiterRows = safeAll(
    `SELECT COALESCE(NULLIF(trim(o.created_by_user_name), ''), 'Sin mesero') AS name, COUNT(*) AS cnt, IFNULL(SUM(o.total), 0) AS total
     FROM orders o WHERE ${PAID_WHERE} AND ${where}
     GROUP BY name ORDER BY total DESC`,
    [period.from, period.to],
  );
  const waiters = waiterRows.map((r) => ({
    name: r.name,
    cuentas: Number(r.cnt || 0),
    ventas: r2(r.total),
    ticket: Number(r.cnt) ? r2(Number(r.total) / Number(r.cnt)) : 0,
  }));
  const localCreated = sqlBusinessTimestamp('e.created_at', queryOne);
  const dispatch = safeAll(
    `SELECT COALESCE(NULLIF(trim(u.full_name), ''), u.username, 'Usuario') AS name,
            COUNT(*) AS cnt,
            AVG(CAST(json_extract(e.meta_json, '$.minutes') AS REAL)) AS avg_min
     FROM user_work_activity_events e
     LEFT JOIN users u ON u.id = e.user_id
     WHERE e.event_type = 'station_ready'
       AND date(${localCreated}) >= date(?) AND date(${localCreated}) <= date(?)
     GROUP BY e.user_id ORDER BY cnt DESC`,
    [period.from, period.to],
  ).map((r) => ({ name: r.name, comandas: Number(r.cnt || 0), minutos: r.avg_min != null ? r2(r.avg_min) : null }));

  const totalSales = waiters.reduce((s, w) => s + w.ventas, 0);
  report.kpis = [
    { label: 'Personal con ventas', value: waiters.length, format: 'int' },
    { label: 'Ventas atribuidas', value: r2(totalSales), format: 'money' },
    { label: 'Comandas despachadas', value: dispatch.reduce((s, d) => s + d.comandas, 0), format: 'int' },
  ];
  report.charts = [
    { id: 'sales', type: 'bar', title: 'Ventas por mesero', format: 'money', data: waiters.slice(0, 12).map((w) => ({ name: w.name, value: w.ventas })) },
    { id: 'accounts', type: 'bar', title: 'Cuentas por mesero', format: 'int', data: waiters.slice(0, 12).map((w) => ({ name: w.name, value: w.cuentas })) },
    ...(dispatch.length ? [{ id: 'dispatch', type: 'bar', title: 'Comandas despachadas (producción)', format: 'int', data: dispatch.slice(0, 12).map((d) => ({ name: d.name, value: d.comandas })) }] : []),
  ].filter((c) => c.data.length);
  report.tables = [
    {
      title: 'Desempeño de meseros',
      columns: [
        { key: 'name', label: 'Mesero' },
        { key: 'cuentas', label: 'Cuentas', format: 'int' },
        { key: 'ventas', label: 'Ventas', format: 'money' },
        { key: 'ticket', label: 'Ticket prom.', format: 'money' },
      ],
      rows: waiters,
    },
    {
      title: 'Producción (comandas despachadas)',
      columns: [
        { key: 'name', label: 'Usuario' },
        { key: 'comandas', label: 'Comandas', format: 'int' },
        { key: 'minutos', label: 'Min. prom. de salida', format: 'number' },
      ],
      rows: dispatch,
    },
  ].filter((t) => t.rows.length);
  if (waiters[0]) report.insights.push(`Mayor venta: ${waiters[0].name} con ${money(waiters[0].ventas)} en ${waiters[0].cuentas} cuentas.`);
  const bestTicket = [...waiters].filter((w) => w.cuentas >= 5).sort((a, b) => b.ticket - a.ticket)[0];
  if (bestTicket) report.insights.push(`Mejor ticket promedio: ${bestTicket.name} (${money(bestTicket.ticket)}); comparte su forma de sugerir platos con el equipo.`);
  const slowest = dispatch.filter((d) => d.minutos != null).sort((a, b) => b.minutos - a.minutos)[0];
  if (slowest && slowest.minutos > 20) report.insights.push(`${slowest.name} tarda en promedio ${slowest.minutos} min en despachar: revisa carga de trabajo o mise en place.`);
  return report;
}

/* ───────────────────────── Costos ───────────────────────── */

function buildCostsReport(period) {
  const ps = getPaidSalesEventSql();
  const where = rangeWhere(ps);
  const report = baseReport('costos', 'Informe de costos y márgenes', period);
  const insumos = safeAll('SELECT id, nombre, unidad_medida, costo_promedio FROM insumos WHERE IFNULL(activo, 1) = 1');
  const insumoById = new Map(insumos.map((i) => [i.id, i]));
  const products = safeAll('SELECT * FROM products WHERE IFNULL(is_active, 1) = 1 AND IFNULL(price, 0) > 0');
  const sold = safeAll(
    `SELECT oi.product_id, SUM(oi.quantity) AS qty FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE ${PAID_WHERE} AND ${where} AND IFNULL(oi.product_id, '') != '' GROUP BY oi.product_id`,
    [period.from, period.to],
  );
  const soldById = new Map(sold.map((r) => [r.product_id, Number(r.qty || 0)]));
  const rows = [];
  const spend = new Map();
  let noCost = 0;
  for (const p of products) {
    const bd = unitCostBreakdown(p, insumoById);
    if (bd.source === 'none' || !(bd.cost > 0)) {
      noCost += 1;
      continue;
    }
    const qty = soldById.get(p.id) || 0;
    const price = Number(p.price || 0);
    rows.push({
      name: p.name,
      origen: bd.source === 'insumos' ? 'Receta' : 'Compra',
      precio: r2(price),
      costo: r2(bd.cost),
      margen: r2(price - bd.cost),
      costo_pct: r2((bd.cost / price) * 100),
      vendidos: qty,
      ganancia: r2((price - bd.cost) * qty),
    });
    for (const part of bd.parts) spend.set(part.name, (spend.get(part.name) || 0) + part.cost * qty);
  }
  const soldRows = rows.filter((r) => r.vendidos > 0);
  const revenue = soldRows.reduce((s, r) => s + r.precio * r.vendidos, 0);
  const cogs = soldRows.reduce((s, r) => s + r.costo * r.vendidos, 0);
  const food = soldRows.filter((r) => r.origen === 'Receta');
  const foodRev = food.reduce((s, r) => s + r.precio * r.vendidos, 0);
  const foodCost = food.reduce((s, r) => s + r.costo * r.vendidos, 0);
  const spendRows = [...spend.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const spendTotal = spendRows.reduce((s, [, v]) => s + v, 0);

  report.kpis = [
    { label: 'Ventas analizadas', value: r2(revenue), format: 'money' },
    { label: 'Costo de lo vendido', value: r2(cogs), format: 'money' },
    { label: 'Margen bruto', value: r2(revenue - cogs), format: 'money' },
    { label: 'Costo / ventas', value: revenue ? r2((cogs / revenue) * 100) : 0, format: 'pct' },
    { label: 'Food cost (platos)', value: foodRev ? r2((foodCost / foodRev) * 100) : 0, format: 'pct' },
    { label: 'Productos sin costo', value: noCost, format: 'int' },
  ];
  const byProfit = [...soldRows].sort((a, b) => b.ganancia - a.ganancia);
  const byCostPct = [...rows].sort((a, b) => b.costo_pct - a.costo_pct);
  report.charts = [
    { id: 'profit', type: 'hbar', title: 'Top 10 por ganancia (S/)', format: 'money', data: byProfit.slice(0, 10).map((r) => ({ name: r.name, value: r.ganancia })) },
    { id: 'costpct', type: 'hbar', title: 'Mayor % de costo', format: 'pct', data: byCostPct.slice(0, 10).map((r) => ({ name: r.name, value: r.costo_pct })) },
    { id: 'spend', type: 'pie', title: 'Gasto por insumo', format: 'money', data: spendRows.slice(0, 8).map(([name, v]) => ({ name, value: r2(v) })) },
  ].filter((c) => c.data.length);
  report.tables = [
    {
      title: 'Costos y márgenes por producto',
      columns: [
        { key: 'name', label: 'Producto' },
        { key: 'origen', label: 'Costo desde' },
        { key: 'precio', label: 'Precio', format: 'money' },
        { key: 'costo', label: 'Costo', format: 'money' },
        { key: 'margen', label: 'Margen unit.', format: 'money' },
        { key: 'costo_pct', label: 'Costo %', format: 'pct' },
        { key: 'vendidos', label: 'Vendidos', format: 'int' },
        { key: 'ganancia', label: 'Ganancia', format: 'money' },
      ],
      rows: [...rows].sort((a, b) => b.ganancia - a.ganancia),
    },
    {
      title: 'Gasto por insumo',
      columns: [
        { key: 'name', label: 'Insumo' },
        { key: 'gasto', label: 'Gasto', format: 'money' },
        { key: 'participacion', label: '%', format: 'pct' },
      ],
      rows: spendRows.map(([name, v]) => ({ name, gasto: r2(v), participacion: spendTotal ? r2((v / spendTotal) * 100) : 0 })),
    },
  ].filter((t) => t.rows.length);
  const fc = foodRev ? (foodCost / foodRev) * 100 : 0;
  if (foodRev) report.insights.push(`Food cost de platos: ${pct(fc)} ${fc > 35 ? '(alto; lo sano es 28–35 %)' : fc < 22 ? '(muy bajo; revisa que las recetas estén completas)' : '(rango sano)'}.`);
  const high = byCostPct.filter((r) => (r.origen === 'Receta' ? r.costo_pct > 38 : r.costo_pct > 75)).slice(0, 3);
  if (high.length) report.insights.push(`Margen bajo en: ${high.map((r) => `${r.name} (${pct(r.costo_pct)})`).join(', ')}. Ajusta precio, porción o proveedor.`);
  if (byProfit[0]) report.insights.push(`Más ganancia: ${byProfit[0].name} (${money(byProfit[0].ganancia)}).`);
  if (spendRows[0]) report.insights.push(`El insumo con más peso en el costo es ${spendRows[0][0]} (${pct((spendRows[0][1] / spendTotal) * 100)}): negociar su precio tiene el mayor impacto.`);
  if (noCost) report.insights.push(`${noCost} producto(s) no tienen costo: vincula receta o precio de compra para un análisis completo.`);
  return report;
}

/* ───────────────────────── Inventario ───────────────────────── */

function buildInventoryReport(period) {
  const report = baseReport('inventario', 'Informe de inventario', period);
  report.subtitle = `Stock al ${displayDateKey(getBusinessTodayDateKey(queryOne))}`;
  const products = safeAll(
    `SELECT p.name, p.stock, p.min_stock, IFNULL(p.purchase_price, 0) AS purchase_price,
            CASE WHEN ${isNonTransformedLowStockSql('p')} THEN 1 ELSE 0 END AS low
     FROM products p
     WHERE IFNULL(p.is_active, 1) = 1 AND p.process_type = 'non_transformed'
     ORDER BY p.name`,
  ).map((p) => ({
    name: p.name,
    stock: Number(p.stock || 0),
    minimo: effectiveMinStock(p.min_stock),
    costo: r2(p.purchase_price),
    valor: r2(Number(p.stock || 0) * Number(p.purchase_price || 0)),
    estado: Number(p.low) ? 'Stock bajo' : 'OK',
  }));
  const insumos = safeAll(
    `SELECT nombre, unidad_medida, stock_actual, stock_minimo, costo_promedio FROM insumos WHERE IFNULL(activo, 1) = 1 ORDER BY nombre`,
  ).map((i) => ({
    name: i.nombre,
    unidad: i.unidad_medida,
    stock: r2(i.stock_actual),
    minimo: r2(i.stock_minimo),
    costo: r2(i.costo_promedio),
    valor: r2(Number(i.stock_actual || 0) * Number(i.costo_promedio || 0)),
    estado: Number(i.stock_minimo) > 0 && Number(i.stock_actual) <= Number(i.stock_minimo) ? 'Stock bajo' : 'OK',
  }));
  const low = products.filter((p) => p.estado !== 'OK');
  const lowIns = insumos.filter((i) => i.estado !== 'OK');
  const valueProducts = products.reduce((s, p) => s + p.valor, 0);
  const valueInsumos = insumos.reduce((s, i) => s + i.valor, 0);
  report.kpis = [
    { label: 'Valor productos', value: r2(valueProducts), format: 'money' },
    { label: 'Valor insumos', value: r2(valueInsumos), format: 'money' },
    { label: 'Productos con stock bajo', value: low.length, format: 'int' },
    { label: 'Insumos con stock bajo', value: lowIns.length, format: 'int' },
  ];
  report.charts = [
    { id: 'low', type: 'bar', title: 'Stock bajo: actual vs mínimo', format: 'int', series: [{ key: 'value', label: 'Stock' }, { key: 'value2', label: 'Mínimo' }], data: low.slice(0, 12).map((p) => ({ name: p.name, value: p.stock, value2: p.minimo })) },
    { id: 'value', type: 'hbar', title: 'Mayor valor en inventario', format: 'money', data: [...products, ...insumos].sort((a, b) => b.valor - a.valor).slice(0, 10).map((x) => ({ name: x.name, value: x.valor })) },
    { id: 'split', type: 'pie', title: 'Valor: productos vs insumos', format: 'money', data: [{ name: 'Productos', value: r2(valueProducts) }, { name: 'Insumos', value: r2(valueInsumos) }].filter((d) => d.value > 0) },
  ].filter((c) => c.data.length && c.data.some((d) => d.value > 0 || d.value2 > 0));
  report.tables = [
    {
      title: 'Productos (stock)',
      columns: [
        { key: 'name', label: 'Producto' },
        { key: 'stock', label: 'Stock', format: 'number' },
        { key: 'minimo', label: 'Mínimo', format: 'number' },
        { key: 'costo', label: 'Costo unit.', format: 'money' },
        { key: 'valor', label: 'Valor', format: 'money' },
        { key: 'estado', label: 'Estado' },
      ],
      rows: [...products].sort((a, b) => (a.estado === b.estado ? b.valor - a.valor : a.estado === 'OK' ? 1 : -1)),
      totals: { name: 'TOTAL', valor: r2(valueProducts) },
    },
    {
      title: 'Insumos (stock)',
      columns: [
        { key: 'name', label: 'Insumo' },
        { key: 'unidad', label: 'Unidad' },
        { key: 'stock', label: 'Stock', format: 'number' },
        { key: 'minimo', label: 'Mínimo', format: 'number' },
        { key: 'costo', label: 'Costo prom.', format: 'money' },
        { key: 'valor', label: 'Valor', format: 'money' },
        { key: 'estado', label: 'Estado' },
      ],
      rows: [...insumos].sort((a, b) => (a.estado === b.estado ? b.valor - a.valor : a.estado === 'OK' ? 1 : -1)),
      totals: { name: 'TOTAL', valor: r2(valueInsumos) },
    },
  ].filter((t) => t.rows.length);
  if (low.length) report.insights.push(`Reponer pronto: ${low.slice(0, 5).map((p) => `${p.name} (${p.stock}/${p.minimo})`).join(', ')}.`);
  if (lowIns.length) report.insights.push(`Insumos bajo mínimo: ${lowIns.slice(0, 5).map((i) => i.name).join(', ')}.`);
  const noCostItems = products.filter((p) => !(p.costo > 0)).length;
  if (noCostItems) report.insights.push(`${noCostItems} producto(s) sin precio de compra: el valor de inventario sale incompleto.`);
  if (!low.length && !lowIns.length) report.insights.push('No hay productos ni insumos por debajo del mínimo.');
  return report;
}

const BUILDERS = {
  ventas: buildSalesReport,
  productos: buildProductsReport,
  clientes: buildCustomersReport,
  personal: buildStaffReport,
  costos: buildCostsReport,
  inventario: buildInventoryReport,
};

function formatValue(v, format) {
  if (format === 'money') return money(v);
  if (format === 'pct') return pct(v);
  if (format === 'int') return String(Math.round(Number(v || 0)));
  return String(v ?? '');
}

function buildReportAnswer(message, user) {
  if (isDownloadOnlyMessage(message)) {
    return {
      reply: 'Primero pídeme el informe, por ejemplo «informe de ventas de este mes» o «reporte de productos de la semana pasada». Luego te pregunto si lo quieres en Excel o PDF.',
      sources: [{ kind: 'tool', title: 'report_hint' }],
    };
  }
  if (!isReportRequest(message)) return null;
  const m = normalizeSpanish(message);
  const type = detectReportType(m);
  const tool = TYPE_TOOL[type];
  if (!canUseTool(user, tool)) {
    return { reply: deniedToolMessage(tool), sources: [{ kind: 'tool', title: 'permission_denied' }] };
  }
  const period = resolvePeriod(message);
  const report = BUILDERS[type](period);

  const lines = [`**${report.title}** — ${report.subtitle}`, ''];
  report.kpis.forEach((k) => {
    const delta = k.delta != null ? ` (${k.delta >= 0 ? '+' : ''}${k.delta.toFixed(1)}% vs período anterior)` : '';
    lines.push(`• ${k.label}: ${formatValue(k.value, k.format)}${delta}`);
  });
  if (report.insights.length) {
    lines.push('', '**Lo más importante**');
    report.insights.forEach((t) => lines.push(`• ${t}`));
  }
  const hasData = report.tables.some((t) => t.rows.length) || report.kpis.some((k) => Number(k.value) > 0);
  if (!hasData) {
    lines.push('', 'No encontré datos para este período. Prueba con otro rango, por ejemplo «informe de ventas del mes pasado».');
  } else {
    lines.push('', `Abajo tienes ${report.charts.length} gráfico(s) y ${report.tables.length} tabla(s) con el detalle.`);
    lines.push('¿Deseas descargar el informe? Elige **Excel** o **PDF** (incluye gráficos y todo el detalle).');
  }
  return {
    reply: lines.join('\n'),
    sources: [{ kind: 'tool', title: 'report', report_type: type, report }],
    options: hasData ? ['Descargar en Excel', 'Descargar en PDF'] : undefined,
  };
}

module.exports = {
  buildReportAnswer,
  isReportRequest,
  isDownloadOnlyMessage,
};
