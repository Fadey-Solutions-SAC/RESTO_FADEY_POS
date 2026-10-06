/**
 * Suscripción Web Push de este equipo: permite recibir «Pedido Mesa X está listo»
 * con la pantalla apagada o el sistema cerrado (requiere https y el service worker).
 */
import { api } from './api';
import { getSoundPrefs } from './soundPrefs';

const SW_READY_TIMEOUT_MS = 8000;

export function isPushSupported() {
  if (typeof window === 'undefined') return false;
  return Boolean(window.isSecureContext)
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

/** iPhone/iPad solo permiten push si el sistema está instalado en la pantalla de inicio. */
export function needsIosHomeScreenInstall() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!isIos) return false;
  const standalone = window.matchMedia?.('(display-mode: standalone)')?.matches || navigator.standalone === true;
  return !standalone;
}

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/** Si el servidor cambió de claves VAPID, la suscripción vieja ya no recibe avisos. */
function sameKey(current, expected) {
  if (!current) return true;
  const a = new Uint8Array(current);
  if (a.length !== expected.length) return false;
  return a.every((v, i) => v === expected[i]);
}

async function getRegistration({ wait = true } = {}) {
  if (!isPushSupported()) return null;
  const existing = await navigator.serviceWorker.getRegistration().catch(() => null);
  if (existing || !wait) return existing || null;
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((resolve) => setTimeout(() => resolve(null), SW_READY_TIMEOUT_MS)),
  ]);
}

export async function getPushSubscription({ wait = true } = {}) {
  const reg = await getRegistration({ wait });
  if (!reg?.pushManager) return null;
  return reg.pushManager.getSubscription().catch(() => null);
}

/**
 * Suscribe (o renueva) este equipo para el usuario conectado si está permitido y activado.
 * @returns {Promise<'subscribed'|'disabled'|'unsupported'|'no-permission'|'error'>}
 */
export async function syncPushSubscription() {
  if (!isPushSupported()) return 'unsupported';
  const prefs = getSoundPrefs();
  if (!prefs.push || !prefs.windows) {
    await disablePushSubscription();
    return 'disabled';
  }
  if (Notification.permission !== 'granted') return 'no-permission';
  try {
    const reg = await getRegistration();
    if (!reg?.pushManager) return 'unsupported';
    const { publicKey } = await api.get('/push/public-key', { skipOffline: true });
    if (!publicKey) return 'unsupported';
    const serverKey = urlBase64ToUint8Array(publicKey);
    let sub = await reg.pushManager.getSubscription();
    if (sub && !sameKey(sub.options?.applicationServerKey, serverKey)) {
      await sub.unsubscribe().catch(() => {});
      sub = null;
    }
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: serverKey });
    }
    await api.post('/push/subscribe', { subscription: sub.toJSON() }, { skipOffline: true });
    return 'subscribed';
  } catch (err) {
    console.warn('[push]', err?.message || err);
    return 'error';
  }
}

/** Quita la suscripción de este equipo (al desactivar o al cerrar sesión). */
export async function disablePushSubscription() {
  try {
    const sub = await getPushSubscription({ wait: false });
    if (!sub) return;
    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => {});
    if (localStorage.getItem('token')) {
      await api.post('/push/unsubscribe', { endpoint }, { skipOffline: true }).catch(() => {});
    }
  } catch (_) {
    /* noop */
  }
}
