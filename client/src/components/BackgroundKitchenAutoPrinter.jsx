import { useRef } from 'react';
import { api } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../hooks/useSocket';
import {
  orderHasTakeoutNote,
  buildPedidoMesaTicketPlainText,
  normalizeThermalPaperWidthMm,
} from '../utils/ticketPlainText';
import { isBarProductionItem, isKitchenProductionItem } from '../utils/productionArea';

const POS_RECENT_AUTOPRINT_KEY = 'resto_pos_recent_kitchen_autoprint';

const normalizePaperWidthMm = normalizeThermalPaperWidthMm;

function wasRecentlyAutoPrintedByPos(orderId) {
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

export default function BackgroundKitchenAutoPrinter() {
  const { user } = useAuth();
  const printedKeysRef = useRef(new Set());

  const autoPrintOrder = async (incomingOrder) => {
    if (!user || user.type !== 'staff') return;
    const role = String(user.role || '').toLowerCase();
    if (!['admin', 'cajero', 'mozo', 'cocina', 'bar', 'master_admin'].includes(role)) return;

    const orderId = incomingOrder?.id;
    if (!orderId) return;
    if (wasRecentlyAutoPrintedByPos(orderId)) return;
    const dedupeKey = `${orderId}:${incomingOrder?.updated_at || incomingOrder?.created_at || 'x'}`;
    if (printedKeysRef.current.has(dedupeKey)) return;
    printedKeysRef.current.add(dedupeKey);
    if (printedKeysRef.current.size > 400) {
      printedKeysRef.current = new Set(Array.from(printedKeysRef.current).slice(-200));
    }

    try {
      const [cfg, fullOrder] = await Promise.all([
        api.printing.get('/printing/config'),
        api.get(`/orders/${orderId}`),
      ]);
      const items = Array.isArray(fullOrder?.items) ? fullOrder.items : [];
      if (!items.length) return;

      const kitchenItems = items.filter(isKitchenProductionItem);
      const barItems = items.filter(isBarProductionItem);
      const paperC = normalizePaperWidthMm(cfg?.cocina?.anchoPapel ?? cfg?.cocina?.paperWidth ?? 80);
      const paperB = normalizePaperWidthMm(cfg?.bar?.anchoPapel ?? cfg?.bar?.paperWidth ?? 80);
      const takeout = orderHasTakeoutNote(fullOrder);
      const waiter = String(fullOrder?.created_by_user_name || '').trim();
      const tableLbl =
        fullOrder?.type === 'dine_in' && fullOrder?.table_number
          ? `Mesa ${String(fullOrder.table_number).trim()}`
          : String(fullOrder?.table_number || '').trim();

      const toTicket = (list) =>
        list.map((it) => ({
          product_name: String(it.product_name || '').trim() || '—',
          variant_name: String(it.variant_name || '').trim(),
          quantity: Number(it.quantity || 1),
          notes: String(it.notes || '').trim(),
          modifier_option: String(it.modifier_option || '').trim(),
        }));

      if (cfg?.cocina?.autoPrint && kitchenItems.length > 0) {
        const text = buildPedidoMesaTicketPlainText({
          tableLabel: tableLbl,
          orderNumber: fullOrder?.order_number,
          takeout,
          waiterName: waiter,
          items: toTicket(kitchenItems),
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
      }
      if (cfg?.bar?.autoPrint && barItems.length > 0) {
        const text = buildPedidoMesaTicketPlainText({
          tableLabel: tableLbl,
          orderNumber: fullOrder?.order_number,
          takeout,
          waiterName: waiter,
          items: toTicket(barItems),
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
      }
    } catch (err) {
      console.warn('[printing] auto background cocina/bar:', err?.message || err);
    }
  };

  useSocket('new-order', (order) => {
    void autoPrintOrder(order);
  });
  useSocket('order-lines-updated', (order) => {
    void autoPrintOrder(order);
  });

  return null;
}
