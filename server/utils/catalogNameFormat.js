/** Nombre visible en carta / categoría / insumo: mayúsculas (locale Perú). */
function normalizeCatalogDisplayName(value) {
  const trimmed = String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!trimmed) return '';
  return trimmed.toLocaleUpperCase('es-PE');
}

module.exports = {
  normalizeCatalogDisplayName,
};
