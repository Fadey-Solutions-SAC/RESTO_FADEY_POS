/**
 * Catálogo de módulos por plan + overrides (master_admin_control.service_plan_module_overrides).
 * Claves: módulo (`caja`) o compuesto `caja:cobrar`, `mi_restaurant:facturacion_electronica`.
 */

const { MODULE_IDS, normalizePlan, getModuleSetForPlan } = require('./servicePlan');

const MODULE_LABELS = {
  escritorio: 'Escritorio',
  ventas: 'Ventas',
  caja: 'Caja',
  mesas: 'Mesas',
  reservas: 'Reservas',
  auto_pedido: 'Auto pedido (QR)',
  creditos: 'Créditos',
  clientes: 'Clientes',
  productos: 'Productos',
  ofertas: 'Ofertas',
  descuentos: 'Descuentos',
  almacen: 'Almacenes e inventario',
  delivery: 'Delivery',
  informes: 'Informes',
  indicadores: 'Indicadores',
  mi_restaurant: 'Mi Restaurante',
  configuracion: 'Configuración',
  produccion: 'Producción',
  cocina: 'Cocina',
  bar: 'Bar',
  tiempo_trabajado: 'Tiempo trabajado',
};

const CAJA_SUBS = [
  { id: 'cobrar', label: 'Cobrar' },
  { id: 'apertura_cierre', label: 'Apertura y cierre' },
  { id: 'cierres_caja', label: 'Cierres de caja' },
  { id: 'ingresos', label: 'Ingresos' },
  { id: 'egresos', label: 'Egresos' },
  { id: 'notas_credito', label: 'Notas de crédito' },
  { id: 'notas_debito', label: 'Notas de débito' },
  { id: 'consulta_precios', label: 'Consulta de precios' },
  { id: 'impresora', label: 'Impresora' },
  { id: 'eliminar_liberar_mesa', label: 'Eliminar y liberar mesa' },
  { id: 'ajuste_bar_auto_dismiss', label: 'Bar: quitar productos tras 30 min' },
];

/** Subpermisos de caja que el admin activa por usuario (opt-in, no vienen del plan). */
const CAJA_USER_OPT_IN_SUBS = new Set(['eliminar_liberar_mesa']);

function cajaSubPermissionKey(subId) {
  return `caja:${String(subId || '').trim()}`;
}

const MI_RESTAURANT_SUBS = [
  { id: 'mi_empresa', label: 'Mi empresa' },
  { id: 'facturacion_electronica', label: 'Facturación electrónica (SUNAT)' },
  { id: 'pagos_sistema', label: 'Pagos de créditos' },
  { id: 'contrato', label: 'Contrato del servicio' },
  { id: 'pago_uso_sistema', label: 'Pago por uso del sistema' },
  { id: 'informacion', label: 'Información (respaldo)' },
];

const ALMACEN_SUBS = [
  { id: 'movimiento_interno', label: 'Movimiento interno' },
  { id: 'ir_modulo_logistica', label: 'Inventario y kardex' },
  { id: 'requerimiento', label: 'Requerimiento' },
  { id: 'recepcion', label: 'Recepción' },
  { id: 'ir_modulo_gastos', label: 'Ir a módulo de gastos' },
];

const PARENTS_WITH_SUBS = new Set(['caja', 'mi_restaurant', 'almacen']);

function isTruthyOverride(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}

function isFalsyOverride(v) {
  return v === false || v === 0 || v === '0' || v === 'false';
}

/** @param {unknown} raw */
function parseModuleOverrides(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = String(k || '').trim();
    if (!key) continue;
    if (isFalsyOverride(v)) out[key] = false;
    else if (isTruthyOverride(v)) out[key] = true;
  }
  return out;
}

function getSubmoduleListForPlan(planKey, parentId) {
  const p = normalizePlan(planKey);
  if (parentId === 'caja') return CAJA_SUBS;
  if (parentId === 'mi_restaurant') {
    if (p === 'profesional') return MI_RESTAURANT_SUBS;
    return MI_RESTAURANT_SUBS.filter((x) => x.id !== 'facturacion_electronica');
  }
  if (parentId === 'almacen') {
    if (p === 'basico') return ALMACEN_SUBS.filter((x) => !['requerimiento', 'recepcion'].includes(x.id));
    return ALMACEN_SUBS;
  }
  return [];
}

/**
 * Orden de visualización alineado al menú lateral.
 * @param {string} planKey
 */
