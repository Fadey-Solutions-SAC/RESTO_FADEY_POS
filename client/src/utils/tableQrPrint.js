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
  const fromUrl = (url, cors) => new Promise((resolve, reject) => {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo leer el formato de imagen'));
    img.src = url;
  });
  return fetch(src, { mode: 'cors', credentials: 'omit' })
    .then((res) => (res.ok ? res.blob() : Promise.reject(new Error('formato'))))
    .then((blob) => {
      const objectUrl = URL.createObjectURL(blob);
      return fromUrl(objectUrl, false).finally(() => URL.revokeObjectURL(objectUrl));
    })
    .catch(() => fromUrl(src, true).catch(() => fromUrl(src, false)));
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

/** Cuadro del QR de muestra: el más grande, recortado a sus esquinas, sin el texto de arriba. */
function slotOnSampleQr(data, width, height, level = 100) {
  const luma = new Float32Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const o = i * 4;
    luma[i] = data[o] * 0.3 + data[o + 1] * 0.59 + data[o + 2] * 0.11;
  }
  const step = 4;
  const bw = Math.floor(width / step);
  const bh = Math.floor(height / step);
  if (bw < 8 || bh < 8) return null;
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
          const index = y * width + x;
          const bit = luma[index] < level ? 1 : 0;
          darkCount += bit;
          samples += 1;
          if (x + 1 < x0 + step && bit !== (luma[index + 1] < level ? 1 : 0)) transitions += 1;
          if (y + 1 < y0 + step && bit !== (luma[index + width] < level ? 1 : 0)) transitions += 1;
        }
      }
      const idx = (by + 1) * stride + (bx + 1);
      transI[idx] = transitions + transI[(by + 1) * stride + bx] + transI[by * stride + (bx + 1)] - transI[by * stride + bx];
      darkI[idx] = (samples ? darkCount / samples : 0) + darkI[(by + 1) * stride + bx] + darkI[by * stride + (bx + 1)] - darkI[by * stride + bx];
    }
  }
  const rectSum = (integral, x, y, s) => integral[(y + s) * stride + (x + s)] - integral[y * stride + (x + s)] - integral[(y + s) * stride + x] + integral[y * stride + x];
  const minSide = Math.min(width, height);
  let best = null;
  const minS = Math.max(6, Math.round((0.16 * minSide) / step));
  const maxS = Math.round((0.42 * minSide) / step);
  for (let s = minS; s <= maxS; s += Math.max(1, Math.round(s * 0.08))) {
    const jump = Math.max(1, Math.round(s * 0.06));
    for (let y = 0; y <= bh - s; y += jump) {
      for (let x = 0; x <= bw - s; x += jump) {
        const cells = s * s;
        const darkRatio = rectSum(darkI, x, y, s) / cells;
        if (darkRatio < 0.22 || darkRatio > 0.62) continue;
        const density = rectSum(transI, x, y, s) / cells;
        const score = density * Math.sqrt(s * step);
        if (!best || score > best.score) best = { score, x: x * step, y: y * step, size: s * step };
      }
    }
  }
  if (!best) return null;
  const isDark = (x, y) => luma[y * width + x] < level;
  let seedX = Math.min(width - 1, Math.round(best.x + best.size / 2));
  let seedY = Math.min(height - 1, Math.round(best.y + best.size / 2));
  if (!isDark(seedX, seedY)) {
    let foundSeed = false;
    for (let radius = 1; radius < 48 && !foundSeed; radius += 1) {
      for (let dy = -radius; dy <= radius && !foundSeed; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = seedX + dx;
          const ny = seedY + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (isDark(nx, ny)) {
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
  const maxR = best.size * 0.62;
  while (queue.length) {
    const id = queue.pop();
    const x = id % width;
    const y = (id / width) | 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if ((nx - seedX) ** 2 + (ny - seedY) ** 2 > maxR * maxR) continue;
        const next = ny * width + nx;
        if (seen[next] || !isDark(nx, ny)) continue;
        seen[next] = 1;
        queue.push(next);
      }
    }
  }
  let top = minY;
  let bottom = maxY;
  let left = minX;
  let right = maxX;
  const bandDark = (x0, y0, x1, y1) => {
    let darkCount = 0;
    let n = 0;
    const xa = Math.max(0, x0);
    const ya = Math.max(0, y0);
    const xb = Math.min(width - 1, x1);
    const yb = Math.min(height - 1, y1);
    for (let y = ya; y <= yb; y += 1) {
      for (let x = xa; x <= xb; x += 1) {
        n += 1;
        if (luma[y * width + x] < level) darkCount += 1;
      }
    }
    return n ? darkCount / n : 0;
  };
  const rowIsFinder = (y, x0, x1, dir) => {
    const span = Math.max(1, x1 - x0);
    const edge = Math.max(4, Math.round(span * 0.2));
    const thick = Math.max(2, Math.round(span * 0.07));
    const y0 = dir > 0 ? y : y - thick + 1;
    const y1 = dir > 0 ? y + thick - 1 : y;
    if (y0 < 0 || y1 >= height) return false;
    return bandDark(x0, y0, x0 + edge, y1) > 0.55 && bandDark(x1 - edge, y0, x1, y1) > 0.55;
  };
  const colIsFinder = (x, y0, y1, dir) => {
    const span = Math.max(1, y1 - y0);
    const edge = Math.max(4, Math.round(span * 0.2));
    const thick = Math.max(2, Math.round(span * 0.07));
    const x0 = dir > 0 ? x : x - thick + 1;
    const x1 = dir > 0 ? x + thick - 1 : x;
    if (x0 < 0 || x1 >= width) return false;
    return bandDark(x0, y0, x1, y0 + edge) > 0.55 && bandDark(x0, y1 - edge, x1, y1) > 0.55;
  };
  while (bottom - top > 12 && !rowIsFinder(top, left, right, 1)) top += 1;
  while (bottom - top > 12 && !rowIsFinder(bottom, left, right, -1)) bottom -= 1;
  while (right - left > 12 && !colIsFinder(left, top, bottom, 1)) left += 1;
  while (right - left > 12 && !colIsFinder(right, top, bottom, -1)) right -= 1;
  const maxTopTrim = Math.max(2, Math.round((bottom - top) * 0.08));
  let trimmed = 0;
  while (trimmed < maxTopTrim && bottom - top > 12) {
    const edge = Math.max(4, Math.round((right - left) * 0.18));
    if (bandDark(left, top, left + edge, Math.min(height - 1, top + 2)) >= 0.78) break;
    top += 1;
    trimmed += 1;
  }
  const boxW = right - left + 1;
  const boxH = bottom - top + 1;
  const square = { x: best.x, y: best.y, w: best.size, h: best.size };
  if (boxW < 24 || boxH < 24) return square;
  if (boxW / boxH < 0.75 || boxW / boxH > 1.35) return square;
  return { x: left, y: top, w: boxW, h: boxH };
}

/** Marco vacío del diseño: borde oscuro y centro claro. El QR se imprime dentro de ese recuadro. */
function slotOnEmptyFrame(data, width, height) {
  const luma = new Float32Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const o = i * 4;
    luma[i] = data[o] * 0.3 + data[o + 1] * 0.59 + data[o + 2] * 0.11;
  }
  const darkAt = (x, y) => luma[y * width + x] < 165;
  const minSide = Math.min(width, height);
  const minLen = minSide * 0.14;
  const maxLen = minSide * 0.62;

  const longestRun = (length, isDark) => {
    let best = null;
    let start = -1;
    let gap = 0;
    const close = (end) => {
      const len = end - start;
      if (len >= minLen && len <= maxLen && (!best || len > best.b - best.a)) best = { a: start, b: end };
    };
    for (let i = 0; i <= length; i += 1) {
      if (i < length && isDark(i)) {
        if (start < 0) start = i;
        gap = 0;
      } else if (start >= 0) {
        gap += 1;
        if (gap > 4 || i === length) {
          close(i - gap);
          start = -1;
          gap = 0;
        }
      }
    }
    return best;
  };

  const sideLight = (samples) => {
    if (!samples.length) return false;
    let dark = 0;
    samples.forEach((on) => { if (on) dark += 1; });
    return dark / samples.length < 0.22;
  };

  const pushLine = (lines, line, key) => {
    const prev = lines[lines.length - 1];
    if (prev && line[key] - prev[key] < 3) {
      const prevLen = prev.b - prev.a;
      const nextLen = line.b - line.a;
      if (nextLen >= prevLen) lines[lines.length - 1] = line;
      return;
    }
    lines.push(line);
  };

  const hLines = [];
  for (let y = 2; y < height - 2; y += 1) {
    const run = longestRun(width, (x) => darkAt(x, y));
    if (!run) continue;
    const below = [];
    const above = [];
    for (let x = run.a; x < run.b; x += 3) {
      below.push(darkAt(x, Math.min(height - 1, y + 6)));
      above.push(darkAt(x, Math.max(0, y - 6)));
    }
    if (!sideLight(below) && !sideLight(above)) continue;
    pushLine(hLines, { y, a: run.a, b: run.b }, 'y');
  }
  const vLines = [];
  for (let x = 2; x < width - 2; x += 1) {
    const run = longestRun(height, (y) => darkAt(x, y));
    if (!run) continue;
    const right = [];
    const left = [];
    for (let y = run.a; y < run.b; y += 3) {
      right.push(darkAt(Math.min(width - 1, x + 6), y));
      left.push(darkAt(Math.max(0, x - 6), y));
    }
    if (!sideLight(right) && !sideLight(left)) continue;
    pushLine(vLines, { x, a: run.a, b: run.b }, 'x');
  }

  let best = null;
  for (let i = 0; i < hLines.length; i += 1) {
    for (let j = i + 1; j < hLines.length; j += 1) {
      const top = hLines[i].y < hLines[j].y ? hLines[i] : hLines[j];
      const bottom = top === hLines[i] ? hLines[j] : hLines[i];
      const boxH = bottom.y - top.y;
      if (boxH < minLen || boxH > maxLen) continue;
      const overlapA = Math.max(top.a, bottom.a);
      const overlapB = Math.min(top.b, bottom.b);
      if (overlapB - overlapA < boxH * 0.7) continue;
      const leftCandidates = vLines.filter((line) => (
        Math.abs(line.x - overlapA) < boxH * 0.12
        && line.a < top.y + boxH * 0.35
        && line.b > bottom.y - boxH * 0.35
      ));
      const rightCandidates = vLines.filter((line) => (
        Math.abs(line.x - overlapB) < boxH * 0.12
        && line.a < top.y + boxH * 0.35
        && line.b > bottom.y - boxH * 0.35
      ));
      if (!leftCandidates.length || !rightCandidates.length) continue;
      const left = leftCandidates.reduce((a, b) => (Math.abs(b.x - overlapA) < Math.abs(a.x - overlapA) ? b : a));
      const right = rightCandidates.reduce((a, b) => (Math.abs(b.x - overlapB) < Math.abs(a.x - overlapB) ? b : a));
      const boxW = right.x - left.x;
      if (boxW < minLen || boxW / boxH < 0.82 || boxW / boxH > 1.22) continue;
      if (left.x < width * 0.06 || right.x > width * 0.94) continue;
      const rim = Math.max(4, Math.round(Math.min(boxW, boxH) * 0.06));
      let rimDark = 0;
      let rimN = 0;
      for (let y = top.y + 3; y <= top.y + rim + 6; y += 2) {
        for (let x = left.x + rim; x <= right.x - rim; x += 2) {
          rimN += 1;
          if (darkAt(x, y)) rimDark += 1;
        }
      }
      if (!rimN || rimDark / rimN > 0.18) continue;
      const inset = Math.round(Math.min(boxW, boxH) * 0.12);
      let dark = 0;
      let n = 0;
      for (let y = top.y + inset; y < bottom.y - inset; y += 3) {
        for (let x = left.x + inset; x < right.x - inset; x += 3) {
          n += 1;
          if (darkAt(x, y)) dark += 1;
        }
      }
      const density = n ? dark / n : 1;
      if (density > 0.08) continue;
      const score = boxW * boxH * (1 - density);
      if (!best || score > best.score) {
        best = { x: left.x, y: top.y, w: boxW, h: boxH, score };
      }
    }
  }
  if (!best) return null;
  const pad = Math.round(Math.min(best.w, best.h) * 0.045);
  const w = best.w - pad * 2;
  const h = best.h - pad * 2;
  if (w < 24 || h < 24) return null;
  return { x: best.x + pad, y: best.y + pad, w, h };
}

