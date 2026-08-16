/**
 * Planes comerciales (admin maestro) → módulos permitidos.
 * Valores en master_admin_control.service_plan: basico | intermedio | profesional
 *
 * Alineación con comercial:
 * - Básico: lo anterior + Mi Restaurante (sin pestaña SUNAT), ofertas y descuentos. La pestaña «Información» (backup) solo la ve el administrador maestro en la UI.
 * - Intermedio: + QR auto-pedido, clientes/créditos, cocina/bar, indicadores, tiempo trabajado.
 * - Profesional: todas las claves en MODULE_IDS.
 */

const MODULE_IDS = [
  'escritorio', 'ventas', 'caja', 'mesas', 'reservas', 'auto_pedido', 'creditos', 'clientes',
  'productos', 'ofertas', 'descuentos', 'almacen', 'delivery', 'informes',
  'indicadores', 'mi_restaurant', 'configuracion', 'produccion', 'cocina', 'bar', 'tiempo_trabajado',
];

const BASICO = new Set([
  'escritorio', 'ventas', 'caja', 'mesas', 'reservas', 'delivery',
  'almacen', 'informes', 'productos', 'configuracion',
  'mi_restaurant', 'ofertas', 'descuentos',
]);

const INTERMEDIO = new Set([
  ...BASICO,
  'auto_pedido', 'creditos', 'clientes', 'produccion', 'cocina', 'bar',
  'indicadores', 'tiempo_trabajado',
]);

const PROFESIONAL = new Set(MODULE_IDS);

const PLAN_SAAS_LABELS = Object.freeze({
  basico: 'plan basico',
  intermedio: 'plan pro',
  profesional: 'plan premium',
});

function normalizePlan(value) {
  const s = String(value || '').trim().toLowerCase();
  if (s === 'basico' || s === 'básico' || s === 'basic' || s === 'plan basico') return 'basico';
  if (s === 'intermedio' || s === 'intermediate' || s === 'plan pro' || s === 'pro') return 'intermedio';
  if (
    s === 'profesional'
    || s === 'professional'
    || s === 'plan premium'
    || s === 'premium'
  ) {
    return 'profesional';
  }
  return 'profesional';
}

/** Etiqueta enviada al panel SaaS y mostrada en backoffice. */
function formatPlanForSaas(planKey) {
  return PLAN_SAAS_LABELS[normalizePlan(planKey)] || PLAN_SAAS_LABELS.profesional;
}

const PLAN_OPTIONS = Object.freeze([
  { value: 'basico', label: 'plan basico' },
  { value: 'intermedio', label: 'plan pro' },
  { value: 'profesional', label: 'plan premium' },
]);

function getModuleSetForPlan(planKey) {
  const p = normalizePlan(planKey);
  if (p === 'basico') return BASICO;
  if (p === 'intermedio') return INTERMEDIO;
  return PROFESIONAL;
}

/** Requerimiento / recepción en almacén: solo intermedio o superior (marketing: almacén avanzado). */
function planAllowsAlmacenAvanzado(planKey) {
  return normalizePlan(planKey) !== 'basico';
}

module.exports = {
  MODULE_IDS,
  PLAN_SAAS_LABELS,
  PLAN_OPTIONS,
  normalizePlan,
  formatPlanForSaas,
  getModuleSetForPlan,
  planAllowsAlmacenAvanzado,
};
