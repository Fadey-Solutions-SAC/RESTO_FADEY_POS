const { tableNumbersMatch, normalizeTableNumber } = require('../utils/tableNumberMatch');
const { resolveProductionArea, orderHasBarItems, orderHasKitchenItems } = require('../utils/productionArea');
const { isCocinaStationComplete, isBarStationComplete, isStationMarkedReady } = require('../utils/kitchenStationReady');

const TABLE_ORDER_MERGE_WINDOW_MINUTES = 40;

function isOrderMergeableState(order) {
  if (!order) return false;
  if (order.type !== 'dine_in') return false;
  if (String(order.payment_status || 'pending') === 'paid') return false;
  if (!['pending', 'preparing', 'ready'].includes(String(order.status || ''))) return false;
  return true;
}

function orderMatchesTableScope(order, { tableId, tableNumberRaw } = {}) {
  const tableKey = normalizeTableNumber(tableNumberRaw);
  const scopedId = String(tableId || '').trim();
  const rowTableId = String(order?.table_id || '').trim();
  if (scopedId && rowTableId) return rowTableId === scopedId;
  if (scopedId && !rowTableId && tableKey) return tableNumbersMatch(order?.table_number, tableKey);
  if (tableKey) return tableNumbersMatch(order?.table_number, tableKey);
  return false;
}

function mergeAnchorDatetime(order) {
  return String(order?.kitchen_last_send_at || order?.created_at || '').trim();
}

function isWithinMergeWindowTx(tx, order) {
  const releaseAt = String(order.kitchen_release_at || '').trim();
  if (releaseAt) {
    const held = tx.queryOne(
      "SELECT CASE WHEN datetime(?) > datetime('now', 'localtime') THEN 1 ELSE 0 END AS held",
      [releaseAt],
    );
    if (Number(held?.held || 0) === 1) return false;
  }
  const anchor = mergeAnchorDatetime(order);
  if (!anchor) return false;
  const within = tx.queryOne(
    `SELECT CASE WHEN datetime(?) >= datetime('now', '-${TABLE_ORDER_MERGE_WINDOW_MINUTES} minutes', 'localtime') THEN 1 ELSE 0 END AS ok`,
    [anchor],
  );
  return Number(within?.ok || 0) === 1;
}

function enrichOrderItemsWithComboAreasTx(tx, items) {
  if (!Array.isArray(items) || items.length === 0) return [];
  return items.map((item) => {
    if (String(item.variant_name || '').toLowerCase() !== 'combo') return item;
    const comboName = String(item.product_name || '').trim();
    if (!comboName) return item;
    const combo = tx.queryOne(
      'SELECT id FROM combos WHERE name = ? AND IFNULL(active, 1) = 1 ORDER BY updated_at DESC LIMIT 1',
      [comboName],
    );
    if (!combo) return item;
    const components = tx.queryAll(
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

function getOrderAreaItemsTx(tx, orderId) {
  const items = tx.queryAll(
    `SELECT oi.*,
            COALESCE(NULLIF(TRIM(p.production_area), ''), 'cocina') AS production_area,
            LOWER(COALESCE(c.name, '')) AS category_name_lc
     FROM order_items oi
     LEFT JOIN products p ON p.id = oi.product_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE oi.order_id = ?`,
    [orderId],
  );
  return enrichOrderItemsWithComboAreasTx(items);
}

/** Clasifica ítems entrantes (POST mesa) por estación cocina/bar. */
function classifyIncomingItemsProductionTx(tx, items) {
  let hasKitchen = false;
  let hasBar = false;
  if (!Array.isArray(items)) return { hasKitchen, hasBar };

  for (const item of items) {
    const comboId = String(item.combo_id || '').trim();
    if (comboId) {
      const comboItems = tx.queryAll(
        `SELECT COALESCE(NULLIF(TRIM(p.production_area), ''), 'cocina') AS production_area
         FROM combo_items ci
         LEFT JOIN products p ON p.id = ci.product_id
         WHERE ci.combo_id = ?`,
        [comboId],
      );
      for (const ci of comboItems) {
        if (resolveProductionArea(ci.production_area) === 'bar') hasBar = true;
        else hasKitchen = true;
      }
      continue;
    }
    const product = tx.queryOne('SELECT production_area FROM products WHERE id = ?', [item.product_id]);
    if (resolveProductionArea(product?.production_area) === 'bar') hasBar = true;
    else hasKitchen = true;
  }
  return { hasKitchen, hasBar };
}

/**
 * Si la estación (cocina/bar) del pedido entrante ya cerró/despachó la comanda,
 * no fusionar: el caller debe crear una comanda nueva.
 */
function isMergeBlockedByDispatchedStation(tx, order, incomingItems) {
  if (!order?.id || !Array.isArray(incomingItems) || !incomingItems.length) return false;

  const { hasKitchen, hasBar } = classifyIncomingItemsProductionTx(tx, incomingItems);
  if (!hasKitchen && !hasBar) return false;

  const areaItems = getOrderAreaItemsTx(tx, order.id);

  if (hasKitchen) {
    const kitchenDispatched =
      isStationMarkedReady(order, 'cocina') ||
      (orderHasKitchenItems(areaItems) && isCocinaStationComplete(order, areaItems));
    if (kitchenDispatched) return true;
  }
  if (hasBar) {
    const barDispatched =
      isStationMarkedReady(order, 'bar') ||
      (orderHasBarItems(areaItems) && isBarStationComplete(order, areaItems));
    if (barDispatched) return true;
  }
  return false;
}

/** Última comanda activa de la mesa (solo la más reciente; no fusionar en comandas antiguas). */
function findMergeableTableOrderTx(tx, tableNumberRaw, { tableId, incomingItems } = {}) {
  const tableKey = normalizeTableNumber(tableNumberRaw);
  if (!tableKey && !String(tableId || '').trim()) return null;

  const candidates = tx.queryAll(`
    SELECT *
    FROM orders
    WHERE type = 'dine_in'
      AND IFNULL(TRIM(payment_status), 'pending') != 'paid'
      AND status IN ('pending', 'preparing', 'ready')
    ORDER BY datetime(COALESCE(kitchen_last_send_at, created_at)) DESC
  `);

  for (const row of candidates) {
    if (!orderMatchesTableScope(row, { tableId, tableNumberRaw: tableKey })) continue;
    if (!isWithinMergeWindowTx(tx, row)) return null;
    if (incomingItems?.length && isMergeBlockedByDispatchedStation(tx, row, incomingItems)) return null;
    return row;
  }
  return null;
}

function resolveExplicitMergeTargetTx(tx, targetOrderId, { tableId, tableNumberRaw, incomingItems } = {}) {
  const id = String(targetOrderId || '').trim();
  if (!id) return null;
  const order = tx.queryOne('SELECT * FROM orders WHERE id = ?', [id]);
  if (!order) return null;
  if (!isOrderMergeableState(order)) return null;
  if (!orderMatchesTableScope(order, { tableId, tableNumberRaw })) return null;
  if (!isWithinMergeWindowTx(tx, order)) return null;
  if (incomingItems?.length && isMergeBlockedByDispatchedStation(tx, order, incomingItems)) return null;
  return order;
}

module.exports = {
  TABLE_ORDER_MERGE_WINDOW_MINUTES,
  mergeAnchorDatetime,
  findMergeableTableOrderTx,
  resolveExplicitMergeTargetTx,
  orderMatchesTableScope,
  isOrderMergeableState,
  isWithinMergeWindowTx,
  classifyIncomingItemsProductionTx,
  isMergeBlockedByDispatchedStation,
  getOrderAreaItemsTx,
};
