const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, runSql } = require('./database');
const { emitInventoryUpdate } = require('./socketBroadcast');

function ensureWarehouseRowsForProductTx(tx, product) {
  const currentRows = tx.queryAll('SELECT * FROM inventory_warehouse_stocks WHERE product_id = ?', [product.id]);
  if (currentRows.length > 0) return currentRows;
  const preferred = tx.queryOne(
    'SELECT id, name FROM warehouse_locations WHERE id = ? AND is_active = 1',
    [product.stock_warehouse_id],
  );
  const principal = tx.queryOne(
    "SELECT id, name FROM warehouse_locations WHERE LOWER(name) = LOWER(?) AND is_active = 1",
    ['Almacen Principal'],
  );
  const target = preferred || principal || tx.queryOne(
    'SELECT id, name FROM warehouse_locations WHERE is_active = 1 ORDER BY name LIMIT 1',
  );
  if (!target) return [];
  const rowId = uuidv4();
  tx.run(
    'INSERT INTO inventory_warehouse_stocks (id, product_id, warehouse_id, quantity, updated_at) VALUES (?, ?, ?, ?, datetime(\'now\'))',
    [rowId, product.id, target.id, Number(product.stock || 0)],
  );
  return tx.queryAll('SELECT * FROM inventory_warehouse_stocks WHERE product_id = ?', [product.id]);
}

function ensureWarehouseQtyRowTx(tx, productId, warehouseId, initialQty) {
  let row = tx.queryOne(
    'SELECT * FROM inventory_warehouse_stocks WHERE product_id = ? AND warehouse_id = ?',
    [productId, warehouseId],
  );
  if (row) return row;
  const id = uuidv4();
  tx.run(
    'INSERT INTO inventory_warehouse_stocks (id, product_id, warehouse_id, quantity, updated_at) VALUES (?, ?, ?, ?, datetime(\'now\'))',
    [id, productId, warehouseId, Number(initialQty || 0)],
  );
  return tx.queryOne('SELECT * FROM inventory_warehouse_stocks WHERE id = ?', [id]);
}

function syncProductStockTotalTx(tx, productId) {
  const sum = tx.queryOne(
    'SELECT COALESCE(SUM(quantity), 0) as total FROM inventory_warehouse_stocks WHERE product_id = ?',
    [productId],
  );
  const total = Number(sum?.total || 0);
  tx.run("UPDATE products SET stock = ?, updated_at = datetime('now') WHERE id = ?", [total, productId]);
  return total;
}

/**
 * Descuenta solo del almacén de la caja. Si no hay filas, el stock legado queda en el almacén
 * del producto (o en el de la caja) y la venta baja únicamente el almacén indicado.
 * Permite saldo negativo en ese almacén.
 * @returns {string} id del almacén descontado
 */
function deductOnlyWarehouseTx(tx, product, quantity, warehouseId) {
  const wh = String(warehouseId || '').trim();
  const pending = Number(quantity || 0);
  if (!wh || pending <= 0) return '';
  const rows = tx.queryAll('SELECT id FROM inventory_warehouse_stocks WHERE product_id = ?', [product.id]);
  if (rows.length === 0) {
    const legacy = Number(product.stock || 0);
    const home = String(product.stock_warehouse_id || '').trim() || wh;
    if (legacy !== 0 || home === wh) {
      ensureWarehouseQtyRowTx(tx, product.id, home, legacy);
    }
  }
  const row = ensureWarehouseQtyRowTx(tx, product.id, wh, 0);
  const next = Number(row?.quantity || 0) - pending;
  tx.run(
    "UPDATE inventory_warehouse_stocks SET quantity = ?, updated_at = datetime('now') WHERE id = ?",
    [next, row.id],
  );
  syncProductStockTotalTx(tx, product.id);
  return wh;
}

function addQuantityToWarehouseTx(tx, productId, warehouseId, quantity) {
  const wh = String(warehouseId || '').trim();
  const qty = Number(quantity || 0);
  if (!wh || !qty) return false;
  const row = ensureWarehouseQtyRowTx(tx, productId, wh, 0);
  tx.run(
    "UPDATE inventory_warehouse_stocks SET quantity = ?, updated_at = datetime('now') WHERE id = ?",
    [Number(row?.quantity || 0) + qty, row.id],
  );
  syncProductStockTotalTx(tx, productId);
  return true;
}

/**
 * Descuenta stock de almacén (no transformados).
 * Con warehouseId, solo ese almacén (saldo negativo permitido).
 * Sin warehouseId, reparte como antes entre los almacenes con stock.
 * No aplica a insumos kardex (se descuentan al cobrar en kardexInventoryService).
 * @returns {string} almacén usado cuando el descuento fue de una sola caja; '' si fue el reparto anterior
 */
