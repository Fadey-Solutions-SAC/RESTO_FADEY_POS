/**
 * Hub de configuración del sistema: métricas en vivo y contexto por sección.
 */

const { queryAll, queryOne } = require('../database');
const { FINANCIAL_FILTER_SQL } = require('../businessRules');
const { mergeRegional, buildPreview } = require('./regionalFormatService');
const { isNonTransformedLowStockSql } = require('../utils/productStockThreshold');

const FIN = FINANCIAL_FILTER_SQL;
const DAY_KEYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

function parseJsonSafe(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (_) {
    return fallback;
  }
}

function readSettingsBlob() {
  const row = queryOne('SELECT value FROM app_settings WHERE key = ?', ['settings']);
  return parseJsonSafe(row?.value, {});
}

function readRegional() {
  const row = queryOne('SELECT value FROM app_settings WHERE key = ?', ['regional']);
  const fromKey = parseJsonSafe(row?.value, {});
  const settings = readSettingsBlob();
  return mergeRegional({ ...fromKey, ...(settings.regional || {}) });
}

function computeOpenStatus(scheduleJson) {
  let schedule = {};
  try {
    schedule = typeof scheduleJson === 'string' ? JSON.parse(scheduleJson || '{}') : scheduleJson || {};
  } catch (_) {
    schedule = {};
  }
  const now = new Date();
  const dayKey = DAY_KEYS[now.getDay()];
  const block = schedule[dayKey];
  if (!block?.enabled) {
    return { is_open: false, reason: 'Cerrado hoy (horario)', day: dayKey };
  }
  const [oh, om] = String(block.open || '11:00').split(':').map(Number);
  const [ch, cm] = String(block.close || '23:00').split(':').map(Number);
  const mins = now.getHours() * 60 + now.getMinutes();
  const openM = oh * 60 + om;
  const closeM = ch * 60 + cm;
  const isOpen = mins >= openM && mins < closeM;
  return {
    is_open: isOpen,
    reason: isOpen ? 'Abierto' : 'Fuera de horario',
    day: dayKey,
    hours: `${block.open} – ${block.close}`,
  };
}

