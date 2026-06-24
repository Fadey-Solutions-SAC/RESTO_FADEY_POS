const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne } = require('./database');
const { getOrderItemsWithProductionArea } = require('./services/orderItemsProductionService');
const { normalizePaymentMethod } = require('./businessRules');
const {
  assertProductAvailableForOrder,
  parseRestaurantSchedule,
} = require('./services/productScheduleService');
const { computeKitchenReleaseAtForReservation } = require('./services/reservationKitchenHold');
const {
  findMergeableTableOrderTx,
  resolveExplicitMergeTargetTx,
  isOrderMergeableState,
  isWithinMergeWindowTx,
} = require('./services/tableOrderMergeService');
const { tableNumbersMatch } = require('./utils/tableNumberMatch');

function resolveDineInTableContextTx(tx, { tableId: tableIdRaw, tableNumber: tableNumberRaw } = {}) {
  const sentNumber = String(tableNumberRaw ?? '').trim();
  let tableId = String(tableIdRaw || '').trim();
  let row = null;
  if (tableId) {
    row = tx.queryOne('SELECT id, number, name FROM tables WHERE id = ?', [tableId]);
    if (!row) throw new Error('Mesa no encontrada');
  } else if (sentNumber) {
    row = tx.queryOne('SELECT id, number, name FROM tables WHERE TRIM(CAST(number AS TEXT)) = ? LIMIT 1', [
      sentNumber,
    ]);
    if (!row) throw new Error(`Mesa ${sentNumber} no encontrada`);
    tableId = String(row.id);
  } else {
    throw new Error('Mesa no especificada');
  }
  const canonicalNumber = String(row.number ?? '').trim();
  if (sentNumber && canonicalNumber && !tableNumbersMatch(sentNumber, canonicalNumber)) {
    throw new Error(
      `El número de mesa no coincide con la mesa seleccionada (enviado ${sentNumber}, actual ${canonicalNumber}). Cierre y vuelva a abrir el pedido.`,
    );
  }
  return {
    tableId: String(row.id),
    tableNumber: canonicalNumber,
    tableName: String(row.name || '').trim() || (canonicalNumber ? `Mesa ${canonicalNumber}` : ''),
  };
}

function getOrderWithItems(orderId) {
  const order = queryOne('SELECT * FROM orders WHERE id = ?', [orderId]);
  if (!order) return null;
  order.items = getOrderItemsWithProductionArea(orderId);
  return order;
}

/**
 * @param {*} tx - objeto de transacción (queryOne, queryAll, run)
 * @param {string} orderId
 * @param {object} body - mismo cuerpo que POST /orders
 * @param {{ kind: 'customer' | 'staff' | 'public_qr' | 'public_customer', user?: object, customerId?: string }} actor
 */
function buildComboOrderLine(tx, orderId, item) {
  const comboId = String(item.combo_id || '').trim();
  const combo = tx.queryOne('SELECT * FROM combos WHERE id = ? AND IFNULL(active, 1) = 1', [comboId]);
  if (!combo) throw new Error('Combo no encontrado o inactivo');
  const comboItems = tx.queryAll(
    `SELECT ci.*, p.name AS product_name, p.production_area
     FROM combo_items ci
     LEFT JOIN products p ON p.id = ci.product_id
     WHERE ci.combo_id = ?`,
    [comboId],
  );
  if (!comboItems.length) throw new Error(`El combo "${combo.name}" no tiene productos configurados`);
  const qty = Number(item.quantity || 0);
  if (qty <= 0) throw new Error(`Cantidad inválida para combo ${combo.name}`);
  const unitPrice = Number(combo.price || 0);
  const itemSubtotal = unitPrice * qty;
  const componentsLabel = comboItems
    .map((ci) => `${ci.product_name || 'Producto'} x${Number(ci.quantity || 1) * qty}`)
    .join(', ');
  const itemNote = String(item.notes || '').trim();
  const composedNotes = [`Incluye: ${componentsLabel}`, itemNote].filter(Boolean).join(' | ');
  return {
    line: {
      id: uuidv4(),
      order_id: orderId,
      product_id: comboItems[0]?.product_id || null,
      product_name: combo.name,
      variant_name: 'Combo',
      quantity: qty,
      unit_price: unitPrice,
      subtotal: itemSubtotal,
      notes: composedNotes,
      process_type: 'transformed',
    },
    subtotal: itemSubtotal,
  };
}