/** Busca el recuadro vacío o el QR de muestra y devuelve su cuadro en píxeles de la imagen. */
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
  const frame = slotOnEmptyFrame(imageData.data, w, h);
  if (frame) {
    const mappedFrame = {
      x: frame.x / scanScale,
      y: frame.y / scanScale,
      w: frame.w / scanScale,
      h: frame.h / scanScale,
    };
    qrSlotCache.set(img, mappedFrame);
    return mappedFrame;
  }
  const decoded = slotFromDecodedQr(
    jsQR(imageData.data, w, h, { inversionAttempts: 'attemptBoth' }),
    w,
    h,
  );
  const sample = slotOnSampleQr(imageData.data, w, h, 100)
    || slotOnSampleQr(imageData.data, w, h, 160);
  const decodedArea = decoded ? decoded.size * decoded.size : 0;
  const sampleArea = sample ? sample.w * sample.h : 0;
  const slot = sampleArea > decodedArea ? sample : (decoded || sample);
  const mapped = slot
    ? {
      x: slot.x / scanScale,
      y: slot.y / scanScale,
      w: (slot.w || slot.size) / scanScale,
      h: (slot.h || slot.size) / scanScale,
    }
    : null;
  qrSlotCache.set(img, mapped);
  return mapped;
}

/**
 * Hoja A5: formato subido + QR de la mesa, con el número dentro de un círculo al centro del QR.
 * No se muestra en pantalla; solo se usa para imprimir o descargar el archivo de imprenta.
 */
