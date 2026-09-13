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

module.exports = {
  normalizeDisplayLabel,
  getTableDisplayLabel,
};
