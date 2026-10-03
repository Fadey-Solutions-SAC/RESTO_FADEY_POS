/**
 * Herramientas locales del asistente (solo datos de esta instancia).
 */
const { queryAll, queryOne } = require('../../database');
const {
  getPaidSalesEventSql,
  queryPaidSalesOrders,
  metricsFromPaidOrdersWhere,
  buildOrderAccountKeyMap,
} = require('../../utils/salesAccountGrouping');
const { parsePaymentBreakdown, round2 } = require('../../utils/paymentBreakdown');
const {
  getBusinessTodayDateKey,
  getBusinessMonthKey,
  shiftBusinessDateKey,
  startOfBusinessWeekMonday,
  formatDisplayDateKey,
} = require('../../utils/appDateTime');
const { searchMemory } = require('./fadeyAiKnowledgeService');
const { resolveNaturalPeriod } = require('./fadeyAiDateParse');
const { isNonTransformedLowStockSql, effectiveMinStock } = require('../../utils/productStockThreshold');
const {
  canUseTool,
  deniedToolMessage,
  filterGuideHitsForUser,
  hasAnyModule,
  hasModule,
  isFullAccess,
} = require('./fadeyAiAccess');

function roleLc(user) {
  return String(user?.role || '').toLowerCase();
}

function canSeeFinancials(user) {
  return canUseTool(user, 'sales_summary');
}

function canSeeHr(user) {
  return hasModule(user, 'tiempo_trabajado') || isFullAccess(user);
}

function canSeeKitchenOps(user) {
  return canUseTool(user, 'kitchen_open_orders');
}

