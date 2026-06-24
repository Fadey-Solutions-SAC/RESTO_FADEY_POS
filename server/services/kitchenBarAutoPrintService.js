/**
 * Auto-impresión cocina/bar en el servidor (Node en PC caja) cuando autoPrint está activo.
 */
const { loadConfig } = require('../printing/printerConfig');
const { print } = require('../printing/printerService');
const { buildPedidoMesaTicketPlainTextServer } = require('../printing/kitchenTicketPlain');
const { filterItemsForKitchenStation } = require('../utils/productionArea');
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

  const kitchenItems = filterItemsForKitchenStation(scopedItems, 'cocina');
  const barItems = filterItemsForKitchenStation(scopedItems, 'bar');
  const modules = [];

  const jobs = [];

  if (isModuleAutoPrintEnabled(cfg, 'cocina') && kitchenItems.length > 0) {
    const paperC = normalizePaperWidthMm(cfg?.cocina?.anchoPapel ?? cfg?.cocina?.paperWidth);
    const text = buildPedidoMesaTicketPlainTextServer(order, kitchenItems, paperC);
    jobs.push(
      print('cocina', { text, preformatted: true, paperWidth: paperC, anchoPapel: paperC })
        .then(() => {
          modules.push('cocina');
        })
        .catch((err) => {
          console.warn('[printing] auto cocina:', err?.message || err);
        }),
    );
  }

  if (isModuleAutoPrintEnabled(cfg, 'bar') && barItems.length > 0) {
    const paperB = normalizePaperWidthMm(cfg?.bar?.anchoPapel ?? cfg?.bar?.paperWidth);
    const text = buildPedidoMesaTicketPlainTextServer(order, barItems, paperB);
    jobs.push(
      print('bar', { text, preformatted: true, paperWidth: paperB, anchoPapel: paperB })
        .then(() => {
          modules.push('bar');
        })
        .catch((err) => {
          console.warn('[printing] auto bar:', err?.message || err);
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
