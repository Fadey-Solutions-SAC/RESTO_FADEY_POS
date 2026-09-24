/**
 * La IA no define permisos: lee los de Usuarios (user_permissions + plan)
 * vía staffModuleAccessService, igual que el menú del POS.
 */
const { MODULE_LABELS } = require('../../planModuleCatalog');
const {
  userHasModule,
  getEffectivePermissionsForUser,
  loadStaffProductionFields,
} = require('../staffModuleAccessService');
const { userCanEliminarLiberarMesa } = require('../../lib/cajaPermissions');
const { OPERATION_GUIDES } = require('./fadeyAiGuides');

/** Módulo(s) requeridos por guía (cualquiera basta). null = todos los staff. */
const GUIDE_MODULES = {
  'guide-abrir-caja': ['caja'],
  'guide-cerrar-caja': ['caja'],
  'guide-cobrar': ['caja'],
  'guide-caja-ingresos-egresos': ['caja'],
  'guide-cierres-historial': ['caja'],
  'guide-notas-credito-debito': ['caja'],
  'guide-mapa-mesas-caja': ['caja', 'mesas'],
  'guide-mesas-pedido': ['mesas', 'caja'],
  'guide-mover-pedido': ['mesas', 'caja'],
  'guide-liberar-mesa': ['mesas', 'caja'],
  'guide-unir-cuentas': ['mesas', 'caja'],
  'guide-anular-producto': ['mesas', 'caja'],
  'guide-salones-mesas': ['mesas', 'configuracion'],
  'guide-cocina': ['cocina', 'produccion'],
  'guide-bar': ['bar', 'produccion'],
  'guide-crear-area-produccion': ['configuracion'],
  'guide-area-produccion': ['configuracion', 'produccion', 'cocina', 'bar'],
  'guide-delivery': ['delivery'],
  'guide-reservas': ['reservas'],
  'guide-auto-pedido-cartas': ['auto_pedido'],
  'guide-qr-home-productos-cartas': ['auto_pedido'],
  'guide-qr-imprimir': ['auto_pedido', 'mesas'],
  'guide-clientes': ['clientes'],
  'guide-creditos': ['creditos'],
  'guide-encuesta-clientes': ['clientes', 'fidelizacion'],
  'guide-fidelizacion': ['fidelizacion'],
  'guide-ofertas': ['ofertas'],
  'guide-descuentos': ['descuentos'],
  'guide-productos': ['productos'],
  'guide-categorias': ['productos'],
  'guide-combos-recetas': ['productos'],
  'guide-requerimiento': ['almacen'],
  'guide-recepcion': ['almacen'],
  'guide-movimiento-interno': ['almacen'],
  'guide-inventario-kardex': ['almacen'],
  'guide-gastos-almacen': ['almacen'],
  'guide-informes': ['informes'],
  'guide-ventas': ['ventas', 'informes'],
  'guide-indicadores': ['indicadores'],
  'guide-escritorio': ['escritorio'],
  'guide-crear-usuario': ['configuracion'],
  'guide-permisos-usuario': ['configuracion'],
  'guide-cajas-config': ['configuracion'],
  'guide-impresora': ['caja', 'configuracion'],
  'guide-config-general': ['configuracion'],
  'guide-asistencia': ['tiempo_trabajado'],
  'guide-rrhh': ['tiempo_trabajado'],
  'guide-mi-restaurant': ['mi_restaurant'],
  'guide-pago-plan': ['mi_restaurant'],
  'guide-facturacion-electronica': ['mi_restaurant'],
  'guide-mensajes': null,
  'guide-notificaciones': null,
  'guide-login': null,
  'guide-offline': ['caja', 'mesas'],
  'guide-ia': null,
};

/** Herramientas → módulos (anyOf). null = todos. */
const TOOL_MODULES = {
  sales_summary: ['ventas', 'informes', 'caja', 'escritorio', 'indicadores'],
  sales_desk: ['ventas', 'informes', 'caja'],
  top_products: ['ventas', 'informes', 'productos', 'cocina', 'bar', 'produccion', 'mesas', 'caja'],
  low_stock: ['almacen', 'productos', 'informes'],
  kitchen_open_orders: ['cocina', 'bar', 'produccion'],
  active_staff: ['tiempo_trabajado'],
  business_insights: ['ventas', 'informes', 'indicadores', 'escritorio'],
  hr_insights: ['tiempo_trabajado', 'cocina', 'bar', 'produccion'],
  search_guides: null,
};

