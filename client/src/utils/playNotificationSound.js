const SOUND_FILES = {
  kitchen: '/sounds/kitchen-notification.mp3',
  bar: '/sounds/bar-notification.mp3',
};

const preloadedAudio = {};
const playingKeys = new Set();
const recentOrderPlays = new Map();
const DEDUP_MS = 8000;

function normalizeType(type) {
  const key = String(type || '').trim().toLowerCase();
  if (key === 'kitchen' || key === 'cocina') return 'kitchen';
  if (key === 'bar') return 'bar';
  return '';
}

function buildPlayKey(type, orderKey) {
  const id = String(orderKey || '').trim();
  return id ? `${type}:${id}` : type;
}

function shouldSkipDuplicate(type, orderKey) {
  const id = String(orderKey || '').trim();
  if (!id) return false;
  const dedupeKey = `${type}:${id}`;
  const last = recentOrderPlays.get(dedupeKey) || 0;
  if (Date.now() - last < DEDUP_MS) return true;
  recentOrderPlays.set(dedupeKey, Date.now());
  if (recentOrderPlays.size > 200) {
    const cutoff = Date.now() - DEDUP_MS;
    for (const [key, ts] of recentOrderPlays.entries()) {
      if (ts < cutoff) recentOrderPlays.delete(key);
    }
  }
  return false;
}

function playFallbackBeep(type) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = type === 'bar' ? 880 : 660;
    gainNode.gain.setValueAtTime(0.001, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.38);
    oscillator.onended = () => {
      if (ctx.state !== 'closed') ctx.close().catch(() => {});
    };
  } catch (_) {
    // Navegador bloqueó audio sin interacción previa.
  }
}

function getPreloadedAudio(type) {
  if (preloadedAudio[type]) return preloadedAudio[type];
  const src = SOUND_FILES[type];
  if (!src) return null;
  const audio = new Audio(src);
  audio.preload = 'auto';
  audio.load();
  preloadedAudio[type] = audio;
  return audio;
}

/** Precarga el audio de la estación (cocina o bar). */
export function preloadNotificationSound(type) {
  const normalized = normalizeType(type);
  if (!normalized) return;
  getPreloadedAudio(normalized);
}

/**
 * Reproduce una notificación sonora para cocina o bar.
 * @param {'kitchen'|'bar'|'cocina'} type
 * @param {string} [orderKey] Id del pedido para evitar duplicados simultáneos.
 */
export function playNotificationSound(type, orderKey = '') {
  if (typeof window === 'undefined') return;
  const normalized = normalizeType(type);
  if (!normalized) return;
  if (shouldSkipDuplicate(normalized, orderKey)) return;

  const playKey = buildPlayKey(normalized, orderKey);
  if (playingKeys.has(playKey)) return;

  const template = getPreloadedAudio(normalized);
  if (!template) {
    playFallbackBeep(normalized);
    return;
  }

  const audio = template.cloneNode(true);
  audio.currentTime = 0;
  playingKeys.add(playKey);

  const cleanup = () => {
    playingKeys.delete(playKey);
    audio.removeEventListener('ended', cleanup);
    audio.removeEventListener('pause', cleanup);
  };

  audio.addEventListener('ended', cleanup);
  audio.addEventListener('pause', cleanup);

  const playPromise = audio.play();
  if (playPromise && typeof playPromise.catch === 'function') {
    playPromise.catch(() => {
      cleanup();
      playFallbackBeep(normalized);
    });
  }
}
