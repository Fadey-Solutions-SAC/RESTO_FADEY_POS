/** Rutas de módulos admin y roles base (permiso fino vía `user.permissions`). */
export const ADMIN_MODULE_PATHS = [
  { path: '/admin', moduleId: 'escritorio', roles: ['admin', 'cajero'] },
  { path: '/admin/caja', moduleId: 'caja', roles: ['admin', 'cajero'] },
  { path: '/admin/mesas', moduleId: 'mesas', roles: ['admin', 'mozo'] },
  { path: '/admin/produccion/cocina', moduleId: 'produccion', roles: ['admin', 'produccion', 'cocina', 'bar'] },
  { path: '/admin/cocina', moduleId: 'cocina', roles: ['admin', 'produccion', 'cocina'] },
  { path: '/admin/bar', moduleId: 'bar', roles: ['admin', 'produccion', 'bar'] },
  { path: '/admin/delivery', moduleId: 'delivery', roles: ['admin', 'cajero', 'mozo'] },
  { path: '/admin/reservas', moduleId: 'reservas', roles: ['admin', 'cajero', 'mozo'] },
  { path: '/admin/auto-pedido', moduleId: 'auto_pedido', roles: ['admin'] },
  { path: '/admin/clientes', moduleId: 'clientes', roles: ['admin', 'cajero'] },
  { path: '/admin/fidelizacion', moduleId: 'fidelizacion', roles: ['admin', 'cajero'] },
  { path: '/admin/creditos', moduleId: 'creditos', roles: ['admin', 'cajero'] },
  { path: '/admin/ofertas', moduleId: 'ofertas', roles: ['admin'] },
  { path: '/admin/descuentos', moduleId: 'descuentos', roles: ['admin'] },
  { path: '/admin/almacen', moduleId: 'almacen', roles: ['admin'] },
  { path: '/admin/productos', moduleId: 'productos', roles: ['admin'] },
  { path: '/admin/informes', moduleId: 'informes', roles: ['admin', 'cajero'] },
  { path: '/admin/ventas', moduleId: 'ventas', roles: ['admin', 'cajero'] },
  { path: '/admin/indicadores', moduleId: 'indicadores', roles: ['admin'] },
  { path: '/admin/mi-restaurant', moduleId: 'mi_restaurant', roles: ['admin', 'master_admin'] },
  { path: '/admin/tiempo-trabajado', moduleId: 'tiempo_trabajado', roles: ['admin'] },
  { path: '/admin/configuracion', moduleId: 'configuracion', roles: ['admin'] },
];

