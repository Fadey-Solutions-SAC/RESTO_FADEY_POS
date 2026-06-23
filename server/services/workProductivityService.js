/**
 * Métricas de productividad y monitoreo laboral (Tiempo trabajado).
 * Agrega datos de user_work_sessions, orders, delivery, caja — sin flujos paralelos.
 */

const { queryAll, queryOne } = require('../database');
const { FINANCIAL_FILTER_SQL } = require('../businessRules');
const { closeStaleOpenWorkSessions } = require('./workSessionService');
const { STAFF_IDLE_LOGOUT_MINUTES } = require('../constants/staffSessionPolicy');
const {
  rawWorkedMinutesExpr,
  effectiveWorkedMinutesExpr,
  parseDateKey,
  shiftLabelFromLoginSql,
} = require('../lib/workSessionSql');

const FIN = FINANCIAL_FILTER_SQL;
/** Alertas de inactividad: permiso/día libre no debe disparar aviso por pausas cortas. */
const IDLE_MINUTES_WARN = 24 * 60;
const IDLE_MINUTES_SEVERE = STAFF_IDLE_LOGOUT_MINUTES;
const KITCHEN_SLOW_MIN = 25;
const DELIVERY_SLOW_MIN = 35;
const LONG_SHIFT_MIN = 600;

function sessionDateWhere(alias, from, to, params) {
  const parts = [];
  if (from) {
    parts.push(`date(datetime(${alias}.login_at, 'localtime')) >= date(?)`);
    params.push(from);
  }
  if (to) {
    parts.push(`date(datetime(${alias}.login_at, 'localtime')) <= date(?)`);
    params.push(to);
  }
  return parts.length ? parts.join(' AND ') : '1=1';
}

function orderDateWhere(from, to, params) {
  const parts = [];
  if (from) {
    parts.push("date(datetime(COALESCE(o.updated_at, o.created_at), 'localtime')) >= date(?)");
    params.push(from);
  }
  if (to) {
    parts.push("date(datetime(COALESCE(o.updated_at, o.created_at), 'localtime')) <= date(?)");
    params.push(to);
  }
  return parts.length ? parts.join(' AND ') : '1=1';
}

function idleMinutesExpr(alias = 's') {
  return `CASE
    WHEN ${alias}.logout_at IS NOT NULL THEN 0
    WHEN ${alias}.last_activity_at IS NULL OR trim(${alias}.last_activity_at) = '' THEN (${rawWorkedMinutesExpr(alias)})
    ELSE CAST((julianday('now') - julianday(${alias}.last_activity_at)) * 24 * 60 AS INTEGER)
  END`;
}

function formatIdleDuration(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  if (m >= 1440) {
    const days = Math.floor(m / 1440);
    const hours = Math.floor((m % 1440) / 60);
    if (hours === 0) return `${days} día${days === 1 ? '' : 's'}`;
    return `${days} día${days === 1 ? '' : 's'} y ${hours} h`;
  }
  if (m >= 60) return `${Math.floor(m / 60)} h`;
  return `${m} min`;
}

function activeMinutesExpr(alias = 's') {
  const raw = rawWorkedMinutesExpr(alias);
  const idle = idleMinutesExpr(alias);
  return `MAX(0, (${raw}) - (${idle}))`;
}

