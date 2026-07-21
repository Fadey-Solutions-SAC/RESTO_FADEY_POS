const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, runSql, withTransaction, logAudit } = require('../database');
const kardexInventory = require('../services/kardexInventoryService');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { emitInventoryUpdate } = require('../socketBroadcast');
const {
  isNonTransformedLowStockSql,
  suggestedReplenishmentQty,
} = require('../utils/productStockThreshold');
const { resolvePurchaseDate, parsePurchaseDateInput } = require('../utils/inventoryPurchaseDate');

const router = express.Router();

const WAREHOUSE_CATEGORY_NAMES = {
  products: 'PRODUCTOS ALMACEN',
  supplies: 'INSUMOS',
};

function ensureWarehouseTables() {
  runSql(`
    CREATE TABLE IF NOT EXISTS warehouse_locations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      is_active INTEGER DEFAULT 1,
      linked_insumos INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  const whCols = queryAll('PRAGMA table_info(warehouse_locations)');
  if (!whCols.some((c) => c.name === 'linked_insumos')) {
    runSql('ALTER TABLE warehouse_locations ADD COLUMN linked_insumos INTEGER NOT NULL DEFAULT 0');
    runSql(
      `UPDATE warehouse_locations SET linked_insumos = 1 WHERE LOWER(name) LIKE '%insumo%' OR LOWER(description) LIKE '%inventario y kardex%'`
    );
  }
  runSql(`
    CREATE TABLE IF NOT EXISTS inventory_warehouse_stocks (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      warehouse_id TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(product_id, warehouse_id)
    )
  `);
  runSql(`
    CREATE TABLE IF NOT EXISTS inventory_requirements (
      id TEXT PRIMARY KEY,
      created_by TEXT,
      status TEXT DEFAULT 'pending',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      received_at TEXT
    )
  `);
  runSql(`
    CREATE TABLE IF NOT EXISTS inventory_requirement_items (
      id TEXT PRIMARY KEY,
      requirement_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      warehouse_id TEXT DEFAULT '',
      warehouse_name TEXT DEFAULT '',
      current_stock INTEGER DEFAULT 0,
      suggested_qty INTEGER DEFAULT 0,
      selected INTEGER DEFAULT 1,
      received_qty INTEGER DEFAULT 0,
      unit_cost REAL DEFAULT 0,
      total_cost REAL DEFAULT 0
    )
  `);
  const reqItemCols = queryAll('PRAGMA table_info(inventory_requirement_items)');
  if (!reqItemCols.some((c) => c.name === 'item_type')) {
    runSql("ALTER TABLE inventory_requirement_items ADD COLUMN item_type TEXT DEFAULT 'product'");
  }
  if (!reqItemCols.some((c) => c.name === 'insumo_id')) {
    runSql('ALTER TABLE inventory_requirement_items ADD COLUMN insumo_id TEXT');
  }
  if (!reqItemCols.some((c) => c.name === 'category_name')) {
    runSql("ALTER TABLE inventory_requirement_items ADD COLUMN category_name TEXT DEFAULT ''");
  }
  if (!reqItemCols.some((c) => c.name === 'price')) {
    runSql('ALTER TABLE inventory_requirement_items ADD COLUMN price REAL DEFAULT 0');
  }
  runSql(`
    CREATE TABLE IF NOT EXISTS inventory_expenses (
      id TEXT PRIMARY KEY,
      requirement_id TEXT,
      product_id TEXT,
      warehouse_id TEXT,
      quantity INTEGER DEFAULT 0,
      unit_cost REAL DEFAULT 0,
      total_cost REAL DEFAULT 0,
      notes TEXT DEFAULT '',
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      purchase_date TEXT DEFAULT NULL
    )
  `);
  const expenseCols = queryAll('PRAGMA table_info(inventory_expenses)');
  if (!expenseCols.some((c) => c.name === 'purchase_date')) {
    runSql('ALTER TABLE inventory_expenses ADD COLUMN purchase_date TEXT DEFAULT NULL');
    runSql(
      `UPDATE inventory_expenses
       SET purchase_date = date(datetime(created_at, 'localtime'))
       WHERE purchase_date IS NULL OR trim(purchase_date) = ''`,
    );
  }
  runSql(`
    CREATE TABLE IF NOT EXISTS inventory_reconciliations (
      id TEXT PRIMARY KEY,
      warehouse_id TEXT DEFAULT '',
      warehouse_name TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      total_items INTEGER DEFAULT 0,
      total_shortage REAL DEFAULT 0,
      total_surplus REAL DEFAULT 0,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  runSql(`
    CREATE TABLE IF NOT EXISTS inventory_reconciliation_items (
      id TEXT PRIMARY KEY,
      reconciliation_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      current_stock REAL DEFAULT 0,
      counted_stock REAL DEFAULT 0,
      difference REAL DEFAULT 0,
      unit_cost REAL DEFAULT 0,
      valuation REAL DEFAULT 0
    )
  `);
  const principal = queryOne(
    "SELECT id FROM warehouse_locations WHERE LOWER(name) = LOWER('Almacen Principal') AND is_active = 1"
  );
  const insumos = queryOne(
    "SELECT id FROM warehouse_locations WHERE LOWER(name) = LOWER('Almacen de insumos') AND is_active = 1"
  );
  if (!principal) {
    runSql(
      'INSERT INTO warehouse_locations (id, name, description, is_active) VALUES (?, ?, ?, 1)',
      [uuidv4(), 'Almacen Principal', 'Almacén principal para movimiento interno']
    );
  }
  if (!insumos) {
    const legacy = queryOne(
      "SELECT id FROM warehouse_locations WHERE LOWER(name) = LOWER('Almacen Cocina') AND is_active = 1"
    );
    if (legacy?.id) {
      runSql(
        "UPDATE warehouse_locations SET name = 'Almacen de insumos', description = 'Almacén vinculado a Inventario y Kardex', is_active = 1, linked_insumos = 1 WHERE id = ?",
        [legacy.id]
      );
    } else {
      runSql(
        'INSERT INTO warehouse_locations (id, name, description, is_active) VALUES (?, ?, ?, 1)',
        [uuidv4(), 'Almacen de insumos', 'Almacén vinculado a Inventario y Kardex']
      );
    }
  }
}

function getWarehouseByName(name) {
  ensureWarehouseTables();
  return queryOne('SELECT * FROM warehouse_locations WHERE LOWER(name) = LOWER(?) AND is_active = 1', [name]);
}

function getWarehouseStockRow(productId, warehouseId) {
  ensureWarehouseTables();
  return queryOne(
    'SELECT * FROM inventory_warehouse_stocks WHERE product_id = ? AND warehouse_id = ?',
    [productId, warehouseId]
  );
}

function recalculateProductStock(productId) {
  const totalByWarehouses = queryOne(
    'SELECT COALESCE(SUM(quantity), 0) as total FROM inventory_warehouse_stocks WHERE product_id = ?',
    [productId]
  );
  const total = Number(totalByWarehouses?.total || 0);
  runSql('UPDATE products SET stock = ?, updated_at = datetime(\'now\') WHERE id = ?', [total, productId]);
  emitInventoryUpdate({ productId });
  return total;
}

function ensureLegacyStockDistribution(productId, warehouseId) {
  const stockRows = queryAll('SELECT * FROM inventory_warehouse_stocks WHERE product_id = ?', [productId]);
  if (stockRows.length > 0) return;
  const product = queryOne('SELECT stock FROM products WHERE id = ?', [productId]);
  const legacyStock = Number(product?.stock || 0);
  if (legacyStock <= 0) return;
  runSql(
    'INSERT INTO inventory_warehouse_stocks (id, product_id, warehouse_id, quantity, updated_at) VALUES (?, ?, ?, ?, datetime(\'now\'))',
    [uuidv4(), productId, warehouseId, legacyStock]
  );
}

router.get('/stock', authenticateToken, requireRole('admin', 'cajero'), (req, res) => {
  res.json(queryAll('SELECT p.id, p.name, p.stock, p.price, c.name as category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.is_active = 1 ORDER BY p.stock ASC'));
});

router.get('/alerts', authenticateToken, requireRole('admin', 'cajero'), (req, res) => {
  res.json(queryAll(
    `SELECT p.id, p.name, p.stock, c.name as category_name
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE ${isNonTransformedLowStockSql('p')}
       AND p.is_active = 1
       AND p.process_type = 'non_transformed'
     ORDER BY p.stock ASC`
  ));
});

router.put('/adjust/:product_id', authenticateToken, requireRole('admin'), (req, res) => {
  const { quantity_change, reason } = req.body;
  if (quantity_change === undefined) return res.status(400).json({ error: 'Cantidad es requerida' });

  const product = queryOne('SELECT * FROM products WHERE id = ?', [req.params.product_id]);
  if (!product) return res.status(404).json({ error: 'Producto no encontrado' });

  const newStock = product.stock + quantity_change;
  if (newStock < 0) return res.status(400).json({ error: 'Stock no puede ser negativo' });

  runSql('UPDATE products SET stock = ? WHERE id = ?', [newStock, req.params.product_id]);
  runSql('INSERT INTO inventory_logs (id, product_id, quantity_change, previous_stock, new_stock, reason, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)', [uuidv4(), req.params.product_id, quantity_change, product.stock, newStock, reason || '', req.user.id]);
  emitInventoryUpdate({ productId: req.params.product_id });
  logAudit({
    actorUserId: req.user.id,
    actorName: req.user.full_name || req.user.username || '',
    action: 'inventory.adjust',
    resourceType: 'product',
    resourceId: req.params.product_id,
    details: { quantity_change, reason: reason || '' },
  });
  res.json({ product_id: req.params.product_id, previous_stock: product.stock, new_stock: newStock });
});

router.get('/logs', authenticateToken, requireRole('admin'), (req, res) => {
  const { product_id } = req.query;
  let query = 'SELECT il.*, p.name as product_name, u.full_name as user_name FROM inventory_logs il LEFT JOIN products p ON p.id = il.product_id LEFT JOIN users u ON u.id = il.created_by';
  const params = [];
  if (product_id) { query += ' WHERE il.product_id = ?'; params.push(product_id); }
  query += ' ORDER BY il.created_at DESC LIMIT 100';
  res.json(queryAll(query, params));
});

router.get('/suppliers', authenticateToken, requireRole('admin'), (req, res) => {
  res.json(queryAll('SELECT * FROM suppliers WHERE is_active = 1 ORDER BY name'));
});

router.get('/warehouses', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    ensureWarehouseTables();
    res.json(queryAll('SELECT * FROM warehouse_locations WHERE is_active = 1 ORDER BY name ASC'));
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudo listar almacenes' });
  }
});

