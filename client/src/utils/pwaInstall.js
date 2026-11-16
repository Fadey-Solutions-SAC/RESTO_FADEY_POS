import { isStandaloneDisplayMode } from './pwaDetect';

/** Evento beforeinstallprompt, capturado una sola vez para el aviso y el perfil. */
let deferredPrompt = null;
const listeners = new Set();

function emit() {
  listeners.forEach((fn) => {
    try { fn(); } catch { /* noop */ }
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    try {
      window.localStorage.setItem('resto_fadey_pwa_install_done', '1');
      window.localStorage.removeItem('resto_fadey_pwa_install_snooze_until');
    } catch { /* noop */ }
    emit();
  });
}

export function subscribePwaInstall(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function canPromptPwaInstall() {
  return Boolean(deferredPrompt) && !isStandaloneDisplayMode();
}

export function isPwaInstalledHere() {
  return isStandaloneDisplayMode();
}

/** Abre el cuadro nativo de Chrome/Edge. Si el navegador no lo ofreció, no hay cuadro. */
export async function promptPwaInstall() {
  if (!deferredPrompt) return 'unavailable';
  const event = deferredPrompt;
  deferredPrompt = null;
  emit();
  try {
    event.prompt();
    const choice = await event.userChoice;
    return choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch {
    return 'error';
  }
}
