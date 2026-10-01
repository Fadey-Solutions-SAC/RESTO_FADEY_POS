/**
 * Servicio central de Promociones: único lugar donde el backend decide precios promocionales.
 * Pedido QR, Mesas, Caja, Delivery y Reservas pasan por orderCreateService → priceOrderLinesTx.
 */
const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, runSql } = require('../database');
const engine = require('../../packages/shared-types/promotionEngine');
const { resolveRegionalTimezone, shiftBusinessDateKey, utcOffsetForTimezone } = require('../utils/appDateTime');

const PROMOTION_COLUMNS = [
  'name', 'description', 'type', 'value', 'status', 'start_date', 'end_date', 'no_end_date', 'days',
  'start_time', 'end_time', 'product_ids', 'category_ids', 'min_quantity', 'min_purchase', 'usage_limit',
  'per_customer_limit', 'combinable', 'priority',
];

let legacyMigrated = false;

function currentClock(q = queryOne) {
  return engine.clockFromDate(new Date(), resolveRegionalTimezone(q));
}

function safeQueryAll(sql, params = [], q = queryAll) {
  try {
    return q(sql, params) || [];
  } catch (_) {
    return [];
  }
}

/**
 * Convierte Ofertas y Descuentos antiguos a Promociones (una sola vez por registro).
 * Las tablas antiguas no se borran. Los descuentos genéricos quedan pausados porque nunca
 * se aplicaban solos: activarlos ahora cambiaría precios sin aviso.
 */
function ensureLegacyMigrated() {
  if (legacyMigrated) return;
  legacyMigrated = true;
  try {
    const migrated = new Set(
      safeQueryAll("SELECT legacy_source || ':' || legacy_id AS k FROM promotions WHERE IFNULL(legacy_source, '') != ''")
        .map((r) => r.k),
    );
    safeQueryAll('SELECT * FROM offers_catalog').forEach((o) => {
      if (migrated.has(`offers:${o.id}`)) return;
      const productIds = engine.parseIdList(o.products);
      const discount = Number(o.discount) || 0;
      const usable = Number(o.active) === 1 && productIds.length > 0 && discount > 0;
      runSql(
        `INSERT INTO promotions (id, name, description, type, value, status, start_date, end_date, no_end_date,
          product_ids, category_ids, legacy_source, legacy_id, created_at)
         VALUES (?, ?, ?, 'percent', ?, ?, ?, ?, ?, ?, '[]', 'offers', ?, COALESCE(?, datetime('now')))`,
        [
          uuidv4(),
          String(o.name || 'Oferta'),
          String(o.description || ''),
          Math.min(100, Math.max(0, discount)),
          usable ? 'active' : 'paused',
          String(o.start_date || '').slice(0, 10),
          String(o.end_date || '').slice(0, 10),
          o.end_date ? 0 : 1,
          JSON.stringify(productIds),
          o.id,
          o.created_at || null,
        ],
      );
    });
    safeQueryAll('SELECT * FROM discounts_catalog').forEach((d) => {
      if (migrated.has(`discounts:${d.id}`)) return;
      const appliesLabel = d.applies_to === 'total' ? 'total de la cuenta' : 'todos los productos';
      const note = `Migrado desde Descuentos (aplicaba a ${appliesLabel}). Elige productos o categorías antes de activarla.`;
      runSql(
        `INSERT INTO promotions (id, name, description, type, value, status, no_end_date, product_ids, category_ids,
          legacy_source, legacy_id, created_at)
         VALUES (?, ?, ?, ?, ?, 'paused', 1, '[]', '[]', 'discounts', ?, COALESCE(?, datetime('now')))`,
        [
          uuidv4(),
          String(d.name || 'Descuento'),
          [String(d.conditions || '').trim(), note].filter(Boolean).join(' · '),
          d.type === 'fixed' ? 'fixed' : 'percent',
          Number(d.value) || 0,
          d.id,
          d.created_at || null,
        ],
      );
    });
  } catch (err) {
    legacyMigrated = false;
    console.warn('[promotions] migración de ofertas/descuentos:', err.message || err);
  }
}