router.post('/warehouses', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    ensureWarehouseTables();
    const { name, description, linked_insumos: linkedRaw } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Nombre de almacén es requerido' });
    }
    const exists = getWarehouseByName(name.trim());
    if (exists) return res.status(400).json({ error: 'Ya existe un almacén con ese nombre' });
    const linked =
      linkedRaw === true ||
      linkedRaw === 1 ||
      linkedRaw === '1' ||
      linkedRaw === 'true';
    const descLinked = 'Almacén vinculado a Inventario y Kardex';
    const desc = linked
      ? (String(description || '').trim() || descLinked)
      : String(description || '').trim();
    const id = uuidv4();
    runSql(
      'INSERT INTO warehouse_locations (id, name, description, is_active, linked_insumos) VALUES (?, ?, ?, 1, ?)',
      [id, name.trim(), desc, linked ? 1 : 0]
    );
    res.status(201).json(queryOne('SELECT * FROM warehouse_locations WHERE id = ?', [id]));
  } catch (err) {
    res.status(400).json({ error: err.message || 'No se pudo crear almacén' });
  }
});

router.delete('/warehouses/:id', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    ensureWarehouseTables();
    const warehouse = queryOne('SELECT * FROM warehouse_locations WHERE id = ? AND is_active = 1', [req.params.id]);
    if (!warehouse) return res.status(404).json({ error: 'Almacén no encontrado' });

    const usedCount = queryOne(
      `SELECT COUNT(*) as c
       FROM inventory_warehouse_stocks iws
       JOIN products p ON p.id = iws.product_id
       WHERE iws.warehouse_id = ?
         AND iws.quantity > 0
         AND p.is_active = 1`,
      [req.params.id]
    );
    if (Number(usedCount?.c || 0) > 0) {
      return res.status(400).json({ error: 'No se puede eliminar: el almacén tiene productos con stock' });
    }

    runSql('UPDATE products SET stock_warehouse_id = \'\' WHERE stock_warehouse_id = ?', [req.params.id]);
    runSql('DELETE FROM inventory_warehouse_stocks WHERE warehouse_id = ?', [req.params.id]);
    runSql('UPDATE warehouse_locations SET is_active = 0 WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudo eliminar el almacén' });
  }
});

