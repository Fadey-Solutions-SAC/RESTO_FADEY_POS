const SPLASH_KEY = 'rf_entry_splash_v1';
const SPLASH_STARTED_AT = 'rf_entry_splash_started_at';

/** Splash ya completado en esta carga (solo memoria de sesión corta para SW). */
export function isEntrySplashDone() {
  try {
    return sessionStorage.getItem(SPLASH_KEY) === 'done';
  } catch {
    return false;
  }
}

/** Marca inicio para no repetir animación si el SW recarga a mitad del splash. */
export function markEntrySplashStarted() {
  try {
    sessionStorage.setItem(SPLASH_KEY, 'started');
    sessionStorage.setItem(SPLASH_STARTED_AT, String(Date.now()));
  } catch {
    /* noop */
  }
}

export function markEntrySplashDone() {
  try {
    sessionStorage.setItem(SPLASH_KEY, 'done');
    sessionStorage.removeItem(SPLASH_STARTED_AT);
  } catch {
    /* noop */
  }
}

/**
 * Solo omitir si hubo recarga a mitad del splash (p. ej. service worker).
 * En F5 / reabrir la app / ingreso normal SIEMPRE se muestra la animación.
 */
export function shouldSkipEntrySplash() {
  try {
    const v = sessionStorage.getItem(SPLASH_KEY);
    if (v === 'started') {
      const t = Number(sessionStorage.getItem(SPLASH_STARTED_AT) || 0);
      if (Number.isFinite(t) && Date.now() - t < 4500) {
        return true;
      }
    }
    sessionStorage.removeItem(SPLASH_KEY);
    sessionStorage.removeItem(SPLASH_STARTED_AT);
    return false;
  } catch {
    return false;
  }
}
