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

function querySlowMovingProducts(days) {
  const slowMovingDateModLiteral = `-${days} days`;
  return queryAll(
    `SELECT p.id, p.name, p.stock, p.price
     FROM products p
     WHERE p.is_active = 1
       AND LOWER(IFNULL(p.process_type, 'transformed')) = 'non_transformed'
       AND IFNULL(p.stock, 0) > 0
       AND NOT EXISTS (
         SELECT 1 FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE oi.product_id = p.id
           AND o.status != 'cancelled'
           AND o.payment_status = 'paid'
           AND DATE(datetime(COALESCE(o.updated_at, o.created_at), 'localtime')) >= date('now', 'localtime', '${slowMovingDateModLiteral}')
       )
     ORDER BY p.name COLLATE NOCASE`,
    [],
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
