import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

const MAX_PAGES = 40;
const RENDER_SCALE = 2;
const JPEG_QUALITY = 0.92;

function isPdfFile(file) {
  return file?.type === 'application/pdf' || /\.pdf$/i.test(String(file?.name || ''));
}

function cartaNameForPage(baseName, pageIndex, totalPages, rowIndex) {
  const base = String(baseName || `Carta ${rowIndex + 1}`).trim();
  if (totalPages === 1) return base;
  const stem = base.replace(/\s+\d+$/, '').trim() || base;
  if (/^carta$/i.test(stem)) return `Carta ${rowIndex + pageIndex + 1}`;
  return `${stem} ${pageIndex + 1}`;
}

/**
 * Convierte cada página de un PDF multipágina en blobs JPEG.
 * Devuelve null si no es PDF o solo tiene una página (se sube el PDF completo).
 */
export async function extractPdfPageImages(file) {
  if (!isPdfFile(file)) return null;

  const data = await file.arrayBuffer();
  const pdf = await getDocument({ data }).promise;
  const numPages = pdf.numPages;
  if (numPages <= 1) return null;

  const limit = Math.min(numPages, MAX_PAGES);
  const blobs = [];

  for (let pageNum = 1; pageNum <= limit; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('No se pudo preparar el lienzo para el PDF');
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error(`No se pudo exportar la página ${pageNum}`))),
        'image/jpeg',
        JPEG_QUALITY,
      );
    });
    blobs.push(blob);
  }

  if (numPages > MAX_PAGES) {
    throw new Error(`El PDF tiene ${numPages} páginas; el máximo permitido es ${MAX_PAGES}`);
  }

  return blobs;
}

/** Reemplaza una fila de carta con varias entradas (una por página del PDF). */
export function buildCartasFromPdfPages(prev, index, urls, baseName) {
  const newEntries = urls.map((url, pageIndex) => ({
    id: `tmp-${Date.now()}-${pageIndex}`,
    name: cartaNameForPage(baseName, pageIndex, urls.length, index),
    url,
    sort: 0,
  }));
  const next = [...prev.slice(0, index), ...newEntries, ...prev.slice(index + 1)];
  return next.map((c, i) => ({ ...c, sort: i }));
}

export { isPdfFile };
