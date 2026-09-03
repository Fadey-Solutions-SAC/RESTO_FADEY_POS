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

function knownCajaIds() {
  const { DEFAULT_PRIMARY_CAJA_ID } = require('../cajaSettings');
  const settings = parseSettingsBlob();
  const ids = (Array.isArray(settings.cajas) ? settings.cajas : [])
    .map((c) => String(c?.id || '').trim())
    .filter(Boolean);
  return { ids: new Set(ids), fallback: ids[0] || DEFAULT_PRIMARY_CAJA_ID };
}

/**
 * Mesas cuyo zone no pertenece a un salón de su misma caja vuelven al salón de esa caja.
 * Así no “desaparecen” de Salones y Mesas si el catálogo se reseteó.
 */
function reconcileOrphanTableZones(tables, salones) {
  const list = Array.isArray(tables) ? tables : [];
  const salonList = Array.isArray(salones) ? salones : [];
  if (!list.length || !salonList.length) return 0;
  const { DEFAULT_PRIMARY_CAJA_ID } = require('../cajaSettings');
  const { ids: cajaIds, fallback } = knownCajaIds();
  const byId = new Map(salonList.map((s) => [String(s.id || '').trim(), s]));
  const salonCaja = (s) => String(s?.caja_station_id || '').trim() || DEFAULT_PRIMARY_CAJA_ID;
  let moved = 0;
  for (const t of list) {
    if (!t?.id) continue;
    let caja = String(t.caja_station_id || '').trim();
    if (!caja) {
      caja = cajaIds.has(DEFAULT_PRIMARY_CAJA_ID) ? DEFAULT_PRIMARY_CAJA_ID : fallback;
      runSql('UPDATE tables SET caja_station_id = ? WHERE id = ?', [caja, t.id]);
    }
    const zone = String(t.zone || 'principal').trim() || 'principal';
    const zoneSalon = byId.get(zone);
    if (zoneSalon && salonCaja(zoneSalon) === caja) continue;
    const target = salonList.find((s) => salonCaja(s) === caja);
    if (!target || String(target.id) === zone) continue;
    runSql('UPDATE tables SET zone = ? WHERE id = ?', [String(target.id), t.id]);
    moved += 1;
  }
  return moved;
}

function ensureSalonesConfig(tables) {
  try {
    const { recoverCajasAndSalonesIfResetToDefaults } = require('./settingsCatalogRecover');
    recoverCajasAndSalonesIfResetToDefaults();
  } catch (_) {
    /* historial opcional */
  }
  let salones = readSalonesConfig();
  if (!salones.length) {
    salones = saveSalonesConfig(inferSalonesFromTables(tables));
  }
  reconcileOrphanTableZones(tables || [], salones);
  return readSalonesConfig();
}

module.exports = {
  DEFAULT_SALONES,
  normalizeSalonesList,
  inferSalonesFromTables,
  readSalonesConfig,
  saveSalonesConfig,
  ensureSalonesConfig,
  reconcileOrphanTableZones,
};
