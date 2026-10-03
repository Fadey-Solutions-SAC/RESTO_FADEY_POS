/** Texto plano monoespaciado para tickets (ancho tipo rollo 50/58/75/80 mm). */

import { formatDateTime, formatPeDateTimeParts, labelDeliveryPaymentModality } from './api';
import thermalLayout from '@thermalPrintLayout';

/** Valores de ancho de papel admitidos por el asistente y el layout térmico. */
export function normalizeThermalPaperWidthMm(value) {
  const n = Number(value);
  if (n === 50) return 50;
  if (n === 58) return 58;
  if (n === 75) return 75;
  return 80;
}

function computeEscposFactorsFromLayout() {
  const ex = thermalLayout.escposMagnification;
  if (ex && typeof ex === 'object') {
    return {
      width: Math.max(1, Math.min(8, Number(ex.width) || 1)),
      height: Math.max(1, Math.min(8, Number(ex.height) || 1)),
    };
  }
  const s = Number(thermalLayout.fontSizeScale);
  if (Number.isFinite(s) && s > 1) {
    const k = Math.min(8, Math.max(1, Math.round(s)));
    if (k <= 1) return { width: 1, height: 1 };
    return { width: k, height: k };
  }
  return { width: 1, height: 1 };
}

/** Misma lógica que el servidor: texto estrecho si hay GS en red o magnify global. */
function getEscposMagnificationFromLayout() {
  if (thermalLayout.useEscposCharacterMagnify === true) {
    return computeEscposFactorsFromLayout();
  }
  if (thermalLayout.useEscposCharacterMagnifyNetwork !== false) {
    return computeEscposFactorsFromLayout();
  }
  return { width: 1, height: 1 };
}

function defaultThermalPrintWidthChars() {
  return thermalCharWidth(80);
}

/** Indica si el bundle JS actual incluye el layout térmico (diagnosticar caché de Vercel/navegador). */
export function getThermalPrintRevision() {
  return String(thermalLayout?.revision || '');
}

/** Nota de pedido mesa/salón «para llevar» (POS). Debe coincidir con lo guardado en `orders.notes`. */
export const KITCHEN_TAKEOUT_NOTE = 'PARA LLEVAR';

export function orderHasTakeoutNote(order) {
  return String(order?.notes || '').toUpperCase().includes(KITCHEN_TAKEOUT_NOTE);
}

/** Anchos de carácter típicos para papel 58 mm vs 80 mm. */
export function thermalPaperMetrics(widthMm) {
  const n = Number(widthMm);
  const narrow = n <= 58;
  const medium = n > 58 && n <= 75;
  const wideChars = thermalCharWidth(widthMm);
  return {
    clip: narrow ? Math.min(32, wideChars) : medium ? Math.min(38, wideChars + 6) : wideChars,
    itemLine: narrow ? Math.min(32, wideChars) : wideChars,
    nameInQtyRow: narrow
      ? Math.min(24, Math.max(8, wideChars - 4))
      : medium
        ? Math.min(30, wideChars - 4)
        : Math.min(34, Math.max(8, wideChars - 6)),
    phoneClip: narrow
      ? Math.min(24, Math.max(8, wideChars - 2))
      : medium
        ? Math.min(28, wideChars - 2)
        : Math.min(32, Math.max(8, wideChars - 4)),
  };
}

/**
 * Ancho en caracteres para maquetar el texto (tras `GS !` ancho, caben menos columnas por línea).
 * Debe coincidir con `thermalEffectiveCharsPerLine` en el servidor.
 */
export function thermalCharWidth(widthMm) {
  const n = Number(widthMm);
  const cl = thermalLayout.charsPerLine;
  let base;
  if (!Number.isFinite(n) || n <= 0) base = Number(cl['80']) || 48;
  else if (n <= 50) base = Number(cl['50']) || 28;
  else if (n <= 58) base = Number(cl['58']) || 32;
  else if (n <= 75) base = Number(cl['75']) || 42;
  else base = Number(cl['80']) || 48;
  const { width: mw } = getEscposMagnificationFromLayout();
  const m = Math.max(1, mw);
  return Math.max(8, Math.floor(base / m));
}

/**
 * Ancho útil para tablas y texto (debe coincidir con `contentWidth` en `server/printing/escposBuilder.js`).
 */
export function thermalInnerWidth(widthMm) {
  const base = thermalCharWidth(widthMm);
  const n = Number(widthMm);
  const inset = !Number.isFinite(n) || n <= 0
    ? 4
    : n <= 58
      ? 2
      : n <= 75
        ? 4
        : 3;
  return Math.max(24, base - inset);
}

