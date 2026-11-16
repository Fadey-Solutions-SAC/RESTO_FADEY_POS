import { isStandaloneDisplayMode } from './pwaDetect';

/** Evento beforeinstallprompt. También vive en window por si el módulo se recarga. */
let deferredPrompt = null;
const listeners = new Set();

function emit() {
  listeners.forEach((fn) => {
    try { fn(); } catch { /* noop */ }
  });
}

function remember(event) {
  if (!event) return;
  deferredPrompt = event;
  if (typeof window !== 'undefined') window.__rfInstallEvent = event;
  emit();
}

if (typeof window !== 'undefined') {
  if (window.__rfInstallEvent) remember(window.__rfInstallEvent);
  window.addEventListener('rf-beforeinstallprompt', () => remember(window.__rfInstallEvent));
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    remember(event);
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    window.__rfInstallEvent = null;
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
  const event = (typeof window !== 'undefined' && window.__rfInstallEvent) || deferredPrompt;
  return Boolean(event) && !isStandaloneDisplayMode();
}

export function isPwaInstalledHere() {
  return isStandaloneDisplayMode();
}

function takeStoredEvent() {
  const event = (typeof window !== 'undefined' && window.__rfInstallEvent) || deferredPrompt || null;
  deferredPrompt = null;
  if (typeof window !== 'undefined') window.__rfInstallEvent = null;
  return event;
}

/** Abre el cuadro de instalación en el mismo clic. Si Chrome ya lo instaló, no hay evento. */
export function startPwaInstall() {
  const event = takeStoredEvent();
  if (event && typeof event.prompt === 'function') {
    try {
      const prompted = event.prompt();
      const choice = event.userChoice || prompted;
      return Promise.resolve(choice)
        .then((result) => {
          emit();
          return result?.outcome === 'accepted' ? 'accepted' : 'dismissed';
        })
        .catch(() => {
          emit();
          return 'error';
        });
    } catch {
      emit();
    }
  }
  return Promise.resolve('unavailable');
}