function roleLc(user) {
  return String(user?.role || '').toLowerCase();
}

function enrichUser(user) {
  if (!user) return user;
  const u = loadStaffProductionFields(user);
  if (u.permissions && typeof u.permissions === 'object') return u;
  try {
    const perms = getEffectivePermissionsForUser(u);
    return { ...u, permissions: perms };
  } catch {
    return u;
  }
}

function isFullAccess(user) {
  const r = roleLc(user);
  return r === 'admin' || r === 'master_admin';
}

function hasAnyModule(user, moduleIds) {
  if (!moduleIds || !moduleIds.length) return true;
  if (isFullAccess(user)) return true;
  const u = enrichUser(user);
  return moduleIds.some((id) => userHasModule(u, id));
}

function hasModule(user, moduleId) {
  if (!moduleId) return true;
  if (isFullAccess(user)) return true;
  return userHasModule(enrichUser(user), moduleId);
}

function listAllowedModules(user) {
  if (isFullAccess(user)) {
    return Object.keys(MODULE_LABELS || {}).filter(Boolean);
  }
  const u = enrichUser(user);
  const perms = getEffectivePermissionsForUser(u) || {};
  return Object.keys(perms).filter((k) => !String(k).includes(':') && perms[k]);
}

function moduleLabel(id) {
  return MODULE_LABELS[id] || id;
}

function describeUserAccess(user) {
  const u = enrichUser(user);
  const role = roleLc(u);
  const modules = listAllowedModules(u);
  const area = String(u.production_area_id || '').trim();
  return {
    role,
    area: area || null,
    modules,
    labels: modules.map(moduleLabel),
    canLiberarMesa: userCanEliminarLiberarMesa(u),
  };
}

function canUseTool(user, toolName) {
  const name = String(toolName || '');
  if (name === 'search_guides') return true;
  if (isFullAccess(user)) return true;
  const need = TOOL_MODULES[name];
  if (need === undefined) return false;
  if (need === null) return true;
  if (name === 'active_staff') return hasModule(user, 'tiempo_trabajado');
  return hasAnyModule(user, need);
}

function deniedToolMessage(toolName) {
  const need = TOOL_MODULES[toolName] || [];
  const labels = need.map(moduleLabel).join(', ');
  return labels
    ? `No tienes permiso para ver esa información. Requiere acceso a: ${labels}. Pide al administrador que active el módulo en tus permisos.`
    : 'No tienes permiso para ver esa información.';
}

function guideAllowedForUser(user, guideId) {
  const id = String(guideId || '');
  if (!id) return false;
  const need = Object.prototype.hasOwnProperty.call(GUIDE_MODULES, id)
    ? GUIDE_MODULES[id]
    : undefined;

  if (need === null) return true;

  if (need === undefined) {
    if (/caja|cobrar|arqueo/.test(id)) return hasAnyModule(user, ['caja']);
    if (/mesa|liberar|mover|unir|anular/.test(id)) return hasAnyModule(user, ['mesas', 'caja']);
    if (/cocina/.test(id)) return hasAnyModule(user, ['cocina', 'produccion']);
    if (/bar/.test(id)) return hasAnyModule(user, ['bar', 'produccion']);
    if (/almacen|kardex|requer|recep|inventario|gasto/.test(id)) return hasModule(user, 'almacen');
    if (/venta|informe|indicador/.test(id)) return hasAnyModule(user, ['ventas', 'informes', 'indicadores']);
    if (/usuario|permiso|config/.test(id)) return hasModule(user, 'configuracion');
    if (/rrhh|asistencia/.test(id)) return hasModule(user, 'tiempo_trabajado');
    return isFullAccess(user);
  }

  if (id === 'guide-liberar-mesa' && !isFullAccess(user)) {
    if (!hasAnyModule(user, need)) return false;
    if (roleLc(user) === 'cajero') return userCanEliminarLiberarMesa(user);
    return true;
  }
  return hasAnyModule(user, need);
}