export function normalizeQrSlot(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const x = Number(raw.x);
  const y = Number(raw.y);
  const w = Number(raw.w);
  const h = Number(raw.h);
  if (![x, y, w, h].every(Number.isFinite)) return null;
  const nw = Math.min(0.8, Math.max(0.06, w));
  const nh = Math.min(0.8, Math.max(0.06, h));
  const nx = Math.min(Math.max(0, x), 1 - nw);
  const ny = Math.min(Math.max(0, y), 1 - nh);
  return { x: nx, y: ny, w: nw, h: nh };
}

function slotFromSaved(formatImage, slot) {
  const norm = normalizeQrSlot(slot);
  if (!norm) return null;
  const naturalW = formatImage.naturalWidth || formatImage.width;
  const naturalH = formatImage.naturalHeight || formatImage.height;
  return {
    x: norm.x * naturalW,
    y: norm.y * naturalH,
    w: norm.w * naturalW,
    h: norm.h * naturalH,
  };
}

/** Lugar sugerido del QR, en fracciones del ancho y alto de la imagen. */
export async function suggestFormatQrSlot(formatImageUrl) {
  const formatImage = await loadHtmlImage(formatImageUrl);
  const naturalW = formatImage.naturalWidth || formatImage.width;
  const naturalH = formatImage.naturalHeight || formatImage.height;
  const found = detectFormatQrSlot(formatImage);
  if (found?.w && found?.h) {
    return normalizeQrSlot({
      x: found.x / naturalW,
      y: found.y / naturalH,
      w: found.w / naturalW,
      h: found.h / naturalH,
    });
  }
  const side = Math.min(naturalW, naturalH) * 0.32;
  return normalizeQrSlot({
    x: (naturalW - side) / 2 / naturalW,
    y: ((naturalH - side) * 0.58) / naturalH,
    w: side / naturalW,
    h: side / naturalH,
  });
}

