const { queryOne } = require('../database');
const { isPermissionEnabled, cajaSubPermissionKey } = require('../planModuleCatalog');

function getRawUserPermissionsJson(userId) {
  const row = queryOne('SELECT permissions FROM user_permissions WHERE user_id = ?', [userId]);
  if (!row?.permissions) return {};
  try {
    const parsed = JSON.parse(row.permissions || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function userHasCajaSubPermission(userId, role, subId) {
  const roleLc = String(role || '').toLowerCase();
  if (roleLc === 'admin' || roleLc === 'master_admin') return true;
  const raw = getRawUserPermissionsJson(userId);
  return isPermissionEnabled(raw[cajaSubPermissionKey(subId)]);
}

function userCanEliminarLiberarMesa(user) {
  return userHasCajaSubPermission(user?.id, user?.role, 'eliminar_liberar_mesa');
}

function userCanAjusteBarAutoDismiss(user) {
  return userHasCajaSubPermission(user?.id, user?.role, 'ajuste_bar_auto_dismiss');
}

module.exports = {
  getRawUserPermissionsJson,
  userHasCajaSubPermission,
  userCanEliminarLiberarMesa,
  userCanAjusteBarAutoDismiss,
};
