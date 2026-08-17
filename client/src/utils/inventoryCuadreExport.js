import { buildFixedWidthTable, sortProductsByName } from './fixedWidthTxt';
import { buildStyledInformeExcelHtml, formatSolesExcel } from './informeExcelHtml';

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

/** CSV o HTML con BOM para que Excel abra acentos, columnas y formato. */
export function downloadExcelFile(filename, csvContent) {
  const body = String(csvContent ?? '');
  const withBom = body.charCodeAt(0) === 0xfeff ? body : `\uFEFF${body}`;
  const base = String(filename || 'informe').replace(/\.(csv|xls|xlsx|html)$/i, '');
  downloadBlobFile(`${base}.xls`, withBom, 'application/vnd.ms-excel;charset=utf-8');
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

export function mapPurchaseInformeRows(group = {}) {
  return sortProductsByName(group.items || []).map((item) => {
    const cantidad = Number(item.quantity || 0);
    const unitario = Number(item.unit_cost || 0);
    const total = Number(item.total_cost ?? cantidad * unitario);
    return {
      id: item.id,
      producto: String(item.product_name || 'Producto').trim() || 'Producto',
      cantidad,
      unitario,
      total,
    };
  });
}

export function buildPurchaseExcelHtml(group = {}, { formatDate, formatDateKey, usuario, title, sheetName } = {}) {
  const mapped = mapPurchaseInformeRows(group);
  const qty = mapped.reduce((s, r) => s + Number(r.cantidad || 0), 0);
  const grand = mapped.reduce((s, r) => s + Number(r.total || 0), 0) || Number(group.total || 0);
  const dateRaw = group.purchase_date || group.created_at;
  const period = formatDateKey?.(String(dateRaw || '').slice(0, 10))
    || (formatDate ? formatDate(dateRaw) : String(dateRaw || '').slice(0, 10))
    || '—';
  return buildStyledInformeExcelHtml({
    title: title || 'INFORME DE COMPRAS',
    sheetName: sheetName || 'Compras',
    periodLabel: period,
    usuario: usuario || '—',
    headers: [
      { label: 'Producto', width: 260 },
      { label: 'Cantidad', width: 90 },
      { label: 'Precio unitario', width: 120 },
      { label: 'Total', width: 120 },
    ],
    rows: mapped.map((row) => [
      { text: row.producto, align: 'left' },
      { text: String(row.cantidad), align: 'right' },
      { text: formatSolesExcel(row.unitario), align: 'right' },
      { text: formatSolesExcel(row.total), align: 'right' },
    ]),
    totalCells: [
      { text: 'TOTAL', align: 'left' },
      { text: String(qty), align: 'right' },
      { text: '', align: 'right' },
      { text: formatSolesExcel(grand), align: 'right' },
    ],
  });
}

/** @deprecated usar buildPurchaseExcelHtml */
export function buildPurchaseCsv(group = {}) {
  return buildPurchaseExcelHtml(group, { formatDate: group.formatDate, usuario: group.usuario });
}

export function buildPurchaseTxt(group = {}, { formatCurrency, formatDate, formatDateKey, usuario, title } = {}) {
  const mapped = mapPurchaseInformeRows(group);
  const qty = mapped.reduce((s, r) => s + Number(r.cantidad || 0), 0);
  const grand = mapped.reduce((s, r) => s + Number(r.total || 0), 0) || Number(group.total || 0);
  const dateRaw = group.purchase_date || group.created_at;
  const period = formatDateKey?.(String(dateRaw || '').slice(0, 10))
    || (formatDate ? formatDate(dateRaw) : String(dateRaw || '').slice(0, 10))
    || '—';
  const fmtMoney = formatCurrency || formatSolesExcel;
  const lines = [
    title || 'INFORME DE COMPRAS',
    '='.repeat(20),
    `Periodo: ${period}`,
    `Usuario: ${usuario || '—'}`,
    '',
  ];
  if (mapped.length) {
    lines.push(...buildFixedWidthTable({
      headers: ['Producto', 'Cantidad', 'Precio unitario', 'Total'],
      widths: [36, 10, 16, 14],
      aligns: ['left', 'right', 'right', 'right'],
      rows: mapped.map((row) => [
        row.producto,
        row.cantidad,
        fmtMoney(row.unitario),
        fmtMoney(row.total),
      ]),
    }));
    lines.push('');
    lines.push(`TOTAL  Cantidad ${qty}  ${fmtMoney(grand)}`);
  } else {
    lines.push('(Sin productos)');
  }
  return `${lines.join('\n')}\n`;
}

export function downloadInventoryCuadreSession(session, group, { format = 'excel', formatDateTime, toastFn } = {}) {
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
  downloadExcelFile(baseName, buildInventoryCuadreCsv(session, group, { formatDateTime }));
  toastFn?.success?.('Cuadre descargado (Excel)');
}

export function downloadReconciliationRecord(rec, { format = 'excel', formatDate, formatDateTime, toastFn } = {}) {
  const session = reconciliationToExportSession(rec);
  const dateKey = String(rec.created_at || '').slice(0, 10);
  downloadInventoryCuadreSession(
    session,
    { dateKey, dateLabel: formatDate ? formatDate(rec.created_at) : dateKey },
    { format, formatDateTime, toastFn },
  );
}
