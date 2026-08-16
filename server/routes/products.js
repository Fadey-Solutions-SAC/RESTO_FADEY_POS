const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, runSql } = require('../database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { emitInventoryUpdate, emitStaffDataUpdate } = require('../socketBroadcast');
const {
  attachScheduleStatus,
  filterAvailableProducts,
  parseScheduleFieldsFromBody,
  validateScheduleConfig,
  normalizeProductScheduleColumns,
  parseRestaurantSchedule,
} = require('../services/productScheduleService');
const { normalizeCatalogDisplayName } = require('../utils/catalogNameFormat');
const { parseProductMinStock } = require('../utils/productStockThreshold');
const { resolveProductProductionAreaId } = require('../services/productionAreasService');

const router = express.Router();

function ensureWarehouseInfrastructure() {
  runSql(`
    CREATE TABLE IF NOT EXISTS warehouse_locations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
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
}

function ensureDefaultWarehouses() {
  ensureWarehouseInfrastructure();
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
    const cocinaLegacy = queryOne(
      "SELECT id FROM warehouse_locations WHERE LOWER(name) = LOWER('Almacen Cocina') AND is_active = 1"
    );
    if (cocinaLegacy?.id) {
      runSql(
        "UPDATE warehouse_locations SET name = 'Almacen de insumos', description = 'Almacén vinculado a Inventario y Kardex', is_active = 1 WHERE id = ?",
        [cocinaLegacy.id]
      );
    } else {
      runSql(
        'INSERT INTO warehouse_locations (id, name, description, is_active) VALUES (?, ?, ?, 1)',
        [uuidv4(), 'Almacen de insumos', 'Almacén vinculado a Inventario y Kardex']
      );
    }
  }
}

function resolveWarehouseId(preferredWarehouseId) {
  ensureDefaultWarehouses();
  if (preferredWarehouseId) {
    const preferred = queryOne(
      'SELECT id FROM warehouse_locations WHERE id = ? AND is_active = 1',
      [preferredWarehouseId]
    );
    if (preferred?.id) return preferred.id;
  }
  const principal = queryOne(
    'SELECT id FROM warehouse_locations WHERE LOWER(name) = LOWER(?) AND is_active = 1',
    ['Almacen Principal']
  );
  if (principal?.id) return principal.id;
  const fallback = queryOne('SELECT id FROM warehouse_locations WHERE is_active = 1 ORDER BY name LIMIT 1');
  return fallback?.id || '';
}

function assertProductCategory(categoryIdRaw) {
  const id = String(categoryIdRaw ?? '').trim();
  if (!id) return { ok: false, error: 'Debe seleccionar una categoría' };
  const row = queryOne('SELECT id FROM categories WHERE id = ?', [id]);
  if (!row) return { ok: false, error: 'La categoría no existe' };
  return { ok: true, id };
}

/** Precio de compra opcional: null = sin costo de inversión registrado. */
function parseOptionalPurchasePrice(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return { error: 'Precio de compra inválido' };
  if (n === 0) return null;
  return n;
}

function upsertWarehouseStock(productId, warehouseId, quantity) {
  if (!warehouseId) return false;
  ensureWarehouseInfrastructure();
  const existing = queryOne(
    'SELECT id FROM inventory_warehouse_stocks WHERE product_id = ? AND warehouse_id = ?',
    [productId, warehouseId]
  );
  if (existing) {
    runSql(
      'UPDATE inventory_warehouse_stocks SET quantity = ?, updated_at = datetime(\'now\') WHERE id = ?',
      [Math.max(0, Number(quantity || 0)), existing.id]
    );
    return true;
  }
  runSql(
    'INSERT INTO inventory_warehouse_stocks (id, product_id, warehouse_id, quantity, updated_at) VALUES (?, ?, ?, ?, datetime(\'now\'))',
    [uuidv4(), productId, warehouseId, Math.max(0, Number(quantity || 0))]
  );
  return true;
}

/** Respuesta API: filas antiguas pueden tener process_type NULL → tratarlas como transformado en el cliente. */
function getRestaurantSchedule() {
  const restaurant = queryOne('SELECT schedule FROM restaurants LIMIT 1');
  return parseRestaurantSchedule(restaurant?.schedule);
}

function normalizeProductForClient(p, options = {}) {
  if (!p || typeof p !== 'object') return p;
  const pt = String(p.process_type ?? '').trim();
  if (!pt) p.process_type = 'transformed';
  normalizeProductScheduleColumns(p);
  if (options.attachSchedule !== false) {
    attachScheduleStatus(p, options.now || new Date(), options.restaurantSchedule ?? getRestaurantSchedule());
  }
  return p;
}

router.get('/', (req, res) => {
  const { category_id, active_only, search, available_now } = req.query;
  let query = 'SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE 1=1';
  const params = [];

  if (category_id) { query += ' AND p.category_id = ?'; params.push(category_id); }
  if (active_only === 'true') {
    query += ' AND p.is_active = 1';
    // Productos sin categoría quedan solo para gestión de almacén.
    query += " AND COALESCE(TRIM(p.category_id), '') <> ''";
  }
  if (search) { query += ' AND (p.name LIKE ? OR p.description LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  query += ' ORDER BY c.sort_order, p.name';

  const restaurantSchedule = getRestaurantSchedule();
  const now = new Date();
  let products = queryAll(query, params);
  const variants = queryAll('SELECT * FROM product_variants WHERE is_active = 1');
  const variantMap = {};
  variants.forEach(v => { if (!variantMap[v.product_id]) variantMap[v.product_id] = []; variantMap[v.product_id].push(v); });
  products.forEach((p) => {
    normalizeProductForClient(p, { now, restaurantSchedule });
    p.variants = variantMap[p.id] || [];
  });
  if (available_now === 'true') {
    products = filterAvailableProducts(products, now, restaurantSchedule);
  }
  res.json(products);
});

router.get('/:id', (req, res) => {
  const product = queryOne('SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?', [req.params.id]);
  if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
  normalizeProductForClient(product);
  product.variants = queryAll('SELECT * FROM product_variants WHERE product_id = ? AND is_active = 1', [req.params.id]);
  res.json(product);
});

router.post('/', authenticateToken, requireRole('admin'), (req, res) => {
  const {
    name,
    description,
    price,
    image,
    category_id,
    stock,
    variants,
    process_type,
    stock_warehouse_id,
    production_area,
    tax_type,
    modifier_id,
    note_required,
    kardex_insumo_id,
    kardex_insumo_num,
    kardex_insumo_den,
    kardex_insumo_modo,
    kardex_insumo_gramos,
    purchase_price,
    schedule_enabled,
    available_from,
    available_to,
    available_days,
    schedule_type,
    min_stock,
  } = req.body;
  const productName = normalizeCatalogDisplayName(name);
  if (!productName || price === undefined) return res.status(400).json({ error: 'Nombre y precio son requeridos' });

  const restaurant = queryOne('SELECT id, schedule FROM restaurants LIMIT 1');
  const scheduleFields = parseScheduleFieldsFromBody({
    schedule_enabled,
    available_from,
    available_to,
    available_days,
    schedule_type,
  });
  const scheduleValidation = validateScheduleConfig(scheduleFields, restaurant?.schedule);
  if (!scheduleValidation.ok) {
    return res.status(400).json({ error: scheduleValidation.error });
  }

  const parsedPurchase = parseOptionalPurchasePrice(purchase_price);
  if (parsedPurchase && typeof parsedPurchase === 'object' && parsedPurchase.error) {
    return res.status(400).json({ error: parsedPurchase.error });
  }

  const catPost = assertProductCategory(category_id);
  if (!catPost.ok) return res.status(400).json({ error: catPost.error });

  const id = uuidv4();
  const safeProcessType = process_type === 'non_transformed' ? 'non_transformed' : 'transformed';
  const safeStock = safeProcessType === 'transformed' ? 0 : Math.max(0, Number(stock || 0));
  const safeMinStock = safeProcessType === 'non_transformed' ? parseProductMinStock(min_stock) : 0;
  const safeWarehouseId = safeProcessType === 'transformed' ? '' : resolveWarehouseId(stock_warehouse_id);
  const safeProductionArea = resolveProductProductionAreaId(production_area);
  const safeTaxType = ['igv', 'exonerado', 'inafecto'].includes(String(tax_type || '').toLowerCase())
    ? String(tax_type).toLowerCase()
    : 'inafecto';
  const safeModifierId = String(modifier_id || '').trim();
  const safeNoteRequired = Number(note_required) === 1 ? 1 : 0;
  const safeKardexInsumo =
    safeProcessType === 'transformed' ? String(kardex_insumo_id || '').trim() : '';
  const modoRaw = String(kardex_insumo_modo || 'unidad').toLowerCase();
  const safeKardexModo = safeKardexInsumo && modoRaw === 'peso' ? 'peso' : 'unidad';
  let safeKardexNum = 1;
  let safeKardexDen = 1;
  let safeKardexGramos = 0;
  if (safeKardexInsumo) {
    if (safeKardexModo === 'peso') {
      const g = Number(kardex_insumo_gramos);
      safeKardexGramos = g > 0 && Number.isFinite(g) ? g : 0;
    } else {
      const n = Number(kardex_insumo_num);
      const d = Number(kardex_insumo_den);
      safeKardexNum = n > 0 && Number.isFinite(n) ? n : 1;
      safeKardexDen = d > 0 && Number.isFinite(d) ? d : 1;
    }
  }
  runSql(
    `INSERT INTO products (
      id, name, description, price, image, category_id, restaurant_id, stock,
      process_type, stock_warehouse_id, production_area, tax_type, modifier_id, note_required,
      kardex_insumo_id, kardex_insumo_num, kardex_insumo_den, kardex_insumo_modo, kardex_insumo_gramos,
      purchase_price,
      schedule_enabled, available_from, available_to, available_days, schedule_type,
      catalog_listed_at, idle_sales_days, min_stock
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 0, ?)`,
    [
      id,
      productName,
      description || '',
      price,
      image || '',
      catPost.id,
      restaurant?.id,
      safeStock,
      safeProcessType,
      safeWarehouseId,
      safeProductionArea,
      safeTaxType,
      safeModifierId,
      safeNoteRequired,
      safeKardexInsumo,
      safeKardexModo === 'peso' ? 1 : safeKardexNum,
      safeKardexModo === 'peso' ? 1 : safeKardexDen,
      safeKardexInsumo ? safeKardexModo : 'unidad',
      safeKardexInsumo ? safeKardexGramos : 0,
      parsedPurchase,
      scheduleFields.schedule_enabled,
      scheduleFields.available_from,
      scheduleFields.available_to,
      scheduleFields.available_days,
      scheduleFields.schedule_type,
      safeMinStock,
    ]
  );
  if (safeProcessType === 'non_transformed') {
    upsertWarehouseStock(id, safeWarehouseId, safeStock);
  }

  if (variants && variants.length > 0) {
    variants.forEach(v => runSql('INSERT INTO product_variants (id, product_id, name, price_modifier) VALUES (?, ?, ?, ?)', [uuidv4(), id, v.name, v.price_modifier || 0]));
  }

  const product = queryOne('SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?', [id]);
  product.variants = queryAll('SELECT * FROM product_variants WHERE product_id = ?', [id]);
  normalizeProductForClient(product);
  const payload = { ...product, schedule_warnings: scheduleValidation.warnings || [] };
  if (safeProcessType === 'non_transformed') {
    emitInventoryUpdate({ productId: id });
  }
  emitStaffDataUpdate({ domain: 'catalog' });
  res.status(201).json(payload);
});

router.put('/:id', authenticateToken, requireRole('admin'), (req, res) => {
  const {
    name,
    description,
    price,
    image,
    category_id,
    stock,
    is_active,
    variants,
    process_type,
    stock_warehouse_id,
    production_area,
    tax_type,
    modifier_id,
    note_required,
    kardex_insumo_id,
    kardex_insumo_num,
    kardex_insumo_den,
    kardex_insumo_modo,
    kardex_insumo_gramos,
    purchase_price,
    schedule_enabled,
    available_from,
    available_to,
    available_days,
    schedule_type,
    min_stock,
  } = req.body;
  const current = queryOne('SELECT * FROM products WHERE id = ?', [req.params.id]);
  if (!current) return res.status(404).json({ error: 'Producto no encontrado' });

  let scheduleWarnings = [];
  let scheduleUpdate = null;
  if (
    schedule_enabled !== undefined
    || available_from !== undefined
    || available_to !== undefined
    || available_days !== undefined
    || schedule_type !== undefined
  ) {
    const mergedScheduleBody = {
      schedule_enabled: schedule_enabled !== undefined ? schedule_enabled : current.schedule_enabled,
      available_from: available_from !== undefined ? available_from : current.available_from,
      available_to: available_to !== undefined ? available_to : current.available_to,
      available_days: available_days !== undefined ? available_days : current.available_days,
      schedule_type: schedule_type !== undefined ? schedule_type : current.schedule_type,
    };
    scheduleUpdate = parseScheduleFieldsFromBody(mergedScheduleBody);
    const restaurantRow = queryOne('SELECT schedule FROM restaurants LIMIT 1');
    const scheduleValidation = validateScheduleConfig(scheduleUpdate, restaurantRow?.schedule);
    if (!scheduleValidation.ok) {
      return res.status(400).json({ error: scheduleValidation.error });
    }
    scheduleWarnings = scheduleValidation.warnings || [];
  }

  let safePurchasePrice = undefined;
  if (purchase_price !== undefined) {
    const parsed = parseOptionalPurchasePrice(purchase_price);
    if (parsed && typeof parsed === 'object' && parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }
    safePurchasePrice = parsed;
  }
  const safeProcessType = process_type === 'non_transformed' ? 'non_transformed' : (process_type === 'transformed' ? 'transformed' : null);
  const finalProcessType = safeProcessType || current.process_type || 'transformed';
  const forceZeroStock = finalProcessType === 'transformed';
  /** Parches solo de imagen (p. ej. Auto pedido): no envían `stock`; null → COALESCE deja el valor en BD (sql.js rechaza `undefined`). */
  const nextStock = forceZeroStock ? 0 : (stock === undefined ? null : stock);
  const nextWarehouseId = forceZeroStock ? '' : resolveWarehouseId(stock_warehouse_id || current.stock_warehouse_id || '');
  const safeProductionArea = production_area === undefined
    ? null
    : resolveProductProductionAreaId(production_area);
  const safeTaxType = tax_type === undefined
    ? null
    : (['igv', 'exonerado', 'inafecto'].includes(String(tax_type || '').toLowerCase())
      ? String(tax_type).toLowerCase()
      : 'igv');
  const safeModifierId = modifier_id === undefined ? null : String(modifier_id || '').trim();
  const safeNoteRequired = note_required === undefined ? null : (Number(note_required) === 1 ? 1 : 0);
  const safeName = name === undefined ? null : normalizeCatalogDisplayName(name);
  const safeDescription = description === undefined ? null : description;
  const safePrice = price === undefined ? null : price;
  const safeImage = image === undefined ? null : image;
  let safeCategoryId = null;
  if (category_id !== undefined) {
    const catPut = assertProductCategory(category_id);
    if (!catPut.ok) return res.status(400).json({ error: catPut.error });
    safeCategoryId = catPut.id;
  }
  const safeIsActive = is_active === undefined ? null : is_active;

  const safeKardexInsumoUpd =
    kardex_insumo_id === undefined
      ? null
      : (finalProcessType === 'transformed' ? String(kardex_insumo_id || '').trim() : '');
  const safeKardexNumUpd = kardex_insumo_num === undefined ? null : Number(kardex_insumo_num);
  const safeKardexDenUpd = kardex_insumo_den === undefined ? null : Number(kardex_insumo_den);
  let finalKardexInsumo = safeKardexInsumoUpd === null ? (current.kardex_insumo_id || '') : safeKardexInsumoUpd;
  let finalKardexNum = safeKardexNumUpd === null || !Number.isFinite(safeKardexNumUpd) || safeKardexNumUpd <= 0
    ? (Number(current.kardex_insumo_num) > 0 ? Number(current.kardex_insumo_num) : 1)
    : safeKardexNumUpd;
  let finalKardexDen = safeKardexDenUpd === null || !Number.isFinite(safeKardexDenUpd) || safeKardexDenUpd <= 0
    ? (Number(current.kardex_insumo_den) > 0 ? Number(current.kardex_insumo_den) : 1)
    : safeKardexDenUpd;
  if (finalProcessType === 'non_transformed') {
    finalKardexInsumo = '';
    finalKardexNum = 1;
    finalKardexDen = 1;
  } else if (!String(finalKardexInsumo || '').trim()) {
    finalKardexNum = 1;
    finalKardexDen = 1;
  }

  const modoIn = kardex_insumo_modo === undefined
    ? null
    : String(kardex_insumo_modo || 'unidad').toLowerCase();
  const gramosIn = kardex_insumo_gramos === undefined ? null : Number(kardex_insumo_gramos);
  const currentModo = String(current.kardex_insumo_modo || 'unidad').toLowerCase() === 'peso' ? 'peso' : 'unidad';
  const finalKardexModo = finalProcessType === 'non_transformed' || !String(finalKardexInsumo || '').trim()
    ? 'unidad'
    : (modoIn === null
      ? currentModo
      : (modoIn === 'peso' ? 'peso' : 'unidad'));
  let finalKardexNumPut = finalProcessType === 'non_transformed' ? 1 : finalKardexNum;
  let finalKardexDenPut = finalProcessType === 'non_transformed' ? 1 : finalKardexDen;
  let finalKardexGramos = 0;
  if (finalProcessType === 'transformed' && String(finalKardexInsumo || '').trim()) {
    if (finalKardexModo === 'peso') {
      finalKardexNumPut = 1;
      finalKardexDenPut = 1;
      finalKardexGramos = gramosIn != null && Number.isFinite(gramosIn) && gramosIn > 0
        ? gramosIn
        : (Number(current.kardex_insumo_gramos) > 0 ? Number(current.kardex_insumo_gramos) : 0);
    } else {
      finalKardexGramos = 0;
    }
  }

  const finalMinStock = finalProcessType === 'non_transformed'
    ? (min_stock !== undefined ? parseProductMinStock(min_stock) : parseProductMinStock(current.min_stock))
    : 0;

  runSql(
    `UPDATE products SET
      name = COALESCE(?, name),
      description = COALESCE(?, description),
      price = COALESCE(?, price),
      image = COALESCE(?, image),
      category_id = COALESCE(?, category_id),
      stock = COALESCE(?, stock),
      is_active = COALESCE(?, is_active),
      process_type = COALESCE(?, process_type),
      stock_warehouse_id = COALESCE(?, stock_warehouse_id),
      production_area = COALESCE(?, production_area),
      tax_type = COALESCE(?, tax_type),
      modifier_id = COALESCE(?, modifier_id),
      note_required = COALESCE(?, note_required),
      kardex_insumo_id = ?,
      kardex_insumo_num = ?,
      kardex_insumo_den = ?,
      kardex_insumo_modo = ?,
      kardex_insumo_gramos = ?,
      purchase_price = ?,
      min_stock = ?,
      schedule_enabled = COALESCE(?, schedule_enabled),
      available_from = COALESCE(?, available_from),
      available_to = COALESCE(?, available_to),
      available_days = COALESCE(?, available_days),
      schedule_type = COALESCE(?, schedule_type),
      updated_at = datetime('now')
    WHERE id = ?`,
    [
      safeName,
      safeDescription,
      safePrice,
      safeImage,
      safeCategoryId,
      nextStock,
      safeIsActive,
      safeProcessType,
      nextWarehouseId,
      safeProductionArea,
      safeTaxType,
      safeModifierId,
      safeNoteRequired,
      finalProcessType === 'non_transformed' ? '' : (finalKardexInsumo || ''),
      finalProcessType === 'non_transformed' ? 1 : finalKardexNumPut,
      finalProcessType === 'non_transformed' ? 1 : finalKardexDenPut,
      finalProcessType === 'non_transformed' ? 'unidad' : finalKardexModo,
      finalProcessType === 'non_transformed' ? 0 : (finalKardexModo === 'peso' ? finalKardexGramos : 0),
      safePurchasePrice === undefined ? current.purchase_price : safePurchasePrice,
      finalMinStock,
      scheduleUpdate ? scheduleUpdate.schedule_enabled : null,
      scheduleUpdate ? scheduleUpdate.available_from : null,
      scheduleUpdate ? scheduleUpdate.available_to : null,
      scheduleUpdate ? scheduleUpdate.available_days : null,
      scheduleUpdate ? scheduleUpdate.schedule_type : null,
      req.params.id,
    ]
  );

  if (forceZeroStock) {
    runSql('DELETE FROM inventory_warehouse_stocks WHERE product_id = ?', [req.params.id]);
  } else if (finalProcessType === 'non_transformed' && stock !== undefined) {
    upsertWarehouseStock(req.params.id, nextWarehouseId || '', Math.max(0, Number(nextStock ?? 0)));
  }

  if (variants !== undefined) {
    runSql('DELETE FROM product_variants WHERE product_id = ?', [req.params.id]);
    variants.forEach(v => runSql('INSERT INTO product_variants (id, product_id, name, price_modifier) VALUES (?, ?, ?, ?)', [uuidv4(), req.params.id, v.name, v.price_modifier || 0]));
  }

  const product = queryOne('SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?', [req.params.id]);
  product.variants = queryAll('SELECT * FROM product_variants WHERE product_id = ?', [req.params.id]);
  normalizeProductForClient(product);
  if (stock !== undefined || forceZeroStock) {
    emitInventoryUpdate({ productId: req.params.id });
  }
  emitStaffDataUpdate({ domain: 'catalog' });
  res.json({ ...product, schedule_warnings: scheduleWarnings });
});

router.delete('/:id', authenticateToken, requireRole('admin'), (req, res) => {
  runSql('DELETE FROM inventory_warehouse_stocks WHERE product_id = ?', [req.params.id]);
  runSql('DELETE FROM inventory_logs WHERE product_id = ?', [req.params.id]);
  runSql('DELETE FROM product_variants WHERE product_id = ?', [req.params.id]);
  runSql('DELETE FROM products WHERE id = ?', [req.params.id]);
  emitInventoryUpdate({});
  emitStaffDataUpdate({ domain: 'catalog' });
  res.json({ success: true });
});

module.exports = router;
