/**
 * Registro del SW con comprobación periódica y recarga solo en actualizaciones reales.
 * No recarga en la primera instalación (evita doble splash en móvil/PWA).
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  if (window.__rfSwRegistered) return;
  window.__rfSwRegistered = true;

  const runRegister = async () => {
    try {
      const hadControllerOnLoad = !!navigator.serviceWorker.controller;
      const reg = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });

      let reloadPending = false;

      const activateWaitingWorker = () => {
        if (!reg.waiting) return;
        reloadPending = true;
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      };

      if (reg.waiting && hadControllerOnLoad) {
        activateWaitingWorker();
      }

      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (
            installing.state === 'installed' &&
            navigator.serviceWorker.controller &&
            reg.waiting
          ) {
            activateWaitingWorker();
          }
        });
      });

      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing || !reloadPending) return;
        refreshing = true;
        window.location.reload();
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
