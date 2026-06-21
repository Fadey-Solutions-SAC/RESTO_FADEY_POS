const { queryOne, queryAll } = require('../database');

/**
 * Expande líneas combo en componentes para enrutar cocina/bar correctamente.
 */
function enrichOrderItemsWithComboAreas(items) {
  if (!Array.isArray(items) || items.length === 0) return [];
  return items.map((item) => {
    if (String(item.variant_name || '').toLowerCase() !== 'combo') return item;
    const comboName = String(item.product_name || '').trim();
    if (!comboName) return item;
    const combo = queryOne(
      'SELECT id FROM combos WHERE name = ? AND IFNULL(active, 1) = 1 ORDER BY updated_at DESC LIMIT 1',
      [comboName],
    );
    if (!combo) return item;
    const components = queryAll(
      `SELECT
         COALESCE(NULLIF(TRIM(p.production_area), ''), 'cocina') AS production_area,
         LOWER(COALESCE(c.name, '')) AS category_name_lc,
         p.name AS product_name
       FROM combo_items ci
       JOIN products p ON p.id = ci.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE ci.combo_id = ?`,
      [combo.id],
    );
    if (!components.length) return item;
    return { ...item, _comboComponents: components };
  });
}

function getOrderItemsWithProductionArea(orderId) {
  const items = queryAll(
    `SELECT oi.*,
            COALESCE(NULLIF(TRIM(p.production_area), ''), 'cocina') AS production_area,
            LOWER(COALESCE(c.name, '')) AS category_name_lc
     FROM order_items oi
     LEFT JOIN products p ON p.id = oi.product_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE oi.order_id = ?`,
    [orderId],
  );
  return enrichOrderItemsWithComboAreas(items);
}

module.exports = {
  enrichOrderItemsWithComboAreas,
  getOrderItemsWithProductionArea,
};
