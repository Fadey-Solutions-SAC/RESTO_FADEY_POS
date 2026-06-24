/** Líneas de producto a partir de pedidos de mesa (u órdenes con items). */

import { toLocalDateKey } from './api';

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

/** Fecha local (YYYY-MM-DD) del pedido para agrupar ventas por día. */
export function salesOrderLocalDateKey(order) {
  return toLocalDateKey(order?.updated_at || order?.created_at);
}

/**
 * Separa cuentas distintas de la misma mesa en un mismo día:
 * cuando la cuenta anterior quedó totalmente cobrada, la siguiente es otra venta.
 */
export function splitMesaAccountSessions(orders = []) {
  const sorted = [...orders].sort(
    (a, b) => new Date(String(a?.created_at || 0)).getTime() - new Date(String(b?.created_at || 0)).getTime(),
  );
  const sessions = [];
  let current = [];

  const sessionFullyClosed = (list) =>
    list.length > 0 &&
    list.every(
      (o) =>
        o.status === 'cancelled' ||
        String(o.payment_status || 'pending') === 'paid' ||
        String(o.payment_status || '') === 'refunded',
    );

  for (const order of sorted) {
    if (!current.length) {
      current.push(order);
      continue;
    }
    if (sessionFullyClosed(current)) {
      sessions.push(current);
      current = [order];
    } else {
      current.push(order);
    }
  }
  if (current.length) sessions.push(current);
  return sessions;
}

/** Clave de agrupación en Ventas: mesa + fecha + cuenta (sesión). Delivery/mostrador: pedido suelto. */
export function salesGroupKey(order, { sessionIndex = 0 } = {}) {
  if (!order) return '';
  const table = String(order.table_number || '').trim();
  if (order.type === 'dine_in' && table) {
    const dateKey = salesOrderLocalDateKey(order);
    return `mesa:${table}:${dateKey}:${sessionIndex}`;
  }
  return `pedido:${order.id || ''}`;
}

/** @deprecated use salesGroupKey — mantiene compatibilidad con clave mesa simple. */
export function salesGroupKeyLegacy(order) {
  if (!order) return '';
  const table = String(order.table_number || '').trim();
  if (order.type === 'dine_in' && table) return `mesa:${table}`;
  return `pedido:${order.id || ''}`;
}

export function orderMatchesMesaSearch(order, queryRaw) {
  const q = String(queryRaw || '').trim().toLowerCase();
  if (!q) return true;
  const table = String(order?.table_number || '').trim();
  if (!table) return false;
  const qMesa = q.replace(/^mesa\s*/i, '').trim();
  const qDigits = qMesa.replace(/^m\s*/i, '').trim();
  const normalizeNum = (v) => {
    const s = String(v || '').trim();
    return /^\d+$/.test(s) ? String(Number.parseInt(s, 10)) : s.toLowerCase();
  };
  if (normalizeNum(table) === normalizeNum(qDigits)) return true;
  if (table.toLowerCase().includes(qMesa)) return true;
  const label = formatMesaLabel(table).toLowerCase();
  if (label.includes(qMesa) || label.includes(q)) return true;
  return false;
}

export function formatMesaLabel(tableNumber) {
  const t = String(tableNumber || '').trim();
  if (!t) return '-';
  return `M${t.padStart(2, '0')}`;
}

const TABLE_ORDER_MERGE_WINDOW_MS = 40 * 60 * 1000;

function isWithinTableMergeWindow(order) {
  if (!order) return false;
  const releaseAt = String(order.kitchen_release_at || '').trim();
  if (releaseAt) {
    const releaseMs = Date.parse(releaseAt.includes('T') ? releaseAt : releaseAt.replace(' ', 'T'));
    if (Number.isFinite(releaseMs) && releaseMs > Date.now()) return false;
  }
  const anchor = order.kitchen_last_send_at || order.created_at;
  if (!anchor) return false;
  const anchorMs = Date.parse(String(anchor).includes('T') ? anchor : String(anchor).replace(' ', 'T'));
  if (!Number.isFinite(anchorMs)) return false;
  return Date.now() - anchorMs < TABLE_ORDER_MERGE_WINDOW_MS;
}

/** Payload común al enviar/agregar pedido de mesa. */
export function buildDineInOrderPayload({ table, cartItems, extra = {} }) {
  return {
    items: cartItems,
    type: 'dine_in',
    table_number: String(table?.number ?? '').trim(),
    table_id: String(table?.id ?? '').trim(),
    target_order_id: '',
    customer_name: `Mesa ${table?.number ?? ''}`,
    payment_method: 'efectivo',
    ...extra,
  };
}

export function isCourtesyOrder(order) {
  if (String(order?.payment_method || '').trim().toLowerCase() === 'cortesia') return true;
  return /\[DESCUENTO:\s*Cortes/i.test(String(order?.notes || ''));
}

export function parseCourtesyReason(order) {
  const raw = String(order?.notes || '');
  const tagged = raw.match(/\[DESCUENTO:\s*(Cortes[ií]a:\s*[^\]]+)\]/i);
  if (tagged) return tagged[1].replace(/^Cortes[ií]a:\s*/i, '').trim();
  const generic = raw.match(/\[DESCUENTO:\s*([^\]]+)\]/);
  return generic ? generic[1].trim() : '';
}

