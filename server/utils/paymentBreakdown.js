/** Métodos permitidos en desglose multipago (alineado con `orders.payment_method`). */
const ALLOWED = new Set(['efectivo', 'yape', 'plin', 'tarjeta', 'online']);

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function parsePaymentBreakdown(raw) {
  let o = null;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    o = raw;
  } else if (typeof raw === 'string' && raw.trim()) {
    try {
      o = JSON.parse(raw);
    } catch (_) {
      return null;
    }
  } else {
    return null;
  }
  try {
    if (!o || typeof o !== 'object') return null;
    const out = {};
    for (const [k, v] of Object.entries(o)) {
      if (!ALLOWED.has(k)) continue;
      const amt = round2(v);
      if (!Number.isFinite(amt) || amt <= 0) continue;
      out[k] = amt;
    }
    const keys = Object.keys(out);
    if (keys.length < 2) return null;
    return out;
  } catch (_) {
    return null;
  }
}

function aggregateBreakdownIntoTotals(breakdown, target) {
  for (const [k, v] of Object.entries(breakdown)) {
    const amt = round2(v);
    if (k === 'efectivo') target.total_cash = round2(target.total_cash + amt);
    else if (k === 'yape') target.total_yape = round2(target.total_yape + amt);
    else if (k === 'plin') target.total_plin = round2(target.total_plin + amt);
    else if (k === 'tarjeta') target.total_card = round2(target.total_card + amt);
    else if (k === 'online') target.total_online = round2(target.total_online + amt);
  }
}

/**
 * Reparte cada método del desglose entre pedidos según la fracción ti/T del total del lote.
 * @returns {Array<string|null>} JSON por pedido o null si monto del pedido es 0.
 */
function splitBreakdownAcrossOrders(breakdown, orderTotals, batchTotal) {
  const T = round2(batchTotal);
  const n = orderTotals.length;
  if (!breakdown || !n || T <= 0) return Array(n).fill(null);
  const keys = Object.keys(breakdown);
  if (!keys.length) return Array(n).fill(null);

  const outPerOrder = orderTotals.map(() => ({}));

  for (const k of keys) {
    const S = round2(breakdown[k]);
    if (S <= 0) continue;
    const parts = orderTotals.map((ti) => {
      const tii = round2(ti || 0);
      return tii <= 0 ? 0 : round2((S * tii) / T);
    });
    const sumP = round2(parts.reduce((a, b) => a + b, 0));
    let drift = round2(S - sumP);
    if (drift !== 0) {
      let bi = 0;
      let bestTi = -1;
      for (let i = 0; i < n; i += 1) {
        const tii = round2(orderTotals[i] || 0);
        if (tii > bestTi) {
          bestTi = tii;
          bi = i;
        }
      }
      parts[bi] = round2(parts[bi] + drift);
    }
    for (let i = 0; i < n; i += 1) {
      if (parts[i] > 0) outPerOrder[i][k] = parts[i];
    }
  }

  return outPerOrder.map((row, i) => {
    if (round2(orderTotals[i] || 0) <= 0) return null;
    return Object.keys(row).length ? JSON.stringify(row) : null;
  });
}

const TIP_FIELD_BY_METHOD = {
  efectivo: 'tips_cash',
  yape: 'tips_yape',
  plin: 'tips_plin',
  tarjeta: 'tips_card',
  online: 'tips_online',
};

/**
 * La propina se cobra con el mismo medio de la venta (Yape 191 + 5 propina = 196 en el QR).
 * En multipago se reparte proporcional a cada medio.
 */
function splitTipByMethod(tip, breakdown, paymentMethod) {
  const amt = round2(tip);
  if (amt <= 0) return {};
  if (breakdown) {
    const entries = Object.entries(breakdown).filter(([, v]) => round2(v) > 0);
    const sum = round2(entries.reduce((s, [, v]) => s + round2(v), 0));
    if (entries.length && sum > 0) {
      const out = {};
      let assigned = 0;
      let bestKey = entries[0][0];
      let bestAmt = -1;
      for (const [k, v] of entries) {
        const part = round2((amt * round2(v)) / sum);
        out[k] = part;
        assigned = round2(assigned + part);
        if (round2(v) > bestAmt) {
          bestAmt = round2(v);
          bestKey = k;
        }
      }
      const drift = round2(amt - assigned);
      if (drift !== 0) out[bestKey] = round2(out[bestKey] + drift);
      return out;
    }
  }
  const pm = String(paymentMethod || 'efectivo').trim().toLowerCase();
  return { [TIP_FIELD_BY_METHOD[pm] ? pm : 'efectivo']: amt };
}

function addOrderToSalesTotals(row, totals) {
  if (String(row?.payment_method || '').trim().toLowerCase() === 'cortesia') return;
  const t = round2(row.total || 0);
  totals.total_sales = round2(totals.total_sales + t);
  const br = parsePaymentBreakdown(row.payment_breakdown);
  const tip = round2(Number(row.tip_amount || 0));
  if (tip > 0) {
    if (typeof totals.total_tips !== 'number') totals.total_tips = 0;
    totals.total_tips = round2(totals.total_tips + tip);
    for (const [method, part] of Object.entries(splitTipByMethod(tip, br, row.payment_method))) {
      const field = TIP_FIELD_BY_METHOD[method] || 'tips_cash';
      totals[field] = round2(Number(totals[field] || 0) + part);
    }
  }
  if (br) {
    aggregateBreakdownIntoTotals(br, totals);
  } else {
    const pm = String(row.payment_method || 'efectivo');
    if (pm === 'efectivo') totals.total_cash = round2(totals.total_cash + t);
    else if (pm === 'yape') totals.total_yape = round2(totals.total_yape + t);
    else if (pm === 'plin') totals.total_plin = round2(totals.total_plin + t);
    else if (pm === 'tarjeta') totals.total_card = round2(totals.total_card + t);
    else if (pm === 'online') totals.total_online = round2(totals.total_online + t);
    else totals.total_cash = round2(totals.total_cash + t);
  }
}

function dominantPaymentMethod(breakdown) {
  let best = 'efectivo';
  let bestAmt = -1;
  for (const [k, v] of Object.entries(breakdown)) {
    const a = round2(v);
    if (a > bestAmt) {
      bestAmt = a;
      best = k;
    }
  }
  return bestAmt > 0 ? best : 'efectivo';
}

module.exports = {
  parsePaymentBreakdown,
  splitBreakdownAcrossOrders,
  addOrderToSalesTotals,
  splitTipByMethod,
  dominantPaymentMethod,
  round2,
  ALLOWED,
};
