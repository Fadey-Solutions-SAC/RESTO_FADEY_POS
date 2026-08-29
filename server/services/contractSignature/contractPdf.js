/**
 * PDF definitivo del contrato (fase 2). El hash de firma es SHA-256 de estos bytes.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const { getUploadsRoot, ensureUploadsRoot } = require('../../uploadsPath');

function contractsDir() {
  const root = ensureUploadsRoot();
  const dir = path.join(root, 'contracts');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function hashBuffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * @returns {Promise<{ absolutePath: string, publicUrl: string, documentHash: string, bytes: Buffer }>}
 */
function generateContractPdf({ texto, version, title = 'Contrato de servicio' }) {
  const body = String(texto || '').trim();
  if (!body) {
    const err = new Error('Sin texto para generar el PDF del contrato');
    err.status = 400;
    throw err;
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 56,
      size: 'A4',
      info: {
        Title: title,
        Author: 'RESTO FADEY.POS',
        Subject: `Contrato digital v${Number(version) || 1}`,
      },
    });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('error', reject);
    doc.on('end', () => {
      try {
        const bytes = Buffer.concat(chunks);
        const documentHash = hashBuffer(bytes);
        const fileName = `contrato-v${Number(version) || 1}-${documentHash.slice(0, 12)}.pdf`;
        const absolutePath = path.join(contractsDir(), fileName);
        fs.writeFileSync(absolutePath, bytes);
        resolve({
          absolutePath,
          publicUrl: `/uploads/contracts/${fileName}`,
          documentHash,
          bytes,
        });
      } catch (e) {
        reject(e);
      }
    });

    doc.font('Helvetica-Bold').fontSize(14).text(title, { align: 'center' });
    doc.moveDown(0.4);
    doc.font('Helvetica').fontSize(9).fillColor('#444444')
      .text(`Versión ${Number(version) || 1} · Documento definitivo para firma digital`, { align: 'center' });
    doc.moveDown(1);
    doc.fillColor('#000000').font('Helvetica').fontSize(10)
      .text(body, { align: 'left', lineGap: 2 });
    doc.moveDown(1.5);
    doc.fontSize(8).fillColor('#666666')
      .text('Este PDF es la versión bloqueada para firma. El PIN del DNIe no se transmite al servidor.', {
        align: 'left',
      });
    doc.end();
  });
}

/**
 * PDF firmado: copia del original + página de evidencias (metadatos; sin PIN).
 */
function writeSignedContractPdf({ originalPath, version, firmas = [] }) {
  return new Promise((resolve, reject) => {
    const src = String(originalPath || '');
    if (!src || !fs.existsSync(src)) {
      resolve({ publicUrl: '', documentHash: '' });
      return;
    }

    const doc = new PDFDocument({ margin: 56, size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('error', reject);
    doc.on('end', () => {
      try {
        const bytes = Buffer.concat(chunks);
        const documentHash = hashBuffer(bytes);
        const fileName = `contrato-firmado-v${Number(version) || 1}-${Date.now().toString(36)}.pdf`;
        const absolutePath = path.join(contractsDir(), fileName);
        fs.writeFileSync(absolutePath, bytes);
        resolve({
          absolutePath,
          publicUrl: `/uploads/contracts/${fileName}`,
          documentHash,
        });
      } catch (e) {
        reject(e);
      }
    });

    // Contenido original como texto no re-embebido (pdfkit no mergea fácilmente);
    // incluimos aviso + metadatos de firma. El hash firmado sigue siendo el del PDF original.
    doc.font('Helvetica-Bold').fontSize(14).text('Contrato firmado digitalmente', { align: 'center' });
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(9).fillColor('#444')
      .text('Evidencia de firmas DNIe/NFC. El PIN nunca se almacena en este sistema.', { align: 'center' });
    doc.moveDown(1);
    doc.fillColor('#000').fontSize(10);
    for (const f of firmas) {
      doc.font('Helvetica-Bold').text(String(f.title || f.party || 'Firma'));
      doc.font('Helvetica').fontSize(9);
      doc.text(`Firmante: ${f.signer_name || '—'}`);
      doc.text(`Documento: ${f.document_number || '—'}`);
      doc.text(`Fecha: ${f.signed_at || '—'}`);
      doc.text(`Certificado: ${f.certificate_serial || '—'}`);
      doc.text(`Algoritmo: ${f.signature_algorithm || '—'}`);
      doc.text(`Validación: ${f.validation_status || '—'}`);
      doc.text(`Mock: ${f.mock ? 'sí' : 'no'}`);
      doc.moveDown(0.8);
    }
    doc.fontSize(8).fillColor('#666')
      .text(`PDF original en disco: ${path.basename(src)} · versión ${Number(version) || 1}`);
    doc.end();
  });
}

function resolveContractPdfAbsolute(publicUrl) {
  const u = String(publicUrl || '').trim();
  if (!u.startsWith('/uploads/contracts/')) return '';
  const name = path.basename(u);
  const full = path.join(getUploadsRoot(), 'contracts', name);
  return fs.existsSync(full) ? full : '';
}

function hashPdfFile(absolutePath) {
  if (!absolutePath || !fs.existsSync(absolutePath)) return '';
  return hashBuffer(fs.readFileSync(absolutePath));
}

module.exports = {
  generateContractPdf,
  writeSignedContractPdf,
  resolveContractPdfAbsolute,
  hashPdfFile,
  hashBuffer,
};