export function courtesyReferenceAmount(order) {
  const disc = Number(order?.discount || 0);
  if (disc > 0) return disc;
  return Math.max(0, Number(order?.subtotal || 0) + Number(order?.delivery_fee || 0));
}

/** Descuento aplicado o cortesía (pedido con ajuste al cobrar). */
export function isSalesAdjustmentOrder(order) {
  if (isCourtesyOrder(order)) return true;
  return Number(order?.discount || 0) > 0.009;
}

/** Descuento parcial (no cortesía). */
export function isDiscountOrder(order) {
  return !isCourtesyOrder(order) && Number(order?.discount || 0) > 0.009;
}

export function parseAdjustmentReason(order) {
  if (isCourtesyOrder(order)) return parseCourtesyReason(order);
  const raw = String(order?.notes || '');
  const tagged = raw.match(/\[DESCUENTO:\s*([^\]]+)\]/);
  return tagged ? tagged[1].trim() : '';
}

export function adjustmentReferenceAmount(order) {
  if (isCourtesyOrder(order)) return courtesyReferenceAmount(order);
  return Math.max(0, Number(order?.discount || 0));
}

export function adjustmentAmountCharged(order) {
  if (isCourtesyOrder(order)) return 0;
  return Math.max(0, Number(order?.total || 0));
}

/**
 * Agrupa ventas de salón por mesa + fecha + cuenta; delivery/mostrador quedan como fila individual.
 * Cortesías no suman al total de venta ni al desglose de pagos en soles.
 */
export function buildSalesDisplayGroups(orders = []) {
  const mesaBuckets = new Map();
  const standalone = [];

  for (const order of orders) {
    const table = String(order.table_number || '').trim();
    if (order.type === 'dine_in' && table) {
      const bucketKey = `${table}::${salesOrderLocalDateKey(order)}`;
      if (!mesaBuckets.has(bucketKey)) mesaBuckets.set(bucketKey, []);
      mesaBuckets.get(bucketKey).push(order);
    } else {
      standalone.push(order);
    }
  }

  const sessionLists = [];
  for (const list of mesaBuckets.values()) {
    splitMesaAccountSessions(list).forEach((session, sessionIndex) => {
      sessionLists.push({ list: session, sessionIndex });
    });
  }
  for (const order of standalone) {
    sessionLists.push({ list: [order], sessionIndex: 0 });
  }

  const groups = sessionLists.map(({ list, sessionIndex }) => {
    const sorted = [...list].sort(
      (a, b) => new Date(`${b.created_at}Z`).getTime() - new Date(`${a.created_at}Z`).getTime(),
    );
    const primary = sorted[0];
    const table = String(primary.table_number || '').trim();
    const dateKey = salesOrderLocalDateKey(primary);
    const key = salesGroupKey(primary, { sessionIndex });
    const isMesa = primary.type === 'dine_in' && Boolean(table);
    const salesOrders = sorted.filter((o) => !isCourtesyOrder(o));
    const courtesyOrders = sorted.filter(isCourtesyOrder);
    const allItems = sorted.flatMap((o) => o.items || []);
    const groupedProducts = groupItemsByProductNameForBill(allItems);
    const total = salesOrders.reduce((s, o) => s + Number(o.total || 0), 0);
    const paidTotal = salesOrders
      .filter((o) => o.payment_status === 'paid')
      .reduce((s, o) => s + Number(o.total || 0), 0);
    const pendingTotal = salesOrders
      .filter((o) => String(o.payment_status || 'pending') === 'pending')
      .reduce((s, o) => s + Number(o.total || 0), 0);

    const payParts = new Map();
    for (const o of salesOrders) {
      const method = String(o.payment_method || 'efectivo');
      payParts.set(method, (payParts.get(method) || 0) + Number(o.total || 0));
    }
    if (courtesyOrders.length) {
      payParts.set('cortesia', courtesyOrders.length);
    }
    const paymentSummary = [...payParts.entries()]
      .map(([method, amount]) => {
        if (method === 'cortesia') return `Cortesía × ${amount}`;
        const labels = { efectivo: 'Efectivo', yape: 'Yape', plin: 'Plin', tarjeta: 'Tarjeta', online: 'Online' };
        const label = labels[method] || method;
        return `${label} (S/): ${Number(amount).toFixed(2)}`;
      })
      .join(' · ');

    const latestAt = sorted[0]?.created_at;
    const earliestAt = sorted[sorted.length - 1]?.created_at;

    return {
      key,
      isMesa,
      mesaLabel: isMesa ? formatMesaLabel(primary.table_number) : '-',
      salesDateKey: dateKey,
      sessionIndex,
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
      salesOrderCount: salesOrders.length,
      courtesyCount: courtesyOrders.length,
    };
  });

  return groups.sort(
    (a, b) => new Date(`${b.latestAt}Z`).getTime() - new Date(`${a.latestAt}Z`).getTime(),
  );
}
