/**
 * Permisos POS de personal: por defecto solo el módulo de trabajo.
 * Cajero → caja. Mozo → mesas. Delivery → delivery. Recepcionista → hotelería.
 * Producción → su área (cocina, bar o el área vinculada).
 * Hotelería no entra al catálogo de planes: se guarda aparte en el permiso del usuario.
 */
const MODULE_IDS = [
  'escritorio', 'ventas', 'caja', 'mesas', 'reservas', 'auto_pedido', 'creditos', 'clientes',
  'productos', 'ofertas', 'descuentos', 'almacen', 'delivery', 'hoteleria', 'informes',
  'indicadores', 'fidelizacion', 'mi_restaurant', 'configuracion', 'cocina', 'bar', 'produccion', 'tiempo_trabajado',
];

const CAJA_OPT_IN_KEY = 'caja:eliminar_liberar_mesa';
const MIGRATION_KEY = 'staff_permissions_work_module_v1';
const RECEPTION_MIGRATION_KEY = 'staff_permissions_recepcionista_hoteleria_v1';

function emptyPermissions() {
  return MODULE_IDS.reduce((acc, id) => {
    acc[id] = false;
    return acc;
  }, {});
}

function isOn(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

/** Objeto de permisos con un solo módulo de trabajo activo. El administrador no entra aquí. */
function buildWorkModulePermissions(role, productionAreaId) {
  const perms = emptyPermissions();
  const roleLc = String(role || '').trim().toLowerCase();
  const area = String(productionAreaId || '').trim().toLowerCase();
  if (roleLc === 'cajero') {
    perms.caja = true;
  } else if (roleLc === 'mozo') {
    perms.mesas = true;
  } else if (roleLc === 'delivery') {
    perms.delivery = true;
  } else if (roleLc === 'recepcionista') {
    perms.hoteleria = true;
  } else if (roleLc === 'bar' || area === 'bar') {
    perms.bar = true;
  } else if (roleLc === 'cocina' || area === 'cocina') {
    perms.cocina = true;
  } else if (area && (roleLc === 'produccion' || roleLc === 'cocina' || roleLc === 'bar')) {
    perms.produccion = true;
  } else if (roleLc === 'produccion' && !area) {
    /* Sin área vinculada todavía: no se abre Cocina ni Bar. */
  }
  return perms;
}

/**
 * Una sola vez: el personal queda con su módulo de trabajo.
 * Se conserva el permiso extra de eliminar/liberar mesa si ya estaba activo.
 */
function ensureStaffWorkModulePermissions() {
  const { queryAll, queryOne, runSql } = require('../database');
  const flag = queryOne('SELECT value FROM app_settings WHERE key = ?', [MIGRATION_KEY]);
  if (String(flag?.value || '').replace(/"/g, '') === '1') return { skipped: true, updated: 0 };

  const users = queryAll(
    `SELECT id, role, production_area_id FROM users
     WHERE lower(trim(coalesce(role, ''))) NOT IN ('admin', 'master_admin')`
  ) || [];
  let updated = 0;
  for (const user of users) {
    const existing = queryOne('SELECT id, permissions FROM user_permissions WHERE user_id = ?', [user.id]);
    let parsed = {};
    try { parsed = JSON.parse(existing?.permissions || '{}') || {}; } catch { parsed = {}; }
    const next = buildWorkModulePermissions(user.role, user.production_area_id);
    if (isOn(parsed[CAJA_OPT_IN_KEY])) next[CAJA_OPT_IN_KEY] = true;
    const json = JSON.stringify(next);
    if (existing?.id) {
      if (existing.permissions !== json) {
        runSql(
          "UPDATE user_permissions SET permissions = ?, updated_at = datetime('now') WHERE user_id = ?",
          [json, user.id]
        );
        updated += 1;
      }
    } else {
      const { v4: uuidv4 } = require('uuid');
      runSql(
        'INSERT INTO user_permissions (id, user_id, permissions) VALUES (?, ?, ?)',
        [uuidv4(), user.id, json]
      );
      updated += 1;
    }
  }
  const stamp = JSON.stringify('1');
  if (flag) {
    runSql("UPDATE app_settings SET value = ?, updated_at = datetime('now') WHERE key = ?", [stamp, MIGRATION_KEY]);
  } else {
    runSql('INSERT INTO app_settings (key, value) VALUES (?, ?)', [MIGRATION_KEY, stamp]);
  }
  return { skipped: false, updated };
}

/**
 * El recepcionista ya creado queda con Hotelería encendida.
 * No toca el resto de sus permisos. Si el administrador lo apagó, se respeta.
 */
function ensureRecepcionistaHotelPermission() {
  const { queryAll, queryOne, runSql } = require('../database');
  const flag = queryOne('SELECT value FROM app_settings WHERE key = ?', [RECEPTION_MIGRATION_KEY]);
  if (String(flag?.value || '').replace(/"/g, '') === '1') return { skipped: true, updated: 0 };

  const users = queryAll(
    `SELECT id FROM users WHERE lower(trim(coalesce(role, ''))) = 'recepcionista'`
  ) || [];
  let updated = 0;
  for (const user of users) {
    const existing = queryOne('SELECT id, permissions FROM user_permissions WHERE user_id = ?', [user.id]);
    let parsed = {};
    try { parsed = JSON.parse(existing?.permissions || '{}') || {}; } catch { parsed = {}; }
    if (Object.prototype.hasOwnProperty.call(parsed, 'hoteleria')) continue;
    parsed.hoteleria = true;
    const json = JSON.stringify(parsed);
    if (existing?.id) {
      runSql(
        "UPDATE user_permissions SET permissions = ?, updated_at = datetime('now') WHERE user_id = ?",
        [json, user.id]
      );
    } else {
      const { v4: uuidv4 } = require('uuid');
      runSql(
        'INSERT INTO user_permissions (id, user_id, permissions) VALUES (?, ?, ?)',
        [uuidv4(), user.id, json]
      );
    }
    updated += 1;
  }
  const stamp = JSON.stringify('1');
  if (flag) {
    runSql("UPDATE app_settings SET value = ?, updated_at = datetime('now') WHERE key = ?", [stamp, RECEPTION_MIGRATION_KEY]);
  } else {
    runSql('INSERT INTO app_settings (key, value) VALUES (?, ?)', [RECEPTION_MIGRATION_KEY, stamp]);
  }
  return { skipped: false, updated };
}

/** Hotelería vive fuera del plan. En la sesión solo se escribe si hay decisión. */
function applyHotelStaffPermission(permissions, role, raw) {
  const next = { ...(permissions || {}) };
  const source = raw && typeof raw === 'object' ? raw : {};
  const roleLc = String(role || '').trim().toLowerCase();
  if (roleLc === 'recepcionista') {
    next.hoteleria = Object.prototype.hasOwnProperty.call(source, 'hoteleria')
      ? isOn(source.hoteleria)
      : true;
    return next;
  }
  if (isOn(source.hoteleria)) next.hoteleria = true;
  return next;
}

module.exports = {
  MODULE_IDS,
  buildWorkModulePermissions,
  ensureStaffWorkModulePermissions,
  ensureRecepcionistaHotelPermission,
  applyHotelStaffPermission,
};
