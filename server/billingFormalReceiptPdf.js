/**
 * Representación impresa formal (ticket 80 mm) para boleta/factura cuando el asistente
 * no entrega PDF (p. ej. Android). Replica `server/efact/restaurant_efact/pdf_generator.py`.
 */

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

const MM = 72 / 25.4;

function round2(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

function monto(n) {
  return round2(n).toFixed(2);
}

/** Mismo criterio que `_calc_lineas` del bot Python. */
function calcularTotalesVenta(sale) {
  const rate = Number(sale?.porcentaje_igv ?? 18) / 100;
  let opGravadas = 0;
  let opExoneradas = 0;
  let opInafectas = 0;
  let igv = 0;
  for (const ln of sale?.lineas || []) {
    const ext = round2(Number(ln.cantidad || 0) * Number(ln.precio_unitario_sin_igv || 0));
    const code = String(ln.codigo_afectacion_igv || '10');
    if (code === '10') {
      opGravadas += ext;
      igv += round2(ext * rate);
    } else if (code === '30') {
      opInafectas += ext;
    } else {
      opExoneradas += ext;
    }
  }
  const total = round2(opGravadas + opExoneradas + opInafectas + igv);
  return {
    opGravadas: round2(opGravadas),
    opExoneradas: round2(opExoneradas),
    opInafectas: round2(opInafectas),
    igv: round2(igv),
    total,
  };
}

/** DigestValue de la referencia al documento (URI=""), como `_digest_value` en main.py. */
function digestFromSignedXml(xml) {
  const s = Buffer.isBuffer(xml) ? xml.toString('utf8') : String(xml || '');
  if (!s) return '';
  const refRe = /<(?:\w+:)?Reference\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?Reference>/g;
  let m;
  while ((m = refRe.exec(s))) {
    const uri = (/URI="([^"]*)"/.exec(m[1]) || [])[1] ?? '';
    if (uri !== '' && uri !== '#') continue;
    const d = /<(?:\w+:)?DigestValue>\s*([^<\s]+)\s*</.exec(m[2]);
    if (d) return d[1];
  }
  const any = /<(?:\w+:)?DigestValue>\s*([^<\s]+)\s*</.exec(s);
  return any ? any[1] : '';
}

/** RUC|tipo|serie|número|IGV|total|fecha|tipo doc cliente|número cliente|hash. */
function codigoQrSunat(sale, digest) {
  const t = calcularTotalesVenta(sale);
  return [
    String(sale?.emisor?.ruc || ''),
    String(sale?.tipo || ''),
    String(sale?.serie || ''),
    String(parseInt(sale?.correlativo, 10) || 0),
    t.igv.toFixed(2),
    t.total.toFixed(2),
    String(sale?.fecha_emision || ''),
    String(sale?.cliente?.tipo_doc || ''),
    String(sale?.cliente?.numero_doc || ''),
    String(digest || '').trim(),
  ].join('|');
}

function numeroCompleto(sale) {
  const corr = String(parseInt(sale?.correlativo, 10) || 0).padStart(8, '0');
  return `${String(sale?.serie || '').trim()}-${corr}`;
}

/**
 * @param {object} sale Venta en formato del bot (`buildEfactSaleJson`).
 * @param {{ digest?: string }} [opts]
 * @returns {Promise<Buffer>}
 */
