import { ADMIN_MODULE_PATHS } from './staffModuleAccess';

export const INFORMES_SECTION_IDS = [
  'ventas',
  'descuentos',
  'productos',
  'caja',
  'compras',
  'finanzas',
  'facturacion',
  'inventario',
];

export function resolveInformesSection(search) {
  const params = typeof search === 'string'
    ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
    : (search || new URLSearchParams());
  const raw = String(params.get('view') || params.get('seccion') || '').trim();
  if (raw === 'cortesias') return 'descuentos';
  if (INFORMES_SECTION_IDS.includes(raw)) return raw;
  return 'ventas';
}

export function isProductionShellPath(pathname) {
  const p = String(pathname || '');
  return (
    p.startsWith('/admin/cocina')
    || p.startsWith('/admin/bar')
    || p.startsWith('/admin/produccion')
    || p.startsWith('/produccion')
    || p.startsWith('/kitchen')
    || p === '/bar'
    || p.startsWith('/bar/')
  );
}

/** Clave i18n `dashboard:nav.*` para el título del módulo en la franja superior. */
export function getShellModuleTitleKey(pathname) {
  if (isProductionShellPath(pathname)) return null;
  const path = String(pathname || '').replace(/\/+$/, '') || '/admin';
  if (path === '/admin') return 'nav.escritorio';
  const ranked = [...ADMIN_MODULE_PATHS]
    .filter((row) => row.moduleId !== 'produccion' && row.moduleId !== 'cocina' && row.moduleId !== 'bar')
    .sort((a, b) => b.path.length - a.path.length);
  const hit = ranked.find((row) => path === row.path || path.startsWith(`${row.path}/`));
  return hit ? `nav.${hit.moduleId}` : null;
}

/** Título visible en la franja superior (Informes y Control De Recursos incluyen el submódulo). */
export const ALMACEN_SECTION_IDS = [
  'movimiento_interno',
  'ir_modulo_logistica',
  'requerimiento',
  'recepcion',
  'ir_modulo_gastos',
];

export function resolveAlmacenSection(search) {
  const params = typeof search === 'string'
    ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
    : (search || new URLSearchParams());
  const raw = String(params.get('view') || '').trim();
  if (ALMACEN_SECTION_IDS.includes(raw)) return raw;
  return 'movimiento_interno';
}

export function getShellModuleTitle(pathname, search, t) {
  const key = getShellModuleTitleKey(pathname);
  if (!key || typeof t !== 'function') return '';
  const base = t(key);
  const path = String(pathname || '');
  if (path.startsWith('/admin/informes')) {
    const section = resolveInformesSection(search);
    const sub = t(`informesSub.${section}`);
    return sub ? `${base} - ${sub}` : base;
  }
  if (path.startsWith('/admin/almacen')) {
    const section = resolveAlmacenSection(search);
    const sub = t(`almacenSub.${section}`);
    return sub ? `${base} - ${sub}` : base;
  }
  if (path.startsWith('/admin/caja')) {
    const params = typeof search === 'string'
      ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
      : (search || new URLSearchParams());
    const view = String(params.get('view') || 'cobrar').trim();
    if (view === 'cobrar') {
      const sub = t('cajaSub.mapa_mesas', { defaultValue: 'Mapa de Mesas' });
      return sub ? `${base} - ${sub}` : base;
    }
    const sub = t(`cajaSub.${view}`, { defaultValue: '' });
    return sub && sub !== `cajaSub.${view}` ? `${base} - ${sub}` : base;
  }
  return base;
}
