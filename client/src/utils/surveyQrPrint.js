import QRCode from 'qrcode';
import { api, electronPrinting, hasElectronPrinting } from './api';
import { centerThermalLine, thermalCharWidth } from './ticketPlainText';

export function defaultSurveyUrl() {
  const base = typeof window !== 'undefined' ? window.location.origin : '';
  return `${base}/encuesta`;
}

/** URL pública utilizable por el cliente (descarta file:// y localhost de Electron). */
export function isShareableSurveyUrl(url) {
  const s = String(url || '').trim();
  if (!/^https?:\/\//i.test(s)) return false;
  return !/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(s);
}

export async function fetchPrecuentaSurveyQrConfig() {
  try {
    const form = await api.get('/public/loyalty/form');
    const saved = String(form?.survey_url || '').trim();
    return {
      enabled: form?.print_qr_on_precuenta === true,
      url: saved || defaultSurveyUrl(),
    };
  } catch (_) {
    return { enabled: false, url: '' };
  }
}

function qrDotsForPaper(widthMm) {
  if (widthMm <= 50) return 240;
  if (widthMm <= 58) return 288;
  return 320;
}

export async function printSurveyQrThermal({ url, widthMm = 80, restaurantName = '' }) {
  const dots = qrDotsForPaper(widthMm);
  const qrDataUrl = await QRCode.toDataURL(url, { width: dots, margin: 2, errorCorrectionLevel: 'M' });
  const cols = thermalCharWidth(widthMm);
  const lines = [
    centerThermalLine('TU OPINION NOS IMPORTA', cols),
    '',
    centerThermalLine('Escanea el codigo QR', cols),
    centerThermalLine('y califica tu experiencia', cols),
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

/** Si está activo en Fidelización, imprime el QR de la encuesta justo después de la precuenta. */
export async function printSurveyQrAfterPrecuentaIfEnabled({ widthMm, restaurantName }) {
  const cfg = await fetchPrecuentaSurveyQrConfig();
  if (!cfg.enabled || !cfg.url) return false;
  await printSurveyQrThermal({ url: cfg.url, widthMm, restaurantName });
  return true;
}
