/** Unidades de medida de insumos (kardex). Alineado con client/src/utils/insumoUnidadMedida.js */

function normalizeInsumoUm(raw) {
  const u = String(raw || '')
    .replace(/[0-9]/g, '')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();
  if (!u || u === 'und' || u === 'u' || u === 'unidades' || u === 'unidad') return 'unidad';
  if (u === 'l' || u === 'lt' || u === 'litro' || u === 'litros') return 'L';
  if (u === 'oz' || u === 'onz' || u === 'ounce' || u === 'onza') return 'onza';
  if (u === 'kilogramo' || u === 'kilogramos' || u === 'kg') return 'kg';
  if (u === 'gramo' || u === 'gramos' || u === 'g') return 'g';
  if (u === 'mililitro' || u === 'mililitros' || u === 'ml') return 'ml';
  if (u === 'mg') return 'mg';
  if (u === 't' || u === 'tonelada' || u === 'toneladas') return 'onza';
  return 'unidad';
}

function isUnidadUm(raw) {
  return normalizeInsumoUm(raw) === 'unidad';
}

function isMasaOrLitrajeUm(raw) {
  const u = normalizeInsumoUm(raw).toLowerCase();
  return ['kg', 'g', 'mg', 'l', 'ml', 'lt', 'onza', 'oz', 't'].includes(u);
}

function insumoStockEnUnidades(insumo) {
  if (!insumo) return 0;
  const u = Number(insumo.stock_unidades);
  const s = Number(insumo.stock_actual);
  if (isUnidadUm(insumo.unidad_medida)) {
    if (Number.isFinite(u) && Math.abs(u) > 1e-12) return u;
    return Number.isFinite(s) ? s : 0;
  }
  return Number.isFinite(u) ? u : 0;
}

function insumoEstaBajoMinimo(insumo) {
  if (!insumo) return false;
  if (isUnidadUm(insumo.unidad_medida)) {
    const uMin = Number(insumo.minimo_unidades) || 0;
    return uMin > 0 && insumoStockEnUnidades(insumo) < uMin;
  }
  const uMin = Number(insumo.minimo_unidades) || 0;
  const uAct = Number(insumo.stock_unidades) || 0;
  const sMin = Number(insumo.stock_minimo) || 0;
  const sAct = Number(insumo.stock_actual) || 0;
  return (uMin > 0 && uAct < uMin) || (sMin > 0 && sAct < sMin);
}

/**
 * Cantidad capturada en el plato → unidades de stock_actual.
 * kg/L: el dato se guarda en g/ml (uso de cocina) y se convierte a la U.M. base.
 * ml, g, onza, unidad: cantidad exacta.
 */
function recipeQtyToStock(qty, unidadMedida) {
  const um = normalizeInsumoUm(unidadMedida);
  const q = Number(qty) || 0;
  if (!(q > 0) || !Number.isFinite(q)) return 0;
  const base = String(um).toLowerCase();
  if (base === 'kg' || base === 'l') return q / 1000;
  return q;
}

module.exports = {
  normalizeInsumoUm,
  isUnidadUm,
  isMasaOrLitrajeUm,
  insumoStockEnUnidades,
  insumoEstaBajoMinimo,
  recipeQtyToStock,
};
