const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, runSql } = require('../database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { FINANCIAL_FILTER_SQL, LOCAL_TODAY_SQL, getLocalTodayDateKey } = require('../businessRules');
const { getEffectiveFlat } = require('../services/businessConfigService');
const { computeOpenStatus } = require('../services/systemConfigHubService');
const {
  queryRegisterSessionSales,
  queryRegisterSessionSalesBetween,
} = require('../services/registerSessionSales');
const { emitStaffDataUpdate } = require('../socketBroadcast');
const { getSlowMovingProductIds } = require('../services/slowMovingProductsService');
const { getReservationCajaOperationalAlerts } = require('../services/reservationSchedulerService');

const router = express.Router();
const FINANCIAL_FILTER = FINANCIAL_FILTER_SQL;
const SALES_EVENT_AT_SQL = 'COALESCE(updated_at, created_at)';
const SALES_EVENT_LOCAL_SQL = `datetime(${SALES_EVENT_AT_SQL}, 'localtime')`;
const SALES_EVENT_DATE_SQL = `DATE(${SALES_EVENT_LOCAL_SQL})`;
const SALES_EVENT_MONTH_SQL = `strftime('%Y-%m', ${SALES_EVENT_LOCAL_SQL})`;
const SALES_EVENT_HOUR_SQL = `strftime('%H', ${SALES_EVENT_LOCAL_SQL})`;
const SALES_EVENT_ORDER_LOCAL_SQL = `datetime(COALESCE(o.updated_at, o.created_at), 'localtime')`;
const SALES_EVENT_ORDER_MONTH_SQL = `strftime('%Y-%m', ${SALES_EVENT_ORDER_LOCAL_SQL})`;
const SALES_EVENT_ORDER_DATE_SQL = `DATE(${SALES_EVENT_ORDER_LOCAL_SQL})`;

/** Solo ítems de inventario (excluye platos de carta con process_type transformado). */
const INVENTORY_PRODUCT_WHERE = "IFNULL(process_type, 'transformed') = 'non_transformed'";

/**
 * Pedido en «listo» que aún debe cerrarse en salón/caja/delivery.
 * Salón/mostrador ya cobrado no cuenta: cocina/bar no lo muestran y no es demora operativa.
 */
const READY_NEEDS_CLOSURE_WHERE = `status = 'ready'
  AND NOT (payment_status = 'paid' AND type IN ('dine_in', 'pickup'))`;

function readBusinessIntelFlat() {
  try {
    return getEffectiveFlat();
  } catch (_) {
    return {};
  }
}

/** Ventas «en vivo»: turno de caja abierto; si no, último turno o día según horario del local. */
function buildLiveSalesPanel(registerOpen) {
  const todayRow = queryOne(
    `SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total FROM orders WHERE ${SALES_EVENT_DATE_SQL} = ${LOCAL_TODAY_SQL} AND ${FINANCIAL_FILTER}`
  );
  const dayTotal = Number(todayRow?.total || 0);
  const dayCount = Number(todayRow?.count || 0);

  let scheduleJson = {};
  try {
    const r = queryOne('SELECT schedule FROM restaurants LIMIT 1');
    scheduleJson = r?.schedule;
  } catch (_) {
    scheduleJson = {};
  }
  const venue = computeOpenStatus(scheduleJson);

  if (registerOpen?.id && registerOpen?.opened_at) {
    const session = queryRegisterSessionSales(registerOpen.opened_at);
    return {
      mode: 'register_open',
      register_open: true,
      venue_open: venue.is_open,
      venue_reason: venue.reason,
      total: session.total_sales,
      count: session.order_count,
      day_total: dayTotal,
      day_count: dayCount,
      session_opened_at: registerOpen.opened_at,
      label: 'Ventas del turno (caja abierta)',
      subtitle: 'Cobradas desde la apertura de caja · en vivo',
    };
  }

  const lastClosed = queryOne(
    `SELECT id, opened_at, closed_at FROM cash_registers
     WHERE closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT 1`
  );
  let lastSession = { total_sales: 0, order_count: 0 };
  if (lastClosed?.opened_at) {
    lastSession = queryRegisterSessionSalesBetween(lastClosed.opened_at, lastClosed.closed_at);
  }

  if (!venue.is_open) {
    return {
      mode: 'venue_closed',
      register_open: false,
      venue_open: false,
      venue_reason: venue.reason,
      venue_hours: venue.hours || null,
      total: dayTotal,
      count: dayCount,
      day_total: dayTotal,
      day_count: dayCount,
      last_session_total: lastSession.total_sales,
      last_session_count: lastSession.order_count,
      last_closed_at: lastClosed?.closed_at || null,
      label: 'Ventas del día',
      subtitle: 'Local fuera de horario · total cobrado hoy (día local)',
    };
  }

  return {
    mode: 'register_closed',
    register_open: false,
    venue_open: true,
    venue_reason: venue.reason,
    total: lastSession.total_sales,
    count: lastSession.order_count,
    day_total: dayTotal,
    day_count: dayCount,
    last_session_total: lastSession.total_sales,
    last_session_count: lastSession.order_count,
    last_closed_at: lastClosed?.closed_at || null,
    label: 'Último turno de caja',
    subtitle: 'Sin caja abierta · cobrado en el último cierre',
  };
}

/**
 * Métricas operativas y alertas en tiempo casi real (mismas tablas que Caja, Mesas, Delivery, inventario, finanzas).
 * Usado por GET /reports/dashboard y GET /reports/operational-alerts (roles admin, cajero, mozo, delivery; maestro pasa por middleware).
 * @param {{ role?: string }} [opts]
 */
function buildOperationalIntelligence(opts = {}) {
  const role = String(opts.role || '');
  const biz = readBusinessIntelFlat();
  const autoAlertsOn = biz.auto_alerts_enabled !== false;
  const stockBizAlertsOn = autoAlertsOn && biz.alert_critical_stock_enabled !== false;
  const marginBizAlertsOn = autoAlertsOn && biz.alert_low_margin_enabled !== false;
  const lossRatioThresholdPct = Math.min(80, Math.max(5, Number(biz.var_tolerance_pct ?? 14)));
  const targetNetMarginPct = Math.min(90, Math.max(1, Number(biz.prof_target_net_margin_pct ?? 12)));
  const slowMovingDays = Math.min(365, Math.max(1, Math.round(Number(biz.auto_slow_moving_days ?? 14))));
  const predHorizonDays = Math.min(180, Math.max(1, Math.round(Number(biz.pred_horizon_days ?? 14))));

  const today = getLocalTodayDateKey();
  const tablesWithActiveOrders = queryOne(
    `SELECT COUNT(DISTINCT TRIM(o.table_number)) as count
     FROM orders o
     WHERE o.status IN ('pending','preparing','ready')
       AND TRIM(IFNULL(o.table_number,'')) != ''
       AND IFNULL(o.type,'dine_in') IN ('dine_in','pickup')`
  );
  const deliveryActive = queryOne(
    `SELECT COUNT(*) as count FROM orders
     WHERE type = 'delivery'
       AND payment_status != 'paid'
       AND status IN ('pending','preparing','ready')`
  );
  const inKitchen = queryOne(`SELECT COUNT(*) as count FROM orders WHERE status = 'preparing'`);
  const registerOpen = queryOne(
    'SELECT id, opened_at, user_id FROM cash_registers WHERE closed_at IS NULL ORDER BY opened_at DESC LIMIT 1'
  );
  const activeOrders = queryOne(
    `SELECT COUNT(*) as count FROM orders WHERE status IN ('pending', 'preparing')
     OR (${READY_NEEDS_CLOSURE_WHERE})`
  );
  const pendingCount = queryOne(`SELECT COUNT(*) as count FROM orders WHERE status = 'pending'`);
  const readyCount = queryOne(`SELECT COUNT(*) as count FROM orders WHERE ${READY_NEEDS_CLOSURE_WHERE}`);
  const staleReady = queryOne(
    `SELECT COUNT(*) as count FROM orders WHERE ${READY_NEEDS_CLOSURE_WHERE}
     AND (julianday('now') - julianday(COALESCE(updated_at, created_at))) * 24 * 60 > 25`
  );
  const lowStock = queryAll(
    `SELECT * FROM products WHERE stock <= 10 AND is_active = 1 AND ${INVENTORY_PRODUCT_WHERE}
     ORDER BY stock ASC LIMIT 10`
  );
  const peakHourToday = queryOne(
    `SELECT ${SALES_EVENT_HOUR_SQL} as hour, COALESCE(SUM(total), 0) as total
     FROM orders
     WHERE ${SALES_EVENT_DATE_SQL} = ${LOCAL_TODAY_SQL} AND ${FINANCIAL_FILTER}
     GROUP BY ${SALES_EVENT_HOUR_SQL}
     ORDER BY total DESC
     LIMIT 1`
  );
  const barPreparingDistinct = queryOne(
    `SELECT COUNT(DISTINCT o.id) as count
     FROM orders o
     WHERE o.status = 'preparing'
       AND EXISTS (
         SELECT 1 FROM order_items oi
         JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = o.id AND IFNULL(p.production_area, 'cocina') = 'bar'
       )`
  );
  const deliveryStaleReady = queryOne(
    `SELECT COUNT(*) as count FROM orders
     WHERE type = 'delivery' AND ${READY_NEEDS_CLOSURE_WHERE}
       AND (julianday('now') - julianday(COALESCE(updated_at, created_at))) * 24 * 60 > 22`
  );
  const outOfStockCount = queryOne(
    `SELECT COUNT(*) as count FROM products
     WHERE is_active = 1 AND IFNULL(stock, 0) <= 0
       AND IFNULL(process_type, 'transformed') = 'non_transformed'`
  );

  const slowMovingData = autoAlertsOn ? getSlowMovingProductIds() : { product_ids: [], products: [], days: slowMovingDays };
  const slowMovingCount = autoAlertsOn ? { count: slowMovingData.product_ids.length } : { count: 0 };

  const operationalAlerts = [];
  const lowN = Number(lowStock?.length || 0);
  if (stockBizAlertsOn && lowN > 0) {
    operationalAlerts.push({
      id: 'stock',
      severity: lowN >= 5 ? 'warning' : 'info',
      title: 'Stock bajo',
      message: `${lowN} producto(s) con stock ≤ 10`,
    });
  }
  const oosN = Number(outOfStockCount?.count || 0);
  if (stockBizAlertsOn && oosN > 0) {
    operationalAlerts.push({
      id: 'stock_agotado',
      severity: oosN >= 3 ? 'warning' : 'info',
      title: 'Productos agotados',
      message: `${oosN} producto(s) de venta con stock 0 (no transformados).`,
      linkTo: '/admin/productos',
      linkLabel: 'Ir a productos',
    });
  }
  const slowN = Number(slowMovingCount?.count || 0);
  if (autoAlertsOn && slowN >= 3) {
    operationalAlerts.push({
      id: 'rotacion_lenta',
      severity: slowN >= 12 ? 'warning' : 'info',
      title: 'Productos con ventas detenidas',
      message: `${slowN} producto(s) con stock y sin ventas cobradas en los últimos ${slowMovingDays} días.`,
      linkTo: '/admin/productos?sin_ventas=1',
      linkLabel: 'Revisar carta / productos',
    });
  }

  const delN = Number(deliveryActive?.count || 0);
  if (delN > 0) {
    operationalAlerts.push({
      id: 'delivery',
      severity: 'info',
      title: 'Delivery activo',
      message: `${delN} pedido(s) pendiente(s) de cobro o en curso`,
    });
  }
  const dStale = Number(deliveryStaleReady?.count || 0);
  if (dStale > 0) {
    operationalAlerts.push({
      id: 'delivery_listo_demora',
      severity: 'warning',
      title: 'Delivery listo con demora',
      message: `${dStale} pedido(s) en «listo» llevan más de 22 minutos sin marcar entrega.`,
      linkTo: role === 'delivery' ? '/delivery' : '/admin/delivery',
      linkLabel: role === 'delivery' ? 'Ir a reparto' : 'Ir a delivery',
    });
  }
  const prepN = Number(inKitchen?.count || 0);
  if (prepN >= 6) {
    operationalAlerts.push({
      id: 'kitchen_load',
      severity: 'warning',
      title: 'Cocina cargada',
      message: `${prepN} pedidos en preparación (cocina y bar combinados).`,
    });
  }
  const barN = Number(barPreparingDistinct?.count || 0);
  if (barN >= 4) {
    operationalAlerts.push({
      id: 'bar_load',
      severity: 'info',
      title: 'Bar con cola',
      message: `${barN} pedido(s) con platos/bebidas de bar aún en preparación.`,
    });
  }
  if (!registerOpen?.id) {
    operationalAlerts.push({
      id: 'caja_cerrada',
      severity: 'warning',
      title: 'Caja cerrada',
      message: 'No hay turno de caja abierto; la caja no registrará ventas hasta la apertura.',
    });
  }
  const readyN = Number(readyCount?.count || 0);
  if (readyN >= 5) {
    operationalAlerts.push({
      id: 'ready_backlog',
      severity: 'warning',
      title: 'Pedidos listos sin retirar',
      message: `${readyN} pedido(s) en estado «listo»; revisar salón, bar o entrega.`,
    });
  }
  const staleN = Number(staleReady?.count || 0);
  if (staleN > 0) {
    operationalAlerts.push({
      id: 'ready_demora',
      severity: 'warning',
      title: 'Demora en pedidos listos',
      message: `${staleN} pedido(s) llevan más de 25 min en «listo» sin cerrar (mesas, delivery o caja). Ya no aparecen en cocina/bar.`,
      linkTo: '/admin/mesas',
      linkLabel: 'Ir a Mesas',
    });
  }
  const pendN = Number(pendingCount?.count || 0);
  if (pendN >= 12) {
    operationalAlerts.push({
      id: 'pending_spike',
      severity: 'warning',
      title: 'Cola de pedidos nuevos',
      message: `${pendN} pedido(s) en «pendiente»; revisar cocina o toma de pedidos.`,
    });
  }
  const actN = Number(activeOrders?.count || 0);
  if (actN >= 25) {
    operationalAlerts.push({
      id: 'active_high',
      severity: 'info',
      title: 'Alto volumen operativo',
      message: `${actN} pedido(s) activos en el sistema.`,
    });
  }

  if (['admin', 'cajero'].includes(role)) {
    const tolerance = getCajaDifferenceToleranceSoles();
    const lastClose = queryOne(
      `SELECT closed_at, arqueo_data FROM cash_registers
       WHERE closed_at IS NOT NULL
         AND datetime(closed_at) >= datetime('now', '-14 days')
       ORDER BY closed_at DESC LIMIT 1`
    );
    if (lastClose?.arqueo_data) {
      const ar = parseArqueoData(lastClose.arqueo_data);
      const diff = Number(ar.difference);
      if (Number.isFinite(diff) && Math.abs(diff) > tolerance) {
        operationalAlerts.push({
          id: 'caja_diferencia',
          severity: Math.abs(diff) > tolerance * 3 ? 'warning' : 'info',
          title: 'Diferencia de caja en el último cierre',
          message: `Último cierre: desvío de S/ ${diff.toFixed(2)} vs esperado (tolerancia S/ ${Number(tolerance).toFixed(2)}).`,
          linkTo: '/admin/caja?view=cierres_caja',
          linkLabel: 'Cierres de caja',
        });
      }
    }

    const billingErr = queryOne(
      `SELECT COUNT(*) as count FROM electronic_documents
       WHERE LOWER(TRIM(IFNULL(provider_status,''))) = 'error'`
    );
    const billN = Number(billingErr?.count || 0);
    if (billN > 0) {
      operationalAlerts.push({
        id: 'billing_errors',
        severity: 'warning',
        title: 'Comprobantes con error',
        message: `${billN} comprobante(s) electrónico(s) en estado error; reintentar o revisar en Informes · Facturación.`,
        linkTo: '/admin/informes?seccion=facturacion',
        linkLabel: 'Abrir facturación',
      });
    }
  }

  if (role === 'admin' || role === 'master_admin') {
    const fw = financeRolling7dSnapshot();
    if (marginBizAlertsOn) {
      const ratioThreshold = lossRatioThresholdPct / 100;
      if (fw.totalSales >= 400 && fw.lossesCombined > 0) {
        const ratio = fw.lossesCombined / fw.totalSales;
        if (ratio >= ratioThreshold) {
          operationalAlerts.push({
            id: 'gastos_ratio',
            severity: ratio >= ratioThreshold * 1.75 ? 'warning' : 'info',
            title: 'Gastos y pérdidas altos (7 días)',
            message: `Ventas cobradas ~S/ ${fw.totalSales.toFixed(0)} vs salidas ~S/ ${fw.lossesCombined.toFixed(0)} (${(ratio * 100).toFixed(0)}% sobre ventas; umbral ${lossRatioThresholdPct}% en módulo empresarial).`,
            linkTo: '/admin/informes?seccion=finanzas',
            linkLabel: 'Informes · Finanzas',
          });
        }
      }
      if (fw.totalSales >= 500 && fw.approxProfit < 0) {
        operationalAlerts.push({
          id: 'rentabilidad_negativa',
          severity: 'warning',
          title: 'Resultado aproximado negativo (7 días)',
          message: 'Ventas menos compras y pérdidas/gastos de caja dan saldo negativo en la ventana reciente.',
          linkTo: '/admin/informes?seccion=finanzas',
          linkLabel: 'Informes · Finanzas',
        });
      } else if (fw.totalSales >= 400 && fw.approxProfit > 0) {
        const netRat = fw.approxProfit / fw.totalSales;
        const targetNet = targetNetMarginPct / 100;
        if (netRat < targetNet) {
          operationalAlerts.push({
            id: 'margen_bajo',
            severity: 'info',
            title: 'Utilidad neta por debajo del objetivo (7 días)',
            message: `Utilidad aproximada ${(100 * netRat).toFixed(1)}% sobre ventas cobradas (objetivo ${targetNetMarginPct}% en módulo empresarial).`,
            linkTo: '/admin/informes?seccion=finanzas',
            linkLabel: 'Informes · Finanzas',
          });
        }
      }
    }
  }

  if (['admin', 'cajero'].includes(role)) {
    const reservationAlerts = getReservationCajaOperationalAlerts();
    reservationAlerts.forEach((alert) => operationalAlerts.push(alert));
  }

  let insightToday = '';
  const ph = peakHourToday?.hour != null ? String(peakHourToday.hour).padStart(2, '0') : '';
  if (ph && Number(peakHourToday?.total || 0) > 0) {
    insightToday = `Mayor facturación hoy entre las ${ph}:00 y ${ph}:59 (ventas cobradas).`;
  }

  const summary = {
    date: today,
    tablesWithActiveOrders: Number(tablesWithActiveOrders?.count || 0),
    deliveryActiveCount: Number(deliveryActive?.count || 0),
    inKitchenCount: Number(inKitchen?.count || 0),
    activeOrders: actN,
    pendingCount: pendN,
    readyCount: readyN,
    staleReadyCount: staleN,
    lowStockCount: lowN,
    outOfStockCount: oosN,
    barPreparingCount: barN,
    deliveryStaleReadyCount: dStale,
    registerOpen: !!registerOpen?.id,
    slowMovingCount: slowN,
  };

  const dashPreset = String(biz.dash_kpi_preset || 'basic').trim();
  const allowedPresets = new Set(['basic', 'operations', 'finance']);
  const dashKpiPreset = allowedPresets.has(dashPreset) ? dashPreset : 'basic';

  return {
    operationalAlerts,
    summary,
    insightToday,
    lowStock,
    registerOpen: registerOpen ? { id: registerOpen.id, opened_at: registerOpen.opened_at, user_id: registerOpen.user_id } : null,
    tablesWithActiveOrders: summary.tablesWithActiveOrders,
    deliveryActiveCount: summary.deliveryActiveCount,
    inKitchenCount: summary.inKitchenCount,
    generated_at: new Date().toISOString(),
    businessIntel: {
      dash_kpi_preset: dashKpiPreset,
      pred_horizon_days: predHorizonDays,
      auto_alerts_enabled: autoAlertsOn,
      alert_critical_stock_enabled: stockBizAlertsOn,
      alert_low_margin_enabled: marginBizAlertsOn,
      auto_slow_moving_days: slowMovingDays,
      loss_ratio_threshold_pct: lossRatioThresholdPct,
      target_net_margin_pct: targetNetMarginPct,
      show_stock_alert_panel: autoAlertsOn && biz.alert_critical_stock_enabled !== false,
    },
  };
}

function parseArqueoData(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

function parsePagosSistemaSettings() {
  const row = queryOne('SELECT value FROM app_settings WHERE key = ?', ['pagos_sistema']);
  try {
    return row?.value ? JSON.parse(row.value) : {};
  } catch (_) {
    return {};
  }
}

function getCajaDifferenceToleranceSoles() {
  const p = parsePagosSistemaSettings();
  const t = Number(p.tolerancia_diferencia_caja);
  if (Number.isFinite(t) && t >= 0) return t;
  return 2;
}

/** Ventas y costos aproximados últimos 7 días (alineado con la lógica de finance-overview). */
function financeRolling7dSnapshot() {
  const dateSales = SALES_EVENT_DATE_SQL;
  const salesRow = queryOne(
    `SELECT COALESCE(SUM(total), 0) as total_sales FROM orders WHERE ${FINANCIAL_FILTER} AND ${dateSales} >= date('now', 'localtime', '-6 days')`
  );
  const cashExpensesRow = queryOne(
    `SELECT COALESCE(SUM(amount), 0) as total FROM cash_movements
     WHERE type = 'expense' AND date(datetime(created_at, 'localtime')) >= date('now', 'localtime', '-6 days')`
  );
  const lossEventsRow = queryOne(
    `SELECT COALESCE(SUM(amount), 0) as total FROM finance_loss_events
     WHERE date(datetime(occurred_at, 'localtime')) >= date('now', 'localtime', '-6 days')`
  );
  const purchasesRow = queryOne(
    `SELECT COALESCE(SUM(total_cost), 0) as total FROM inventory_expenses
     WHERE date(datetime(created_at, 'localtime')) >= date('now', 'localtime', '-6 days')`
  );
  const totalSales = Number(salesRow?.total_sales || 0);
  const cashExpenses = Number(cashExpensesRow?.total || 0);
  const lossEventsTotal = Number(lossEventsRow?.total || 0);
  const totalPurchases = Number(purchasesRow?.total || 0);
  const lossesCombined = lossEventsTotal + cashExpenses;
  const approxProfit = totalSales - totalPurchases - lossesCombined;
  return { totalSales, lossesCombined, approxProfit, totalPurchases };
}

/** Mes calendario en curso: ventas cobradas, compras, salidas y utilidad aprox. (base Informes · Finanzas). */
function financeMonthToDateSnapshot() {
  const monthSalesRow = queryOne(
    `SELECT COALESCE(SUM(total), 0) as total_sales, COUNT(*) as orders FROM orders WHERE ${FINANCIAL_FILTER} AND ${SALES_EVENT_MONTH_SQL} = strftime('%Y-%m', 'now', 'localtime')`
  );
  const purchasesRow = queryOne(
    `SELECT COALESCE(SUM(total_cost), 0) as total FROM inventory_expenses
     WHERE strftime('%Y-%m', datetime(created_at, 'localtime')) = strftime('%Y-%m', 'now', 'localtime')`
  );
  const cashExpensesRow = queryOne(
    `SELECT COALESCE(SUM(amount), 0) as total FROM cash_movements
     WHERE type = 'expense' AND strftime('%Y-%m', datetime(created_at, 'localtime')) = strftime('%Y-%m', 'now', 'localtime')`
  );
  const lossEventsRow = queryOne(
    `SELECT COALESCE(SUM(amount), 0) as total FROM finance_loss_events
     WHERE strftime('%Y-%m', datetime(occurred_at, 'localtime')) = strftime('%Y-%m', 'now', 'localtime')`
  );
  const ymRow = queryOne(`SELECT strftime('%Y-%m', 'now', 'localtime') as ym`);
  const totalSales = Number(monthSalesRow?.total_sales || 0);
  const totalPurchases = Number(purchasesRow?.total || 0);
  const cashExpenses = Number(cashExpensesRow?.total || 0);
  const lossEventsTotal = Number(lossEventsRow?.total || 0);
  const lossesCombined = lossEventsTotal + cashExpenses;
  const approxGrossMargin = totalSales - totalPurchases;
  const approxProfit = totalSales - totalPurchases - lossesCombined;
  return {
    month_key: String(ymRow?.ym || ''),
    sales_total: totalSales,
    orders_count: Number(monthSalesRow?.orders || 0),
    purchases_total: totalPurchases,
    loss_events_total: lossEventsTotal,
    cash_expenses_total: cashExpenses,
    losses_combined_total: lossesCombined,
    approx_gross_margin: approxGrossMargin,
    approx_profit: approxProfit,
  };
}

router.get('/dashboard', authenticateToken, requireRole('admin', 'cajero'), (req, res) => {
  const today = getLocalTodayDateKey();
  const todaySales = queryOne(
    `SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total FROM orders WHERE ${SALES_EVENT_DATE_SQL} = ${LOCAL_TODAY_SQL} AND ${FINANCIAL_FILTER}`
  );
  const monthSales = queryOne(`SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total FROM orders WHERE ${SALES_EVENT_MONTH_SQL} = strftime('%Y-%m', 'now', 'localtime') AND ${FINANCIAL_FILTER}`);
  const topProducts = queryAll(`SELECT oi.product_name, SUM(oi.quantity) as total_sold, SUM(oi.subtotal) as total_revenue FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.status != 'cancelled' AND o.payment_status = 'paid' AND ${SALES_EVENT_ORDER_MONTH_SQL} = strftime('%Y-%m', 'now', 'localtime') GROUP BY oi.product_name ORDER BY total_sold DESC LIMIT 10`);
  const recentOrders = queryAll('SELECT * FROM orders ORDER BY created_at DESC LIMIT 10');
  recentOrders.forEach(o => { o.items = queryAll('SELECT * FROM order_items WHERE order_id = ?', [o.id]); });
  const paymentMethods = queryAll(
    `SELECT payment_method, COUNT(*) as count, SUM(total) as total FROM orders WHERE ${SALES_EVENT_DATE_SQL} = ${LOCAL_TODAY_SQL} AND ${FINANCIAL_FILTER} GROUP BY payment_method`
  );

  const op = buildOperationalIntelligence({ role: req.user?.role });
  const financeMonth = financeMonthToDateSnapshot();
  const liveSales = buildLiveSalesPanel(op.registerOpen);

  res.json({
    today: todaySales,
    liveSales,
    month: monthSales,
    activeOrders: op.summary.activeOrders,
    topProducts,
    recentOrders,
    lowStock: op.lowStock,
    paymentMethods,
    tablesWithActiveOrders: op.tablesWithActiveOrders,
    deliveryActiveCount: op.deliveryActiveCount,
    inKitchenCount: op.inKitchenCount,
    registerOpen: op.registerOpen,
    operationalAlerts: op.operationalAlerts,
    operationalSummary: op.summary,
    insightToday: op.insightToday,
    generated_at: op.generated_at,
    financeMonth,
    businessIntel: op.businessIntel,
  });
});

router.get('/operational-alerts', authenticateToken, requireRole('admin', 'cajero', 'mozo', 'delivery'), (req, res) => {
  const op = buildOperationalIntelligence({ role: req.user?.role });
  res.json({
    alerts: op.operationalAlerts,
    summary: op.summary,
    insightToday: op.insightToday,
    generated_at: op.generated_at,
    businessIntel: op.businessIntel,
  });
});

router.get('/slow-moving-products', authenticateToken, requireRole('admin', 'cajero'), (req, res) => {
  res.json(getSlowMovingProductIds());
});

router.get('/daily', authenticateToken, requireRole('admin', 'cajero'), (req, res) => {
  const today = getLocalTodayDateKey();

  const register = queryOne("SELECT * FROM cash_registers WHERE closed_at IS NULL ORDER BY opened_at DESC LIMIT 1");

  const sales = queryOne(
    `SELECT COUNT(*) as order_count, COALESCE(SUM(total), 0) as total_sales, COALESCE(SUM(subtotal), 0) as subtotal, COALESCE(SUM(tax), 0) as total_tax, COALESCE(SUM(discount), 0) as total_discount, COALESCE(SUM(tip_amount), 0) as total_tips FROM orders WHERE ${SALES_EVENT_DATE_SQL} = ${LOCAL_TODAY_SQL} AND ${FINANCIAL_FILTER}`
  );

  const hourly = queryAll(
    `SELECT ${SALES_EVENT_HOUR_SQL} as hour, COUNT(*) as orders, COALESCE(SUM(total), 0) as total FROM orders WHERE ${SALES_EVENT_DATE_SQL} = ${LOCAL_TODAY_SQL} AND ${FINANCIAL_FILTER} GROUP BY ${SALES_EVENT_HOUR_SQL} ORDER BY hour`
  );

  const paymentMethods = queryAll(
    `SELECT payment_method, COUNT(*) as count, COALESCE(SUM(total), 0) as total FROM orders WHERE ${SALES_EVENT_DATE_SQL} = ${LOCAL_TODAY_SQL} AND ${FINANCIAL_FILTER} GROUP BY payment_method`
  );

  const orders = queryAll(
    `SELECT * FROM orders WHERE ${SALES_EVENT_DATE_SQL} = ${LOCAL_TODAY_SQL} ORDER BY ${SALES_EVENT_AT_SQL} DESC`
  );
  orders.forEach(o => { o.items = queryAll('SELECT * FROM order_items WHERE order_id = ?', [o.id]); });

  res.json({ register_open: !!register, register, sales, hourly, paymentMethods, orders, date: today });
});

router.get('/monthly', authenticateToken, requireRole('admin', 'cajero'), (req, res) => {
  const closedRegisters = queryAll(
    "SELECT cr.*, u.full_name as user_name FROM cash_registers cr LEFT JOIN users u ON u.id = cr.user_id WHERE cr.closed_at IS NOT NULL ORDER BY cr.closed_at DESC LIMIT 60"
  );
  const closedRegistersWithDetails = closedRegisters.map((r) => ({
    ...r,
    arqueo: parseArqueoData(r.arqueo_data),
  }));

  const dailySales = queryAll(
    `SELECT ${SALES_EVENT_DATE_SQL} as date, COUNT(*) as orders, COALESCE(SUM(total), 0) as total, COALESCE(SUM(tax), 0) as tax FROM orders WHERE ${FINANCIAL_FILTER} AND ${SALES_EVENT_LOCAL_SQL} >= datetime('now', 'localtime', '-30 days') GROUP BY ${SALES_EVENT_DATE_SQL} ORDER BY date DESC`
  );

  const monthlySales = queryAll(
    `SELECT ${SALES_EVENT_MONTH_SQL} as month, COUNT(*) as orders, COALESCE(SUM(total), 0) as total, COALESCE(SUM(tax), 0) as tax FROM orders WHERE ${FINANCIAL_FILTER} GROUP BY ${SALES_EVENT_MONTH_SQL} ORDER BY month DESC LIMIT 12`
  );

  const totalMonth = queryOne(
    `SELECT COUNT(*) as orders, COALESCE(SUM(total), 0) as total, COALESCE(SUM(tax), 0) as tax FROM orders WHERE ${FINANCIAL_FILTER} AND ${SALES_EVENT_MONTH_SQL} = strftime('%Y-%m', 'now', 'localtime')`
  );
  const closedRegistersMonth = queryOne(
    "SELECT COUNT(*) as count FROM cash_registers WHERE closed_at IS NOT NULL AND strftime('%Y-%m', closed_at) = strftime('%Y-%m', 'now')"
  );

  res.json({ closedRegisters: closedRegistersWithDetails, closedRegistersMonth: Number(closedRegistersMonth?.count || 0), dailySales, monthlySales, totalMonth });
});

router.get('/closed-registers/:id', authenticateToken, requireRole('admin', 'cajero'), (req, res) => {
  const register = queryOne(
    "SELECT cr.*, u.full_name as user_name FROM cash_registers cr LEFT JOIN users u ON u.id = cr.user_id WHERE cr.id = ? AND cr.closed_at IS NOT NULL",
    [req.params.id]
  );
  if (!register) return res.status(404).json({ error: 'Cierre de caja no encontrado' });
  register.arqueo = parseArqueoData(register.arqueo_data);
  register.movements = queryAll(
    "SELECT cm.*, u.full_name as user_name FROM cash_movements cm LEFT JOIN users u ON u.id = cm.user_id WHERE cm.register_id = ? ORDER BY cm.created_at ASC",
    [register.id]
  );
  register.notes_list = queryAll(
    "SELECT cn.*, u.full_name as user_name FROM cash_notes cn LEFT JOIN users u ON u.id = cn.user_id WHERE cn.register_id = ? ORDER BY cn.created_at ASC",
    [register.id]
  );
  const soldRows = queryAll(
    `SELECT
      oi.product_id,
      oi.product_name,
      COALESCE(SUM(oi.quantity), 0) as total_qty,
      COALESCE(SUM(oi.subtotal), 0) as total_amount,
      COUNT(DISTINCT oi.order_id) as order_count
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.status != 'cancelled'
       AND o.payment_status = 'paid'
       AND COALESCE(o.updated_at, o.created_at) >= ?
       AND COALESCE(o.updated_at, o.created_at) <= ?
     GROUP BY oi.product_id, oi.product_name
     ORDER BY oi.product_name ASC, total_amount DESC`,
    [register.opened_at, register.closed_at || new Date().toISOString()]
  );
  register.sold_products = soldRows.map((row) => {
    const qty = Number(row.total_qty) || 0;
    const amt = Number(row.total_amount) || 0;
    return {
      ...row,
      total_qty: qty,
      total_amount: amt,
      unit_price: qty > 0 ? amt / qty : 0,
    };
  });
  register.product_sales_total = register.sold_products.reduce((s, r) => s + (Number(r.total_amount) || 0), 0);
  register.sales_orders = queryAll(
    `SELECT
      o.id,
      o.order_number,
      o.type,
      o.table_number,
      o.payment_method,
      o.total,
      o.created_at,
      o.updated_at
     FROM orders o
     WHERE o.status != 'cancelled'
       AND o.payment_status = 'paid'
       AND COALESCE(o.updated_at, o.created_at) >= ?
       AND COALESCE(o.updated_at, o.created_at) <= ?
     ORDER BY COALESCE(o.updated_at, o.created_at) ASC`,
    [register.opened_at, register.closed_at || new Date().toISOString()]
  );
  if (register.sales_orders.length > 0) {
    const orderIds = register.sales_orders.map((o) => o.id);
    const placeholders = orderIds.map(() => '?').join(',');
    const orderItems = queryAll(
      `SELECT order_id, product_name, quantity, unit_price, subtotal
       FROM order_items
       WHERE order_id IN (${placeholders})`,
      orderIds
    );
    const itemsByOrder = orderItems.reduce((acc, item) => {
      if (!acc[item.order_id]) acc[item.order_id] = [];
      acc[item.order_id].push(item);
      return acc;
    }, {});
    register.sales_orders = register.sales_orders.map((order) => ({
      ...order,
      sold_at: order.updated_at || order.created_at,
      items: itemsByOrder[order.id] || [],
    }));
  }
  res.json(register);
});

router.get('/ranking', authenticateToken, requireRole('admin', 'cajero'), (req, res) => {
  const { period } = req.query;
  let dateFilter = '';
  if (period === 'today') dateFilter = `AND ${SALES_EVENT_ORDER_DATE_SQL} = DATE('now', 'localtime')`;
  else if (period === 'week') dateFilter = `AND ${SALES_EVENT_ORDER_LOCAL_SQL} >= datetime('now', 'localtime', '-6 days')`;
  else if (period === 'month') dateFilter = `AND ${SALES_EVENT_ORDER_MONTH_SQL} = strftime('%Y-%m', 'now', 'localtime')`;

  const ranking = queryAll(
    `SELECT oi.product_name, oi.product_id, SUM(oi.quantity) as total_sold, SUM(oi.subtotal) as total_revenue, COUNT(DISTINCT oi.order_id) as order_count FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.status != 'cancelled' AND o.payment_status = 'paid' ${dateFilter} GROUP BY oi.product_id ORDER BY total_sold DESC`
  );

  res.json(ranking);
});

router.get('/sales', authenticateToken, requireRole('admin'), (req, res) => {
  const { period, start_date, end_date } = req.query;
  if (period === 'daily') {
    res.json(queryAll(`SELECT ${SALES_EVENT_DATE_SQL} as date, COUNT(*) as orders, SUM(total) as total, SUM(tax) as tax, SUM(discount) as discounts FROM orders WHERE ${FINANCIAL_FILTER} AND ${SALES_EVENT_DATE_SQL} BETWEEN COALESCE(?, DATE('now', 'localtime', '-30 days')) AND COALESCE(?, DATE('now', 'localtime')) GROUP BY ${SALES_EVENT_DATE_SQL} ORDER BY date DESC`, [start_date || null, end_date || null]));
  } else {
    res.json(queryAll(`SELECT ${SALES_EVENT_MONTH_SQL} as month, COUNT(*) as orders, SUM(total) as total, SUM(tax) as tax, SUM(discount) as discounts FROM orders WHERE ${FINANCIAL_FILTER} GROUP BY ${SALES_EVENT_MONTH_SQL} ORDER BY month DESC LIMIT 12`));
  }
});

router.get('/products', authenticateToken, requireRole('admin', 'cajero'), (req, res) => {
  res.json(queryAll("SELECT oi.product_name, oi.product_id, SUM(oi.quantity) as total_sold, SUM(oi.subtotal) as total_revenue, COUNT(DISTINCT oi.order_id) as order_count FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.status != 'cancelled' AND o.payment_status = 'paid' GROUP BY oi.product_id ORDER BY total_sold DESC"));
});

router.get('/payment-methods', authenticateToken, requireRole('admin', 'cajero'), (req, res) => {
  const { start_date, end_date } = req.query;
  res.json(queryAll(`SELECT payment_method, COUNT(*) as count, SUM(total) as total FROM orders WHERE ${FINANCIAL_FILTER} AND ${SALES_EVENT_DATE_SQL} BETWEEN COALESCE(?, DATE('now', 'localtime', '-30 days')) AND COALESCE(?, DATE('now', 'localtime')) GROUP BY payment_method ORDER BY total DESC`, [start_date || null, end_date || null]));
});

const LOSS_CATEGORIES = new Set(['salida_efectivo', 'gasto_extra', 'merma', 'danio_propiedad', 'reembolso', 'otro']);

function parseYmd(input) {
  const v = String(input || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
}

function defaultFinanceRange() {
  const today = new Date();
  const to = today.toISOString().split('T')[0];
  const from = new Date(today);
  from.setDate(from.getDate() - 30);
  return { from: from.toISOString().split('T')[0], to };
}

router.get('/finance-overview', authenticateToken, requireRole('admin'), (req, res) => {
  const def = defaultFinanceRange();
  const from = parseYmd(req.query.from) || def.from;
  const to = parseYmd(req.query.to) || def.to;
  const dateSales = SALES_EVENT_DATE_SQL;
  const salesRow = queryOne(
    `SELECT COUNT(*) as orders, COALESCE(SUM(total), 0) as total_sales FROM orders WHERE ${FINANCIAL_FILTER} AND ${dateSales} BETWEEN date(?) AND date(?)`,
    [from, to]
  );
  const investmentRow = queryOne(
    `SELECT COALESCE(SUM(amount), 0) as total FROM investment_movements
     WHERE date(datetime(created_at, 'localtime')) BETWEEN date(?) AND date(?)`,
    [from, to]
  );
  const purchasesRow = queryOne(
    `SELECT COALESCE(SUM(total_cost), 0) as total FROM inventory_expenses
     WHERE date(datetime(created_at, 'localtime')) BETWEEN date(?) AND date(?)`,
    [from, to]
  );
  const cashExpensesRow = queryOne(
    `SELECT COALESCE(SUM(amount), 0) as total FROM cash_movements
     WHERE type = 'expense'
       AND date(datetime(created_at, 'localtime')) BETWEEN date(?) AND date(?)`,
    [from, to]
  );
  const lossEventsRow = queryOne(
    `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as n FROM finance_loss_events
     WHERE date(datetime(occurred_at, 'localtime')) BETWEEN date(?) AND date(?)`,
    [from, to]
  );
  const lossByCat = queryAll(
    `SELECT category, COALESCE(SUM(amount), 0) as total, COUNT(*) as event_count FROM finance_loss_events
     WHERE date(datetime(occurred_at, 'localtime')) BETWEEN date(?) AND date(?)
     GROUP BY category ORDER BY total DESC`,
    [from, to]
  );
  const totalSales = Number(salesRow?.total_sales || 0);
  const totalInvestment = Number(investmentRow?.total || 0);
  const inventoryInvestmentRow = queryOne(
    `SELECT COALESCE(SUM(stock * purchase_price), 0) AS total FROM products
     WHERE is_active = 1 AND purchase_price IS NOT NULL AND purchase_price > 0`
  );
  let insumosInvestment = 0;
  try {
    const insRow = queryOne(
      `SELECT COALESCE(SUM(stock_actual * costo_promedio), 0) AS total FROM insumos WHERE activo = 1`
    );
    insumosInvestment = Number(insRow?.total || 0);
  } catch (_) {
    insumosInvestment = 0;
  }
  const inventoryInvestmentTotal =
    Number(inventoryInvestmentRow?.total || 0) + insumosInvestment;
  const totalPurchases = Number(purchasesRow?.total || 0);
  const cashExpenses = Number(cashExpensesRow?.total || 0);
  const lossEventsTotal = Number(lossEventsRow?.total || 0);
  const lossesCombined = lossEventsTotal + cashExpenses;
  const approxGross = totalSales - totalPurchases;
  const approxProfit = totalSales - totalPurchases - lossEventsTotal - cashExpenses;

  let business_intel = null;
  try {
    business_intel = getEffectiveFlat();
  } catch (_) {
    business_intel = null;
  }

  res.json({
    filters: { from, to },
    sales: { total: totalSales, orders: Number(salesRow?.orders || 0) },
    investment: {
      /** Movimientos de inversión en el rango (nómina, aportes, etc.). */
      total: totalInvestment,
      movements_total: totalInvestment,
      /** Valor actual del inventario (foto, no filtrada por fechas). */
      inventory_snapshot: inventoryInvestmentTotal,
      inventory_total: inventoryInvestmentTotal,
    },
    purchases: { total: totalPurchases },
    cash_expenses: { total: cashExpenses },
    loss_events: { total: lossEventsTotal, count: Number(lossEventsRow?.n || 0) },
    loss_by_category: lossByCat.map((r) => ({
      category: r.category,
      total: Number(r.total || 0),
      event_count: Number(r.event_count || 0),
    })),
    losses_combined_total: lossesCombined,
    /** Ventas − compras de inventario en el rango (no usa valor de inventario actual). */
    approx_gross_margin: approxGross,
    approx_profit: approxProfit,
    business_intel,
  });
});

router.get('/finance-loss-events', authenticateToken, requireRole('admin'), (req, res) => {
  const def = defaultFinanceRange();
  const from = parseYmd(req.query.from) || def.from;
  const to = parseYmd(req.query.to) || def.to;
  const category = String(req.query.category || '').trim();
  const clauses = ["date(datetime(occurred_at, 'localtime')) BETWEEN date(?) AND date(?)"];
  const params = [from, to];
  if (category && LOSS_CATEGORIES.has(category)) {
    clauses.push('category = ?');
    params.push(category);
  }
  const whereSql = clauses.join(' AND ');
  const rows = queryAll(
    `SELECT * FROM finance_loss_events WHERE ${whereSql} ORDER BY datetime(occurred_at) DESC LIMIT 500`,
    params
  );
  const parsed = rows.map((row) => {
    let items = null;
    if (row.items_json) {
      try {
        items = JSON.parse(row.items_json);
      } catch (_) {
        items = row.items_json;
      }
    }
    return { ...row, items_json_parsed: items };
  });
  const totalRow = queryOne(
    `SELECT COALESCE(SUM(amount), 0) as total FROM finance_loss_events WHERE ${whereSql}`,
    params
  );
  res.json({
    filters: { from, to, category: category || 'all' },
    events: parsed,
    loss_events_total: Number(totalRow?.total || 0),
  });
});

router.post('/finance-loss-events', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const category = String(req.body?.category || '').trim();
    if (!LOSS_CATEGORIES.has(category)) return res.status(400).json({ error: 'Categoría de pérdida inválida' });
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Monto inválido' });
    const concept = String(req.body?.concept || '').trim();
    const orderId = String(req.body?.order_id || '').trim();
    let itemsJson = '';
    if (req.body?.items != null) {
      itemsJson = typeof req.body.items === 'string' ? req.body.items : JSON.stringify(req.body.items);
    }
    let occurredAt = String(req.body?.occurred_at || '').trim();
    if (occurredAt && !/^\d{4}-\d{2}-\d{2}/.test(occurredAt)) {
      return res.status(400).json({ error: 'Fecha occurred_at inválida' });
    }
    if (!occurredAt) occurredAt = new Date().toISOString();
    const id = uuidv4();
    runSql(
      `INSERT INTO finance_loss_events (id, category, amount, concept, order_id, items_json, occurred_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [id, category, amount, concept, orderId || null, itemsJson || '', occurredAt]
    );
    const created = queryOne('SELECT * FROM finance_loss_events WHERE id = ?', [id]);
    emitStaffDataUpdate({ domain: 'finance_ops' });
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err.message || 'No se pudo registrar la pérdida' });
  }
});

router.buildOperationalIntelligence = buildOperationalIntelligence;
router.financeMonthToDateSnapshot = financeMonthToDateSnapshot;
router.financeRolling7dSnapshot = financeRolling7dSnapshot;

router.get('/indicators-hub', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const { buildIndicatorsHub } = require('../services/indicatorsHubService');
    res.json(buildIndicatorsHub(req.query || {}, { role: req.user?.role || 'admin' }));
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudo cargar indicadores' });
  }
});

router.get('/indicators-export', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const { exportIndicators } = require('../services/indicatorsExportService');
    exportIndicators(req.query || {}, res);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message || 'No se pudo exportar' });
  }
});

module.exports = router;
