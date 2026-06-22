/** Protocolo local para despertar Resto FADEY instalado (registrado en electron-builder). */
const WAKE_PROTOCOL = 'restofadey://wake';
const LAST_WAKE_KEY = 'resto_printing_last_wake_ms';
const WAKE_COOLDOWN_MS = 5 * 60 * 1000;
const WAKE_ONCE_SESSION_KEY = 'resto_printing_wake_once_v1';

/**
 * Intenta abrir/enfocar el asistente Electron desde el navegador (sin descargas).
 * Limitado por cooldown para no spamear al SO.
 */
export function tryWakePrintingAssistant() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  try {
    if (window.sessionStorage?.getItem(WAKE_ONCE_SESSION_KEY) === '1') return false;
    const last = Number(window.sessionStorage?.getItem(LAST_WAKE_KEY) || 0);
    if (Date.now() - last < WAKE_COOLDOWN_MS) return false;
    window.sessionStorage?.setItem(LAST_WAKE_KEY, String(Date.now()));
    window.sessionStorage?.setItem(WAKE_ONCE_SESSION_KEY, '1');
  } catch (_) {
    /* noop */
  }

  try {
    const link = document.createElement('a');
    link.href = WAKE_PROTOCOL;
    link.rel = 'noopener noreferrer';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch (_) {
    /* noop */
  }

  try {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:absolute;width:0;height:0;border:0;opacity:0;pointer-events:none';
    iframe.src = WAKE_PROTOCOL;
    document.body.appendChild(iframe);
    window.setTimeout(() => {
      try {
        iframe.remove();
      } catch (_) {
        /* noop */
      }
    }, 3000);
  } catch (_) {
    /* noop */
  }

  return true;
}
