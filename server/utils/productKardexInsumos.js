/** Varios insumos vinculados a un producto transformado (JSON + columnas legacy). */

function emptyLegacyKardex() {
  return {
    kardex_insumo_id: '',
    kardex_insumo_num: 1,
    kardex_insumo_den: 1,
    kardex_insumo_modo: 'unidad',
    kardex_insumo_gramos: 0,
  };
}

function parseKardexInsumoJson(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw == null) return [];
  const text = String(raw).trim();
  if (!text || text === '[]' || text === 'null') return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function normalizeKardexInsumoLines(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const insumo_id = String(row.insumo_id || row.kardex_insumo_id || '').trim();
    if (!insumo_id || seen.has(insumo_id)) continue;
    const qty = Number(row.qty ?? row.cantidad ?? row.gramos ?? row.num);
    if (!(qty > 0) || !Number.isFinite(qty)) continue;
    const modo = String(row.modo || '').toLowerCase() === 'peso' ? 'peso' : 'unidad';
    seen.add(insumo_id);
    out.push({ insumo_id, qty, modo });
  }
  return out;
}

function linesFromLegacyProduct(product) {
  const insumo_id = String(product?.kardex_insumo_id || '').trim();
  if (!insumo_id) return [];
  const modo = String(product.kardex_insumo_modo || 'unidad').toLowerCase() === 'peso' ? 'peso' : 'unidad';
  const qty = modo === 'peso'
    ? Number(product.kardex_insumo_gramos) || 0
    : (Number(product.kardex_insumo_num) || 0) / (Number(product.kardex_insumo_den) > 0 ? Number(product.kardex_insumo_den) : 1);
  if (!(qty > 0) || !Number.isFinite(qty)) return [];
  return [{ insumo_id, qty, modo }];
}

function resolveKardexInsumoLines(product) {
  const fromJson = normalizeKardexInsumoLines(parseKardexInsumoJson(product?.kardex_insumos));
  if (fromJson.length) return fromJson;
  return linesFromLegacyProduct(product);
}

function firstLineToLegacy(lines) {
  const first = Array.isArray(lines) ? lines[0] : null;
  if (!first || !first.insumo_id) return emptyLegacyKardex();
  if (first.modo === 'peso') {
    return {
      kardex_insumo_id: first.insumo_id,
      kardex_insumo_num: 1,
      kardex_insumo_den: 1,
      kardex_insumo_modo: 'peso',
      kardex_insumo_gramos: first.qty,
    };
  }
  return {
    kardex_insumo_id: first.insumo_id,
    kardex_insumo_num: first.qty,
    kardex_insumo_den: 1,
    kardex_insumo_modo: 'unidad',
    kardex_insumo_gramos: 0,
  };
}

function persistFromLines(lines) {
  const safe = normalizeKardexInsumoLines(lines);
  return {
    kardex_insumos: JSON.stringify(safe),
    ...firstLineToLegacy(safe),
  };
}

function linesFromLegacyBody(body, current) {
  const currentLines = resolveKardexInsumoLines(current || {});
  const currentFirst = currentLines[0] || null;
  const insumo_id = body.kardex_insumo_id === undefined
    ? (currentFirst?.insumo_id || '')
    : String(body.kardex_insumo_id || '').trim();
  if (!insumo_id) return [];

  const modoIn = body.kardex_insumo_modo === undefined
    ? (currentFirst?.modo || 'unidad')
    : String(body.kardex_insumo_modo || 'unidad').toLowerCase();
  const modo = modoIn === 'peso' ? 'peso' : 'unidad';

  let qty = 0;
  if (modo === 'peso') {
    const g = body.kardex_insumo_gramos === undefined
      ? (currentFirst?.modo === 'peso' ? currentFirst.qty : Number(current?.kardex_insumo_gramos) || 0)
      : Number(body.kardex_insumo_gramos);
    qty = g > 0 && Number.isFinite(g) ? g : 0;
  } else {
    const n = body.kardex_insumo_num === undefined
      ? (currentFirst?.modo === 'unidad' ? currentFirst.qty : Number(current?.kardex_insumo_num) || 0)
      : Number(body.kardex_insumo_num);
    const d = body.kardex_insumo_den === undefined
      ? (Number(current?.kardex_insumo_den) > 0 ? Number(current.kardex_insumo_den) : 1)
      : Number(body.kardex_insumo_den);
    const num = n > 0 && Number.isFinite(n) ? n : 0;
    const den = d > 0 && Number.isFinite(d) ? d : 1;
    qty = num / den;
  }
  if (!(qty > 0)) return [];
  return [{ insumo_id, qty, modo }];
}

/**
 * Resuelve lo que se guarda: array JSON + primera fila en columnas antiguas.
 * Si el body no trae kardex, conserva el producto actual (p. ej. parche de imagen).
 */
function buildKardexPersistFromRequest(body = {}, current = null, processType = 'transformed') {
  if (processType === 'non_transformed') {
    return persistFromLines([]);
  }
  if (body.kardex_insumos !== undefined) {
    return persistFromLines(body.kardex_insumos);
  }
  if (
    body.kardex_insumo_id !== undefined
    || body.kardex_insumo_num !== undefined
    || body.kardex_insumo_den !== undefined
    || body.kardex_insumo_modo !== undefined
    || body.kardex_insumo_gramos !== undefined
  ) {
    return persistFromLines(linesFromLegacyBody(body, current));
  }
  return persistFromLines(resolveKardexInsumoLines(current || {}));
}

function attachKardexInsumos(product) {
  if (!product || typeof product !== 'object') return product;
  product.kardex_insumos = resolveKardexInsumoLines(product);
  return product;
}

function unlinkInsumoFromProducts(tx, insumoId) {
  const id = String(insumoId || '').trim();
  if (!id) return;
  const rows = tx.queryAll(
    `SELECT id, kardex_insumos, kardex_insumo_id, kardex_insumo_num, kardex_insumo_den, kardex_insumo_modo, kardex_insumo_gramos
     FROM products`,
  ) || [];
  for (const row of rows) {
    const before = resolveKardexInsumoLines(row);
    const after = before.filter((line) => line.insumo_id !== id);
    if (after.length === before.length && String(row.kardex_insumo_id || '').trim() !== id) continue;
    const persist = persistFromLines(after);
    tx.run(
      `UPDATE products SET
        kardex_insumos = ?,
        kardex_insumo_id = ?,
        kardex_insumo_num = ?,
        kardex_insumo_den = ?,
        kardex_insumo_modo = ?,
        kardex_insumo_gramos = ?
       WHERE id = ?`,
      [
        persist.kardex_insumos,
        persist.kardex_insumo_id,
        persist.kardex_insumo_num,
        persist.kardex_insumo_den,
        persist.kardex_insumo_modo,
        persist.kardex_insumo_gramos,
        row.id,
      ],
    );
  }
}

module.exports = {
  emptyLegacyKardex,
  normalizeKardexInsumoLines,
  resolveKardexInsumoLines,
  firstLineToLegacy,
  persistFromLines,
  buildKardexPersistFromRequest,
  attachKardexInsumos,
  unlinkInsumoFromProducts,
};