function slotToPixels(slot, formatImage, fit) {
  const norm = normalizeQrSlot(slot);
  if (!norm) return null;
  const naturalW = formatImage.naturalWidth || formatImage.width;
  const naturalH = formatImage.naturalHeight || formatImage.height;
  return {
    x: fit.x + norm.x * naturalW * fit.scale,
    y: fit.y + norm.y * naturalH * fit.scale,
    w: norm.w * naturalW * fit.scale,
    h: norm.h * naturalH * fit.scale,
  };
}

function sampleSignFill(formatImage, slot) {
  const naturalW = formatImage.naturalWidth || formatImage.width;
  const naturalH = formatImage.naturalHeight || formatImage.height;
  const points = [
    [slot.x + slot.w * 0.18, slot.y + slot.h * 0.5],
    [slot.x + slot.w * 0.82, slot.y + slot.h * 0.5],
    [slot.x + slot.w * 0.5, slot.y + slot.h * 0.16],
    [slot.x + slot.w * 0.5, slot.y + slot.h * 0.84],
  ];
  const probe = document.createElement('canvas');
  probe.width = 1;
  probe.height = 1;
  const probeCtx = probe.getContext('2d', { willReadFrequently: true });
  const samples = points.map(([nx, ny]) => {
    const x = Math.min(naturalW - 1, Math.max(0, Math.round(nx * naturalW)));
    const y = Math.min(naturalH - 1, Math.max(0, Math.round(ny * naturalH)));
    probeCtx.clearRect(0, 0, 1, 1);
    probeCtx.drawImage(formatImage, x, y, 1, 1, 0, 0, 1, 1);
    const [r, g, b] = probeCtx.getImageData(0, 0, 1, 1).data;
    return { r, g, b, l: r + g + b };
  }).sort((a, b) => a.l - b.l);
  const mid = samples[Math.floor(samples.length / 2)] || { r: 245, g: 236, b: 214 };
  return `rgb(${mid.r}, ${mid.g}, ${mid.b})`;
}

