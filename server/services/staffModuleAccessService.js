const { queryOne } = require('../database');
const { getControlConfig } = require('../masterAdminService');
const { normalizePlan } = require('../servicePlan');
const { getEffectivePermissions } = require('../planModuleCatalog');
const { MODULE_IDS } = require('../servicePlan');
const { orderHasBarItems, orderHasKitchenItems, filterItemsForKitchenStation } = require('../utils/productionArea');

function isPermissionEnabled(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function getUserPermissions(userId) {
  const row = queryOne('SELECT permissions FROM user_permissions WHERE user_id = ?', [userId]);
  if (!row?.permissions) {
    return MODULE_IDS.reduce((acc, id) => {
      acc[id] = false;
      return acc;
    }, {});
  }
  let parsed = {};
  try {
    parsed = JSON.parse(row.permissions || '{}');
  } catch {
    parsed = {};
  }
  return MODULE_IDS.reduce((acc, id) => {
    acc[id] = isPermissionEnabled(parsed[id]);
    return acc;
  }, {});
}

function getEffectivePermissionsForUser(user) {
  const control = getControlConfig();
  const plan = normalizePlan(control.service_plan);
  const moduleOverrides = control.service_plan_module_overrides || {};
  return getEffectivePermissions(plan, user?.role, getUserPermissions(user?.id), moduleOverrides);
}

function userHasModule(user, moduleId) {
  const role = String(user?.role || '').toLowerCase();
  if (role === 'admin' || role === 'master_admin') return true;
  if (moduleId === 'cocina' && role === 'cocina') return true;
  if (moduleId === 'bar' && role === 'bar') return true;
  const perms = getEffectivePermissionsForUser(user);
  return Boolean(perms[moduleId]);
}

/** Puede abrir el API de pedidos cocina/bar (lectura del panel). */
function userCanAccessKitchenApi(user) {
  const role = String(user?.role || '').toLowerCase();
  if (['admin', 'cocina', 'bar', 'master_admin'].includes(role)) return true;
  if (['cajero', 'mozo'].includes(role)) {
    return userHasModule(user, 'cocina') || userHasModule(user, 'bar');
  }
  return false;
}

/** Estación concreta: cocina o bar. */
function userCanAccessKitchenStation(user, station) {
  const st = station === 'bar' ? 'bar' : 'cocina';
  return userHasModule(user, st);
}

function resolveKitchenStation(user, queryStation) {
  const role = String(user?.role || '').toLowerCase();
  if (role === 'bar') return 'bar';
  if (role === 'cocina') return 'cocina';
  const q = String(queryStation || '').toLowerCase();
  if (q === 'bar' || q === 'cocina') return q;
  return 'cocina';
}

/** Puede marcar preparando/listo según ítems del pedido y estación del panel. */
function userCanManageKitchenOrderForStation(user, areaItems, station = '') {
  const role = String(user?.role || '').toLowerCase();
  if (['admin', 'master_admin'].includes(role)) return true;
  const st = station === 'bar' ? 'bar' : station === 'cocina' ? 'cocina' : '';
  const scopedItems = st ? filterItemsForKitchenStation(areaItems, st) : areaItems;
  const itemsForCheck = scopedItems.length ? scopedItems : areaItems;
  const hasBar = orderHasBarItems(itemsForCheck);
  const hasKitchen = orderHasKitchenItems(itemsForCheck);
  if (role === 'cocina') return hasKitchen;
  if (role === 'bar') return hasBar;
  if (st === 'bar') return hasBar && userHasModule(user, 'bar');
  if (st === 'cocina') return hasKitchen && userHasModule(user, 'cocina');
  if (hasBar && !hasKitchen) return userHasModule(user, 'bar');
  if (hasKitchen && !hasBar) return userHasModule(user, 'cocina');
  return userHasModule(user, 'cocina') || userHasModule(user, 'bar');
}

module.exports = {
  getEffectivePermissionsForUser,
  userHasModule,
  userCanAccessKitchenApi,
  userCanAccessKitchenStation,
  resolveKitchenStation,
  userCanManageKitchenOrderForStation,
};