router.get('/warehouse-stock', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    ensureWarehouseTables();
    const { category_type } = req.query;
    let productsQuery = `
      SELECT p.id, p.name, p.description, p.price, p.purchase_price, p.stock, p.min_stock, p.category_id, p.process_type, p.stock_warehouse_id, c.name as category_name
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.is_active = 1
    `;
    const params = [];
    if (category_type && WAREHOUSE_CATEGORY_NAMES[category_type]) {
      productsQuery += ' AND c.name = ?';
      params.push(WAREHOUSE_CATEGORY_NAMES[category_type]);
    }
    productsQuery += ' ORDER BY p.name ASC';

    const products = queryAll(productsQuery, params);
    const warehouses = queryAll('SELECT * FROM warehouse_locations WHERE is_active = 1 ORDER BY name ASC');
    const stockRows = queryAll(
      `SELECT iws.product_id, iws.warehouse_id, iws.quantity, wl.name as warehouse_name
       FROM inventory_warehouse_stocks iws
       JOIN warehouse_locations wl ON wl.id = iws.warehouse_id
       WHERE wl.is_active = 1`
    );

    const stockMap = {};
    stockRows.forEach(row => {
      if (!stockMap[row.product_id]) stockMap[row.product_id] = [];
      stockMap[row.product_id].push({
        warehouse_id: row.warehouse_id,
        warehouse_name: row.warehouse_name,
        quantity: Number(row.quantity || 0),
      });
    });

    const principal = getWarehouseByName('Almacen Principal') || warehouses[0];
    const result = products.map(product => {
      const warehouseStocks = stockMap[product.id] || [];
      if (warehouseStocks.length > 0) {
        const total = warehouseStocks.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
        return { ...product, warehouse_stocks: warehouseStocks, total_stock: total };
      }
      const fallbackRows = principal
        ? [{ warehouse_id: principal.id, warehouse_name: principal.name, quantity: Number(product.stock || 0) }]
        : [];
      return { ...product, warehouse_stocks: fallbackRows, total_stock: Number(product.stock || 0) };
    });

    res.json({ warehouses, products: result });
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudo obtener stock por almacén' });
  }
});

