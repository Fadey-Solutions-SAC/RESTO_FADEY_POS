export const PAYMENT_METHOD_LABELS_ES = {
  efectivo: 'Efectivo',
  yape: 'Yape',
  plin: 'Plin',
  tarjeta: 'Tarjeta',
  online: 'Online',
  cortesia: 'Cortesía',
  cuenta_cliente: 'Cuenta cliente',
};

const BREAKDOWN_ORDER = ['efectivo', 'yape', 'plin', 'tarjeta', 'online'];

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function paymentMethodLabelEs(method) {
  const m = String(method || '').trim().toLowerCase();
  return PAYMENT_METHOD_LABELS_ES[m] || m || '—';
}

/** Desglose multimétodo del pedido (`{ efectivo: 66, yape: 50 }`) o null si fue un solo método. */
export function parseOrderPaymentBreakdown(order) {
  let raw = order?.payment_breakdown;
  if (typeof raw === 'string') {
    if (!raw.trim()) return null;
    try {
      raw = JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const amt = round2(v);
    if (Number.isFinite(amt) && amt > 0) out[k] = amt;
  }
  return Object.keys(out).length >= 2 ? out : null;
}

/** Suma el pago del pedido en `parts` (Map método → monto), repartiendo el desglose si es multimétodo. */
export function addOrderPaymentParts(parts, order) {
  const br = parseOrderPaymentBreakdown(order);
  if (br) {
    for (const [k, v] of Object.entries(br)) parts.set(k, round2((parts.get(k) || 0) + v));
    return true;
  }
  const method = String(order?.payment_method || 'efectivo');
  parts.set(method, round2((parts.get(method) || 0) + Number(order?.total || 0)));
  return false;
}

function sortedParts(parts) {
  return [...parts.entries()].sort((a, b) => {
    const ia = BREAKDOWN_ORDER.indexOf(a[0]);
    const ib = BREAKDOWN_ORDER.indexOf(b[0]);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

/** «Multimétodo · Efectivo (S/): 66.00 · Yape (S/): 50.00» o «Efectivo (S/): 116.00». */
export function formatPaymentPartsSummary(parts, { multi = false } = {}) {
  const text = sortedParts(parts)
    .map(([method, amount]) => `${paymentMethodLabelEs(method)} (S/): ${Number(amount).toFixed(2)}`)
    .join(' · ');
  return multi && text ? `Multimétodo · ${text}` : text;
}

/** Detalle para mostrar en lista: `{ multi, lines: [{ method, label, amount }], courtesyCount }`. */
export function paymentPartsDetail(parts, { multi = false, courtesyCount = 0 } = {}) {
  return {
    multi: Boolean(multi),
    lines: sortedParts(parts).map(([method, amount]) => ({
      method,
      label: paymentMethodLabelEs(method),
      amount: round2(amount),
    })),
    courtesyCount: Number(courtesyCount) || 0,
  };
}

/** Detalle de pago de un solo pedido (multimétodo con montos) o null si fue un solo método. */
export function orderPaymentDetail(order) {
  const br = parseOrderPaymentBreakdown(order);
  if (!br) return null;
  return paymentPartsDetail(new Map(Object.entries(br)), { multi: true });
}

/** Etiqueta de pago de un pedido; usa `labelFn` para el caso de un solo método. */
export function formatOrderPaymentLabel(order, labelFn = paymentMethodLabelEs) {
  const br = parseOrderPaymentBreakdown(order);
  if (!br) return labelFn(order?.payment_method);
  const parts = new Map(Object.entries(br));
  return formatPaymentPartsSummary(parts, { multi: true });
}