/** Separador punteado insetado (sin `|` ni caracteres raros en bordes). */
export function insetSeparator(widthMm) {
  const full = thermalCharWidth(widthMm);
  const inner = thermalInnerWidth(widthMm);
  const pad = full - inner;
  const left = Math.floor(pad / 2);
  const right = pad - left;
  return `${' '.repeat(left)}${'-'.repeat(inner)}${' '.repeat(right)}`;
}

/** Etiqueta legible para ticket térmico. */
export function paymentMethodDisplayLabel(method) {
  const m = String(method || '').toLowerCase().trim();
  const map = {
    efectivo: 'Efectivo',
    tarjeta: 'Tarjeta',
    yape: 'Yape',
    plin: 'Plin',
    transferencia: 'Transferencia',
    online: 'Online',
    otro: 'Otro',
  };
  return map[m] || (m ? m.charAt(0).toUpperCase() + m.slice(1) : '—');
}

/** Alinea `izq` y `der` en una sola línea de ancho fijo. */
export function padLeftRight(left, right, width) {
  const w = Math.max(8, Number(width) || defaultThermalPrintWidthChars());
  const L = String(left ?? '');
  const R = String(right ?? '');
  const space = w - L.length - R.length;
  if (space >= 1) return `${L}${' '.repeat(space)}${R}`;
  const minGap = 1;
  /** Cabe la derecha completa: recortar solo la izquierda (evita «ra:» al comer el inicio de «Hora:»). */
  if (R.length + minGap <= w) {
    const maxL = w - R.length - minGap;
    const leftShown = L.length <= maxL ? L : L.slice(0, Math.max(0, maxL));
    const gap = w - leftShown.length - R.length;
    return `${leftShown}${' '.repeat(Math.max(minGap, gap))}${R}`;
  }
  /** Cabe la izquierda completa: recortar la derecha por el final (mantiene etiquetas al inicio). */
  if (L.length + minGap <= w) {
    const maxR = w - L.length - minGap;
    const rightShown = R.length <= maxR ? R : R.slice(0, Math.max(0, maxR));
    const gap = w - L.length - rightShown.length;
    return `${L}${' '.repeat(Math.max(minGap, gap))}${rightShown}`;
  }
  const maxL = Math.max(1, Math.floor((w - minGap) / 2));
  const maxR = w - minGap - maxL;
  const lShown = L.slice(0, maxL);
  const rShown = R.slice(0, maxR);
  const gap = w - lShown.length - rShown.length;
  return `${lShown}${' '.repeat(Math.max(minGap, gap))}${rShown}`;
}

/**
 * Fecha y hora: una línea si cabe; si no, dos (50 mm / ancho reducido sin cortar «Hora:»).
 */
export function pushThermalFechaHoraPair(lines, printedAt, widthMm) {
  const w = thermalCharWidth(widthMm);
  const { date, time } = formatPeDateTimeParts(printedAt);
  const left = `Fecha: ${date}`;
  const right = `Hora: ${time}`;
  if (left.length + 1 + right.length <= w) {
    lines.push(padLeftRight(left, right, w));
    return;
  }
  lines.push(padLeftRight(left, '', w));
  lines.push(padLeftRight(right, '', w));
}

export function centerThermalLine(text, width) {
  const w = Math.max(8, Number(width) || defaultThermalPrintWidthChars());
  const s = String(text || '').trim();
  if (!s) return ' '.repeat(w);
  const core = s.length > w ? s.slice(0, w) : s;
  if (core.length >= w) return core.slice(0, w);
  const pad = w - core.length;
  const left = Math.floor(pad / 2);
  const right = pad - left;
  return `${' '.repeat(left)}${core}${' '.repeat(right)}`;
}

/** Quita pies que no deben imprimirse (p. ej. «Modulo: caja»). */
export function stripThermalDebugFooter(text) {
  let s = String(text || '')
    .normalize('NFKC')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    /** Solo final: `.trim()` comía espacios del inicio de la 1.ª línea y descentraba nombre/cabecera. */
    .trimEnd();
  s = s.replace(/\s*m[oó]dulo\s*:\s*[a-záéíóúñ0-9_-]+\b/gi, '');
  s = s.replace(/\n\d{1,2}\/\d{1,2}\/\d{4},\s*\d{1,2}:\d{2}:\d{2}\s*[ap]\.?\s*m\.?\s*$/i, '');
  return s
    .split('\n')
    .map((line) => line.replace(/\uFEFF/g, '').trimEnd())
    .filter((line) => {
      const t = String(line || '').trim();
      if (!t) return true;
      if (/^m[oó]dulo\b/i.test(t)) return false;
      if (/^module\s*:/i.test(t)) return false;
      return true;
    })
    .join('\n');
}

