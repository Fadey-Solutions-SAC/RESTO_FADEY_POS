/**
 * Agrupa mesas por salón usando la configuración guardada en servidor (nombre y orden exactos).
 * @param {Array<{id:string,name:string,description?:string,sort_order?:number}>} salones
 * @param {Array<{id:string,zone?:string,number?:number}>} tables
 */
export function tableZoneId(table) {
  return String(table?.zone || 'principal').trim() || 'principal';
}

/**
 * Mesas de un salón. Si una mesa tiene zona huérfana (no está en los salones de esa caja),
 * se muestra en el primer salón de la caja para que el listado quede completo.
 */
export function tablesForSalon(salon, tables, salonesForCaja) {
  const sid = String(salon?.id || '').trim();
  const known = new Set((salonesForCaja || []).map((s) => String(s?.id || '').trim()).filter(Boolean));
  const firstId = String(salonesForCaja?.[0]?.id || '').trim();
  return (tables || []).filter((t) => {
    const z = tableZoneId(t);
    if (z === sid) return true;
    if (!known.has(z) && firstId && firstId === sid) return true;
    return false;
  }).sort((a, b) => Number(a.number || 0) - Number(b.number || 0));
}

export function buildTablesBySalon(salones, tables) {
  const configured = Array.isArray(salones) ? [...salones] : [];
  configured.sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0));

  const byId = new Map(configured.map((s) => [String(s.id || '').trim(), s]));
  const merged = [...configured];

  for (const table of tables || []) {
    const zone = tableZoneId(table);
    if (!byId.has(zone)) {
      const entry = {
        id: zone,
        name: zone,
        description: '',
        sort_order: merged.length,
      };
      merged.push(entry);
      byId.set(zone, entry);
    }
  }

  merged.sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0));

  return merged.map((salon) => {
    const zone = String(salon.id || '').trim();
    const salonTables = tablesForSalon(salon, tables, merged);
    return {
      zone,
      label: String(salon.name ?? zone),
      description: salon.description || '',
      tables: salonTables,
    };
  });
}

export function salonSlugFromName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

/** Mueve un salón a la posición 1..N y renumera sort_order. */
export function reorderSalonList(salones, salonId, targetPosition1Based) {
  const list = [...(salones || [])].sort(
    (a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0),
  );
  const fromIdx = list.findIndex((s) => String(s.id) === String(salonId));
  if (fromIdx < 0) return list;
  const toIdx = Math.max(0, Math.min(list.length - 1, Number(targetPosition1Based) - 1));
  if (fromIdx === toIdx) return list;
  const [item] = list.splice(fromIdx, 1);
  list.splice(toIdx, 0, item);
  return list.map((s, idx) => ({ ...s, sort_order: idx }));
}
