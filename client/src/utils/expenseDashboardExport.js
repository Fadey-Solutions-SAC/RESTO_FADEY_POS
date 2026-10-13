import { downloadBlobFile, downloadExcelFile } from './inventoryCuadreExport';
import { exportReportPdf } from './fadeyReportExport';

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(value) {
  return `S/ ${Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function baseName(data) {
  return `gastos-${data?.period?.from || 'inicio'}-${data?.period?.to || 'fin'}`;
}

export function exportExpenseDashboardExcel(data, { restaurant = '', user = '' } = {}) {
  const summaryRows = (data?.summary?.by_category || []).map((row) => `
    <tr><td>${esc(row.name)}</td><td class="num">${row.operations}</td><td class="num">${esc(money(row.amount))}</td><td class="num">${row.percentage.toFixed(2)}%</td></tr>
  `).join('');
  const detailRows = (data?.rows || []).map((row, index) => `
    <tr>
      <td class="num">${index + 1}</td><td>${esc(row.date_key)}</td><td>${esc(row.category_name)}</td>
      <td>${esc(row.concept)}</td><td class="num">${row.quantity}</td><td class="num">${esc(money(row.unit_cost))}</td>
      <td class="num">${esc(money(row.total))}</td><td>${esc(row.user_name)}</td><td>${esc(row.provider || '')}</td>
      <td>${esc(row.notes || '')}</td>
    </tr>
  `).join('');
  const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8" />
  <style>
    body{font-family:Calibri,Arial,sans-serif;font-size:11pt} table{border-collapse:collapse;margin-bottom:18px}
    th{background:#1F4E79;color:#fff;font-weight:bold} th,td{border:1px solid #808080;padding:5px 7px}
    .title{background:#1F4E79;color:#fff;font-size:16pt;font-weight:bold;text-align:center}.label{background:#BDD7EE;font-weight:bold}
    .num{text-align:right;mso-number-format:"0.00"}.total{background:#FFE699;font-weight:bold}
  </style></head><body>
  <table><tr><td class="title" colspan="4">CONTROL DE RECURSOS — GASTOS</td></tr>
  <tr><td class="label">Restaurante</td><td colspan="3">${esc(restaurant || 'Resto Fadey')}</td></tr>
  <tr><td class="label">Periodo</td><td colspan="3">${esc(data.period.from)} — ${esc(data.period.to)}</td></tr>
  <tr><td class="label">Generado por</td><td colspan="3">${esc(user || '—')}</td></tr>
  <tr><th>Categoría</th><th>Operaciones</th><th>Importe</th><th>Porcentaje</th></tr>${summaryRows}
  <tr><td class="total">TOTAL</td><td class="num total">${data.summary.operations}</td><td class="num total">${esc(money(data.summary.total))}</td><td class="num total">100%</td></tr></table>
  <table><tr><th>#</th><th>Fecha</th><th>Categoría</th><th>Producto / concepto</th><th>Cantidad</th><th>Precio unitario</th><th>Total</th><th>Usuario</th><th>Proveedor</th><th>Nota</th></tr>
  ${detailRows}<tr><td class="total" colspan="6">TOTAL</td><td class="num total">${esc(money(data.summary.total))}</td><td colspan="3"></td></tr></table>
  </body></html>`;
  downloadExcelFile(baseName(data), html);
}

export function exportExpenseDashboardTxt(data, { restaurant = '', user = '' } = {}) {
  const lines = [
    'CONTROL DE RECURSOS — GASTOS',
    `Restaurante: ${restaurant || 'Resto Fadey'}`,
    `Periodo: ${data.period.from} — ${data.period.to}`,
    `Generado por: ${user || '—'}`,
    '',
    'RESUMEN',
    ...(data.summary.by_category || []).map((row) => `${row.name}: ${money(row.amount)} (${row.percentage.toFixed(2)}%) · ${row.operations} operación(es)`),
    `TOTAL: ${money(data.summary.total)}`,
    '',
    'DETALLE',
    ...(data.rows || []).map((row, index) => (
      `${index + 1}. ${row.date_key} | ${row.category_name} | ${row.concept} | ${row.quantity} x ${money(row.unit_cost)} | ${money(row.total)} | ${row.user_name}${row.notes ? ` | ${row.notes}` : ''}`
    )),
    '',
  ];
  downloadBlobFile(`${baseName(data)}.txt`, lines.join('\n'));
}

export function exportExpenseDashboardPdf(data, { restaurant = '', user = '' } = {}) {
  exportReportPdf({
    lang: 'es',
    restaurant: restaurant || 'Resto Fadey',
    title: 'Control de Recursos — Gastos',
    subtitle: `Periodo ${data.period.from} — ${data.period.to} · Generado por ${user || '—'}`,
    from: data.period.from,
    to: data.period.to,
    generated_at: new Date().toISOString(),
    kpis: [
      { label: 'Total de gastos', value: data.summary.total, format: 'money', delta: data.summary.variation_pct },
      ...(data.summary.by_category || []).map((row) => ({
        label: row.name,
        value: row.amount,
        format: 'money',
      })),
    ],
    insights: data.summary.comparison_available
      ? [`Variación de ${Number(data.summary.variation_pct || 0).toFixed(2)}% frente al periodo anterior equivalente.`]
      : ['Sin base de comparación en el periodo anterior equivalente.'],
    charts: [],
    tables: [{
      title: 'Detalle de movimientos',
      columns: [
        { key: 'date_key', label: 'Fecha' },
        { key: 'category_name', label: 'Categoría' },
        { key: 'concept', label: 'Producto / concepto' },
        { key: 'quantity', label: 'Cantidad', format: 'number' },
        { key: 'unit_cost', label: 'Precio unitario', format: 'money' },
        { key: 'total', label: 'Total', format: 'money' },
        { key: 'user_name', label: 'Usuario' },
        { key: 'notes', label: 'Nota' },
      ],
      rows: data.rows || [],
      totals: { concept: 'TOTAL', total: data.summary.total },
    }],
  });
}