function moneyAmountStr(formatted) {
  return String(formatted || '')
    .replace(/^\s*S\/?\s*/i, '')
    .trim();
}

/**
 * Marca principal del ticket: «Nombre del Restaurante» (Mi empresa),
 * si no hay, nombre comercial de facturación.
 */
export function restaurantDisplayNameUpper(restaurant = {}) {
  const r = restaurant || {};
  const name = String(r.name || '').trim()
    || String(r.billing_nombre_comercial || '').trim()
    || '';
  return name ? name.toUpperCase() : '';
}

function columnProductDims(contentW) {
  const inner = Math.max(16, Number(contentW) || 32);
  const qW = 4;
  /** Presupuesto sin espacios entre columnas (`rowProduct4Col` concatena; más ancho para nombre). */
  const fixed = qW;
  let uW = inner <= 32 ? 6 : 6;
  let tW = inner <= 32 ? 6 : 7;
  let nameW = inner - fixed - uW - tW;
  if (nameW < 8) {
    nameW = 8;
    const rem2 = inner - nameW - fixed;
    tW = Math.min(8, Math.max(4, Math.ceil(rem2 / 2)));
    uW = rem2 - tW;
    if (uW < 4) {
      uW = 4;
      tW = Math.max(4, rem2 - uW);
    }
    if (tW < 4) {
      tW = 4;
      uW = Math.max(4, rem2 - tW);
    }
  }
  nameW = Math.max(4, inner - fixed - uW - tW);
  return { nameW, qW, uW, tW, w: inner };
}

function rowProduct4Col(name, qty, uStr, tStr, dims) {
  const { nameW, qW, uW, tW, w } = dims;
  const a = String(name).slice(0, nameW).padEnd(nameW);
  const b = String(qty).slice(0, qW).padStart(qW);
  const c = String(uStr).slice(0, uW).padStart(uW);
  const d = String(tStr).slice(0, tW).padStart(tW);
  const row = `${a}${b}${c}${d}`;
  return row.length <= w ? row : row.slice(0, w);
}

export function pushProductTableSection(lines, groupedRows, formatCurrencyFn, widthMm) {
  const inner = thermalInnerWidth(widthMm);
  const dims = columnProductDims(inner);
  const { nameW, uW, tW } = dims;
  const sep = insetSeparator(widthMm);
  const full = thermalCharWidth(widthMm);

  const padRow = (rowInner) => {
    const r = String(rowInner || '').slice(0, inner);
    const pad = full - inner;
    const L = Math.floor(pad / 2);
    const R = pad - L;
    return `${' '.repeat(L)}${r.padEnd(inner)}${' '.repeat(R)}`.slice(0, full);
  };

  lines.push(padRow('PRODUCTOS'));
  lines.push(sep);
  const h0 = inner <= 30 ? 'Prod.' : 'Producto';
  const h1 = 'Cant';
  const h2 = uW >= 8 ? 'P. unit.' : uW >= 7 ? 'P.unit' : 'P.u.';
  const h3 = tW >= 5 ? 'Total' : 'Tot.';
  lines.push(padRow(rowProduct4Col(h0, h1, h2, h3, dims)));
  lines.push(sep);

  for (const g of groupedRows || []) {
    const qty = Number(g.qty || 0);
    const nm = String(g.name || '').trim() || '—';
    const unit = g.unitPrice != null ? Number(g.unitPrice) : qty > 0 ? Number(g.subtotal || 0) / qty : 0;
    const sub = Number(g.subtotal != null ? g.subtotal : unit * qty);
    const uStr = moneyAmountStr(formatCurrencyFn(unit));
    const tStr = moneyAmountStr(formatCurrencyFn(sub));
    const segs = wrapThermalLine(nm, nameW);
    segs.forEach((seg, i) => {
      if (i === 0) {
        lines.push(padRow(rowProduct4Col(seg, qty, uStr, tStr, dims)));
      } else {
        lines.push(padRow(rowProduct4Col(seg, '', '', '', dims)));
      }
    });
  }
}

