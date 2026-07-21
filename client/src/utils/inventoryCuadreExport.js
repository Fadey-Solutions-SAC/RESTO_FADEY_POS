import { buildFixedWidthTable, sortProductsByName } from './fixedWidthTxt';

export function downloadBlobFile(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function cuadreLinesTable(lines = []) {
  const sorted = sortProductsByName(lines.map((line) => ({ product_name: line.product_name, ...line })));
  return buildFixedWidthTable({
    headers: ['Producto', 'Contado', 'Ajuste'],
    widths: [42, 10, 10],
    aligns: ['left', 'right', 'right'],
    rows: sorted.map((line) => {
      const diff = Number(line.difference || 0);
      const adj = diff > 0 ? `+${diff}` : String(diff);
      return [line.product_name, Number(line.counted_stock || 0), adj];
    }),
  });
}

export function reconciliationToExportSession(rec) {
  const lines = sortProductsByName(rec?.items || []).map((item) => ({
    product_name: item.product_name,
    counted_stock: Number(item.counted_stock || 0),
    difference: Number(item.difference || 0),
  }));
  return {
    id: rec.id,
    created_at: rec.created_at,
    warehouse_name: rec.warehouse_name || 'Almacén',
    total_items: rec.total_items,
    total_shortage: rec.total_shortage,
    total_surplus: rec.total_surplus,
    notes: rec.notes,
    lines,
  };
}

export function buildInventoryCuadresCsv(groups = [], { formatDateTime } = {}) {
  const rows = [['Cuadre ID', 'Fecha', 'Hora', 'Almacén', 'Producto', 'Contado', 'Ajuste'].map(csvCell).join(',')];
  for (const group of groups) {
    for (const session of group.sessions || []) {
      const timeLabel = formatDateTime
        ? formatDateTime(session.created_at)
        : String(session.created_at || '');
      for (const line of session.lines || []) {
        rows.push([
          session.id,
          group.dateLabel,
          timeLabel,
          session.warehouse_name,
          line.product_name,
          line.counted_stock,
          line.difference > 0 ? `+${line.difference}` : line.difference,
        ].map(csvCell).join(','));
      }
    }
  }
  return `${rows.join('\n')}\n`;
}

export function buildInventoryCuadreCsv(session = {}, group = {}, { formatDateTime } = {}) {
  return buildInventoryCuadresCsv(
    [{ dateLabel: group.dateLabel || group.dateKey || '', sessions: [session] }],
    { formatDateTime },
  );
}

export function buildInventoryCuadreTxt(session = {}, group = {}, { formatDateTime } = {}) {
  const idShort = String(session.id || '').slice(0, 8);
  const lines = [
    'CUADRE DE INVENTARIO',
    '='.repeat(24),
    `ID: ${session.id}`,
    `Referencia: Cuadre ${idShort}`,
    `Fecha: ${group.dateLabel || group.dateKey || '—'}`,
    `Hora: ${formatDateTime ? formatDateTime(session.created_at) : String(session.created_at || '—')}`,
    `Almacén: ${session.warehouse_name || 'Almacén'}`,
    `Productos: ${session.lines?.length || 0}`,
    '',
  ];
  if (session.lines?.length) {
    lines.push(...cuadreLinesTable(session.lines), '');
  } else {
    lines.push('(Sin productos)', '');
  }
  return `${lines.join('\n')}\n`;
}

export function buildInventoryCuadresTxt(groups = [], { formatDateTime } = {}) {
  const lines = ['CUADRES DE INVENTARIO', '='.repeat(24), ''];
  for (const group of groups) {
    lines.push(`Fecha: ${group.dateLabel} (${group.sessions?.length || 0} cuadre(s) · ${group.lineCount || 0} producto(s))`);
    lines.push('-'.repeat(40));
    for (const session of group.sessions || []) {
      lines.push(
        `  Cuadre ${String(session.id || '').slice(0, 8)} · ${formatDateTime ? formatDateTime(session.created_at) : session.created_at} · ${session.warehouse_name}`,
      );
      if (session.lines?.length) {
        lines.push(...cuadreLinesTable(session.lines).map((row) => `    ${row}`));
      } else {
        lines.push('    (Sin productos)');
      }
      lines.push('');
    }
  }
  return `${lines.join('\n')}\n`;
}

export function buildPurchaseCsv(group = {}) {
  const dateStr = group.formatDate
    ? group.formatDate(group.purchase_date || group.created_at)
    : String(group.purchase_date || group.created_at || '').slice(0, 10);
  const rows = [['Compra ID', 'Fecha', 'Producto', 'Cantidad', 'Costo unitario', 'Subtotal'].map(csvCell).join(',')];
  const sortedItems = sortProductsByName(group.items || []);
  for (const item of sortedItems) {
    const subtotal = Number(item.total_cost ?? (Number(item.quantity || 0) * Number(item.unit_cost || 0)));
    rows.push([
      group.id,
      dateStr,
      item.product_name || 'Producto',
      item.quantity,
      item.unit_cost,
      subtotal,
    ].map(csvCell).join(','));
  }
  rows.push(['', '', '', '', 'Total', group.total].map(csvCell).join(','));
  return `${rows.join('\n')}\n`;
}

export function buildPurchaseTxt(group = {}, { formatCurrency, formatDate } = {}) {
  const idShort = String(group.id || '').slice(0, 8);
  const lines = [
    'COMPROBANTE DE COMPRA',
    '='.repeat(24),
    `ID: ${group.id}`,
    `Referencia: Compra ${idShort}`,
    `Fecha de compra: ${formatDate ? formatDate(group.purchase_date || group.created_at) : '—'}`,
    `Total: ${formatCurrency ? formatCurrency(group.total) : group.total}`,
    '',
  ];
  const sortedItems = sortProductsByName(group.items || []);
  if (sortedItems.length) {
    lines.push(
      ...buildFixedWidthTable({
        headers: ['Producto', 'Cant.', 'Costo u.', 'Subtotal'],
        widths: [38, 8, 12, 12],
        aligns: ['left', 'right', 'right', 'right'],
        rows: sortedItems.map((item) => {
          const subtotal = Number(item.total_cost ?? (Number(item.quantity || 0) * Number(item.unit_cost || 0)));
          return [
            item.product_name || 'Producto',
            Number(item.quantity || 0),
            formatCurrency ? formatCurrency(item.unit_cost) : item.unit_cost,
            formatCurrency ? formatCurrency(subtotal) : subtotal,
          ];
        }),
      }),
      '',
      `Total compra: ${formatCurrency ? formatCurrency(group.total) : group.total}`,
    );
  } else {
    lines.push('(Sin productos)');
  }
  return `${lines.join('\n')}\n`;
}

export function downloadInventoryCuadreSession(session, group, { format = 'csv', formatDateTime, toastFn } = {}) {
  if (!session?.lines?.length) {
    toastFn?.error?.('Este cuadre no tiene productos para descargar');
    return;
  }
  const idShort = String(session.id || 'cuadre').slice(0, 8);
  const dateKey = group?.dateKey || String(session.created_at || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
  const baseName = `cuadre-${idShort}-${dateKey}`;
  if (format === 'txt') {
    downloadBlobFile(`${baseName}.txt`, buildInventoryCuadreTxt(session, group, { formatDateTime }));
    toastFn?.success?.('Cuadre descargado (TXT)');
    return;
  }
  downloadBlobFile(`${baseName}.csv`, buildInventoryCuadreCsv(session, group, { formatDateTime }), 'text/csv;charset=utf-8');
  toastFn?.success?.('Cuadre descargado (CSV)');
}

export function downloadReconciliationRecord(rec, { format = 'csv', formatDate, formatDateTime, toastFn } = {}) {
  const session = reconciliationToExportSession(rec);
  const dateKey = String(rec.created_at || '').slice(0, 10);
  downloadInventoryCuadreSession(
    session,
    { dateKey, dateLabel: formatDate ? formatDate(rec.created_at) : dateKey },
    { format, formatDateTime, toastFn },
  );
}
