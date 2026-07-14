/**
 * Centro de indicadores (módulo Indicadores) — agrega datos reales de todos los módulos operativos.
 */

const { queryAll, queryOne } = require('../database');
const { buildRankings, buildProductivityByUser } = require('./workProductivityService');
const { isNonTransformedLowStockSql } = require('../utils/productStockThreshold');
const { INVENTORY_EXPENSE_PURCHASE_DATE_SQL } = require('../utils/inventoryPurchaseDate');
const {
  getPaidSalesEventSql,
  metricsFromPaidOrdersWhere,
  queryPaidSalesOrders,
  summarizePaymentMethodsByAccount,
  summarizeSalesAccountsByDay,
  groupPaidOrdersBySalesAccount,
  countSalesAccounts,
  sumSalesAccountsByHour,
} = require('../utils/salesAccountGrouping');

const CACHE_TTL_MS = 12000;
const hubCache = new Map();

/** Siempre calificar columnas de `orders` (alias o) para evitar ambigüedad con products en JOINs. */
const O_FIN = "o.status != 'cancelled' AND o.payment_status = 'paid'";
const O_AT = 'COALESCE(o.updated_at, o.created_at)';
const O_LOCAL = `datetime(${O_AT}, 'localtime')`;
const O_DATE = `DATE(${O_LOCAL})`;
const O_MONTH = `strftime('%Y-%m', ${O_LOCAL})`;
const O_HOUR = `strftime('%H', ${O_LOCAL})`;

const FIN = O_FIN;
const SALES_DATE = O_DATE;
const SALES_MONTH = O_MONTH;
const SALES_HOUR = O_HOUR;

function parseDateKey(input) {
  const v = String(input || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
}

function localDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function defaultRange() {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 29);
  return { from: localDateKey(from), to: localDateKey(to) };
}

function orderDateFilter(from, to, params, ps = getPaidSalesEventSql()) {
  const parts = [];
  if (from) {
    parts.push(`${ps.ORDER_DATE} >= date(?)`);
    params.push(from);
  }
  if (to) {
    parts.push(`${ps.ORDER_DATE} <= date(?)`);
    params.push(to);
  }
  return parts.length ? parts.join(' AND ') : '1=1';
}

function getReportsHelpers() {
  return require('../routes/reports');
}

