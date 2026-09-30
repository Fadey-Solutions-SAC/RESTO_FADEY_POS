/**
 * Planes comerciales (admin maestro) → módulos incluidos por defecto.
 * Valores en master_admin_control.service_plan: basico | emprendedor | profesional | negocio | premium
 * Alineados con la página de precios; el maestro puede activar o quitar módulos por restaurante (overrides).
 *
 * Nombres antiguos: `intermedio` → negocio, `profesional` (antes = todo) → premium vía migración.
 */

const MODULE_IDS = [
  'escritorio', 'ventas', 'caja', 'mesas', 'reservas', 'auto_pedido', 'creditos', 'clientes',
  'productos', 'ofertas', 'descuentos', 'almacen', 'delivery', 'informes',
  'indicadores', 'fidelizacion', 'mi_restaurant', 'configuracion', 'produccion', 'cocina', 'bar', 'tiempo_trabajado',
];

const PLAN_KEYS = ['basico', 'emprendedor', 'profesional', 'negocio', 'premium'];

const BASICO = new Set([
  'escritorio', 'ventas', 'caja', 'mesas', 'cocina', 'productos', 'almacen',
  'configuracion', 'mi_restaurant',
]);

const EMPRENDEDOR = new Set([...BASICO, 'produccion', 'bar', 'informes']);

const PROFESIONAL = new Set([...EMPRENDEDOR, 'clientes', 'auto_pedido', 'reservas', 'tiempo_trabajado']);

const NEGOCIO = new Set([...PROFESIONAL, 'indicadores']);

const PREMIUM = new Set(MODULE_IDS);

const MODULE_SETS = {
  basico: BASICO,
  emprendedor: EMPRENDEDOR,
  profesional: PROFESIONAL,
  negocio: NEGOCIO,
  premium: PREMIUM,
};

/** Submódulos (`padre:sub`) que el plan NO incluye por defecto. */
const PLAN_SUBS_OFF = {
  basico: [
    'almacen:requerimiento', 'almacen:recepcion', 'almacen:ir_modulo_gastos', 'almacen:ir_modulo_logistica',
    'mi_restaurant:facturacion_electronica', 'mi_restaurant:pagos_sistema',
  ],
  emprendedor: ['almacen:ir_modulo_logistica', 'mi_restaurant:facturacion_electronica', 'mi_restaurant:pagos_sistema'],
  profesional: ['almacen:ir_modulo_logistica', 'mi_restaurant:facturacion_electronica', 'mi_restaurant:pagos_sistema'],
  negocio: ['mi_restaurant:facturacion_electronica', 'mi_restaurant:pagos_sistema'],
  premium: [],
};

/** Precio mensual de lista (S/) y límite de usuarios (null = ilimitado). */
const PLAN_INFO = Object.freeze({
  basico: { label: 'Básico', price: 99, max_users: 5, fadey_ai: false },
  emprendedor: { label: 'Emprendedor', price: 149, max_users: 8, fadey_ai: false },
  profesional: { label: 'Profesional', price: 199, max_users: 12, fadey_ai: true },
  negocio: { label: 'Negocio', price: 249, max_users: 15, fadey_ai: true },
  premium: { label: 'Premium', price: 299, max_users: null, fadey_ai: true },
});

const PLAN_SAAS_LABELS = Object.freeze({
  basico: 'plan basico',
  emprendedor: 'plan emprendedor',
  profesional: 'plan profesional',
  negocio: 'plan negocio',
  premium: 'plan premium',
});

function normalizePlan(value) {
  const s = String(value || '').trim().toLowerCase().replace(/^plan\s+/, '');
  if (s === 'basico' || s === 'básico' || s === 'basic') return 'basico';
  if (s === 'emprendedor' || s === 'starter') return 'emprendedor';
  if (s === 'profesional' || s === 'professional') return 'profesional';
  if (s === 'negocio' || s === 'business' || s === 'intermedio' || s === 'intermediate' || s === 'pro') return 'negocio';
  if (s === 'premium') return 'premium';
  return 'premium';
}

/** Etiqueta enviada al panel SaaS y mostrada en backoffice. */
function formatPlanForSaas(planKey) {
  return PLAN_SAAS_LABELS[normalizePlan(planKey)] || PLAN_SAAS_LABELS.premium;
}

const PLAN_OPTIONS = Object.freeze(PLAN_KEYS.map((value) => ({
  value,
  label: `${PLAN_INFO[value].label} — S/ ${PLAN_INFO[value].price}/mes`,
})));

function getModuleSetForPlan(planKey) {
  return MODULE_SETS[normalizePlan(planKey)] || PREMIUM;
}

function isSubInPlan(planKey, compositeKey) {
  return !(PLAN_SUBS_OFF[normalizePlan(planKey)] || []).includes(compositeKey);
}

function getPlanInfo(planKey) {
  const key = normalizePlan(planKey);
  return { key, ...PLAN_INFO[key] };
}

/** Requerimiento / recepción en almacén: incluidos desde Emprendedor. */
function planAllowsAlmacenAvanzado(planKey) {
  return normalizePlan(planKey) !== 'basico';
}

module.exports = {
  MODULE_IDS,
  PLAN_KEYS,
  PLAN_INFO,
  PLAN_SAAS_LABELS,
  PLAN_OPTIONS,
  normalizePlan,
  formatPlanForSaas,
  getModuleSetForPlan,
  isSubInPlan,
  getPlanInfo,
  planAllowsAlmacenAvanzado,
};