/** Líneas de cabecera: Mi Restaurante (información) + emisor SUNAT si existe (GET /restaurant). */
export function buildRestaurantTicketHeaderLines(restaurant = {}, widthMm = 80) {
  const w = thermalCharWidth(widthMm);
  const inner = thermalInnerWidth(widthMm);
  const r = restaurant || {};
  const brand =
    String(r.billing_nombre_comercial || '').trim()
    || String(r.name || '').trim()
    || 'RESTAURANTE';
  const legal = String(r.legal_name || '').trim();
  const ruc = String(r.company_ruc || '').trim();
  const addr =
    String(r.billing_emisor_direccion || '').trim()
    || String(r.address || '').trim();
  const phone = String(r.phone || '').trim();
  const email = String(r.email || '').trim();
  const lines = [];
  lines.push(centerThermalLine(brand.toUpperCase(), w));
  if (legal) {
    for (const seg of wrapThermalLine(`Razon social: ${legal}`, inner)) lines.push(centerThermalLine(seg, w));
  }
  if (ruc) lines.push(centerThermalLine(`RUC: ${ruc}`.slice(0, inner), w));
  if (addr) {
    for (const seg of wrapThermalLine(addr, inner)) lines.push(centerThermalLine(seg, w));
  }
  if (phone) {
    for (const seg of wrapThermalLine(`Tel: ${phone}`, inner)) lines.push(centerThermalLine(seg, w));
  }
  if (email) {
    for (const seg of wrapThermalLine(`Correo: ${email}`, inner)) lines.push(centerThermalLine(seg, w));
  }
  lines.push(insetSeparator(widthMm));
  return lines;
}

function wrapThermalLine(text, maxLen) {
  const t = String(text || '').trim();
  if (!t) return [];
  if (t.length <= maxLen) return [t];
  const words = t.split(/\s+/);
  const out = [];
  let cur = '';
  for (const w of words) {
    const piece = cur ? `${cur} ${w}` : w;
    if (piece.length <= maxLen) {
      cur = piece;
      continue;
    }
    if (cur) out.push(cur);
    if (w.length <= maxLen) {
      cur = w;
      continue;
    }
    for (let i = 0; i < w.length; i += maxLen) {
      out.push(w.slice(i, i + maxLen));
    }
    cur = '';
  }
  if (cur) out.push(cur);
  return out;
}

function isCuentaClienteSelfOrder(order) {
  return String(order?.table_number || '') === 'Cliente' && String(order?.customer_id || '').trim() !== '';
}

/**
 * Comanda mínima (reimpresión desde cocina/bar): ubicación, fecha/hora de impresión,
 * «PARA LLEVAR» si aplica (debajo de esa fecha), ítems. Sin nombre del restaurante ni totales.
 */
function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function buildSimpleComandaPlainText(order, printedAt = new Date(), widthMm = 80) {
  const { clip, itemLine } = thermalPaperMetrics(widthMm);
  const lines = [];
  const when = printedAt.toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' });
  if (isCuentaClienteSelfOrder(order)) {
    for (const seg of wrapThermalLine(`CLIENTE: ${String(order.customer_name || 'Cliente').trim().toUpperCase()}`, clip)) {
      lines.push(seg);
    }
  } else if (order.type === 'delivery') {
    lines.push('DELIVERY');
  } else if (order.type === 'pickup') {
    lines.push('RECOJO');
  } else {
    const m = order.table_number ? String(order.table_number).trim().toUpperCase() : '';
    lines.push(m ? `MESA ${m}` : 'MESA —');
  }
  lines.push(when);
  if (orderHasTakeoutNote(order)) {
    lines.push(KITCHEN_TAKEOUT_NOTE);
  }
  lines.push('--------------------------------');
  for (const it of order.items || []) {
    const q = Number(it.quantity || 0);
    const nm = String(it.product_name || '').trim() || '—';
    const v = String(it.variant_name || '').trim();
    const raw = `${q}x ${nm}${v ? ` (${v})` : ''}`;
    for (const seg of wrapThermalLine(raw, itemLine)) {
      lines.push(seg);
    }
  }
  return lines.join('\n');
}

/**
 * Misma comanda mínima que {@link buildSimpleComandaPlainText}, en HTML para impresión por navegador:
 * cabecera (mesa / delivery / …) centrada y en mayúsculas, cuerpo con tipografía más grande.
 */
export function buildSimpleComandaPrintHtml(order, printedAt = new Date()) {
  const when = printedAt.toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' });
  const itemsHtml = (order.items || [])
    .map((it) => {
      const q = Number(it.quantity || 0);
      const nm = escHtml(String(it.product_name || '').trim() || '—');
      const v = String(it.variant_name || '').trim();
      const vpart = v ? ` (${escHtml(v)})` : '';
      return `<div class="comanda-item">${q}x ${nm}${vpart}</div>`;
    })
    .join('');
  let top = '';
  if (isCuentaClienteSelfOrder(order)) {
    top = `<div class="comanda-top">CLIENTE: ${escHtml(String(order.customer_name || 'Cliente').trim())}</div>`;
  } else if (order.type === 'delivery') {
    top = '<div class="comanda-top">DELIVERY</div>';
  } else if (order.type === 'pickup') {
    top = '<div class="comanda-top">RECOJO</div>';
  } else {
    const m = order.table_number ? String(order.table_number).trim() : '';
    top = `<div class="comanda-top">${m ? `MESA ${escHtml(m.toUpperCase())}` : 'MESA —'}</div>`;
  }
  const paraLlevar = orderHasTakeoutNote(order)
    ? `<div class="comanda-pl">${KITCHEN_TAKEOUT_NOTE}</div>`
    : '';
  return `${top}
    <div class="comanda-fecha">${escHtml(when)}</div>
    ${paraLlevar}
    <div class="comanda-sep">--------------------------------</div>
    ${itemsHtml}`;
}

