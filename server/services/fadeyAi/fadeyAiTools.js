/**
 * Herramientas locales del asistente (solo datos de esta instancia).
 */
const { queryAll, queryOne } = require('../../database');
const {
  getPaidSalesEventSql,
  queryPaidSalesOrders,
  metricsFromPaidOrdersWhere,
} = require('../../utils/salesAccountGrouping');
const { getBusinessTodayDateKey, getBusinessMonthKey } = require('../../utils/appDateTime');
const { searchMemory } = require('./fadeyAiKnowledgeService');

function roleLc(user) {
  return String(user?.role || '').toLowerCase();
}

function canSeeFinancials(user) {
  const r = roleLc(user);
  return r === 'admin' || r === 'master_admin' || r === 'cajero';
}

function canSeeHr(user) {
  const r = roleLc(user);
  return r === 'admin' || r === 'master_admin';
}

function canSeeKitchenOps(user) {
  const r = roleLc(user);
  return ['admin', 'master_admin', 'cocina', 'bar', 'produccion', 'cajero', 'mozo'].includes(r);
}

function parseDateKey(input) {
  const s = String(input || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return '';
}

function toolSalesSummary(args = {}, user) {
  if (!canSeeFinancials(user)) {
    return { ok: false, error: 'Tu rol no puede consultar totales de ventas.' };
  }
  const ps = getPaidSalesEventSql();
  const today = getBusinessTodayDateKey(queryOne);
  const month = getBusinessMonthKey(queryOne);
  const from = parseDateKey(args.from) || (args.scope === 'today' ? today : `${month}-01`);
  const to = parseDateKey(args.to) || (args.scope === 'today' ? today : today);
  const parts = [];
  const params = [];
  if (args.scope === 'month' || (!args.from && !args.to && args.scope !== 'today')) {
    parts.push(`${ps.ORDER_MONTH} = ?`);
    params.push(month);
  } else {
    parts.push(`${ps.ORDER_DATE} >= date(?)`);
    params.push(from);
    parts.push(`${ps.ORDER_DATE} <= date(?)`);
    params.push(to);
  }
  const where = parts.join(' AND ');
  const metrics = metricsFromPaidOrdersWhere(where, params);
  return {
    ok: true,
    scope: args.scope || 'range',
    from: args.scope === 'month' ? `${month}-01` : from,
    to: args.scope === 'month' ? today : to,
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
  if (args.scope === 'month') {
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
    date: args.scope === 'month' ? getBusinessMonthKey(queryOne) : day,
    items: rows.map((r) => ({
      name: r.name,
      qty: Number(r.qty || 0),
      ...(showMoney ? { revenue: Number(r.revenue || 0) } : {}),
    })),
  };
}

function toolLowStock(user) {
  if (!canSeeFinancials(user) && !['admin', 'master_admin', 'cajero'].includes(roleLc(user))) {
    return { ok: false, error: 'Tu rol no consulta stock.' };
  }
  const low = queryAll(
    `SELECT name, stock
     FROM products
     WHERE IFNULL(is_active, 1) = 1
       AND IFNULL(stock, 0) <= 10
     ORDER BY stock ASC
     LIMIT 15`
  ) || [];
  return {
    ok: true,
    count: low.length,
    items: low.map((p) => ({
      name: p.name,
      stock: Number(p.stock || 0),
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

function toolSearchGuides(args = {}) {
  const hits = searchMemory(args.query || args.q || '', {
    kinds: ['guide'],
    limit: 3,
  });
  return {
    ok: true,
    hits: hits.map((h) => ({
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
          scope: { type: 'string', enum: ['today', 'month', 'range'] },
          from: { type: 'string', description: 'YYYY-MM-DD' },
          to: { type: 'string', description: 'YYYY-MM-DD' },
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
      lines.push('', `Alertas activas: ${alerts.length}. Revisa Indicadores → Alertas o inventario.`);
    }

    lines.push('', 'También puedes preguntarme por ventas del día, top productos, stock bajo o cómo operar el POS.');
    return { ok: true, text: lines.join('\n'), insights_count: insights.length, alerts_count: alerts.length };
  } catch (err) {
    return { ok: false, error: err.message || 'No se pudo armar el análisis.' };
  }
}

function toolsForUser(user) {
  const r = roleLc(user);
  return TOOL_DEFS.filter((t) => {
    const name = t.function.name;
    if (name === 'sales_summary') return canSeeFinancials(user);
    if (name === 'top_products') return canSeeFinancials(user) || r === 'mozo' || r === 'cocina' || r === 'bar' || r === 'produccion';
    if (name === 'low_stock') return canSeeFinancials(user);
    if (name === 'kitchen_open_orders') return canSeeKitchenOps(user);
    if (name === 'active_staff') return canSeeHr(user);
    if (name === 'business_insights') return canSeeFinancials(user);
    return true;
  });
}

function runTool(name, args, user) {
  switch (String(name || '')) {
    case 'sales_summary':
      return toolSalesSummary(args || {}, user);
    case 'top_products':
      return toolTopProducts(args || {}, user);
    case 'low_stock':
      return toolLowStock(user);
    case 'kitchen_open_orders':
      return toolKitchenDelayed(user);
    case 'active_staff':
      return toolActiveStaff(user);
    case 'search_guides':
      return toolSearchGuides(args || {});
    case 'business_insights':
      return toolBusinessInsights(user);
    default:
      return { ok: false, error: `Herramienta desconocida: ${name}` };
  }
}

module.exports = {
  toolsForUser,
  runTool,
  canSeeFinancials,
  TOOL_DEFS,
};
