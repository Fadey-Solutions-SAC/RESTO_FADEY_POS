/** Misma regla que en el servidor: ancla YYYY-MM-DD + 1 o 6 meses. */
export function proximaFechaFromControlAnchor(anchorYyyyMmDd, periodo) {
  const months = periodo === 'semestral' ? 6 : 1;
  const parts = String(anchorYyyyMmDd || '').trim().split('-');
  if (parts.length !== 3) return '';
  const y = Number(parts[0]);
  const mo = Number(parts[1]);
  const d = Number(parts[2]);
  if (!y || !mo || !d) return '';
  const targetIndex = (mo - 1) + months;
  const targetYear = y + Math.floor(targetIndex / 12);
  const targetMonth = ((targetIndex % 12) + 12) % 12;
  const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
  const day = Math.min(d, lastDay);
  const mm = String(targetMonth + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${targetYear}-${mm}-${dd}`;
}

export function addDaysToIsoDate(dateKey, daysToAdd) {
  const add = Number(daysToAdd);
  const parts = String(dateKey || '').trim().split('-');
  if (parts.length !== 3 || !Number.isFinite(add)) return '';
  const y = Number(parts[0]);
  const mo = Number(parts[1]);
  const d = Number(parts[2]);
  if (!y || !mo || !d) return '';
  const dt = new Date(y, mo - 1, d);
  if (Number.isNaN(dt.getTime())) return '';
  dt.setDate(dt.getDate() + add);
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${dt.getFullYear()}-${mm}-${dd}`;
}
