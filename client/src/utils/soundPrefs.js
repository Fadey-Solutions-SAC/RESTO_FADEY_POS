/**
 * Preferencias de avisos por equipo (localStorage): cada tipo de sonido y las notificaciones de Windows
 * se activan o desactivan por separado.
 */
const PREFS_KEY = 'rf_sound_prefs_v1';

export const SOUND_PREFS_EVENT = 'rf-sound-prefs-changed';

export const SOUND_CATEGORIES = Object.freeze([
  { id: 'message', label: 'Mensajes', help: 'Chat interno entre el personal.' },
  { id: 'system', label: 'Notificaciones', help: 'Avisos del sistema, del administrador y de reservas.' },
  { id: 'ai', label: 'Fadey IA', help: 'Cuando la IA termina de responder.' },
  { id: 'ready', label: 'Pedido listo', help: 'Mozo / caja: «Pedido Mesa X está listo».' },
  { id: 'arrival', label: 'Llegada de pedidos a producción', help: 'Cocina y bar: entra un pedido o se agregan productos.' },
  { id: 'delay', label: 'Alerta de demora', help: 'Cocina y bar: un pedido supera el tiempo configurado.' },
]);

const DEFAULT_PREFS = Object.freeze({
  master: true,
  windows: true,
  push: true,
  message: true,
  system: true,
  ai: true,
  ready: true,
  arrival: true,
  delay: true,
});

function readPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return { ...DEFAULT_PREFS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch (_) {
    return { ...DEFAULT_PREFS };
  }
}

export function getSoundPrefs() {
  return readPrefs();
}

export function setSoundPref(key, enabled) {
  if (!(key in DEFAULT_PREFS)) return;
  const next = { ...readPrefs(), [key]: Boolean(enabled) };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch (_) {
    /* noop */
  }
  try {
    window.dispatchEvent(new Event(SOUND_PREFS_EVENT));
  } catch (_) {
    /* noop */
  }
}

/** Tipo de sonido del reproductor → categoría de preferencia. */
export function soundCategoryOf(type) {
  if (type === 'kitchen' || type === 'bar') return 'arrival';
  if (type === 'alert') return 'delay';
  return type;
}

export function isSoundCategoryEnabled(type) {
  const prefs = readPrefs();
  if (!prefs.master) return false;
  const cat = soundCategoryOf(type);
  return prefs[cat] !== false;
}

export function areWindowsNotificationsEnabled() {
  return readPrefs().windows !== false;
}
