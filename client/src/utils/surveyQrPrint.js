import QRCode from 'qrcode';
import {
  api,
  electronPrinting,
  hasElectronPrinting,
  resolvePrintingAssistantOrigin,
} from './api';
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

const CONFIG_CACHE_KEY = 'resto_precuenta_survey_qr_v1';

export async function fetchPrecuentaSurveyQrConfig() {
  try {
    const form = await api.get('/public/loyalty/form');
    const saved = String(form?.survey_url || '').trim();
    const cfg = {
      enabled: form?.print_qr_on_precuenta === true,
      url: saved || defaultSurveyUrl(),
    };
    try {
      window.localStorage?.setItem(CONFIG_CACHE_KEY, JSON.stringify(cfg));
    } catch (_) {
      /* noop */
    }
    return cfg;
  } catch (_) {
    try {
      const cached = JSON.parse(window.localStorage?.getItem(CONFIG_CACHE_KEY) || 'null');
      if (cached && typeof cached === 'object') {
        return { enabled: cached.enabled === true, url: String(cached.url || '') };
      }
    } catch (_) {
      /* noop */
    }
    return { enabled: false, url: '' };
  }
}

function qrDotsForPaper(widthMm) {
  if (widthMm <= 50) return 240;
  if (widthMm <= 58) return 288;
  return 320;
}

function surveyCaptionLines(cols) {
  return [
    centerThermalLine('TU OPINION NOS IMPORTA', cols),
    centerThermalLine('Escanea el codigo QR', cols),
    centerThermalLine('y califica tu experiencia', cols),
  ];
}

/** Asistentes instalados antiguos ignoran `footerImageUrl`; para ellos se imprime aparte. */
async function bridgeSupportsFooterImage() {
  try {
    let origin = '';
    if (hasElectronPrinting()) {
      const br = await electronPrinting.getBridgeOrigin().catch(() => null);
      origin = String(br?.origin || '').trim();
      if (!origin) return false;
    } else {
      origin = await resolvePrintingAssistantOrigin();
      if (!origin) return true;
    }
    const res = await fetch(`${origin.replace(/\/$/, '')}/api/health`, { cache: 'no-store' });
    const data = await res.json();
    return Array.isArray(data?.features) && data.features.includes('footer_image');
  } catch (_) {
    return false;
  }
}

/**
 * Si está activo en Fidelización, devuelve los campos para imprimir el QR de la encuesta en el
 * mismo ticket de la precuenta: al pie si el asistente lo soporta, o en el lugar del logo
 * (arriba) con asistentes antiguos, que solo admiten una imagen por ticket.
 */
export async function getPrecuentaSurveyQrAttachment(widthMm) {
  const cfg = await fetchPrecuentaSurveyQrConfig();
  if (!cfg.enabled || !cfg.url) return null;
  const dots = qrDotsForPaper(widthMm);
  const qrDataUrl = await QRCode.toDataURL(cfg.url, { width: dots, margin: 2, errorCorrectionLevel: 'M' });
  const cols = thermalCharWidth(widthMm);
  if (await bridgeSupportsFooterImage()) {
    return {
      mode: 'footer',
      textSuffix: ['', ...surveyCaptionLines(cols)].join('\n'),
      payload: {
        footerImageUrl: qrDataUrl,
        footerImageMaxDots: dots,
        footerImageMaxMm: Math.round(dots / 8),
      },
    };
  }
  return {
    mode: 'top',
    textSuffix: [
      '',
      centerThermalLine('TU OPINION NOS IMPORTA', cols),
      centerThermalLine('Escanea el codigo QR de arriba', cols),
      centerThermalLine('y califica tu experiencia', cols),
    ].join('\n'),
    payload: {
      logoUrl: qrDataUrl,
      includeThermalLogo: true,
      logoMaxDots: dots,
      logoMaxMm: Math.round(dots / 8),
    },
  };
}
