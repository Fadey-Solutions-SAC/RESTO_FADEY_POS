/** Mientras se escribe: producto, categoría o insumo en mayúsculas. */
export function formatCatalogNameInput(value) {
  return String(value ?? '').toLocaleUpperCase('es-PE');
}