function filterGuidesForUser(user, guides = OPERATION_GUIDES) {
  return (guides || []).filter((g) => guideAllowedForUser(user, g.id));
}

function filterGuideHitsForUser(user, hits = []) {
  return (hits || []).filter((h) => guideAllowedForUser(user, h.id));
}

function deniedGuideMessage(user, guideId) {
  const need = GUIDE_MODULES[String(guideId || '')] || [];
  const labels = (need || []).map(moduleLabel).join(', ');
  const access = describeUserAccess(user);
  const mine = access.labels.length
    ? `Tus módulos activos: ${access.labels.join(', ')}.`
    : 'No tienes módulos POS activos.';
  return labels
    ? `Esa operación está en un módulo al que no tienes acceso (${labels}). ${mine} Pide al administrador que te asigne el permiso.`
    : `No tienes permiso para esa guía. ${mine}`;
}

function suggestionOptionsForUser(user) {
  const u = enrichUser(user);
  const opts = [];
  const push = (q) => {
    if (!opts.includes(q)) opts.push(q);
  };

  if (hasAnyModule(u, ['caja'])) {
    push('¿Cómo cobrar una mesa?');
    push('¿Cómo cerrar caja?');
  }
  if (hasAnyModule(u, ['mesas', 'caja'])) {
    push('¿Cómo tomar un pedido en mesa?');
    push('¿Cómo mover un pedido de mesa?');
  }
  if (hasAnyModule(u, ['ventas', 'informes', 'caja', 'escritorio'])) {
    push('¿Cuánto vendí hoy?');
  }
  if (hasAnyModule(u, ['cocina', 'bar', 'produccion', 'tiempo_trabajado'])) {
    push('¿Hay demoras en cocina?');
  }
  if (hasAnyModule(u, ['almacen', 'productos'])) {
    push('¿Hay stock bajo?');
  }
  if (hasModule(u, 'tiempo_trabajado')) {
    push('¿Quién está en jornada ahora?');
  }
  push('¿Cómo marcar asistencia con QR?');
  if (hasModule(u, 'delivery')) push('¿Cómo gestionar delivery?');
  if (hasModule(u, 'reservas')) push('¿Cómo crear una reserva?');
  if (hasModule(u, 'configuracion')) push('¿Cómo crear un usuario?');
  if (hasModule(u, 'almacen')) push('¿Cómo hacer un requerimiento?');

  if (!opts.length) {
    push('¿Qué puedo hacer en el POS?');
  }
  return opts.slice(0, 6);
}

function accessIntroForUser(user) {
  const access = describeUserAccess(user);
  if (isFullAccess(user)) {
    return 'Como administrador puedes consultar todos los módulos del POS.';
  }
  if (!access.labels.length) {
    return 'Aún no tienes módulos POS asignados; solo puedo ayudarte con lo básico (login, asistencia).';
  }
  const areaBit = access.area ? ` Área: ${access.area}.` : '';
  return `Según tus permisos, te ayudo con: ${access.labels.join(', ')}.${areaBit}`;
}

function whatCanIDoAnswer(user) {
  const access = describeUserAccess(user);
  const lines = [
    accessIntroForUser(user),
    '',
    'Puedo darte pasos e información solo de lo que tienes permitido.',
  ];
  if (access.labels.length && !isFullAccess(user)) {
    lines.push('', 'Módulos activos:');
    access.labels.forEach((l) => lines.push(`- ${l}`));
  }
  const opts = suggestionOptionsForUser(user);
  if (opts.length) {
    lines.push('', 'Ejemplos:');
    opts.forEach((o, i) => lines.push(`${i + 1}. ${o}`));
  }
  return lines.join('\n');
}

module.exports = {
  enrichUser,
  isFullAccess,
  hasModule,
  hasAnyModule,
  listAllowedModules,
  describeUserAccess,
  canUseTool,
  deniedToolMessage,
  guideAllowedForUser,
  filterGuidesForUser,
  filterGuideHitsForUser,
  deniedGuideMessage,
  suggestionOptionsForUser,
  accessIntroForUser,
  whatCanIDoAnswer,
  GUIDE_MODULES,
  TOOL_MODULES,
};
