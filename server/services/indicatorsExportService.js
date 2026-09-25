/**
 * Exportación Indicadores — PDF y CSV con encabezado de empresa.
 */

const PDFDocument = require('pdfkit');
const { queryOne } = require('../database');
const { buildIndicatorsHub } = require('./indicatorsHubService');
const { formatDisplayDateKey: fd, formatLimaSqlDateTime } = require('../utils/appDateTime');

function getRestaurantHeader() {
  const r = queryOne('SELECT name, address, phone FROM restaurants LIMIT 1');
  return {
    name: r?.name || 'Resto-FADEY',
    address: r?.address || '',
    phone: r?.phone || '',
    logo_url: r?.logo_url || '',
  };
}

function escapeCsv(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildCsv(hub, tab) {
  const lines = [];
  const h = getRestaurantHeader();
  lines.push(`Empresa,${escapeCsv(h.name)}`);
  lines.push(`Período,${fd(hub.filters?.from)} — ${fd(hub.filters?.to)}`);
  lines.push(`Generado,${hub.generated_at ? fd(formatLimaSqlDateTime(new Date(hub.generated_at))) : ''}`);
  lines.push('');

  const g = hub.general || {};
  const f = hub.financial || {};
  if (!tab || tab === 'general' || tab === 'all') {
    lines.push('=== Panel general ===');
    lines.push('Métrica,Valor');
    lines.push(`Ventas período,${g.period_sales ?? g.sales_month}`);
    lines.push(`Pedidos período,${g.period_orders ?? g.orders_month}`);
    lines.push(`Ventas hoy,${g.sales_today}`);
    lines.push(`Pedidos activos,${g.active_orders}`);
    lines.push(`Ticket promedio,${g.avg_ticket}`);
    lines.push(`Utilidad neta aprox.,${g.net_profit_approx}`);
    lines.push('');
  }
  if (!tab || tab === 'financiero' || tab === 'all') {
    lines.push('=== Financiero ===');
    lines.push(`Ingresos,${f.total_sales}`);
    lines.push(`Utilidad bruta,${f.gross_profit_approx}`);
    lines.push(`Utilidad neta,${f.net_profit_approx}`);
    lines.push(`Margen %,${f.margin_pct}`);
    (f.payment_methods || []).forEach((p) => {
      lines.push(`Pago ${p.payment_method},${p.total}`);
    });
    lines.push('');
  }
  if (!tab || tab === 'productos' || tab === 'all') {
    lines.push('=== Productos top ===');
    lines.push('Producto,Cantidad,Ingresos');
    (hub.products?.top_sellers || []).forEach((r) => {
      lines.push(`${escapeCsv(r.product_name)},${r.qty},${r.revenue}`);
    });
    lines.push('');
  }
  if (!tab || tab === 'alertas' || tab === 'all') {
    lines.push('=== Alertas ===');
    lines.push('Severidad,Título,Mensaje');
    (hub.alerts || []).forEach((a) => {
      lines.push(`${escapeCsv(a.severity)},${escapeCsv(a.title)},${escapeCsv(a.message)}`);
    });
    lines.push('');
  }
  if (!tab || tab === 'ia' || tab === 'all') {
    lines.push('=== IA Fadey ===');
    (hub.insights || []).forEach((ins) => {
      lines.push(`${escapeCsv(ins.priority)},${escapeCsv(ins.message)}`);
    });
  }
  return '\uFEFF' + lines.join('\n');
}

function streamPdf(hub, tab, res) {
  const h = getRestaurantHeader();
  const doc = new PDFDocument({ margin: 48, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="indicadores-${tab || 'resumen'}.pdf"`);
  doc.pipe(res);

  doc.fontSize(18).text(h.name, { align: 'center' });
  doc.fontSize(10).fillColor('#666').text(h.address || '', { align: 'center' });
  doc.text(`Indicadores · ${fd(hub.filters?.from)} — ${fd(hub.filters?.to)}`, { align: 'center' });
  doc.moveDown();
  doc.fillColor('#000').fontSize(12);

  const g = hub.general || {};
  const f = hub.financial || {};
  if (!tab || tab === 'general' || tab === 'all') {
    doc.fontSize(14).text('Panel general', { underline: true });
    doc.fontSize(11);
    doc.text(`Ventas período: S/ ${Number(g.period_sales ?? 0).toFixed(2)}`);
    doc.text(`Pedidos activos: ${g.active_orders ?? 0}`);
    doc.text(`Mesas ocupadas: ${g.tables_occupied ?? 0}`);
    doc.text(`Delivery activos: ${g.delivery_active ?? 0}`);
    doc.text(`Stock crítico: ${g.critical_stock ?? 0}`);
    doc.moveDown();
  }
  if (!tab || tab === 'financiero' || tab === 'all') {
    doc.fontSize(14).text('Financiero', { underline: true });
    doc.fontSize(11);
    doc.text(`Ingresos: S/ ${Number(f.total_sales || 0).toFixed(2)}`);
    doc.text(`Utilidad neta: S/ ${Number(f.net_profit_approx || 0).toFixed(2)}`);
    doc.text(`Margen: ${f.margin_pct ?? 0}%`);
    doc.moveDown();
  }
  if (!tab || tab === 'ia' || tab === 'all') {
    doc.fontSize(14).text('IA Fadey', { underline: true });
    doc.fontSize(10);
    (hub.insights || []).slice(0, 8).forEach((ins) => {
      doc.text(`• ${ins.message}`);
    });
  }
  doc.end();
}

function exportIndicators(query, res) {
  const format = String(query.format || 'csv').toLowerCase();
  const tab = String(query.tab || 'all').toLowerCase();
  const hub = buildIndicatorsHub(query, { skipCache: true });

  if (format === 'json') {
    res.json(hub);
    return;
  }
  if (format === 'pdf') {
    streamPdf(hub, tab, res);
    return;
  }
  const csv = buildCsv(hub, tab);
  const ext = format === 'xlsx' || format === 'excel' ? 'csv' : 'csv';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="indicadores-${tab}.${ext}"`);
  res.send(csv);
}

module.exports = { exportIndicators, buildCsv, getRestaurantHeader };
