const SPLASH_KEY = 'rf_entry_splash_v1';

/** Splash ya completado en esta pestaña/sesión (sobrevive recargas del SW). */
export function isEntrySplashDone() {
  try {
    return sessionStorage.getItem(SPLASH_KEY) === 'done';
  } catch {
    return false;
  }
}

/** Marca inicio para no repetir animación si la página recarga a mitad del splash. */
export function markEntrySplashStarted() {
  try {
    if (sessionStorage.getItem(SPLASH_KEY) !== 'done') {
      sessionStorage.setItem(SPLASH_KEY, 'started');
    }
  } catch {
    /* noop */
  }
}

export function markEntrySplashDone() {
  try {
    sessionStorage.setItem(SPLASH_KEY, 'done');
  } catch {
    /* noop */
  }
}

/** Recarga del SW u otro refresh durante el splash: ir directo al login. */
export function shouldSkipEntrySplash() {
  try {
    const v = sessionStorage.getItem(SPLASH_KEY);
    return v === 'done' || v === 'started';
  } catch {
    return false;
  }
}