function usesCountMap(q = queryAll) {
  const rows = safeQueryAll(
    `SELECT pu.promotion_id, COUNT(DISTINCT pu.order_id) AS uses
     FROM promotion_usages pu
     JOIN orders o ON o.id = pu.order_id
     WHERE o.status != 'cancelled'
     GROUP BY pu.promotion_id`,
    [],
    q,
  );
  return Object.fromEntries(rows.map((r) => [r.promotion_id, Number(r.uses || 0)]));
}

function loadPromotions(q = queryAll, { migrate = true } = {}) {
  if (migrate) ensureLegacyMigrated();
  const uses = usesCountMap(q);
  return safeQueryAll('SELECT * FROM promotions ORDER BY priority DESC, created_at DESC', [], q).map((row) => ({
    ...row,
    uses: uses[row.id] || 0,
  }));
}

function customerUsesMap(customerId, q = queryAll) {
  const cid = String(customerId || '').trim();
  if (!cid) return {};
  const rows = safeQueryAll(
    `SELECT pu.promotion_id, COUNT(DISTINCT pu.order_id) AS uses
     FROM promotion_usages pu
     JOIN orders o ON o.id = pu.order_id
     WHERE o.status != 'cancelled' AND o.customer_id = ?
     GROUP BY pu.promotion_id`,
    [cid],
    q,
  );
  return Object.fromEntries(rows.map((r) => [r.promotion_id, Number(r.uses || 0)]));
}

/**
 * Recalcula precios de las líneas recién construidas con la promoción vigente.
 * Ignora cualquier precio enviado por el navegador: parte de `unit_price` calculado desde la BD.
 * Muta cada línea (unit_price, subtotal, original_unit_price, promo_discount, promotion_id, promotion_label).
 * @param {object} tx
 * @param {Array<object>} lines - líneas con product_id, unit_price, quantity, category_id, is_combo
 * @param {{ customerId?: string, preserveLines?: Map<string, object> }} opts
 * @returns {number} nuevo subtotal
 */
function priceOrderLinesTx(tx, lines, { customerId = '', preserveLines = null } = {}) {
  const promotions = loadPromotions(tx.queryAll, { migrate: false });
  const clock = currentClock(tx.queryOne);
  const pricingLines = [];
  lines.forEach((line, idx) => {
    line.original_unit_price = Number(line.unit_price || 0);
    line.promo_discount = 0;
    line.promotion_id = '';
    line.promotion_label = '';
    const kept = preserveLines && preserveLines.get(String(line.id));
    if (
      kept
      && String(kept.product_id || '') === String(line.product_id || '')
      && Number(kept.quantity || 0) === Number(line.quantity || 0)
      && Math.abs(Number(kept.original_unit_price ?? kept.unit_price ?? 0) - Number(line.unit_price || 0)) < 0.005
    ) {
      line.original_unit_price = Number(kept.original_unit_price ?? kept.unit_price ?? line.unit_price);
      line.unit_price = Number(kept.unit_price || 0);
      line.subtotal = Number(kept.subtotal || 0);
      line.promo_discount = Number(kept.promo_discount || 0);
      line.promotion_id = String(kept.promotion_id || '');
      line.promotion_label = String(kept.promotion_label || '');
      line.promo_preserved = true;
      return;
    }
    pricingLines.push({
      key: String(idx),
      product_id: line.product_id,
      category_id: line.category_id || '',
      unit_price: Number(line.unit_price || 0),
      quantity: Number(line.quantity || 0),
      is_combo: Boolean(line.is_combo),
    });
  });

  if (pricingLines.length && promotions.length) {
    const priced = engine.applyPromotions(pricingLines, promotions, {
      clock,
      customerUses: customerUsesMap(customerId, tx.queryAll),
    });
    pricingLines.forEach((pl) => {
      const r = priced.lines[pl.key];
      const line = lines[Number(pl.key)];
      if (!r || !line || !(r.discount > 0)) return;
      line.unit_price = r.final_unit_price;
      line.subtotal = r.final_total;
      line.promo_discount = r.discount;
      line.promotion_id = r.promotion_ids.join(',');
      line.promotion_label = r.promotion_ids.length > 1 ? `PROMO · ${r.promotion_name}` : `${r.badge} · ${r.promotion_name}`;
    });
  }

  return engine.round2(lines.reduce((s, l) => s + Number(l.subtotal || 0), 0));
}

