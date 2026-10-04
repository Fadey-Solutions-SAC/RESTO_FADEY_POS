import toast from 'react-hot-toast';

/**
 * Detecta cuando Vercel publica una versión nueva y recarga la pestaña sola cuando nadie la usa
 * (las cajas dejan el POS abierto todo el día y seguían con el código viejo en memoria).
 */
const CHECK_EVERY_MS = 3 * 60 * 1000;
const IDLE_BEFORE_RELOAD_MS = 2 * 60 * 1000;

const CURRENT_BUILD = typeof __APP_BUILD_ID__ !== 'undefined' ? __APP_BUILD_ID__ : '';

let started = false;
let updatePending = false;
let lastActivityAt = Date.now();

async function fetchPublishedBuildId() {
  try {
    const res = await fetch(`/build-meta.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return '';
    const data = await res.json();
    return String(data?.buildId || '').trim();
  } catch (_) {
    return '';
  }
}

function hasOpenDialogOrTyping() {
  if (typeof document === 'undefined') return true;
  if (document.querySelector('[role="dialog"], [aria-modal="true"]')) return true;
  const el = document.activeElement;
  const tag = String(el?.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || Boolean(el?.isContentEditable);
}

/** En pantallas de producción una recarga sola bloquearía el sonido de pedidos hasta que alguien toque. */
function isProductionScreen() {
  return /\/(produccion|cocina|kitchen|bar)(\/|$)/i.test(window.location.pathname);
}

let noticeShown = false;
function showUpdateNotice() {
  if (noticeShown) return;
  noticeShown = true;
  toast(
    (t) => (
      <button
        type="button"
        className="text-sm font-semibold text-left"
        onClick={() => {
          toast.dismiss(t.id);
          window.location.reload();
        }}
      >
        Hay una versión nueva del sistema. Toque aquí para actualizar.
      </button>
    ),
    { duration: Infinity, id: 'app-update-available' },
  );
}

function reloadIfSafe() {
  if (!updatePending) return;
  if (isProductionScreen()) {
    showUpdateNotice();
    return;
  }
  const hidden = document.visibilityState === 'hidden';
  const idle = Date.now() - lastActivityAt >= IDLE_BEFORE_RELOAD_MS;
  if (hidden || (idle && !hasOpenDialogOrTyping())) {
    window.location.reload();
  }
}

async function checkForUpdate() {
  if (updatePending || !CURRENT_BUILD) return;
  const published = await fetchPublishedBuildId();
  if (published && published !== CURRENT_BUILD) {
    updatePending = true;
    reloadIfSafe();
  }
}

export function startAppUpdateWatcher() {
  if (started || typeof window === 'undefined') return;
  if (!import.meta.env.PROD || import.meta.env.BASE_URL === './') return;
  started = true;

  const markActivity = () => {
    lastActivityAt = Date.now();
  };
  ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach((evt) => {
    window.addEventListener(evt, markActivity, { passive: true });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkForUpdate();
    else reloadIfSafe();
  });

  setInterval(() => void checkForUpdate(), CHECK_EVERY_MS);
  setInterval(reloadIfSafe, 30 * 1000);
  setTimeout(() => void checkForUpdate(), 30 * 1000);
}
