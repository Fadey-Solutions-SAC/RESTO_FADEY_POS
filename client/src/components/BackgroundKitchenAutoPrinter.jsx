import { useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../hooks/useSocket';
import {
  printKitchenBarOrder,
} from '../utils/kitchenBarAutoPrint';

export default function BackgroundKitchenAutoPrinter() {
  const { user } = useAuth();
  const printedKeysRef = useRef(new Set());

  const autoPrintOrder = async (incomingOrder) => {
    if (!user || user.type !== 'staff') return;
    const role = String(user.role || '').toLowerCase();
    if (!['admin', 'cajero', 'mozo', 'cocina', 'bar', 'master_admin'].includes(role)) return;

    const orderId = incomingOrder?.id;
    if (!orderId) return;
    /** Liberación T−45 min: el servidor ya imprime en cocina/bar si autoPrint está activo. */
    if (incomingOrder?._reservation_release) return;
    if (incomingOrder?._from_lines_update) {
      const scopedIds = Array.isArray(incomingOrder?.new_item_ids) ? incomingOrder.new_item_ids : [];
      if (!scopedIds.length) return;
    }
    const dedupeKey = `${orderId}:${incomingOrder?.updated_at || incomingOrder?.created_at || 'x'}`;
    if (printedKeysRef.current.has(dedupeKey)) return;
    printedKeysRef.current.add(dedupeKey);
    if (printedKeysRef.current.size > 400) {
      printedKeysRef.current = new Set(Array.from(printedKeysRef.current).slice(-200));
    }

    await printKitchenBarOrder(incomingOrder, {
      newItemIds: Array.isArray(incomingOrder?.new_item_ids) ? incomingOrder.new_item_ids : null,
      fromLinesUpdate: Boolean(incomingOrder?._from_lines_update),
    });
  };

  useSocket('new-order', (order) => {
    void autoPrintOrder(order);
  });
  useSocket('order-lines-updated', (payload) => {
    const order = payload?.order || payload;
    void autoPrintOrder({
      ...order,
      new_item_ids: Array.isArray(payload?.new_item_ids) ? payload.new_item_ids : [],
      _from_lines_update: true,
    });
  });

  return null;
}