function buildLiveDashboard() {
  closeStaleOpenWorkSessions({ minIdleMinutes: IDLE_MINUTES_SEVERE });

  const rawEx = rawWorkedMinutesExpr('s');
  const effEx = effectiveWorkedMinutesExpr('s');
  const activeEx = activeMinutesExpr('s');
  const idleEx = idleMinutesExpr('s');

  const activeStaffRaw = queryAll(
    `SELECT
      s.id AS session_id,
      s.user_id,
      COALESCE(NULLIF(trim(u.full_name), ''), NULLIF(trim(s.full_name), ''), NULLIF(trim(u.username), ''), s.username) AS full_name,
      COALESCE(NULLIF(trim(u.username), ''), s.username) AS username,
      COALESCE(NULLIF(trim(u.role), ''), s.role) AS role,
      s.login_at,
      s.last_activity_at,
      ${shiftLabelFromLoginSql('s')} AS shift_label,
      ${rawEx} AS raw_minutes,
      ${effEx} AS worked_minutes,
      ${activeEx} AS active_minutes,
      ${idleEx} AS idle_minutes
     FROM user_work_sessions s
     INNER JOIN users u ON u.id = s.user_id AND IFNULL(u.is_active, 1) = 1
     WHERE s.logout_at IS NULL
       AND (${idleEx}) < ?
     ORDER BY datetime(s.login_at) ASC`,
    [IDLE_MINUTES_WARN]
  );

  const activeStaffByUser = new Map();
  for (const row of activeStaffRaw || []) {
    const prev = activeStaffByUser.get(row.user_id);
    if (!prev || Number(row.active_minutes || 0) >= Number(prev.active_minutes || 0)) {
      activeStaffByUser.set(row.user_id, row);
    }
  }
  const activeStaff = [...activeStaffByUser.values()];

  const today = new Date().toISOString().split('T')[0];
  const todayStats = queryOne(
    `SELECT
      COUNT(*) AS sessions_today,
      COALESCE(SUM(${effEx}), 0) AS minutes_today
     FROM user_work_sessions s
     LEFT JOIN users u ON u.id = s.user_id
     WHERE date(datetime(s.login_at, 'localtime')) = date(?)`,
    [today]
  );

  const salesToday = queryOne(
    `SELECT COUNT(*) AS orders_paid, COALESCE(SUM(total), 0) AS sales_total
     FROM orders o WHERE ${FIN}
       AND date(datetime(COALESCE(o.updated_at, o.created_at), 'localtime')) = date('now', 'localtime')`
  );

  const inKitchen = queryOne(`SELECT COUNT(*) AS c FROM orders WHERE status = 'preparing'`);
  const deliveryActive = queryOne(
    `SELECT COUNT(*) AS c FROM orders WHERE type = 'delivery' AND status IN ('pending','preparing','ready')`
  );

  return {
    generated_at: new Date().toISOString(),
    active_staff: (activeStaff || []).map((r) => ({
      ...r,
      is_idle: Number(r.idle_minutes || 0) >= IDLE_MINUTES_WARN,
    })),
    today: {
      sessions: Number(todayStats?.sessions_today || 0),
      worked_minutes: Number(todayStats?.minutes_today || 0),
      orders_paid: Number(salesToday?.orders_paid || 0),
      sales_total: Number(salesToday?.sales_total || 0),
    },
    operations: {
      kitchen_preparing: Number(inKitchen?.c || 0),
      delivery_active: Number(deliveryActive?.c || 0),
      staff_online: activeStaff?.length || 0,
    },
  };
}