router.post('/requirements/low-stock', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    ensureWarehouseTables();
    const selectedProductIds = Array.isArray(req.body?.product_ids) ? req.body.product_ids : null;
    const selectedInsumoIds = Array.isArray(req.body?.insumo_ids) ? req.body.insumo_ids : null;
    const categoryId = String(req.body?.category_id || '').trim();
    const filterByCategory = Boolean(categoryId);
    const scopeAll = String(req.body?.scope || 'low_stock').trim() === 'all_catalog';
    const productSql = scopeAll
      ? `SELECT p.id, p.name, p.stock, p.min_stock, p.stock_warehouse_id, p.price, p.category_id,
                c.name as category_name
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.is_active = 1
           AND p.process_type = 'non_transformed'
         ORDER BY p.name ASC`
      : `SELECT p.id, p.name, p.stock, p.min_stock, p.stock_warehouse_id, p.price, p.category_id,
                c.name as category_name
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.is_active = 1
           AND p.process_type = 'non_transformed'
           AND ${isNonTransformedLowStockSql('p')}
         ORDER BY p.stock ASC, p.name ASC`;
    let lowStockProducts = queryAll(productSql);
    if (filterByCategory) {
      lowStockProducts = lowStockProducts.filter((p) => {
        if (categoryId === '__none__') return !String(p.category_id || '').trim();
        return String(p.category_id || '') === categoryId;
      });
    }
    lowStockProducts = lowStockProducts.filter((p) => !selectedProductIds || selectedProductIds.includes(p.id));

    const insumosBajo = filterByCategory || scopeAll
      ? []
      : queryAll(
      `SELECT id, nombre, stock_unidades, minimo_unidades, stock_actual, stock_minimo, unidad_medida, costo_promedio, kg_por_unidad,
              COALESCE(insumo_area, 'cocina') as insumo_area
       FROM insumos
       WHERE activo = 1
         AND (
           (minimo_unidades > 0 AND stock_unidades + 0.0001 < minimo_unidades)
           OR (stock_minimo > 0 AND stock_actual + 0.0001 < stock_minimo)
         )
       ORDER BY nombre`
    ).filter(
      (i) => !selectedInsumoIds || selectedInsumoIds.includes(i.id)
    );

    if (!lowStockProducts.length && !insumosBajo.length) {
      return res.status(400).json({
        error: scopeAll
          ? (filterByCategory
            ? 'No hay productos no transformables en la categoría seleccionada'
            : 'No hay productos no transformables activos para requerimiento')
          : filterByCategory
            ? 'No hay productos de almacén bajo mínimo en la categoría seleccionada'
            : 'No hay productos de almacén ni insumos kardex bajo mínimo para requerimiento',
      });
    }

    const principal = getWarehouseByName('Almacen Principal')
      || queryOne('SELECT * FROM warehouse_locations WHERE is_active = 1 ORDER BY name LIMIT 1');
    const requirementId = uuidv4();
    runSql(
      'INSERT INTO inventory_requirements (id, created_by, status) VALUES (?, ?, ?)',
      [requirementId, req.user.id, 'pending']
    );

    const insertItem = (it) => {
      runSql(
        `INSERT INTO inventory_requirement_items
        (id, requirement_id, product_id, product_name, warehouse_id, warehouse_name, current_stock, suggested_qty, selected, received_qty, unit_cost, total_cost, item_type, insumo_id, category_name, price)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          it.id,
          it.requirement_id,
          it.product_id,
          it.product_name,
          it.warehouse_id,
          it.warehouse_name,
          it.current_stock,
          it.suggested_qty,
          it.selected,
          it.received_qty,
          it.unit_cost,
          it.total_cost,
          it.item_type || 'product',
          it.insumo_id != null ? it.insumo_id : null,
          it.category_name != null ? it.category_name : '',
          it.price != null ? it.price : 0,
        ]
      );
    };

    const outItems = [];

    lowStockProducts.forEach((product) => {
      const warehouse = (product.stock_warehouse_id
        ? queryOne('SELECT * FROM warehouse_locations WHERE id = ? AND is_active = 1', [product.stock_warehouse_id])
        : null) || principal;
      const suggestedQty = suggestedReplenishmentQty(product.stock, product.min_stock);
      const item = {
        id: uuidv4(),
        requirement_id: requirementId,
        product_id: product.id,
        product_name: product.name,
        warehouse_id: warehouse?.id || '',
        warehouse_name: warehouse?.name || '',
        current_stock: Number(product.stock || 0),
        suggested_qty: suggestedQty,
        selected: 1,
        received_qty: 0,
        unit_cost: 0,
        total_cost: 0,
        item_type: 'product',
        insumo_id: null,
        category_name: product.category_name || 'Sin categoría',
        price: Number(product.price || 0),
      };
      insertItem(item);
      outItems.push(item);
    });

    insumosBajo.forEach((inm) => {
      const uAct = Number(inm.stock_unidades) || 0;
      const uMin = Number(inm.minimo_unidades) || 0;
      const sAct = Number(inm.stock_actual) || 0;
      const sMin = Number(inm.stock_minimo) || 0;
      const kpu = Number(inm.kg_por_unidad) || 0;
      const umc = String(inm.unidad_medida || 'kg')
        .replace(/[0-9]/g, '')
        .trim() || 'kg';

      let product_name;
      let suggestedQtyKg;
      let current_stock;
      const base = {
        id: uuidv4(),
        requirement_id: requirementId,
        product_id: inm.id,
        warehouse_id: principal?.id || '',
        warehouse_name: principal?.name || '—',
        selected: 1,
        received_qty: 0,
        unit_cost: 0,
        total_cost: 0,
        item_type: 'insumo',
        insumo_id: inm.id,
        category_name: 'Kardex insumos',
        price: Number(inm.costo_promedio || 0),
      };

      const bajoPorU = uMin > 0 && uAct + 0.0001 < uMin;
      const bajoPorM = sMin > 0 && sAct + 0.0001 < sMin;
      if (bajoPorU) {
        const faltU = Math.max(0, uMin - uAct);
        const suggestedU = faltU < 0.5 ? 1 : Math.max(0.1, faltU);
        suggestedQtyKg = kpu > 0 ? Math.round(suggestedU * kpu * 100) / 100 : 0;
        product_name = `[Kardex] ${inm.nombre} · faltan ≈${suggestedU.toFixed(2)} U (mín. ${uMin} U)`;
        current_stock = uAct;
        const item = {
          ...base,
          product_name,
          current_stock,
          suggested_qty: suggestedQtyKg,
          uom: umc,
          faltan_unidades: faltU,
          sugerir_unidades: suggestedU,
        };
        const row = { ...item };
        delete row.uom;
        delete row.faltan_unidades;
        delete row.sugerir_unidades;
        insertItem(row);
        outItems.push({ ...row, faltan_unidades: faltU, uom: umc });
      } else if (bajoPorM) {
        const faltKg = Math.max(0, sMin - sAct);
        suggestedQtyKg = faltKg < 0.01 ? 1 : Math.round(faltKg * 100) / 100;
        product_name = `[Kardex] ${inm.nombre} · faltan ≈${suggestedQtyKg.toFixed(2)} ${umc} (mín. ${sMin} ${umc})`;
        current_stock = sAct;
        const item = { ...base, product_name, current_stock, suggested_qty: suggestedQtyKg, uom: umc };
        const row = { ...item };
        delete row.uom;
        insertItem(row);
        outItems.push({ ...row, uom: umc });
      }
    });

    res.status(201).json({
      id: requirementId,
      status: 'pending',
      created_at: new Date().toISOString(),
      items: outItems,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudo crear requerimiento' });
  }
});

router.get('/requirements/latest', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    ensureWarehouseTables();
    const { status } = req.query;
    const allowedStatus = ['pending', 'received'].includes(status) ? status : null;
    const whereClause = allowedStatus ? 'WHERE status = ?' : '';
    const params = allowedStatus ? [allowedStatus] : [];
    const requirement = queryOne(
      `SELECT * FROM inventory_requirements
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT 1`
      , params
    );
    if (!requirement) return res.json(null);
    const items = queryAll(
      `SELECT iri.*, p.price
       FROM inventory_requirement_items iri
       LEFT JOIN products p ON p.id = iri.product_id
       WHERE iri.requirement_id = ?
       ORDER BY iri.product_name ASC`,
      [requirement.id]
    );
    res.json({ ...requirement, items });
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudo obtener requerimiento' });
  }
});

router.delete('/requirements/:id', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    ensureWarehouseTables();
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'Requerimiento no válido' });
    const requirement = queryOne('SELECT * FROM inventory_requirements WHERE id = ?', [id]);
    if (!requirement) return res.status(404).json({ error: 'Requerimiento no encontrado' });
    if (requirement.status !== 'pending') {
      return res.status(409).json({ error: 'Solo se puede eliminar un requerimiento pendiente' });
    }
    runSql('DELETE FROM inventory_requirement_items WHERE requirement_id = ?', [id]);
    runSql('DELETE FROM inventory_requirements WHERE id = ?', [id]);
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudo eliminar requerimiento' });
  }
});

router.post('/receptions/receive', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    ensureWarehouseTables();
    const { requirement_id, items, notes, purchase_date } = req.body;
    if (!requirement_id) return res.status(400).json({ error: 'Requerimiento es requerido' });
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Debes enviar items a recepcionar' });
    const purchaseDate = resolvePurchaseDate(purchase_date);

    const requirement = queryOne('SELECT * FROM inventory_requirements WHERE id = ?', [requirement_id]);
    if (!requirement) return res.status(404).json({ error: 'Requerimiento no encontrado' });
    if (requirement.status === 'received') {
      return res.status(409).json({ error: 'Este requerimiento ya fue recepcionado' });
    }

    let totalExpense = 0;
    let processed = 0;
    const principal = getWarehouseByName('Almacen Principal')
      || queryOne('SELECT * FROM warehouse_locations WHERE is_active = 1 ORDER BY name LIMIT 1');

    items.forEach(item => {
      const qty = Number(item.quantity || 0);
      const unitCost = Number(item.unit_cost || 0);
      if (qty <= 0) return;
      if (unitCost <= 0) {
        throw new Error('Debes ingresar costo de compra mayor a 0 para todos los items recepcionados');
      }
      const product = queryOne('SELECT * FROM products WHERE id = ?', [item.product_id]);
      if (!product) {
        const ins = queryOne('SELECT * FROM insumos WHERE id = ?', [item.product_id]);
        if (!ins) return;
        withTransaction((tx) => {
          kardexInventory.registrarCompraInsumos(
            tx,
            [{ insumo_id: ins.id, cantidad: qty, costo_unitario: unitCost, unidades: 0 }],
            req.user.id
          );
        });
        const totalCost = qty * unitCost;
        totalExpense += totalCost;
        processed += 1;
        runSql(
          `UPDATE inventory_requirement_items
             SET received_qty = COALESCE(received_qty, 0) + ?, unit_cost = ?, total_cost = COALESCE(total_cost, 0) + ?
             WHERE requirement_id = ? AND (product_id = ? OR insumo_id = ?)`,
          [qty, unitCost, totalCost, requirement_id, ins.id, ins.id]
        );
        runSql(
          `INSERT INTO inventory_expenses (id, requirement_id, product_id, warehouse_id, quantity, unit_cost, total_cost, notes, created_by, purchase_date)
             VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?)`,
          [uuidv4(), requirement_id, ins.id, qty, unitCost, totalCost, notes || 'Recepción kardex (insumo)', req.user.id, purchaseDate]
        );
        return;
      }

      const chosenWarehouseId = item.warehouse_id || product.stock_warehouse_id || principal?.id || '';
      const warehouse = queryOne('SELECT * FROM warehouse_locations WHERE id = ? AND is_active = 1', [chosenWarehouseId]) || principal;
      if (!warehouse) return;

      ensureLegacyStockDistribution(product.id, warehouse.id);
      let stockRow = getWarehouseStockRow(product.id, warehouse.id);
      if (!stockRow) {
        runSql(
          'INSERT INTO inventory_warehouse_stocks (id, product_id, warehouse_id, quantity, updated_at) VALUES (?, ?, ?, 0, datetime(\'now\'))',
          [uuidv4(), product.id, warehouse.id]
        );
        stockRow = getWarehouseStockRow(product.id, warehouse.id);
      }

      const previousWarehouseStock = Number(stockRow.quantity || 0);
      const newWarehouseStock = previousWarehouseStock + qty;
      runSql(
        'UPDATE inventory_warehouse_stocks SET quantity = ?, updated_at = datetime(\'now\') WHERE id = ?',
        [newWarehouseStock, stockRow.id]
      );

      const previousTotalStock = Number(product.stock || 0);
      const newTotalStock = recalculateProductStock(product.id);
      runSql(
        'INSERT INTO inventory_logs (id, product_id, quantity_change, previous_stock, new_stock, reason, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [uuidv4(), product.id, qty, previousTotalStock, newTotalStock, `Recepción de compra [${warehouse.name}]`, req.user.id]
      );

      const totalCost = qty * unitCost;
      totalExpense += totalCost;
      processed += 1;

      runSql(
        `UPDATE inventory_requirement_items
         SET received_qty = COALESCE(received_qty, 0) + ?, unit_cost = ?, total_cost = COALESCE(total_cost, 0) + ?
         WHERE requirement_id = ? AND product_id = ?`,
        [qty, unitCost, totalCost, requirement_id, product.id]
      );

      runSql(
        `INSERT INTO inventory_expenses (id, requirement_id, product_id, warehouse_id, quantity, unit_cost, total_cost, notes, created_by, purchase_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuidv4(), requirement_id, product.id, warehouse.id, qty, unitCost, totalCost, notes || 'Recepción de compra', req.user.id, purchaseDate]
      );
    });

    if (processed === 0) {
      return res.status(400).json({ error: 'No se procesaron items válidos' });
    }

    runSql(
      'UPDATE inventory_requirements SET status = ?, notes = COALESCE(?, notes), received_at = datetime(\'now\') WHERE id = ?',
      ['received', notes || '', requirement_id]
    );

    const openRegister = queryOne('SELECT * FROM cash_registers WHERE user_id = ? AND closed_at IS NULL', [req.user.id]);
    if (openRegister && totalExpense > 0) {
      runSql(
        'INSERT INTO cash_movements (id, register_id, user_id, type, amount, concept) VALUES (?, ?, ?, ?, ?, ?)',
        [uuidv4(), openRegister.id, req.user.id, 'expense', totalExpense, `Compra por recepción (${requirement_id.slice(0, 8)})`]
      );
    }
    logAudit({
      actorUserId: req.user.id,
      actorName: req.user.full_name || req.user.username || '',
      action: 'inventory.reception.receive',
      resourceType: 'inventory_requirement',
      resourceId: requirement_id,
      details: { processed_items: processed, total_expense: totalExpense },
    });

    emitInventoryUpdate({});
    res.json({ success: true, requirement_id, processed_items: processed, total_expense: totalExpense });
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudo registrar recepción' });
  }
});

