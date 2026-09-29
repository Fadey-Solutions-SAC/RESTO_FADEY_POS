const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;

export function isImageFile(file) {
  const type = String(file?.type || '');
  return type.startsWith('image/') || IMAGE_EXT.test(String(file?.name || ''));
}

/** Nombre comparable: sin extensión, tildes, mayúsculas, guiones ni sufijos de copia «(1)». */
export function normalizeImageMatchName(value) {
  return String(value || '')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\(\d+\)\s*$/, '')
    .replace(/[_\-.+]+/g, ' ')
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Empareja archivos de una carpeta con productos por nombre (o por id del producto).
 * @returns {{ matches: {file: File, product: object}[], unmatched: File[], ambiguous: {file: File, candidates: object[]}[] }}
 */
export function matchImageFilesToProducts(files, products) {
  const list = (products || []).filter((p) => p && p.id);
  const byName = new Map();
  for (const p of list) {
    const key = normalizeImageMatchName(p.name);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(p);
  }
  const byId = new Map(list.map((p) => [String(p.id).toLowerCase(), p]));

  const matches = [];
  const unmatched = [];
  const ambiguous = [];
  const usedProductIds = new Set();

  for (const file of files || []) {
    if (!isImageFile(file)) continue;
    const rawBase = String(file.name || '').replace(/\.[a-z0-9]{2,5}$/i, '').trim().toLowerCase();
    const key = normalizeImageMatchName(file.name);
    let candidates = [];
    if (byId.has(rawBase)) candidates = [byId.get(rawBase)];
    else if (key && byName.has(key)) candidates = byName.get(key);
    else if (key.length >= 4) {
      candidates = list.filter((p) => {
        const pk = normalizeImageMatchName(p.name);
        return pk && (pk.startsWith(`${key} `) || key.startsWith(`${pk} `));
      });
    }
    candidates = candidates.filter((p) => !usedProductIds.has(p.id));
    if (candidates.length === 1) {
      usedProductIds.add(candidates[0].id);
      matches.push({ file, product: candidates[0] });
    } else if (candidates.length > 1) {
      ambiguous.push({ file, candidates });
    } else {
      unmatched.push(file);
    }
  }
  return { matches, unmatched, ambiguous };
}