function buildSectionInsights(settings, restaurant) {
  const today = new Date().toISOString().split('T')[0];
  const salesToday = queryOne(
    `SELECT COALESCE(SUM(total), 0) AS t, COUNT(*) AS c FROM orders
     WHERE date(datetime(COALESCE(updated_at, created_at), 'localtime')) = date('now', 'localtime') AND ${FIN}`
  );
  const activeOrders = queryOne("SELECT COUNT(*) AS c FROM orders WHERE status IN ('pending','preparing','ready')");
  const openRegister = queryOne('SELECT id, user_id FROM cash_registers WHERE closed_at IS NULL LIMIT 1');
  const closedRegistersToday = queryOne(
    `SELECT COUNT(*) AS c FROM cash_registers WHERE date(datetime(closed_at, 'localtime')) = date('now', 'localtime')`
  );
  const openSessions = queryOne('SELECT COUNT(*) AS c FROM user_work_sessions WHERE logout_at IS NULL');
  const usersActive = queryOne('SELECT COUNT(*) AS c FROM users WHERE is_active = 1');
  const lowStock = queryOne(
    `SELECT COUNT(*) AS c FROM products WHERE is_active = 1 AND ${isNonTransformedLowStockSql()}
     AND IFNULL(process_type, 'transformed') = 'non_transformed'`
  );
  const reservationsToday = queryOne(
    `SELECT COUNT(*) AS c FROM reservations WHERE date = date('now', 'localtime') AND status IN ('confirmed','pending')`
  );
  const billingErrors = queryOne(
    `SELECT COUNT(*) AS c FROM electronic_documents WHERE LOWER(TRIM(IFNULL(provider_status,''))) = 'error'`
  );
  const openStatus = computeOpenStatus(restaurant?.schedule);

  return {
    regional: { synced: true, preview: buildPreview(readRegional()).samples },
    locales: {
      count: (settings.locales || []).length,
      active: (settings.locales || []).filter((l) => Number(l.active)).length,
      open_status: openStatus,
    },
    users: {
      total: Number(usersActive?.c || 0),
      sessions_open: Number(openSessions?.c || 0),
    },
    almacenes: {
      warehouses: (settings.almacenes || []).length,
      low_stock: Number(lowStock?.c || 0),
    },
    salones: {
      active_orders: Number(activeOrders?.c || 0),
    },
    cajas: {
      stations: (settings.cajas || []).filter((c) => Number(c.active)).length,
      register_open: Boolean(openRegister?.id),
      closed_today: Number(closedRegistersToday?.c || 0),
    },
    comprobantes: {
      series: (settings.comprobantes || []).length,
      billing_errors: Number(billingErrors?.c || 0),
    },
    impresoras: {
      routes: (settings.impresoras || []).filter((p) => Number(p.active)).length,
    },
    impuestos: {
      rate: Number(settings.impuestos?.rate ?? restaurant?.tax_rate ?? 18),
    },
    tarjetas: { count: (settings.tarjetas || []).length },
    turnos: { note: 'Vinculado a jornadas y caja' },
    jornada_laboral: settings.jornada_laboral || {},
    monedas: { active: (settings.monedas || []).filter((m) => Number(m.active)).length },
    moneda_facturacion: {
      symbol: restaurant?.currency_symbol || 'S/',
      code: restaurant?.currency || 'PEN',
    },
    cuentas_transferencia: { count: (settings.cuentas_transferencia || []).length },
    marcas: { count: (settings.marcas || []).length },
    categoria_anular: { motives: (settings.categoria_anular || []).length },
    formas_pago: { active: (settings.formas_pago || []).filter((f) => Number(f.active)).length },
    apariencia: { theme: settings.ui_theme || 'blue' },
    modulo_empresarial: { configured: Boolean(settings.modulo_empresarial || readSettingsBlob().modulo_empresarial) },
    operacion: {
      sales_today: Number(salesToday?.t || 0),
      orders_today: Number(salesToday?.c || 0),
      reservations_today: Number(reservationsToday?.c || 0),
    },
  };
}

function buildConfigHub() {
  const settings = readSettingsBlob();
  const restaurant = queryOne('SELECT * FROM restaurants LIMIT 1');
  const regional = readRegional();
  const historyRecent = queryAll(
    `SELECT id, actor_name, changed_keys, created_at FROM app_settings_history ORDER BY created_at DESC LIMIT 5`
  ).map((r) => ({
    ...r,
    changed_keys: parseJsonSafe(r.changed_keys, []),
  }));

  return {
    generated_at: new Date().toISOString(),
    regional,
    regional_preview: buildPreview(regional),
    restaurant: restaurant
      ? {
          name: restaurant.name,
          phone: restaurant.phone,
          address: restaurant.address,
          schedule: parseJsonSafe(restaurant.schedule, {}),
          tax_rate: restaurant.tax_rate,
          currency: restaurant.currency,
          currency_symbol: restaurant.currency_symbol,
        }
      : null,
    section_insights: buildSectionInsights(settings, restaurant),
    sync: {
      modules: ['caja', 'cocina', 'delivery', 'inventario', 'reportes', 'indicadores', 'impresiones', 'mesas', 'reservas', 'qr', 'productos'],
      realtime: true,
    },
    history_recent: historyRecent,
  };
}

function syncRegionalToRestaurant(regional) {
  const r = mergeRegional(regional);
  const restaurant = queryOne('SELECT id, currency, currency_symbol FROM restaurants LIMIT 1');
  if (!restaurant?.id) return;
  const { runSql } = require('../database');
  runSql(
    `UPDATE restaurants SET currency = COALESCE(?, currency), currency_symbol = COALESCE(?, currency_symbol), updated_at = datetime('now') WHERE id = ?`,
    [r.currency_code || restaurant.currency, r.currency_symbol || restaurant.currency_symbol, restaurant.id]
  );
}

module.exports = {
  buildConfigHub,
  syncRegionalToRestaurant,
  readRegional,
  computeOpenStatus,
};
