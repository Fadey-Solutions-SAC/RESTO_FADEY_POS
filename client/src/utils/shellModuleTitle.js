import { ADMIN_MODULE_PATHS } from './staffModuleAccess';

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
