const { queryAll, queryOne } = require('../database');
const { INVENTORY_EXPENSE_PURCHASE_DATE_IE_SQL } = require('../utils/inventoryPurchaseDate');

const CATEGORY_META = [
  { id: 'supplies', name: 'Compras de insumos' },
  { id: 'operating', name: 'Gastos operativos' },
  { id: 'staff', name: 'Gastos de personal' },
  { id: 'other', name: 'Otros gastos' },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function validDateKey(value) {
  const key = String(value || '').trim();
  return DATE_RE.test(key) ? key : '';
}

function defaultRange() {
  const row = queryOne(
    "SELECT date('now', 'localtime', 'start of month') AS from_date, date('now', 'localtime') AS to_date",
  ) || {};
  return { from: row.from_date, to: row.to_date };
}

function shiftPreviousRange(from, to) {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const days = Math.max(1, Math.round((end - start) / 86400000) + 1);
  const previousTo = new Date(start.getTime() - 86400000);
  const previousFrom = new Date(previousTo.getTime() - (days - 1) * 86400000);
  return {
    from: previousFrom.toISOString().slice(0, 10),
    to: previousTo.toISOString().slice(0, 10),
  };
}

function operatingCategorySql(alias = 'cm') {
  const value = `LOWER(TRIM(IFNULL(${alias}.concept, '')))`;
  return `CASE
    WHEN ${value} LIKE '%luz%'
      OR ${value} LIKE '%electric%'
      OR ${value} LIKE '%agua%'
      OR ${value} LIKE '%internet%'
      OR ${value} LIKE '%alquiler%'
      OR ${value} LIKE '%manten%'
      OR ${value} LIKE '%servicio%'
      OR ${value} LIKE '%gas%'
      OR ${value} LIKE '%limpieza%'
      OR ${value} LIKE '%repar%'
      OR ${value} LIKE '%operativ%'
    THEN 'operating'
    ELSE 'other'
  END`;
}

/**
 * Fuentes no duplicadas:
 * - inventory_expenses: compras/recepciones;
 * - cash_movements manuales: excluye el egreso automático de una recepción;
 * - investment_movements payroll: personal.
 * - finance_loss_events: pérdidas y ajustes registrados explícitamente.
 * No mezcla kardex ni COGS porque ya representan stock/consumo, no otro gasto.
 */
function queryExpenseRows(from, to) {
  const purchases = queryAll(
    `SELECT
       'purchase:' || ie.id AS id,
       'purchase' AS source,
       ie.id AS source_id,
       COALESCE(NULLIF(TRIM(ie.requirement_id), ''), ie.id) AS group_id,
       ${INVENTORY_EXPENSE_PURCHASE_DATE_IE_SQL} AS date_key,
       COALESCE(ie.created_at, ie.purchase_date) AS occurred_at,
       'supplies' AS category,
       COALESCE(p.name, ins.nombre, 'Producto') AS concept,
       COALESCE(ie.quantity, 0) AS quantity,
       COALESCE(ie.unit_cost, 0) AS unit_cost,
       COALESCE(ie.total_cost, 0) AS total,
       COALESCE(ie.notes, '') AS notes,
       COALESCE(ie.created_by, '') AS user_id,
       COALESCE(u.full_name, u.username, 'Sistema') AS user_name,
       '' AS provider,
       COALESCE(wl.name, '') AS warehouse_name,
       '' AS payment_status,
       ie.requirement_id AS requirement_id,
       1 AS can_edit
     FROM inventory_expenses ie
     LEFT JOIN products p ON p.id = ie.product_id
     LEFT JOIN insumos ins ON ins.id = ie.product_id
     LEFT JOIN warehouse_locations wl ON wl.id = ie.warehouse_id
     LEFT JOIN users u ON u.id = ie.created_by
     WHERE ${INVENTORY_EXPENSE_PURCHASE_DATE_IE_SQL} BETWEEN date(?) AND date(?)`,
    [from, to],
  );

  const cash = queryAll(
    `SELECT
       'cash:' || cm.id AS id,
       'cash' AS source,
       cm.id AS source_id,
       cm.id AS group_id,
       date(datetime(cm.created_at, 'localtime')) AS date_key,
       cm.created_at AS occurred_at,
       ${operatingCategorySql('cm')} AS category,
       COALESCE(NULLIF(TRIM(cm.concept), ''), 'Egreso de caja') AS concept,
       1 AS quantity,
       COALESCE(cm.amount, 0) AS unit_cost,
       COALESCE(cm.amount, 0) AS total,
       '' AS notes,
       COALESCE(cm.user_id, '') AS user_id,
       COALESCE(u.full_name, u.username, 'Sistema') AS user_name,
       '' AS provider,
       '' AS warehouse_name,
       'paid' AS payment_status,
       NULL AS requirement_id,
       0 AS can_edit
     FROM cash_movements cm
     LEFT JOIN users u ON u.id = cm.user_id
     WHERE cm.type = 'expense'
       AND date(datetime(cm.created_at, 'localtime')) BETWEEN date(?) AND date(?)
       AND LOWER(TRIM(IFNULL(cm.concept, ''))) NOT LIKE 'compra por recepción (%'`,
    [from, to],
  );

  const payroll = queryAll(
    `SELECT
       'payroll:' || im.id AS id,
       'payroll' AS source,
       im.id AS source_id,
       im.id AS group_id,
       date(datetime(im.created_at, 'localtime')) AS date_key,
       im.created_at AS occurred_at,
       'staff' AS category,
       COALESCE(NULLIF(TRIM(im.concept), ''), 'Pago de personal') AS concept,
       1 AS quantity,
       COALESCE(im.amount, 0) AS unit_cost,
       COALESCE(im.amount, 0) AS total,
       '' AS notes,
       COALESCE(im.user_id, '') AS user_id,
       COALESCE(u.full_name, u.username, 'Personal') AS user_name,
       '' AS provider,
       '' AS warehouse_name,
       'paid' AS payment_status,
       NULL AS requirement_id,
       0 AS can_edit
     FROM investment_movements im
     LEFT JOIN users u ON u.id = im.user_id
     WHERE LOWER(TRIM(IFNULL(im.source, ''))) = 'payroll'
       AND date(datetime(im.created_at, 'localtime')) BETWEEN date(?) AND date(?)`,
    [from, to],
  );

  const losses = queryAll(
    `SELECT
       'loss:' || fle.id AS id,
       'loss' AS source,
       fle.id AS source_id,
       fle.id AS group_id,
       date(datetime(fle.occurred_at, 'localtime')) AS date_key,
       fle.occurred_at AS occurred_at,
       'other' AS category,
       COALESCE(NULLIF(TRIM(fle.concept), ''), 'Pérdida o ajuste financiero') AS concept,
       1 AS quantity,
       COALESCE(fle.amount, 0) AS unit_cost,
       COALESCE(fle.amount, 0) AS total,
       CASE WHEN TRIM(IFNULL(fle.category, '')) != '' THEN 'Tipo: ' || fle.category ELSE '' END AS notes,
       '' AS user_id,
       'Sistema' AS user_name,
       '' AS provider,
       '' AS warehouse_name,
       '' AS payment_status,
       NULL AS requirement_id,
       0 AS can_edit
     FROM finance_loss_events fle
     WHERE date(datetime(fle.occurred_at, 'localtime')) BETWEEN date(?) AND date(?)`,
    [from, to],
  );

  return [...purchases, ...cash, ...payroll, ...losses]
    .map((row) => {
      const category = CATEGORY_META.find((item) => item.id === row.category);
      return {
        ...row,
        category_name: category?.name || 'Otros gastos',
        quantity: Number(row.quantity || 0),
        unit_cost: round2(row.unit_cost),
        total: round2(row.total),
        can_edit: Number(row.can_edit) === 1,
      };
    })
    .filter((row) => row.total >= 0)
    .sort((a, b) => String(b.occurred_at || b.date_key).localeCompare(String(a.occurred_at || a.date_key)));
}

function filterRows(rows, filters = {}) {
  const category = String(filters.category || '').trim();
  const userId = String(filters.user_id || '').trim();
  const search = String(filters.search || '').trim().toLocaleLowerCase('es');
  return (rows || []).filter((row) => {
    if (category && row.category !== category) return false;
    if (userId && String(row.user_id || '') !== userId) return false;
    if (search) {
      const haystack = [
        row.concept,
        row.notes,
        row.provider,
        row.warehouse_name,
        row.user_name,
        row.requirement_id,
      ].join(' ').toLocaleLowerCase('es');
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

function summarize(rows) {
  const total = round2((rows || []).reduce((sum, row) => sum + Number(row.total || 0), 0));
  const byCategory = CATEGORY_META.map((category) => {
    const categoryRows = (rows || []).filter((row) => row.category === category.id);
    const amount = round2(categoryRows.reduce((sum, row) => sum + Number(row.total || 0), 0));
    const operations = new Set(categoryRows.map((row) => `${row.date_key || ''}:${row.category}`)).size;
    return {
      ...category,
      amount,
      operations,
      percentage: total > 0 ? round2((amount / total) * 100) : 0,
    };
  });
  return {
    total,
    operations: new Set((rows || []).map((row) => `${row.date_key || ''}:${row.category}`)).size,
    by_category: byCategory,
  };
}

function uniqueList(values) {
  return [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function groupConceptLabel(items) {
  const names = (items || []).map((item) => String(item.concept || '').trim()).filter(Boolean);
  if (!names.length) return '—';
  if (names.length === 1) return names[0];
  const preview = names.slice(0, 2).join(', ');
  const extra = names.length > 2 ? ` y ${names.length - 2} más` : '';
  return `${names.length} productos: ${preview}${extra}`;
}

/** Un grupo por fecha + categoría (todas las compras del día juntas). */
function groupExpenseRows(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const key = `${row.date_key || ''}::${row.category || 'other'}`;
    if (!map.has(key)) {
      map.set(key, {
        id: `group:${key}`,
        date_key: row.date_key,
        occurred_at: row.occurred_at,
        category: row.category,
        category_name: row.category_name,
        item_count: 0,
        quantity: 0,
        total: 0,
        user_names: [],
        warehouse_names: [],
        notes: [],
        payment_statuses: [],
        requirement_ids: [],
        can_edit: false,
        items: [],
      });
    }
    const group = map.get(key);
    group.items.push(row);
    group.item_count += 1;
    group.quantity = round2(group.quantity + Number(row.quantity || 0));
    group.total = round2(group.total + Number(row.total || 0));
    if (String(row.occurred_at || '') > String(group.occurred_at || '')) {
      group.occurred_at = row.occurred_at;
    }
    if (row.can_edit) group.can_edit = true;
    if (row.user_name) group.user_names.push(row.user_name);
    if (row.warehouse_name) group.warehouse_names.push(row.warehouse_name);
    if (row.notes) group.notes.push(row.notes);
    if (row.payment_status) group.payment_statuses.push(row.payment_status);
    if (row.requirement_id) group.requirement_ids.push(row.requirement_id);
  }

  return [...map.values()]
    .map((group) => {
      const userNames = uniqueList(group.user_names);
      const warehouseNames = uniqueList(group.warehouse_names);
      const notes = uniqueList(group.notes);
      const payments = uniqueList(group.payment_statuses);
      return {
        ...group,
        user_names: userNames,
        warehouse_names: warehouseNames,
        requirement_ids: uniqueList(group.requirement_ids),
        user_name: userNames.join(', ') || '—',
        warehouse_name: warehouseNames.join(', ') || '—',
        notes: notes.join(' · '),
        payment_status: payments.length === 1 && payments[0] === 'paid' ? 'paid' : (payments.includes('paid') ? 'mixed' : ''),
        concept: groupConceptLabel(group.items),
      };
    })
    .sort((a, b) => (
      String(b.date_key || '').localeCompare(String(a.date_key || ''))
      || String(b.occurred_at || '').localeCompare(String(a.occurred_at || ''))
    ));
}

function buildExpenseDashboard(params = {}) {
  const fallback = defaultRange();
  const from = validDateKey(params.from) || fallback.from;
  const to = validDateKey(params.to) || fallback.to;
  if (from > to) {
    const err = new Error('La fecha inicial no puede ser posterior a la fecha final');
    err.statusCode = 400;
    throw err;
  }

  const page = Math.max(1, Number.parseInt(params.page, 10) || 1);
  const rawRows = queryExpenseRows(from, to);
  const users = [...new Map(rawRows
    .filter((row) => String(row.user_id || '').trim())
    .map((row) => [String(row.user_id), { id: String(row.user_id), name: row.user_name || 'Usuario' }])).values()]
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const filtered = filterRows(rawRows, params);
  const groups = groupExpenseRows(filtered);
  const exporting = String(params.export || '') === '1';
  const pageSize = exporting
    ? Math.max(1, groups.length || 1)
    : Math.min(100, Math.max(10, Number.parseInt(params.page_size, 10) || 25));
  const summary = summarize(filtered);

  const previousRange = shiftPreviousRange(from, to);
  const previousRows = filterRows(queryExpenseRows(previousRange.from, previousRange.to), params);
  const previousTotal = summarize(previousRows).total;
  const variationPct = previousTotal > 0
    ? round2(((summary.total - previousTotal) / previousTotal) * 100)
    : null;

  const offset = (page - 1) * pageSize;
  const pageGroups = groups.slice(offset, offset + pageSize);
  return {
    period: { from, to },
    previous_period: { ...previousRange, total: previousTotal },
    summary: {
      ...summary,
      previous_total: previousTotal,
      variation_pct: variationPct,
      comparison_available: previousTotal > 0,
    },
    filters: {
      category: String(params.category || ''),
      user_id: String(params.user_id || ''),
      search: String(params.search || ''),
    },
    categories: CATEGORY_META,
    users,
    groups: pageGroups,
    rows: exporting ? filtered : pageGroups.flatMap((group) => group.items),
    pagination: {
      page,
      page_size: pageSize,
      total_rows: groups.length,
      total_items: filtered.length,
      total_pages: Math.max(1, Math.ceil((groups.length || 1) / pageSize) || 1),
    },
  };
}

module.exports = {
  CATEGORY_META,
  buildExpenseDashboard,
  filterRows,
  groupExpenseRows,
  queryExpenseRows,
  shiftPreviousRange,
  summarize,
};
