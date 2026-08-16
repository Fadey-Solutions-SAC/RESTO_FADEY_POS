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
  recipeQtyToStock,
};
