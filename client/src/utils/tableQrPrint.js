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
