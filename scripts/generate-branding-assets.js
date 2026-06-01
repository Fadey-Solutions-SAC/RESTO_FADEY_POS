/**
 * Genera splash, iconos PWA (nombres nuevos) e iconos de escritorio desde la marca Resto-FADEY.
 * Uso: node scripts/generate-branding-assets.js [ruta-imagen-origen]
 */
const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');

const DEFAULT_SRC = path.join(
  __dirname,
  '..',
  'client',
  'public',
  'branding',
  'resto-fadey-source.png',
);
const PUBLIC = path.join(__dirname, '..', 'client', 'public');
const BRANDING = path.join(PUBLIC, 'branding');
const PWA_ICON_BG = 0x00050dff;

async function composePwaIcon(logo, size) {
  const canvas = new Jimp(size, size, PWA_ICON_BG);
  const logoSize = Math.round(size * 0.84);
  const resized = logo.clone().resize(logoSize, logoSize);
  const x = Math.round((size - logoSize) / 2);
  const y = Math.round((size - logoSize) / 2);
  canvas.composite(resized, x, y);
  return canvas;
}

async function main() {
  const src = path.resolve(process.argv[2] || DEFAULT_SRC);
  if (!fs.existsSync(src)) {
    console.error('No se encontró la imagen origen:', src);
    process.exit(1);
  }
  fs.mkdirSync(BRANDING, { recursive: true });

  const img = await Jimp.read(src);
  const w = img.bitmap.width;
  const h = img.bitmap.height;

  await img.clone().write(path.join(BRANDING, 'resto-fadey-splash.png'));
  await img.clone().write(path.join(PUBLIC, 'resto-fadey-splash.png'));

  const cropSize = Math.round(Math.min(w, h) * 0.56);
  const x = Math.round((w - cropSize) / 2);
  const y = Math.round(h * 0.03);
  const logo = img.clone().crop(x, y, cropSize, cropSize);
  await logo.clone().write(path.join(BRANDING, 'resto-fadey-logo.png'));

  const icon192 = await composePwaIcon(logo, 192);
  const icon512 = await composePwaIcon(logo, 512);

  await icon192.write(path.join(PUBLIC, 'pwa-icon-192.png'));
  await icon512.write(path.join(PUBLIC, 'pwa-icon-512.png'));
  await icon192.clone().resize(32, 32).write(path.join(PUBLIC, 'favicon-32.png'));
  await icon512.clone().resize(180, 180).write(path.join(PUBLIC, 'apple-touch-icon.png'));

  /** Alias legacy (Electron / bandeja) — mismo arte que pwa-icon-*. */
  await icon192.write(path.join(PUBLIC, 'icon-192.png'));
  await icon512.write(path.join(PUBLIC, 'icon-512.png'));

  const legacy = ['favicon.svg'];
  legacy.forEach((name) => {
    const p = path.join(PUBLIC, name);
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      console.log('Eliminado legacy:', name);
    }
  });

  console.log('Branding generado:', { w, h, cropSize, x, y });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
