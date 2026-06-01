/**
 * Genera splash completo e iconos PWA desde la imagen de marca Resto-FADEY.
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

  await logo.clone().resize(512, Jimp.AUTO).write(path.join(PUBLIC, 'icon-512.png'));
  await logo.clone().resize(192, Jimp.AUTO).write(path.join(PUBLIC, 'icon-192.png'));
  await logo.clone().resize(180, Jimp.AUTO).write(path.join(PUBLIC, 'apple-touch-icon.png'));
  await logo.clone().resize(32, Jimp.AUTO).write(path.join(PUBLIC, 'favicon-32.png'));
  await logo.clone().write(path.join(BRANDING, 'resto-fadey-logo.png'));

  console.log('Branding generado:', { w, h, cropSize, x, y });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