function buildGeneralKpis(from, to) {
  const ps = getPaidSalesEventSql();
  const periodParams = [];
  const periodMetrics = metricsFromPaidOrdersWhere(orderDateFilter(from, to, periodParams, ps), periodParams);
  const todayMetrics = metricsFromPaidOrdersWhere(`${ps.ORDER_DATE} = date('now', 'localtime')`);
  const weekMetrics = metricsFromPaidOrdersWhere(`${ps.ORDER_DATE} >= date('now', 'localtime', '-6 days')`);
  const monthMetrics = metricsFromPaidOrdersWhere(`${ps.ORDER_MONTH} = strftime('%Y-%m', 'now', 'localtime')`);
  const prevMonthRow = queryOne(
    `SELECT COALESCE(SUM(o.total), 0) AS sales FROM orders o
     WHERE ${O_FIN} AND ${ps.ORDER_MONTH} = strftime('%Y-%m', date('now', 'localtime', '-1 month'))`
  );
  const activeOrders = queryOne("SELECT COUNT(*) AS c FROM orders WHERE status IN ('pending','preparing','ready')");
  const salesToday = Number(todayMetrics.sales || 0);
  const paidToday = Number(todayMetrics.orders || 0);
  const salesMonth = Number(monthMetrics.sales || 0);
  const salesPrevMonth = Number(prevMonthRow?.sales || 0);
  const growthPct = salesPrevMonth > 0 ? ((salesMonth - salesPrevMonth) / salesPrevMonth) * 100 : 0;

  const reports = getReportsHelpers();
  const financeMonth = reports.financeMonthToDateSnapshot?.() || {};
  const op = reports.buildOperationalIntelligence?.({ role: 'admin' }) || {};

  const productsSold = queryOne(
    `SELECT COALESCE(SUM(oi.quantity), 0) AS qty FROM order_items oi
     JOIN orders o ON o.id = oi.order_id WHERE ${O_FIN} AND ${ps.ORDER_DATE} = date('now', 'localtime')`
  );
  const reservationsActive = queryOne(
    `SELECT COUNT(*) AS c FROM reservations
     WHERE status IN ('confirmed','pending') AND date >= date('now', 'localtime')`
  );

  const openSessions = queryOne('SELECT COUNT(*) AS c FROM user_work_sessions WHERE logout_at IS NULL');

  return {
    period_sales: Number(periodMetrics.sales || 0),
    period_orders: Number(periodMetrics.orders || 0),
    sales_today: salesToday,
    orders_today: paidToday,
    sales_week: Number(weekMetrics.sales || 0),
    orders_week: Number(weekMetrics.orders || 0),
    sales_month: salesMonth,
    orders_month: Number(monthMetrics.orders || 0),
    net_profit_approx: Number(financeMonth.approx_profit || 0),
    gross_margin_approx: Number(financeMonth.approx_gross_margin || 0),
    operating_expenses: Number(financeMonth.losses_combined_total || 0) + Number(financeMonth.purchases_total || 0),
    total_revenue_month: salesMonth,
    avg_ticket: paidToday > 0 ? salesToday / paidToday : 0,
    active_orders: Number(activeOrders?.c || 0),
    tables_occupied: Number(op.summary?.tablesWithActiveOrders || 0),
    delivery_active: Number(op.summary?.deliveryActiveCount || 0),
    kitchen_preparing: Number(op.summary?.inKitchenCount || 0),
    reservations_active: Number(reservationsActive?.c || 0),
    customers_served_today: paidToday,
    products_sold_today: Number(productsSold?.qty || 0),
    out_of_stock: Number(op.summary?.outOfStockCount || 0),
    critical_stock: Number(op.summary?.lowStockCount || 0),
    growth_month_pct: Math.round(growthPct * 10) / 10,
    register_open: Boolean(op.summary?.registerOpen),
    staff_on_shift: Number(openSessions?.c || 0),
    operating_expenses_period: Number(financeMonth.losses_combined_total || 0) + Number(financeMonth.purchases_total || 0),
  };
}

function buildFinancialSection(from, to) {
  const ps = getPaidSalesEventSql();
  const params = [from, to];
  const dateF = `${ps.ORDER_DATE} BETWEEN date(?) AND date(?)`;
  const salesMetrics = metricsFromPaidOrdersWhere(`${dateF}`, params);
  const periodOrders = queryPaidSalesOrders(`${dateF}`, params);
  const purchases = queryOne(
    `SELECT COALESCE(SUM(total_cost), 0) AS total FROM inventory_expenses
     WHERE ${INVENTORY_EXPENSE_PURCHASE_DATE_SQL} BETWEEN date(?) AND date(?)`,
    params
  );
  const cashExp = queryOne(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM cash_movements
     WHERE type = 'expense' AND date(datetime(created_at, 'localtime')) BETWEEN date(?) AND date(?)`,
    params
  );
  const losses = queryOne(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM finance_loss_events
     WHERE date(datetime(occurred_at, 'localtime')) BETWEEN date(?) AND date(?)`,
    params
  );
  const totalSales = Number(salesMetrics.sales || 0);
  const totalPurchases = Number(purchases?.total || 0);
  const totalExpenses = Number(cashExp?.total || 0) + Number(losses?.total || 0);
  const gross = totalSales - totalPurchases;
  const net = gross - totalExpenses;

  const paymentMethods = summarizePaymentMethodsByAccount(periodOrders);

  const dailyTrend = summarizeSalesAccountsByDay(periodOrders).map((row) => ({
    day: row.date,
    orders: row.orders,
    sales: row.total,
  }));

  const cashFlow = queryOne(
    `SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
            COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense
     FROM cash_movements WHERE date(datetime(created_at, 'localtime')) BETWEEN date(?) AND date(?)`,
    params
  );

  return {
    total_sales: totalSales,
    orders_count: Number(salesMetrics.orders || 0),
    gross_profit_approx: gross,
    net_profit_approx: net,
    margin_pct: totalSales > 0 ? Math.round((net / totalSales) * 1000) / 10 : 0,
    purchases_total: totalPurchases,
    operating_expenses: totalExpenses,
    cash_flow_in: Number(cashFlow?.income || 0),
    cash_flow_out: Number(cashFlow?.expense || 0),
    payment_methods: paymentMethods || [],
    daily_trend: dailyTrend || [],
    sales_efectivo: paymentMethods?.find((p) => p.payment_method === 'efectivo')?.total || 0,
    sales_yape: paymentMethods?.find((p) => p.payment_method === 'yape')?.total || 0,
    sales_tarjeta: paymentMethods?.find((p) => p.payment_method === 'tarjeta')?.total || 0,
    sales_plin: paymentMethods?.find((p) => p.payment_method === 'plin')?.total || 0,
    sales_transferencia: paymentMethods?.find((p) => p.payment_method === 'transferencia')?.total || 0,
    projection_next_7d: projectSalesFromTrend(dailyTrend),
    comparison_prev_period: compareSalesPeriods(from, to),
  };
}

