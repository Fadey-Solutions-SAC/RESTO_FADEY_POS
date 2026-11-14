/**
 * Texto plano comanda cocina/bar (misma estructura que el cliente).
 * Duplicado mínimo en CommonJS para impresión automática en el servidor Node.
 */

const KITCHEN_TAKEOUT_NOTE = 'PARA LLEVAR';
const thermalLayout = require('./thermalPrintLayout.json');
const { thermalEffectiveCharsPerLine } = require('./thermalMagnify');

function thermalCharWidth(widthMm) {
  return thermalEffectiveCharsPerLine(widthMm, { viaNetwork: true });
}

function thermalInnerWidth(widthMm) {
  const base = thermalCharWidth(widthMm);
  const n = Number(widthMm);
  const inset = !Number.isFinite(n) || n <= 0
    ? 4
    : n <= 58
      ? 2
      : n <= 75
        ? 4
        : 5;
  return Math.max(24, base - inset);
}

function insetSeparator(widthMm) {
  const full = thermalCharWidth(widthMm);
  const inner = thermalInnerWidth(widthMm);
  const pad = full - inner;
  const left = Math.floor(pad / 2);
  const right = pad - left;
  return `${' '.repeat(left)}${'-'.repeat(inner)}${' '.repeat(right)}`;
}

function padLeftRight(left, right, width) {
  const fallback = Number(thermalLayout.charsPerLine['80']) || 48;
  const w = Math.max(8, Number(width) || fallback);
  const L = String(left ?? '');
  const R = String(right ?? '');
  const space = w - L.length - R.length;
  if (space >= 1) return `${L}${' '.repeat(space)}${R}`;
  const maxR = Math.min(R.length, Math.floor(w / 2));
  const maxL = w - maxR - 1;
  return `${L.slice(0, maxL)} ${R.slice(R.length - maxR)}`;
}

function centerThermalLine(text, width) {
  const fallback = Number(thermalLayout.charsPerLine['80']) || 48;
  const w = Math.max(8, Number(width) || fallback);
  const s = String(text || '').trim();
  if (!s) return ' '.repeat(w);
  const core = s.length > w ? s.slice(0, w) : s;
  if (core.length >= w) return core.slice(0, w);
  const pad = w - core.length;
  const left = Math.floor(pad / 2);
  const right = pad - left;
  return `${' '.repeat(left)}${core}${' '.repeat(right)}`;
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

function orderHasTakeoutNote(order) {
  return String(order?.notes || '').toUpperCase().includes(KITCHEN_TAKEOUT_NOTE);
}

function peParts(d) {
  const date = d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = d.toLocaleTimeString('es-PE', { hour: 'numeric', minute: '2-digit', hour12: true });
  return { date, time };
}

/**
 * @param {object} order
 * @param {object[]} items — ítems ya filtrados (cocina o bar)
 * @param {number} widthMm
 */
function buildPedidoMesaTicketPlainTextServer(order, items, widthMm = 75) {
  const w = thermalCharWidth(widthMm);
  const inner = thermalInnerWidth(widthMm);
  const sep = insetSeparator(widthMm);
  const lines = [];
  const printedAt = new Date();
  const orderType = String(order?.type || 'dine_in').toLowerCase();
  const takeout = orderHasTakeoutNote(order);

  let title = 'MESA';
  if (orderType === 'delivery') title = 'DELIVERY';
  else if (orderType === 'pickup') title = 'RECOJO';
  else {
    const raw = String(order?.table_number || '').replace(/^mesa\s*/i, '').trim();
    const num = raw || String(order?.order_number ?? '').trim();
    title = num ? `MESA ${num}`.toUpperCase() : 'MESA';
  }

  lines.push(centerThermalLine(title, w));
  const guest = String(order?.ticket_guest_name || '').trim();
  if (guest) {
    for (const seg of wrapThermalLine(`Nombre: ${guest}`, inner)) {
      lines.push(centerThermalLine(seg, w));
    }
  }
  const { date, time } = peParts(printedAt);
  lines.push(padLeftRight(`Fecha: ${date}`, `Hora: ${time}`, w));
  lines.push(sep);
  lines.push(padLeftRight('PEDIDO', takeout ? 'PARA LLEVAR' : '', w));
  if (order?.order_number != null && order?.order_number !== '') {
    lines.push(padLeftRight('Pedido', `#${order.order_number}`, w));
  }
  lines.push(sep);

  const nameW = Math.max(12, inner - 6);
  for (const it of items || []) {
    const q = Number(it.quantity || it.qty || 0) || 1;
    const nm = String(it.product_name || it.name || '—').trim() || '—';
    const v = String(it.variant_name || '').trim();
    const lead = `${q}x`;
    const titleLine = v ? `${lead} ${nm} (${v})` : `${lead} ${nm}`;
    for (const seg of wrapThermalLine(titleLine, inner)) lines.push(centerThermalLine(seg, w));
    const noteBits = [];
    const rawNotes = String(it.notes || '').trim();
    if (rawNotes) {
      rawNotes.split(' | ').map((x) => x.trim()).filter(Boolean).forEach((p) => noteBits.push(p));
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

module.exports = { buildPedidoMesaTicketPlainTextServer };
