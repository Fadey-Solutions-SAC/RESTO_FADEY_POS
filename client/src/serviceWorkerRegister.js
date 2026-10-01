/**
 * Registro del SW con comprobación periódica.
 * Nunca recarga la página: el SW nuevo se activa en segundo plano y, como sirve red primero,
 * la siguiente navegación ya usa la versión publicada (evita recargas a mitad de un pedido QR).
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  if (window.__rfSwRegistered) return;
  window.__rfSwRegistered = true;

  const runRegister = async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });

      const activateWaitingWorker = () => {
        if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      };

      activateWaitingWorker();

      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed') activateWaitingWorker();
        });
      });

      setInterval(() => {
        reg.update().catch(() => {});
      }, 5 * 60 * 1000);
    } catch (e) {
      console.warn('[sw] no se pudo registrar:', e);
    }
  };

  if (document.readyState === 'complete') {
    void runRegister();
  } else {
    window.addEventListener('load', runRegister, { once: true });
  }
}

/** Registrar SW tras el splash para no interferir con la animación de apertura. */
export function registerServiceWorkerAfterSplash() {
  registerServiceWorker();
}
