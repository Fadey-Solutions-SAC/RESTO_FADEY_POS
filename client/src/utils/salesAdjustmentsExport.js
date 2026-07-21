import { buildFixedWidthTable } from './fixedWidthTxt';

function kindLabel(kind) {
  if (kind === 'cortesia') return 'Cortesia';
  if (kind === 'descuento') return 'Descuento';
  if (kind === 'eliminado') return 'Eliminado';
  return kind || '—';
}

function mesaChannelLabel(row) {
  if (row.type === 'dine_in' && row.table_number) return `Mesa ${row.table_number}`;
  if (row.type === 'delivery') return 'Delivery';
  return 'Mostrador';
}

export function buildSalesAdjustmentsCsv({ fromDate, toDate, kindFilter, productRows, referenceTotal, formatDateTime }) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [
    ['Informe descuentos y cortesias'],
    ['Desde', fromDate || '—'],
    ['Hasta', toDate || '—'],
    ['Filtro', kindFilter === 'all' ? 'Todos' : kindLabel(kindFilter)],
    [],
    ['Fecha', 'Tipo', 'Producto', 'Cantidad', 'Mesa/Pedido', 'Motivo'],
  ];
  for (const row of productRows) {
    lines.push([
      formatDateTime ? formatDateTime(row.fecha) : row.fecha,
      kindLabel(row.kind),
      row.product_name,
      Number(row.quantity || 0),
      row.order_number ? `#${row.order_number} · ${mesaChannelLabel(row)}` : mesaChannelLabel(row),
      row.reason,
    ]);
  }
  lines.push([]);
  lines.push(['Total valor referencia', '', '', '', '', Number(referenceTotal || 0).toFixed(2)]);
  return `${lines.map((r) => r.map(esc).join(',')).join('\n')}\n`;
}

export function buildSalesAdjustmentsTxt({ fromDate, toDate, kindFilter, productRows, referenceTotal, formatDateTime }) {
  const lines = [
    'INFORME DESCUENTOS Y CORTESIAS',
    '='.repeat(40),
    `Periodo: ${fromDate || '—'} al ${toDate || '—'}`,
    `Filtro: ${kindFilter === 'all' ? 'Todos' : kindLabel(kindFilter)}`,
    '',
  ];
  if (productRows.length) {
    lines.push(...buildFixedWidthTable({
      headers: ['Fecha', 'Tipo', 'Producto', 'Cant.', 'Mesa/Ped.', 'Motivo'],
      widths: [16, 10, 24, 6, 14, 28],
      aligns: ['left', 'left', 'left', 'right', 'left', 'left'],
      rows: productRows.map((row) => [
        formatDateTime ? formatDateTime(row.fecha) : String(row.fecha || ''),
        kindLabel(row.kind),
        row.product_name,
        Number(row.quantity || 0),
        row.order_number ? `#${row.order_number}` : mesaChannelLabel(row),
        row.reason,
      ]),
    }));
  } else {
    lines.push('(Sin registros en el periodo)');
  }
  lines.push('');
  lines.push(`TOTAL VALOR REFERENCIA: ${Number(referenceTotal || 0).toFixed(2)}`);
  return `${lines.join('\n')}\n`;
}

export function buildSalesAdjustmentsDownloadBaseName(fromDate, toDate, kindFilter) {
  const kind = kindFilter === 'all' ? 'todos' : kindFilter;
  if (fromDate && toDate) return `descuentos-${fromDate}_${toDate}-${kind}`;
  return `descuentos-${kind}`;
}