export function buildKitchenTicketPlainText({
  restaurant = {},
  title = '',
  orders = [],
  copies = 1,
  widthMm = 80,
}) {
  const { clip: clipMax, itemLine, phoneClip } = thermalPaperMetrics(widthMm);
  const clip = (s, n) => String(s || '').slice(0, n ?? clipMax);
  const lines = [];
  lines.push('================================');
  lines.push(clip(restaurant.name || 'Restaurante'));
  if (restaurant.address) lines.push(clip(restaurant.address));
  if (restaurant.phone) lines.push(`Tel: ${clip(restaurant.phone, phoneClip)}`);
  lines.push('--------------------------------');
  lines.push(clip(title));
  lines.push(new Date().toLocaleString('es-PE'));
  lines.push('================================');
  lines.push('');
  (orders || []).forEach((order) => {
    const orderTypeLabel =
      order.type === 'delivery' ? 'Delivery' : order.type === 'pickup' ? 'Recojo' : 'Mesa/Salon';
    if (isCuentaClienteSelfOrder(order)) {
      lines.push(clip(order.customer_name || 'Cliente', clipMax));
      lines.push(`#${order.order_number} ${orderTypeLabel}`);
    } else if (order.type === 'delivery') {
      lines.push('Delivery');
    } else {
      const tbl = order.table_number
        ? ` MESA ${String(order.table_number).trim().toUpperCase()}`
        : '';
      lines.push(`#${order.order_number} ${orderTypeLabel}${tbl}`);
    }
    const fechaPedido = formatDateTime(order.updated_at || order.created_at);
    if (fechaPedido) lines.push(fechaPedido);
    if (orderHasTakeoutNote(order)) {
      lines.push(KITCHEN_TAKEOUT_NOTE);
    }
    (order.items || []).forEach((item) => {
      let line = ` ${item.quantity}x ${item.product_name || ''}`;
      if (item.variant_name) line += ` (${item.variant_name})`;
      if (item.notes) line += ` - ${item.notes}`;
      for (const seg of wrapThermalLine(line.trim(), itemLine)) {
        lines.push(seg);
      }
    });
    lines.push('');
    lines.push('--------------------------------');
  });
  lines.push('');
  lines.push('');
  const nc = Math.min(5, Math.max(1, Number(copies || 1)));
  const blocks = [];
  for (let c = 0; c < nc; c += 1) {
    if (nc > 1) blocks.push(`--- Copia ${c + 1} de ${nc} ---`);
    blocks.push(...lines);
  }
  return blocks.join('\n');
}

/** Marca en mayúsculas para banner térmico / payload GDI (debe coincidir con la 1.ª línea centrada del ticket). */
export function restaurantThermalBrandLine(restaurant = {}) {
  const tradeRaw = String(
    restaurant?.billing_nombre_comercial || restaurant?.name || '',
  )
    .trim()
    .replace(/^@+\s*/u, '');
  return tradeRaw ? tradeRaw.toUpperCase() : '';
}

/** Pie y promos configurados en Mi Restaurante → Tickets. */
function appendConfiguredTicketFooter(lines, restaurant, widthMm, { includePromo = true } = {}) {
  const w = thermalCharWidth(widthMm);
  const inner = thermalInnerWidth(widthMm);
  const sep = insetSeparator(widthMm);
  const ticketCfg = restaurant?.profile?.ticket || {};
  const footerMsg =
    String(ticketCfg.footer_message || ticketCfg.custom_footer || '').trim()
    || String(restaurant?.profile?.messages?.ticket || '').trim()
    || 'GRACIAS POR SU PREFERENCIA';
  for (const seg of wrapThermalLine(footerMsg, inner)) {
    lines.push(centerThermalLine(seg, w));
  }
  if (includePromo) {
    const promo = String(ticketCfg.promo_message || '').trim();
    if (promo) {
      lines.push(sep);
      for (const seg of wrapThermalLine(promo, inner)) lines.push(centerThermalLine(seg, w));
    }
  }
}