function sourceFromActor(actor) {
  const kind = String(actor?.kind || '');
  if (kind === 'public_qr' || kind === 'public_customer') return 'pedido_qr';
  if (kind === 'customer') return 'cliente_web';
  return 'personal';
}

/**
 * Historial de auditoría: una fila por línea con promoción aplicada.
 * `syncOrder`: al editar un pedido conserva las filas de líneas sin cambios y rehace el resto.
 */
function recordPromotionUsagesTx(tx, orderId, lines, actor, { customerId = '', syncOrder = false } = {}) {
  let pending = lines || [];
  if (syncOrder) {
    const keepIds = pending.filter((l) => l.promo_preserved).map((l) => String(l.id));
    const existing = tx.queryAll('SELECT id, order_item_id FROM promotion_usages WHERE order_id = ?', [orderId]) || [];
    existing
      .filter((row) => !keepIds.includes(String(row.order_item_id)))
      .forEach((row) => tx.run('DELETE FROM promotion_usages WHERE id = ?', [row.id]));
    const recorded = new Set(existing.map((row) => String(row.order_item_id)));
    pending = pending.filter((l) => !(l.promo_preserved && recorded.has(String(l.id))));
  }
  const source = sourceFromActor(actor);
  const userId = actor?.user?.id || '';
  const userName = actor?.user?.full_name || actor?.user?.username || actor?.user?.name || (source === 'pedido_qr' ? 'Pedido QR' : '');
  pending.forEach((line) => {
    const discount = Number(line.promo_discount || 0);
    const promoIds = String(line.promotion_id || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!(discount > 0) || !promoIds.length) return;
    const qty = Number(line.quantity || 0);
    const original = engine.round2(Number(line.original_unit_price || 0) * qty);
    promoIds.forEach((pid, idx) => {
      const share = idx === 0 ? discount : 0;
      tx.run(
        `INSERT INTO promotion_usages (id, promotion_id, order_id, order_item_id, product_id, product_name, quantity,
          original_amount, discount_amount, final_amount, source, user_id, user_name, customer_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(), pid, orderId, line.id || '', line.product_id || '', line.product_name || '', qty,
          idx === 0 ? original : 0, share, idx === 0 ? Number(line.subtotal || 0) : 0,
          source, userId, userName, String(customerId || ''),
        ],
      );
    });
  });
}

function expandCategoryProducts(categoryIds) {
  if (!categoryIds.length) return [];
  const ph = categoryIds.map(() => '?').join(',');
  return safeQueryAll(`SELECT id FROM products WHERE category_id IN (${ph})`, categoryIds).map((r) => String(r.id));
}

/** Promociones que pueden aplicarse hoy (el cliente revisa día/hora con el mismo motor). */
function getActivePromotionsForClients() {
  const clock = currentClock();
  return loadPromotions()
    .map(engine.normalizePromotion)
    .filter((p) => engine.computePromotionStatus(p, clock) === 'active')
    .map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      type: p.type,
      value: p.value,
      status: p.status,
      start_date: p.start_date,
      end_date: p.end_date,
      no_end_date: p.no_end_date,
      days: p.days,
      start_time: p.start_time,
      end_time: p.end_time,
      product_ids: p.product_ids,
      category_ids: p.category_ids,
      expanded_product_ids: expandCategoryProducts(p.category_ids),
      min_quantity: p.min_quantity,
      min_purchase: p.min_purchase,
      usage_limit: p.usage_limit,
      per_customer_limit: p.per_customer_limit,
      combinable: p.combinable,
      priority: p.priority,
      uses: p.uses,
    }));
}

function statsByPromotion(fromKey = '', toKey = '') {
  const params = [];
  let dateSql = '';
  const offset = utcOffsetForTimezone(resolveRegionalTimezone(queryOne));
  if (fromKey) {
    dateSql += ` AND date(datetime(pu.created_at, '${offset}')) >= ?`;
    params.push(fromKey);
  }
  if (toKey) {
    dateSql += ` AND date(datetime(pu.created_at, '${offset}')) <= ?`;
    params.push(toKey);
  }
  return safeQueryAll(
    `SELECT pu.promotion_id,
            COUNT(DISTINCT pu.order_id) AS uses,
            COALESCE(SUM(pu.quantity), 0) AS items_sold,
            COALESCE(SUM(pu.discount_amount), 0) AS discount_total,
            COALESCE(SUM(pu.final_amount), 0) AS revenue_total,
            COALESCE(SUM(pu.original_amount), 0) AS original_total
     FROM promotion_usages pu
     JOIN orders o ON o.id = pu.order_id
     WHERE o.status != 'cancelled' ${dateSql}
     GROUP BY pu.promotion_id`,
    params,
  );
}

function decoratePromotion(row, clock, stats) {
  const p = engine.normalizePromotion(row);
  const s = stats || {};
  return {
    ...p,
    computed_status: engine.computePromotionStatus(p, clock),
    applicable_now: engine.isPromotionApplicableNow(p, clock),
    badge: engine.promotionBadgeLabel(p),
    legacy_source: row.legacy_source || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
    stats: {
      uses: Number(s.uses || 0),
      orders: Number(s.uses || 0),
      items_sold: Number(s.items_sold || 0),
      discount_total: engine.round2(s.discount_total),
      revenue_total: engine.round2(s.revenue_total),
      savings_total: engine.round2(s.discount_total),
    },
  };
}

function listPromotionsWithStats() {
  const clock = currentClock();
  const stats = Object.fromEntries(statsByPromotion().map((s) => [s.promotion_id, s]));
  const promotions = loadPromotions().map((row) => decoratePromotion(row, clock, stats[row.id]));

  const monthStart = `${clock.dateKey.slice(0, 8)}01`;
  const prevMonthStart = `${shiftBusinessDateKey(monthStart, -1).slice(0, 8)}01`;
  const prevMonthEnd = shiftBusinessDateKey(monthStart, -1);
  const sum = (rows, k) => rows.reduce((acc, r) => acc + Number(r[k] || 0), 0);
  const cur = statsByPromotion(monthStart, clock.dateKey);
  const prev = statsByPromotion(prevMonthStart, prevMonthEnd);

  const activeList = promotions.filter((p) => p.computed_status === 'active');
  const promotedProducts = new Set();
  activeList.forEach((p) => {
    p.product_ids.forEach((id) => promotedProducts.add(id));
    expandCategoryProducts(p.category_ids).forEach((id) => promotedProducts.add(id));
  });

  return {
    promotions,
    summary: {
      active: activeList.length,
      promoted_products: promotedProducts.size,
      uses_month: sum(cur, 'uses'),
      uses_prev_month: sum(prev, 'uses'),
      discount_month: engine.round2(sum(cur, 'discount_total')),
      discount_prev_month: engine.round2(sum(prev, 'discount_total')),
      discount_all_time: engine.round2(promotions.reduce((s, p) => s + p.stats.discount_total, 0)),
    },
  };
}

function getPromotionDetail(id) {
  const row = queryOne('SELECT * FROM promotions WHERE id = ?', [id]);
  if (!row) return null;
  const stats = statsByPromotion().find((s) => s.promotion_id === id);
  const uses = usesCountMap()[id] || 0;
  const detail = decoratePromotion({ ...row, uses }, currentClock(), stats);
  detail.recent_usages = safeQueryAll(
    `SELECT pu.*, o.order_number
     FROM promotion_usages pu
     LEFT JOIN orders o ON o.id = pu.order_id
     WHERE pu.promotion_id = ? AND IFNULL(o.status, '') != 'cancelled'
     ORDER BY pu.created_at DESC LIMIT 20`,
    [id],
  );
  return detail;
}

/** Normaliza el cuerpo del formulario a columnas de la tabla. */
function promotionBodyToRow(body = {}) {
  const p = engine.normalizePromotion({ ...body, uses: 0 });
  return {
    name: p.name.trim(),
    description: p.description.trim(),
    type: p.type,
    value: p.value,
    status: p.status,
    start_date: p.start_date,
    end_date: p.no_end_date ? '' : p.end_date,
    no_end_date: p.no_end_date ? 1 : 0,
    days: JSON.stringify(p.days),
    start_time: p.start_time,
    end_time: p.end_time,
    product_ids: JSON.stringify(p.product_ids),
    category_ids: JSON.stringify(p.type === 'combo' ? [] : p.category_ids),
    min_quantity: p.min_quantity,
    min_purchase: p.min_purchase,
    usage_limit: p.usage_limit,
    per_customer_limit: p.per_customer_limit,
    combinable: p.combinable ? 1 : 0,
    priority: p.priority,
  };
}

function createPromotion(body, userId = '') {
  const error = engine.validatePromotionInput(body);
  if (error) {
    const e = new Error(error);
    e.status = 400;
    throw e;
  }
  const row = promotionBodyToRow(body);
  const id = uuidv4();
  runSql(
    `INSERT INTO promotions (id, ${PROMOTION_COLUMNS.join(', ')}, created_by_user_id)
     VALUES (?, ${PROMOTION_COLUMNS.map(() => '?').join(', ')}, ?)`,
    [id, ...PROMOTION_COLUMNS.map((c) => row[c]), userId],
  );
  return getPromotionDetail(id);
}

function updatePromotion(id, body) {
  const existing = queryOne('SELECT * FROM promotions WHERE id = ?', [id]);
  if (!existing) return null;
  const merged = { ...engine.normalizePromotion(existing), ...body };
  const error = engine.validatePromotionInput(merged);
  if (error) {
    const e = new Error(error);
    e.status = 400;
    throw e;
  }
  const row = promotionBodyToRow(merged);
  runSql(
    `UPDATE promotions SET ${PROMOTION_COLUMNS.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`,
    [...PROMOTION_COLUMNS.map((c) => row[c]), id],
  );
  return getPromotionDetail(id);
}

function setPromotionStatus(id, status) {
  const existing = queryOne('SELECT * FROM promotions WHERE id = ?', [id]);
  if (!existing) return null;
  const next = status === 'paused' ? 'paused' : 'active';
  if (next === 'active') {
    const error = engine.validatePromotionInput({ ...existing, status: next });
    if (error) {
      const e = new Error(error);
      e.status = 400;
      throw e;
    }
  }
  runSql("UPDATE promotions SET status = ?, updated_at = datetime('now') WHERE id = ?", [next, id]);
  return getPromotionDetail(id);
}

function duplicatePromotion(id, userId = '') {
  const existing = queryOne('SELECT * FROM promotions WHERE id = ?', [id]);
  if (!existing) return null;
  const newId = uuidv4();
  const row = promotionBodyToRow({ ...existing, name: `${existing.name} (copia)`, status: 'paused' });
  runSql(
    `INSERT INTO promotions (id, ${PROMOTION_COLUMNS.join(', ')}, created_by_user_id)
     VALUES (?, ${PROMOTION_COLUMNS.map(() => '?').join(', ')}, ?)`,
    [newId, ...PROMOTION_COLUMNS.map((c) => row[c]), userId],
  );
  return getPromotionDetail(newId);
}

function deletePromotion(id) {
  const existing = queryOne('SELECT id FROM promotions WHERE id = ?', [id]);
  if (!existing) return false;
  runSql('DELETE FROM promotions WHERE id = ?', [id]);
  return true;
}

module.exports = {
  engine,
  ensureLegacyMigrated,
  loadPromotions,
  priceOrderLinesTx,
  recordPromotionUsagesTx,
  getActivePromotionsForClients,
  listPromotionsWithStats,
  getPromotionDetail,
  createPromotion,
  updatePromotion,
  setPromotionStatus,
  duplicatePromotion,
  deletePromotion,
};
