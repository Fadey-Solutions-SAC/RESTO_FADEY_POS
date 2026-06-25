import { api, electronPrinting, hasElectronPrinting } from './api';
import {
  orderHasTakeoutNote,
  buildPedidoMesaTicketPlainText,
  normalizeThermalPaperWidthMm,
} from './ticketPlainText';
import { isBarProductionItemForStation, isKitchenProductionItemForStation } from './productionArea';
import { isPrintingModuleEnabled } from './printingConfig';

const KITCHEN_PRINT_DEDUPE_KEY = 'resto_kitchen_print_dedupe';
const KITCHEN_PRINT_DEDUPE_MS = 15000;

const normalizePaperWidthMm = normalizeThermalPaperWidthMm;

/** App instalada (Electron): mismo canal IPC que precuenta/caja; navegador: bridge HTTP local. */
async function postKitchenBarPrint(moduleKey, payload) {
  if (hasElectronPrinting()) {
    await electronPrinting.printModule(moduleKey, payload);
    return;
  }
  await api.printing.post(`/printing/print/${moduleKey}`, payload);
}

function buildKitchenPrintDedupeKey(orderId, newItemIds, fromLinesUpdate) {
  if (fromLinesUpdate && Array.isArray(newItemIds) && newItemIds.length) {
    return `${orderId}:partial:${[...newItemIds].sort().join(',')}`;
  }
  return `${orderId}:full`;
}

/** Evita comanda duplicada (POS + socket, varias pestañas) en la misma sesión del navegador. */
function claimKitchenPrintDedupe(dedupeKey) {
  if (!dedupeKey || typeof window === 'undefined') return true;
  try {
    const raw = window.sessionStorage.getItem(KITCHEN_PRINT_DEDUPE_KEY);
    const data = raw ? JSON.parse(raw) : {};
    const now = Date.now();
    for (const [k, ts] of Object.entries(data)) {
      if (now - Number(ts) > KITCHEN_PRINT_DEDUPE_MS) delete data[k];
    }
    const prev = Number(data[dedupeKey] || 0);
    if (prev && now - prev < KITCHEN_PRINT_DEDUPE_MS) return false;
    data[dedupeKey] = now;
    window.sessionStorage.setItem(KITCHEN_PRINT_DEDUPE_KEY, JSON.stringify(data));
    return true;
  } catch (_) {
    return true;
  }
}

/** Libera la reserva si la impresión falló (permite reintento por socket). */
function releaseKitchenPrintDedupe(dedupeKey) {
  if (!dedupeKey || typeof window === 'undefined') return;
  try {
    const raw = window.sessionStorage.getItem(KITCHEN_PRINT_DEDUPE_KEY);
    const data = raw ? JSON.parse(raw) : {};
    delete data[dedupeKey];
    window.sessionStorage.setItem(KITCHEN_PRINT_DEDUPE_KEY, JSON.stringify(data));
  } catch (_) {
    /* noop */
  }
}

function toTicketItems(list) {
  return list.map((it) => ({
    product_name: String(it.product_name || '').trim() || '—',
    variant_name: String(it.variant_name || '').trim(),
    quantity: Number(it.quantity || 1),
    notes: String(it.notes || '').trim(),
    modifier_option: String(it.modifier_option || '').trim(),
  }));
}

/**
 * Imprime comanda en cocina/bar según ítems y autoPrint de cada módulo.
 * @param {object|string} orderOrId — pedido con ítems o id
 * @param {{ newItemIds?: string[]|null, fromLinesUpdate?: boolean }} opts
 *   - newItemIds: solo esos ítems (merge / edición mesa)
 *   - fromLinesUpdate: si true y no hay ids, no imprime
 */
