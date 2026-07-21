import { buildFixedWidthTable, sortProductsByName } from './fixedWidthTxt';

function reportHasInventoryStock(report) {
  return Boolean(
    report?.include_inventory
    || (report?.sold_products || []).some((r) => r.current_stock !== undefined && r.current_stock !== null),
  );
}

function productSalesTableRows(products, formatCurrency, withStock) {
  return sortProductsByName(products).map((row) => {
    const base = [
      row.product_name,
      Number(row.total_qty || 0),
      formatCurrency(row.unit_price || 0),
      formatCurrency(row.total_amount || 0),
      Number(row.order_count || 0),
    ];
    if (withStock) base.push(Number(row.current_stock ?? 0));
    return base;
  });
}

function productSalesTableBlock(products, formatCurrency, withStock) {
  const headers = withStock
    ? ['Producto', 'Cant.', 'P.unit.', 'Total', 'Cuentas', 'Stock']
    : ['Producto', 'Cant.', 'P.unit.', 'Total', 'Cuentas'];
  const widths = withStock ? [32, 7, 10, 10, 7, 8] : [38, 8, 12, 12, 8];
  const aligns = withStock
    ? ['left', 'right', 'right', 'right', 'right', 'right']
    : ['left', 'right', 'right', 'right', 'right'];
  return buildFixedWidthTable({
    headers,
    widths,
    aligns,
    rows: productSalesTableRows(products, formatCurrency, withStock),
  });
}

export function buildProductSalesTxt(report, { title = 'INFORME DE PRODUCTOS', formatCurrency, formatDateTime } = {}) {
  const withStock = reportHasInventoryStock(report);
  const lines = [title, '='.repeat(Math.min(title.length, 40)), ''];
  const filters = report?.filters || {};
  if (report?.mode === 'current') {
    lines.push('Periodo: caja actual (turno abierto)');
  } else if (report?.mode === 'date_range') {
    lines.push(`Periodo: ${filters.from || '—'} al ${filters.to || '—'}`);
  } else if (report?.mode === 'registers') {
    lines.push(`Cierres seleccionados: ${(filters.register_ids || []).length}`);
  }
  if (withStock) lines.push('Incluye inventario completo de almacén (no transformables).');
  lines.push('');

  const writeProducts = (products, heading) => {
    if (heading) {
      lines.push(heading);
      lines.push('-'.repeat(40));
    }
    if ((products || []).length) {
      lines.push(...productSalesTableBlock(products, formatCurrency, withStock));
    } else {
      lines.push('(Sin productos)');
    }
    lines.push('');
  };

  if (Array.isArray(report?.by_register) && report.by_register.length > 1) {
    report.by_register.forEach((block, idx) => {
      const label = block.is_open
        ? `Turno abierto · ${block.user_name || '—'} · desde ${formatDateTime ? formatDateTime(block.opened_at) : block.opened_at}`
        : `Cierre ${idx + 1} · ${block.user_name || '—'} · ${formatDateTime ? formatDateTime(block.closed_at) : block.closed_at}`;
      writeProducts(block.sold_products, label);
    });
    lines.push('TOTAL CONSOLIDADO');
    lines.push('-'.repeat(40));
  }

  writeProducts(report?.sold_products || []);
  lines.push(`TOTAL VENTAS (productos): ${formatCurrency(report?.product_sales_total ?? 0)}`);
  return `${lines.join('\n')}\n`;
}

export function buildProductSalesCsv(report) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const withStock = reportHasInventoryStock(report);
  const header = withStock
    ? ['Producto', 'Cantidad', 'Precio unit.', 'Total', 'Cuentas', 'Stock actual']
    : ['Producto', 'Cantidad', 'Precio unit.', 'Total', 'Cuentas'];
  const rows = [header];
  sortProductsByName(report?.sold_products || []).forEach((row) => {
    const line = [
      row.product_name,
      Number(row.total_qty || 0),
      Number(row.unit_price || 0).toFixed(2),
      Number(row.total_amount || 0).toFixed(2),
      Number(row.order_count || 0),
    ];
    if (withStock) line.push(Number(row.current_stock ?? 0));
    rows.push(line);
  });
  const totalRow = ['TOTAL', '', '', Number(report?.product_sales_total || 0).toFixed(2), ''];
  if (withStock) totalRow.push('');
  rows.push(totalRow);
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