function verifyAdminPassword(password) {
  const pwd = String(password || '');
  if (!pwd) return false;
  const admins = queryAll(
    `SELECT password_hash FROM users
     WHERE lower(trim(coalesce(role, ''))) IN ('admin', 'master_admin')
       AND coalesce(is_active, 1) = 1`,
  );
  return admins.some((row) => row.password_hash && bcrypt.compareSync(pwd, row.password_hash));
}

router.get('/expenses', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    ensureWarehouseTables();
    const expenses = queryAll(
      `SELECT ie.*,
              COALESCE(p.name, ins.nombre, 'Producto') as product_name,
              wl.name as warehouse_name
       FROM inventory_expenses ie
       LEFT JOIN products p ON p.id = ie.product_id
       LEFT JOIN insumos ins ON ins.id = ie.product_id
       LEFT JOIN warehouse_locations wl ON wl.id = ie.warehouse_id
       ORDER BY ie.created_at DESC
       LIMIT 100`
    );
    res.json(expenses);
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudo listar gastos' });
  }
});

router.put('/expenses', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    ensureWarehouseTables();
    const { admin_password, updates, notes, requirement_id, purchase_date } = req.body || {};
    if (!verifyAdminPassword(admin_password)) {
      return res.status(403).json({ error: 'Contraseña de administrador incorrecta' });
    }
    const rows = Array.isArray(updates) ? updates : [];
    const hasPurchaseDate = purchase_date !== undefined && purchase_date !== null && String(purchase_date).trim() !== '';
    const hasNotes = notes !== undefined;
    if (!rows.length && !hasNotes && !hasPurchaseDate) {
      return res.status(400).json({ error: 'No hay cambios para guardar' });
    }

    let changed = 0;
    if (hasPurchaseDate) {
      const pd = parsePurchaseDateInput(purchase_date);
      if (!pd) {
        return res.status(400).json({ error: 'Fecha de compra inválida (use AAAA-MM-DD)' });
      }
      if (requirement_id) {
        runSql('UPDATE inventory_expenses SET purchase_date = ? WHERE requirement_id = ?', [pd, String(requirement_id)]);
        changed += 1;
      } else {
        rows.forEach((row) => {
          const id = String(row?.id || '').trim();
          if (!id) return;
          runSql('UPDATE inventory_expenses SET purchase_date = ? WHERE id = ?', [pd, id]);
          changed += 1;
        });
      }
    }
    rows.forEach((row) => {
      const id = String(row?.id || '').trim();
      if (!id) return;
      const existing = queryOne('SELECT * FROM inventory_expenses WHERE id = ?', [id]);
      if (!existing) return;

      const qty = row.quantity != null ? Number(row.quantity) : Number(existing.quantity || 0);
      const unitCost = row.unit_cost != null ? Number(row.unit_cost) : Number(existing.unit_cost || 0);
      if (!Number.isFinite(qty) || qty < 0) {
        throw new Error('Cantidad inválida en uno de los ítems');
      }
      if (!Number.isFinite(unitCost) || unitCost < 0) {
        throw new Error('Precio unitario inválido en uno de los ítems');
      }
      const totalCost = Math.round(qty * unitCost * 100) / 100;

      runSql(
        `UPDATE inventory_expenses
         SET quantity = ?, unit_cost = ?, total_cost = ?
         WHERE id = ?`,
        [qty, unitCost, totalCost, id],
      );
      changed += 1;

      if (existing.requirement_id && existing.product_id) {
        runSql(
          `UPDATE inventory_requirement_items
           SET received_qty = ?, unit_cost = ?, total_cost = ?
           WHERE requirement_id = ? AND (product_id = ? OR insumo_id = ?)`,
          [qty, unitCost, totalCost, existing.requirement_id, existing.product_id, existing.product_id],
        );
      }
    });

    if (notes !== undefined && requirement_id) {
      runSql(
        'UPDATE inventory_expenses SET notes = ? WHERE requirement_id = ?',
        [String(notes || ''), String(requirement_id)],
      );
    }

    if (changed === 0 && !hasNotes && !hasPurchaseDate) {
      return res.status(400).json({ error: 'No se encontraron registros para actualizar' });
    }

    logAudit({
      actorUserId: req.user.id,
      actorName: req.user.full_name || req.user.username || '',
      action: 'inventory.expenses.update',
      resourceType: 'inventory_expense',
      resourceId: requirement_id || rows[0]?.id || '',
      details: { updated_rows: changed },
    });

    res.json({ success: true, updated: changed });
  } catch (err) {
    res.status(err.message?.includes('inválid') ? 400 : 500).json({
      error: err.message || 'No se pudo actualizar el gasto',
    });
  }
});

