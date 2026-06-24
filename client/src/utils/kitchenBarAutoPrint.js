import { api } from './api';
import {
  orderHasTakeoutNote,
  buildPedidoMesaTicketPlainText,
  normalizeThermalPaperWidthMm,
} from './ticketPlainText';
import { isBarProductionItemForStation, isKitchenProductionItemForStation } from './productionArea';
import { isPrintingModuleEnabled } from './printingConfig';

export const POS_RECENT_AUTOPRINT_KEY = 'resto_pos_recent_kitchen_autoprint';

const normalizePaperWidthMm = normalizeThermalPaperWidthMm;

export function markRecentKitchenAutoPrint(orderId) {
  if (!orderId || typeof window === 'undefined') return;
  try {
    const raw = window.sessionStorage.getItem(POS_RECENT_AUTOPRINT_KEY);
    const data = raw ? JSON.parse(raw) : {};
    data[String(orderId)] = Date.now();
    window.sessionStorage.setItem(POS_RECENT_AUTOPRINT_KEY, JSON.stringify(data));
  } catch (_) {
    /* noop */
  }
}

export function wasRecentlyAutoPrintedByPos(orderId) {
  if (!orderId || typeof window === 'undefined') return false;
  try {
    const raw = window.sessionStorage.getItem(POS_RECENT_AUTOPRINT_KEY);
    const data = raw ? JSON.parse(raw) : {};
    const ts = Number(data[String(orderId)] || 0);
    if (!ts) return false;
    const recent = Date.now() - ts < 12000;
    if (recent) return true;
    delete data[String(orderId)];
    window.sessionStorage.setItem(POS_RECENT_AUTOPRINT_KEY, JSON.stringify(data));
    return false;
  } catch (_) {
    return false;
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

  try {
    const hasInlineItems =
      typeof orderOrId === 'object' &&
      orderOrId !== null &&
      Array.isArray(orderOrId.items) &&
      orderOrId.items.length > 0;

    const [cfg, fullOrder] = await Promise.all([
      api.printing.get('/printing/config'),
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
      await api.printing.post('/printing/print/cocina', {
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
      await api.printing.post('/printing/print/bar', {
        text,
        preformatted: true,
        paperWidth: paperB,
        anchoPapel: paperB,
      });
      printed = true;
    }

    return printed;
  } catch (err) {
    console.warn('[printing] auto cocina/bar:', err?.message || err);
    return false;
  }
}

/** Tras enviar comanda desde POS/mesas: imprime y evita duplicado por socket. */
export async function printKitchenBarOnComandaSend(order, { merged = false } = {}) {
  if (!order?.id) return false;
  const newIds = Array.isArray(order.new_item_ids) ? order.new_item_ids : [];
  const printed = await printKitchenBarOrder(order, {
    newItemIds: merged ? newIds : null,
    fromLinesUpdate: merged,
  });
  if (printed) markRecentKitchenAutoPrint(order.id);
  return printed;
}
