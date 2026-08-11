/**
 * Registra y consulta demoras operativas (cocina/bar y delivery)
 * para Indicadores → Operativo.
 */

const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, runSql } = require('../database');
const { KITCHEN_ARRIVAL_ALERT_MIN, KITCHEN_PREP_ALERT_MIN } = require('../constants/kitchenTiming');

const DELIVERY_SLOW_MIN = 35;

let tableReady = false;

function ensureDelayTable() {
  if (tableReady) return;
  runSql(`
    CREATE TABLE IF NOT EXISTS operational_delay_events (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      station TEXT NOT NULL,
      order_number TEXT DEFAULT '',
      table_number TEXT DEFAULT '',
      order_type TEXT DEFAULT '',
      status_at_detect TEXT DEFAULT '',
      threshold_minutes REAL NOT NULL DEFAULT 0,
      elapsed_minutes REAL NOT NULL DEFAULT 0,
      detected_at TEXT NOT NULL,
      resolved_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  runSql(
    'CREATE INDEX IF NOT EXISTS idx_op_delay_detected ON operational_delay_events(detected_at)'
  );
  runSql(
    'CREATE INDEX IF NOT EXISTS idx_op_delay_order_station ON operational_delay_events(order_id, station)'
  );
  tableReady = true;
}

function minutesBetween(fromTs) {
  if (!fromTs) return 0;
  const row = queryOne(
    `SELECT (julianday('now') - julianday(?)) * 24 * 60 AS m`,
    [fromTs]
  );
  return Number(row?.m || 0);
}

function openEvent(orderId, station) {
  return queryOne(
    `SELECT * FROM operational_delay_events
     WHERE order_id = ? AND station = ? AND resolved_at IS NULL
     LIMIT 1`,
    [orderId, station]
  );
}

function upsertOpenDelay({
  orderId,
  station,
  orderNumber,
  tableNumber,
  orderType,
  status,
  thresholdMinutes,
  elapsedMinutes,
}) {
  const existing = openEvent(orderId, station);
  if (existing) {
    runSql(
      `UPDATE operational_delay_events
       SET elapsed_minutes = ?, status_at_detect = ?, threshold_minutes = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [elapsedMinutes, status, thresholdMinutes, existing.id]
    );
    return existing.id;
  }
  const id = uuidv4();
  runSql(
    `INSERT INTO operational_delay_events (
      id, order_id, station, order_number, table_number, order_type,
      status_at_detect, threshold_minutes, elapsed_minutes, detected_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))`,
    [
      id,
      orderId,
      station,
      String(orderNumber || ''),
      String(tableNumber || ''),
      String(orderType || ''),
      String(status || ''),
      thresholdMinutes,
      elapsedMinutes,
    ]
  );
  return id;
}

function resolveOpenDelay(orderId, station) {
  runSql(
    `UPDATE operational_delay_events
     SET resolved_at = datetime('now'), updated_at = datetime('now')
     WHERE order_id = ? AND station = ? AND resolved_at IS NULL`,
    [orderId, station]
  );
}

function stationStillOpen(order, station) {
  if (!['pending', 'preparing'].includes(String(order.status || ''))) return false;
  if (station === 'cocina') {
    return !String(order.station_cocina_ready_at || '').trim();
  }
  if (station === 'bar') {
    return !String(order.station_bar_ready_at || '').trim();
  }
  return false;
}

function elapsedForStation(order, station) {
  const status = String(order.status || '');
  if (status === 'pending') {
    return {
      elapsed: minutesBetween(order.created_at),
      threshold: KITCHEN_ARRIVAL_ALERT_MIN,
      startField: 'created_at',
    };
  }
  const prepCol =
    station === 'bar'
      ? order.station_bar_preparing_at || order.preparing_at || order.updated_at || order.created_at
      : order.station_cocina_preparing_at || order.preparing_at || order.updated_at || order.created_at;
  return {
    elapsed: minutesBetween(prepCol),
    threshold: KITCHEN_PREP_ALERT_MIN,
    startField: 'preparing',
  };
}