function projectSalesFromTrend(dailyTrend) {
  const rows = dailyTrend || [];
  if (rows.length < 3) return null;
  const last = rows.slice(-7);
  const avg = last.reduce((s, r) => s + Number(r.sales || 0), 0) / last.length;
  return Math.round(avg * 7 * 100) / 100;
}

function compareSalesPeriods(from, to) {
  if (!from || !to) return null;
  const params = [from, to];
  const cur = queryOne(
    `SELECT COALESCE(SUM(o.total), 0) AS s FROM orders o WHERE ${O_FIN} AND ${O_DATE} BETWEEN date(?) AND date(?)`,
    params
  );
  const fromD = new Date(from);
  const toD = new Date(to);
  const days = Math.max(1, Math.round((toD - fromD) / 86400000) + 1);
  const prevTo = new Date(fromD);
  prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevFrom.getDate() - days + 1);
  const pf = localDateKey(prevFrom);
  const pt = localDateKey(prevTo);
  const prev = queryOne(
    `SELECT COALESCE(SUM(o.total), 0) AS s FROM orders o WHERE ${O_FIN} AND ${O_DATE} BETWEEN date(?) AND date(?)`,
    [pf, pt]
  );
  const curS = Number(cur?.s || 0);
  const prevS = Number(prev?.s || 0);
  const pct = prevS > 0 ? Math.round(((curS - prevS) / prevS) * 1000) / 10 : 0;
  return { current: curS, previous: prevS, change_pct: pct };
}

