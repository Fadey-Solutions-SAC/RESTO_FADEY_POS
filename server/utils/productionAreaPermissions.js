/**
 * Permiso por área de producción real (`prodarea:<id>`).
 * Cocina y Bar siguen en `cocina` / `bar` para el código anterior.
 */
const AREA_PERM_PREFIX = 'prodarea:';
const AREA_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

function isPermissionEnabled(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function areaPermKey(areaId) {
  return `${AREA_PERM_PREFIX}${String(areaId || '').trim()}`;
}

function isAreaPermKey(key) {
  const raw = String(key || '');
  if (!raw.startsWith(AREA_PERM_PREFIX)) return false;
  return AREA_ID_RE.test(raw.slice(AREA_PERM_PREFIX.length));
}

function readAreaPermissions(parsed) {
  const out = {};
  if (!parsed || typeof parsed !== 'object') return out;
  for (const [key, value] of Object.entries(parsed)) {
    if (!isAreaPermKey(key)) continue;
    out[key] = isPermissionEnabled(value);
  }
  return out;
}

/** Si el guardado trae áreas, cocina/bar/produccion quedan alineados con esas áreas. */
function applyLegacyStationFlags(target, areaPerms) {
  const entries = Object.entries(areaPerms || {});
  if (!entries.length) return target;
  target.cocina = false;
  target.bar = false;
  target.produccion = false;
  for (const [key, on] of entries) {
    if (!on) continue;
    const id = key.slice(AREA_PERM_PREFIX.length).toLowerCase();
    if (id === 'cocina') target.cocina = true;
    else if (id === 'bar') target.bar = true;
    else target.produccion = true;
  }
  return target;
}

module.exports = {
  AREA_PERM_PREFIX,
  areaPermKey,
  isAreaPermKey,
  readAreaPermissions,
  applyLegacyStationFlags,
  isPermissionEnabled,
};
