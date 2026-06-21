const { queryAll, runSql, saveDb } = require('../database');
const { kitchenOrderNeedsRepair } = require('../utils/kitchenStationReady');
const {
  getOrderItemsWithProductionArea,
  enrichOrderItemsWithComboAreas,
} = require('./orderItemsProductionService');

/** Comandas globales «listo» sin cierre por estación → reabrir en preparación. */
function repairKitchenOrdersAtStartup() {
  const orders = queryAll(`
    SELECT * FROM orders
    WHERE status = 'ready'
      AND IFNULL(TRIM(payment_status), 'pending') != 'paid'
  `);
  let repaired = 0;
  for (const o of orders) {
    const items = enrichOrderItemsWithComboAreas(getOrderItemsWithProductionArea(o.id));
    if (!kitchenOrderNeedsRepair(o, items)) continue;
    runSql(
      "UPDATE orders SET status = 'preparing', preparing_at = COALESCE(preparing_at, datetime('now')), updated_at = datetime('now') WHERE id = ?",
      [o.id],
    );
    repaired += 1;
  }
  if (repaired > 0) {
    saveDb();
    console.log(JSON.stringify({ level: 'info', msg: 'kitchen_orders_repaired_at_startup', count: repaired }));
  }
  return repaired;
}

module.exports = { repairKitchenOrdersAtStartup };
