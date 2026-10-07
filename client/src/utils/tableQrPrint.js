import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { api, electronPrinting, hasElectronPrinting } from './api';
import { fetchPrintingConfig, normalizePaperWidthMm } from './printingConfig';
import { centerThermalLine, thermalCharWidth } from './ticketPlainText';

function safeFileName(value) {
  return String(value || 'mesa')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_ ]+/g, '')
    .trim()
    .replace(/\s+/g, '-') || 'mesa';
}

/** PNG con el QR y el nombre de la mesa debajo (para imprimir o pegar en la mesa). */
export async function downloadTableQrPng({ url, title, subtitle }) {
  const qrSize = 720;
  const margin = 48;
  const titleSize = 56;
  const subtitleSize = 34;
  const qrCanvas = document.createElement('canvas');
  await QRCode.toCanvas(qrCanvas, url, { width: qrSize, margin: 2, errorCorrectionLevel: 'M' });

  const canvas = document.createElement('canvas');
  canvas.width = qrSize + margin * 2;
  canvas.height = margin + titleSize + (subtitle ? subtitleSize + 12 : 0) + 24 + qrSize + margin;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#111827';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  let y = margin;
  ctx.font = `bold ${titleSize}px Arial, sans-serif`;
  ctx.fillText(String(title || ''), canvas.width / 2, y, canvas.width - margin * 2);
  y += titleSize;
  if (subtitle) {
    y += 12;
    ctx.font = `${subtitleSize}px Arial, sans-serif`;
    ctx.fillStyle = '#4b5563';
    ctx.fillText(String(subtitle), canvas.width / 2, y, canvas.width - margin * 2);
    y += subtitleSize;
  }
  y += 24;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(qrCanvas, margin, y, qrSize, qrSize);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('No se pudo generar la imagen');
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = `QR-${safeFileName(title)}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

/** Lado del QR en puntos térmicos (203 dpi ≈ 8 puntos/mm). */
function qrDotsForPaper(widthMm) {
  if (widthMm <= 50) return 288;
  if (widthMm <= 58) return 352;
  return 448;
}

/** A5 vertical a 220 dpi: la hoja impresa cabe en 148 × 210 mm. */
const A5_WIDTH_MM = 148;
const A5_HEIGHT_MM = 210;
const A5_DPI = 220;
const A5_PX_PER_MM = A5_DPI / 25.4;

function a5Pixels() {
  return {
    width: Math.round(A5_WIDTH_MM * A5_PX_PER_MM),
    height: Math.round(A5_HEIGHT_MM * A5_PX_PER_MM),
  };
}

function loadHtmlImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo leer el formato de imagen'));
    img.src = src;
  });
}

function containPlacement(img, width, height) {
  const scale = Math.min(width / img.width, height / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  return {
    x: (width - dw) / 2,
    y: (height - dh) / 2,
    w: dw,
    h: dh,
    scale,
  };
}

const qrSlotCache = new WeakMap();

function squareSlot(minX, minY, maxX, maxY, imageW, imageH) {
  const boxW = maxX - minX;
  const boxH = maxY - minY;
  if (boxW < 12 || boxH < 12) return null;
  const aspect = boxW / boxH;
  if (aspect < 0.72 || aspect > 1.38) return null;
  const minSide = Math.min(imageW, imageH);
  if (boxW > minSide * 0.62 || boxH > minSide * 0.62) return null;
  if (boxW < minSide * 0.08 || boxH < minSide * 0.08) return null;
  const side = Math.max(boxW, boxH);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const outset = side * 0.04;
  const size = side + outset * 2;
  return {
    x: Math.max(0, cx - size / 2),
    y: Math.max(0, cy - size / 2),
    size,
  };
}

function slotFromDecodedQr(found, width, height) {
  const loc = found?.location;
  if (!loc) return null;
  const corners = [loc.topLeftCorner, loc.topRightCorner, loc.bottomRightCorner, loc.bottomLeftCorner];
  if (!corners.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))) return null;
  return squareSlot(
    Math.min(...corners.map((p) => p.x)),
    Math.min(...corners.map((p) => p.y)),
    Math.max(...corners.map((p) => p.x)),
    Math.max(...corners.map((p) => p.y)),
    width,
    height,
  );
}

function darkMask(data, width, height, threshold) {
  const dark = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const o = i * 4;
    const luma = data[o] * 0.3 + data[o + 1] * 0.59 + data[o + 2] * 0.11;
    dark[i] = luma < threshold ? 1 : 0;
  }
  return dark;
}

function backgroundThreshold(data, width, height) {
  const samples = [];
  const stride = Math.max(1, Math.floor(Math.sqrt(width * height) / 90));
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const o = (y * width + x) * 4;
      samples.push(data[o] * 0.3 + data[o + 1] * 0.59 + data[o + 2] * 0.11);
    }
  }
  samples.sort((a, b) => a - b);
  const background = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.62))] || 200;
  return Math.min(165, Math.max(90, background - 48));
}

/** Si el QR del diseño no se puede leer, ubica el cuadrado de módulos por contraste. */
function slotFromContrast(data, width, height, threshold = 115) {
  const step = 4;
  const bw = Math.floor(width / step);
  const bh = Math.floor(height / step);
  if (bw < 8 || bh < 8) return null;
  const dark = darkMask(data, width, height, threshold);
  const stride = bw + 1;
  const transI = new Float64Array(stride * (bh + 1));
  const darkI = new Float64Array(stride * (bh + 1));
  for (let by = 0; by < bh; by += 1) {
    for (let bx = 0; bx < bw; bx += 1) {
      let transitions = 0;
      let darkCount = 0;
      let samples = 0;
      const x0 = bx * step;
      const y0 = by * step;
      for (let y = y0; y < y0 + step && y < height; y += 1) {
        for (let x = x0; x < x0 + step && x < width; x += 1) {
          const i = y * width + x;
          darkCount += dark[i];
          samples += 1;
          if (x + 1 < x0 + step && dark[i] !== dark[i + 1]) transitions += 1;
          if (y + 1 < y0 + step && dark[i] !== dark[i + width]) transitions += 1;
        }
      }
      const idx = (by + 1) * stride + (bx + 1);
      const left = (by + 1) * stride + bx;
      const up = by * stride + (bx + 1);
      const diag = by * stride + bx;
      transI[idx] = transitions + transI[left] + transI[up] - transI[diag];
      darkI[idx] = (samples ? darkCount / samples : 0) + darkI[left] + darkI[up] - darkI[diag];
    }
  }
  const rect = (integral, x, y, s) => {
    const x2 = x + s;
    const y2 = y + s;
    return integral[y2 * stride + x2] - integral[y * stride + x2] - integral[y2 * stride + x] + integral[y * stride + x];
  };
  const minS = Math.max(4, Math.round((0.1 * Math.min(width, height)) / step));
  const maxS = Math.round((0.48 * Math.min(width, height)) / step);
  let best = null;
  for (let s = minS; s <= maxS; s += Math.max(1, Math.round(s * 0.15))) {
    const jump = Math.max(1, Math.round(s * 0.1));
    for (let y = 0; y <= bh - s; y += jump) {
      for (let x = 0; x <= bw - s; x += jump) {
        const cells = s * s;
        const darkRatio = rect(darkI, x, y, s) / cells;
        if (darkRatio < 0.28 || darkRatio > 0.72) continue;
        const density = rect(transI, x, y, s) / cells;
        if (!best || density > best.density) {
          best = { density, x: x * step, y: y * step, size: s * step };
        }
      }
    }
  }
  if (!best) return null;
  let seedX = Math.min(width - 1, Math.round(best.x + best.size / 2));
  let seedY = Math.min(height - 1, Math.round(best.y + best.size / 2));
  if (!dark[seedY * width + seedX]) {
    let foundSeed = false;
    for (let r = 1; r < 36 && !foundSeed; r += 1) {
      for (let dy = -r; dy <= r && !foundSeed; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          const nx = seedX + dx;
          const ny = seedY + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (dark[ny * width + nx]) {
            seedX = nx;
            seedY = ny;
            foundSeed = true;
            break;
          }
        }
      }
    }
    if (!foundSeed) return null;
  }
  const seen = new Uint8Array(width * height);
  const queue = [seedY * width + seedX];
  seen[seedY * width + seedX] = 1;
  let minX = seedX;
  let maxX = seedX;
  let minY = seedY;
  let maxY = seedY;
  const gap = 2;
  const maxRadius = Math.min(width, height) * 0.24;
  const maxRadiusSq = maxRadius * maxRadius;
  while (queue.length) {
    const index = queue.pop();
    const x = index % width;
    const y = (index / width) | 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    for (let dy = -gap; dy <= gap; dy += 1) {
      for (let dx = -gap; dx <= gap; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const dist = (nx - seedX) * (nx - seedX) + (ny - seedY) * (ny - seedY);
        if (dist > maxRadiusSq) continue;
        const next = ny * width + nx;
        if (seen[next] || !dark[next]) continue;
        seen[next] = 1;
        queue.push(next);
      }
    }
  }
  return squareSlot(minX, minY, maxX, maxY, width, height) || {
    x: best.x,
    y: best.y,
    size: Math.max(best.size, Math.min(width, height) * 0.16),
  };
}

function slotDensity(data, width, height, slot) {
  if (!slot) return -1;
  const x0 = Math.max(0, Math.floor(slot.x));
  const y0 = Math.max(0, Math.floor(slot.y));
  const x1 = Math.min(width, Math.ceil(slot.x + slot.size));
  const y1 = Math.min(height, Math.ceil(slot.y + slot.size));
  let transitions = 0;
  let count = 0;
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const o = (y * width + x) * 4;
      const luma = data[o] * 0.3 + data[o + 1] * 0.59 + data[o + 2] * 0.11;
      if (x + 2 < x1) {
        const o2 = (y * width + (x + 2)) * 4;
        const next = data[o2] * 0.3 + data[o2 + 1] * 0.59 + data[o2 + 2] * 0.11;
        if ((luma < 140) !== (next < 140)) transitions += 1;
      }
      count += 1;
    }
  }
  return count ? transitions / count : -1;
}

function pickQrSlot(data, width, height, first, second) {
  if (!first) return second || null;
  if (!second) return first;
  return slotDensity(data, width, height, second) > slotDensity(data, width, height, first)
    ? second
    : first;
}

/** Busca el QR que ya trae el diseño y devuelve su cuadro en píxeles de la imagen. */
function detectFormatQrSlot(img) {
  if (qrSlotCache.has(img)) return qrSlotCache.get(img);
  const naturalW = img.naturalWidth || img.width;
  const naturalH = img.naturalHeight || img.height;
  const maxSide = 1200;
  const scanScale = Math.min(1, maxSide / Math.max(naturalW, naturalH));
  const w = Math.max(1, Math.round(naturalW * scanScale));
  const h = Math.max(1, Math.round(naturalH * scanScale));
  const scan = document.createElement('canvas');
  scan.width = w;
  scan.height = h;
  const scanCtx = scan.getContext('2d', { willReadFrequently: true });
  scanCtx.drawImage(img, 0, 0, w, h);
  const imageData = scanCtx.getImageData(0, 0, w, h);
  const decoded = slotFromDecodedQr(
    jsQR(imageData.data, w, h, { inversionAttempts: 'attemptBoth' }),
    w,
    h,
  );
  const strict = slotFromContrast(imageData.data, w, h, 115);
  const loose = slotFromContrast(imageData.data, w, h, backgroundThreshold(imageData.data, w, h));
  const slot = decoded || pickQrSlot(imageData.data, w, h, strict, loose);
  const mapped = slot
    ? { x: slot.x / scanScale, y: slot.y / scanScale, size: slot.size / scanScale }
    : null;
  qrSlotCache.set(img, mapped);
  return mapped;
}

/**
 * Hoja A5: formato subido + QR de la mesa, con el número dentro de un círculo al centro del QR.
 * No se muestra en pantalla; solo se usa para imprimir o descargar el archivo de imprenta.
 */
export async function renderTableQrA5({ url, tableNumber, formatImage }) {
  if (!formatImage) throw new Error('Cargue el formato de imagen antes de imprimir');
  const { width, height } = a5Pixels();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const slot = detectFormatQrSlot(formatImage);
  if (!slot) {
    throw new Error('El formato debe incluir un código QR. Ese QR marca el lugar y el tamaño del de cada mesa.');
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  const fit = containPlacement(formatImage, width, height);
  ctx.drawImage(formatImage, fit.x, fit.y, fit.w, fit.h);

  const qrPx = Math.max(32, Math.round(slot.size * fit.scale));
  const qrCanvas = document.createElement('canvas');
  await QRCode.toCanvas(qrCanvas, url, {
    width: qrPx,
    margin: 0,
    errorCorrectionLevel: 'H',
    color: { dark: '#111827', light: '#ffffff' },
  });

  const x = Math.round(fit.x + slot.x * fit.scale);
  const y = Math.round(fit.y + slot.y * fit.scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, qrPx, qrPx);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(qrCanvas, x, y, qrPx, qrPx);

  const label = String(tableNumber ?? '').trim() || '—';
  const cx = x + qrPx / 2;
  const cy = y + qrPx / 2;
  const radius = qrPx * 0.145;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = Math.max(3, radius * 0.08);
  ctx.strokeStyle = '#111827';
  ctx.stroke();
  ctx.fillStyle = '#111827';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fontPx = label.length > 3 ? radius * 0.72 : label.length > 2 ? radius * 0.95 : radius * 1.15;
  ctx.font = `700 ${Math.round(fontPx)}px Arial, sans-serif`;
  ctx.fillText(label, cx, cy + radius * 0.04, radius * 1.7);

  return canvas;
}

async function canvasToPngBlob(canvas) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('No se pudo generar la hoja A5');
  return blob;
}

export async function downloadTableQrA5({ url, tableNumber, formatImageUrl }) {
  const formatImage = await loadHtmlImage(formatImageUrl);
  const canvas = await renderTableQrA5({ url, tableNumber, formatImage });
  const blob = await canvasToPngBlob(canvas);
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = `QR-A5-mesa-${safeFileName(tableNumber)}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1500);
}