export async function printKitchenBarOrder(orderOrId, { newItemIds = null, fromLinesUpdate = false } = {}) {
  const orderId = typeof orderOrId === 'string' ? orderOrId : orderOrId?.id;
  if (!orderId) return false;

  if (fromLinesUpdate) {
    const scoped = Array.isArray(newItemIds) ? newItemIds : [];
    if (!scoped.length) return false;
  }

  const dedupeKey = buildKitchenPrintDedupeKey(orderId, newItemIds, fromLinesUpdate);
  if (!claimKitchenPrintDedupe(dedupeKey)) return false;

  try {
    const hasInlineItems =
      typeof orderOrId === 'object' &&
      orderOrId !== null &&
      Array.isArray(orderOrId.items) &&
      orderOrId.items.length > 0;

    const [cfg, fullOrder] = await Promise.all([
      hasElectronPrinting() ? electronPrinting.getConfig() : api.printing.get('/printing/config'),
      hasInlineItems ? Promise.resolve(orderOrId) : api.get(`/orders/${orderId}`),
    ]);

    const items = Array.isArray(fullOrder?.items) ? fullOrder.items : [];
    if (!items.length) return false;

    const scopedItems =
      Array.isArray(newItemIds) && newItemIds.length
        ? items.filter((it) => newItemIds.includes(it.id))
        : items;
    if (!scopedItems.length) return false;

    const kitchenItems = scopedItems.filter(isKitchenProductionItemForStation);
    const barItems = scopedItems.filter(isBarProductionItemForStation);
    if (!kitchenItems.length && !barItems.length) return false;

    const paperC = normalizePaperWidthMm(cfg?.cocina?.anchoPapel ?? cfg?.cocina?.paperWidth ?? 80);
    const paperB = normalizePaperWidthMm(cfg?.bar?.anchoPapel ?? cfg?.bar?.paperWidth ?? 80);
    const takeout = orderHasTakeoutNote(fullOrder);
    const waiter = String(fullOrder?.created_by_user_name || '').trim();
    const tableLbl =
      fullOrder?.type === 'dine_in' && fullOrder?.table_number
        ? `Mesa ${String(fullOrder.table_number).trim()}`
        : String(fullOrder?.table_number || '').trim();

    let printed = false;

    if (isPrintingModuleEnabled(cfg, 'cocina') && kitchenItems.length > 0) {
      const text = buildPedidoMesaTicketPlainText({
        tableLabel: tableLbl,
        orderNumber: fullOrder?.order_number,
        takeout,
        waiterName: waiter,
        items: toTicketItems(kitchenItems),
        widthMm: paperC,
        printedAt: new Date(),
        orderType: fullOrder?.type || 'dine_in',
      });
      await postKitchenBarPrint('cocina', {
        text,
        preformatted: true,
        paperWidth: paperC,
        anchoPapel: paperC,
      });
      printed = true;
    }

    if (isPrintingModuleEnabled(cfg, 'bar') && barItems.length > 0) {
      const text = buildPedidoMesaTicketPlainText({
        tableLabel: tableLbl,
        orderNumber: fullOrder?.order_number,
        takeout,
        waiterName: waiter,
        items: toTicketItems(barItems),
        widthMm: paperB,
        printedAt: new Date(),
        orderType: fullOrder?.type || 'dine_in',
      });
      await postKitchenBarPrint('bar', {
        text,
        preformatted: true,
        paperWidth: paperB,
        anchoPapel: paperB,
      });
      printed = true;
    }

    return printed;
  } catch (err) {
    releaseKitchenPrintDedupe(dedupeKey);
    console.warn('[printing] auto cocina/bar:', err?.message || err);
    return false;
  }
}

/** Tras enviar comanda desde POS/mesas: imprime como antes; el socket no duplica (dedupe en sesión). */
export async function printKitchenBarOnComandaSend(order, { merged = false } = {}) {
  if (!order?.id) return false;
  const newIds = Array.isArray(order.new_item_ids) ? order.new_item_ids : [];
  return printKitchenBarOrder(order, {
    newItemIds: merged ? newIds : null,
    fromLinesUpdate: merged,
  });
}
