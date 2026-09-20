/**
 * Monitoreo en segundo plano: snapshots diarios + avisos tras periodo de aprendizaje.
 */
const { queryOne } = require('../../database');
const { addNotification, getActiveNotifications, getControlConfig } = require('../../masterAdminService');
const { getBusinessTodayDateKey, getBusinessMonthKey } = require('../../utils/appDateTime');
const {
  getPaidSalesEventSql,
  metricsFromPaidOrdersWhere,
} = require('../../utils/salesAccountGrouping');
const {
  ensureFadeyAiSchema,
  getState,
  isLearningPeriod,
  bootstrapKnowledge,
  saveDailySnapshot,
  businessNow,
  upsertMemory,
} = require('./fadeyAiKnowledgeService');
const { runTool } = require('./fadeyAiTools');

const ADMIN_USER = { role: 'admin', id: 'monitor' };
const FADEY_AVISO_TITLE = 'IA Fadey';

function isEnabled() {
  try {
    return Number(getControlConfig().fadey_ai_enabled) === 1;
  } catch (_) {
    return false;
  }
}

function buildSnapshotText() {
  const sales = runTool('sales_summary', { scope: 'today' }, ADMIN_USER);
  const top = runTool('top_products', { scope: 'day', limit: 5 }, ADMIN_USER);
  const kitchen = runTool('kitchen_open_orders', {}, ADMIN_USER);
  const stock = runTool('low_stock', {}, ADMIN_USER);
  const lines = [];
  if (sales.ok) {
    lines.push(`Ventas hoy: S/ ${Number(sales.sales || 0).toFixed(2)} (${sales.orders} cuentas).`);
  }
  if (top.ok && top.items?.length) {
    lines.push(`Top plato: ${top.items[0].name} (${top.items[0].qty} uds).`);
  }
  if (kitchen.ok) {
    lines.push(`Pedidos abiertos cocina/bar: ${kitchen.open_count}.`);
  }
  if (stock.ok) {
    lines.push(`Productos stock bajo: ${stock.count}.`);
  }
  return lines.join('\n') || 'Sin métricas disponibles.';
}

function alreadyAlertedToday(key) {
  const day = String(businessNow()).slice(0, 10);
  const { queryOne } = require('../../database');
  const row = queryOne('SELECT id FROM fadey_ai_memory WHERE id = ?', [`alert-${day}-${key}`]);
  return Boolean(row);
}

function markAlertedToday(key, message) {
  const day = String(businessNow()).slice(0, 10);
  upsertMemory({
    id: `alert-${day}-${key}`,
    kind: 'alert',
    title: key,
    body: message,
    meta: { day, key },
  });
}

function hasActiveFadeyAvisoContaining(fragment) {
  const list = getActiveNotifications() || [];
  return list.some(
    (n) => String(n.title || '') === FADEY_AVISO_TITLE
      && String(n.message || '').includes(fragment)
  );
}

function maybeNotifyAnomalies() {
  const kitchen = runTool('kitchen_open_orders', {}, ADMIN_USER);
  if (kitchen.ok && kitchen.open_count >= 8 && !alreadyAlertedToday('kitchen')) {
    const message = `Hay ${kitchen.open_count} pedidos abiertos en cocina/bar. Revisa demoras.`;
    if (!hasActiveFadeyAvisoContaining('pedidos abiertos')) {
      addNotification({
        title: FADEY_AVISO_TITLE,
        message,
        level: 'warning',
        created_by: 'IA Fadey',
        duration_hours: 4,
      });
    }
    markAlertedToday('kitchen', message);
  }
  const stock = runTool('low_stock', {}, ADMIN_USER);
  if (stock.ok && stock.count >= 3 && !alreadyAlertedToday('stock')) {
    const names = (stock.items || []).slice(0, 4).map((i) => i.name).join(', ');
    const message = `${stock.count} producto(s) con stock bajo: ${names}.`;
    if (!hasActiveFadeyAvisoContaining('stock bajo')) {
      addNotification({
        title: FADEY_AVISO_TITLE,
        message,
        level: 'warning',
        created_by: 'IA Fadey',
        duration_hours: 8,
      });
    }
    markAlertedToday('stock', message);
  }

  try {
    const ps = getPaidSalesEventSql();
    const today = getBusinessTodayDateKey(queryOne);
    const month = getBusinessMonthKey(queryOne);
    const todayM = metricsFromPaidOrdersWhere(`${ps.ORDER_DATE} = date(?)`, [today]);
    const monthM = metricsFromPaidOrdersWhere(`${ps.ORDER_MONTH} = ?`, [month]);
    const daySales = Number(todayM.sales || 0);
    const monthSales = Number(monthM.sales || 0);
    if (monthSales > 500 && daySales > 0 && daySales < monthSales / 60 && !alreadyAlertedToday('sales-low')) {
      const message = `Ventas de hoy (S/ ${daySales.toFixed(2)}) van por debajo del ritmo del mes. Revisa operación.`;
      if (!hasActiveFadeyAvisoContaining('ritmo del mes')) {
        addNotification({
          title: FADEY_AVISO_TITLE,
          message,
          level: 'info',
          created_by: 'IA Fadey',
          duration_hours: 6,
        });
      }
      markAlertedToday('sales-low', message);
    }
  } catch (_) {
    /* opcional */
  }
}

function markMonitorRan() {
  const { runSql } = require('../../database');
  const now = businessNow();
  runSql(
    `UPDATE fadey_ai_state SET last_monitor_at = ?, updated_at = ? WHERE id = 1`,
    [now, now]
  );
}

/**
 * Ciclo de monitor. Seguro llamar cada 15–30 min.
 */
function runFadeyAiMonitorCycle() {
  if (!isEnabled()) return { skipped: true, reason: 'disabled' };
  ensureFadeyAiSchema();
  const state = getState();
  if (!state.bootstrapped_at) {
    bootstrapKnowledge();
  }

  const snapshot = buildSnapshotText();
  const today = String(businessNow()).slice(0, 10);
  const lastSnapDay = String(state.last_snapshot_at || '').slice(0, 10);
  if (lastSnapDay !== today) {
    saveDailySnapshot(snapshot, { source: 'monitor' });
  }

  if (isLearningPeriod()) {
    markMonitorRan();
    return { ok: true, learning: true, snapshot: false };
  }

  maybeNotifyAnomalies();
  markMonitorRan();
  return { ok: true, learning: false, monitored: true };
}

module.exports = {
  runFadeyAiMonitorCycle,
  FADEY_AVISO_TITLE,
};