/** Texto plano para precuenta de caja. */
/** Precuenta: «PARA LLEVAR» no se imprime aquí (solo en comanda cocina/bar). */
export function buildPrecuentaPlainText({
  restaurant = {},
  tableName = '',
  mozoName = '',
  customerLines = [],
  groupedRows = [],
  formatCurrencyFn = (n) => String(n),
  subtotal = 0,
  discount = 0,
  payableTotal = 0,
  widthMm = 80,
  printedAt = new Date(),
}) {
  const w = thermalCharWidth(widthMm);
  const inner = thermalInnerWidth(widthMm);
  const sep = insetSeparator(widthMm);
  const lines = [];
  /** Cabecera: nombre centrado; logo lo añade el servidor (caja) o GDI en Electron con `logoUrl`. */
  const trade = restaurantThermalBrandLine(restaurant);
  if (trade) {
    lines.push(centerThermalLine(trade, w));
    const addr =
      String(restaurant?.billing_emisor_direccion || '').trim()
      || String(restaurant?.address || '').trim();
    const phone = String(restaurant?.phone || '').trim();
    if (addr) {
      for (const seg of wrapThermalLine(addr, inner)) lines.push(centerThermalLine(seg, w));
    }
    if (phone) {
      for (const seg of wrapThermalLine(`Tel: ${phone}`, inner)) lines.push(centerThermalLine(seg, w));
    }
    lines.push(sep);
  }
  lines.push(centerThermalLine('PRE CUENTA', w));
  pushThermalFechaHoraPair(lines, printedAt, widthMm);
  const mesaLbl = tableName ? `Mesa: ${tableName}` : 'Mesa: —';
  const mozoLbl = mozoName ? `Mozo: ${mozoName}` : 'Mozo: —';
  lines.push(padLeftRight(mesaLbl, mozoLbl, w));
  for (const l of customerLines) {
    if (l) lines.push(centerThermalLine(String(l).slice(0, inner), w));
  }
  lines.push(sep);
  pushProductTableSection(lines, groupedRows, formatCurrencyFn, widthMm);
  lines.push(sep);
  lines.push(padLeftRight('Subtotal:', formatCurrencyFn(subtotal), w));
  if (Number(discount) > 0.001) {
    lines.push(padLeftRight('Descuento:', formatCurrencyFn(discount), w));
  }
  lines.push(padLeftRight('TOTAL A PAGAR:', formatCurrencyFn(payableTotal), w));
  lines.push(sep);
  appendConfiguredTicketFooter(lines, restaurant, widthMm);
  lines.push('');
  return stripThermalDebugFooter(lines.join('\n'));
}

/** Texto plano para nota de venta. */
export function buildNotaVentaPlainText({
  restaurant = {},
  docLine = '',
  tableName = '',
  customerLines = [],
  groupedRows = [],
  formatCurrencyFn = (n) => String(n),
  subtotal = null,
  total = 0,
  discount = 0,
  widthMm = 80,
  printedAt = new Date(),
  paymentMethod = 'efectivo',
}) {
  const w = thermalCharWidth(widthMm);
  const inner = thermalInnerWidth(widthMm);
  const sep = insetSeparator(widthMm);
  const lines = [];
  lines.push(...buildRestaurantTicketHeaderLines(restaurant, widthMm));
  lines.push(centerThermalLine('NOTA DE VENTA', w));
  const numLine = docLine ? `Nº ${docLine}` : 'Nº —';
  pushThermalFechaHoraPair(lines, printedAt, widthMm);
  lines.push(centerThermalLine(numLine, w));
  if (tableName) lines.push(centerThermalLine(`Mesa: ${String(tableName).slice(0, inner)}`, w));

  lines.push(centerThermalLine('DATOS DEL CLIENTE', w));
  if ((customerLines || []).filter(Boolean).length === 0) {
    lines.push(centerThermalLine('Nombre: (—)', w));
  } else {
    for (const l of customerLines) {
      if (l) {
        for (const seg of wrapThermalLine(String(l), inner)) lines.push(centerThermalLine(seg, w));
      }
    }
  }

  /** ASCII: muchas térmicas en raw no interpretan UTF-8 (p. ej. 'Método' → 'Mtdo'). */
  lines.push(padLeftRight('Metodo de pago:', paymentMethodDisplayLabel(paymentMethod), w));

  lines.push(sep);
  pushProductTableSection(lines, groupedRows, formatCurrencyFn, widthMm);
  lines.push(sep);
  const sumLines = (groupedRows || []).reduce((s, g) => s + Number(g.subtotal != null ? g.subtotal : 0), 0);
  const sub = subtotal != null ? Number(subtotal) : sumLines;
  lines.push(padLeftRight('Subtotal:', formatCurrencyFn(sub), w));
  if (Number(discount) > 0.001) {
    lines.push(padLeftRight('Descuento:', formatCurrencyFn(discount), w));
  }
  lines.push(padLeftRight('TOTAL:', formatCurrencyFn(total), w));
  lines.push(sep);
  appendConfiguredTicketFooter(lines, restaurant, widthMm);
  lines.push('');
  return stripThermalDebugFooter(lines.join('\n'));
}

