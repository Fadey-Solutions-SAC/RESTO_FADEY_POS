/** Fecha local YYYY-MM-DD (evita desfase UTC en «Día»). */
function toKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const DATE_PRESETS = [
  { id: 'today', label: 'Día' },
  { id: 'month', label: 'Mes' },
  { id: 'year', label: 'Año' },
  { id: 'custom', label: 'Personalizado' },
];

export function getPresetRange(presetId) {
  const now = new Date();
  const today = toKey(now);
  if (presetId === 'today') return { from: today, to: today };
  if (presetId === 'yesterday') {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    const k = toKey(y);
    return { from: k, to: k };
  }
  if (presetId === 'week') {
    const from = new Date(now);
    from.setDate(from.getDate() - 6);
    return { from: toKey(from), to: today };
  }
  if (presetId === 'month') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: toKey(from), to: today };
  }
  if (presetId === 'year') {
    const from = new Date(now.getFullYear(), 0, 1);
    return { from: toKey(from), to: today };
  }
  return { from: '', to: '' };
}
