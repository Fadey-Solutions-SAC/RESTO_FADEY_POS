/** Normaliza número de mesa para comparar pedidos (1, "01", " 1 " → "1"). */
function normalizeTableNumber(value) {
  const s = String(value ?? '').trim();
  if (!s) return '';
  if (/^\d+$/.test(s)) return String(Number.parseInt(s, 10));
  return s.toLowerCase();
}

function tableNumbersMatch(a, b) {
  const na = normalizeTableNumber(a);
  const nb = normalizeTableNumber(b);
  return Boolean(na && nb && na === nb);
}

module.exports = {
  normalizeTableNumber,
  tableNumbersMatch,
};