function buildProductivityByUser(from, to, userId) {
  const params = [];
  const sw = sessionDateWhere('s', from, to, params);
  const userFilter = userId && userId !== 'all' ? ' AND s.user_id = ?' : '';
  if (userId && userId !== 'all') params.push(userId);

  const rawEx = rawWorkedMinutesExpr('s');
  const effEx = effectiveWorkedMinutesExpr('s');
  const activeEx = activeMinutesExpr('s');

  const rows = queryAll(
    `SELECT
      s.user_id,
      COALESCE(NULLIF(u.full_name, ''), s.full_name) AS full_name,
      COALESCE(NULLIF(u.username, ''), s.username) AS username,
      COALESCE(NULLIF(u.role, ''), s.role) AS role,
      COUNT(*) AS sessions_count,
      COALESCE(SUM(${effEx}), 0) AS worked_minutes,
      COALESCE(SUM(${activeEx}), 0) AS active_minutes,
      COALESCE(SUM(${rawEx}), 0) AS raw_minutes,
      COALESCE(SUM(s.pause_minutes), 0) AS pause_minutes
     FROM user_work_sessions s
     LEFT JOIN users u ON u.id = s.user_id
     WHERE ${sw}${userFilter}
     GROUP BY s.user_id, u.full_name, s.full_name, u.username, s.username, u.role, s.role
     ORDER BY worked_minutes DESC`,
    params
  );

  const opParams = [];
  const od = orderDateWhere(from, to, opParams);
  const opUser = userId && userId !== 'all' ? ' AND o.created_by_user_id = ?' : '';
  if (userId && userId !== 'all') opParams.push(userId);

  const orderStats = queryAll(
    `SELECT
      o.created_by_user_id AS user_id,
      COUNT(*) AS orders_created,
      SUM(CASE WHEN ${FIN} THEN 1 ELSE 0 END) AS orders_paid,
      COALESCE(SUM(CASE WHEN ${FIN} THEN o.total ELSE 0 END), 0) AS sales_total,
      AVG(CASE WHEN ${FIN} THEN (julianday(COALESCE(o.updated_at, o.created_at)) - julianday(o.created_at)) * 24 * 60 END) AS avg_order_minutes
     FROM orders o
     WHERE trim(coalesce(o.created_by_user_id, '')) != '' AND ${od}${opUser}
     GROUP BY o.created_by_user_id`,
    opParams
  );
  const orderMap = Object.fromEntries((orderStats || []).map((r) => [r.user_id, r]));

  const delParams = [];
  const delDate = [];
  if (from) {
    delDate.push('date(datetime(da.delivered_at, \'localtime\')) >= date(?)');
    delParams.push(from);
  }
  if (to) {
    delDate.push('date(datetime(da.delivered_at, \'localtime\')) <= date(?)');
    delParams.push(to);
  }
  const delWhere = delDate.length ? delDate.join(' AND ') : '1=1';
  const delUser = userId && userId !== 'all' ? ' AND da.driver_id = ?' : '';
  if (userId && userId !== 'all') delParams.push(userId);

  const deliveryStats = queryAll(
    `SELECT da.driver_id AS user_id,
            COUNT(*) AS deliveries,
            AVG((julianday(da.delivered_at) - julianday(da.assigned_at)) * 24 * 60) AS avg_delivery_minutes
     FROM delivery_assignments da
     WHERE da.status = 'delivered' AND da.delivered_at IS NOT NULL AND ${delWhere}${delUser}
     GROUP BY da.driver_id`,
    delParams
  );
  const delMap = Object.fromEntries((deliveryStats || []).map((r) => [r.user_id, r]));

  return (rows || []).map((r) => {
    const op = orderMap[r.user_id] || {};
    const del = delMap[r.user_id] || {};
    const hours = Math.max(0.25, Number(r.worked_minutes || 0) / 60);
    const productivityScore =
      Number(op.orders_paid || 0) * 10 +
      Number(del.deliveries || 0) * 8 +
      Number(op.sales_total || 0) / 50;
    return {
      ...r,
      orders_created: Number(op.orders_created || 0),
      orders_paid: Number(op.orders_paid || 0),
      sales_total: Number(op.sales_total || 0),
      avg_order_minutes: Math.round(Number(op.avg_order_minutes || 0)),
      deliveries: Number(del.deliveries || 0),
      avg_delivery_minutes: Math.round(Number(del.avg_delivery_minutes || 0)),
      productivity_per_hour: Math.round(productivityScore / hours),
      idle_minutes: Math.max(0, Number(r.raw_minutes || 0) - Number(r.active_minutes || 0)),
    };
  });
}