function buildOrderLinesFromPayload(tx, orderId, items, { orderNow, restaurantSchedule, staffInHouseOrder }) {
  let subtotalAdded = 0;
  const lines = items.map((item) => {
    if (String(item.combo_id || '').trim()) {
      const comboLine = buildComboOrderLine(tx, orderId, item);
      subtotalAdded += comboLine.subtotal;
      return comboLine.line;
    }

    const product = tx.queryOne('SELECT * FROM products WHERE id = ?', [item.product_id]);
    if (!product) throw new Error(`Producto no encontrado: ${item.product_id}`);
    assertProductAvailableForOrder(product, orderNow, restaurantSchedule);
    const qty = Number(item.quantity || 0);
    if (qty <= 0) throw new Error(`Cantidad inválida para ${product.name}`);
    const requiresStock = product.process_type === 'non_transformed';
    if (requiresStock) {
      const whSum = tx.queryOne(
        'SELECT COALESCE(SUM(quantity), 0) as total FROM inventory_warehouse_stocks WHERE product_id = ?',
        [product.id]
      );
      const available = Math.max(Number(product.stock || 0), Number(whSum?.total || 0));
      if (available < qty && !staffInHouseOrder) {
        throw new Error(`Stock insuficiente para ${product.name}`);
      }
    }
    const productModifierId = String(product.modifier_id || '').trim();
    let modifierName = '';
    let modifierOption = '';
    if (productModifierId) {
      const modifier = tx.queryOne('SELECT * FROM modifiers WHERE id = ?', [productModifierId]);
      if (modifier) {
        const requestedModifierId = String(item.modifier_id || '').trim();
        const requestedOption = String(item.modifier_option || '').trim();
        const availableOptions = tx
          .queryAll('SELECT option_name FROM modifier_options WHERE modifier_id = ?', [productModifierId])
          .map((row) => String(row.option_name || '').trim())
          .filter(Boolean);
        const isRequired = Number(modifier.required || 0) === 1;

        if (requestedModifierId && requestedModifierId !== productModifierId) {
          throw new Error(`El producto ${product.name} tiene un modificador inválido`);
        }
        if (isRequired && !requestedOption) {
          throw new Error(`El producto ${product.name} requiere seleccionar ${modifier.name}`);
        }
        if (requestedOption) {
          if (availableOptions.length > 0 && !availableOptions.includes(requestedOption)) {
            throw new Error(`La opción "${requestedOption}" no es válida para ${modifier.name}`);
          }
          modifierName = String(modifier.name || '').trim();
          modifierOption = requestedOption;
        }
      }
    }
    const unitPrice = Number(product.price || 0) + Number(item.price_modifier || 0);
    const itemNote = String(item.notes || '').trim();
    if (Number(product.note_required || 0) === 1 && !itemNote) {
      throw new Error(`El producto ${product.name} requiere una nota obligatoria`);
    }
    const itemSubtotal = unitPrice * qty;
    subtotalAdded += itemSubtotal;
    const composedNotes = [itemNote, modifierName && modifierOption ? `${modifierName}: ${modifierOption}` : ''].filter(Boolean).join(' | ');
    return {
      id: uuidv4(),
      order_id: orderId,
      product_id: product.id,
      product_name: product.name,
      variant_name: item.variant_name || '',
      quantity: qty,
      unit_price: unitPrice,
      subtotal: itemSubtotal,
      notes: composedNotes,
      process_type: product.process_type,
    };
  });
  return { lines, subtotalAdded };
}

