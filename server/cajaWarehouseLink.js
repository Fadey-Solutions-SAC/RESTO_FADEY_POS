/**
 * Vínculo caja → almacén de productos y almacén de insumos.
 * Si la caja no tiene uno guardado, usa Almacén Principal y el almacén de insumos.
 */

function isInsumosWarehouse(warehouse) {
  if (!warehouse) return false;
  if (Number(warehouse.linked_insumos) === 1) return true;
  return String(warehouse.name || '').toLowerCase().includes('insumos');
}

function readSettings(q) {
  const row = q.queryOne("SELECT value FROM app_settings WHERE key = 'settings'");
  if (!row?.value) return {};
  try {
    return JSON.parse(row.value);
  } catch {
    return {};
  }
}

function listWarehouses(q) {
  try {
    return q.queryAll(
      'SELECT id, name, COALESCE(linked_insumos, 0) AS linked_insumos FROM warehouse_locations WHERE is_active = 1',
    );
  } catch {
    try {
      return q.queryAll('SELECT id, name FROM warehouse_locations WHERE is_active = 1').map((w) => ({
        ...w,
        linked_insumos: String(w.name || '').toLowerCase().includes('insumos') ? 1 : 0,
      }));
    } catch {
      return [];
    }
  }
}

function defaultProductWarehouseId(warehouses) {
  const list = (warehouses || []).filter((w) => !isInsumosWarehouse(w));
  const principal = list.find((w) => String(w.name || '').trim().toLowerCase() === 'almacen principal');
  return String((principal || list[0])?.id || '');
}

function defaultInsumosWarehouseId(warehouses) {
  const list = (warehouses || []).filter((w) => isInsumosWarehouse(w));
  const linked = list.find((w) => Number(w.linked_insumos) === 1);
  return String((linked || list[0])?.id || '');
}

function productWarehouseIdForCaja(q, cajaId) {
  const id = String(cajaId || '').trim();
  if (!id) return '';
  const warehouses = listWarehouses(q);
  const settings = readSettings(q);
  const caja = (Array.isArray(settings.cajas) ? settings.cajas : [])
    .find((c) => String(c?.id || '').trim() === id);
  const saved = String(caja?.product_warehouse_id || '').trim();
  const productWh = warehouses.filter((w) => !isInsumosWarehouse(w));
  if (saved && productWh.some((w) => String(w.id) === saved)) return saved;
  return defaultProductWarehouseId(warehouses);
}

function cajaIdFromTable(q, tableId) {
  const tid = String(tableId || '').trim();
  if (!tid) return '';
  const table = q.queryOne('SELECT caja_station_id, zone FROM tables WHERE id = ?', [tid]);
  if (!table) return '';
  const direct = String(table.caja_station_id || '').trim();
  if (direct) return direct;
  const zone = String(table.zone || '').trim();
  const settings = readSettings(q);
  const salon = (Array.isArray(settings.salones) ? settings.salones : [])
    .find((s) => String(s?.id || '').trim() === zone);
  return String(salon?.caja_station_id || '').trim();
}

function cajaIdFromHotelOrder(q, orderId) {
  const oid = String(orderId || '').trim();
  if (!oid) return '';
  try {
    const room = q.queryOne(
      'SELECT caja_station_id FROM hotel_rooms WHERE current_order_id = ?',
      [oid],
    );
    return String(room?.caja_station_id || '').trim();
  } catch {
    return '';
  }
}

module.exports = {
  isInsumosWarehouse,
  listWarehouses,
  defaultProductWarehouseId,
  defaultInsumosWarehouseId,
  productWarehouseIdForCaja,
  cajaIdFromTable,
  cajaIdFromHotelOrder,
};
