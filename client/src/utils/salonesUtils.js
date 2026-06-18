/**
 * Agrupa mesas por salón usando la configuración guardada en servidor (nombre y orden exactos).
 * @param {Array<{id:string,name:string,description?:string,sort_order?:number}>} salones
 * @param {Array<{id:string,zone?:string,number?:number}>} tables
 */
export function buildTablesBySalon(salones, tables) {
  const configured = Array.isArray(salones) ? [...salones] : [];
  configured.sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0));

  const byId = new Map(configured.map((s) => [String(s.id || '').trim(), s]));
  const merged = [...configured];

  for (const table of tables || []) {
    const zone = String(table?.zone || 'principal').trim() || 'principal';
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
    const salonTables = (tables || [])
      .filter((t) => (String(t.zone || 'principal').trim() || 'principal') === zone)
      .sort((a, b) => Number(a.number || 0) - Number(b.number || 0));
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
