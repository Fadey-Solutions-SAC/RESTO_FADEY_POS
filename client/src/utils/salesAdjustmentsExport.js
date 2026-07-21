import { buildFixedWidthTable } from './fixedWidthTxt';

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

export function buildSalesAdjustmentsCsv({ fromDate, toDate, kindFilter, groupedProducts, referenceTotal, showReferenceTotal = true }) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const withType = kindFilter === 'all';
  const header = withType
    ? ['Producto', 'Cantidad', 'Tipo', 'Motivos']
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
    const row = [
      group.product_name,
      Number(group.totalQuantity || 0),
    ];
    if (withType) row.push(kindLabel(group.kind));
    row.push(motivesSummary(group));
    lines.push(row);
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
      headers: withType ? ['Producto', 'Cant.', 'Tipo', 'Motivos'] : ['Producto', 'Cant.', 'Motivos'],
      widths: withType ? [28, 6, 10, 34] : [32, 8, 38],
      aligns: withType ? ['left', 'right', 'left', 'left'] : ['left', 'right', 'left'],
      rows: groupedProducts.map((group) => {
        const base = [group.product_name, Number(group.totalQuantity || 0)];
        if (withType) base.push(kindLabel(group.kind));
        base.push(motivesSummary(group));
        return base;
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