/**
 * Representación impresa boleta/factura SUNAT (térmica; el PDF legal sigue en el servidor).
 */
export function buildBoletaFacturaPlainText({
  restaurant = {},
  doc = {},
  groupedRows = [],
  formatCurrencyFn = (n) => String(n),
  subtotal = 0,
  tax = 0,
  total = 0,
  discount = 0,
  customer = {},
  widthMm = 80,
  printedAt = new Date(),
  paymentMethod = 'efectivo',
}) {
  const w = thermalCharWidth(widthMm);
  const inner = thermalInnerWidth(widthMm);
  const sep = insetSeparator(widthMm);
  const docType = String(doc?.doc_type || '').toLowerCase();
  const title =
    docType === 'factura' ? 'FACTURA ELECTRÓNICA' : 'BOLETA DE VENTA ELECTRÓNICA';
  const fullNum = String(doc?.full_number || '').trim() || '—';
  const sunatLine = String(doc?.sunat_description || doc?.provider_message || '').trim();
  const lines = [];
  lines.push(...buildRestaurantTicketHeaderLines(restaurant, widthMm));
  lines.push(centerThermalLine(title, w));
  pushThermalFechaHoraPair(lines, printedAt, widthMm);
  lines.push(centerThermalLine(`Nº ${fullNum}`, w));
  if (String(doc?.hash_code || '').trim()) {
    lines.push(centerThermalLine(`Hash: ${String(doc.hash_code).slice(0, inner)}`, w));
  }
  const cName = String(customer?.name || '').trim();
  const cDoc = String(customer?.doc_number || '').trim();
  if (cName || cDoc) {
    lines.push(centerThermalLine('DATOS DEL CLIENTE', w));
    if (cName) {
      for (const seg of wrapThermalLine(`Nombre: ${cName}`, inner)) lines.push(centerThermalLine(seg, w));
    }
    if (cDoc) lines.push(centerThermalLine(`Doc: ${cDoc}`, w));
  }
  /** ASCII: muchas térmicas en raw no interpretan UTF-8 (p. ej. 'Método' → 'Mtdo'). */
  lines.push(padLeftRight('Metodo de pago:', paymentMethodDisplayLabel(paymentMethod), w));
  lines.push(sep);
  pushProductTableSection(lines, groupedRows, formatCurrencyFn, widthMm);
  lines.push(sep);
  const st = Number(subtotal) || 0;
  const igv = Number(tax) || 0;
  const to = Number(total) || 0;
  const disc = Number(discount) || 0;
  lines.push(padLeftRight('Op. gravadas:', formatCurrencyFn(st), w));
  if (igv > 0.001) lines.push(padLeftRight('IGV:', formatCurrencyFn(igv), w));
  if (disc > 0.001) lines.push(padLeftRight('Descuento:', formatCurrencyFn(disc), w));
  lines.push(padLeftRight('IMPORTE TOTAL:', formatCurrencyFn(to), w));
  if (sunatLine) {
    for (const seg of wrapThermalLine(sunatLine, inner)) lines.push(centerThermalLine(seg, w));
  } else {
    lines.push(centerThermalLine('Estado: aceptada (ver PDF/XML en sistema)', w));
  }
  lines.push(sep);
  lines.push(centerThermalLine('Representacion impresa. Conserve su comprobante.', w));
  appendConfiguredTicketFooter(lines, restaurant, widthMm, { includePromo: false });
  lines.push('');
  return stripThermalDebugFooter(lines.join('\n'));
}

/** Convierte una línea del carrito de mozo/caja en ítem para {@link buildPedidoMesaTicketPlainText}. */
export function enrichCartLineForKitchenItem(line, productsById, modifiersByIdMap = new Map()) {
  const p = productsById.get(line.product_id) || {};
  const mid = String(line.modifier_id || '').trim();
  const modName = mid ? String(modifiersByIdMap.get(mid)?.name || '').trim() : '';
  const bits = [];
  if (String(line.notes || '').trim()) bits.push(String(line.notes).trim());
  if (line.modifier_option) {
    bits.push(modName ? `${modName}: ${line.modifier_option}` : String(line.modifier_option));
  }
  return {
    product_name: String(line.name || p.name || '').trim() || '—',
    variant_name: String(line.variant_name || '').trim(),
    quantity: Number(line.quantity || 1),
    notes: bits.join(' | '),
    modifier_option: '',
  };
}

