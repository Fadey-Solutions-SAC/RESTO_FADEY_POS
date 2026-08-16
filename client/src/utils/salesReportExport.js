import { buildFixedWidthTable } from './fixedWidthTxt';
import { formatMesaLabel } from './mesaOrderLines';

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
  return `informe-ventas-${key}`;
}

export function buildMonthlySalesDownloadBaseName(monthKey) {
  const key = String(monthKey || '').slice(0, 7) || 'mes';
  return `informe-ventas-${key}`;
}

export function buildDailySalesCsv(dailyData, accounts, { periodLabel } = {}) {
  const sales = dailyData?.sales || {};
  const adj = dailyData?.adjustments || {};
  const caja = dailyData?.is_today === false
    ? ''
    : (dailyData?.register_open ? 'Abierta' : 'Cerrada');
  const rows = [
    ['INFORME DE VENTAS DEL DIA'],
    ['Periodo', periodLabel || dailyData?.date || ''],
  ];
  if (caja) rows.push(['Caja', caja]);
  rows.push([]);
  rows.push(['Resumen', 'Valor']);
  rows.push(['Ventas', money(sales.total_sales)]);
  rows.push(['Cuentas cobradas', Number(sales.order_count || 0)]);
  rows.push(['IGV', money(sales.total_tax)]);
  rows.push(['Descuentos (ref. informativo)', money(adj.discount_amount_total)]);
  rows.push(['Cortesias (ref. informativo)', money(adj.courtesy_reference_total)]);
  rows.push(['Propinas', money(sales.total_tips)]);
  rows.push([]);
  rows.push(['Mesa / Destino', 'Estado', 'Cobro', 'Pago', 'Total cuenta']);
  (accounts || []).forEach((row) => {
    rows.push([
      row.mesaLabel ? `${row.destino} (${row.mesaLabel})` : row.destino,
      row.estado,
      row.cobro,
      row.pago,
      money(row.total),
    ]);
  });
  if (!(accounts || []).length) rows.push(['(Sin cuentas en el periodo)', '', '', '', '']);
  return csvTable(rows);
}

export function buildDailySalesTxt(dailyData, accounts, { periodLabel, formatCurrency } = {}) {
  const sales = dailyData?.sales || {};
  const adj = dailyData?.adjustments || {};
  const title = 'INFORME DE VENTAS DEL DIA';
  const lines = [title, '='.repeat(title.length), ''];
  lines.push(`Periodo: ${periodLabel || dailyData?.date || '—'}`);
  if (dailyData?.is_today !== false) {
    lines.push(`Caja: ${dailyData?.register_open ? 'Abierta' : 'Cerrada'}`);
  }
  lines.push('');
  lines.push('RESUMEN');
  lines.push('-'.repeat(40));
  const fmt = formatCurrency || ((v) => money(v));
  lines.push(`Ventas:                    ${fmt(sales.total_sales)}`);
  lines.push(`Cuentas cobradas:          ${Number(sales.order_count || 0)}`);
  lines.push(`IGV:                       ${fmt(sales.total_tax)}`);
  lines.push(`Descuentos (ref.):         ${fmt(adj.discount_amount_total)}`);
  lines.push(`Cortesias (ref.):          ${fmt(adj.courtesy_reference_total)}`);
  lines.push(`Propinas:                  ${fmt(sales.total_tips)}`);
  lines.push('');
  lines.push('CUENTAS DEL DIA');
  if ((accounts || []).length) {
    lines.push(...buildFixedWidthTable({
      headers: ['Mesa / Destino', 'Estado', 'Cobro', 'Pago', 'Total'],
      widths: [22, 12, 28, 12, 12],
      aligns: ['left', 'left', 'left', 'left', 'right'],
      rows: accounts.map((row) => [
        row.mesaLabel ? `${row.destino} (${row.mesaLabel})` : row.destino,
        row.estado,
        row.cobro,
        row.pago,
        fmt(row.total),
      ]),
    }));
  } else {
    lines.push('(Sin cuentas en el periodo)');
  }
  return `${lines.join('\n')}\n`;
}

export function buildMonthlySalesCsv(monthlyData, { periodLabel, formatDate } = {}) {
  const total = monthlyData?.totalMonth || {};
  const days = monthlyData?.dailySales || [];
  const rows = [
    ['INFORME DE VENTAS DEL MES'],
    ['Periodo', periodLabel || monthlyData?.month || ''],
    [],
    ['Resumen', 'Valor'],
    ['Ventas del mes', money(total.total)],
    ['Cuentas cobradas', Number(total.orders || 0)],
    ['IGV del mes', money(total.tax)],
    ['Cajas cerradas', Number(monthlyData?.closedRegistersMonth || 0)],
    [],
    ['Fecha', 'Cuentas', 'IGV', 'Ventas'],
  ];
  [...days].sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))).forEach((day) => {
    rows.push([
      formatDate ? formatDate(day.date) : day.date,
      Number(day.orders || 0),
      money(day.tax),
      money(day.total),
    ]);
  });
  if (!days.length) rows.push(['(Sin ventas en el periodo)', '', '', '']);
  return csvTable(rows);
}

export function buildMonthlySalesTxt(monthlyData, { periodLabel, formatCurrency, formatDate } = {}) {
  const total = monthlyData?.totalMonth || {};
  const days = monthlyData?.dailySales || [];
  const title = 'INFORME DE VENTAS DEL MES';
  const lines = [title, '='.repeat(title.length), ''];
  lines.push(`Periodo: ${periodLabel || monthlyData?.month || '—'}`);
  lines.push('');
  lines.push('RESUMEN');
  lines.push('-'.repeat(40));
  const fmt = formatCurrency || ((v) => money(v));
  lines.push(`Ventas del mes:            ${fmt(total.total)}`);
  lines.push(`Cuentas cobradas:          ${Number(total.orders || 0)}`);
  lines.push(`IGV del mes:               ${fmt(total.tax)}`);
  lines.push(`Cajas cerradas:            ${Number(monthlyData?.closedRegistersMonth || 0)}`);
  lines.push('');
  lines.push('VENTAS DIARIAS DEL MES');
  if (days.length) {
    const sorted = [...days].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    lines.push(...buildFixedWidthTable({
      headers: ['Fecha', 'Cuentas', 'IGV', 'Ventas'],
      widths: [16, 10, 14, 14],
      aligns: ['left', 'right', 'right', 'right'],
      rows: sorted.map((day) => [
        formatDate ? formatDate(day.date) : day.date,
        Number(day.orders || 0),
        fmt(day.tax),
        fmt(day.total),
      ]),
    }));
  } else {
    lines.push('(Sin ventas en el periodo)');
  }
  return `${lines.join('\n')}\n`;
}
