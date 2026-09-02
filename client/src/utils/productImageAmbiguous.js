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

/** Indica si el nombre probablemente no sirve para generar imagen automática. */
export function isLikelyAmbiguousProductImageName(name, description = '') {
  const n = String(name || '').trim();
  const norm = normalizeToken(n);
  const words = norm.split(/\s+/).filter(Boolean);
  if (!n || n.length < 4) return true;
  if (GENERIC_NAME_TOKENS.has(norm) || (words.length === 1 && GENERIC_NAME_TOKENS.has(words[0]))) {
    return String(description || '').trim().length < 10;
  }
  return false;
}
