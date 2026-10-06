import {
  isNotificationAudioUnlocked,
  playNotificationSound,
  unlockNotificationAudio,
} from './playNotificationSound';
import { areWindowsNotificationsEnabled } from './soundPrefs';

/** Se dispara en `window` cuando cambia algún permiso (banner, perfil). */
export const DEVICE_PERMISSIONS_EVENT = 'rf-device-permissions-changed';

const BANNER_DISMISSED_KEY = 'device_permissions_banner_dismissed_v1';

/** Roles que reciben avisos de pedido listo. */
export const ORDER_READY_ROLES = new Set(['mozo', 'cajero', 'admin']);

function emitChange() {
  try {
    window.dispatchEvent(new Event(DEVICE_PERMISSIONS_EVENT));
  } catch (_) {
    /* noop */
  }
}

export function isSecureOrigin() {
  if (typeof window === 'undefined') return false;
  return Boolean(window.isSecureContext);
}

/** @returns {'granted'|'denied'|'default'|'unsupported'|'insecure'} */
export function getNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  if (!isSecureOrigin()) return 'insecure';
  return Notification.permission;
}

/** @returns {Promise<'granted'|'denied'|'prompt'|'unsupported'|'insecure'|'unknown'>} */
export async function getCameraPermission() {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return isSecureOrigin() ? 'unsupported' : 'insecure';
  }
  try {
    const res = await navigator.permissions?.query?.({ name: 'camera' });
    return res?.state || 'unknown';
  } catch (_) {
    return 'unknown';
  }
}

export async function getDevicePermissionsStatus() {
  return {
    notifications: getNotificationPermission(),
    sound: isNotificationAudioUnlocked(),
    camera: await getCameraPermission(),
    secure: isSecureOrigin(),
  };
}

export async function requestNotificationPermission() {
  const current = getNotificationPermission();
  if (current !== 'default') return current;
  try {
    const result = await Promise.resolve(Notification.requestPermission());
    return result || Notification.permission;
  } catch (_) {
    return Notification.permission;
  }
}

export async function requestCameraPermission() {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return 'unsupported';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    stream.getTracks().forEach((t) => t.stop());
    return 'granted';
  } catch (err) {
    const name = String(err?.name || '');
    if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
    return 'unsupported';
  }
}

/** Debe llamarse desde un clic: sonido + notificaciones + cámara (asistencia con QR / foto). */
export async function requestAllDevicePermissions({ camera = true } = {}) {
  const sound = await unlockNotificationAudio().catch(() => false);
  const notifications = await requestNotificationPermission();
  const cam = camera ? await requestCameraPermission() : await getCameraPermission();
  emitChange();
  return { sound: Boolean(sound), notifications, camera: cam };
}

/** Pide solo el permiso de sonido (desbloquea el audio del navegador). */
export async function requestSoundPermission() {
  const ok = await unlockNotificationAudio().catch(() => false);
  emitChange();
  return Boolean(ok);
}

export async function requestNotificationPermissionOnly() {
  const res = await requestNotificationPermission();
  emitChange();
  return res;
}

export async function requestCameraPermissionOnly() {
  const res = await requestCameraPermission();
  emitChange();
  return res;
}

export function sendTestNotification() {
  playNotificationSound('ready', `permission-test-${Date.now()}`, { force: true, preview: true });
  try {
    if (!areWindowsNotificationsEnabled()) return false;
    if (getNotificationPermission() !== 'granted') return false;
    const n = new Notification('Pedido Mesa 1 está listo', { body: 'Así te llegarán los avisos de tus pedidos.', tag: 'rf-permission-test' });
    n.onclick = () => {
      try {
        window.focus();
      } catch (_) {
        /* noop */
      }
      n.close();
    };
    return true;
  } catch (_) {
    return false;
  }
}

export function isPermissionsBannerDismissed() {
  try {
    return Boolean(localStorage.getItem(BANNER_DISMISSED_KEY));
  } catch (_) {
    return false;
  }
}

export function dismissPermissionsBanner() {
  try {
    localStorage.setItem(BANNER_DISMISSED_KEY, new Date().toISOString());
  } catch (_) {
    /* noop */
  }
  emitChange();
}
