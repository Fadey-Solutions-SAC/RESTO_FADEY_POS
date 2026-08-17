import { buildFixedWidthTable } from './fixedWidthTxt';
import { buildStyledInformeExcelHtml, formatSolesExcel } from './informeExcelHtml';
import {
  formatSaleNumber,
  clienteOMesaLabel,
  parseAdjustmentReason,
  adjustmentReferenceAmount,
} from './mesaOrderLines';

function kindLabel(kind) {
  if (kind === 'cortesia') return 'Cortesia';
  if (kind === 'descuento') return 'Descuento';
  if (kind === 'eliminado') return 'Eliminado';
  return kind || '—';
}

function motivesSummary(group) {
  const parts = (group.occurrences || []).map((occ) => {
    const base = String(occ.reason || '').trim() || 'Sin motivo';
    return `${occ.quantity}x: ${base}`;
  });
  return parts.join(' | ');
}

function rowReason(o) {
  if (o?.adjustment_kind === 'eliminado') {
    return String(o.adjustment_reason || o.removal_reason || '').trim() || 'Sin motivo registrado';
  }
  return parseAdjustmentReason(o) || String(o?.adjustment_reason || '').trim() || 'Sin motivo registrado';
}

function recordAmount(o) {
  if (o?.adjustment_kind === 'eliminado') {
    return Number(o.reference_amount ?? o.discount_amount ?? 0);
  }
  return adjustmentReferenceAmount(o);
}

