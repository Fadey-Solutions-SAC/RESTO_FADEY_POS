/** Líneas de producto a partir de pedidos de mesa (u órdenes con items). */

/**
 * Identidad de línea para mesa / precuenta / cobro: mismo producto, variante, notas y precio unitario → se agrupan cantidades.
 * No agrupa solo por nombre (evita mezclar ítems distintos con el mismo texto).
 */
/** Suma importe de líneas (misma fórmula que agrupación de precuenta / cobro). */
export function sumOrderItemsChargeSubtotal(items) {
  return (items || []).reduce((s, it) => {
    const qty = Number(it.quantity || 0);
    const unit = Number(it.unit_price ?? 0);
    return s + Number(it.subtotal != null ? it.subtotal : unit * qty);
  }, 0);
}

/**
 * Importe cobrable del pedido: alinea totales con la tabla de ítems (suma de líneas),
 * y si viene vacío usa subtotal/total de la fila `orders`.
 */
export function getOrderChargeTotal(order) {
  if (!order) return 0;
  const delivery = Number(order.delivery_fee || 0);
  const discount = Number(order.discount || 0);
  const itemSum = sumOrderItemsChargeSubtotal(order.items);
  let base = itemSum + delivery;
  if (base <= 0) {
    base = Number(order.subtotal || 0) + delivery;
  }
  if (base <= 0) {
    base = Number(order.total || 0);
  }
  return Math.max(0, base - discount);
}

export function billLineKey(it) {
  const pid = String(it.product_id || '').trim();
  const variant = String(it.variant_name || '').trim().toLowerCase();
  const notes = String(it.notes || '').trim();
  const unit = Number(it.unit_price ?? 0);
  return `${pid}|${variant}|${notes}|${unit.toFixed(4)}`;
}

export function billLineDisplayName(it) {
  const base = String(it.product_name || '—').trim() || '—';
  const v = String(it.variant_name || '').trim();
  return v ? `${base} (${v})` : base;
}

/** Agrupa ítems de varios pedidos de mesa con etiqueta de estado (Varios si aplica). Vista «Ver pedido» en Mesas/Caja. */
export function groupTableOrderItemsForBill(orders) {
  const m = new Map();
  for (const o of orders || []) {
    const orderStatus = String(o.status || '').toLowerCase();
    for (const it of o.items || []) {
      const k = billLineKey(it);
      const qty = Number(it.quantity || 0);
      const unit = Number(it.unit_price ?? 0);
      const sub = Number(it.subtotal != null ? it.subtotal : unit * qty);
      if (!m.has(k)) {
        m.set(k, {
          key: k,
          name: billLineDisplayName(it),
          quantity: 0,
          subtotal: 0,
          statuses: new Set(),
        });
      }
      const row = m.get(k);
      row.quantity += qty;
      row.subtotal += sub;
      row.statuses.add(orderStatus);
    }
  }
  return [...m.values()].map((row) => {
    const list = [...row.statuses].filter(Boolean);
    let status = list.length <= 1 ? list[0] || '' : '__mixed__';
    return { ...row, status };
  });
}

export function flattenOrdersToLines(orders) {
  const rows = [];
  for (const order of orders || []) {
    const st = order.status;
    const on = order.order_number;
    for (const it of order.items || []) {
      const qty = Number(it.quantity || 0);
      const unit = Number(it.unit_price ?? 0);
      const sub = Number(it.subtotal != null ? it.subtotal : unit * qty);
      rows.push({
        key: it.id,
        orderNumber: on,
        name: String(it.product_name || '—').trim() || '—',
        quantity: qty,
        subtotal: sub,
        status: st,
      });
    }
  }
  return rows;
}

export function mergeLinesByProductName(rows) {
  const m = new Map();
  for (const r of rows) {
    const k = r.name.toLowerCase();
    if (!m.has(k)) {
      m.set(k, {
        key: `agg-${k}`,
        orderNumber: null,
        name: r.name,
        quantity: 0,
        subtotal: 0,
        statuses: new Set(),
      });
    }
    const a = m.get(k);
    a.quantity += r.quantity;
    a.subtotal += r.subtotal;
    a.statuses.add(String(r.status || '').toLowerCase());
  }
  return [...m.values()].map((row) => {
    const { statuses, ...rest } = row;
    const list = [...statuses].filter(Boolean);
    let status = list[0] || '';
    if (list.length > 1) status = '__mixed__';
    return { ...rest, status };
  });
}

/**
 * Agrupa ítems por línea de producto (producto + variante + notas + P. unit.): cobrar mesa, precuenta, modal ver pedido.
 * Líneas iguales suman cantidades; una línea distinta (otro producto u opciones/notas/precio) es otra fila.
 */
