/**
 * Próxima fecha de facturación de "pago por uso" = fecha ancla (compra / control maestro) + 1 o 6 meses.
 */

function addMonthsToIsoDate(dateKey, monthsToAdd) {
  const add = Number(monthsToAdd);
  if (!Number.isFinite(add) || add === 0) return String(dateKey || '').trim();
  const parts = String(dateKey || '').trim().split('-');
  if (parts.length !== 3) return '';
  const y = Number(parts[0]);
  const mo = Number(parts[1]);
  const d = Number(parts[2]);
  if (!y || !mo || !d) return '';
  const targetIndex = (mo - 1) + add;
  const targetYear = y + Math.floor(targetIndex / 12);
  const targetMonth = ((targetIndex % 12) + 12) % 12;
  const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
  const day = Math.min(d, lastDay);
  const mm = String(targetMonth + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${targetYear}-${mm}-${dd}`;
}

/** periodo: 'mensual' | 'semestral' (cualquier otro se trata como mensual) */
function proximaFechaFromControlAnchor(anchorYyyyMmDd, periodo) {
  const months = periodo === 'semestral' ? 6 : 1;
  return addMonthsToIsoDate(anchorYyyyMmDd, months);
}

function addDaysToIsoDate(dateKey, daysToAdd) {
  const add = Number(daysToAdd);
  if (!Number.isFinite(add) || add === 0) return String(dateKey || '').trim();
  const parts = String(dateKey || '').trim().split('-');
  if (parts.length !== 3) return '';
  const y = Number(parts[0]);
  const mo = Number(parts[1]);
  const d = Number(parts[2]);
  if (!y || !mo || !d) return '';
  const dt = new Date(y, mo - 1, d);
  if (Number.isNaN(dt.getTime())) return '';
  dt.setDate(dt.getDate() + add);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

module.exports = {
  addMonthsToIsoDate,
  addDaysToIsoDate,
  proximaFechaFromControlAnchor,
};