function rowFechaSort(o) {
  const raw = o?.row_source === 'product_removal'
    ? (o.created_at || o.updated_at)
    : (o.paid_at || o.created_at || o.updated_at);
  const t = new Date(raw || 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

export function mapDescuentosInformeRows(orders, formatDate) {
  const fmt = typeof formatDate === 'function' ? formatDate : (v) => String(v || '');
  return (orders || [])
    .filter((o) => o.adjustment_kind === 'descuento')
    .map((o) => {
      const fechaRaw = o.paid_at || o.created_at || o.updated_at;
      return {
        id: o.id,
        fecha: fmt(fechaRaw),
        sortTime: rowFechaSort(o),
        nVenta: formatSaleNumber(o.order_number),
        cliente: clienteOMesaLabel(o),
        motivo: rowReason(o),
        usuario: String(o.created_by_user_name || '').trim() || '—',
        monto: recordAmount(o),
        record: o,
      };
    })
    .sort((a, b) => {
      if (a.sortTime !== b.sortTime) return a.sortTime - b.sortTime;
      return String(a.nVenta).localeCompare(String(b.nVenta), 'es');
    });
}

const DESCUENTOS_HEADERS = [
  { label: 'Fecha', width: 90 },
  { label: 'N.º Venta', width: 90 },
  { label: 'Cliente', width: 140 },
  { label: 'Motivo', width: 220 },
  { label: 'Usuario', width: 120 },
  { label: 'Monto', width: 100 },
];

export function buildDescuentosExcelHtml({ fromDate, toDate, orders, formatDate, formatDateKey, usuario } = {}) {
  const period = [formatDateKey?.(fromDate) || fromDate, formatDateKey?.(toDate) || toDate]
    .filter(Boolean)
    .join(' - ') || '—';
  const mapped = mapDescuentosInformeRows(orders, formatDate);
  const total = mapped.reduce((s, r) => s + Number(r.monto || 0), 0);
  return buildStyledInformeExcelHtml({
    title: 'INFORME DE DESCUENTOS',
    sheetName: 'Descuentos',
    periodLabel: period,
    usuario: usuario || '—',
    headers: DESCUENTOS_HEADERS,
    rows: mapped.map((row) => [
      { text: row.fecha, align: 'center' },
      { text: row.nVenta, align: 'center' },
      { text: row.cliente, align: 'left' },
      { text: row.motivo, align: 'left' },
      { text: row.usuario, align: 'left' },
      { text: formatSolesExcel(row.monto), align: 'right' },
    ]),
    totalCells: [
      { text: 'TOTAL', align: 'left' },
      { text: '', align: 'center' },
      { text: '', align: 'left' },
      { text: '', align: 'left' },
      { text: '', align: 'left' },
      { text: formatSolesExcel(total), align: 'right' },
    ],
  });
}

export function buildDescuentosTxt({ fromDate, toDate, orders, formatDate, formatDateKey, usuario } = {}) {
  const period = [formatDateKey?.(fromDate) || fromDate, formatDateKey?.(toDate) || toDate]
    .filter(Boolean)
    .join(' - ') || '—';
  const mapped = mapDescuentosInformeRows(orders, formatDate);
  const total = mapped.reduce((s, r) => s + Number(r.monto || 0), 0);
  const lines = [
    'INFORME DE DESCUENTOS',
    '='.repeat(24),
    `Periodo: ${period}`,
    `Usuario: ${usuario || '—'}`,
    '',
  ];
  if (mapped.length) {
    lines.push(...buildFixedWidthTable({
      headers: ['Fecha', 'N.º Venta', 'Cliente', 'Motivo', 'Usuario', 'Monto'],
      widths: [12, 10, 16, 28, 14, 12],
      aligns: ['left', 'left', 'left', 'left', 'left', 'right'],
      rows: mapped.map((row) => [
        row.fecha,
        row.nVenta,
        row.cliente,
        row.motivo,
        row.usuario,
        formatSolesExcel(row.monto),
      ]),
    }));
    lines.push('');
    lines.push(`TOTAL  ${formatSolesExcel(total)}`);
  } else {
    lines.push('(Sin descuentos en el periodo)');
  }
  return `${lines.join('\n')}\n`;
}

function itemProductName(it) {
  const name = String(it?.product_name || '—').trim() || '—';
  const variant = String(it?.variant_name || '').trim();
  return variant ? `${name} (${variant})` : name;
}

function itemLineValor(it) {
  const sub = Number(it?.subtotal);
  if (Number.isFinite(sub) && sub > 0) return sub;
  const qty = Number(it?.quantity ?? it?.quantity_removed ?? 0);
  const unit = Number(it?.unit_price ?? 0);
  return Math.max(0, qty * unit);
}

function courtesyItems(order) {
  if ((order?.items || []).length) return order.items;
  return [{
    product_id: order?.product_id,
    product_name: order?.product_name || '—',
    quantity: order?.quantity_removed || 0,
    unit_price: order?.unit_price || 0,
    subtotal: order?.reference_amount ?? order?.discount_amount ?? 0,
  }];
}

/** Una fila por producto cortesía. Cliente es también la mesa. */
export function mapCortesiasInformeRows(orders, formatDate) {
  const fmt = typeof formatDate === 'function' ? formatDate : (v) => String(v || '');
  const rows = [];
  (orders || [])
    .filter((o) => o.adjustment_kind === 'cortesia')
    .forEach((o) => {
      const fechaRaw = o.paid_at || o.created_at || o.updated_at;
      const base = {
        orderId: o.id,
        fecha: fmt(fechaRaw),
        sortTime: rowFechaSort(o),
        nVenta: formatSaleNumber(o.order_number),
        cliente: clienteOMesaLabel(o),
        autorizado: String(o.created_by_user_name || '').trim() || '—',
        record: o,
      };
      courtesyItems(o).forEach((it, idx) => {
        const cantidad = Number(it.quantity ?? it.quantity_removed ?? 0);
        rows.push({
          ...base,
          id: `${o.id}::${it.id || it.product_id || idx}`,
          producto: itemProductName(it),
          cantidad,
          valor: itemLineValor(it),
        });
      });
    });
  return rows.sort((a, b) => {
    if (a.sortTime !== b.sortTime) return a.sortTime - b.sortTime;
    const v = String(a.nVenta).localeCompare(String(b.nVenta), 'es');
    if (v) return v;
    return String(a.producto).localeCompare(String(b.producto), 'es');
  });
}

const CORTESIAS_HEADERS = [
  { label: 'Fecha', width: 90 },
  { label: 'N.º Venta', width: 90 },
  { label: 'Cliente', width: 140 },
  { label: 'Producto', width: 180 },
  { label: 'Cantidad', width: 80 },
  { label: 'Valor', width: 100 },
  { label: 'Autorizado por', width: 130 },
];

export function buildCortesiasExcelHtml({ fromDate, toDate, orders, formatDate, formatDateKey, usuario } = {}) {
  const period = [formatDateKey?.(fromDate) || fromDate, formatDateKey?.(toDate) || toDate]
    .filter(Boolean)
    .join(' - ') || '—';
  const mapped = mapCortesiasInformeRows(orders, formatDate);
  const qty = mapped.reduce((s, r) => s + Number(r.cantidad || 0), 0);
  const total = mapped.reduce((s, r) => s + Number(r.valor || 0), 0);
  return buildStyledInformeExcelHtml({
    title: 'INFORME DE CORTESÍAS',
    sheetName: 'Cortesias',
    periodLabel: period,
    usuario: usuario || '—',
    headers: CORTESIAS_HEADERS,
    rows: mapped.map((row) => [
      { text: row.fecha, align: 'center' },
      { text: row.nVenta, align: 'center' },
      { text: row.cliente, align: 'left' },
      { text: row.producto, align: 'left' },
      { text: String(row.cantidad), align: 'right' },
      { text: formatSolesExcel(row.valor), align: 'right' },
      { text: row.autorizado, align: 'left' },
    ]),
    totalCells: [
      { text: 'TOTAL', align: 'left' },
      { text: '', align: 'center' },
      { text: '', align: 'left' },
      { text: '', align: 'left' },
      { text: String(qty), align: 'right' },
      { text: formatSolesExcel(total), align: 'right' },
      { text: '', align: 'left' },
    ],
  });
}

export function buildCortesiasTxt({ fromDate, toDate, orders, formatDate, formatDateKey, usuario } = {}) {
  const period = [formatDateKey?.(fromDate) || fromDate, formatDateKey?.(toDate) || toDate]
    .filter(Boolean)
    .join(' - ') || '—';
  const mapped = mapCortesiasInformeRows(orders, formatDate);
  const qty = mapped.reduce((s, r) => s + Number(r.cantidad || 0), 0);
  const total = mapped.reduce((s, r) => s + Number(r.valor || 0), 0);
  const lines = [
    'INFORME DE CORTESÍAS',
    '='.repeat(22),
    `Periodo: ${period}`,
    `Usuario: ${usuario || '—'}`,
    '',
  ];
  if (mapped.length) {
    lines.push(...buildFixedWidthTable({
      headers: ['Fecha', 'N.º Venta', 'Cliente', 'Producto', 'Cant.', 'Valor', 'Autorizado por'],
      widths: [12, 10, 14, 20, 6, 12, 16],
      aligns: ['left', 'left', 'left', 'left', 'right', 'right', 'left'],
      rows: mapped.map((row) => [
        row.fecha,
        row.nVenta,
        row.cliente,
        row.producto,
        row.cantidad,
        formatSolesExcel(row.valor),
        row.autorizado,
      ]),
    }));
    lines.push('');
    lines.push(`TOTAL  Cantidad ${qty}  Valor ${formatSolesExcel(total)}`);
  } else {
    lines.push('(Sin cortesías en el periodo)');
  }
  return `${lines.join('\n')}\n`;
}

export function buildSalesAdjustmentsCsv({ fromDate, toDate, kindFilter, groupedProducts, referenceTotal, showReferenceTotal = true }) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const withType = kindFilter === 'all';
  const header = withType
    ? ['Fecha', 'Tipo', 'Producto', 'Cantidad', 'Motivo']
    : ['Producto', 'Cantidad', 'Motivos'];
  const lines = [
    ['Informe descuentos y cortesias'],
    ['Desde', fromDate || '—'],
    ['Hasta', toDate || '—'],
    ['Filtro', kindFilter === 'all' ? 'Todos' : kindLabel(kindFilter)],
    [],
    header,
  ];
  for (const group of groupedProducts || []) {
    if (withType) {
      const occ = (group.occurrences || [])[0] || {};
      lines.push([
        occ.fecha || group.fecha || '',
        kindLabel(group.kind),
        group.product_name,
        Number(group.totalQuantity || 0),
        occ.reason || 'Sin motivo',
      ]);
    } else {
      lines.push([
        group.product_name,
        Number(group.totalQuantity || 0),
        motivesSummary(group),
      ]);
    }
  }
  lines.push([]);
  if (showReferenceTotal && kindFilter !== 'eliminado') {
    lines.push(['Total valor referencia', '', Number(referenceTotal || 0).toFixed(2)]);
  }
  return `${lines.map((r) => r.map(esc).join(',')).join('\n')}\n`;
}

export function buildSalesAdjustmentsTxt({ fromDate, toDate, kindFilter, groupedProducts, referenceTotal, showReferenceTotal = true }) {
  const withType = kindFilter === 'all';
  const lines = [
    'INFORME DESCUENTOS Y CORTESIAS',
    '='.repeat(40),
    `Periodo: ${fromDate || '—'} al ${toDate || '—'}`,
    `Filtro: ${kindFilter === 'all' ? 'Todos' : kindLabel(kindFilter)}`,
    '',
  ];
  if ((groupedProducts || []).length) {
    lines.push(...buildFixedWidthTable({
      headers: withType
        ? ['Fecha', 'Tipo', 'Producto', 'Cant.', 'Motivo']
        : ['Producto', 'Cant.', 'Motivos'],
      widths: withType ? [20, 10, 24, 6, 28] : [32, 8, 38],
      aligns: withType ? ['left', 'left', 'left', 'right', 'left'] : ['left', 'right', 'left'],
      rows: groupedProducts.map((group) => {
        if (withType) {
          const occ = (group.occurrences || [])[0] || {};
          return [
            occ.fecha || group.fecha || '',
            kindLabel(group.kind),
            group.product_name,
            Number(group.totalQuantity || 0),
            occ.reason || 'Sin motivo',
          ];
        }
        return [
          group.product_name,
          Number(group.totalQuantity || 0),
          motivesSummary(group),
        ];
      }),
    }));
  } else {
    lines.push('(Sin registros en el periodo)');
  }
  lines.push('');
  if (showReferenceTotal && kindFilter !== 'eliminado') {
    lines.push(`TOTAL VALOR REFERENCIA: ${Number(referenceTotal || 0).toFixed(2)}`);
  }
  return `${lines.join('\n')}\n`;
}

export function buildSalesAdjustmentsDownloadBaseName(fromDate, toDate, kindFilter) {
  const kind = kindFilter === 'all' ? 'todos' : kindFilter;
  if (fromDate && toDate) return `descuentos-${fromDate}_${toDate}-${kind}`;
  return `descuentos-${kind}`;
}

export { formatSaleNumber, clienteOMesaLabel };