export function groupItemsByProductNameForBill(items) {
  const m = new Map();
  for (const it of items || []) {
    const k = billLineKey(it);
    const qty = Number(it.quantity || 0);
    const unit = Number(it.unit_price ?? 0);
    const sub = Number(it.subtotal != null ? it.subtotal : unit * qty);
    if (!m.has(k)) {
      m.set(k, { key: k, name: billLineDisplayName(it), qty: 0, subtotal: 0 });
    }
    const a = m.get(k);
    a.qty += qty;
    a.subtotal += sub;
  }
  return [...m.values()].map((r) => ({
    key: r.key,
    name: r.name,
    qty: r.qty,
    subtotal: r.subtotal,
    unitPrice: r.qty > 0 ? r.subtotal / r.qty : 0,
  }));
}

export function getStaffOrderStatusUi(status) {
  const value = String(status || '').toLowerCase();
  if (value === '__mixed__') return { label: 'Varios', classes: 'bg-slate-600/35 text-[#F9FAFB] border border-slate-400/35' };
  if (value === 'pending') return { label: 'Pendiente', classes: 'bg-[#3B82F6]/20 text-[#F9FAFB] border border-[#3B82F6]/40' };
  if (value === 'preparing') return { label: 'Preparando', classes: 'bg-[#2563EB]/20 text-[#F9FAFB] border border-[#2563EB]/40' };
  if (value === 'ready') return { label: 'Listo', classes: 'bg-emerald-500/20 text-emerald-100 border border-emerald-300/40' };
  if (value === 'delivered') return { label: 'Entregado', classes: 'bg-[#1F2937] text-[#F9FAFB] border border-[#3B82F6]/30' };
  if (value === 'cancelled') return { label: 'Cancelado', classes: 'bg-[#1E40AF]/25 text-[#F9FAFB] border border-[#3B82F6]/40' };
  return { label: value || 'Sin estado', classes: 'bg-[#1F2937] text-[#F9FAFB] border border-[#3B82F6]/30' };
}

/** Clave de agrupación en Ventas: misma mesa (salón) o un pedido suelto (delivery/mostrador). */
export function salesGroupKey(order) {
  if (!order) return '';
  const table = String(order.table_number || '').trim();
  if (order.type === 'dine_in' && table) return `mesa:${table}`;
  return `pedido:${order.id || ''}`;
}

export function formatMesaLabel(tableNumber) {
  const t = String(tableNumber || '').trim();
  if (!t) return '-';
  return `M${t.padStart(2, '0')}`;
}

/**
 * Agrupa ventas de salón por mesa; delivery/mostrador quedan como fila individual.
 * Productos de la mesa se consolidan con la misma regla que precuenta/cobro.
 */
export function buildSalesDisplayGroups(orders = []) {
  const byKey = new Map();
  for (const order of orders) {
    const key = salesGroupKey(order);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(order);
  }

  const groups = [...byKey.entries()].map(([key, list]) => {
    const sorted = [...list].sort(
      (a, b) => new Date(`${b.created_at}Z`).getTime() - new Date(`${a.created_at}Z`).getTime(),
    );
    const primary = sorted[0];
    const isMesa = key.startsWith('mesa:');
    const allItems = sorted.flatMap((o) => o.items || []);
    const groupedProducts = groupItemsByProductNameForBill(allItems);
    const total = sorted.reduce((s, o) => s + Number(o.total || 0), 0);
    const paidTotal = sorted
      .filter((o) => o.payment_status === 'paid')
      .reduce((s, o) => s + Number(o.total || 0), 0);
    const pendingTotal = sorted
      .filter((o) => String(o.payment_status || 'pending') === 'pending')
      .reduce((s, o) => s + Number(o.total || 0), 0);

    const payParts = new Map();
    for (const o of sorted) {
      const method = String(o.payment_method || 'efectivo');
      payParts.set(method, (payParts.get(method) || 0) + Number(o.total || 0));
    }
    const paymentSummary = [...payParts.entries()]
      .map(([method, amount]) => `${method} (S/): ${amount.toFixed(2)}`)
      .join(' · ');

    const latestAt = sorted[0]?.created_at;
    const earliestAt = sorted[sorted.length - 1]?.created_at;

    return {
      key,
      isMesa,
      mesaLabel: isMesa ? formatMesaLabel(primary.table_number) : '-',
      orders: sorted,
      primary,
      groupedProducts,
      total,
      paidTotal,
      pendingTotal,
      paymentSummary,
      latestAt,
      earliestAt,
      comprobanteCount: sorted.length,
    };
  });

  return groups.sort(
    (a, b) => new Date(`${b.latestAt}Z`).getTime() - new Date(`${a.latestAt}Z`).getTime(),
  );
}
