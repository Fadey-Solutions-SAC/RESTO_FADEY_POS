/**
 * Auto-impresión cocina/bar en el servidor (Node en PC caja) cuando autoPrint está activo.
 */
const { loadConfig } = require('../printing/printerConfig');
const { print } = require('../printing/printerService');
const { buildPedidoMesaTicketPlainTextServer } = require('../printing/kitchenTicketPlain');
const { filterItemsForKitchenStation, collectOrderProductionAreaIds } = require('../utils/productionArea');
const { getOrderItemsWithProductionArea } = require('./orderItemsProductionService');

function isModuleAutoPrintEnabled(cfg, moduleKey) {
  if (moduleKey === 'caja') {
    const v = cfg?.caja?.autoPrint;
    return v !== false && v !== 0 && v !== '0' && v !== 'false';
  }
  return Boolean(cfg?.[moduleKey]?.autoPrint);
}

function normalizePaperWidthMm(raw) {
  const n = Number(raw ?? 80);
  if (n === 50 || n === 58 || n === 75) return n;
  return 80;
}

/**
 * @param {object} order — fila orders + opcional items
 * @param {{ newItemIds?: string[]|null, fromLinesUpdate?: boolean }} opts
 */
async function autoPrintKitchenBarOrder(order, { newItemIds = null, fromLinesUpdate = false } = {}) {
  if (!order?.id) return { printed: false, modules: [] };

  if (fromLinesUpdate) {
    const scoped = Array.isArray(newItemIds) ? newItemIds : [];
    if (!scoped.length) return { printed: false, modules: [] };
  }

  const cfg = loadConfig();
  const allItems = Array.isArray(order.items) && order.items.length
    ? order.items
    : getOrderItemsWithProductionArea(order.id);
  if (!allItems.length) return { printed: false, modules: [] };

  const scopedItems =
    Array.isArray(newItemIds) && newItemIds.length
      ? allItems.filter((it) => newItemIds.includes(it.id))
      : allItems;
  if (!scopedItems.length) return { printed: false, modules: [] };

  const areaIds = collectOrderProductionAreaIds(scopedItems);
  const modules = [];
  const jobs = [];

  for (const areaId of areaIds) {
    const areaItems = filterItemsForKitchenStation(scopedItems, areaId);
    if (!areaItems.length) continue;
    if (!isModuleAutoPrintEnabled(cfg, areaId)) continue;
    const paper = normalizePaperWidthMm(cfg?.[areaId]?.anchoPapel ?? cfg?.[areaId]?.paperWidth);
    const text = buildPedidoMesaTicketPlainTextServer(order, areaItems, paper);
    jobs.push(
      print(areaId, { text, preformatted: true, paperWidth: paper, anchoPapel: paper })
        .then(() => {
          modules.push(areaId);
        })
        .catch((err) => {
          console.warn(`[printing] auto ${areaId}:`, err?.message || err);
        }),
    );
  }

  if (!jobs.length) return { printed: false, modules: [] };
  await Promise.all(jobs);
  return { printed: modules.length > 0, modules };
}

function scheduleKitchenBarAutoPrint(order, opts = {}) {
  void autoPrintKitchenBarOrder(order, opts).catch((err) => {
    console.warn('[printing] auto cocina/bar (async):', err?.message || err);
  });
}

module.exports = {
  autoPrintKitchenBarOrder,
  scheduleKitchenBarAutoPrint,
};