function buildAreaMetrics(from, to) {
  const op = [];
  const od = orderDateWhere(from, to, op);

  const caja = queryOne(
    `SELECT
      COUNT(DISTINCT cr.id) AS register_sessions,
      COALESCE(SUM(CASE WHEN ${FIN} THEN o.total ELSE 0 END), 0) AS sales_total,
      COUNT(CASE WHEN ${FIN} THEN 1 END) AS tickets_paid,
      AVG(CASE WHEN ${FIN} THEN (julianday(COALESCE(o.updated_at, o.created_at)) - julianday(o.created_at)) * 24 * 60 END) AS avg_checkout_minutes
     FROM orders o
     LEFT JOIN cash_registers cr ON cr.user_id = o.created_by_user_id
       AND datetime(o.created_at) >= datetime(cr.opened_at)
       AND (cr.closed_at IS NULL OR datetime(o.created_at) <= datetime(cr.closed_at))
     WHERE ${od}`,
    op
  );

  const kitchen = queryOne(
    `SELECT
      COUNT(*) AS orders_in_kitchen,
      AVG((julianday(COALESCE(o.updated_at, o.created_at)) - julianday(o.created_at)) * 24 * 60) AS avg_kitchen_minutes,
      SUM(CASE WHEN
        (o.status = 'pending' AND (julianday('now') - julianday(o.created_at)) * 24 * 60 > 15)
        OR (o.status = 'preparing' AND (julianday('now') - julianday(COALESCE(o.preparing_at, o.updated_at, o.created_at))) * 24 * 60 > ?)
      THEN 1 ELSE 0 END) AS delayed_now
     FROM orders o
     WHERE o.status IN ('pending','preparing','ready','delivered') AND o.type != 'delivery' AND ${od}`,
    [...op, KITCHEN_SLOW_MIN]
  );

  const delP = [];
  const delD = [];
  if (from) {
    delD.push('date(datetime(da.assigned_at, \'localtime\')) >= date(?)');
    delP.push(from);
  }
  if (to) {
    delD.push('date(datetime(da.assigned_at, \'localtime\')) <= date(?)');
    delP.push(to);
  }
  const delW = delD.length ? delD.join(' AND ') : '1=1';

  const delivery = queryOne(
    `SELECT
      COUNT(*) AS assignments,
      SUM(CASE WHEN da.status = 'delivered' THEN 1 ELSE 0 END) AS delivered,
      AVG(CASE WHEN da.delivered_at IS NOT NULL THEN (julianday(da.delivered_at) - julianday(da.assigned_at)) * 24 * 60 END) AS avg_delivery_minutes,
      SUM(CASE WHEN da.status != 'delivered' AND (julianday('now') - julianday(da.assigned_at)) * 24 * 60 > ? THEN 1 ELSE 0 END) AS delayed_active
     FROM delivery_assignments da WHERE ${delW}`,
    [...delP, DELIVERY_SLOW_MIN]
  );

  const mesas = queryOne(
    `SELECT
      COUNT(DISTINCT CASE WHEN trim(o.table_number) != '' THEN o.id END) AS table_orders,
      COUNT(DISTINCT trim(o.table_number)) AS tables_touched,
      AVG(CASE WHEN trim(o.table_number) != '' AND ${FIN} THEN (julianday(COALESCE(o.updated_at, o.created_at)) - julianday(o.created_at)) * 24 * 60 END) AS avg_table_minutes
     FROM orders o WHERE IFNULL(o.type,'dine_in') IN ('dine_in','pickup') AND ${od}`,
    op
  );

  return {
    caja: {
      register_sessions: Number(caja?.register_sessions || 0),
      sales_total: Number(caja?.sales_total || 0),
      tickets_paid: Number(caja?.tickets_paid || 0),
      avg_checkout_minutes: Math.round(Number(caja?.avg_checkout_minutes || 0)),
    },
    cocina: {
      orders_tracked: Number(kitchen?.orders_in_kitchen || 0),
      avg_kitchen_minutes: Math.round(Number(kitchen?.avg_kitchen_minutes || 0)),
      delayed_now: Number(kitchen?.delayed_now || 0),
    },
    delivery: {
      assignments: Number(delivery?.assignments || 0),
      delivered: Number(delivery?.delivered || 0),
      avg_delivery_minutes: Math.round(Number(delivery?.avg_delivery_minutes || 0)),
      delayed_active: Number(delivery?.delayed_active || 0),
    },
    mesas: {
      table_orders: Number(mesas?.table_orders || 0),
      tables_touched: Number(mesas?.tables_touched || 0),
      avg_table_minutes: Math.round(Number(mesas?.avg_table_minutes || 0)),
    },
  };
}

