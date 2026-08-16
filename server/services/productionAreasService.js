const { v4: uuidv4 } = require('uuid');
const { queryOne, queryAll, runSql } = require('../database');
const { DEFAULT_PRIMARY_CAJA_ID } = require('../cajaSettings');

const DEFAULT_PRODUCTION_AREAS = [
  {
    id: 'cocina',
    name: 'Cocina',
    active: 1,
    encargado_user_ids: [],
    mozo_user_ids: [],
  },
  {
    id: 'bar',
    name: 'Bar',
    active: 1,
    encargado_user_ids: [],
    mozo_user_ids: [],
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

function saveSettingsBlob(next) {
  runSql(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    ['settings', JSON.stringify(next)]
  );
}

function normalizeUserIdList(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const x of raw) {
    const id = String(x || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function titleCaseAreaName(raw) {
  return String(raw ?? '').replace(/[^\s]+/g, (word) => {
    if (!word) return word;
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).trim();
}

function normalizeProductionAreaRow(raw, idx = 0) {
  const id = String(raw?.id || '').trim() || `area_${idx + 1}`;
  const titled = titleCaseAreaName(raw?.name);
  return {
    id,
    name: titled || id,
    active: Number(raw?.active) === 0 ? 0 : 1,
    encargado_user_ids: normalizeUserIdList(raw?.encargado_user_ids),
    mozo_user_ids: [],
  };
}

function normalizeProductionAreasList(list) {
  if (!Array.isArray(list) || !list.length) return DEFAULT_PRODUCTION_AREAS.map((a) => ({ ...a }));
  const seen = new Set();
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    const row = normalizeProductionAreaRow(list[i], i);
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out.length ? out : DEFAULT_PRODUCTION_AREAS.map((a) => ({ ...a }));
}

function readProductionAreas() {
  const settings = parseSettingsBlob();
  return normalizeProductionAreasList(settings.production_areas);
}

function saveProductionAreas(areas) {
  const settings = parseSettingsBlob();
  const normalized = normalizeProductionAreasList(areas);
  saveSettingsBlob({ ...settings, production_areas: normalized });
  return normalized;
}

function ensureProductionAreasSeeded() {
  const settings = parseSettingsBlob();
  if (Array.isArray(settings.production_areas) && settings.production_areas.length) {
    return normalizeProductionAreasList(settings.production_areas);
  }
  return saveProductionAreas(DEFAULT_PRODUCTION_AREAS);
}

function getProductionAreaById(areaId) {
  const id = String(areaId || '').trim();
  if (!id) return null;
  return readProductionAreas().find((a) => a.id === id) || null;
}

function listActiveProductionAreas() {
  return readProductionAreas().filter((a) => a.active === 1);
}

/** Ids de área válidos (cualquier área conocida en config). */
function listKnownProductionAreaIds() {
  return readProductionAreas().map((a) => a.id);
}

function isKnownProductionAreaId(areaId) {
  const id = String(areaId || '').trim();
  if (!id) return false;
  return listKnownProductionAreaIds().includes(id);
}

function resolveProductProductionAreaId(raw) {
  const id = String(raw ?? '').trim();
  const known = listKnownProductionAreaIds();
  const fallback = known[0] || 'cocina';
  if (!id) return fallback;
  if (known.includes(id)) return id;
  const lc = id.toLowerCase();
  if (known.includes(lc)) return lc;
  if ((lc === 'cocina' || lc === 'bar') && known.includes(lc)) return lc;
  return fallback;
}

function parseProductionAreaIdsJson(raw) {
  if (Array.isArray(raw)) return normalizeUserIdList(raw);
  const s = String(raw || '').trim();
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    return normalizeUserIdList(parsed);
  } catch {
    return s.split(/[,|]/).map((x) => x.trim()).filter(Boolean);
  }
}

function stringifyProductionAreaIds(ids) {
  return JSON.stringify(normalizeUserIdList(ids));
}

function assertEncargadosAvailable(areaId, encargadoIds) {
  const aid = String(areaId || '').trim();
  const ids = normalizeUserIdList(encargadoIds);
  for (const uid of ids) {
    const u = queryOne(
      `SELECT id, full_name, role, production_area_id FROM users WHERE id = ?`,
      [uid]
    );
    if (!u) throw new Error('Encargado no encontrado');
    const current = String(u.production_area_id || '').trim();
    if (current && current !== aid) {
      const name = String(u.full_name || u.id).trim();
      throw new Error(
        `${name} ya está vinculado al área «${current}». Un encargado solo puede tener un área.`
      );
    }
    // También en settings de otras áreas
    for (const area of readProductionAreas()) {
      if (area.id === aid) continue;
      if ((area.encargado_user_ids || []).includes(uid)) {
        const name = String(u.full_name || u.id).trim();
        throw new Error(
          `${name} ya es encargado de «${area.name || area.id}». Un encargado solo puede tener un área.`
        );
      }
    }
  }
}

function stripEncargadosFromOtherAreas(areaId, encargadoIds) {
  const aid = String(areaId || '').trim();
  const keep = new Set(normalizeUserIdList(encargadoIds));
  if (!keep.size) return;
  const areas = readProductionAreas();
  let changed = false;
  const next = areas.map((a) => {
    if (a.id === aid) return a;
    const filtered = (a.encargado_user_ids || []).filter((id) => !keep.has(id));
    if (filtered.length !== (a.encargado_user_ids || []).length) {
      changed = true;
      return { ...a, encargado_user_ids: filtered };
    }
    return a;
  });
  if (changed) saveProductionAreas(next);
}

function createProductionArea({ name, encargado_user_ids } = {}) {
  const areas = readProductionAreas();
  const id = uuidv4();
  assertEncargadosAvailable(id, encargado_user_ids);
  const row = normalizeProductionAreaRow({
    id,
    name: name || 'Nueva área',
    active: 1,
    encargado_user_ids,
  });
  areas.push(row);
  saveProductionAreas(areas);
  stripEncargadosFromOtherAreas(id, encargado_user_ids);
  return row;
}

function updateProductionArea(areaId, patch = {}) {
  const id = String(areaId || '').trim();
  const areas = readProductionAreas();
  const idx = areas.findIndex((a) => a.id === id);
  if (idx < 0) throw new Error('Área de producción no encontrada');
  const prev = areas[idx];
  if (Object.prototype.hasOwnProperty.call(patch, 'encargado_user_ids')) {
    assertEncargadosAvailable(id, patch.encargado_user_ids);
  }
  areas[idx] = normalizeProductionAreaRow({
    ...prev,
    ...patch,
    id: prev.id,
  }, idx);
  saveProductionAreas(areas);
  if (Object.prototype.hasOwnProperty.call(patch, 'encargado_user_ids')) {
    stripEncargadosFromOtherAreas(id, patch.encargado_user_ids);
  }
  return areas[idx];
}

function deleteProductionArea(areaId, { reassignTo } = {}) {
  const id = String(areaId || '').trim();
  if (!id) throw new Error('Área no indicada');

  const current = readProductionAreas();
  if (!current.some((a) => a.id === id)) {
    throw new Error('Área de producción no encontrada');
  }
  if (current.length <= 1) {
    throw new Error('Debe quedar al menos un área de producción');
  }

  const remaining = current.filter((a) => a.id !== id);
  let targetId = String(reassignTo || '').trim();
  if (targetId && !remaining.some((a) => a.id === targetId)) {
    throw new Error('El área de reasignación no es válida');
  }
  if (!targetId) {
    targetId = remaining.find((a) => Number(a.active) === 1)?.id || remaining[0].id;
  }

  const productCount = queryOne(
    `SELECT COUNT(*) AS c FROM products WHERE trim(coalesce(production_area, '')) = ?`,
    [id]
  );
  if (Number(productCount?.c || 0) > 0) {
    runSql(
      `UPDATE products SET production_area = ?, updated_at = datetime('now')
       WHERE trim(coalesce(production_area, '')) = ?`,
      [targetId, id]
    );
  }

  // Liberar encargados vinculados a esta área
  runSql(
    `UPDATE users SET production_area_id = ''
     WHERE trim(coalesce(production_area_id, '')) = ?`,
    [id]
  );
  runSql(
    `UPDATE users SET production_area_ids = '[]'
     WHERE lower(trim(role)) = 'mozo'`
  );

  saveProductionAreas(remaining);
  try {
    runSql('DELETE FROM order_station_state WHERE area_id = ?', [id]);
  } catch (_) { /* tabla puede no existir en tests */ }

  try { syncAreaUserLinksFromUsers(); } catch (_) { /* ignore */ }
  return readProductionAreas();
}

function syncAreaUserLinksFromUsers() {
  const areas = readProductionAreas();
  const byArea = Object.fromEntries(
    areas.map((a) => [a.id, { encargado: new Set() }])
  );
  const users = queryAll(
    `SELECT id, role, production_area_id FROM users WHERE is_active = 1`
  );
  for (const u of users || []) {
    const role = String(u.role || '').toLowerCase();
    if (role === 'produccion' || role === 'cocina' || role === 'bar') {
      let aid = String(u.production_area_id || '').trim();
      if (!aid && role === 'bar' && byArea.bar) aid = 'bar';
      if (!aid && role === 'cocina' && byArea.cocina) aid = 'cocina';
      if (aid && byArea[aid]) byArea[aid].encargado.add(u.id);
    }
  }
  const next = areas.map((a) => ({
    ...a,
    encargado_user_ids: [...(byArea[a.id]?.encargado || [])],
    mozo_user_ids: [],
  }));
  return saveProductionAreas(next);
}

/**
 * @param {string} orderId
 * @param {string} areaId
 * @param {{ preparing_at?: string|null, ready_at?: string|null }} [fields]
 * @param {{ queryOne: Function, run?: Function, runSql?: Function }} [db] — opcional (tx)
 */
function upsertOrderStationState(orderId, areaId, fields = {}, db = null) {
  const oid = String(orderId || '').trim();
  const aid = String(areaId || '').trim();
  if (!oid || !aid) return;
  const qOne = db?.queryOne ? db.queryOne.bind(db) : queryOne;
  const run = db?.run
    ? (sql, params) => db.run(sql, params)
    : (sql, params) => runSql(sql, params);
  const existing = qOne(
    'SELECT order_id FROM order_station_state WHERE order_id = ? AND area_id = ?',
    [oid, aid]
  );
  if (!existing) {
    run(
      `INSERT INTO order_station_state (order_id, area_id, preparing_at, ready_at)
       VALUES (?, ?, ?, ?)`,
      [oid, aid, fields.preparing_at || null, fields.ready_at || null]
    );
    return;
  }
  const sets = [];
  const params = [];
  if (Object.prototype.hasOwnProperty.call(fields, 'preparing_at')) {
    sets.push('preparing_at = ?');
    params.push(fields.preparing_at || null);
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'ready_at')) {
    sets.push('ready_at = ?');
    params.push(fields.ready_at || null);
  }
  if (!sets.length) return;
  params.push(oid, aid);
  run(
    `UPDATE order_station_state SET ${sets.join(', ')} WHERE order_id = ? AND area_id = ?`,
    params
  );
}

function getOrderStationStates(orderId) {
  return queryAll(
    'SELECT area_id, preparing_at, ready_at FROM order_station_state WHERE order_id = ?',
    [String(orderId || '').trim()]
  );
}

function ensureSalonesHaveCajaId() {
  const settings = parseSettingsBlob();
  const salones = Array.isArray(settings.salones) ? settings.salones : [];
  if (!salones.length) return;
  let changed = false;
  const next = salones.map((s) => {
    const caja = String(s?.caja_station_id || '').trim();
    if (caja) return s;
    changed = true;
    return { ...s, caja_station_id: DEFAULT_PRIMARY_CAJA_ID };
  });
  if (changed) {
    saveSettingsBlob({ ...settings, salones: next });
  }
}

module.exports = {
  DEFAULT_PRODUCTION_AREAS,
  DEFAULT_PRIMARY_CAJA_ID,
  readProductionAreas,
  saveProductionAreas,
  ensureProductionAreasSeeded,
  getProductionAreaById,
  listActiveProductionAreas,
  listKnownProductionAreaIds,
  isKnownProductionAreaId,
  resolveProductProductionAreaId,
  parseProductionAreaIdsJson,
  stringifyProductionAreaIds,
  createProductionArea,
  updateProductionArea,
  deleteProductionArea,
  syncAreaUserLinksFromUsers,
  upsertOrderStationState,
  getOrderStationStates,
  ensureSalonesHaveCajaId,
  normalizeProductionAreasList,
};