function buildOperationalSection(from, to) {
  const reports = getReportsHelpers();
  const op = reports.buildOperationalIntelligence?.({ role: 'admin' }) || {};
  const kitchenAvg = queryOne(
    `SELECT AVG((julianday(COALESCE(updated_at, created_at)) - julianday(created_at)) * 24 * 60) AS avg_min
     FROM orders WHERE status = 'delivered' AND type != 'delivery'
       AND date(datetime(created_at, 'localtime')) >= date('now', 'localtime', '-7 days')`
  );
  const deliveryAvg = queryOne(
    `SELECT AVG((julianday(delivered_at) - julianday(assigned_at)) * 24 * 60) AS avg_min
     FROM delivery_assignments WHERE status = 'delivered' AND delivered_at IS NOT NULL
       AND date(datetime(assigned_at, 'localtime')) >= date('now', 'localtime', '-7 days')`
  );
  const delayedKitchen = queryOne(
    `SELECT COUNT(*) AS c FROM orders WHERE status IN ('pending','preparing')
     AND (
       (status = 'pending' AND (julianday('now') - julianday(created_at)) * 24 * 60 > 15)
       OR (status = 'preparing' AND (julianday('now') - julianday(COALESCE(preparing_at, updated_at, created_at))) * 24 * 60 > 25)
     )`
  );
  const delayedDelivery = queryOne(
    `SELECT COUNT(*) AS c FROM delivery_assignments WHERE status != 'delivered'
     AND (julianday('now') - julianday(assigned_at)) * 24 * 60 > 35`
  );
  const delParams = [];
  const delFilter = `${O_DATE} >= date(?) AND ${O_DATE} <= date(?)`;
  delParams.push(from, to);
  const deliveredPeriod = queryOne(
    `SELECT COUNT(*) AS c FROM orders o WHERE o.status = 'delivered' AND ${delFilter}`,
    delParams
  );
  const reservationsPeriod = queryOne(
    `SELECT COUNT(*) AS c FROM reservations WHERE status IN ('confirmed','pending','completed')
     AND date BETWEEN date(?) AND date(?)`,
    [from, to]
  );
  const ps = getPaidSalesEventSql();
  const rotParams = [];
  const rotFilter = orderDateFilter(from, to, rotParams, ps);
  const periodPaid = queryPaidSalesOrders(`${rotFilter} AND TRIM(IFNULL(table_number, '')) != ''`, rotParams);
  const mesaAccounts = groupPaidOrdersBySalesAccount(periodPaid).filter(
    (group) => String(group[0]?.type || 'dine_in') === 'dine_in',
  );
  const tables = new Set(
    mesaAccounts.map((group) => String(group[0]?.table_number || '').trim()).filter(Boolean),
  );
  const tableOrders = mesaAccounts.length;

  return {
    summary: op.summary || {},
    alerts: op.operationalAlerts || [],
    insight_today: op.insightToday || '',
    avg_kitchen_minutes: Math.round(Number(kitchenAvg?.avg_min || 0)),
    avg_delivery_minutes: Math.round(Number(deliveryAvg?.avg_min || 0)),
    orders_delayed_kitchen: Number(delayedKitchen?.c || 0),
    orders_delayed_delivery: Number(delayedDelivery?.c || 0),
    orders_delivered_period: Number(deliveredPeriod?.c || 0),
    reservations_period: Number(reservationsPeriod?.c || 0),
    table_rotation_avg: tables.size > 0 ? Math.round((tableOrders / tables.size) * 10) / 10 : 0,
    low_stock: op.lowStock || [],
  };
}

