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

/** Stock en piezas para U.M. Unidad (alitas, huevos, etc.). Usa Cant. (U), no kg/L. */
export function insumoStockEnUnidades(insumo) {
  if (!insumo) return 0;
  const u = Number(insumo.stock_unidades);
  const s = Number(insumo.stock_actual);
  if (isUnidadUm(insumo.unidad_medida)) {
    if (Number.isFinite(u) && Math.abs(u) > 1e-12) return u;
    return Number.isFinite(s) ? s : 0;
  }
  return Number.isFinite(u) ? u : 0;
}

export function insumoStockEnMasa(insumo) {
  if (!insumo || isUnidadUm(insumo.unidad_medida)) return 0;
  const s = Number(insumo.stock_actual);
  return Number.isFinite(s) ? s : 0;
}

export function insumoEstaBajoMinimo(insumo) {
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

export function insumoValorInventario(insumo) {
  const costo = Number(insumo?.costo_promedio || 0) || 0;
  if (isUnidadUm(insumo?.unidad_medida)) return insumoStockEnUnidades(insumo) * costo;
  return (Number(insumo?.stock_actual || 0) || 0) * costo;
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

/** Muestra g/ml en kg/L cuando llegan a 1 000 (el stock interno no cambia). */
export function scaleInsumoDisplayQty(qty, unidad) {
  const n = Number(qty);
  const um = normalizeInsumoUm(unidad);
  const fallback = String(unidad || '').replace(/[0-9]/g, '').trim();
  if (!Number.isFinite(n)) return { qty: n, unit: um || fallback };
  if (um === 'g' && Math.abs(n) >= 1000 - 1e-9) return { qty: n / 1000, unit: 'kg' };
  if (um === 'ml' && Math.abs(n) >= 1000 - 1e-9) return { qty: n / 1000, unit: 'L' };
  if (um === 'mg' && Math.abs(n) >= 1000 - 1e-9) return { qty: n / 1000, unit: 'g' };
  if (um === 'unidad') return { qty: n, unit: 'U' };
  return { qty: n, unit: um || fallback };
}
