const GENERIC_NAME_TOKENS = new Set([
  'antojo', 'otra', 'otro', 'otros', 'varios', 'vario', 'combo', 'menu',
  'extra', 'especial', 'promo', 'oferta', 'unidad', 'porcion', 'plato',
  'bebida', 'item', 'producto', 'habitacion', 'misc', 'general',
  'nuevo', 'prueba', 'test', 'temp', 'variedad', 'surtido', 'snack',
]);

function normalizeToken(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function looksLikeSkuCode(norm) {
  if (!norm || norm.length > 10) return false;
  if (/[0-9]/.test(norm)) return true;
  if (/[-_.]/.test(norm)) return true;
  if (norm.length <= 5 && norm === norm.toUpperCase() && /^[A-Z]+$/.test(norm)) return true;
  return false;
}

/** Indica si el nombre probablemente no sirve para generar imagen automática. */
export function isLikelyAmbiguousProductImageName(name, description = '') {
  const n = String(name || '').trim();
  const norm = normalizeToken(n);
  const words = norm.split(/\s+/).filter(Boolean);
  const desc = String(description || '').trim();
  if (!n || norm.length < 3) return desc.length < 10;
  if (GENERIC_NAME_TOKENS.has(norm) || (words.length === 1 && GENERIC_NAME_TOKENS.has(words[0]))) {
    return desc.length < 10;
  }
  if (looksLikeSkuCode(norm)) return desc.length < 10;
  return false;
}
