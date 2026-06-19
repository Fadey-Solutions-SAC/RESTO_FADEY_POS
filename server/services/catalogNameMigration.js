const { queryAll, runSql } = require('../database');
const { normalizeCatalogDisplayName } = require('../utils/catalogNameFormat');

/** Convierte nombres existentes a mayúsculas (idempotente). */
function migrateCatalogNamesToUppercase() {
  let updated = 0;

  for (const row of queryAll("SELECT id, name FROM products WHERE trim(coalesce(name, '')) != ''")) {
    const next = normalizeCatalogDisplayName(row.name);
    if (next && next !== row.name) {
      runSql("UPDATE products SET name = ?, updated_at = datetime('now') WHERE id = ?", [next, row.id]);
      updated += 1;
    }
  }

  for (const row of queryAll("SELECT id, name FROM categories WHERE trim(coalesce(name, '')) != ''")) {
    const next = normalizeCatalogDisplayName(row.name);
    if (next && next !== row.name) {
      runSql('UPDATE categories SET name = ? WHERE id = ?', [next, row.id]);
      updated += 1;
    }
  }

  for (const row of queryAll("SELECT id, nombre FROM insumos WHERE trim(coalesce(nombre, '')) != ''")) {
    const next = normalizeCatalogDisplayName(row.nombre);
    if (next && next !== row.nombre) {
      runSql("UPDATE insumos SET nombre = ?, updated_at = datetime('now') WHERE id = ?", [next, row.id]);
      updated += 1;
    }
  }

  if (updated > 0) {
    console.log(`[catalog-names] ${updated} nombre(s) actualizado(s) a mayúsculas`);
  }
}

module.exports = {
  migrateCatalogNamesToUppercase,
};