async function buildFormalReceiptPdfBuffer(sale, { digest = '' } = {}) {
  const lineas = Array.isArray(sale?.lineas) ? sale.lineas : [];
  const pageW = 80 * MM;
  const pageH = (200 + Math.max(0, lineas.length - 1) * 7) * MM;
  const margin = 3.5 * MM;
  const usable = pageW - margin * 2;
  const moneda = String(sale?.moneda || 'PEN');
  const qrText = codigoQrSunat(sale, digest);

  let qrPng = null;
  try {
    qrPng = await QRCode.toBuffer(qrText, { type: 'png', margin: 4, scale: 4, errorCorrectionLevel: 'M' });
  } catch (e) {
    console.warn('[billing-formal-pdf] QR:', e.message || e);
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({
      size: [pageW, pageH],
      margin,
      info: { Title: numeroCompleto(sale) },
    });
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const x = margin;
    const center = (text, { bold = false, size = 8 } = {}) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size)
        .text(text, x, doc.y, { width: usable, align: 'center', lineGap: 1 });
    };
    const labelLine = (label, value) => {
      doc.fontSize(7.5).font('Helvetica-Bold').text(`${label} `, x, doc.y, { width: usable, continued: true, lineGap: 1 });
      doc.font('Helvetica').text(String(value ?? ''));
    };
    const plain = (text) => {
      doc.font('Helvetica').fontSize(7.5).text(String(text ?? ''), x, doc.y, { width: usable, lineGap: 1 });
    };
    const gap = (mm = 2) => { doc.y += mm * MM; };

    const titulo = String(sale?.tipo) === '01' ? 'FACTURA ELECTRÓNICA' : 'BOLETA DE VENTA ELECTRÓNICA';
    center(titulo, { bold: true, size: 9 });
    gap();

    const e = sale?.emisor || {};
    const nc = String(e.nombre_comercial || '').trim();
    const rs = String(e.razon_social || '').trim();
    if (nc && nc.toUpperCase() !== rs.toUpperCase()) center(nc, { bold: true });
    if (rs) center(rs, { bold: true });
    if (e.ruc) center(`RUC: ${e.ruc}`);
    if (e.direccion) center(String(e.direccion));
    const geo = [e.distrito, e.provincia, e.departamento].map((p) => String(p || '').trim()).filter(Boolean).join(' — ');
    if (geo) center(geo);
    if (String(e.telefono || '').trim()) center(`Tel: ${String(e.telefono).trim()}`);
    if (String(e.correo || '').trim()) center(`Correo: ${String(e.correo).trim()}`);
    gap();

    labelLine('Comprobante:', numeroCompleto(sale));
    labelLine('Fecha:', `${sale?.fecha_emision || ''} ${sale?.hora_emision || ''}`.trim());
    labelLine('Moneda:', moneda);
    gap();

    const c = sale?.cliente || {};
    doc.font('Helvetica-Bold').fontSize(7.5).text('Cliente', x, doc.y, { width: usable });
    plain(c.razon_social || '—');
    plain(`Doc: (${c.tipo_doc || ''}) ${c.numero_doc || ''}`);
    if (String(c.direccion || '').trim()) plain(c.direccion);
    gap();

    const cols = [usable * 0.14, usable * 0.46, usable * 0.20, usable * 0.20];
    const pad = 1.5;
    const drawRow = (cells, { header = false } = {}) => {
      doc.font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(7);
      const heights = cells.map((t, i) => doc.heightOfString(String(t), { width: cols[i] - pad * 2 }));
      const h = Math.max(...heights) + pad * 2;
      const y = doc.y;
      if (header) doc.save().rect(x, y, usable, h).fill('#808080').restore();
      let cx = x;
      cells.forEach((t, i) => {
        doc.save().lineWidth(0.3).strokeColor('#000').rect(cx, y, cols[i], h).stroke().restore();
        doc.fillColor(header ? '#f5f5f5' : '#000')
          .text(String(t), cx + pad, y + pad, { width: cols[i] - pad * 2 });
        cx += cols[i];
      });
      doc.fillColor('#000');
      doc.y = y + h;
    };
    drawRow(['Cant.', 'Descripción', 'P. unit.', 'Total'], { header: true });
    for (const ln of lineas) {
      const qty = Number(ln.cantidad || 0);
      const pu = Number(ln.precio_unitario_sin_igv || 0);
      drawRow([monto(qty), String(ln.descripcion || '').slice(0, 80), monto(pu), monto(qty * pu)]);
    }
    gap();

    const t = calcularTotalesVenta(sale);
    if (t.opGravadas) labelLine('Op. gravadas:', `${moneda} ${monto(t.opGravadas)}`);
    if (t.opExoneradas) labelLine('Op. exoneradas:', `${moneda} ${monto(t.opExoneradas)}`);
    if (t.opInafectas) labelLine('Op. inafectas:', `${moneda} ${monto(t.opInafectas)}`);
    if (t.igv) labelLine(`IGV (${monto(sale?.porcentaje_igv ?? 18)}%):`, `${moneda} ${monto(t.igv)}`);
    labelLine('Total:', `${moneda} ${monto(t.total)}`);
    gap();

    if (qrPng) {
      const side = Math.min(usable * 0.62, 46 * MM);
      doc.image(qrPng, x + (usable - side) / 2, doc.y, { width: side, height: side });
      doc.y += side + 1.5 * MM;
      center('Código QR de consulta de validez SUNAT');
      gap(1.5);
    }
    if (String(digest || '').trim()) {
      center(`Hash: ${String(digest).trim()}`, { size: 6.5 });
      gap(1.5);
    }
    center('Representación impresa. Conserve su comprobante.');

    doc.end();
  });
}

/**
 * Escribe el PDF formal en un archivo temporal y devuelve su ruta (o '').
 */
async function writeFormalReceiptPdfTemp(sale, digest, dir) {
  try {
    const buf = await buildFormalReceiptPdfBuffer(sale, { digest });
    const dest = path.join(dir, `formal-${Date.now()}.pdf`);
    fs.writeFileSync(dest, buf);
    return dest;
  } catch (e) {
    console.warn('[billing-formal-pdf]', e.message || e);
    return '';
  }
}

module.exports = {
  buildFormalReceiptPdfBuffer,
  writeFormalReceiptPdfTemp,
  digestFromSignedXml,
  codigoQrSunat,
  calcularTotalesVenta,
};