function printA5Images(dataUrls) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0;';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    iframe.remove();
    throw new Error('No se pudo abrir la impresión');
  }
  const pages = dataUrls.map((src) => `<section class="sheet"><img src="${src}" alt="" /></section>`).join('');
  doc.open();
  doc.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>QR mesas A5</title>
<style>
  @page { size: A5 portrait; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .sheet { width: 148mm; height: 210mm; page-break-after: always; overflow: hidden; }
  .sheet:last-child { page-break-after: auto; }
  img { width: 148mm; height: 210mm; display: block; }
</style>
</head>
<body>${pages}</body>
</html>`);
  doc.close();
  const imgs = [...doc.images];
  return Promise.all(imgs.map((img) => (img.complete
    ? Promise.resolve()
    : new Promise((resolve) => {
      img.onload = () => resolve();
      img.onerror = () => resolve();
    })))).then(() => {
    const remove = () => {
      try { iframe.remove(); } catch (_) { /* ya cerrado */ }
    };
    win.onafterprint = remove;
    setTimeout(remove, 120000);
    win.focus();
    win.print();
  });
}

/** Imprime una o varias hojas A5. El formato completo no se muestra en la pantalla del sistema. */
export async function printTableQrA5Sheets(sheets, formatImageUrl) {
  const list = Array.isArray(sheets) ? sheets.filter((s) => s?.url) : [];
  if (!list.length) throw new Error('No hay mesas para imprimir');
  if (!formatImageUrl) throw new Error('Cargue el formato de imagen antes de imprimir');
  const formatImage = await loadHtmlImage(formatImageUrl);
  const dataUrls = [];
  for (const sheet of list) {
    const canvas = await renderTableQrA5({
      url: sheet.url,
      tableNumber: sheet.tableNumber,
      formatImage,
    });
    dataUrls.push(canvas.toDataURL('image/png'));
  }
  await printA5Images(dataUrls);
}

/** Imprime el QR de la mesa en la térmica de Caja (misma impresora que la precuenta). */
export async function printTableQrThermal({ url, title, subtitle, restaurantName }) {
  let widthMm = 80;
  try {
    const cfg = await fetchPrintingConfig();
    widthMm = normalizePaperWidthMm(cfg?.caja?.anchoPapel ?? cfg?.caja?.paperWidth ?? 80);
  } catch (_) {
    widthMm = 80;
  }
  const dots = qrDotsForPaper(widthMm);
  const qrDataUrl = await QRCode.toDataURL(url, { width: dots, margin: 2, errorCorrectionLevel: 'M' });
  const cols = thermalCharWidth(widthMm);
  const lines = [
    centerThermalLine(String(title || '').toUpperCase(), cols),
    subtitle ? centerThermalLine(subtitle, cols) : '',
    '',
    centerThermalLine('Escanea el codigo QR', cols),
    centerThermalLine('y haz tu pedido', cols),
    restaurantName ? '' : null,
    restaurantName ? centerThermalLine(restaurantName, cols) : null,
  ].filter((l) => l !== null);
  const payload = {
    text: lines.join('\n'),
    preformatted: true,
    logoUrl: qrDataUrl,
    includeThermalLogo: true,
    logoMaxDots: dots,
    logoMaxMm: Math.round(dots / 8),
    paperWidth: widthMm,
  };
  if (hasElectronPrinting()) {
    await electronPrinting.printModule('caja', payload);
  } else {
    await api.printing.post('/printing/print/caja', payload);
  }
}
