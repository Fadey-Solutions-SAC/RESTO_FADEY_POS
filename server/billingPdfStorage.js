/**
 * Expone el PDF del comprobante como URL bajo /uploads/... para que el navegador pueda abrirlo.
 * El bot Python suele devolver una ruta absoluta en disco; la copiamos al directorio estático del API.
 */

const fs = require('fs');
const path = require('path');

const { getUploadsRoot } = require('./uploadsPath');
const UPLOADS_ROOT = getUploadsRoot();
const BILLING_PDF_DIR = path.join(UPLOADS_ROOT, 'billing-documents');

function isHttpUrl(s) {
  return /^https?:\/\//i.test(String(s || '').trim());
}

function resolveLocalPath(raw) {
  const t = String(raw || '').trim();
  if (!t || isHttpUrl(t)) return '';
  if (path.isAbsolute(t)) return t;
  return path.resolve(process.cwd(), t);
}

/** Prueba varias rutas: cwd, carpeta del bot Python, etc. */
function findExistingPdfSource(raw) {
  const t = String(raw || '').trim();
  if (!t || isHttpUrl(t)) return '';
  const candidates = [];
  if (path.isAbsolute(t)) candidates.push(t);
  else {
    candidates.push(path.resolve(process.cwd(), t));
    candidates.push(path.join(process.cwd(), 'server', 'efact', t));
    candidates.push(path.join(process.cwd(), 'server', 'efact', t.replace(/^\.\//, '')));
  }
  candidates.push(resolveLocalPath(t));
  const efactBase = path.join(__dirname, '..', 'server', 'efact');
  if (!path.isAbsolute(t)) {
    candidates.push(path.join(efactBase, t));
    candidates.push(path.join(efactBase, t.replace(/^\.\//, '')));
  }
  const seen = new Set();
  for (const c of candidates) {
    if (!c || seen.has(c)) continue;
    seen.add(c);
    if (fs.existsSync(c)) return c;
  }
  return '';
}

/**
 * @param {string} docId — id del registro electronic_documents (UUID)
 * @param {string} pdfUrl — URL https, o ruta de archivo local devuelta por el bot
 * @returns {string} URL relativa para guardar en BD (/uploads/...) o URL absoluta original, o ''
 */
function exportBillingPdfToUploads(docId, pdfUrl) {
  const raw = String(pdfUrl || '').trim();
  if (!raw) return '';
  if (isHttpUrl(raw)) return raw;

  const safeId = String(docId || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeId) return '';

  const src = findExistingPdfSource(raw);
  if (!src) {
    console.warn('[billing-pdf] No se encontró el archivo del bot:', raw);
    return '';
  }

  try {
    if (!fs.existsSync(BILLING_PDF_DIR)) {
      fs.mkdirSync(BILLING_PDF_DIR, { recursive: true });
    }
    const ext = (path.extname(src) || '.pdf').toLowerCase();
    const safeExt = ext === '.pdf' ? '.pdf' : '.pdf';
    const destName = `${safeId}${safeExt}`;
    const dest = path.join(BILLING_PDF_DIR, destName);
    fs.copyFileSync(src, dest);
    const pub = `/uploads/billing-documents/${destName}`;
    console.info('[billing-pdf] Copiado para acceso web:', pub, '←', src);
    return pub;
  } catch (e) {
    console.warn('[billing-pdf] Error al copiar a uploads:', e.message || e);
    return '';
  }
}

function exportBillingFileToUploads(docId, fileUrl, kind = 'file') {
  const raw = String(fileUrl || '').trim();
  if (!raw) return '';
  if (isHttpUrl(raw)) return raw;

  const safeId = String(docId || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeId) return '';

  const src = findExistingPdfSource(raw);
  if (!src) {
    console.warn('[billing-file] No se encontró el archivo del bot:', kind, raw);
    return '';
  }

  try {
    if (!fs.existsSync(BILLING_PDF_DIR)) {
      fs.mkdirSync(BILLING_PDF_DIR, { recursive: true });
    }
    const ext = (path.extname(src) || '').toLowerCase() || (kind === 'pdf' ? '.pdf' : '.xml');
    const suffix = kind === 'pdf' ? '' : `-${kind}`;
    const destName = `${safeId}${suffix}${ext}`;
    const dest = path.join(BILLING_PDF_DIR, destName);
    fs.copyFileSync(src, dest);
    const pub = `/uploads/billing-documents/${destName}`;
    console.info('[billing-file] Copiado para acceso web:', pub, '←', src);
    return pub;
  } catch (e) {
    console.warn('[billing-file] Error al copiar a uploads:', e.message || e);
    return '';
  }
}

module.exports = {
  exportBillingPdfToUploads,
  exportBillingFileToUploads,
  isHttpUrl,
};
