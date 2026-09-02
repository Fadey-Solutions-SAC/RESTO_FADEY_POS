const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, runSql } = require('../database');
const { loadActiveTableOrders, deriveTableStatus } = require('./tableOrdersQueryService');

const DEFAULT_LABEL = 'Mesa Unida';

function parseMemberIds(union) {
  if (!union) return [];
  try {
    const raw = union.member_table_ids;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map((x) => String(x || '').trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

function ensureTableUnionsSchema() {
  runSql(`
    CREATE TABLE IF NOT EXISTS table_unions (
      id TEXT PRIMARY KEY,
      primary_table_id TEXT NOT NULL,
      member_table_ids TEXT NOT NULL,
      label TEXT DEFAULT 'Mesa Unida',
      created_at TEXT DEFAULT (datetime('now')),
      created_by TEXT DEFAULT ''
    )
  `);
  runSql('CREATE INDEX IF NOT EXISTS idx_table_unions_primary ON table_unions(primary_table_id)');
}

function loadAllUnions() {
  ensureTableUnionsSchema();
  return queryAll('SELECT * FROM table_unions ORDER BY created_at ASC');
}

function getUnionById(unionId) {
  ensureTableUnionsSchema();
  const row = queryOne('SELECT * FROM table_unions WHERE id = ?', [String(unionId || '').trim()]);
  if (!row) return null;
  return { ...row, member_table_ids: parseMemberIds(row) };
}

function getUnionContainingTable(tableId) {
  const id = String(tableId || '').trim();
  if (!id) return null;
  const unions = loadAllUnions();
  return unions.find((u) => parseMemberIds(u).includes(id)) || null;
}

function pickPrimaryTableId(tableIds, tablesById) {
  const sorted = [...tableIds].sort((a, b) => {
    const ta = tablesById.get(a);
    const tb = tablesById.get(b);
    const na = Number(ta?.number);
    const nb = Number(tb?.number);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    return String(ta?.name || a).localeCompare(String(tb?.name || b));
  });
  return sorted[0];
}

function createUnion(tableIdsRaw, actorUserId = '') {
  ensureTableUnionsSchema();
  const tableIds = [...new Set((Array.isArray(tableIdsRaw) ? tableIdsRaw : []).map((x) => String(x || '').trim()).filter(Boolean))];
  if (tableIds.length < 2) {
    throw new Error('Seleccione al menos 2 mesas para unir');
  }

  const tables = tableIds.map((id) => queryOne('SELECT * FROM tables WHERE id = ?', [id]));
  if (tables.some((t) => !t)) {
    throw new Error('Una o más mesas no existen');
  }

  for (const tid of tableIds) {
    if (getUnionContainingTable(tid)) {
      throw new Error('Una de las mesas ya está unida a otra cuenta');
    }
  }

  const tablesById = new Map(tables.map((t) => [t.id, t]));
  const primaryTableId = pickPrimaryTableId(tableIds, tablesById);
  const id = uuidv4();
  runSql(
    'INSERT INTO table_unions (id, primary_table_id, member_table_ids, label, created_by) VALUES (?, ?, ?, ?, ?)',
    [id, primaryTableId, JSON.stringify(tableIds), DEFAULT_LABEL, String(actorUserId || '').trim()]
  );
  return getUnionById(id);
}

function dissolveUnion(unionId) {
  ensureTableUnionsSchema();
  const id = String(unionId || '').trim();
  if (!id) return false;
  runSql('DELETE FROM table_unions WHERE id = ?', [id]);
  return true;
}

function unionHasActiveOrders(union) {
  const memberIds = parseMemberIds(union);
  for (const tid of memberIds) {
    const table = queryOne('SELECT * FROM tables WHERE id = ?', [tid]);
    if (!table) continue;
    const orders = loadActiveTableOrders(table);
    if (orders.length > 0) return true;
  }
  return false;
}

function dissolveUnionIfAllMembersFree(unionId) {
  const union = getUnionById(unionId);
  if (!union) return false;
  if (unionHasActiveOrders(union)) return false;
  return dissolveUnion(unionId);
}

function dissolveUnionsForTableIds(tableIdsRaw) {
  const tableIds = [...new Set((Array.isArray(tableIdsRaw) ? tableIdsRaw : []).map((x) => String(x || '').trim()).filter(Boolean))];
  if (!tableIds.length) return [];
  const dissolved = [];
  const seen = new Set();
  for (const tid of tableIds) {
    const union = getUnionContainingTable(tid);
    if (!union || seen.has(union.id)) continue;
    seen.add(union.id);
    if (dissolveUnionIfAllMembersFree(union.id)) dissolved.push(union.id);
  }
  return dissolved;
}

function enrichTableWithUnion(table, allTables, union) {
  if (!table || !union) return table;
  const memberIds = parseMemberIds(union);
  const tableById = new Map((allTables || []).map((t) => [t.id, t]));
  const memberTables = memberIds.map((id) => tableById.get(id) || queryOne('SELECT * FROM tables WHERE id = ?', [id])).filter(Boolean);
  const allOrders = memberTables.flatMap((t) => t.orders || []);
  const label = String(union.label || '').trim() || DEFAULT_LABEL;
  return {
    ...table,
    name: label,
    union_id: union.id,
    union_member_ids: memberIds,
    union_member_labels: memberTables.map((t) => String(t.name || `Mesa ${t.number}`).trim()),
    orders: allOrders,
    order_total: allOrders.reduce((sum, o) => sum + Number(o.total || 0), 0),
    status: deriveTableStatus(table, allOrders),
  };
}

function applyTableUnionsToList(tables) {
  const unions = loadAllUnions();
  if (!unions.length) return tables;

  const unionByMember = new Map();
  unions.forEach((u) => {
    parseMemberIds(u).forEach((id) => unionByMember.set(id, u));
  });

  const tableById = new Map((tables || []).map((t) => [t.id, t]));
  const result = [];
  const handledUnions = new Set();

  for (const table of tables || []) {
    const union = unionByMember.get(table.id);
    if (!union) {
      result.push(table);
      continue;
    }
    if (handledUnions.has(union.id)) continue;
    if (String(table.id) !== String(union.primary_table_id)) continue;

    handledUnions.add(union.id);
    const primary = tableById.get(union.primary_table_id) || table;
    result.push(enrichTableWithUnion(primary, tables, union));
  }

  return result;
}

function resolveTableForDetail(tableId) {
  const table = queryOne('SELECT * FROM tables WHERE id = ?', [String(tableId || '').trim()]);
  if (!table) return null;
  const union = getUnionContainingTable(table.id);
  if (!union) return table;
  if (String(table.id) !== String(union.primary_table_id)) {
    const primary = queryOne('SELECT * FROM tables WHERE id = ?', [union.primary_table_id]);
    return primary || table;
  }
  return table;
}

module.exports = {
  DEFAULT_LABEL,
  ensureTableUnionsSchema,
  loadAllUnions,
  getUnionById,
  getUnionContainingTable,
  createUnion,
  dissolveUnion,
  dissolveUnionIfAllMembersFree,
  dissolveUnionsForTableIds,
  applyTableUnionsToList,
  enrichTableWithUnion,
  resolveTableForDetail,
  parseMemberIds,
};
