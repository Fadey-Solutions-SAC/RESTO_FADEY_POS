/** Clave de línea para detectar retiros completos (alineado con caja/mesas). */
function staffLineKey(item) {
  return [
    String(item.product_id || '').trim(),
    String(item.modifier_id || '').trim(),
    String(item.modifier_option || '').trim(),
    String(item.notes || '').trim(),
  ].join('\0');
}

/** Extrae nota de ítem y opción de modificador desde order_items.notes (mismo criterio que caja). */
function parseDbNotesForRemoval(notesStr, variantName) {
  const variant = String(variantName || '').trim().toLowerCase();
  const raw = String(notesStr || '').trim();
  if (!raw) return { itemNote: '', modifierOption: variant };
  const parts = raw.split(' | ').map((x) => x.trim()).filter(Boolean);
  if (parts.length === 1) {
    const m = parts[0].match(/^([^:]+):\s*(.+)$/);
    if (m) return { itemNote: '', modifierOption: m[2].trim().toLowerCase() };
    return { itemNote: parts[0], modifierOption: variant };
  }
  const itemNote = parts[0];
  const last = parts[parts.length - 1];
  const m = last.match(/^([^:]+):\s*(.+)$/);
  if (m) return { itemNote, modifierOption: m[2].trim().toLowerCase() };
  return { itemNote: raw, modifierOption: variant };
}

function dbOrderItemLineKey(row) {
  const parsed = parseDbNotesForRemoval(row.notes, row.variant_name);
  return staffLineKey({
    product_id: row.product_id,
    modifier_id: '',
    modifier_option: parsed.modifierOption,
    notes: parsed.itemNote,
  });
}

function payloadItemLineKey(item) {
  return staffLineKey(item);
}

function sumLineQuantities(rows, keyFn) {
  const m = new Map();
  for (const row of rows || []) {
    const k = keyFn(row);
    m.set(k, (m.get(k) || 0) + Math.max(0, Number(row.quantity || 0)));
  }
  return m;
}

/** Verdadero si alguna línea pasó de cantidad &gt; 0 a 0 (eliminar producto), no si solo bajó cantidad. */
function hasCompleteLineRemovals(beforeRows, afterRows, { beforeKeyFn, afterKeyFn } = {}) {
  const beforeFn = beforeKeyFn || staffLineKey;
  const afterFn = afterKeyFn || staffLineKey;
  const before = sumLineQuantities(beforeRows, beforeFn);
  const after = sumLineQuantities(afterRows, afterFn);
  for (const [key, qty] of before) {
    if (qty > 0 && (after.get(key) || 0) <= 0) return true;
  }
  return false;
}

function hasCompleteOrderItemRemovals(existingItems, payloadItems) {
  return hasCompleteLineRemovals(existingItems, payloadItems, {
    beforeKeyFn: dbOrderItemLineKey,
    afterKeyFn: payloadItemLineKey,
  });
}

function appendOrderRemovalNote(existingNotes, removalReason) {
  const text = String(removalReason || '').trim();
  if (!text) return String(existingNotes || '').trim();
  const stamp = text.toLowerCase().startsWith('productos retirados')
    ? text
    : `Productos retirados: ${text}`;
  const prev = String(existingNotes || '').trim();
  return prev ? `${prev} | ${stamp}` : stamp;
}

function orderLineStaffKeyFromDbRow(row) {
  const parsed = parseDbNotesForRemoval(row.notes, row.variant_name);
  return staffLineKey({
    product_id: row.product_id,
    modifier_id: '',
    modifier_option: parsed.modifierOption,
    notes: parsed.itemNote,
  });
}

function orderLineStaffKeyFromBuiltRow(row) {
  const parsed = parseDbNotesForRemoval(row.notes, row.variant_name);
  return staffLineKey({
    product_id: row.product_id,
    modifier_id: '',
    modifier_option: parsed.modifierOption,
    notes: parsed.itemNote,
  });
}

/** Tras reemplazar líneas: ids de filas nuevas o con cantidad mayor (para highlight / impresión). */
function computeAddedLineIds(existingItems, builtOrderItems) {
  const remaining = new Map();
  for (const row of existingItems || []) {
    const k = orderLineStaffKeyFromDbRow(row);
    remaining.set(k, (remaining.get(k) || 0) + Math.max(0, Number(row.quantity || 0)));
  }
  const addedIds = [];
  for (const item of builtOrderItems || []) {
    const k = orderLineStaffKeyFromBuiltRow(item);
    const qty = Math.max(0, Number(item.quantity || 0));
    const prev = remaining.get(k) || 0;
    if (prev < qty) {
      addedIds.push(String(item.id));
      remaining.set(k, 0);
    } else {
      remaining.set(k, prev - qty);
    }
  }
  return addedIds;
}

module.exports = {
  staffLineKey,
  dbOrderItemLineKey,
  payloadItemLineKey,
  hasCompleteLineRemovals,
  hasCompleteOrderItemRemovals,
  appendOrderRemovalNote,
  computeAddedLineIds,
};
