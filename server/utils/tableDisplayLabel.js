/** Preferencia de etiqueta visible: número o nombre personalizado. */

function normalizeDisplayLabel(value) {
  return String(value || '').trim().toLowerCase() === 'name' ? 'name' : 'number';
}

/**
 * Etiqueta para Caja, Mesas, pedidos, tickets, etc.
 * @param {{ number?: unknown, name?: unknown, display_label?: unknown }|null|undefined} table
 * @param {{ padNumber?: boolean }} [opts]
 */
function getTableDisplayLabel(table, opts = {}) {
  const mode = normalizeDisplayLabel(table?.display_label);
  const name = String(table?.name || '').trim();
  if (mode === 'name' && name) return name;

  const rawNum = table?.number;
  if (rawNum != null && String(rawNum).trim() !== '') {
    const n = String(rawNum).trim();
    const shown = opts.padNumber && /^\d+$/.test(n) ? n.padStart(2, '0') : n;
    return `Mesa ${shown}`;
  }
  return name || 'Mesa';
}

/**
 * Agrega `table_display_label` (ej. «Habitación 103» o «Mesa 103») a pedidos de salón.
 * Muta y devuelve lo recibido (pedido o lista).
 */
function attachTableDisplayLabels(orders) {
  const list = (Array.isArray(orders) ? orders : [orders]).filter(
    (o) => o && o.type === 'dine_in' && String(o.table_number || '').trim(),
  );
  if (!list.length) return orders;
  let tables = [];
  try {
    const { queryAll } = require('../database');
    tables = queryAll('SELECT id, number, name, display_label FROM tables') || [];
  } catch (_) {
    return orders;
  }
  const byId = new Map(tables.map((t) => [String(t.id), t]));
  const byNumber = new Map();
  tables.forEach((t) => {
    const key = String(t.number ?? '').trim();
    if (key && !byNumber.has(key)) byNumber.set(key, t);
  });
  list.forEach((o) => {
    const table =
      byId.get(String(o.table_id || '').trim()) || byNumber.get(String(o.table_number).trim());
    if (table) o.table_display_label = getTableDisplayLabel(table);
  });
  return orders;
}

module.exports = {
  normalizeDisplayLabel,
  getTableDisplayLabel,
  attachTableDisplayLabels,
};
