import { buildFixedWidthTable, sortProductsByName } from './fixedWidthTxt';
import { buildStyledInformeExcelHtml, formatSolesExcel } from './informeExcelHtml';

function reportHasInventoryStock(report) {
  return Boolean(
    report?.include_inventory
    || (report?.sold_products || []).some((r) => r.current_stock !== undefined && r.current_stock !== null),
  );
}

export function productSalesPeriodLabel(report, formatDate) {
  const filters = report?.filters || {};
  const fmt = (value) => {
    if (!value) return '';
    if (typeof formatDate === 'function') return formatDate(value) || String(value);
    return String(value);
  };
  if (report?.mode === 'current') return 'Caja actual (turno abierto)';
  if (report?.mode === 'date_range' && filters.from && filters.to) {
    return `${fmt(filters.from)} - ${fmt(filters.to)}`;
  }
  const blocks = report?.by_register || [];
  if (report?.mode === 'registers') {
    if (blocks.length === 1) {
      const block = blocks[0];
      const from = fmt(block.opened_at) || '—';
      const to = block.closed_at ? fmt(block.closed_at) : 'ahora';
      return `${from} - ${to}`;
    }
    const count = (filters.register_ids || blocks).length;
    return `${count} cierres seleccionados`;
  }
  return '—';
}

export function mapProductosInformeRows(products) {
  const sold = (products || []).filter((row) => Number(row.total_qty || 0) > 0);
  return sortProductsByName(sold).map((row, index) => ({
    codigo: `P${String(index + 1).padStart(3, '0')}`,
    producto: String(row.product_name || '').trim(),
    categoria: String(row.category_name || '').trim(),
    cantidad: Number(row.total_qty || 0),
    precioPromedio: Number(row.unit_price || 0),
    descuento: Number(row.discount_amount || 0),
    totalVendido: Number(row.total_amount || 0),
  }));
}

const PRODUCT_HEADERS = [
  { label: 'Código', width: 72 },
  { label: 'Producto', width: 220 },
  { label: 'Categoría', width: 110 },
  { label: 'Cantidad', width: 80 },
  { label: 'Precio promedio', width: 120 },
  { label: 'Descuento', width: 100 },
  { label: 'Total vendido', width: 120 },
];

function productInformeTotals(mapped) {
  const qty = mapped.reduce((s, r) => s + Number(r.cantidad || 0), 0);
  const discount = mapped.reduce((s, r) => s + Number(r.descuento || 0), 0);
  const total = mapped.reduce((s, r) => s + Number(r.totalVendido || 0), 0);
  return { qty, discount, total };
}

function productInformeExcelRows(mapped) {
  return mapped.map((row) => [
    { text: row.codigo, align: 'left' },
    { text: row.producto, align: 'left' },
    { text: row.categoria, align: 'left' },
    { text: String(row.cantidad), align: 'right' },
    { text: formatSolesExcel(row.precioPromedio), align: 'right' },
    { text: formatSolesExcel(row.descuento), align: 'right' },
    { text: formatSolesExcel(row.totalVendido), align: 'right' },
  ]);
}

export function buildProductSalesExcelHtml(report, { periodLabel, usuario } = {}) {
  const mapped = mapProductosInformeRows(report?.sold_products || []);
  const sums = productInformeTotals(mapped);
  return buildStyledInformeExcelHtml({
    title: 'INFORME DE PRODUCTOS',
    sheetName: 'Productos',
    periodLabel: periodLabel || '—',
    usuario: usuario || '—',
    headers: PRODUCT_HEADERS,
    rows: productInformeExcelRows(mapped),
    totalCells: [
      { text: 'TOTAL', align: 'left' },
      { text: '', align: 'left' },
      { text: '', align: 'left' },
      { text: String(sums.qty), align: 'right' },
      { text: '', align: 'right' },
      { text: formatSolesExcel(sums.discount), align: 'right' },
      { text: formatSolesExcel(sums.total), align: 'right' },
    ],
  });
}

export function buildProductSalesTxt(report, { title = 'INFORME DE PRODUCTOS', formatDate, usuario } = {}) {
  const mapped = mapProductosInformeRows(report?.sold_products || []);
  const sums = productInformeTotals(mapped);
  const period = productSalesPeriodLabel(report, formatDate);
  const lines = [title, '='.repeat(Math.min(title.length, 40)), ''];
  lines.push(`Periodo: ${period}`);
  lines.push(`Usuario: ${usuario || '—'}`);
  if (reportHasInventoryStock(report)) {
    lines.push('Incluye stock actual de almacén en productos vendidos.');
  }
  lines.push('');
  if (mapped.length) {
    lines.push(...buildFixedWidthTable({
      headers: ['Código', 'Producto', 'Categoría', 'Cantidad', 'Precio promedio', 'Descuento', 'Total vendido'],
      widths: [8, 32, 14, 10, 16, 12, 14],
      aligns: ['left', 'left', 'left', 'right', 'right', 'right', 'right'],
      rows: mapped.map((row) => [
        row.codigo,
        row.producto,
        row.categoria,
        row.cantidad,
        formatSolesExcel(row.precioPromedio),
        formatSolesExcel(row.descuento),
        formatSolesExcel(row.totalVendido),
      ]),
    }));
    lines.push('');
    lines.push(`TOTAL  Cantidad ${sums.qty}  Descuento ${formatSolesExcel(sums.discount)}  Total vendido ${formatSolesExcel(sums.total)}`);
  } else {
    lines.push('(Sin productos)');
  }
  return `${lines.join('\n')}\n`;
}

export function buildProductSalesCsv(report) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const mapped = mapProductosInformeRows(report?.sold_products || []);
  const sums = productInformeTotals(mapped);
  const rows = [[
    'Código',
    'Producto',
    'Categoría',
    'Cantidad',
    'Precio promedio',
    'Descuento',
    'Total vendido',
  ]];
  mapped.forEach((row) => {
    rows.push([
      row.codigo,
      row.producto,
      row.categoria,
      row.cantidad,
      formatSolesExcel(row.precioPromedio),
      formatSolesExcel(row.descuento),
      formatSolesExcel(row.totalVendido),
    ]);
  });
  rows.push([
    'TOTAL',
    '',
    '',
    sums.qty,
    '',
    formatSolesExcel(sums.discount),
    formatSolesExcel(sums.total),
  ]);
  return rows.map((r) => r.map(esc).join(',')).join('\n');
}

export function buildClosedRegisterProductsTxt(soldProducts, formatCurrency) {
  if (!soldProducts?.length) return [];
  return [
    'PRODUCTOS VENDIDOS (DETALLE POR PRODUCTO)',
    ...buildFixedWidthTable({
      headers: ['Producto', 'Cant.', 'P.unit.', 'Total'],
      widths: [38, 8, 12, 12],
      aligns: ['left', 'right', 'right', 'right'],
      rows: sortProductsByName(soldProducts).map((item) => {
        const qty = Number(item.total_qty || 0);
        const unit = qty > 0 ? Number(item.total_amount || 0) / qty : Number(item.unit_price || 0);
        return [
          item.product_name,
          qty,
          formatCurrency(unit),
          formatCurrency(item.total_amount || 0),
        ];
      }),
    }),
  ];
}