function buildPlanModuleTreeForPlan(planKey) {
  const planSet = getModuleSetForPlan(planKey);
  const order = [
    'escritorio', 'ventas', 'caja', 'mesas', 'produccion', 'cocina', 'bar', 'delivery', 'reservas', 'auto_pedido',
    'clientes', 'creditos', 'ofertas', 'descuentos', 'almacen', 'productos', 'informes', 'indicadores',
    'mi_restaurant', 'tiempo_trabajado', 'configuracion',
  ];
  const tree = [];
  for (const id of order) {
    if (!MODULE_IDS.includes(id) || !planSet.has(id)) continue;
    const label = MODULE_LABELS[id] || id;
    const children = getSubmoduleListForPlan(planKey, id);
    if (children.length) {
      tree.push({ id, label, children: children.map((c) => ({ id: c.id, label: c.label })) });
    } else {
      tree.push({ id, label });
    }
  }
  return tree;
}

function buildPlanModuleTrees() {
  return {
    basico: buildPlanModuleTreeForPlan('basico'),
    intermedio: buildPlanModuleTreeForPlan('intermedio'),
    profesional: buildPlanModuleTreeForPlan('profesional'),
  };
}

function collectAllowedOverrideKeys(planKey) {
  const tree = buildPlanModuleTreeForPlan(planKey);
  const keys = new Set();
  for (const node of tree) {
    keys.add(node.id);
    for (const ch of node.children || []) {
      keys.add(`${node.id}:${ch.id}`);
    }
  }
  return keys;
}

function sanitizeModuleOverridesForPlan(planKey, rawOverrides) {
  const parsed = parseModuleOverrides(rawOverrides);
  const allowed = collectAllowedOverrideKeys(planKey);
  const out = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (!allowed.has(k)) continue;
    out[k] = v;
  }
  return out;
}

function isPermissionEnabled(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

/**
 * @param {string} planKey
 * @param {string} role
 * @param {Record<string, boolean>} rawPerms
 * @param {Record<string, boolean>} moduleOverrides
 */
function getEffectivePermissions(planKey, role, rawPerms = {}, moduleOverrides = {}) {
  const planSet = getModuleSetForPlan(planKey);
  const r = String(role || '').toLowerCase();
  const ov = parseModuleOverrides(moduleOverrides);
  return MODULE_IDS.reduce((acc, id) => {
    if (ov[id] === false) {
      acc[id] = false;
      return acc;
    }
    const inPlan = planSet.has(id);
    const userGranted = isPermissionEnabled(rawPerms[id]);
    if (r === 'admin') {
      acc[id] = inPlan;
    } else {
      /** Permiso explícito en Usuarios prevalece sobre el plan SaaS (salvo bloqueo maestro). */
      acc[id] = userGranted;
    }
    return acc;
  }, {});
}

/**
 * @param {string} planKey
 * @param {Record<string, boolean>} moduleOverrides
 * @param {Record<string, boolean>} topLevelPermissions — resultado de getEffectivePermissions
 */
function buildSubPermissions(planKey, moduleOverrides, topLevelPermissions, rawUserPerms = {}) {
  const ov = parseModuleOverrides(moduleOverrides);
  const out = { caja: {}, mi_restaurant: {}, almacen: {} };
  for (const parent of PARENTS_WITH_SUBS) {
    const parentOn = Boolean(topLevelPermissions[parent]);
    const children = getSubmoduleListForPlan(planKey, parent);
    for (const ch of children) {
      const key = `${parent}:${ch.id}`;
      let subOn = parentOn && ov[key] !== false;
      if (parent === 'caja' && CAJA_USER_OPT_IN_SUBS.has(ch.id)) {
        subOn = parentOn && isPermissionEnabled(rawUserPerms[cajaSubPermissionKey(ch.id)]);
      }
      out[parent][ch.id] = subOn;
    }
  }
  return out;
}

module.exports = {
  MODULE_LABELS,
  PARENTS_WITH_SUBS,
  CAJA_USER_OPT_IN_SUBS,
  cajaSubPermissionKey,
  buildPlanModuleTreeForPlan,
  buildPlanModuleTrees,
  parseModuleOverrides,
  sanitizeModuleOverridesForPlan,
  collectAllowedOverrideKeys,
  getEffectivePermissions,
  buildSubPermissions,
  getSubmoduleListForPlan,
  isPermissionEnabled,
};
