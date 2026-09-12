/**
 * Cargo / área HR derivados del usuario del sistema.
 * - Producción (o roles legado cocina/bar): cargo = produccion; área = nombre del área (Cocina, Bar, …)
 * - Mozo: cargo = mozo; área = caja-mesas
 */

function roleLc(userOrRole) {
  if (userOrRole && typeof userOrRole === 'object') {
    return String(userOrRole.role || '').trim().toLowerCase();
  }
  return String(userOrRole || '').trim().toLowerCase();
}

function isProductionRole(role) {
  const r = roleLc(role);
  return r === 'produccion' || r === 'cocina' || r === 'bar';
}

function resolveProductionAreaId(user) {
  const direct = String(user?.production_area_id || '').trim();
  if (direct) return direct;

  const r = roleLc(user);
  if (r === 'cocina' || r === 'bar') return r;

  // Buscar en áreas de producción (encargado vinculado)
  try {
    const { readProductionAreas } = require('./productionAreasService');
    const uid = String(user?.id || user?.user_id || '').trim();
    if (!uid) return '';
    const areas = readProductionAreas() || [];
    for (const a of areas) {
      const ids = Array.isArray(a.encargado_user_ids) ? a.encargado_user_ids : [];
      if (ids.some((x) => String(x) === uid)) {
        return String(a.id || '').trim();
      }
    }
  } catch (_) {
    /* ignore */
  }
  return '';
}

function productionAreaDisplayName(areaId) {
  const id = String(areaId || '').trim();
  if (!id) return '';
  try {
    const { getProductionAreaById, readProductionAreas } = require('./productionAreasService');
    const hit = getProductionAreaById(id)
      || (readProductionAreas() || []).find((a) => String(a.id || '').toLowerCase() === id.toLowerCase());
    if (hit?.name) return String(hit.name).trim();
  } catch (_) {
    /* ignore */
  }
  // Legado cocina/bar sin config
  if (id.toLowerCase() === 'cocina') return 'Cocina';
  if (id.toLowerCase() === 'bar') return 'Bar';
  return id;
}

/**
 * @returns {{ position: string, department: string, production_area_id: string }}
 */
function deriveHrPositionDepartment(user) {
  const r = roleLc(user);
  if (isProductionRole(r)) {
    const areaId = resolveProductionAreaId(user) || (r === 'bar' || r === 'cocina' ? r : 'cocina');
    return {
      position: 'produccion',
      department: productionAreaDisplayName(areaId),
      production_area_id: areaId,
    };
  }
  if (r === 'mozo') {
    return { position: 'mozo', department: 'caja-mesas', production_area_id: '' };
  }
  if (r === 'cajero') {
    return { position: 'cajero', department: 'caja', production_area_id: '' };
  }
  if (r === 'delivery') {
    return { position: 'delivery', department: 'delivery', production_area_id: '' };
  }
  if (r === 'admin' || r === 'master_admin') {
    return { position: 'admin', department: 'administracion', production_area_id: '' };
  }
  return {
    position: r || '',
    department: '',
    production_area_id: '',
  };
}

module.exports = {
  deriveHrPositionDepartment,
  isProductionRole,
  resolveProductionAreaId,
  productionAreaDisplayName,
};