export function isPermissionEnabled(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

export function isPermissionExplicitlyDenied(value) {
  return value === false || value === 0 || value === '0' || value === 'false';
}

export function hasModulePermission(user, moduleId) {
  if (!moduleId) return true;
  if (user?.role === 'master_admin') return true;
  const role = String(user?.role || '').toLowerCase();
  if (role === 'produccion' && (moduleId === 'produccion' || moduleId === 'cocina' || moduleId === 'bar')) {
    return true;
  }
  if (role === 'cocina' && (moduleId === 'cocina' || moduleId === 'produccion')) return true;
  if (role === 'bar' && (moduleId === 'bar' || moduleId === 'produccion')) return true;
  if (!user || typeof user.permissions !== 'object' || user.permissions === null) return false;
  if (isPermissionEnabled(user.permissions[moduleId])) return true;
  // produccion cubre cocina/bar legado y viceversa
  if (moduleId === 'produccion') {
    return isPermissionEnabled(user.permissions.cocina) || isPermissionEnabled(user.permissions.bar);
  }
  if ((moduleId === 'cocina' || moduleId === 'bar') && isPermissionEnabled(user.permissions.produccion)) {
    return true;
  }
  return false;
}

/**
 * Acceso a ruta admin: permiso explícito del usuario prevalece sobre la lista de roles por defecto.
 * - true → permitir
 * - false → denegar
 * - ausente → permitir si el rol está en la lista por defecto del módulo
 */
export function canAccessStaffModule(user, { moduleId, roles } = {}) {
  if (!user) return false;
  if (user.role === 'master_admin') {
    return moduleId === 'mi_restaurant' || !moduleId;
  }
  if (moduleId && typeof user.permissions === 'object' && user.permissions != null) {
    if (isPermissionExplicitlyDenied(user.permissions[moduleId])) return false;
  }
  if (moduleId && hasModulePermission(user, moduleId)) return true;
  const roleList = Array.isArray(roles) ? roles : [];
  if (roleList.length > 0) return roleList.includes(user.role);
  return !moduleId;
}

export function getDefaultStaffPath(user, opts = {}) {
  if (!user) return '/';
  if (user.role === 'master_admin') return '/master';
  const qrOn = opts.asistenciaQrActiva != null
    ? Boolean(opts.asistenciaQrActiva)
    : (user.asistencia_qr_activa == null ? true : Boolean(user.asistencia_qr_activa));
  // Áreas de producción: si QR activo → marcar primero; si no → ir al área a operar.
  if (user.role === 'produccion' || user.role === 'cocina' || user.role === 'bar') {
    if (qrOn) return '/admin/asistencia';
    if (user.role === 'produccion') {
      const area = String(user.production_area_id || '').trim() || 'cocina';
      return hasModulePermission(user, 'produccion') ? `/admin/produccion/${area}` : '/';
    }
    if (user.role === 'cocina') {
      return hasModulePermission(user, 'cocina') ? '/admin/produccion/cocina' : '/';
    }
    return hasModulePermission(user, 'bar') ? '/admin/produccion/bar' : '/';
  }
  if (user.role === 'delivery') return hasModulePermission(user, 'delivery') ? '/delivery' : '/';
  if (!['admin', 'cajero', 'mozo'].includes(user.role)) return '/admin';
  const first = ADMIN_MODULE_PATHS.find((item) => hasModulePermission(user, item.moduleId));
  return first?.path || '/admin';
}

/**
 * Enlaces rápidos operativos (p. ej. monitoreo en vivo en Escritorio).
 * salvo la vista móvil de reparto (`/delivery`).
 */
const OPERATIONAL_NOTIFICATION_LINK_DEFS = [
  { moduleId: 'escritorio', label: 'Escritorio', routeRoles: ['admin', 'cajero', 'master_admin'] },
  { moduleId: 'mesas', label: 'Mesas', routeRoles: ['admin', 'mozo', 'master_admin'] },
  { moduleId: 'delivery', label: 'Delivery', routeRoles: ['admin', 'cajero', 'mozo', 'master_admin'] },
  { moduleId: 'cocina', label: 'Cocina', routeRoles: ['admin', 'master_admin'] },
  { moduleId: 'bar', label: 'Bar', routeRoles: ['admin', 'master_admin'] },
  { moduleId: 'almacen', label: 'Control De Recursos', routeRoles: ['admin', 'master_admin'] },
  { moduleId: 'caja', label: 'Caja', routeRoles: ['admin', 'cajero', 'master_admin'] },
  { moduleId: 'informes', label: 'Facturación', path: '/admin/informes?seccion=facturacion', routeRoles: ['admin', 'cajero', 'master_admin'] },
  { moduleId: 'delivery', label: 'Reparto', path: '/delivery', routeRoles: ['delivery'] },
];

function adminPathForModule(moduleId) {
  return ADMIN_MODULE_PATHS.find((r) => r.moduleId === moduleId)?.path;
}

/** @returns {{ to: string, label: string, moduleId: string }[]} */
export function getOperationalNotificationQuickLinks(user) {
  const role = user?.role;
  if (!role) return [];
  const out = [];
  for (const def of OPERATIONAL_NOTIFICATION_LINK_DEFS) {
    if (!def.routeRoles.includes(role)) continue;
    if (!hasModulePermission(user, def.moduleId)) continue;
    const to = def.path ?? adminPathForModule(def.moduleId);
    if (!to) continue;
    out.push({ to, label: def.label, moduleId: def.moduleId });
  }
  return out;
}

if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
  for (const def of OPERATIONAL_NOTIFICATION_LINK_DEFS) {
    if (def.path) continue;
    if (!adminPathForModule(def.moduleId)) {
      console.warn(
        `[staffModuleAccess] OPERATIONAL_NOTIFICATION_LINK_DEFS: moduleId "${def.moduleId}" sin entrada en ADMIN_MODULE_PATHS`
      );
    }
  }
}
