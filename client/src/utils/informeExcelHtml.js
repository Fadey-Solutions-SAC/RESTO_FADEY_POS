/** Excel HTML con el diseño de plantilla: título azul, Periodo/Usuario, cabeceras y TOTAL. */

export const INFORME_EXCEL_NAVY = '#1F4E79';
export const INFORME_EXCEL_LABEL = '#BDD7EE';
export const INFORME_EXCEL_TOTAL = '#FFE699';
export const INFORME_EXCEL_BORDER = '#808080';

export function escapeExcelHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatSolesExcel(value) {
  const n = Number(value || 0);
  const formatted = n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `S/ ${formatted}`;
}

function cellStyle({
  background,
  color,
  bold,
  align,
  border = true,
  fontSize,
  verticalAlign,
  textTransform,
} = {}) {
  const parts = [
    'font-family:Calibri,Arial,sans-serif',
    `font-size:${fontSize || 11}pt`,
    `text-align:${align || 'left'}`,
    `vertical-align:${verticalAlign || 'middle'}`,
    'padding:4px 6px',
    'mso-number-format:\\@',
  ];
  if (border) parts.push(`border:0.5pt solid ${INFORME_EXCEL_BORDER}`);
  else parts.push('border:none');
  if (background) parts.push(`background:${background}`);
  if (color) parts.push(`color:${color}`);
  if (bold) parts.push('font-weight:bold');
  if (textTransform) parts.push(`text-transform:${textTransform}`);
  return parts.join(';');
}

function td(text, opts = {}) {
  const colspan = opts.colspan ? ` colspan="${opts.colspan}"` : '';
  const rowspan = opts.rowspan ? ` rowspan="${opts.rowspan}"` : '';
  const width = opts.width ? ` width="${opts.width}"` : '';
  const height = opts.height ? ` height="${opts.height}"` : '';
  return `<td${colspan}${rowspan}${width}${height} style="${cellStyle(opts)}">${escapeExcelHtml(text)}</td>`;
}

function emptyTd() {
  return `<td style="${cellStyle({ border: false })}">&nbsp;</td>`;
}

/**
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} [opts.sheetName]
 * @param {string} [opts.periodLabel]
 * @param {string} [opts.usuario]
 * @param {{ label: string, width?: number }[]} opts.headers
 * @param {{ text: string, align?: string }[][]} opts.rows
 * @param {{ text: string, align?: string }[]} opts.totalCells
 */
export function buildStyledInformeExcelHtml({
  title,
  sheetName = 'Informe',
  periodLabel = '—',
  usuario = '—',
  headers = [],
  rows = [],
  totalCells = [],
} = {}) {
  const colCount = Math.max(headers.length, 1);
  const colgroup = headers
    .map((h) => `<col width="${Number(h.width || 80)}" />`)
    .join('');

  const titleBlock = [
    `<tr style="height:18pt">${td(title, {
      colspan: colCount,
      rowspan: 3,
      height: 54,
      background: INFORME_EXCEL_NAVY,
      color: '#FFFFFF',
      bold: true,
      align: 'center',
      fontSize: 16,
      verticalAlign: 'middle',
      textTransform: 'uppercase',
    })}</tr>`,
    '<tr style="height:12pt"></tr>',
    '<tr style="height:12pt"></tr>',
  ].join('');

  const metaValueCols = Math.min(2, Math.max(1, colCount - 1));
  const metaPad = Math.max(0, colCount - 1 - metaValueCols);
  const metaRow = (label, value) => {
    const pad = Array.from({ length: metaPad }, emptyTd).join('');
    return `<tr>${td(label, {
      background: INFORME_EXCEL_LABEL,
      bold: true,
      align: 'left',
    })}${td(value, {
      colspan: metaValueCols,
      align: 'center',
    })}${pad}</tr>`;
  };

  const spacer = `<tr>${Array.from({ length: colCount }, emptyTd).join('')}</tr>`;

  const headerRow = `<tr>${headers.map((h) => td(h.label, {
    background: INFORME_EXCEL_NAVY,
    color: '#FFFFFF',
    bold: true,
    align: 'center',
    width: h.width,
  })).join('')}</tr>`;

  const dataRows = rows.map((row) => (
    `<tr>${row.map((cell, idx) => td(cell?.text ?? '', {
      align: cell?.align || (idx === 0 ? 'left' : 'right'),
    })).join('')}</tr>`
  )).join('');

  const totals = (totalCells.length ? totalCells : headers.map((_, i) => ({
    text: i === 0 ? 'TOTAL' : '',
    align: 'left',
  }))).map((cell, idx) => td(cell?.text ?? '', {
    align: cell?.align || (idx === 0 ? 'left' : 'right'),
    bold: true,
    background: idx === 0 ? INFORME_EXCEL_TOTAL : '#FFFFFF',
  })).join('');

  const safeSheet = String(sheetName || 'Informe').replace(/[<>]/g, '');

  return `<html xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
<!--[if gte mso 9]>
<xml>
 <x:ExcelWorkbook>
  <x:ExcelWorksheets>
   <x:ExcelWorksheet>
    <x:Name>${escapeExcelHtml(safeSheet)}</x:Name>
    <x:WorksheetOptions>
     <x:DisplayGridlines/>
    </x:WorksheetOptions>
    <x:AutoFilterRange>A7:${String.fromCharCode(64 + Math.min(colCount, 26))}${7 + Math.max(rows.length, 1)}</x:AutoFilterRange>
   </x:ExcelWorksheet>
  </x:ExcelWorksheets>
 </x:ExcelWorkbook>
</xml>
<![endif]-->
<style>
 table { border-collapse: collapse; }
</style>
</head>
<body>
<table border="0" cellspacing="0" cellpadding="0">
<colgroup>${colgroup}</colgroup>
${titleBlock}
${metaRow('Periodo', periodLabel || '—')}
${metaRow('Usuario', usuario || '—')}
${spacer}
${headerRow}
${dataRows}
${spacer}
<tr>${totals}</tr>
</table>
</body>
</html>`;
}