function deductNonTransformedStockTx(tx, productId, quantity, warehouseId) {
  const product = tx.queryOne('SELECT * FROM products WHERE id = ?', [productId]);
  if (!product || product.process_type !== 'non_transformed') return '';
  const scoped = String(warehouseId || '').trim();
  if (scoped) return deductOnlyWarehouseTx(tx, product, quantity, scoped);

  let pending = Number(quantity || 0);
  if (pending <= 0) return '';

  let stockRows = tx.queryAll(
    'SELECT id, quantity, warehouse_id FROM inventory_warehouse_stocks WHERE product_id = ? ORDER BY quantity DESC',
    [productId],
  );

  for (const row of stockRows) {
    if (pending <= 0) break;
    const available = Number(row.quantity || 0);
    if (available <= 0) continue;
    const consume = Math.min(available, pending);
    tx.run(
      'UPDATE inventory_warehouse_stocks SET quantity = ?, updated_at = datetime(\'now\') WHERE id = ?',
      [available - consume, row.id],
    );
    pending -= consume;
  }

  if (pending > 0) {
    if (stockRows.length === 0) {
      stockRows = ensureWarehouseRowsForProductTx(tx, product);
    }
    if (stockRows.length > 0) {
      const preferredId = product.stock_warehouse_id || stockRows[0].warehouse_id;
      const target = stockRows.find((r) => r.warehouse_id === preferredId) || stockRows[0];
      const fresh = tx.queryOne('SELECT quantity FROM inventory_warehouse_stocks WHERE id = ?', [target.id]);
      const cur = Number(fresh?.quantity || 0);
      tx.run(
        'UPDATE inventory_warehouse_stocks SET quantity = ?, updated_at = datetime(\'now\') WHERE id = ?',
        [cur - pending, target.id],
      );
    } else {
      tx.run(
        'UPDATE products SET stock = COALESCE(stock, 0) - ?, updated_at = datetime(\'now\') WHERE id = ?',
        [pending, productId],
      );
      return '';
    }
  }

  const newSum = tx.queryOne(
    'SELECT COALESCE(SUM(quantity), 0) as total FROM inventory_warehouse_stocks WHERE product_id = ?',
    [productId],
  );
  tx.run('UPDATE products SET stock = ?, updated_at = datetime(\'now\') WHERE id = ?', [Number(newSum?.total || 0), productId]);
  return '';
}

function recalculateProductStock(productId) {
  const sum = queryOne(
    'SELECT COALESCE(SUM(quantity), 0) as total FROM inventory_warehouse_stocks WHERE product_id = ?',
    [productId]
  );
  const total = Number(sum?.total || 0);
  runSql('UPDATE products SET stock = ?, updated_at = datetime(\'now\') WHERE id = ?', [total, productId]);
  emitInventoryUpdate({ productId });
  return total;
}

function ensureWarehouseRowsForProduct(product) {
  const currentRows = queryAll('SELECT * FROM inventory_warehouse_stocks WHERE product_id = ?', [product.id]);
  if (currentRows.length > 0) return currentRows;
  const preferred = queryOne('SELECT id, name FROM warehouse_locations WHERE id = ? AND is_active = 1', [product.stock_warehouse_id]);
  const principal = queryOne('SELECT id, name FROM warehouse_locations WHERE LOWER(name) = LOWER(?) AND is_active = 1', ['Almacen Principal']);
  const target = preferred || principal || queryOne('SELECT id, name FROM warehouse_locations WHERE is_active = 1 ORDER BY name LIMIT 1');
  if (!target) return [];
  runSql(
    'INSERT INTO inventory_warehouse_stocks (id, product_id, warehouse_id, quantity, updated_at) VALUES (?, ?, ?, ?, datetime(\'now\'))',
    [uuidv4(), product.id, target.id, Number(product.stock || 0)]
  );
  return queryAll('SELECT * FROM inventory_warehouse_stocks WHERE product_id = ?', [product.id]);
}

function addToWarehouses(product, quantityToAdd) {
  const rows = ensureWarehouseRowsForProduct(product);
  if (rows.length === 0) {
    runSql('UPDATE products SET stock = stock + ?, updated_at = datetime(\'now\') WHERE id = ?', [quantityToAdd, product.id]);
    emitInventoryUpdate({ productId: product.id });
    return;
  }
  const preferredId = product.stock_warehouse_id || rows[0].warehouse_id;
  const target = rows.find((r) => r.warehouse_id === preferredId) || rows[0];
  const current = Number(target.quantity || 0);
  runSql(
    'UPDATE inventory_warehouse_stocks SET quantity = ?, updated_at = datetime(\'now\') WHERE id = ?',
    [current + Number(quantityToAdd || 0), target.id]
  );
  recalculateProductStock(product.id);
}

function addQuantityToWarehouse(productId, warehouseId, quantity) {
  const wh = String(warehouseId || '').trim();
  const qty = Number(quantity || 0);
  if (!wh || !qty) return false;
  let row = queryOne(
    'SELECT * FROM inventory_warehouse_stocks WHERE product_id = ? AND warehouse_id = ?',
    [productId, wh],
  );
  if (!row) {
    runSql(
      'INSERT INTO inventory_warehouse_stocks (id, product_id, warehouse_id, quantity, updated_at) VALUES (?, ?, ?, ?, datetime(\'now\'))',
      [uuidv4(), productId, wh, qty],
    );
  } else {
    runSql(
      "UPDATE inventory_warehouse_stocks SET quantity = ?, updated_at = datetime('now') WHERE id = ?",
      [Number(row.quantity || 0) + qty, row.id],
    );
  }
  recalculateProductStock(productId);
  return true;
}

/** Devuelve stock a almacén al anular un pedido (misma lógica que PUT /orders/:id/status → cancelled). */
function restoreNonTransformedStockForOrder(orderId) {
  const items = queryAll('SELECT * FROM order_items WHERE order_id = ?', [orderId]);
  items.forEach((item) => {
    const product = queryOne('SELECT * FROM products WHERE id = ?', [item.product_id]);
    if (!product) return;
    if (product.process_type !== 'non_transformed') return;
    const scoped = String(item.stock_warehouse_id || '').trim();
    if (scoped && addQuantityToWarehouse(product.id, scoped, Number(item.quantity || 0))) return;
    addToWarehouses(product, Number(item.quantity || 0));
  });
}

module.exports = {
  recalculateProductStock,
  ensureWarehouseRowsForProduct,
  ensureWarehouseRowsForProductTx,
  addToWarehouses,
  deductNonTransformedStockTx,
  addQuantityToWarehouseTx,
  restoreNonTransformedStockForOrder,
};
