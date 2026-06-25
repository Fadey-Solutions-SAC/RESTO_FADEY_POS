/**
 * Logo del restaurante → raster ESC/POS (GS v 0) para tickets térmicos.
 * Soporta archivo bajo uploads/ y URL http(s) (misma imagen que ve el panel).
 */

const fs = require('fs');
const path = require('path');
const { getUploadsRoot } = require('../uploadsPath');

function getJimp() {
  try {
    // eslint-disable-next-line global-require
    return require('jimp');
  } catch (_) {
    return null;
  }
}

function resolveLogoFsPath(logoUrl) {
  let s = String(logoUrl || '').trim();
  if (!s || /^https?:\/\//i.test(s)) return '';
  let rel = s.replace(/^\/+/, '');
  if (rel.startsWith('uploads/')) rel = rel.slice('uploads/'.length);
  const full = path.join(getUploadsRoot(), rel);
  return fs.existsSync(full) ? full : '';
}

function maxLogoWidthDots(paperWidthMm) {
  const w = Number(paperWidthMm);
  if (w <= 58) return 384;
  if (w <= 75) return 512;
  return 576;
}

/** GS v 0 m=0: bitmap 1 bit, filas = heightDots, ancho en bytes = ceil(widthDots/8). */
function escposGsV0Raster(bitmapRows, widthDots, heightDots) {
  const widthBytes = Math.ceil(widthDots / 8);
  const expected = widthBytes * heightDots;
  if (bitmapRows.length !== expected) {
    throw new Error(`raster: esperado ${expected} bytes, hay ${bitmapRows.length}`);
  }
  const xL = widthBytes & 255;
  const xH = (widthBytes >> 8) & 255;
  const yL = heightDots & 255;
  const yH = (heightDots >> 8) & 255;
  const header = Buffer.from([0x1d, 0x76, 0x30, 0, xL, xH, yL, yH]);
  return Buffer.concat([header, bitmapRows]);
}

/**
 * Carga la imagen con Jimp: URL absoluta (fetch) o ruta local bajo uploads.
 */
async function loadJimpImage(logoUrl) {
  const Jimp = getJimp();
  if (!Jimp) {
    console.warn('[printing] jimp no disponible; omitiendo logo térmico');
    return null;
  }

  const raw = String(logoUrl || '').trim();
  if (!raw) return null;

  if (/^data:image\/[a-z+]+;base64,/i.test(raw)) {
    try {
      const b64 = raw.split(',', 2)[1];
      if (b64) return await Jimp.read(Buffer.from(b64, 'base64'));
    } catch (e) {
      console.warn('[printing] logo data URL:', e.message || e);
      return null;
    }
  }

  if (/^https?:\/\//i.test(raw)) {
    try {
      if (typeof fetch !== 'function') {
        console.warn('[printing] logo por URL requiere Node 18+ (fetch). Use archivo local o actualice Node.');
        return null;
      }
      const res = await fetch(raw, { redirect: 'follow' });
      if (!res.ok) {
        console.warn('[printing] logo HTTP', res.status, String(raw).slice(0, 96));
        return null;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      return await Jimp.read(buf);
    } catch (e) {
      console.warn('[printing] logo fetch:', e.message || e);
      return null;
    }
  }

  const abs = resolveLogoFsPath(raw);
  if (abs) {
    try {
      return await Jimp.read(abs);
    } catch (e) {
      console.warn('[printing] logo archivo:', e.message || e);
      return null;
    }
  }

  console.warn(
    '[printing] logo no resuelto (ni URL http ni archivo en uploads). Valor:',
    raw.slice(0, 120),
  );
  return null;
}

/**
 * @param {string} logoUrl — URL absoluta, o ruta `/uploads/...` / relativa bajo uploads
 * @param {number} paperWidthMm — 58 u 80
 * @returns {Promise<Buffer|null>}
 */
async function logoToEscPosRaster(logoUrl, paperWidthMm) {
  const image = await loadJimpImage(logoUrl);
  if (!image) return null;
  const Jimp = getJimp();
  if (!Jimp) return null;

  try {
    if (typeof image.exifRotate === 'function') {
      image.exifRotate();
    }
    const maxW = maxLogoWidthDots(paperWidthMm);
    const maxH = 220;
    image.contain(maxW, maxH);
    image.greyscale();
    const w = image.getWidth();
    const h = image.getHeight();
    const widthBytes = Math.ceil(w / 8);
    const out = Buffer.alloc(widthBytes * h, 0);
    for (let y = 0; y < h; y += 1) {
      for (let xb = 0; xb < widthBytes; xb += 1) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit += 1) {
          const x = xb * 8 + bit;
          let black = 0;
          if (x < w) {
            const { r } = Jimp.intToRGBA(image.getPixelColor(x, y));
            black = r < 148 ? 1 : 0;
          }
          if (black) byte |= 0x80 >> bit;
        }
        out[y * widthBytes + xb] = byte;
      }
    }
    return escposGsV0Raster(out, w, h);
  } catch (e) {
    console.warn('[printing] logo térmico raster:', e.message || e);
    return null;
  }
}

module.exports = { logoToEscPosRaster, resolveLogoFsPath, maxLogoWidthDots };
