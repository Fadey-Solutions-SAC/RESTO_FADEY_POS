import QRCode from 'qrcode';
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

function fillRoundRect(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
  ctx.fill();
}

function drawImageContain(ctx, img, width, height) {
  const scale = Math.min(width / img.width, height / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, (width - dw) / 2, (height - dh) / 2, dw, dh);
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
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  drawImageContain(ctx, formatImage, width, height);

  const qrPx = Math.round(72 * A5_PX_PER_MM);
  const pad = Math.round(3.2 * A5_PX_PER_MM);
  const qrCanvas = document.createElement('canvas');
  await QRCode.toCanvas(qrCanvas, url, {
    width: qrPx,
    margin: 1,
    errorCorrectionLevel: 'H',
    color: { dark: '#111827', light: '#ffffff' },
  });

  const x = Math.round((width - qrPx) / 2);
  const y = Math.round((height - qrPx) / 2);
  ctx.fillStyle = '#ffffff';
  fillRoundRect(ctx, x - pad, y - pad, qrPx + pad * 2, qrPx + pad * 2, Math.round(pad * 0.85));
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
