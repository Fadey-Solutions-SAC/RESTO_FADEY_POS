/** Unidades de medida de insumos (valor canónico + etiqueta completa). */
export const INSUMO_UM_OPTIONS = [
  { value: 'unidad', label: 'Unidad' },
  { value: 'kg', label: 'Kilogramo' },
  { value: 'g', label: 'Gramo' },
  { value: 'L', label: 'Litro' },
  { value: 'ml', label: 'Mililitro' },
  { value: 'onza', label: 'Onza' },
];

export function normalizeInsumoUm(raw) {
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

/** Peso/volumen: el mínimo va en Mín. cantidad, no en unidades. */
export function isMasaOrLitrajeUm(raw) {
  const u = normalizeInsumoUm(raw).toLowerCase();
  return ['kg', 'g', 'mg', 'l', 'ml', 'lt', 'onza', 'oz', 't'].includes(u);
}

export function isUnidadUm(raw) {
  return normalizeInsumoUm(raw) === 'unidad';
}

export function labelInsumoUm(raw) {
  const v = normalizeInsumoUm(raw);
  const hit = INSUMO_UM_OPTIONS.find((o) => o.value.toLowerCase() === String(v).toLowerCase());
  return hit?.label || v;
}

/** Unidad en la que el cocinero escribe la receta (kg→g, L→ml; el resto es exacta). */
export function kardexRecipeInputUnit(raw) {
  const u = normalizeInsumoUm(raw);
  if (u === 'kg') return 'g';
  if (u === 'L') return 'ml';
  return u;
}