function traceLogoClip(ctx, area, shape) {
  const cx = area.x + area.w / 2;
  const cy = area.y + area.h / 2;
  ctx.beginPath();
  if (shape === 'roundrect') {
    const x = area.x + area.w * 0.08;
    const y = area.y + area.h * 0.12;
    const w = area.w * 0.84;
    const h = area.h * 0.76;
    const r = Math.min(w, h) * 0.12;
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, w, h, r);
    } else {
      ctx.rect(x, y, w, h);
    }
    return;
  }
  ctx.ellipse(cx, cy, area.w * 0.46, area.h * 0.42, 0, 0, Math.PI * 2);
}

/**
 * Tapa el letrero «Tu logo aquí» y deja el logo configurado en el sistema.
 * `slot` va en fracciones de la imagen del formato.
 */
export function placeSystemLogo(ctx, formatImage, logoImage, slot, fit, shape = 'ellipse') {
  const area = slotToPixels(slot, formatImage, fit);
  if (!ctx || !formatImage || !logoImage || !area?.w || !area?.h) return;
  const fill = sampleSignFill(formatImage, normalizeQrSlot(slot));
  ctx.save();
  traceLogoClip(ctx, area, shape);
  ctx.clip();
  ctx.fillStyle = fill;
  ctx.fillRect(area.x, area.y, area.w, area.h);
  const pad = shape === 'roundrect' ? 0.22 : 0.18;
  const maxW = area.w * (1 - pad * 2);
  const maxH = area.h * (1 - pad * 2);
  const scale = Math.min(maxW / logoImage.width, maxH / logoImage.height);
  const dw = logoImage.width * scale;
  const dh = logoImage.height * scale;
  ctx.drawImage(logoImage, area.x + (area.w - dw) / 2, area.y + (area.h - dh) / 2, dw, dh);
  ctx.restore();
}

export async function renderTableQrA5({ url, tableNumber, formatImage, slot, logoImage, logoSlot, logoShape }) {
  if (!formatImage) throw new Error('Cargue el formato de imagen antes de imprimir');
  const { width, height } = a5Pixels();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const placed = slotFromSaved(formatImage, slot) || detectFormatQrSlot(formatImage);
  if (!placed) {
    throw new Error('No se encontró el recuadro del QR. Ajuste el lugar en la vista previa.');
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  const fit = containPlacement(formatImage, width, height);
  ctx.drawImage(formatImage, fit.x, fit.y, fit.w, fit.h);
  if (logoImage && logoSlot) {
    placeSystemLogo(ctx, formatImage, logoImage, logoSlot, fit, logoShape);
  }

  const slotW = Math.max(32, (placed.w || placed.size) * fit.scale);
  const slotH = Math.max(32, (placed.h || placed.size) * fit.scale);
  const side = Math.max(32, Math.round(Math.min(slotW, slotH)));
  const qrCanvas = document.createElement('canvas');
  await QRCode.toCanvas(qrCanvas, url, {
    width: side,
    margin: 0,
    errorCorrectionLevel: 'H',
    color: { dark: '#111827', light: '#ffffff' },
  });

  const x = Math.round(fit.x + placed.x * fit.scale + (slotW - side) / 2);
  const y = Math.round(fit.y + placed.y * fit.scale + (slotH - side) / 2);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, side, side);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(qrCanvas, x, y, side, side);

  const label = String(tableNumber ?? '').trim() || '—';
  const cx = x + side / 2;
  const cy = y + side / 2;
  const radius = side * 0.145;
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

export async function downloadTableQrA5({ url, tableNumber, formatImageUrl, slot, logoUrl, logoSlot, logoShape }) {
  const formatImage = await loadHtmlImage(formatImageUrl);
  const logoImage = logoUrl ? await loadHtmlImage(logoUrl).catch(() => null) : null;
  const canvas = await renderTableQrA5({ url, tableNumber, formatImage, slot, logoImage, logoSlot, logoShape });
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
export async function printTableQrA5Sheets(sheets, formatImageUrl, slot, logo) {
  const list = Array.isArray(sheets) ? sheets.filter((s) => s?.url) : [];
  if (!list.length) throw new Error('No hay mesas para imprimir');
  if (!formatImageUrl) throw new Error('Cargue el formato de imagen antes de imprimir');
  const formatImage = await loadHtmlImage(formatImageUrl);
  const logoImage = logo?.url ? await loadHtmlImage(logo.url).catch(() => null) : null;
  const dataUrls = [];
  for (const sheet of list) {
    const canvas = await renderTableQrA5({
      url: sheet.url,
      tableNumber: sheet.tableNumber,
      formatImage,
      slot,
      logoImage,
      logoSlot: logo?.slot,
      logoShape: logo?.shape,
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
