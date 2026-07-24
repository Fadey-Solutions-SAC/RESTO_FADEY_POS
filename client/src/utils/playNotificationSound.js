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
  if (!template) return;

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
    });
  }
}
