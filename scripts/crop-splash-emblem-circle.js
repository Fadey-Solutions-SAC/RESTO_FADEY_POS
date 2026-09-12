/**
 * Recorta solo el emblema circular RF (sin “RESTO FADEY”) y reemplaza assets de splash/PWA.
 * Uso: node scripts/crop-splash-emblem-circle.js
 */
const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');

const PUBLIC = path.join(__dirname, '..', 'client', 'public');
const BRANDING = path.join(PUBLIC, 'branding');
const SRC = path.join(BRANDING, 'resto-fadey-source.png');
const PWA_BG = 0x000000ff;
const OUT_SIZE = 512;

function sampleBackgroundColor(img) {
  const w = img.bitmap.width;
  const h = img.bitmap.height;
  const pts = [
    [4, 4],
    [w - 5, 4],
    [4, h - 5],
    [w - 5, h - 5],
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [px, py] of pts) {
    const c = Jimp.intToRGBA(img.getPixelColor(px, py));
    r += c.r;
    g += c.g;
    b += c.b;
  }
  return {
    r: Math.round(r / pts.length),
    g: Math.round(g / pts.length),
    b: Math.round(b / pts.length),
  };
}

/** Solo el círculo RF (sin texto RESTO FADEY debajo). */
function cropEmblemOnly(img, bg, threshold = 40) {
  const w = img.bitmap.width;
  const h = img.bitmap.height;
  const contentRows = [];
  for (let y = 0; y < h; y += 1) {
    let rowHasContent = false;
    for (let x = 0; x < w; x += 4) {
      const c = Jimp.intToRGBA(img.getPixelColor(x, y));
      const diff = Math.abs(c.r - bg.r) + Math.abs(c.g - bg.g) + Math.abs(c.b - bg.b);
      if (diff > threshold) {
        rowHasContent = true;
        break;
      }
    }
    if (rowHasContent) contentRows.push(y);
  }
  if (!contentRows.length) {
    const size = Math.round(Math.min(w, h) * 0.55);
    const x = Math.round((w - size) / 2);
    const y = Math.round(h * 0.04);
    return img.clone().crop(x, y, size, size);
  }

  const bands = [];
  let start = contentRows[0];
  let prev = contentRows[0];
  for (let i = 1; i < contentRows.length; i += 1) {
    const y = contentRows[i];
    if (y - prev > 8) {
      bands.push([start, prev]);
      start = y;
    }
    prev = y;
  }
  bands.push([start, prev]);

  const [emblemTop, emblemBottom] = bands[0];
  const emblemH = emblemBottom - emblemTop + 1;
  const pad = Math.round(emblemH * 0.08);
  let cropTop = Math.max(0, emblemTop - pad);
  let cropH = emblemBottom + pad - cropTop;
  if (bands.length > 1) {
    const textStart = bands[1][0];
    cropH = Math.min(cropH, Math.max(64, textStart - 6 - cropTop));
  }
  cropH = Math.min(cropH, w, h - cropTop);
  const cropW = cropH;
  const cropX = Math.max(0, Math.round((w - cropW) / 2));
  return img.clone().crop(cropX, cropTop, Math.min(cropW, w - cropX), cropH);
}

async function toCircle(squareImg, size) {
  const resized = squareImg.clone().cover(size, size);
  const out = new Jimp(size, size, 0x00000000);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const r = size / 2;
  const r2 = r * r;
  resized.scan(0, 0, size, size, (x, y, idx) => {
    const dx = x - cx;
    const dy = y - cy;
    if (dx * dx + dy * dy <= r2) {
      out.bitmap.data[idx] = resized.bitmap.data[idx];
      out.bitmap.data[idx + 1] = resized.bitmap.data[idx + 1];
      out.bitmap.data[idx + 2] = resized.bitmap.data[idx + 2];
      out.bitmap.data[idx + 3] = resized.bitmap.data[idx + 3];
    }
  });
  return out;
}

async function composePwaIcon(logo, size) {
  const canvas = new Jimp(size, size, PWA_BG);
  const logoSize = Math.round(size * 0.92);
  const circle = await toCircle(logo, logoSize);
  const x = Math.round((size - logoSize) / 2);
  const y = Math.round((size - logoSize) / 2);
  canvas.composite(circle, x, y);
  return canvas;
}

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error('No existe', SRC);
    process.exit(1);
  }
  const img = await Jimp.read(SRC);
  const bg = sampleBackgroundColor(img);
  const emblem = cropEmblemOnly(img, bg);
  const circle512 = await toCircle(emblem, OUT_SIZE);
  // Fondo negro sólido para splash (evita transparencia rara en móvil)
  const splashSolid = new Jimp(OUT_SIZE, OUT_SIZE, PWA_BG);
  splashSolid.composite(circle512, 0, 0);

  const targets = [
    path.join(BRANDING, 'resto-fadey-logo.png'),
    path.join(BRANDING, 'resto-fadey-splash-logo.png'),
    path.join(BRANDING, 'resto-fadey-splash-logo-source.png'),
    path.join(BRANDING, 'resto-fadey-splash-entry.png'),
    path.join(PUBLIC, 'resto-fadey-splash-entry.png'),
  ];
  for (const t of targets) {
    await splashSolid.clone().writeAsync(t);
  }

  const icon192 = await composePwaIcon(emblem, 192);
  const icon512 = await composePwaIcon(emblem, 512);
  await icon192.writeAsync(path.join(PUBLIC, 'pwa-icon-192.png'));
  await icon512.writeAsync(path.join(PUBLIC, 'pwa-icon-512.png'));
  await icon192.clone().resize(32, 32).writeAsync(path.join(PUBLIC, 'favicon-32.png'));
  await icon512.clone().resize(180, 180).writeAsync(path.join(PUBLIC, 'apple-touch-icon.png'));
  await icon192.writeAsync(path.join(PUBLIC, 'icon-192.png'));
  await icon512.writeAsync(path.join(PUBLIC, 'icon-512.png'));

  console.log('OK emblem circle', {
    emblem: `${emblem.bitmap.width}x${emblem.bitmap.height}`,
    out: OUT_SIZE,
    files: targets.length + 6,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
