/**
 * Cargo / área HR derivados del usuario del sistema.
 * - Producción (o roles legado cocina/bar): cargo = produccion; área = cocina | bar | id del área
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
  const direct = String(user?.production_area_id || '').trim().toLowerCase();
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
        return String(a.id || '').trim().toLowerCase();
      }
    }
  } catch (_) {
    /* ignore */
  }
  return '';
}

/**
 * @returns {{ position: string, department: string }}
 */
function deriveHrPositionDepartment(user) {
  const r = roleLc(user);
  if (isProductionRole(r)) {
    const area = resolveProductionAreaId(user) || (r === 'bar' || r === 'cocina' ? r : 'cocina');
    return { position: 'produccion', department: area };
  }
  if (r === 'mozo') {
    return { position: 'mozo', department: 'caja-mesas' };
  }
  if (r === 'cajero') {
    return { position: 'cajero', department: 'caja' };
  }
  if (r === 'delivery') {
    return { position: 'delivery', department: 'delivery' };
  }
  if (r === 'admin' || r === 'master_admin') {
    return { position: r === 'master_admin' ? 'admin' : 'admin', department: 'administracion' };
  }
  return {
    position: r || '',
    department: '',
  };
}

module.exports = {
  deriveHrPositionDepartment,
  isProductionRole,
  resolveProductionAreaId,
};
