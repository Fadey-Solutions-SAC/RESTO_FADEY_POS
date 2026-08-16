import { buildFixedWidthTable } from './fixedWidthTxt';
import { formatMesaLabel, isCourtesyOrder, isDiscountOrder, courtesyReferenceAmount } from './mesaOrderLines';
import { buildStyledInformeExcelHtml, formatSolesExcel } from './informeExcelHtml';

const PAYMENT_METHOD_LABELS = {
  efectivo: 'Efectivo',
  yape: 'Yape',
  plin: 'Plin',
  tarjeta: 'Tarjeta',
  online: 'Online',
};

function csvCell(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function csvTable(rows) {
  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

export function formatSoles(value) {
  return `S/ ${money(value)}`;
}

export function formatSaleNumero(n) {
  const num = Math.max(0, Number(n) || 0);
  return `V-${String(num).padStart(3, '0')}`;
}

export function salesAccountClienteLabel(order) {
  const name = String(order?.customer_name || '').trim();
  if (name) return name;
  const table = String(order?.table_number || '').trim();
  if (order?.type === 'dine_in' && table) return `Mesa ${table}`;
  if (order?.type === 'delivery') return 'Delivery';
  if (order?.type === 'pickup') return 'Para llevar';
  return 'Mostrador';
}

function accountSaleNumber(account) {
  const orders = account?.orders || (account?.primary ? [account.primary] : []);
  const nums = orders
    .map((o) => Number(o.sale_number || 0))
    .filter((n) => n > 0);
  if (nums.length) return Math.min(...nums);
  const fallback = orders
    .filter((o) => !isCourtesyOrder(o))
    .map((o) => Number(o.order_number || 0))
    .filter((n) => n > 0);
  return fallback.length ? Math.min(...fallback) : 0;
}

function accountEventAt(account) {
  return account?.paidAt || account?.latestAt || account?.primary?.paid_at
    || account?.primary?.updated_at || account?.primary?.created_at || '';
}

export function mapAccountToDetalleVentaRow(account, { formatDate } = {}) {
  const o = account?.primary || (account?.orders || [])[0] || {};
  const orders = account?.orders?.length ? account.orders : [o];
  const salesOrders = orders.filter((ord) => !isCourtesyOrder(ord));
  const courtesyOrders = orders.filter(isCourtesyOrder);
  const moneyOrders = salesOrders.length ? salesOrders : orders;
  const subtotal = moneyOrders.reduce((s, ord) => s + Number(ord.subtotal || 0), 0);
  const descuento = moneyOrders.reduce((s, ord) => (
    isDiscountOrder(ord) ? s + Number(ord.discount || 0) : s
  ), 0);
  const cortesia = courtesyOrders.reduce((s, ord) => s + courtesyReferenceAmount(ord), 0);
  const total = salesOrders.reduce((s, ord) => s + Number(ord.total || 0), 0);
  const fechaRaw = accountEventAt(account);
  return {
    fecha: formatDate ? formatDate(fechaRaw) : String(fechaRaw || '').slice(0, 10),
    sortAt: new Date(fechaRaw || 0).getTime() || 0,
    saleNumber: accountSaleNumber(account),
    nroVenta: formatSaleNumero(accountSaleNumber(account)),
    cliente: salesAccountClienteLabel(o),
    usuario: String(o.created_by_user_name || '').trim() || '—',
    subtotal,
    descuento,
    cortesia,
    total,
    mesaLabel: o?.type === 'dine_in' && o?.table_number ? formatMesaLabel(o.table_number) : '',
  };
}

function sortDetalleRows(rows) {
  return [...(rows || [])].sort((a, b) => {
    if (a.sortAt !== b.sortAt) return a.sortAt - b.sortAt;
    return Number(a.saleNumber || 0) - Number(b.saleNumber || 0);
  });
}

export function buildDetalleVentasExcelHtml({ periodLabel, usuario, rows } = {}) {
  const data = sortDetalleRows(rows);
  let sumSub = 0;
  let sumDisc = 0;
  let sumCour = 0;
  let sumTot = 0;
  const excelRows = data.map((row) => {
    sumSub += Number(row.subtotal || 0);
    sumDisc += Number(row.descuento || 0);
    sumCour += Number(row.cortesia || 0);
    sumTot += Number(row.total || 0);
    return [
      { text: row.fecha, align: 'left' },
      { text: row.nroVenta, align: 'left' },
      { text: row.cliente, align: 'left' },
      { text: row.usuario, align: 'left' },
      { text: formatSolesExcel(row.subtotal), align: 'right' },
      { text: formatSolesExcel(row.descuento), align: 'right' },
      { text: formatSolesExcel(row.cortesia), align: 'right' },
      { text: formatSolesExcel(row.total), align: 'right' },
    ];
  });
  return buildStyledInformeExcelHtml({
    title: 'DETALLE DE VENTAS',
    sheetName: 'Ventas',
    periodLabel: periodLabel || '—',
    usuario: usuario || '—',
    headers: [
      { label: 'Fecha', width: 90 },
      { label: 'N.º Venta', width: 80 },
      { label: 'Cliente', width: 160 },
      { label: 'Usuario', width: 120 },
      { label: 'Subtotal', width: 100 },
      { label: 'Descuento', width: 100 },
      { label: 'Cortesía', width: 100 },
      { label: 'Total', width: 100 },
    ],
    rows: excelRows,
    totalCells: [
      { text: 'TOTAL', align: 'left' },
      { text: '', align: 'left' },
      { text: '', align: 'left' },
      { text: '', align: 'left' },
      { text: formatSolesExcel(sumSub), align: 'right' },
      { text: formatSolesExcel(sumDisc), align: 'right' },
      { text: formatSolesExcel(sumCour), align: 'right' },
      { text: formatSolesExcel(sumTot), align: 'right' },
    ],
  });
}

export function buildDetalleVentasCsv({ periodLabel, usuario, rows } = {}) {
  const data = sortDetalleRows(rows);
  const table = [
    ['DETALLE DE VENTAS'],
    ['Periodo', periodLabel || '—'],
    ['Usuario', usuario || '—'],
    [],
    ['Fecha', 'N.º Venta', 'Cliente', 'Usuario', 'Subtotal', 'Descuento', 'Cortesía', 'Total'],
  ];
  let sumSub = 0;
  let sumDisc = 0;
  let sumCour = 0;
  let sumTot = 0;
  data.forEach((row) => {
    sumSub += Number(row.subtotal || 0);
    sumDisc += Number(row.descuento || 0);
    sumCour += Number(row.cortesia || 0);
    sumTot += Number(row.total || 0);
    table.push([
      row.fecha,
      row.nroVenta,
      row.cliente,
      row.usuario,
      formatSoles(row.subtotal),
      formatSoles(row.descuento),
      formatSoles(row.cortesia),
      formatSoles(row.total),
    ]);
  });
  if (!data.length) {
    table.push(['(Sin ventas en el periodo)', '', '', '', '', '', '', '']);
  }
  table.push([
    'TOTAL',
    '',
    '',
    '',
    formatSoles(sumSub),
    formatSoles(sumDisc),
    formatSoles(sumCour),
    formatSoles(sumTot),
  ]);
  return csvTable(table);
}

export function buildDetalleVentasTxt({ periodLabel, usuario, rows } = {}) {
  const data = sortDetalleRows(rows);
  const title = 'DETALLE DE VENTAS';
  const lines = [title, '='.repeat(title.length), ''];
  lines.push(`Periodo: ${periodLabel || '—'}`);
  lines.push(`Usuario: ${usuario || '—'}`);
  lines.push('');
  if (data.length) {
    lines.push(...buildFixedWidthTable({
      headers: ['Fecha', 'N.º Venta', 'Cliente', 'Usuario', 'Subtotal', 'Descuento', 'Cortesía', 'Total'],
      widths: [12, 10, 22, 16, 12, 12, 12, 12],
      aligns: ['left', 'left', 'left', 'left', 'right', 'right', 'right', 'right'],
      rows: data.map((row) => [
        row.fecha,
        row.nroVenta,
        row.cliente,
        row.usuario,
        formatSoles(row.subtotal),
        formatSoles(row.descuento),
        formatSoles(row.cortesia),
        formatSoles(row.total),
      ]),
    }));
    const sumSub = data.reduce((s, r) => s + Number(r.subtotal || 0), 0);
    const sumDisc = data.reduce((s, r) => s + Number(r.descuento || 0), 0);
    const sumCour = data.reduce((s, r) => s + Number(r.cortesia || 0), 0);
    const sumTot = data.reduce((s, r) => s + Number(r.total || 0), 0);
    lines.push('');
    lines.push(`TOTAL  Subtotal ${formatSoles(sumSub)}  Descuento ${formatSoles(sumDisc)}  Cortesía ${formatSoles(sumCour)}  Total ${formatSoles(sumTot)}`);
  } else {
    lines.push('(Sin ventas en el periodo)');
  }
  return `${lines.join('\n')}\n`;
}

function accountDestino(order) {
  const table = String(order?.table_number || '').trim();
  const isMesa = order?.type === 'dine_in' && table;
  if (isMesa) return `Mesa ${table}`;
  if (order?.type === 'delivery') return 'Delivery';
  if (order?.type === 'pickup') return 'Para llevar';
  return order?.customer_name || 'Mostrador';
}

export function mapSalesAccountExportRow(account, { formatDate, formatTime } = {}) {
  const o = account?.primary;
  const table = String(o?.table_number || '').trim();
  const isMesa = o?.type === 'dine_in' && table;
  const payment = PAYMENT_METHOD_LABELS[String(o?.payment_method || 'efectivo')] || o?.payment_method || '—';
  const cobroHora = formatTime ? formatTime(account.paidAt) : '';
  const cobroFecha = formatDate ? formatDate(account.paidAt) : '';
  return {
    destino: accountDestino(o),
    mesaLabel: isMesa ? formatMesaLabel(table) : '',
    estado: account?.observations?.observed ? 'Observado' : 'Correcto',
    cobro: [cobroHora, cobroFecha].filter(Boolean).join(' '),
    pago: payment,
    total: Number(account?.total || 0),
  };
}

export function buildDailySalesDownloadBaseName(dateKey) {
  const key = String(dateKey || '').slice(0, 10) || 'dia';
  return `detalle-ventas-${key}`;
}

export function buildMonthlySalesDownloadBaseName(monthKey) {
  const key = String(monthKey || '').slice(0, 7) || 'mes';
  return `detalle-ventas-${key}`;
}

export function monthDateRangeLabel(monthKey, formatDate) {
  const key = String(monthKey || '').slice(0, 7);
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return key || '—';
  const last = new Date(y, m, 0).getDate();
  const from = `${key}-01`;
  const to = `${key}-${String(last).padStart(2, '0')}`;
  if (!formatDate) return `${from} - ${to}`;
  return `${formatDate(from)} - ${formatDate(to)}`;
}

export function buildDailySalesCsv(dailyData, accounts, { periodLabel, usuario } = {}) {
  return buildDetalleVentasCsv({ periodLabel: periodLabel || dailyData?.date, usuario, rows: accounts });
}

export function buildDailySalesTxt(dailyData, accounts, { periodLabel, usuario } = {}) {
  return buildDetalleVentasTxt({ periodLabel: periodLabel || dailyData?.date, usuario, rows: accounts });
}

export function buildMonthlySalesCsv(monthlyData, { periodLabel, usuario, rows } = {}) {
  return buildDetalleVentasCsv({ periodLabel: periodLabel || monthlyData?.month, usuario, rows });
}

export function buildMonthlySalesTxt(monthlyData, { periodLabel, usuario, rows } = {}) {
  return buildDetalleVentasTxt({ periodLabel: periodLabel || monthlyData?.month, usuario, rows });
}