/** Detecta demoras actuales y persiste / resuelve eventos. */
function syncOperationalDelays() {
  ensureDelayTable();
  const orders = queryAll(
    `SELECT o.*,
       EXISTS (
         SELECT 1 FROM order_items oi
         JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = o.id AND IFNULL(p.production_area, 'cocina') = 'cocina'
       ) AS has_cocina,
       EXISTS (
         SELECT 1 FROM order_items oi
         JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = o.id AND IFNULL(p.production_area, 'cocina') = 'bar'
       ) AS has_bar
     FROM orders o
     WHERE o.status IN ('pending', 'preparing', 'ready', 'delivered', 'cancelled')
       AND datetime(o.created_at) >= datetime('now', '-3 days')`
  );

  const openKitchenKeys = new Set();

  for (const o of orders || []) {
    for (const station of ['cocina', 'bar']) {
      const has = station === 'cocina' ? Number(o.has_cocina) === 1 : Number(o.has_bar) === 1;
      if (!has) {
        resolveOpenDelay(o.id, station);
        continue;
      }
      if (!stationStillOpen(o, station)) {
        resolveOpenDelay(o.id, station);
        continue;
      }
      const { elapsed, threshold } = elapsedForStation(o, station);
      if (elapsed > threshold) {
        openKitchenKeys.add(`${o.id}:${station}`);
        upsertOpenDelay({
          orderId: o.id,
          station,
          orderNumber: o.order_number || o.sale_document_number || '',
          tableNumber: o.table_number || '',
          orderType: o.type || 'dine_in',
          status: o.status,
          thresholdMinutes: threshold,
          elapsedMinutes: Math.round(elapsed * 10) / 10,
        });
      } else {
        resolveOpenDelay(o.id, station);
      }
    }
  }

  // Delivery
  const deliveries = queryAll(
    `SELECT da.*, o.order_number, o.table_number, o.type AS order_type, o.status AS order_status
     FROM delivery_assignments da
     LEFT JOIN orders o ON o.id = da.order_id
     WHERE da.status != 'delivered'
       AND datetime(da.assigned_at) >= datetime('now', '-3 days')`
  );
  const openDeliveryIds = new Set();
  for (const d of deliveries || []) {
    const elapsed = minutesBetween(d.assigned_at);
    if (elapsed > DELIVERY_SLOW_MIN) {
      openDeliveryIds.add(d.order_id);
      upsertOpenDelay({
        orderId: d.order_id,
        station: 'delivery',
        orderNumber: d.order_number || '',
        tableNumber: d.table_number || '',
        orderType: d.order_type || 'delivery',
        status: d.status || d.order_status || '',
        thresholdMinutes: DELIVERY_SLOW_MIN,
        elapsedMinutes: Math.round(elapsed * 10) / 10,
      });
    } else {
      resolveOpenDelay(d.order_id, 'delivery');
    }
  }

  // Cerrar delivery abiertos que ya no están
  const openDel = queryAll(
    `SELECT order_id FROM operational_delay_events
     WHERE station = 'delivery' AND resolved_at IS NULL`
  );
  for (const row of openDel || []) {
    if (!openDeliveryIds.has(row.order_id)) resolveOpenDelay(row.order_id, 'delivery');
  }

  return { openKitchenBar: openKitchenKeys.size, openDelivery: openDeliveryIds.size };
}

function listDelayEvents({ stations, from, to, limit = 80 }) {
  ensureDelayTable();
  const st = (stations || []).map((s) => String(s));
  if (!st.length) return [];
  const ph = st.map(() => '?').join(',');
  const params = [...st];
  let sql = `
    SELECT e.*, o.status AS order_status_now
    FROM operational_delay_events e
    LEFT JOIN orders o ON o.id = e.order_id
    WHERE e.station IN (${ph})
  `;
  if (from) {
    sql += ` AND date(datetime(e.detected_at, 'localtime')) >= date(?)`;
    params.push(from);
  }
  if (to) {
    sql += ` AND date(datetime(e.detected_at, 'localtime')) <= date(?)`;
    params.push(to);
  }
  sql += ` ORDER BY datetime(e.detected_at) DESC LIMIT ?`;
  params.push(Math.min(200, Math.max(1, Number(limit) || 80)));
  return queryAll(sql, params).map((r) => ({
    id: r.id,
    order_id: r.order_id,
    station: r.station,
    order_number: r.order_number,
    table_number: r.table_number,
    order_type: r.order_type,
    status_at_detect: r.status_at_detect,
    order_status_now: r.order_status_now,
    threshold_minutes: Number(r.threshold_minutes || 0),
    elapsed_minutes: Number(r.elapsed_minutes || 0),
    detected_at: r.detected_at,
    resolved_at: r.resolved_at,
    active: !r.resolved_at,
  }));
}

function countDelayEvents({ stations, from, to }) {
  ensureDelayTable();
  const st = (stations || []).map((s) => String(s));
  if (!st.length) return 0;
  const ph = st.map(() => '?').join(',');
  const params = [...st];
  let sql = `SELECT COUNT(*) AS c FROM operational_delay_events WHERE station IN (${ph})`;
  if (from) {
    sql += ` AND date(datetime(detected_at, 'localtime')) >= date(?)`;
    params.push(from);
  }
  if (to) {
    sql += ` AND date(datetime(detected_at, 'localtime')) <= date(?)`;
    params.push(to);
  }
  return Number(queryOne(sql, params)?.c || 0);
}

function countOpenDelays(stations) {
  ensureDelayTable();
  const st = (stations || []).map((s) => String(s));
  if (!st.length) return 0;
  const ph = st.map(() => '?').join(',');
  return Number(
    queryOne(
      `SELECT COUNT(*) AS c FROM operational_delay_events
       WHERE station IN (${ph}) AND resolved_at IS NULL`,
      st
    )?.c || 0
  );
}

module.exports = {
  ensureDelayTable,
  syncOperationalDelays,
  listDelayEvents,
  countDelayEvents,
  countOpenDelays,
  KITCHEN_ARRIVAL_ALERT_MIN,
  KITCHEN_PREP_ALERT_MIN,
  DELIVERY_SLOW_MIN,
};
