export function isInsumosWarehouse(warehouse) {
  if (!warehouse) return false;
  if (Number(warehouse.linked_insumos) === 1) return true;
  return String(warehouse.name || '').toLowerCase().includes('insumos');
}

export function defaultProductWarehouseId(warehouses) {
  const list = (warehouses || []).filter((w) => !isInsumosWarehouse(w));
  const principal = list.find((w) => String(w.name || '').trim().toLowerCase() === 'almacen principal');
  return String((principal || list[0])?.id || '');
}

export function defaultInsumosWarehouseId(warehouses) {
  const list = (warehouses || []).filter((w) => isInsumosWarehouse(w));
  const linked = list.find((w) => Number(w.linked_insumos) === 1);
  return String((linked || list[0])?.id || '');
}

export function cajaProductWarehouseId(caja, warehouses) {
  const saved = String(caja?.product_warehouse_id || '').trim();
  const productWh = (warehouses || []).filter((w) => !isInsumosWarehouse(w));
  if (saved && productWh.some((w) => String(w.id) === saved)) return saved;
  return defaultProductWarehouseId(warehouses);
}

export function cajaInsumosWarehouseId(caja, warehouses) {
  const saved = String(caja?.insumos_warehouse_id || '').trim();
  const insumos = (warehouses || []).filter((w) => isInsumosWarehouse(w));
  if (saved && insumos.some((w) => String(w.id) === saved)) return saved;
  return defaultInsumosWarehouseId(warehouses);
}

export function warehouseNameById(warehouses, id) {
  const row = (warehouses || []).find((w) => String(w.id) === String(id || ''));
  return String(row?.name || '').trim();
}