function buildInventorySection(from, to) {
  const critical = queryAll(
    `SELECT id, name, stock, price FROM products
     WHERE is_active = 1 AND ${isNonTransformedLowStockSql()} AND IFNULL(process_type, 'non_transformed') = 'non_transformed'
     ORDER BY stock ASC LIMIT 15`
  );
  const oos = queryAll(
    `SELECT id, name, stock FROM products
     WHERE is_active = 1 AND IFNULL(stock, 0) <= 0 AND IFNULL(process_type, 'non_transformed') = 'non_transformed'
     LIMIT 15`
  );
  const valuation = queryOne(
    `SELECT COALESCE(SUM(stock * COALESCE(price, 0)), 0) AS value FROM products WHERE is_active = 1`
  );
  const consumption = queryOne(
    `SELECT COALESCE(SUM(ABS(quantity_change)), 0) AS qty FROM inventory_logs
     WHERE date(datetime(created_at, 'localtime')) = date('now', 'localtime') AND quantity_change < 0`
  );
  const movements = queryAll(
    `SELECT il.id, p.name AS product_name, il.quantity_change AS quantity, il.reason, il.created_at
     FROM inventory_logs il
     LEFT JOIN products p ON p.id = il.product_id
     WHERE date(datetime(il.created_at, 'localtime')) BETWEEN date(?) AND date(?)
     ORDER BY il.created_at DESC LIMIT 12`,
    [from, to]
  );
  const waste = queryOne(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM finance_loss_events
     WHERE category IN ('waste','desperdicio','merma') AND date(datetime(occurred_at, 'localtime')) BETWEEN date(?) AND date(?)`,
    [from, to]
  );
  return {
    critical_stock: critical || [],
    out_of_stock: oos || [],
    inventory_value: Number(valuation?.value || 0),
    daily_consumption_units: Number(consumption?.qty || 0),
    waste_total: Number(waste?.total || 0),
    recent_movements: movements || [],
    critical_count: critical?.length || 0,
    oos_count: oos?.length || 0,
    stock_prediction_hint: critical?.length >= 2 ? 'Reponer antes del próximo servicio' : 'Stock estable',
  };
}

function buildCustomersSection(from, to) {
  const ps = getPaidSalesEventSql();
  const params = [];
  const od = orderDateFilter(from, to, params, ps);
  const totalCustomers = queryOne('SELECT COUNT(*) AS c FROM customers');
  const newCustomers = queryOne(
    `SELECT COUNT(*) AS c FROM customers
     WHERE date(datetime(created_at, 'localtime')) BETWEEN date(?) AND date(?)`,
    [from, to]
  );
  const periodOrders = queryPaidSalesOrders(od, params).filter(
    (order) => String(order.customer_name || '').trim(),
  );
  const byCustomer = new Map();
  for (const group of groupPaidOrdersBySalesAccount(periodOrders)) {
    const name = String(group[0]?.customer_name || 'Sin nombre').trim() || 'Sin nombre';
    const total = group.reduce((sum, row) => sum + Number(row.total || 0), 0);
    if (!byCustomer.has(name)) byCustomer.set(name, { name, orders: 0, spent: 0 });
    const entry = byCustomer.get(name);
    entry.orders += 1;
    entry.spent += total;
  }
  const frequent = [...byCustomer.values()]
    .map((row) => ({
      ...row,
      avg_ticket: row.orders > 0 ? row.spent / row.orders : 0,
    }))
    .sort((a, b) => b.orders - a.orders)
    .slice(0, 8);
  const vip = [...byCustomer.values()]
    .filter((row) => row.spent >= 200)
    .sort((a, b) => b.spent - a.spent)
    .slice(0, 5);
  const favoriteProducts = queryAll(
    `SELECT oi.product_name, SUM(oi.quantity) AS qty
     FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE ${O_FIN} AND ${od} GROUP BY oi.product_name ORDER BY qty DESC LIMIT 5`,
    params
  );
  return {
    total_registered: Number(totalCustomers?.c || 0),
    new_in_period: Number(newCustomers?.c || 0),
    frequent_buyers: frequent || [],
    vip_clients: vip || [],
    favorite_products: favoriteProducts || [],
  };
}

function buildProductsSection(from, to) {
  const params = [];
  const od = orderDateFilter(from, to, params);
  const top = queryAll(
    `SELECT oi.product_name, SUM(oi.quantity) AS qty, SUM(oi.subtotal) AS revenue
     FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE ${O_FIN} AND ${od} GROUP BY oi.product_name ORDER BY qty DESC LIMIT 10`,
    params
  );
  const bottom = queryAll(
    `SELECT oi.product_name, SUM(oi.quantity) AS qty
     FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE ${O_FIN} AND ${od} GROUP BY oi.product_name HAVING qty > 0 ORDER BY qty ASC LIMIT 8`,
    params
  );
  const profitable = queryAll(
    `SELECT p.name, p.price,
            COALESCE(SUM(oi.subtotal), 0) AS revenue,
            COALESCE(SUM(oi.quantity), 0) AS qty
     FROM products p
     LEFT JOIN order_items oi ON oi.product_id = p.id
     LEFT JOIN orders o ON o.id = oi.order_id AND ${O_FIN} AND ${od}
     WHERE p.is_active = 1
     GROUP BY p.id ORDER BY revenue DESC LIMIT 8`,
    params
  );
  return { top_sellers: top || [], slow_movers: bottom || [], most_profitable: profitable || [] };
}

function buildUnifiedAlerts(payload) {
  const alerts = [...(payload.operational?.alerts || [])];
  const seen = new Set(alerts.map((a) => a.id));

  const push = (a) => {
    if (!a?.id || seen.has(a.id)) return;
    seen.add(a.id);
    alerts.push(a);
  };

  if (payload.inventory?.critical_count >= 3) {
    push({
      id: 'inv-critical',
      severity: 'warning',
      title: 'Stock crítico',
      message: `${payload.inventory.critical_count} productos bajo mínimo`,
    });
  }
  if (payload.inventory?.oos_count > 0) {
    push({
      id: 'inv-oos',
      severity: 'warning',
      title: 'Productos agotados',
      message: `${payload.inventory.oos_count} sin stock`,
    });
  }
  if (payload.operational?.orders_delayed_kitchen > 2) {
    push({
      id: 'kitchen-delay',
      severity: 'warning',
      title: 'Cocina saturada',
      message: `${payload.operational.orders_delayed_kitchen} pedidos con demora`,
    });
  }
  if (payload.operational?.orders_delayed_delivery > 1) {
    push({
      id: 'delivery-delay',
      severity: 'warning',
      title: 'Delivery demorado',
      message: `${payload.operational.orders_delayed_delivery} repartos pendientes`,
    });
  }
  const cmp = payload.financial?.comparison_prev_period;
  if (cmp && cmp.change_pct < -15) {
    push({
      id: 'sales-drop',
      severity: 'warning',
      title: 'Ventas bajas',
      message: `Ventas ${cmp.change_pct}% vs período anterior`,
    });
  }
  if (payload.financial?.margin_pct > 0 && payload.financial.margin_pct < 6) {
    push({
      id: 'low-margin',
      severity: 'info',
      title: 'Margen bajo',
      message: `Margen neto ~${payload.financial.margin_pct}%`,
    });
  }
  const lowProd = (payload.productivity?.by_user || []).filter((u) => u.worked_minutes > 120 && u.productivity_per_hour < 0.5);
  if (lowProd.length >= 2) {
    push({
      id: 'low-productivity',
      severity: 'info',
      title: 'Baja productividad',
      message: `${lowProd.length} colaboradores bajo ritmo esperado`,
    });
  }

  const periodOrders = Number(payload.financial?.orders_count || 0);
  const periodSales = Number(payload.financial?.total_sales || 0);
  if (periodOrders > 0) {
    push({
      id: 'sales-period',
      severity: 'info',
      title: 'Ventas en el período',
      message: `${periodOrders} pedido(s) cobrado(s) · S/ ${periodSales.toFixed(2)} en el rango seleccionado.`,
    });
  } else if (Number(payload.general?.active_orders || 0) > 0) {
    push({
      id: 'orders-unpaid',
      severity: 'warning',
      title: 'Pedidos sin cobrar',
      message: `Hay ${payload.general.active_orders} pedido(s) activo(s). Cobre en Caja para que aparezcan en ventas del período.`,
    });
  } else if (Number(payload.general?.sales_today || 0) > 0 && periodOrders === 0) {
    push({
      id: 'sales-today-hint',
      severity: 'info',
      title: 'Ventas de hoy',
      message: `Hoy hay ventas (S/ ${Number(payload.general.sales_today).toFixed(2)}). Pruebe filtro «Mes» o «Semana» si «Hoy» no coincide por zona horaria.`,
    });
  }

  return alerts.sort((a, b) => (a.severity === 'warning' ? -1 : 1) - (b.severity === 'warning' ? -1 : 1));
}

function buildInsights(data) {
  const insights = [];
  const g = data.general || {};
  const f = data.financial || {};
  const o = data.operational || {};
  const p = data.products?.top_sellers?.[0];
  const profitable = data.products?.most_profitable?.[0];

  if (g.growth_month_pct > 5) {
    insights.push({ priority: 'info', message: `Las ventas del mes crecieron ~${g.growth_month_pct}% respecto al mes anterior.` });
  } else if (g.growth_month_pct < -5) {
    insights.push({ priority: 'medium', message: `Las ventas del mes bajaron ~${Math.abs(g.growth_month_pct)}% vs el mes anterior.` });
  }
  const cmp = f.comparison_prev_period;
  if (cmp?.change_pct > 8) {
    insights.push({ priority: 'info', message: `En el período seleccionado las ventas subieron ${cmp.change_pct}% vs el período anterior.` });
  } else if (cmp?.change_pct < -8) {
    insights.push({ priority: 'medium', message: `Ventas del período bajaron ${Math.abs(cmp.change_pct)}% vs el período anterior.` });
  }
  if (p?.product_name) {
    insights.push({ priority: 'info', message: `El producto más vendido es «${p.product_name}» (${p.qty} unidades).` });
  }
  if (profitable?.name) {
    insights.push({ priority: 'info', message: `«${profitable.name}» aporta mayor ingreso (S/ ${Number(profitable.revenue || 0).toFixed(0)}) en el período.` });
  }
  if (o.insight_today) insights.push({ priority: 'info', message: o.insight_today });
  if (g.delivery_active > g.tables_occupied && g.sales_today > 0) {
    insights.push({ priority: 'medium', message: 'Delivery supera mesas ocupadas; refuerce reparto en horas punta.' });
  }
  const deliveryChannel = data.charts?.sales_by_channel?.find((c) => c.name === 'Delivery');
  const salonChannel = data.charts?.sales_by_channel?.find((c) => c.name === 'Salón');
  if (deliveryChannel && salonChannel && Number(deliveryChannel.total) > Number(salonChannel.total) * 1.2) {
    insights.push({ priority: 'info', message: 'Delivery genera más ingresos que salón en este período — optimice tiempos de despacho.' });
  }
  if (f.margin_pct > 0 && f.margin_pct < 8) {
    insights.push({ priority: 'medium', message: `Margen neto ~${f.margin_pct}% — revise gastos y costos de compra.` });
  }
  if (f.projection_next_7d) {
    insights.push({ priority: 'info', message: `Proyección ventas próximos 7 días: ~S/ ${Number(f.projection_next_7d).toFixed(0)} (tendencia reciente).` });
  }
  const peak = data.charts?.sales_by_hour?.slice().sort((a, b) => b.ventas - a.ventas)[0];
  if (peak?.name) {
    insights.push({ priority: 'info', message: `Hora pico: ${peak.name} — conviene reforzar cocina antes de ese tramo.` });
  }
  const weekendSales = (data.charts?.sales_by_day || []).filter((d) => {
    const day = new Date(d.name);
    const wd = day.getDay();
    return wd === 0 || wd === 6;
  });
  const weekdaySales = (data.charts?.sales_by_day || []).filter((d) => {
    const day = new Date(d.name);
    const wd = day.getDay();
    return wd > 0 && wd < 6;
  });
  const wSum = weekendSales.reduce((s, d) => s + Number(d.ventas || 0), 0);
  const wdSum = weekdaySales.reduce((s, d) => s + Number(d.ventas || 0), 0);
  if (wSum > wdSum * 1.15 && weekendSales.length >= 2) {
    insights.push({ priority: 'info', message: 'Tus ventas aumentan los fines de semana — planifique personal extra.' });
  }
  if (data.inventory?.critical_count >= 3) {
    insights.push({ priority: 'high', message: `${data.inventory.critical_count} producto(s) con stock crítico — reponer antes del servicio.` });
  }
  if (data.inventory?.waste_total > 100) {
    insights.push({ priority: 'medium', message: `Desperdicio registrado S/ ${Number(data.inventory.waste_total).toFixed(0)} en el período.` });
  }
  const rank = data.productivity?.rankings?.best_seller;
  if (rank?.full_name) {
    insights.push({ priority: 'info', message: `${rank.full_name} lidera ventas del equipo.` });
  }
  const topIngredient = data.products?.top_sellers?.[0];
  if (topIngredient?.product_name && /pollo|ceviche|pescado/i.test(topIngredient.product_name)) {
    insights.push({ priority: 'info', message: `Alta rotación de «${topIngredient.product_name}» — verifique consumo en inventario/kardex.` });
  }
  return insights.slice(0, 12);
}

function buildCharts(from, to, productivity) {
  const base = buildChartsData(from, to);
  const prodChart = (productivity?.by_user || []).slice(0, 8).map((u) => ({
    name: String(u.full_name || '').split(' ')[0] || '—',
    productividad: Number(u.productivity_per_hour || 0),
    ventas: Number(u.sales_total || 0),
  }));
  return { ...base, productivity_by_user: prodChart };
}

function buildChartsData(from, to) {
  const ps = getPaidSalesEventSql();
  const params = [];
  const od = orderDateFilter(from, to, params, ps);
  const periodOrders = queryPaidSalesOrders(od, params);
  const byHourMap = sumSalesAccountsByHour(periodOrders);
  const byHour = Object.entries(byHourMap).map(([hour, data]) => ({
    hour,
    orders: data.accounts,
    sales: data.total,
  }));
  const byDay = summarizeSalesAccountsByDay(periodOrders).map((row) => ({
    day: row.date,
    orders: row.orders,
    sales: row.total,
  }));
  const byChannelMap = new Map();
  for (const group of groupPaidOrdersBySalesAccount(periodOrders)) {
    const type = String(group[0]?.type || 'dine_in');
    const total = group.reduce((sum, row) => sum + Number(row.total || 0), 0);
    if (!byChannelMap.has(type)) byChannelMap.set(type, { type, count: 0, total: 0 });
    const entry = byChannelMap.get(type);
    entry.count += 1;
    entry.total += total;
  }
  const byChannel = [...byChannelMap.values()];
  const byMonth = queryAll(
    `SELECT ${ps.ORDER_MONTH} AS month, COALESCE(SUM(o.total), 0) AS sales
     FROM orders o WHERE ${O_FIN} AND ${od} GROUP BY ${ps.ORDER_MONTH} ORDER BY month`,
    params
  );
  return {
    sales_by_hour: (byHour || []).map((r) => ({ name: `${r.hour}:00`, ventas: r.sales, pedidos: r.orders })),
    sales_by_day: (byDay || []).map((r) => ({ name: r.day, ventas: r.sales, pedidos: r.orders })),
    sales_by_channel: (byChannel || []).map((r) => ({
      name: r.type === 'dine_in' ? 'Salón' : r.type === 'delivery' ? 'Delivery' : 'Llevar',
      value: r.count,
      total: r.total,
    })),
    monthly_growth: (byMonth || []).map((r) => ({ name: r.month, ventas: r.sales })),
  };
}

function buildIndicatorsHub(query = {}, opts = {}) {
  const def = defaultRange();
  const from = parseDateKey(query.from) || def.from;
  const to = parseDateKey(query.to) || def.to;
  const cacheKey = `${from}|${to}`;
  if (!opts.skipCache) {
    const hit = hubCache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  }

  let productivity = { by_user: [], rankings: {} };
  try {
    productivity = {
      by_user: buildProductivityByUser(from, to, 'all'),
      rankings: buildRankings(from, to),
    };
  } catch (err) {
    console.error('[indicators-hub] productivity:', err.message);
  }

  const general = buildGeneralKpis(from, to);
  const avgProd = (productivity.by_user || []).filter((u) => u.productivity_per_hour > 0);
  general.productivity_index = avgProd.length
    ? Math.round((avgProd.reduce((s, u) => s + Number(u.productivity_per_hour || 0), 0) / avgProd.length) * 10) / 10
    : 0;

  const financial = buildFinancialSection(from, to);
  const operational = buildOperationalSection(from, to);
  const inventory = buildInventorySection(from, to);
  const customers = buildCustomersSection(from, to);
  const products = buildProductsSection(from, to);
  const charts = buildCharts(from, to, productivity);

  const restaurant = queryOne('SELECT name, currency_symbol FROM restaurants LIMIT 1');

  const payload = {
    filters: { from, to },
    generated_at: new Date().toISOString(),
    export_meta: {
      company: restaurant?.name || 'Resto-FADEY',
      logo_url: restaurant?.logo_url || '',
      currency_symbol: restaurant?.currency_symbol || 'S/',
    },
    general,
    financial,
    operational,
    inventory,
    customers,
    products,
    charts,
    productivity,
    alerts: [],
    insights: [],
  };
  payload.alerts = buildUnifiedAlerts(payload);
  payload.insights = buildInsights(payload);
  if (!opts.skipCache) hubCache.set(cacheKey, { at: Date.now(), data: payload });
  return payload;
}

module.exports = { buildIndicatorsHub, buildGeneralKpis, buildUnifiedAlerts };
