const { queryAll } = require('../database');
const { getEffectiveFlat } = require('./businessConfigService');

function readBusinessIntelFlat() {
  try {
    return getEffectiveFlat();
  } catch (_) {
    return {};
  }
}

function getSlowMovingDays() {
  const biz = readBusinessIntelFlat();
  return Math.min(365, Math.max(1, Math.round(Number(biz.auto_slow_moving_days ?? 14))));
}

function isSlowMovingAlertsEnabled() {
  const biz = readBusinessIntelFlat();
  return biz.auto_alerts_enabled !== false;
}

/** Usa idle_sales_days (recalculado a medianoche) en lugar de escanear pedidos en cada consulta. */
function querySlowMovingProducts(days) {
  return queryAll(
    `SELECT p.id, p.name, p.stock, p.price, p.idle_sales_days, p.catalog_listed_at, p.last_paid_sale_at
     FROM products p
     WHERE p.is_active = 1
       AND LOWER(IFNULL(p.process_type, 'transformed')) = 'non_transformed'
       AND IFNULL(p.stock, 0) > 0
       AND IFNULL(p.idle_sales_days, 0) >= ?
     ORDER BY p.idle_sales_days DESC, p.name COLLATE NOCASE`,
    [days],
  );
}

function getSlowMovingProductIds() {
  if (!isSlowMovingAlertsEnabled()) {
    return { days: getSlowMovingDays(), product_ids: [], products: [] };
  }
  const days = getSlowMovingDays();
  const products = querySlowMovingProducts(days);
  return {
    days,
    product_ids: products.map((p) => p.id),
    products,
  };
}

module.exports = {
  getSlowMovingDays,
  getSlowMovingProductIds,
  querySlowMovingProducts,
};
