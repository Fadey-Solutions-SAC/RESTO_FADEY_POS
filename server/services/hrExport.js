const PDFDocument = require('pdfkit');
const { queryOne } = require('../database');
const calc = require('./hrAttendanceCalc');

function restaurantHeader() {
  const r = queryOne('SELECT name, address, phone FROM restaurants LIMIT 1');
  return {
    name: r?.name || 'Resto-FADEY',
    address: r?.address || '',
    phone: r?.phone || '',
  };
}

function escapeCsv(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function statusLabel(status) {
  const map = {
    on_time: 'A tiempo',
    late: 'Tardanza',
    late_justified: 'Tardanza justificada',
    open: 'En jornada',
    leave: 'Permiso',
    absent: 'Inasistencia',
  };
  return map[status] || status || '';
}

function buildCsv(report, absences = []) {
  const h = restaurantHeader();
  const lines = [
    `Empresa,${escapeCsv(h.name)}`,
    `Desde,${escapeCsv(report.from)}`,
    `Hasta,${escapeCsv(report.to)}`,
    `Tipo,${escapeCsv(report.kind)}`,
    '',
    'Trabajador,Cargo,Área,Fecha,Ingreso,Salida,Horas (min),Tardanza (min),Extras (min),Estado',
  ];
  for (const r of report.records || []) {
    lines.push([
      escapeCsv(r.full_name),
      escapeCsv(r.position),
      escapeCsv(r.department),
      escapeCsv(r.work_date),
      escapeCsv(r.check_in_at || ''),
      escapeCsv(r.check_out_at || ''),
      Number(r.worked_minutes || 0),
      Number(r.late_minutes || 0),
      Number(r.overtime_minutes || 0),
      escapeCsv(statusLabel(r.status)),
    ].join(','));
  }
  if (absences.length) {
    lines.push('');
    lines.push('=== Inasistencias ===');
    lines.push('Trabajador,Fecha,Estado');
    for (const a of absences) {
      lines.push([escapeCsv(a.full_name), escapeCsv(a.date), escapeCsv(statusLabel(a.status))].join(','));
    }
  }
  lines.push('');
  lines.push('=== Resumen por trabajador ===');
  lines.push('Trabajador,Días,Horas (min),Extras (min),Tardanzas (min),# Tardanzas');
  for (const g of report.by_employee || []) {
    lines.push([
      escapeCsv(g.full_name),
      g.days,
      g.worked_minutes,
      g.overtime_minutes,
      g.late_minutes,
      g.late_count,
    ].join(','));
  }
  return lines.join('\n');
}

function buildExcelXml(report, absences = []) {
  const h = restaurantHeader();
  const rows = [];
  const cell = (v) => `<Cell><Data ss:Type="${typeof v === 'number' ? 'Number' : 'String'}">${String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')}</Data></Cell>`;
  const add = (arr) => rows.push(`<Row>${arr.map(cell).join('')}</Row>`);
  add(['Empresa', h.name]);
  add(['Desde', report.from]);
  add(['Hasta', report.to]);
  add([]);
  add(['Trabajador', 'Cargo', 'Área', 'Fecha', 'Ingreso', 'Salida', 'Horas min', 'Tardanza', 'Extras', 'Estado']);
  for (const r of report.records || []) {
    add([
      r.full_name, r.position || '', r.department || '', r.work_date,
      r.check_in_at || '', r.check_out_at || '',
      Number(r.worked_minutes || 0), Number(r.late_minutes || 0), Number(r.overtime_minutes || 0),
      statusLabel(r.status),
    ]);
  }
  if (absences.length) {
    add([]);
    add(['Inasistencias']);
    for (const a of absences) add([a.full_name, a.date, statusLabel(a.status)]);
  }
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="Asistencia"><Table>
${rows.join('\n')}
</Table></Worksheet></Workbook>`;
}

function buildPdf(report, absences = []) {
  return new Promise((resolve, reject) => {
    const h = restaurantHeader();
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(16).text('Reporte de asistencia — RR. HH.', { continued: false });
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#333')
      .text(`${h.name}`)
      .text(`Período: ${report.from} — ${report.to}`)
      .text(`Tipo: ${report.kind}`)
      .text(`Generado: ${calc.jsNowSql(new Date(), 'America/Lima')}`);
    doc.moveDown();

    doc.fontSize(11).fillColor('#000').text('Resumen por trabajador');
    doc.moveDown(0.4);
    doc.fontSize(9);
    for (const g of report.by_employee || []) {
      doc.text(
        `${g.full_name} · días ${g.days} · trabajado ${calc.minutesToHm(g.worked_minutes)} · extras ${calc.minutesToHm(g.overtime_minutes)} · tardanzas ${g.late_count}`,
      );
    }

    if ((report.records || []).length) {
      doc.moveDown();
      doc.fontSize(11).text('Detalle');
      doc.moveDown(0.3);
      doc.fontSize(8);
      for (const r of (report.records || []).slice(0, 80)) {
        doc.text(
          `${r.work_date} | ${r.full_name} | ${r.check_in_at || '—'} → ${r.check_out_at || '—'} | ${calc.minutesToHm(r.worked_minutes)} | ${statusLabel(r.status)}`,
        );
      }
      if (report.records.length > 80) doc.text(`… y ${report.records.length - 80} filas más (exporte CSV/Excel).`);
    }

    if (absences.length) {
      doc.moveDown();
      doc.fontSize(11).text('Inasistencias');
      doc.fontSize(9);
      for (const a of absences.slice(0, 60)) {
        doc.text(`${a.date} · ${a.full_name}`);
      }
    }

    doc.end();
  });
}

module.exports = {
  buildCsv,
  buildExcelXml,
  buildPdf,
  statusLabel,
  restaurantHeader,
};
