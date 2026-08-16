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
