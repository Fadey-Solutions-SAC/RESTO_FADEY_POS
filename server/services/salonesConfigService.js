const { queryOne, runSql } = require('../database');

const DEFAULT_SALONES = [
  {
    id: 'principal',
    name: 'Salón Principal',
    description: 'Área principal del restaurante',
    sort_order: 0,
  },
];

function parseSettingsBlob() {
  const row = queryOne('SELECT value FROM app_settings WHERE key = ?', ['settings']);
  try {
    return row?.value ? JSON.parse(row.value) : {};
  } catch {
    return {};
  }
}

function normalizeSalonesList(list) {
  if (!Array.isArray(list)) return [];
  const { DEFAULT_PRIMARY_CAJA_ID } = require('../cajaSettings');
  return list
    .map((s, idx) => ({
      id: String(s?.id || '').trim() || `salon_${idx}`,
      name: String(s?.name ?? '').trim() || String(s?.id || 'Salón'),
      description: String(s?.description || '').trim(),
      sort_order: Number.isFinite(Number(s?.sort_order)) ? Number(s.sort_order) : idx,
      caja_station_id: String(s?.caja_station_id || '').trim() || DEFAULT_PRIMARY_CAJA_ID,
    }))
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((s, idx) => ({ ...s, sort_order: idx }));
}

function inferSalonesFromTables(tables) {
  const zoneOrder = [];
  const seen = new Set();
  const sorted = [...(tables || [])].sort((a, b) => Number(a?.number || 0) - Number(b?.number || 0));
  for (const t of sorted) {
    const z = String(t?.zone || 'principal').trim() || 'principal';
    if (!seen.has(z)) {
      seen.add(z);
      zoneOrder.push(z);
    }
  }
  if (!zoneOrder.length) return [...DEFAULT_SALONES];
  return zoneOrder.map((id, idx) => ({
    id,
    name: id === 'principal' ? 'Salón Principal' : id,
    description: '',
    sort_order: idx,
  }));
}

function readSalonesConfig() {
  const settings = parseSettingsBlob();
  const salones = Array.isArray(settings.salones) ? settings.salones : [];
  if (!salones.length) return [];
  return normalizeSalonesList(salones);
}

function saveSalonesConfig(salones) {
  const settings = parseSettingsBlob();
  const normalized = normalizeSalonesList(salones);
  const next = { ...settings, salones: normalized };
  runSql(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    ['settings', JSON.stringify(next)]
  );
  return normalized;
}

function ensureSalonesConfig(tables) {
  let salones = readSalonesConfig();
  if (salones.length) return salones;
  salones = inferSalonesFromTables(tables);
  return saveSalonesConfig(salones);
}

module.exports = {
  DEFAULT_SALONES,
  normalizeSalonesList,
  inferSalonesFromTables,
  readSalonesConfig,
  saveSalonesConfig,
  ensureSalonesConfig,
};