function buildRankings(from, to) {
  const productivity = buildProductivityByUser(from, to, 'all');
  const pickTop = (arr, key, label) => {
    const sorted = [...arr].filter((x) => Number(x[key]) > 0).sort((a, b) => Number(b[key]) - Number(a[key]));
    const top = sorted[0];
    return top ? { label, user_id: top.user_id, full_name: top.full_name, value: top[key] } : null;
  };
  const pickMin = (arr, key, label, filterFn = () => true) => {
    const sorted = [...arr].filter(filterFn).filter((x) => Number(x[key]) > 0).sort((a, b) => Number(a[key]) - Number(b[key]));
    const top = sorted[0];
    return top ? { label, user_id: top.user_id, full_name: top.full_name, value: top[key] } : null;
  };

  return {
    best_seller: pickTop(productivity, 'sales_total', 'Mejor ventas (S/)'),
    most_orders: pickTop(productivity, 'orders_paid', 'Más pedidos cobrados'),
    most_productive: pickTop(productivity, 'productivity_per_hour', 'Mayor productividad/hora'),
    fastest_service: pickMin(productivity, 'avg_order_minutes', 'Atención más rápida', (x) => ['cajero', 'mozo', 'admin'].includes(x.role)),
    best_delivery: pickMin(
      productivity.filter((x) => x.role === 'delivery'),
      'avg_delivery_minutes',
      'Delivery más rápido',
      () => true
    ),
    kitchen_role: pickTop(
      productivity.filter((x) => ['cocina', 'bar'].includes(x.role)),
      'worked_minutes',
      'Mayor tiempo operativo cocina/bar'
    ),
  };
}

function buildAlerts() {
  const alerts = [];
  const idleEx = idleMinutesExpr('s');
  const rawEx = rawWorkedMinutesExpr('s');

  const idleUsers = queryAll(
    `SELECT s.user_id, COALESCE(u.full_name, s.full_name) AS full_name, COALESCE(u.role, s.role) AS role,
            ${idleEx} AS idle_minutes, s.login_at
     FROM user_work_sessions s LEFT JOIN users u ON u.id = s.user_id
     WHERE s.logout_at IS NULL AND (${idleEx}) >= ?`,
    [IDLE_MINUTES_WARN]
  );
  (idleUsers || []).forEach((u) => {
    const idleMin = Number(u.idle_minutes) || 0;
    alerts.push({
      id: `idle_${u.user_id}`,
      severity: idleMin >= IDLE_MINUTES_SEVERE ? 'warning' : 'info',
      category: 'inactividad',
      title: 'Usuario inactivo',
      message: `${u.full_name} lleva ${formatIdleDuration(idleMin)} sin actividad en el sistema.`,
    });
  });

  const longShifts = queryAll(
    `SELECT s.user_id, COALESCE(u.full_name, s.full_name) AS full_name, ${rawEx} AS minutes
     FROM user_work_sessions s LEFT JOIN users u ON u.id = s.user_id
     WHERE s.logout_at IS NULL AND (${rawEx}) >= ?`,
    [LONG_SHIFT_MIN]
  );
  (longShifts || []).forEach((u) => {
    alerts.push({
      id: `long_${u.user_id}`,
      severity: 'warning',
      category: 'turno',
      title: 'Jornada prolongada',
      message: `${u.full_name} supera ${Math.floor(LONG_SHIFT_MIN / 60)} h de turno abierto.`,
    });
  });

  const kitchenDelayed = queryOne(
    `SELECT COUNT(*) AS c FROM orders WHERE status IN ('pending','preparing')
     AND (julianday('now') - julianday(created_at)) * 24 * 60 > ?`,
    [KITCHEN_SLOW_MIN]
  );
  if (Number(kitchenDelayed?.c || 0) > 0) {
    alerts.push({
      id: 'kitchen_slow',
      severity: 'warning',
      category: 'cocina',
      title: 'Cocina con retraso',
      message: `${kitchenDelayed.c} pedido(s) superan ${KITCHEN_SLOW_MIN} min en preparación.`,
    });
  }

  const delDelayed = queryOne(
    `SELECT COUNT(*) AS c FROM delivery_assignments
     WHERE status != 'delivered' AND (julianday('now') - julianday(assigned_at)) * 24 * 60 > ?`,
    [DELIVERY_SLOW_MIN]
  );
  if (Number(delDelayed?.c || 0) > 0) {
    alerts.push({
      id: 'delivery_slow',
      severity: 'warning',
      category: 'delivery',
      title: 'Delivery retrasado',
      message: `${delDelayed.c} entrega(s) activas superan ${DELIVERY_SLOW_MIN} min.`,
    });
  }

  const priority = { warning: 0, info: 1 };
  alerts.sort((a, b) => (priority[a.severity] ?? 2) - (priority[b.severity] ?? 2));
  return alerts;
}

