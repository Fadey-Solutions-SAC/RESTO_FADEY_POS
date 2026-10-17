/**
 * Agrupación visual del menú principal.
 * No define módulos nuevos: solo ordena y titula los moduleId existentes.
 */

export const NAV_MENU_GROUPS = [
  {
    id: 'inicio',
    title: 'INICIO',
    subtitle: 'Acceso general y resumen del negocio',
    moduleIds: ['escritorio'],
  },
  {
    id: 'operacion',
    title: 'OPERACIÓN',
    subtitle: 'Herramientas para la atención y el funcionamiento diario del restaurante',
    moduleIds: ['caja', 'mesas', 'produccion', 'cocina', 'bar', 'delivery', 'reservas', 'auto_pedido'],
  },
  {
    id: 'comercial',
    title: 'GESTIÓN COMERCIAL',
    subtitle: 'Clientes, ventas y relaciones comerciales',
    moduleIds: ['ventas', 'clientes', 'fidelizacion', 'creditos', 'ofertas'],
  },
  {
    id: 'catalogo',
    title: 'PRODUCTOS Y CATÁLOGO',
    subtitle: 'Administración del catálogo y los productos disponibles',
    moduleIds: ['productos'],
  },
  {
    id: 'control',
    title: 'CONTROL Y ANÁLISIS',
    subtitle: 'Seguimiento operativo, indicadores e informes del negocio',
    moduleIds: ['almacen', 'indicadores', 'informes'],
  },
  {
    id: 'administracion',
    title: 'ADMINISTRACIÓN',
    subtitle: 'Configuración general y gestión interna del restaurante',
    moduleIds: ['mi_restaurant', 'tiempo_trabajado', 'configuracion'],
  },
];

function productionAreaRank(id) {
  if (id === 'cocina') return 0;
  if (id === 'bar') return 1;
  return 2;
}

/**
 * Cocina, luego Bar, luego el resto en el orden de la fuente (creación / array persistido).
 * No inventa ids ni reescribe registros.
 */
export function sortProductionAreasForNav(list) {
  const areas = (Array.isArray(list) ? list : [])
    .map((area, index) => ({
      id: String(area?.id || '').trim(),
      name: String(area?.name || '').trim() || String(area?.id || ''),
      createdOrder: Number.isFinite(Number(area?.createdOrder)) ? Number(area.createdOrder) : index,
    }))
    .filter((area) => area.id);

  return areas.sort((a, b) => {
    const rankA = productionAreaRank(a.id);
    const rankB = productionAreaRank(b.id);
    if (rankA !== rankB) return rankA - rankB;
    return a.createdOrder - b.createdOrder;
  });
}

export function groupNavLinks(links, groups = NAV_MENU_GROUPS) {
  const source = Array.isArray(links) ? links : [];
  const used = new Set();
  const out = [];

  for (const group of groups) {
    const allowed = new Set(group.moduleIds);
    const items = source.filter((link) => allowed.has(link.moduleId));
    items.forEach((link) => used.add(link.to));
    if (items.length) {
      out.push({
        id: group.id,
        title: group.title,
        subtitle: group.subtitle,
        items,
      });
    }
  }

  const leftover = source.filter((link) => !used.has(link.to));
  if (leftover.length) {
    out.push({ id: 'otros', title: '', subtitle: '', items: leftover });
  }
  return out;
}
