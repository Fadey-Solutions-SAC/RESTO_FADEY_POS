import { resolvePresetBackgroundHref } from '../data/cartaBackgroundPresets.js';
import { buildMenuCartaSvgString } from './generateMenuCartaSvg';

/** A4 a 300 dpi para imprimir. */
export const CARTA_A4_PNG_WIDTH = 2480;
export const CARTA_A4_PNG_HEIGHT = 3508;

function loadSvgImage(svg) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo preparar la carta para PNG'));
    };
    img.src = url;
  });
}

export async function buildMenuCartaPngBlob(opts = {}) {
  const backgroundHref = opts.backgroundHref || await resolvePresetBackgroundHref(opts.presetId);
  const svg = buildMenuCartaSvgString({ ...opts, page: 'a4', backgroundHref });
  const img = await loadSvgImage(svg);
  const canvas = document.createElement('canvas');
  canvas.width = CARTA_A4_PNG_WIDTH;
  canvas.height = CARTA_A4_PNG_HEIGHT;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('No se pudo crear el lienzo A4');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (file) => (file ? resolve(file) : reject(new Error('No se pudo exportar el PNG'))),
      'image/png',
    );
  });
  return blob;
}

export async function downloadMenuCartaPngA4(opts = {}) {
  const blob = await buildMenuCartaPngBlob(opts);
  const title = String(opts.title || 'carta').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'carta';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title}-A4.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return blob;
}