function buildInsights(from, to) {
  const insights = [];
  const areas = buildAreaMetrics(from, to);
  const rankings = buildRankings(from, to);
  const productivity = buildProductivityByUser(from, to, 'all');

  if (areas.cocina.delayed_now > 0) {
    insights.push({
      priority: 'high',
      message: `La cocina tiene ${areas.cocina.delayed_now} pedido(s) con retraso superior a ${KITCHEN_SLOW_MIN} minutos.`,
    });
  }
  if (areas.cocina.avg_kitchen_minutes > 20) {
    insights.push({
      priority: 'medium',
      message: `Tiempo promedio en cocina: ${areas.cocina.avg_kitchen_minutes} min en el período seleccionado.`,
    });
  }
  if (rankings.best_seller?.full_name) {
    insights.push({
      priority: 'info',
      message: `${rankings.best_seller.full_name} lidera ventas con S/ ${Number(rankings.best_seller.value).toFixed(2)}.`,
    });
  }
  if (rankings.fastest_service?.full_name) {
    insights.push({
      priority: 'info',
      message: `${rankings.fastest_service.full_name} tiene el mejor tiempo de atención (~${rankings.fastest_service.value} min por pedido).`,
    });
  }

  const shiftParams = [];
  const sw = sessionDateWhere('s', from, to, shiftParams);
  const shiftRows = queryAll(
    `SELECT ${shiftLabelFromLoginSql('s')} AS shift_label,
            COALESCE(SUM(${effectiveWorkedMinutesExpr('s')}), 0) AS minutes
     FROM user_work_sessions s LEFT JOIN users u ON u.id = s.user_id
     WHERE ${sw}
     GROUP BY shift_label ORDER BY minutes ASC`,
    shiftParams
  );
  if (shiftRows?.length >= 2) {
    const low = shiftRows[0];
    insights.push({
      priority: 'medium',
      message: `El turno ${low.shift_label} registra menor tiempo laboral computable en el período.`,
    });
  }

  const peakParams = [];
  const peakOd = orderDateWhere(from, to, peakParams);
  const peak = queryOne(
    `SELECT strftime('%H', datetime(COALESCE(o.updated_at, o.created_at), 'localtime')) AS hour,
            COUNT(*) AS orders
     FROM orders o WHERE ${FIN} AND ${peakOd}
     GROUP BY hour ORDER BY orders DESC LIMIT 1`,
    peakParams
  );
  if (peak?.hour != null) {
    insights.push({
      priority: 'info',
      message: `Hora pico operativa: ${peak.hour}:00 con ${peak.orders} pedido(s) cobrados.`,
    });
  }

  const lowPerformers = productivity.filter((p) => p.worked_minutes > 60 && p.productivity_per_hour < 5);
  if (lowPerformers.length) {
    insights.push({
      priority: 'medium',
      message: `${lowPerformers.length} empleado(s) con baja productividad relativa (muchas horas, poca actividad registrada).`,
    });
  }

  return insights.slice(0, 12);
}

function buildTimeline(from, to, userId) {
  const events = [];
  const sp = [];
  const sw = sessionDateWhere('s', from, to, sp);
  const uf = userId && userId !== 'all' ? ' AND s.user_id = ?' : '';
  if (userId && userId !== 'all') sp.push(userId);

  const sessions = queryAll(
    `SELECT s.id, s.user_id, COALESCE(u.full_name, s.full_name) AS full_name,
            s.login_at, s.logout_at, s.attendance_status,
            ${shiftLabelFromLoginSql('s')} AS shift_label
     FROM user_work_sessions s LEFT JOIN users u ON u.id = s.user_id
     WHERE ${sw}${uf} ORDER BY datetime(s.login_at) DESC LIMIT 80`,
    sp
  );
  (sessions || []).forEach((s) => {
    events.push({
      at: s.login_at,
      type: 'login',
      module: 'sesion',
      label: `Ingreso — ${s.full_name}`,
      meta: { shift: s.shift_label, status: s.attendance_status },
    });
    if (s.logout_at) {
      events.push({
        at: s.logout_at,
        type: 'logout',
        module: 'sesion',
        label: `Salida — ${s.full_name}`,
        meta: {},
      });
    }
  });

  const op = [];
  const od = orderDateWhere(from, to, op);
  const ou = userId && userId !== 'all' ? ' AND o.created_by_user_id = ?' : '';
  if (userId && userId !== 'all') op.push(userId);
  const orders = queryAll(
    `SELECT o.id, o.order_number, o.created_at, o.total, o.status, o.type,
            COALESCE(o.created_by_user_name, '') AS actor_name
     FROM orders o WHERE ${od}${ou} ORDER BY datetime(o.created_at) DESC LIMIT 60`,
    op
  );
  (orders || []).forEach((o) => {
    events.push({
      at: o.created_at,
      type: 'order',
      module: o.type || 'pedido',
      label: `Pedido #${o.order_number || o.id?.slice(0, 8)} — ${o.actor_name || 'sistema'}`,
      meta: { total: o.total, status: o.status },
    });
  });

  events.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return events.slice(0, 120);
}