router.post('/reconciliations', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    ensureWarehouseTables();
    const { warehouse_id, notes, items } = req.body || {};
    if (!warehouse_id) return res.status(400).json({ error: 'Almacén es requerido para guardar el cuadre' });
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'No hay items para guardar en el cuadre' });

    const warehouse = queryOne('SELECT * FROM warehouse_locations WHERE id = ? AND is_active = 1', [warehouse_id]);
    if (!warehouse) return res.status(404).json({ error: 'Almacén no encontrado' });

    const parsedItems = [];
    items.forEach(rawItem => {
      if (!rawItem?.product_id) return;
      const countedStock = Number(rawItem.counted_stock);
      if (Number.isNaN(countedStock) || countedStock < 0) return;

      const product = queryOne('SELECT * FROM products WHERE id = ?', [rawItem.product_id]);
      if (!product) return;

      ensureLegacyStockDistribution(product.id, warehouse.id);
      let stockRow = getWarehouseStockRow(product.id, warehouse.id);
      if (!stockRow) {
        runSql(
          'INSERT INTO inventory_warehouse_stocks (id, product_id, warehouse_id, quantity, updated_at) VALUES (?, ?, ?, 0, datetime(\'now\'))',
          [uuidv4(), product.id, warehouse.id]
        );
        stockRow = getWarehouseStockRow(product.id, warehouse.id);
      }
      if (!stockRow) return;

      const currentStock = Number(stockRow.quantity || 0);
      const difference = countedStock - currentStock;
      const unitCost = Number(rawItem.unit_cost || product.price || 0);
      const valuation = unitCost * countedStock;

      if (difference !== 0) {
        runSql(
          'UPDATE inventory_warehouse_stocks SET quantity = ?, updated_at = datetime(\'now\') WHERE id = ?',
          [countedStock, stockRow.id]
        );
        const previousTotalStock = Number(product.stock || 0);
        const newTotalStock = recalculateProductStock(product.id);
        runSql(
          'INSERT INTO inventory_logs (id, product_id, quantity_change, previous_stock, new_stock, reason, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [uuidv4(), product.id, difference, previousTotalStock, newTotalStock, `Cuadre de inventario [${warehouse.name}]`, req.user.id]
        );
      }

      parsedItems.push({
        product_id: product.id,
        product_name: product.name || rawItem.product_name || '',
        current_stock: currentStock,
        counted_stock: countedStock,
        difference,
        unit_cost: unitCost,
        valuation,
      });
    });

    if (parsedItems.length === 0) return res.status(400).json({ error: 'No hay items válidos para guardar en el cuadre' });

    const totalShortage = parsedItems
      .filter(item => item.difference < 0)
      .reduce((sum, item) => sum + Math.abs(item.difference), 0);
    const totalSurplus = parsedItems
      .filter(item => item.difference > 0)
      .reduce((sum, item) => sum + item.difference, 0);

    const reconciliationId = uuidv4();
    runSql(
      `INSERT INTO inventory_reconciliations
      (id, warehouse_id, warehouse_name, notes, total_items, total_shortage, total_surplus, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        reconciliationId,
        warehouse.id,
        warehouse.name,
        notes || '',
        parsedItems.length,
        totalShortage,
        totalSurplus,
        req.user.id,
      ]
    );

    parsedItems.forEach(item => {
      runSql(
        `INSERT INTO inventory_reconciliation_items
        (id, reconciliation_id, product_id, product_name, current_stock, counted_stock, difference, unit_cost, valuation)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          reconciliationId,
          item.product_id,
          item.product_name,
          item.current_stock,
          item.counted_stock,
          item.difference,
          item.unit_cost,
          item.valuation,
        ]
      );
    });

    res.status(201).json({
      id: reconciliationId,
      warehouse_id: warehouse.id,
      warehouse_name: warehouse.name,
      total_items: parsedItems.length,
      total_shortage: totalShortage,
      total_surplus: totalSurplus,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudo guardar el cuadre de almacén' });
  }
});

