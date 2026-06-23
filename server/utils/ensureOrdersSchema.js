const { queryAll, runSql, saveDb, getDb } = require('../database');

/** Columnas de `orders` que el código actual usa y deben existir en BD antiguas. */
const ORDER_COLUMNS = [
  ['table_id', "ALTER TABLE orders ADD COLUMN table_id TEXT DEFAULT ''"],
  ['kitchen_last_send_at', 'ALTER TABLE orders ADD COLUMN kitchen_last_send_at TEXT'],
  ['station_bar_preparing_at', 'ALTER TABLE orders ADD COLUMN station_bar_preparing_at TEXT'],
  ['station_bar_ready_at', 'ALTER TABLE orders ADD COLUMN station_bar_ready_at TEXT'],
  ['station_cocina_preparing_at', 'ALTER TABLE orders ADD COLUMN station_cocina_preparing_at TEXT'],
  ['station_cocina_ready_at', 'ALTER TABLE orders ADD COLUMN station_cocina_ready_at TEXT'],
];

/**
 * Asegura columnas críticas en `orders` sin borrar datos.
 * Idempotente: solo ejecuta ALTER si falta la columna.
 */
function ensureOrdersSchema() {
  const cols = queryAll('PRAGMA table_info(orders)');
  const names = new Set((cols || []).map((c) => c.name));
  let changed = false;
  let addedTableId = false;

  for (const [colName, ddl] of ORDER_COLUMNS) {
    if (names.has(colName)) continue;
    getDb().run(ddl);
    names.add(colName);
    changed = true;
    if (colName === 'table_id') addedTableId = true;
  }

  if (addedTableId) {
    try {
      runSql(`
        UPDATE orders
        SET table_id = (
          SELECT t.id FROM tables t
          WHERE TRIM(CAST(t.number AS TEXT)) = TRIM(CAST(orders.table_number AS TEXT))
          LIMIT 1
        )
        WHERE type = 'dine_in'
          AND IFNULL(TRIM(table_id), '') = ''
          AND IFNULL(TRIM(table_number), '') != ''
      `);
    } catch (_) {
      if (changed) saveDb();
    }
  } else if (changed) {
    saveDb();
  }

  if (changed) {
    console.info('[db] orders: columnas verificadas (table_id y estaciones de producción)');
  }

  return { ok: true, changed };
}

module.exports = { ensureOrdersSchema };
