const { queryOne } = require('../database');
const { getControlConfig } = require('../masterAdminService');
const { normalizePlan } = require('../servicePlan');
const { getEffectivePermissions } = require('../planModuleCatalog');
const { MODULE_IDS } = require('../servicePlan');
const {
  orderHasBarItems,
  orderHasKitchenItems,
  filterItemsForKitchenStation,
} = require('../utils/productionArea');
const {
  isKnownProductionAreaId,
  parseProductionAreaIdsJson,
  getProductionAreaById,
} = require('./productionAreasService');

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
  if (moduleId === 'cocina' && (role === 'cocina' || role === 'produccion')) {
    if (role === 'cocina') return true;
    const aid = String(user?.production_area_id || '').trim();
    return !aid || aid === 'cocina';
  }
  if (moduleId === 'bar' && (role === 'bar' || role === 'produccion')) {
    if (role === 'bar') return true;
    const aid = String(user?.production_area_id || '').trim();
    return !aid || aid === 'bar';
  }
  if (moduleId === 'produccion' && (role === 'produccion' || role === 'cocina' || role === 'bar')) return true;
  const perms = getEffectivePermissionsForUser(user);
  return Boolean(perms[moduleId]) || (moduleId === 'produccion' && (perms.cocina || perms.bar));
}

/** Puede abrir el API de pedidos de producción (lectura del panel). */
function userCanAccessKitchenApi(user) {
  const role = String(user?.role || '').toLowerCase();
  if (['admin', 'cocina', 'bar', 'produccion', 'master_admin'].includes(role)) return true;
  if (['cajero', 'mozo'].includes(role)) {
    return userHasModule(user, 'cocina') || userHasModule(user, 'bar') || userHasModule(user, 'produccion');
  }
  return false;
}

function loadStaffProductionFields(user) {
  if (!user?.id) return user;
  if (user.production_area_id != null || user.production_area_ids != null) return user;
  const row = queryOne(
    'SELECT production_area_id, production_area_ids, role, caja_station_id FROM users WHERE id = ?',
    [user.id]
  );
  if (!row) return user;
  return {
    ...user,
    production_area_id: row.production_area_id,
    production_area_ids: row.production_area_ids,
    caja_station_id: user.caja_station_id ?? row.caja_station_id,
    role: user.role || row.role,
  };
}

/** Estación / área concreta. */
function userCanAccessKitchenStation(user, station) {
  const st = String(station || '').trim() || 'cocina';
  const u = loadStaffProductionFields(user);
  const role = String(u?.role || '').toLowerCase();
  if (role === 'admin' || role === 'master_admin') return true;
  if (role === 'produccion') {
    return String(u.production_area_id || '').trim() === st;
  }
  if (role === 'cocina') return st === 'cocina';
  if (role === 'bar') return st === 'bar';
  if (st === 'cocina' || st === 'bar') return userHasModule(u, st);
  return userHasModule(u, 'produccion') || userHasModule(u, 'cocina') || userHasModule(u, 'bar');
}

function resolveKitchenStation(user, queryStation) {
  const u = loadStaffProductionFields(user);
  const role = String(u?.role || '').toLowerCase();
  if (role === 'bar') return 'bar';
  if (role === 'cocina') return 'cocina';
  if (role === 'produccion') {
    const aid = String(u.production_area_id || '').trim();
    return aid || 'cocina';
  }
  const q = String(queryStation || '').trim();
  if (q && (isKnownProductionAreaId(q) || q === 'cocina' || q === 'bar' || getProductionAreaById(q))) {
    return q;
  }
  return 'cocina';
}

/** Puede marcar preparando/listo según ítems del pedido y estación del panel. */
function userCanManageKitchenOrderForStation(user, areaItems, station = '') {
  const u = loadStaffProductionFields(user);
  const role = String(u?.role || '').toLowerCase();
  if (['admin', 'master_admin'].includes(role)) return true;
  const st = String(station || '').trim();
  const scopedItems = st ? filterItemsForKitchenStation(areaItems, st) : areaItems;
  const itemsForCheck = scopedItems.length ? scopedItems : areaItems;
  if (role === 'produccion') {
    const aid = String(u.production_area_id || '').trim();
    if (!aid) return false;
    return filterItemsForKitchenStation(itemsForCheck, aid).length > 0;
  }
  const hasBar = orderHasBarItems(itemsForCheck);
  const hasKitchen = orderHasKitchenItems(itemsForCheck);
  if (role === 'cocina') return hasKitchen;
  if (role === 'bar') return hasBar;
  if (st === 'bar') return hasBar && userHasModule(u, 'bar');
  if (st === 'cocina') return hasKitchen && userHasModule(u, 'cocina');
  if (st) {
    return filterItemsForKitchenStation(itemsForCheck, st).length > 0
      && (userHasModule(u, 'produccion') || userHasModule(u, 'cocina') || userHasModule(u, 'bar'));
  }
  if (hasBar && !hasKitchen) return userHasModule(u, 'bar');
  if (hasKitchen && !hasBar) return userHasModule(u, 'cocina');
  return userHasModule(u, 'cocina') || userHasModule(u, 'bar') || userHasModule(u, 'produccion');
}

module.exports = {
  getEffectivePermissionsForUser,
  userHasModule,
  userCanAccessKitchenApi,
  userCanAccessKitchenStation,
  resolveKitchenStation,
  userCanManageKitchenOrderForStation,
  loadStaffProductionFields,
  parseProductionAreaIdsJson,
};
