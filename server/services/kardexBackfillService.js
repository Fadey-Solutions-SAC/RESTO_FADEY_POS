const { queryAll, withTransaction } = require('../database');
const kardexInventory = require('./kardexInventoryService');

/**
 * Aplica salidas kardex faltantes en orden cronológico (fecha/hora del cobro).
 * Útil cuando el inventario se configuró después de ventas ya cobradas.
 */
function backfillKardexVentasPagadas({ limit = 3000 } = {}) {
  const cap = Math.min(Math.max(Number(limit) || 3000, 1), 10000);
  const pending = queryAll(
    `SELECT id, COALESCE(updated_at, created_at) AS event_at, created_by_user_id
     FROM orders
     WHERE status != 'cancelled'
       AND payment_status = 'paid'
       AND NOT EXISTS (
         SELECT 1 FROM kardex k
         WHERE k.referencia IN ('venta', 'venta_masa')
           AND k.referencia_id = orders.id
       )
     ORDER BY datetime(COALESCE(updated_at, created_at)) ASC
     LIMIT ?`,
    [cap]
  );

  const result = {
    attempted: pending.length,
    applied: 0,
    skipped: 0,
    no_inventory: 0,
    errors: [],
  };

  for (const row of pending) {
    try {
      let outcome = { skipped: true };
      withTransaction((tx) => {
        outcome = kardexInventory.aplicarSalidasVentaPedido(
          tx,
          row.id,
          row.created_by_user_id || null,
          row.event_at
        );
      });
      if (outcome.skipped && outcome.reason === 'ya_procesado') {
        result.skipped += 1;
      } else if (orderHasKardexVenta(row.id)) {
        result.applied += 1;
      } else {
        result.no_inventory += 1;
      }
    } catch (err) {
      result.errors.push({
        order_id: row.id,
        event_at: row.event_at,
        message: err?.message || String(err),
      });
    }
  }

  return result;
}

function orderHasKardexVenta(orderId) {
  const row = queryAll(
    `SELECT 1 AS ok FROM kardex
     WHERE referencia IN ('venta', 'venta_masa') AND referencia_id = ?
     LIMIT 1`,
    [orderId]
  );
  return !!(row && row.length);
}

module.exports = {
  backfillKardexVentasPagadas,
  orderHasKardexVenta,
};