router.get('/reconciliations', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    ensureWarehouseTables();
    const { warehouse_id } = req.query;
    let sql = `
      SELECT *
      FROM inventory_reconciliations
      WHERE 1=1
    `;
    const params = [];
    if (warehouse_id) {
      sql += ' AND warehouse_id = ?';
      params.push(warehouse_id);
    }
    sql += ' ORDER BY created_at DESC LIMIT 50';
    const reconciliations = queryAll(sql, params);

    const enriched = reconciliations.map(rec => {
      const items = queryAll(
        `SELECT *
         FROM inventory_reconciliation_items
         WHERE reconciliation_id = ?
         ORDER BY product_name ASC`,
        [rec.id]
      );
      return { ...rec, items };
    });

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudo listar los cuadres' });
  }
});

router.put('/warehouse-adjust/:product_id', authenticateToken, requireRole('admin'), (req, res) => {
  ensureWarehouseTables();
  const { warehouse_id, quantity_change, reason } = req.body;
  if (!warehouse_id) return res.status(400).json({ error: 'Almacén es requerido' });
  if (quantity_change === undefined || Number.isNaN(Number(quantity_change))) {
    return res.status(400).json({ error: 'Cantidad inválida' });
  }
  const delta = Number(quantity_change);
  if (delta === 0) return res.status(400).json({ error: 'Cantidad inválida' });

  const product = queryOne('SELECT * FROM products WHERE id = ?', [req.params.product_id]);
  if (!product) return res.status(404).json({ error: 'Producto no encontrado' });

  const warehouse = queryOne('SELECT * FROM warehouse_locations WHERE id = ? AND is_active = 1', [warehouse_id]);
  if (!warehouse) return res.status(404).json({ error: 'Almacén no encontrado' });

  ensureLegacyStockDistribution(req.params.product_id, warehouse_id);
  let stockRow = getWarehouseStockRow(req.params.product_id, warehouse_id);
  if (!stockRow) {
    runSql(
      'INSERT INTO inventory_warehouse_stocks (id, product_id, warehouse_id, quantity, updated_at) VALUES (?, ?, ?, 0, datetime(\'now\'))',
      [uuidv4(), req.params.product_id, warehouse_id]
    );
    stockRow = getWarehouseStockRow(req.params.product_id, warehouse_id);
  }

  const previousWarehouseStock = Number(stockRow.quantity || 0);
  const newWarehouseStock = previousWarehouseStock + delta;
  if (newWarehouseStock < 0) return res.status(400).json({ error: 'Stock insuficiente en el almacén seleccionado' });

  runSql(
    'UPDATE inventory_warehouse_stocks SET quantity = ?, updated_at = datetime(\'now\') WHERE id = ?',
    [newWarehouseStock, stockRow.id]
  );

  const previousTotalStock = Number(product.stock || 0);
  const newTotalStock = recalculateProductStock(req.params.product_id);

  const movementReason = `${reason || 'Ajuste de almacén'} [${warehouse.name}]`;
  runSql(
    'INSERT INTO inventory_logs (id, product_id, quantity_change, previous_stock, new_stock, reason, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [uuidv4(), req.params.product_id, delta, previousTotalStock, newTotalStock, movementReason, req.user.id]
  );

  res.json({
    product_id: req.params.product_id,
    warehouse_id,
    warehouse_name: warehouse.name,
    previous_warehouse_stock: previousWarehouseStock,
    new_warehouse_stock: newWarehouseStock,
    previous_total_stock: previousTotalStock,
    new_total_stock: newTotalStock,
  });
});

router.post('/warehouse-stock', authenticateToken, requireRole('admin'), (req, res) => {
  ensureWarehouseTables();
  const { product_id, warehouse_id, quantity } = req.body;
  if (!product_id || !warehouse_id) return res.status(400).json({ error: 'Producto y almacén son requeridos' });
  if (quantity === undefined || Number.isNaN(Number(quantity)) || Number(quantity) < 0) {
    return res.status(400).json({ error: 'Cantidad inválida' });
  }
  const product = queryOne('SELECT * FROM products WHERE id = ?', [product_id]);
  if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
  const warehouse = queryOne('SELECT * FROM warehouse_locations WHERE id = ? AND is_active = 1', [warehouse_id]);
  if (!warehouse) return res.status(404).json({ error: 'Almacén no encontrado' });

  ensureLegacyStockDistribution(product_id, warehouse_id);
  const existing = getWarehouseStockRow(product_id, warehouse_id);
  if (existing) {
    runSql(
      'UPDATE inventory_warehouse_stocks SET quantity = ?, updated_at = datetime(\'now\') WHERE id = ?',
      [Number(quantity), existing.id]
    );
  } else {
    runSql(
      'INSERT INTO inventory_warehouse_stocks (id, product_id, warehouse_id, quantity, updated_at) VALUES (?, ?, ?, ?, datetime(\'now\'))',
      [uuidv4(), product_id, warehouse_id, Number(quantity)]
    );
  }
  const total = recalculateProductStock(product_id);
  res.json({ success: true, product_id, warehouse_id, quantity: Number(quantity), total_stock: total });
});