/**
 * Comanda cocina/bar: título mesa (mayúsculas), fecha|hora, PEDIDO + «PARA LLEVAR» a la derecha si aplica, ítems.
 */
export function buildPedidoMesaTicketPlainText({
  tableLabel = '',
  orderNumber = '',
  takeout = false,
  waiterName = '',
  items = [],
  widthMm = 75,
  printedAt = new Date(),
  orderType = 'dine_in',
}) {
  const w = thermalCharWidth(widthMm);
  const inner = thermalInnerWidth(widthMm);
  const sep = insetSeparator(widthMm);
  const lines = [];

  let title = 'MESA';
  if (orderType === 'delivery') title = 'DELIVERY';
  else if (orderType === 'pickup') title = 'RECOJO';
  else {
    const label = String(tableLabel || '').trim();
    const raw = label.replace(/^mesa\s*/i, '').trim();
    if (label && !/^mesa\b/i.test(label) && !/^\d+$/.test(label)) {
      title = label.toUpperCase();
    } else {
      const num = raw || String(orderNumber != null ? orderNumber : '').trim();
      title = num ? `MESA ${num}`.toUpperCase() : 'MESA';
    }
  }

  lines.push(centerThermalLine(title, w));
  pushThermalFechaHoraPair(lines, printedAt, widthMm);
  lines.push(sep);
  lines.push(padLeftRight('PEDIDO', takeout ? 'PARA LLEVAR' : '', w));
  if (orderNumber !== '' && orderNumber != null) {
    lines.push(padLeftRight('Nro:', `#${orderNumber}`, w));
  }
  lines.push(sep);

  const nameW = Math.max(12, inner - 6);
  for (const it of items || []) {
    const q = Number(it.quantity || it.qty || 0) || 1;
    const nm = String(it.product_name || it.name || '—').trim() || '—';
    const v = String(it.variant_name || '').trim();
    const lead = `${q}x`;
    const titleLine = v ? `${lead} ${nm} (${v})` : `${lead} ${nm}`;
    for (const seg of wrapThermalLine(titleLine, inner)) {
      lines.push(centerThermalLine(seg, w));
    }

    const noteBits = [];
    const rawNotes = String(it.notes || '').trim();
    if (rawNotes) {
      rawNotes
        .split(' | ')
        .map((x) => x.trim())
        .filter(Boolean)
        .forEach((p) => noteBits.push(p));
    }
    const modOpt = String(it.modifier_option || '').trim();
    if (modOpt) noteBits.push(`Mod: ${modOpt}`);
    if (noteBits.length) {
      for (const b of noteBits) {
        for (const seg of wrapThermalLine(`· ${b}`, nameW)) {
          lines.push(centerThermalLine(`  ${seg}`, w));
        }
      }
    }
  }
  lines.push(sep);
  lines.push('');
  return lines.join('\n');
}

function orderLinesSummaryShort(order) {
  const items = order?.items || [];
  if (!items.length) return `Pedido #${order?.order_number ?? '—'}`;
  return items.map((it) => `${it.quantity}× ${it.product_name}`).join(', ');
}

/** Reporte de entregas completadas del día (panel delivery). */
export function buildDeliveryReportPlainText({
  dateLabel = '',
  driverName = '',
  orders = [],
  formatCurrencyFn = (n) => String(n),
}) {
  const lines = [];
  lines.push('================================');
  lines.push('REPORTE DELIVERY');
  lines.push(`Fecha: ${String(dateLabel).slice(0, 42)}`);
  if (driverName) lines.push(`Repartidor: ${String(driverName).slice(0, 42)}`);
  lines.push('--------------------------------');
  let sum = 0;
  for (const o of orders || []) {
    sum += Number(o.total || 0);
    const mod = labelDeliveryPaymentModality(o.delivery_payment_modality) || '—';
    lines.push(`#${o.order_number} ${String(o.customer_name || '—').slice(0, 28)}`);
    lines.push(`  ${orderLinesSummaryShort(o).slice(0, 42)}`);
    lines.push(`  ${mod} · ${formatCurrencyFn(o.total || 0)}`);
  }
  lines.push('--------------------------------');
  lines.push(`TOTAL: ${formatCurrencyFn(sum)}`);
  lines.push('');
  return lines.join('\n');
}
