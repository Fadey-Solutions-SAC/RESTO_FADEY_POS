/** Utilidades para TXT con columnas alineadas (Notepad / importación Excel). */

export function padCell(value, width, align = 'left') {
  const text = String(value ?? '');
  if (text.length >= width) return text.slice(0, width);
  return align === 'right' ? text.padStart(width) : text.padEnd(width);
}

/**
 * @param {{ headers: string[], rows: (string|number)[][], widths: number[], aligns?: ('left'|'right')[] }} opts
 * @returns {string[]}
 */
export function buildFixedWidthTable({ headers, rows, widths, aligns = [] }) {
  const headerLine = headers
    .map((h, i) => padCell(h, widths[i] || 10, aligns[i] || 'left'))
    .join('  ');
  const sep = '-'.repeat(Math.min(Math.max(headerLine.length, 40), 120));
  const body = (rows || []).map((row) =>
    row.map((cell, i) => padCell(cell, widths[i] || 10, aligns[i] || 'left')).join('  '),
  );
  return [headerLine, sep, ...body];
}

export function sortProductsByName(rows = []) {
  return [...rows].sort((a, b) =>
    String(a.product_name || '').localeCompare(String(b.product_name || ''), 'es'),
  );
}