router.post('/suppliers', authenticateToken, requireRole('admin'), (req, res) => {
  const { name, contact_name, phone, email, address } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre es requerido' });
  const restaurant = queryOne('SELECT id FROM restaurants LIMIT 1');
  const id = uuidv4();
  runSql('INSERT INTO suppliers (id, name, contact_name, phone, email, address, restaurant_id) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, name, contact_name || '', phone || '', email || '', address || '', restaurant?.id]);
  res.status(201).json(queryOne('SELECT * FROM suppliers WHERE id = ?', [id]));
});

router.post('/purchase-orders', authenticateToken, requireRole('admin'), (req, res) => {
  const { supplier_id, items, notes } = req.body;
  if (!items || items.length === 0) return res.status(400).json({ error: 'Debe incluir al menos un producto' });

  const restaurant = queryOne('SELECT id FROM restaurants LIMIT 1');
  const id = uuidv4();
  let total = 0;
  const orderItems = items.map(item => { const subtotal = item.quantity * item.unit_cost; total += subtotal; return { id: uuidv4(), purchase_order_id: id, ...item, subtotal }; });

  runSql('INSERT INTO purchase_orders (id, supplier_id, restaurant_id, total, notes) VALUES (?, ?, ?, ?, ?)', [id, supplier_id, restaurant?.id, total, notes || '']);
  orderItems.forEach(item => runSql('INSERT INTO purchase_order_items (id, purchase_order_id, product_id, product_name, quantity, unit_cost, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?)', [item.id, item.purchase_order_id, item.product_id, item.product_name, item.quantity, item.unit_cost, item.subtotal]));
  res.status(201).json({ id, total, items: orderItems });
});

router.put('/purchase-orders/:id/receive', authenticateToken, requireRole('admin'), (req, res) => {
  ensureWarehouseTables();
  const po = queryOne('SELECT * FROM purchase_orders WHERE id = ?', [req.params.id]);
  if (!po) return res.status(404).json({ error: 'Orden de compra no encontrada' });
  if (po.status === 'received') return res.status(409).json({ error: 'La orden de compra ya fue recepcionada' });
  if (po.status === 'cancelled') return res.status(400).json({ error: 'No puedes recepcionar una orden cancelada' });

  const items = queryAll('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?', [req.params.id]);
  const principal = getWarehouseByName('Almacen Principal')
    || queryOne('SELECT * FROM warehouse_locations WHERE is_active = 1 ORDER BY name LIMIT 1');
  if (!principal) return res.status(400).json({ error: 'No hay almacenes activos para recepcionar la compra' });
  const purchaseDate = resolvePurchaseDate(req.body?.purchase_date);
  try {
    withTransaction((tx) => {
      items.forEach((item) => {
        if (!item.product_id) return;
        const qty = Number(item.quantity || 0);
        const unitCost = Number(item.unit_cost || 0);
        if (qty <= 0) return;
        const product = tx.queryOne('SELECT * FROM products WHERE id = ?', [item.product_id]);
        if (!product) return;

        const stockRows = tx.queryAll('SELECT * FROM inventory_warehouse_stocks WHERE product_id = ? AND warehouse_id = ?', [item.product_id, principal.id]);
        if (!stockRows.length) {
          tx.run(
            'INSERT INTO inventory_warehouse_stocks (id, product_id, warehouse_id, quantity, updated_at) VALUES (?, ?, ?, 0, datetime(\'now\'))',
            [uuidv4(), item.product_id, principal.id]
          );
        }
        const row = tx.queryOne('SELECT * FROM inventory_warehouse_stocks WHERE product_id = ? AND warehouse_id = ?', [item.product_id, principal.id]);
        const previousWarehouseStock = Number(row?.quantity || 0);
        const newWarehouseStock = previousWarehouseStock + qty;
        tx.run(
          'UPDATE inventory_warehouse_stocks SET quantity = ?, updated_at = datetime(\'now\') WHERE id = ?',
          [newWarehouseStock, row.id]
        );
        const sum = tx.queryOne('SELECT COALESCE(SUM(quantity), 0) as total FROM inventory_warehouse_stocks WHERE product_id = ?', [item.product_id]);
        const previousTotal = Number(product.stock || 0);
        const newTotal = Number(sum?.total || 0);
        tx.run('UPDATE products SET stock = ?, updated_at = datetime(\'now\') WHERE id = ?', [newTotal, item.product_id]);
        tx.run(
          'INSERT INTO inventory_logs (id, product_id, quantity_change, previous_stock, new_stock, reason, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [uuidv4(), item.product_id, qty, previousTotal, newTotal, `Recepción OC ${req.params.id.slice(0, 8)} [${principal.name}]`, req.user.id]
        );
        tx.run(
          `INSERT INTO inventory_expenses (id, requirement_id, product_id, warehouse_id, quantity, unit_cost, total_cost, notes, created_by, purchase_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [uuidv4(), '', item.product_id, principal.id, qty, unitCost, qty * unitCost, `Recepción de orden de compra ${req.params.id}`, req.user.id, purchaseDate]
        );
      });
      tx.run("UPDATE purchase_orders SET status = 'received' WHERE id = ? AND status = 'pending'", [req.params.id]);
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'No se pudo recepcionar la orden de compra' });
  }
  const updated = queryOne('SELECT status FROM purchase_orders WHERE id = ?', [req.params.id]);
  if (updated?.status !== 'received') return res.status(409).json({ error: 'No se pudo marcar la recepción de forma idempotente' });
  logAudit({
    actorUserId: req.user.id,
    actorName: req.user.full_name || req.user.username || '',
    action: 'purchase_order.receive',
    resourceType: 'purchase_order',
    resourceId: req.params.id,
    details: { item_count: items.length },
  });
  emitInventoryUpdate({});
  res.json({ success: true, status: 'received' });
});

module.exports = router;