function buildShiftSummary(from, to) {
  const params = [];
  const sw = sessionDateWhere('s', from, to, params);
  const eff = effectiveWorkedMinutesExpr('s');
  return queryAll(
    `SELECT ${shiftLabelFromLoginSql('s')} AS shift_label,
            COUNT(*) AS sessions,
            COALESCE(SUM(${eff}), 0) AS total_minutes
     FROM user_work_sessions s LEFT JOIN users u ON u.id = s.user_id
     WHERE ${sw}
     GROUP BY shift_label ORDER BY shift_label`,
    params
  );
}

function buildHoursRollup(from, to, userId) {
  const params = [];
  const sw = sessionDateWhere('s', from, to, params);
  const uf = userId && userId !== 'all' ? ' AND s.user_id = ?' : '';
  if (userId && userId !== 'all') params.push(userId);
  const eff = effectiveWorkedMinutesExpr('s');

  const daily = queryAll(
    `SELECT date(datetime(s.login_at, 'localtime')) AS day,
            COALESCE(SUM(${eff}), 0) AS minutes
     FROM user_work_sessions s LEFT JOIN users u ON u.id = s.user_id
     WHERE ${sw}${uf}
     GROUP BY day ORDER BY day DESC LIMIT 31`,
    params
  );

  const weekly = queryOne(
    `SELECT COALESCE(SUM(${eff}), 0) AS minutes FROM user_work_sessions s
     LEFT JOIN users u ON u.id = s.user_id
     WHERE ${sw}${uf}
       AND date(datetime(s.login_at, 'localtime')) >= date('now', 'localtime', '-7 days')`,
    params
  );

  const monthly = queryOne(
    `SELECT COALESCE(SUM(${eff}), 0) AS minutes FROM user_work_sessions s
     LEFT JOIN users u ON u.id = s.user_id
     WHERE ${sw}${uf}
       AND strftime('%Y-%m', datetime(s.login_at, 'localtime')) = strftime('%Y-%m', 'now', 'localtime')`,
    params
  );

  return {
    daily: daily || [],
    weekly_minutes: Number(weekly?.minutes || 0),
    monthly_minutes: Number(monthly?.minutes || 0),
  };
}

function buildAnalyticsBundle(query = {}) {
  const from = parseDateKey(query.from);
  const to = parseDateKey(query.to);
  const userId = String(query.user_id || 'all').trim() || 'all';

  return {
    filters: { from, to, user_id: userId },
    dashboard: buildLiveDashboard(),
    productivity: buildProductivityByUser(from, to, userId),
    areas: buildAreaMetrics(from, to),
    rankings: buildRankings(from, to),
    alerts: buildAlerts(),
    insights: buildInsights(from, to),
    shifts: buildShiftSummary(from, to),
    hours: buildHoursRollup(from, to, userId),
    timeline: buildTimeline(from, to, userId),
  };
}

module.exports = {
  buildAnalyticsBundle,
  buildLiveDashboard,
  buildProductivityByUser,
  buildAreaMetrics,
  buildRankings,
  buildAlerts,
  buildInsights,
  buildTimeline,
  buildShiftSummary,
  buildHoursRollup,
};