function insertOrderLineRows(tx, orderItems, { staffInHouseOrder, highlightNew = false, highlightIdSet = null }) {
  const newIds = [];
  orderItems.forEach((item) => {
    if (item.process_type === 'non_transformed') {
      const stockRows = tx.queryAll(
        'SELECT id, quantity FROM inventory_warehouse_stocks WHERE product_id = ? ORDER BY quantity DESC',
        [item.product_id]
      );
      let pending = Number(item.quantity || 0);
      for (const row of stockRows) {
        if (pending <= 0) break;
        const available = Number(row.quantity || 0);
        if (available <= 0) continue;
        const consume = Math.min(available, pending);
        tx.run(
          'UPDATE inventory_warehouse_stocks SET quantity = ?, updated_at = datetime(\'now\') WHERE id = ?',
          [available - consume, row.id]
        );
        pending -= consume;
      }
      if (pending > 0 && !staffInHouseOrder) {
        throw new Error(`No hay stock suficiente en almacenes para ${item.product_name}`);
      }
      const newSum = tx.queryOne(
        'SELECT COALESCE(SUM(quantity), 0) as total FROM inventory_warehouse_stocks WHERE product_id = ?',
        [item.product_id]
      );
      tx.run('UPDATE products SET stock = ?, updated_at = datetime(\'now\') WHERE id = ?', [Number(newSum?.total || 0), item.product_id]);
    }
    const shouldHighlight =
      highlightNew || (highlightIdSet instanceof Set && highlightIdSet.has(String(item.id)));
    if (shouldHighlight) {
      tx.run(
        `INSERT INTO order_items (id, order_id, product_id, product_name, variant_name, quantity, unit_price, subtotal, notes, kitchen_highlight_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [item.id, item.order_id, item.product_id, item.product_name, item.variant_name, item.quantity, item.unit_price, item.subtotal, item.notes]
      );
    } else {
      tx.run(
        'INSERT INTO order_items (id, order_id, product_id, product_name, variant_name, quantity, unit_price, subtotal, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [item.id, item.order_id, item.product_id, item.product_name, item.variant_name, item.quantity, item.unit_price, item.subtotal, item.notes]
      );
    }
    newIds.push(item.id);
  });
  return newIds;
}

function reopenProductionStationsForNewLines(tx, orderId, lineIds) {
  if (!lineIds.length) return;
  const ph = lineIds.map(() => '?').join(',');
  const rows = tx.queryAll(
    `SELECT oi.id,
            COALESCE(NULLIF(TRIM(p.production_area), ''), 'cocina') AS production_area
     FROM order_items oi
     LEFT JOIN products p ON p.id = oi.product_id
     WHERE oi.id IN (${ph})`,
    lineIds
  );
  const hasKitchen = rows.some((r) => String(r.production_area || '').toLowerCase() !== 'bar');
  const hasBar = rows.some((r) => String(r.production_area || '').toLowerCase() === 'bar');
  if (hasKitchen) {
    tx.run(
      `UPDATE orders SET station_cocina_ready_at = NULL,
        station_cocina_preparing_at = CASE
          WHEN TRIM(COALESCE(station_cocina_preparing_at, '')) != '' THEN station_cocina_preparing_at
          ELSE datetime('now') END,
        updated_at = datetime('now')
       WHERE id = ?`,
      [orderId]
    );
  }
  if (hasBar) {
    tx.run(
      `UPDATE orders SET station_bar_ready_at = NULL,
        station_bar_preparing_at = CASE
          WHEN TRIM(COALESCE(station_bar_preparing_at, '')) != '' THEN station_bar_preparing_at
          ELSE datetime('now') END,
        updated_at = datetime('now')
       WHERE id = ?`,
      [orderId]
    );
  }
}

/**
 * Agrega productos a una comanda existente (misma mesa, ventana 40 min).
 * Si la comanda ya no admite fusión, createOrMergeTableOrderInTransaction crea una nueva.
 */
function appendItemsToOrderInTransaction(tx, orderId, items, actor, { notes } = {}) {
  const order = tx.queryOne('SELECT * FROM orders WHERE id = ?', [orderId]);
  if (!order) throw new Error('Pedido no encontrado');
  if (order.type !== 'dine_in') throw new Error('Solo se pueden fusionar pedidos de mesa');
  if (!['pending', 'preparing', 'ready'].includes(String(order.status || ''))) {
    throw new Error('La comanda ya no admite productos adicionales');
  }
  if (String(order.payment_status || 'pending') !== 'pending') {
    throw new Error('No se pueden agregar productos a una comanda cobrada');
  }

  const staffInHouseOrder =
    actor.kind === 'staff' &&
    actor.user &&
    actor.user.type !== 'customer' &&
    ['admin', 'cajero', 'mozo', 'cocina', 'bar'].includes(String(actor.user.role || ''));

  const restaurantRow = tx.queryOne('SELECT schedule FROM restaurants LIMIT 1');
  const restaurantSchedule = parseRestaurantSchedule(restaurantRow?.schedule);
  const orderNow = new Date();

  const { lines, subtotalAdded } = buildOrderLinesFromPayload(tx, orderId, items, {
    orderNow,
    restaurantSchedule,
    staffInHouseOrder,
  });
  const newItemIds = insertOrderLineRows(tx, lines, { staffInHouseOrder, highlightNew: true });

  const nextSubtotal = round2(Number(order.subtotal || 0) + subtotalAdded);
  const discountAmount = Number(order.discount || 0);
  const deliveryFee = Number(order.delivery_fee || 0);
  const nextTotal = Math.max(0, nextSubtotal - discountAmount + deliveryFee);
  const noteAppend = String(notes || '').trim();

  if (noteAppend) {
    tx.run(
      `UPDATE orders SET subtotal = ?, total = ?, kitchen_last_send_at = datetime('now'),
       notes = TRIM(COALESCE(notes, '') || CASE WHEN TRIM(COALESCE(notes, '')) = '' THEN '' ELSE ' | ' END || ?),
       updated_at = datetime('now') WHERE id = ?`,
      [nextSubtotal, nextTotal, noteAppend, orderId]
    );
  } else {
    tx.run(
      "UPDATE orders SET subtotal = ?, total = ?, kitchen_last_send_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      [nextSubtotal, nextTotal, orderId]
    );
  }

  reopenProductionStationsForNewLines(tx, orderId, newItemIds);

  return { orderId, newItemIds, merged: true };
}

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function syncOrderTableIdTx(tx, orderId, tableId) {
  const tid = String(tableId || '').trim();
  if (!tid || !orderId) return;
  tx.run("UPDATE orders SET table_id = ? WHERE id = ? AND IFNULL(TRIM(table_id), '') = ''", [tid, orderId]);
}

/** Intenta fusionar; si la comanda ya no admite merge, devuelve null (el caller crea comanda nueva). */
function tryAppendToMergeableOrderTx(tx, targetOrder, body, actor, tableId) {
  if (!targetOrder?.id) return null;
  if (!isOrderMergeableState(targetOrder)) return null;
  if (!isWithinMergeWindowTx(tx, targetOrder)) return null;
  try {
    syncOrderTableIdTx(tx, targetOrder.id, tableId);
    return appendItemsToOrderInTransaction(tx, targetOrder.id, body.items, actor, { notes: body.notes });
  } catch (err) {
    const msg = String(err.message || '').toLowerCase();
    if (
      msg.includes('comanda') ||
      msg.includes('cobrada') ||
      msg.includes('admite productos') ||
      msg.includes('fusionar')
    ) {
      return null;
    }
    throw err;
  }
}

function createOrMergeTableOrderInTransaction(tx, orderId, body, actor) {
  const orderType = ['dine_in', 'delivery', 'pickup'].includes(body.type) ? body.type : 'dine_in';
  let tableNumber = String(body.table_number || '').trim();
  let tableId = String(body.table_id || '').trim();
  const targetOrderId = String(body.target_order_id || '').trim();
  if (orderType === 'dine_in' && (tableId || tableNumber) && !body.hold_kitchen_for_reservation) {
    const resolved = resolveDineInTableContextTx(tx, { tableId, tableNumber });
    tableId = resolved.tableId;
    tableNumber = resolved.tableNumber;
    body = {
      ...body,
      table_id: tableId,
      table_number: tableNumber,
      customer_name: String(body.customer_name || '').trim() || resolved.tableName,
    };
    if (targetOrderId) {
      const explicit = resolveExplicitMergeTargetTx(tx, targetOrderId, { tableId, tableNumberRaw: tableNumber });
      const merged = tryAppendToMergeableOrderTx(tx, explicit, body, actor, tableId);
      if (merged) return merged;
    }
    const existing = findMergeableTableOrderTx(tx, tableNumber, { tableId });
    const merged = tryAppendToMergeableOrderTx(tx, existing, body, actor, tableId);
    if (merged) return merged;
  }
  const created = createOrderInTransaction(tx, orderId, body, actor);
  tx.run(
    "UPDATE orders SET kitchen_last_send_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
    [created.orderId]
  );
  return { ...created, merged: false, newItemIds: [] };
}

function createOrderInTransaction(tx, orderId, body, actor) {
  const {
    items,
    type,
    table_number,
    table_id: tableIdBody,
    delivery_address,
    notes,
    payment_method,
    delivery_payment_modality,
    customer_name,
    discount,
    customer_id,
    hold_kitchen_for_reservation,
    reservation_date,
    reservation_time,
  } = body;

  const orderType = ['dine_in', 'delivery', 'pickup'].includes(type) ? type : 'dine_in';

  const restaurant = tx.queryOne('SELECT * FROM restaurants LIMIT 1');
  if (orderType === 'delivery' && Number(restaurant?.delivery_enabled) !== 1) {
    throw new Error('Delivery no está habilitado en este restaurante');
  }

  const staffInHouseOrder =
    actor.kind === 'staff' &&
    (orderType === 'dine_in' || orderType === 'pickup') &&
    actor.user &&
    actor.user.type !== 'customer' &&
    ['admin', 'cajero', 'mozo', 'cocina', 'bar'].includes(String(actor.user.role || ''));

  const restaurantSchedule = parseRestaurantSchedule(restaurant?.schedule);
  const orderNow = new Date();
  let seq = tx.queryOne('SELECT current_number FROM order_sequence WHERE id = 1');
  if (!seq) {
    tx.run('INSERT INTO order_sequence (id, current_number) VALUES (1, 0)');
    seq = { current_number: 0 };
  }
  const orderNumber = Number(seq.current_number || 0) + 1;
  tx.run('UPDATE order_sequence SET current_number = ? WHERE id = 1', [orderNumber]);

  let subtotal = 0;
  const orderItems = items.map((item) => {
    if (String(item.combo_id || '').trim()) {
      const comboLine = buildComboOrderLine(tx, orderId, item);
      subtotal += comboLine.subtotal;
      return comboLine.line;
    }

    const product = tx.queryOne('SELECT * FROM products WHERE id = ?', [item.product_id]);
    if (!product) throw new Error(`Producto no encontrado: ${item.product_id}`);
    assertProductAvailableForOrder(product, orderNow, restaurantSchedule);
    const qty = Number(item.quantity || 0);
    if (qty <= 0) throw new Error(`Cantidad inválida para ${product.name}`);
    const requiresStock = product.process_type === 'non_transformed';
    if (requiresStock) {
      const whSum = tx.queryOne(
        'SELECT COALESCE(SUM(quantity), 0) as total FROM inventory_warehouse_stocks WHERE product_id = ?',
        [product.id]
      );
      const available = Math.max(Number(product.stock || 0), Number(whSum?.total || 0));
      if (available < qty && !staffInHouseOrder) {
        throw new Error(`Stock insuficiente para ${product.name}`);
      }
    }
    const productModifierId = String(product.modifier_id || '').trim();
    let modifierName = '';
    let modifierOption = '';
    if (productModifierId) {
      const modifier = tx.queryOne('SELECT * FROM modifiers WHERE id = ?', [productModifierId]);
      if (modifier) {
        const requestedModifierId = String(item.modifier_id || '').trim();
        const requestedOption = String(item.modifier_option || '').trim();
        const availableOptions = tx
          .queryAll('SELECT option_name FROM modifier_options WHERE modifier_id = ?', [productModifierId])
          .map((row) => String(row.option_name || '').trim())
          .filter(Boolean);
        const isRequired = Number(modifier.required || 0) === 1;

        if (requestedModifierId && requestedModifierId !== productModifierId) {
          throw new Error(`El producto ${product.name} tiene un modificador inválido`);
        }
        if (isRequired && !requestedOption) {
          throw new Error(`El producto ${product.name} requiere seleccionar ${modifier.name}`);
        }
        if (requestedOption) {
          if (availableOptions.length > 0 && !availableOptions.includes(requestedOption)) {
            throw new Error(`La opción "${requestedOption}" no es válida para ${modifier.name}`);
          }
          modifierName = String(modifier.name || '').trim();
          modifierOption = requestedOption;
        }
      }
    }
    const unitPrice = Number(product.price || 0) + Number(item.price_modifier || 0);
    const itemNote = String(item.notes || '').trim();
    if (Number(product.note_required || 0) === 1 && !itemNote) {
      throw new Error(`El producto ${product.name} requiere una nota obligatoria`);
    }
    const itemSubtotal = unitPrice * qty;
    subtotal += itemSubtotal;
    const composedNotes = [itemNote, modifierName && modifierOption ? `${modifierName}: ${modifierOption}` : ''].filter(Boolean).join(' | ');
    return {
      id: uuidv4(),
      order_id: orderId,
      product_id: product.id,
      product_name: product.name,
      variant_name: item.variant_name || '',
      quantity: qty,
      unit_price: unitPrice,
      subtotal: itemSubtotal,
      notes: composedNotes,
      process_type: product.process_type,
    };
  });

  const tax = 0;
  const discountAmount = Math.max(0, Number(discount || 0));
  const deliveryFee = orderType === 'delivery' ? Number(restaurant?.delivery_fee || 0) : 0;
  const total = Math.max(0, subtotal - discountAmount + deliveryFee);

  let customerId = null;
  if (actor.kind === 'customer' && actor.user) {
    customerId = actor.user.id;
  } else if (actor.kind === 'staff') {
    customerId = String(customer_id || '').trim() || null;
  } else if (actor.kind === 'public_customer' && actor.customerId) {
    customerId = String(actor.customerId).trim() || null;
  }
  if (customerId) {
    const customer = tx.queryOne('SELECT id, name FROM customers WHERE id = ?', [customerId]);
    if (!customer) throw new Error('Cliente no encontrado para el pedido');
  }
  const customerFromDb = customerId ? tx.queryOne('SELECT id, name FROM customers WHERE id = ?', [customerId]) : null;

  let custName = '';
  if (actor.kind === 'customer' && actor.user) {
    custName = actor.user.name || '';
  } else if (actor.kind === 'staff') {
    custName = customerFromDb?.name || customer_name || '';
  } else if (actor.kind === 'public_qr') {
    custName = String(customer_name || '').trim() || `Mesa ${String(table_number || '').trim()}`;
  } else if (actor.kind === 'public_customer') {
    custName = customerFromDb?.name || String(customer_name || '').trim() || 'Cliente';
  }

  const saleDocumentNumber = `001-${String(orderNumber).padStart(8, '0')}`;
  const requestedPaymentMethod = String(payment_method || '').trim().toLowerCase();
  const paymentMethod = normalizePaymentMethod(requestedPaymentMethod || 'efectivo', { allowOnline: true, fallback: 'efectivo' });

  let deliveryModality = '';
  if (orderType === 'delivery') {
    const rawMod = String(delivery_payment_modality ?? '').trim().toLowerCase().replace(/-/g, '_');
    deliveryModality = rawMod === 'anticipado' ? 'anticipado' : 'contra_entrega';
  }

  let createdByUserId = '';
  let createdByUserName = '';
  if (actor.kind === 'customer' && actor.user) {
    createdByUserId = actor.user.id || '';
    createdByUserName = actor.user.full_name || actor.user.username || actor.user.name || '';
  } else if (actor.kind === 'staff' && actor.user) {
    createdByUserId = actor.user.id || '';
    createdByUserName = actor.user.full_name || actor.user.username || '';
  } else if (actor.kind === 'public_qr') {
    createdByUserId = '';
    createdByUserName = 'Auto-pedido (QR)';
  } else if (actor.kind === 'public_customer') {
    createdByUserId = '';
    createdByUserName = 'Auto-pedido (cliente)';
  }

  let kitchenReleaseAt = null;
  if (hold_kitchen_for_reservation && reservation_date && reservation_time) {
    kitchenReleaseAt = computeKitchenReleaseAtForReservation(reservation_date, reservation_time);
  }

  let tableId = String(tableIdBody || '').trim();
  if (!tableId && table_number) {
    const trow = tx.queryOne('SELECT id FROM tables WHERE TRIM(CAST(number AS TEXT)) = ? LIMIT 1', [
      String(table_number).trim(),
    ]);
    tableId = String(trow?.id || '').trim();
  }

  tx.run(
    `INSERT INTO orders (
      id, order_number, customer_id, customer_name, restaurant_id, type, subtotal, tax, discount, delivery_fee, total,
      payment_method, table_number, table_id, delivery_address, delivery_payment_modality, notes, sale_document_type, sale_document_number, created_by_user_id, created_by_user_name, kitchen_release_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      orderId,
      orderNumber,
      customerId,
      custName,
      restaurant?.id,
      orderType,
      subtotal,
      tax,
      discountAmount,
      deliveryFee,
      total,
      paymentMethod,
      table_number || '',
      tableId,
      delivery_address || '',
      deliveryModality,
      notes || '',
      'nota_venta',
      saleDocumentNumber,
      createdByUserId,
      createdByUserName,
      kitchenReleaseAt,
    ]
  );

  orderItems.forEach((item) => {
    if (item.process_type === 'non_transformed') {
      const stockRows = tx.queryAll(
        'SELECT id, quantity FROM inventory_warehouse_stocks WHERE product_id = ? ORDER BY quantity DESC',
        [item.product_id]
      );
      let pending = Number(item.quantity || 0);
      for (const row of stockRows) {
        if (pending <= 0) break;
        const available = Number(row.quantity || 0);
        if (available <= 0) continue;
        const consume = Math.min(available, pending);
        tx.run(
          'UPDATE inventory_warehouse_stocks SET quantity = ?, updated_at = datetime(\'now\') WHERE id = ?',
          [available - consume, row.id]
        );
        pending -= consume;
      }
      if (pending > 0 && !staffInHouseOrder) {
        throw new Error(`No hay stock suficiente en almacenes para ${item.product_name}`);
      }
      const newSum = tx.queryOne(
        'SELECT COALESCE(SUM(quantity), 0) as total FROM inventory_warehouse_stocks WHERE product_id = ?',
        [item.product_id]
      );
      tx.run('UPDATE products SET stock = ?, updated_at = datetime(\'now\') WHERE id = ?', [Number(newSum?.total || 0), item.product_id]);
    }
    tx.run(
      'INSERT INTO order_items (id, order_id, product_id, product_name, variant_name, quantity, unit_price, subtotal, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [item.id, item.order_id, item.product_id, item.product_name, item.variant_name, item.quantity, item.unit_price, item.subtotal, item.notes]
    );
  });

  return { orderId };
}

function restoreNonTransformedStockForOrderTx(tx, orderId) {
  const oldItems = tx.queryAll('SELECT * FROM order_items WHERE order_id = ?', [orderId]);
  for (const item of oldItems) {
    const product = tx.queryOne('SELECT * FROM products WHERE id = ?', [item.product_id]);
    if (!product || product.process_type !== 'non_transformed') continue;
    const qtyBack = Number(item.quantity || 0);
    const rows = tx.queryAll('SELECT * FROM inventory_warehouse_stocks WHERE product_id = ?', [product.id]);
    if (rows.length === 0) {
      tx.run('UPDATE products SET stock = stock + ?, updated_at = datetime(\'now\') WHERE id = ?', [qtyBack, product.id]);
      continue;
    }
    const preferredId = product.stock_warehouse_id || rows[0].warehouse_id;
    const target = rows.find((r) => r.warehouse_id === preferredId) || rows[0];
    const current = Number(target.quantity || 0);
    tx.run(
      'UPDATE inventory_warehouse_stocks SET quantity = ?, updated_at = datetime(\'now\') WHERE id = ?',
      [current + qtyBack, target.id]
    );
    const newSum = tx.queryOne(
      'SELECT COALESCE(SUM(quantity), 0) as total FROM inventory_warehouse_stocks WHERE product_id = ?',
      [product.id]
    );
    tx.run('UPDATE products SET stock = ?, updated_at = datetime(\'now\') WHERE id = ?', [Number(newSum?.total || 0), product.id]);
  }
}

/**
 * Sustituye ítems de un pedido existente (caja/mesas). Devuelve stock anterior, recalcula totales.
 */
function replaceOrderLinesInTransaction(tx, orderId, items, actor) {
  const order = tx.queryOne('SELECT * FROM orders WHERE id = ?', [orderId]);
  if (!order) throw new Error('Pedido no encontrado');
  if (!['pending', 'preparing', 'ready'].includes(String(order.status || ''))) {
    throw new Error('Solo se pueden modificar pedidos pendientes, en preparación o listos (sin cobrar)');
  }
  if (String(order.payment_status || 'pending') !== 'pending') {
    throw new Error('No se puede modificar un pedido ya cobrado');
  }

  const { computeAddedLineIds } = require('./utils/orderLineRemoval');
  const existingItems = tx.queryAll(
    'SELECT product_id, product_name, variant_name, quantity, unit_price, notes FROM order_items WHERE order_id = ?',
    [orderId],
  );

  const orderType = order.type;
  const staffInHouseOrder =
    actor.kind === 'staff' &&
    (orderType === 'dine_in' || orderType === 'pickup') &&
    actor.user &&
    actor.user.type !== 'customer' &&
    ['admin', 'cajero', 'mozo', 'cocina', 'bar'].includes(String(actor.user.role || ''));

  const restaurantRow = tx.queryOne('SELECT schedule FROM restaurants LIMIT 1');
  const restaurantSchedule = parseRestaurantSchedule(restaurantRow?.schedule);
  const orderNow = new Date();

  restoreNonTransformedStockForOrderTx(tx, orderId);
  tx.run('DELETE FROM order_items WHERE order_id = ?', [orderId]);

  let subtotal = 0;
  const orderItems = items.map((item) => {
    if (String(item.combo_id || '').trim()) {
      const comboLine = buildComboOrderLine(tx, orderId, item);
      subtotal += comboLine.subtotal;
      return comboLine.line;
    }

    const product = tx.queryOne('SELECT * FROM products WHERE id = ?', [item.product_id]);
    if (!product) throw new Error(`Producto no encontrado: ${item.product_id}`);
    assertProductAvailableForOrder(product, orderNow, restaurantSchedule);
    const qty = Number(item.quantity || 0);
    if (qty <= 0) throw new Error(`Cantidad inválida para ${product.name}`);
    const requiresStock = product.process_type === 'non_transformed';
    if (requiresStock) {
      const whSum = tx.queryOne(
        'SELECT COALESCE(SUM(quantity), 0) as total FROM inventory_warehouse_stocks WHERE product_id = ?',
        [product.id]
      );
      const available = Math.max(Number(product.stock || 0), Number(whSum?.total || 0));
      if (available < qty && !staffInHouseOrder) {
        throw new Error(`Stock insuficiente para ${product.name}`);
      }
    }
    const productModifierId = String(product.modifier_id || '').trim();
    let modifierName = '';
    let modifierOption = '';
    if (productModifierId) {
      const modifier = tx.queryOne('SELECT * FROM modifiers WHERE id = ?', [productModifierId]);
      if (modifier) {
        const requestedModifierId = String(item.modifier_id || '').trim();
        const requestedOption = String(item.modifier_option || '').trim();
        const availableOptions = tx
          .queryAll('SELECT option_name FROM modifier_options WHERE modifier_id = ?', [productModifierId])
          .map((row) => String(row.option_name || '').trim())
          .filter(Boolean);
        const isRequired = Number(modifier.required || 0) === 1;

        if (requestedModifierId && requestedModifierId !== productModifierId) {
          throw new Error(`El producto ${product.name} tiene un modificador inválido`);
        }
        if (isRequired && !requestedOption) {
          throw new Error(`El producto ${product.name} requiere seleccionar ${modifier.name}`);
        }
        if (requestedOption) {
          if (availableOptions.length > 0 && !availableOptions.includes(requestedOption)) {
            throw new Error(`La opción "${requestedOption}" no es válida para ${modifier.name}`);
          }
          modifierName = String(modifier.name || '').trim();
          modifierOption = requestedOption;
        }
      }
    }
    const unitPrice = Number(product.price || 0) + Number(item.price_modifier || 0);
    const itemNote = String(item.notes || '').trim();
    if (Number(product.note_required || 0) === 1 && !itemNote) {
      throw new Error(`El producto ${product.name} requiere una nota obligatoria`);
    }
    const itemSubtotal = unitPrice * qty;
    subtotal += itemSubtotal;
    const composedNotes = [itemNote, modifierName && modifierOption ? `${modifierName}: ${modifierOption}` : ''].filter(Boolean).join(' | ');
    return {
      id: uuidv4(),
      order_id: orderId,
      product_id: product.id,
      product_name: product.name,
      variant_name: item.variant_name || '',
      quantity: qty,
      unit_price: unitPrice,
      subtotal: itemSubtotal,
      notes: composedNotes,
      process_type: product.process_type,
    };
  });

  const discountAmount = Math.max(0, Number(order.discount || 0));
  const deliveryFee = Number(order.delivery_fee || 0);
  const total = Math.max(0, subtotal - discountAmount + deliveryFee);

  const newItemIds = computeAddedLineIds(existingItems, orderItems);
  const highlightIdSet = new Set(newItemIds);

  tx.run(
    'UPDATE orders SET subtotal = ?, tax = 0, total = ?, updated_at = datetime(\'now\') WHERE id = ?',
    [subtotal, total, orderId],
  );

  if (newItemIds.length) {
    tx.run(
      "UPDATE orders SET kitchen_last_send_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      [orderId],
    );
    if (String(order.status || '') === 'ready') {
      tx.run(
        "UPDATE orders SET status = 'preparing', preparing_at = COALESCE(preparing_at, datetime('now')), updated_at = datetime('now') WHERE id = ?",
        [orderId],
      );
    }
  }

  insertOrderLineRows(tx, orderItems, { staffInHouseOrder, highlightIdSet });
  if (newItemIds.length) {
    reopenProductionStationsForNewLines(tx, orderId, newItemIds);
  }

  return { orderId, newItemIds };
}

function actorFromRequest(req) {
  if (req.user?.type === 'customer') return { kind: 'customer', user: req.user };
  return { kind: 'staff', user: req.user };
}

module.exports = {
  getOrderWithItems,
  createOrderInTransaction,
  createOrMergeTableOrderInTransaction,
  appendItemsToOrderInTransaction,
  replaceOrderLinesInTransaction,
  actorFromRequest,
};