function parseDateKey(input) {
  const s = String(input || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return '';
}

/**
 * Resuelve período de ventas desde lenguaje natural.
 * @returns {{ scope: string, from: string, to: string, label: string }}
 */
function resolveSalesPeriod(message, queryOneFn = queryOne, opts = {}) {
  const today = getBusinessTodayDateKey(queryOneFn);
  return resolveNaturalPeriod(message, today, opts);
}

function toolSalesSummary(args = {}, user) {
  if (!canSeeFinancials(user)) {
    return { ok: false, error: 'Tu rol no puede consultar totales de ventas.' };
  }
  const ps = getPaidSalesEventSql();
  const today = getBusinessTodayDateKey(queryOne);
  const month = getBusinessMonthKey(queryOne);
  const scope = String(args.scope || '').toLowerCase();

  let from = parseDateKey(args.from);
  let to = parseDateKey(args.to) || today;
  let label = String(args.label || '').trim();

  if (!from) {
    if (scope === 'today') {
      from = today;
      to = today;
      label = label || 'hoy';
    } else if (scope === 'yesterday') {
      from = shiftBusinessDateKey(today, -1);
      to = from;
      label = label || 'ayer';
    } else if (scope === 'week') {
      from = shiftBusinessDateKey(today, -6);
      to = today;
      label = label || 'última semana (últimos 7 días)';
    } else if (scope === 'month') {
      from = `${month}-01`;
      to = today;
      label = label || 'este mes';
    } else {
      from = today;
      to = today;
      label = label || 'hoy';
    }
  } else if (!label) {
    if (from === to && from === today) label = 'hoy';
    else if (from === to) label = formatDisplayDateKey(from);
    else label = `${formatDisplayDateKey(from)} → ${formatDisplayDateKey(to)}`;
  }

  const parts = [];
  const params = [];
  parts.push(`${ps.ORDER_DATE} >= date(?)`);
  params.push(from);
  parts.push(`${ps.ORDER_DATE} <= date(?)`);
  params.push(to);
  const where = parts.join(' AND ');
  const metrics = metricsFromPaidOrdersWhere(where, params);
  return {
    ok: true,
    scope: scope || 'range',
    from,
    to,
    label,
    month,
    orders: metrics.orders,
    sales: Number(metrics.sales || 0),
    comandas: metrics.comandas,
  };
}

function toolTopProducts(args = {}, user) {
  if (!canSeeFinancials(user) && roleLc(user) !== 'mozo') {
    // mozo puede ver top platos sin montos sensibles
  }
  const showMoney = canSeeFinancials(user);
  const ps = getPaidSalesEventSql();
  const today = getBusinessTodayDateKey(queryOne);
  const day = parseDateKey(args.date) || today;
  const limit = Math.min(20, Math.max(1, Number(args.limit) || 10));
  let dateSql;
  const params = [];
  const rangeFrom = parseDateKey(args.from);
  const rangeTo = parseDateKey(args.to) || rangeFrom;
  if (rangeFrom) {
    dateSql = `${ps.ORDER_DATE} >= date(?) AND ${ps.ORDER_DATE} <= date(?)`;
    params.push(rangeFrom, rangeTo);
  } else if (args.scope === 'month') {
    const month = getBusinessMonthKey(queryOne);
    dateSql = `${ps.ORDER_MONTH} = ?`;
    params.push(month);
  } else {
    dateSql = `${ps.ORDER_DATE} = date(?)`;
    params.push(day);
  }
  params.push(limit);
  const rows = queryAll(
    `SELECT oi.product_name AS name,
            SUM(oi.quantity) AS qty,
            SUM(oi.subtotal) AS revenue
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.status != 'cancelled'
       AND o.payment_status = 'paid'
       AND IFNULL(o.payment_method, '') NOT IN ('cortesia', 'cuenta_cliente')
       AND ${dateSql}
     GROUP BY oi.product_name
     ORDER BY qty DESC
     LIMIT ?`,
    params
  ) || [];
  return {
    ok: true,
    date: rangeFrom || (args.scope === 'month' ? getBusinessMonthKey(queryOne) : day),
    from: rangeFrom || null,
    to: rangeFrom ? rangeTo : null,
    items: rows.map((r) => ({
      name: r.name,
      qty: Number(r.qty || 0),
      ...(showMoney ? { revenue: Number(r.revenue || 0) } : {}),
    })),
  };
}

const PAY_METHOD_LABELS = {
  efectivo: 'Efectivo',
  yape: 'Yape',
  plin: 'Plin',
  tarjeta: 'Tarjeta',
  online: 'Online',
  transferencia: 'Transferencia',
};

function normalizePayMethod(raw) {
  const m = String(raw || '').trim().toLowerCase();
  return m || 'efectivo';
}

function payMethodLabel(method) {
  return PAY_METHOD_LABELS[method] || method;
}

/**
 * Ventas cobradas por método de pago. Las cuentas multimétodo se reparten con el monto
 * exacto de cada método (`payment_breakdown`), no con el método dominante.
 */
function paidSalesByMethod(from, to) {
  const ps = getPaidSalesEventSql();
  const rows = queryPaidSalesOrders(
    `${ps.ORDER_DATE} >= date(?) AND ${ps.ORDER_DATE} <= date(?)`,
    [from, to],
  );
  const accountKey = buildOrderAccountKeyMap(rows);
  const methods = new Map();
  const accounts = new Set();
  const multiAccounts = new Set();
  let total = 0;
  let multiTotal = 0;
  for (const row of rows) {
    const amount = round2(row.total || 0);
    const acc = accountKey.get(String(row.id)) || String(row.id);
    accounts.add(acc);
    total = round2(total + amount);
    const breakdown = parsePaymentBreakdown(row.payment_breakdown);
    if (breakdown) {
      multiAccounts.add(acc);
      multiTotal = round2(multiTotal + amount);
    }
    const parts = breakdown ? Object.entries(breakdown) : [[normalizePayMethod(row.payment_method), amount]];
    for (const [method, amt] of parts) {
      if (!methods.has(method)) methods.set(method, { method, total: 0, accounts: new Set() });
      const entry = methods.get(method);
      entry.total = round2(entry.total + Number(amt || 0));
      entry.accounts.add(acc);
    }
  }
  const list = [...methods.values()]
    .map((e) => ({ method: e.method, label: payMethodLabel(e.method), total: e.total, count: e.accounts.size }))
    .sort((a, b) => b.total - a.total);
  return {
    total,
    accounts: accounts.size,
    methods: list,
    multi: { count: multiAccounts.size, total: multiTotal },
  };
}

function pct(part, whole) {
  return whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '0%';
}

/** Filtro: 'all' | 'efectivo' | 'noncash' | método concreto (yape, plin, tarjeta, online, transferencia). */
function formatMethodSales(data, filter, label) {
  const money = (n) => `S/ ${Number(n || 0).toFixed(2)}`;
  const lines = [];
  if (!data.accounts) {
    lines.push(`**Ventas por método de pago** ${label}`);
    lines.push('No hay cuentas cobradas en ese período.');
    return lines.join('\n');
  }
  const pick = (fn) => data.methods.filter(fn);
  const sumOf = (list) => ({
    total: round2(list.reduce((s, m) => s + m.total, 0)),
    count: list.reduce((s, m) => s + m.count, 0),
  });

  if (filter === 'all') {
    lines.push(`**Ventas por método de pago** ${label}`);
  } else {
    let title;
    let selected;
    if (filter === 'efectivo') {
      title = 'Ventas en efectivo';
      selected = pick((m) => m.method === 'efectivo');
    } else if (filter === 'noncash') {
      title = 'Ventas sin efectivo';
      selected = pick((m) => m.method !== 'efectivo');
    } else {
      title = `Ventas con ${payMethodLabel(filter)}`;
      selected = pick((m) => m.method === filter);
    }
    const s = sumOf(selected);
    lines.push(`**${title}** ${label}: ${money(s.total)} · ${s.count} cuenta(s).`);
    if (filter === 'noncash' && selected.length) {
      selected.forEach((m) => lines.push(`• ${m.label}: ${money(m.total)} · ${m.count} cuenta(s)`));
    }
    lines.push(`Representa el ${pct(s.total, data.total)} del total cobrado (${money(data.total)} · ${data.accounts} cuenta(s)).`);
    lines.push('');
    lines.push('Detalle por método:');
  }
  data.methods.forEach((m) => {
    lines.push(`• ${m.label}: ${money(m.total)} (${pct(m.total, data.total)}) · ${m.count} cuenta(s)`);
  });
  if (filter === 'all') lines.push(`Total cobrado: ${money(data.total)} · ${data.accounts} cuenta(s).`);
  if (data.multi.count) {
    lines.push(`Incluye ${data.multi.count} cuenta(s) multimétodo (${money(data.multi.total)}): cada parte se sumó a su método con el monto exacto.`);
  }
  return lines.join('\n');
}

/** Escritorio de ventas: pendiente, pagos y meseros (datos del módulo Ventas). */
function toolSalesDesk(args = {}, user) {
  if (!canSeeFinancials(user)) {
    return { ok: false, error: 'Tu rol no puede consultar el escritorio de ventas.' };
  }
  const period = resolveSalesPeriod(
    args.message || args.query || '',
    queryOne,
  );
  const focus = String(args.focus || 'full').toLowerCase();
  const today = getBusinessTodayDateKey(queryOne);
  const hasExplicitPeriod = Boolean(period.explicit);
  let from = parseDateKey(args.from) || period.from;
  let to = parseDateKey(args.to) || period.to;
  // Pendiente/pagos/meseros sin período → mes en curso (más útil en el módulo Ventas).
  if (!args.from && !hasExplicitPeriod && ['pending', 'payments', 'method', 'waiters', 'full'].includes(focus)) {
    const month = getBusinessMonthKey(queryOne);
    from = `${month}-01`;
    to = today;
  }
  const range = from === to
    ? formatDisplayDateKey(from)
    : `${formatDisplayDateKey(from)} → ${formatDisplayDateKey(to)}`;
  const periodLabel = hasExplicitPeriod ? (period.label || range) : `este mes (${range})`;

  if (focus === 'method' || focus === 'payments') {
    const filter = focus === 'payments' ? 'all' : String(args.method || 'all').toLowerCase();
    const data = paidSalesByMethod(from, to);
    const label = periodLabel.includes(formatDisplayDateKey(from)) ? `(${periodLabel})` : `(${periodLabel} · ${range})`;
    return {
      ok: true,
      from,
      to,
      label: periodLabel,
      focus,
      method: filter,
      total: data.total,
      accounts: data.accounts,
      payments: data.methods,
      multi: data.multi,
      text: formatMethodSales(data, filter, label),
    };
  }

  const ps = getPaidSalesEventSql();

  const pendingRow = queryOne(
    `SELECT COUNT(*) AS cnt, IFNULL(SUM(o.total), 0) AS total
     FROM orders o
     WHERE o.status != 'cancelled'
       AND o.payment_status = 'pending'
       AND IFNULL(o.payment_method, '') NOT IN ('cortesia', 'cuenta_cliente')
       AND ${ps.ORDER_DATE} >= date(?)
       AND ${ps.ORDER_DATE} <= date(?)`,
    [from, to],
  ) || { cnt: 0, total: 0 };

  const payRows = paidSalesByMethod(from, to).methods;

  const waiterRows = queryAll(
    `SELECT COALESCE(NULLIF(trim(o.created_by_user_name), ''), 'Sin mesero') AS name,
            COUNT(*) AS cnt,
            IFNULL(SUM(o.total), 0) AS total
     FROM orders o
     WHERE o.status != 'cancelled'
       AND o.payment_status = 'paid'
       AND IFNULL(o.payment_method, '') NOT IN ('cortesia', 'cuenta_cliente')
       AND ${ps.ORDER_DATE} >= date(?)
       AND ${ps.ORDER_DATE} <= date(?)
     GROUP BY COALESCE(NULLIF(trim(o.created_by_user_name), ''), 'Sin mesero')
     ORDER BY total DESC
     LIMIT 8`,
    [from, to],
  ) || [];

  const voidRow = queryOne(
    `SELECT COUNT(*) AS cnt
     FROM orders o
     WHERE o.status = 'cancelled'
       AND ${ps.ORDER_DATE} >= date(?)
       AND ${ps.ORDER_DATE} <= date(?)`,
    [from, to],
  ) || { cnt: 0 };

  const paid = metricsFromPaidOrdersWhere(
    `${ps.ORDER_DATE} >= date(?) AND ${ps.ORDER_DATE} <= date(?)`,
    [from, to],
  );

  const lines = [];
  lines.push(`**Escritorio de ventas** (${periodLabel})`);

  if (focus === 'pending' || focus === 'full') {
    lines.push(
      `Pendiente de cobro: S/ ${Number(pendingRow.total || 0).toFixed(2)} · ${Number(pendingRow.cnt || 0)} cuenta(s).`,
    );
  }
  if (focus === 'full') {
    if (payRows.length) {
      lines.push('Formas de pago (cobrado):');
      payRows.forEach((r, i) => {
        lines.push(`${i + 1}. ${r.label}: S/ ${Number(r.total || 0).toFixed(2)} (${r.count} cuenta(s))`);
      });
    } else {
      lines.push('Sin cobros con forma de pago en este período.');
    }
  }
  if (focus === 'waiters' || focus === 'full') {
    if (waiterRows.length) {
      lines.push('Top meseros:');
      waiterRows.slice(0, 5).forEach((r, i) => {
        lines.push(`${i + 1}. ${r.name}: S/ ${Number(r.total || 0).toFixed(2)} (${Number(r.cnt || 0)} cuenta(s))`);
      });
    } else {
      lines.push('Sin ventas por mesero en este período.');
    }
  }
  if (focus === 'full') {
    lines.push(
      `Cobrado: S/ ${Number(paid.sales || 0).toFixed(2)} · ${paid.orders} cuenta(s). Anuladas: ${Number(voidRow.cnt || 0)}.`,
    );
  }

  return {
    ok: true,
    from,
    to,
    label: period.label,
    focus,
    pending: { count: Number(pendingRow.cnt || 0), total: Number(pendingRow.total || 0) },
    payments: payRows,
    waiters: waiterRows.map((r) => ({
      name: r.name,
      count: Number(r.cnt || 0),
      total: Number(r.total || 0),
    })),
    text: lines.join('\n'),
  };
}

function toolLowStock(user) {
  if (!canSeeFinancials(user) && !['admin', 'master_admin', 'cajero'].includes(roleLc(user))) {
    return { ok: false, error: 'Tu rol no consulta stock.' };
  }
  const where = `IFNULL(p.is_active, 1) = 1
       AND p.process_type = 'non_transformed'
       AND ${isNonTransformedLowStockSql('p')}`;
  const total = Number(queryOne(`SELECT COUNT(*) AS n FROM products p WHERE ${where}`)?.n || 0);
  const low = queryAll(
    `SELECT p.name, p.stock, p.min_stock
     FROM products p
     WHERE ${where}
     ORDER BY IFNULL(p.stock, 0) ASC, p.name ASC
     LIMIT 15`
  ) || [];
  return {
    ok: true,
    count: total,
    items: low.map((p) => ({
      name: p.name,
      stock: Number(p.stock || 0),
      min_stock: effectiveMinStock(p.min_stock),
    })),
  };
}

function toolKitchenDelayed(user) {
  if (!canSeeKitchenOps(user)) {
    return { ok: false, error: 'Sin acceso a operación de cocina.' };
  }
  const rows = queryAll(
    `SELECT id, order_number, table_number, type, status, created_at
     FROM orders
     WHERE status IN ('pending', 'preparing')
       AND IFNULL(type, 'dine_in') != 'delivery'
     ORDER BY datetime(created_at) ASC
     LIMIT 20`
  ) || [];
  return {
    ok: true,
    open_count: rows.length,
    orders: rows.map((o) => ({
      id: o.id,
      order_number: o.order_number,
      table: o.table_number,
      type: o.type,
      status: o.status,
      created_at: o.created_at,
    })),
  };
}

function toolActiveStaff(user) {
  if (!canSeeHr(user)) {
    return { ok: false, error: 'Solo administración consulta personal en jornada.' };
  }
  try {
    const { isAsistenciaQrActiva } = require('../hrService');
    if (isAsistenciaQrActiva()) {
      const rows = queryAll(
        `SELECT COALESCE(NULLIF(trim(u.full_name), ''), u.username, e.employee_code) AS name,
                a.check_in_at, COALESCE(u.role, e.position) AS role
         FROM hr_attendance a
         JOIN hr_employees e ON e.id = a.employee_id
         LEFT JOIN users u ON u.id = e.user_id
         WHERE a.check_out_at IS NULL AND a.check_in_at IS NOT NULL
         ORDER BY datetime(a.check_in_at) ASC
         LIMIT 40`
      ) || [];
      return { ok: true, source: 'qr', staff: rows };
    }
  } catch (_) {
    /* fallback */
  }
  const rows = queryAll(
    `SELECT COALESCE(NULLIF(trim(u.full_name), ''), s.full_name, u.username) AS name,
            s.login_at AS check_in_at, COALESCE(u.role, s.role) AS role
     FROM user_work_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.logout_at IS NULL
     ORDER BY datetime(s.login_at) ASC
     LIMIT 40`
  ) || [];
  return { ok: true, source: 'session', staff: rows };
}

function toolSearchGuides(args = {}, user = null) {
  const hits = searchMemory(args.query || args.q || '', {
    kinds: ['guide'],
    limit: 8,
  });
  const allowed = filterGuideHitsForUser(user, hits).slice(0, 3);
  return {
    ok: true,
    hits: allowed.map((h) => ({
      id: h.id,
      kind: h.kind,
      title: h.title,
      body: String(h.body || '').replace(/\n*\(Palabras clave:[\s\S]*$/, '').trim().slice(0, 2500),
      score: h.score,
    })),
  };
}

const TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'sales_summary',
      description: 'Resumen de ventas cobradas del local (hoy, mes o rango de fechas). Solo roles con permiso financiero.',
      parameters: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: ['today', 'yesterday', 'week', 'month', 'range'] },
          from: { type: 'string', description: 'YYYY-MM-DD' },
          to: { type: 'string', description: 'YYYY-MM-DD' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sales_desk',
      description: 'Escritorio del módulo Ventas: pendiente de cobro, ventas por método de pago (efectivo / sin efectivo / Yape…) y ranking de meseros.',
      parameters: {
        type: 'object',
        properties: {
          focus: { type: 'string', enum: ['full', 'pending', 'payments', 'method', 'waiters'] },
          method: { type: 'string', enum: ['all', 'efectivo', 'noncash', 'yape', 'plin', 'tarjeta', 'online', 'transferencia'] },
          message: { type: 'string' },
          from: { type: 'string' },
          to: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'top_products',
      description: 'Platos/productos más vendidos en una fecha o en el mes.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          scope: { type: 'string', enum: ['day', 'month'] },
          limit: { type: 'number' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'low_stock',
      description: 'Productos con stock bajo o agotado.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'kitchen_open_orders',
      description: 'Pedidos abiertos en cocina/bar (pending/preparing).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'active_staff',
      description: 'Personal con jornada abierta ahora.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_guides',
      description: 'Busca guías de cómo operar el sistema y memoria del local.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'business_insights',
      description: 'Análisis del negocio: ventas, recomendaciones, alertas e insights de indicadores.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'customer_insights',
      description: 'Análisis de clientes del período: cuentas, ticket, recurrencia, mejores clientes, días/horas pico y encuestas.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          from: { type: 'string', description: 'YYYY-MM-DD' },
          to: { type: 'string', description: 'YYYY-MM-DD' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cost_insights',
      description: 'Costos de producción, precio de compra e insumos por producto; márgenes e ingeniería de menú con sugerencias.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          from: { type: 'string', description: 'YYYY-MM-DD' },
          to: { type: 'string', description: 'YYYY-MM-DD' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'hr_insights',
      description: 'Datos directos de RRHH/productividad: personal, cocina, demoras, rankings. Usar focus para respuestas puntuales.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'YYYY-MM-DD' },
          to: { type: 'string', description: 'YYYY-MM-DD' },
          focus: { type: 'string', enum: ['full', 'kitchen', 'demoras', 'staff', 'jornada', 'productivity', 'productividad'] },
        },
      },
    },
  },
];

function toolBusinessInsights(user) {
  if (!canSeeFinancials(user)) {
    return { ok: false, error: 'Tu rol no puede consultar el análisis del negocio.' };
  }
  try {
    const { buildIndicatorsHub } = require('../indicatorsHubService');
    const hub = buildIndicatorsHub({});
    const g = hub.general || {};
    const insights = Array.isArray(hub.insights) ? hub.insights : [];
    const alerts = Array.isArray(hub.alerts) ? hub.alerts : [];
    const top = (hub.products?.top_sellers || []).slice(0, 3);
    const lines = [
      '**Análisis del negocio (datos en vivo)**',
      `Ventas hoy: S/ ${Number(g.sales_today || 0).toFixed(2)} · ${g.orders_today || 0} pedido(s).`,
      g.avg_ticket != null ? `Ticket promedio: S/ ${Number(g.avg_ticket || 0).toFixed(2)}.` : null,
      g.growth_month_pct != null ? `Variación vs mes anterior: ${Number(g.growth_month_pct).toFixed(1)}%.` : null,
    ].filter(Boolean);

    if (top.length) {
      lines.push('Productos destacados:');
      top.forEach((p, i) => {
        lines.push(`${i + 1}. ${p.product_name || p.name} (${p.qty} uds${p.revenue != null ? `, S/ ${Number(p.revenue).toFixed(0)}` : ''})`);
      });
    }

    if (insights.length) {
      lines.push('', '**Recomendaciones / insights:**');
      insights.slice(0, 6).forEach((ins, i) => {
        const msg = typeof ins === 'string' ? ins : (ins.message || '');
        if (msg) lines.push(`${i + 1}. ${msg}`);
      });
    }

    if (alerts.length) {
      lines.push('', `Alertas activas: ${alerts.length}.`);
    }

    return { ok: true, text: lines.join('\n'), insights_count: insights.length, alerts_count: alerts.length };
  } catch (err) {
    return { ok: false, error: err.message || 'No se pudo armar el análisis.' };
  }
}

function toolHrInsights(args = {}, user) {
  const focus = String(args.focus || 'full').toLowerCase();
  const kitchenFocus = focus === 'kitchen' || focus === 'demoras';
  if (kitchenFocus) {
    if (!hasAnyModule(user, ['tiempo_trabajado', 'cocina', 'bar', 'produccion']) && !isFullAccess(user)) {
      return { ok: false, error: deniedToolMessage('hr_insights'), denied: true };
    }
  } else if (!canSeeHr(user)) {
    return { ok: false, error: 'Solo quien tiene Recursos humanos puede consultar personal y productividad.', denied: true };
  }
  try {
    const { buildAnalyticsBundle } = require('../workProductivityService');
    const from = parseDateKey(args.from);
    const to = parseDateKey(args.to);
    const hub = buildAnalyticsBundle({
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    });
    const dash = hub.dashboard || {};
    const ops = dash.operations || {};
    const today = dash.today || {};
    const areas = hub.areas || {};
    const rankings = hub.rankings || {};
    const insights = Array.isArray(hub.insights) ? hub.insights : [];
    const alerts = Array.isArray(hub.alerts) ? hub.alerts : [];
    const productivity = Array.isArray(hub.productivity) ? hub.productivity : [];
    const cocina = areas.cocina || {};
    const delayed = Number(cocina.delayed_now || 0);
    const avgMin = cocina.avg_kitchen_minutes;
    const tracked = Number(cocina.orders_tracked || 0);
    const topProd = [...productivity]
      .sort((a, b) => Number(b.productivity_per_hour || 0) - Number(a.productivity_per_hour || 0))
      .slice(0, 3);

    if (kitchenFocus) {
      const text = delayed > 0
        ? `Sí: hay ${delayed} pedido(s) con retraso en cocina ahora. Promedio del período: ${avgMin != null ? `${avgMin} min` : '—'} (${tracked} pedido(s) seguidos).`
        : `No: sin retrasos críticos en cocina ahora. Promedio del período: ${avgMin != null ? `${avgMin} min` : '—'} (${tracked} pedido(s) seguidos).`;
      return {
        ok: true,
        text,
        focus,
        delayed_now: delayed,
        avg_kitchen_minutes: avgMin,
        orders_tracked: tracked,
      };
    }

    if (focus === 'staff' || focus === 'jornada') {
      const n = Number(ops.staff_online || 0);
      return {
        ok: true,
        text: n > 0
          ? `Hay ${n} persona(s) en jornada ahora.`
          : 'Nadie con jornada abierta en este momento.',
        focus,
        staff_online: n,
      };
    }

    if (focus === 'productivity' || focus === 'productividad') {
      const lines = [
        `Productividad del equipo: ${today.orders_paid ?? 0} cuenta(s) hoy · ${Number(today.worked_minutes || 0)} min laborables.`,
      ];
      if (rankings.most_productive?.full_name) {
        lines.push(`Más productivo/h: ${rankings.most_productive.full_name}.`);
      }
      if (topProd.length) {
        lines.push('Top: ' + topProd.map((p) => `${p.full_name} (${p.productivity_per_hour} pts/h)`).join('; ') + '.');
      }
      if (insights.length) {
        const tip = typeof insights[0] === 'string' ? insights[0] : insights[0]?.message;
        if (tip) lines.push(String(tip));
      }
      return { ok: true, text: lines.join(' '), focus };
    }

    const lines = [
      `Personal en jornada ahora: ${ops.staff_online ?? 0}.`,
      `Hoy: ${today.sessions ?? 0} marcación(es) · ${Number(today.worked_minutes || 0)} min · ${today.orders_paid ?? 0} cuenta(s).`,
      `Operación: cocina ${ops.kitchen_preparing ?? 0} · delivery ${ops.delivery_active ?? 0}.`,
    ];

    if (areas.cocina) {
      lines.push(
        `Cocina: ${tracked} pedido(s), promedio ${avgMin ?? 0} min, retrasos ahora ${delayed}.`,
      );
    }
    if (areas.caja) {
      lines.push(
        `Caja: ${areas.caja.tickets_paid ?? 0} cobro(s), ~${areas.caja.avg_checkout_minutes ?? 0} min.`,
      );
    }
    if (rankings.best_seller?.full_name) {
      lines.push(`Más ventas: ${rankings.best_seller.full_name}.`);
    }
    if (rankings.most_productive?.full_name) {
      lines.push(`Más productivo/h: ${rankings.most_productive.full_name}.`);
    }
    if (topProd.length) {
      lines.push('Top productividad: ' + topProd.map((p) => `${p.full_name} (${p.productivity_per_hour} pts/h)`).join('; ') + '.');
    }
    if (insights.length) {
      insights.slice(0, 4).forEach((ins) => {
        const msg = typeof ins === 'string' ? ins : (ins.message || '');
        if (msg) lines.push(`- ${msg}`);
      });
    }
    if (alerts.length) {
      lines.push(`Alertas laborales activas: ${alerts.length}.`);
    }
    return {
      ok: true,
      text: lines.join('\n'),
      focus: 'full',
      insights_count: insights.length,
      alerts_count: alerts.length,
    };
  } catch (err) {
    return { ok: false, error: err.message || 'No se pudo armar el análisis de RRHH.' };
  }
}

function toolsForUser(user) {
  return TOOL_DEFS.filter((t) => canUseTool(user, t.function.name));
}

function runTool(name, args, user) {
  const toolName = String(name || '');
  if (!canUseTool(user, toolName)) {
    return { ok: false, error: deniedToolMessage(toolName), denied: true };
  }
  switch (toolName) {
    case 'sales_summary':
      return toolSalesSummary(args || {}, user);
    case 'sales_desk':
      return toolSalesDesk(args || {}, user);
    case 'top_products':
      return toolTopProducts(args || {}, user);
    case 'low_stock':
      return toolLowStock(user);
    case 'kitchen_open_orders':
      return toolKitchenDelayed(user);
    case 'active_staff':
      return toolActiveStaff(user);
    case 'search_guides':
      return toolSearchGuides(args || {}, user);
    case 'business_insights':
      return toolBusinessInsights(user);
    case 'customer_insights':
      return require('./fadeyAiBusinessAnalysis').toolCustomerInsights(args || {});
    case 'cost_insights':
      return require('./fadeyAiBusinessAnalysis').toolCostInsights(args || {});
    case 'hr_insights':
      return toolHrInsights(args || {}, user);
    default:
      return { ok: false, error: `Herramienta desconocida: ${name}` };
  }
}

module.exports = {
  toolsForUser,
  runTool,
  canSeeFinancials,
  resolveSalesPeriod,
  TOOL_DEFS,
};
