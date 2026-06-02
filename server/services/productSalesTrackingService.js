const { queryAll, queryOne, runSql } = require('../database');

function localNowIso() {
  return new Date().toISOString();
}

/** Recalcula días sin venta cobrada (solo productos de inventario con stock). */
function refreshAllProductIdleSalesDays() {
  const result = runSql(
    `UPDATE products
     SET idle_sales_days = MAX(0, CAST(
       julianday(date('now', 'localtime'))
       - julianday(date(COALESCE(last_paid_sale_at, catalog_listed_at, created_at), 'localtime'))
     AS INTEGER))
     WHERE is_active = 1
       AND LOWER(IFNULL(process_type, 'transformed')) = 'non_transformed'`,
  );
  return Number(result?.changes || 0);
}

/** Al cobrar un pedido: reinicia contador de los productos vendidos. */
function markProductsSoldOnPaidOrder(orderId, soldAt = null) {
  const oid = String(orderId || '').trim();
  if (!oid) return 0;
  const ts = soldAt || localNowIso();
  const rows = queryAll(
    `SELECT DISTINCT TRIM(product_id) AS product_id
     FROM order_items
     WHERE order_id = ?
       AND product_id IS NOT NULL
       AND TRIM(product_id) != ''`,
    [oid],
  );
  let updated = 0;
  for (const row of rows) {
    const pid = String(row.product_id || '').trim();
    if (!pid) continue;
    const r = runSql(
      `UPDATE products
       SET last_paid_sale_at = ?,
           idle_sales_days = 0,
           updated_at = datetime('now')
       WHERE id = ?`,
      [ts, pid],
    );
    updated += Number(r?.changes || 0);
  }
  return updated;
}

function markProductsSoldOnPaidOrders(orderIds = [], soldAt = null) {
  let total = 0;
  for (const id of orderIds) {
    total += markProductsSoldOnPaidOrder(id, soldAt);
  }
  return total;
}

/** Migración / arranque: fechas base e idle_sales_days desde historial. */
function backfillProductSalesTracking() {
  runSql(
    `UPDATE products
     SET catalog_listed_at = COALESCE(NULLIF(TRIM(catalog_listed_at), ''), created_at, datetime('now'))
     WHERE catalog_listed_at IS NULL OR TRIM(catalog_listed_at) = ''`,
  );

  const products = queryAll('SELECT id FROM products');
  for (const p of products) {
    const lastSale = queryOne(
      `SELECT MAX(datetime(COALESCE(o.updated_at, o.created_at))) AS sold_at
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE oi.product_id = ?
         AND o.status != 'cancelled'
         AND o.payment_status = 'paid'`,
      [p.id],
    );
    if (lastSale?.sold_at) {
      runSql(
        `UPDATE products SET last_paid_sale_at = ? WHERE id = ? AND (last_paid_sale_at IS NULL OR TRIM(last_paid_sale_at) = '')`,
        [lastSale.sold_at, p.id],
      );
    }
  }

  return refreshAllProductIdleSalesDays();
}

function msUntilNextLocalMidnight() {
  const now = new Date();
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  next.setHours(0, 0, 0, 0);
  return Math.max(1000, next.getTime() - now.getTime());
}

let midnightTimer = null;

function startProductSalesMidnightJob() {
  if (midnightTimer) return;

  const scheduleNext = () => {
    midnightTimer = setTimeout(() => {
      try {
        const n = refreshAllProductIdleSalesDays();
        if (n > 0) {
          console.log(`[product-sales-idle] Recálculo nocturno: ${n} producto(s)`);
        }
      } catch (err) {
        console.warn('[product-sales-idle] error en recálculo nocturno:', err.message || err);
      }
      scheduleNext();
    }, msUntilNextLocalMidnight());
  };

  scheduleNext();
}

module.exports = {
  refreshAllProductIdleSalesDays,
  markProductsSoldOnPaidOrder,
  markProductsSoldOnPaidOrders,
  backfillProductSalesTracking,
  startProductSalesMidnightJob,
};
