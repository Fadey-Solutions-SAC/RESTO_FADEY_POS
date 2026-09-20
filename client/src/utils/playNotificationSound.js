const SOUND_FILES = {
  kitchen: '/sounds/kitchen-notification.wav',
  bar: '/sounds/bar-notification.wav',
};

const preloadedAudio = {};
const playingKeys = new Set();
const recentOrderPlays = new Map();
const DEDUP_MS = 8000;

let sharedAudioCtx = null;
let audioUnlocked = false;
let pendingPlay = null;
const unlockListeners = new Set();

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

function getSharedAudioContext() {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    sharedAudioCtx = new Ctx();
  }
  return sharedAudioCtx;
}

function notifyUnlockListeners() {
  unlockListeners.forEach((fn) => {
    try {
      fn(audioUnlocked);
    } catch (_) {
      /* noop */
    }
  });
}

/** Suscribe cambios de desbloqueo de audio (p. ej. banner en cocina). */
export function onNotificationAudioUnlockChange(listener) {
  if (typeof listener !== 'function') return () => {};
  unlockListeners.add(listener);
  try {
    listener(audioUnlocked);
  } catch (_) {
    /* noop */
  }
  return () => unlockListeners.delete(listener);
}

export function isNotificationAudioUnlocked() {
  return audioUnlocked;
}

/**
 * Debe llamarse tras un gesto del usuario (click/tap) en navegadores web.
 * En Electron (autoplay libre) desbloquea al montar cocina/bar sin gesto.
 */
export async function unlockNotificationAudio() {
  if (typeof window === 'undefined') return false;
  const ctx = getSharedAudioContext();
  try {
    if (ctx && ctx.state === 'suspended') {
      await ctx.resume();
    }
  } catch (_) {
    /* noop */
  }

  const types = ['kitchen', 'bar'];
  for (const type of types) {
    const audio = getPreloadedAudio(type);
    if (!audio) continue;
    try {
      audio.muted = true;
      audio.currentTime = 0;
      await audio.play();
      audio.pause();
      audio.currentTime = 0;
      audio.muted = false;
    } catch (_) {
      try {
        audio.muted = false;
      } catch (__) {
        /* noop */
      }
    }
  }

  audioUnlocked = true;
  notifyUnlockListeners();

  if (pendingPlay) {
    const next = pendingPlay;
    pendingPlay = null;
    playNotificationSound(next.type, next.orderKey, { force: true });
  }
  return true;
}

function playFallbackBeep(type) {
  try {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    const start = () => {
      const freqs = type === 'bar' ? [990, 1320] : [660, 880, 1100];
      let t0 = ctx.currentTime + 0.01;
      freqs.forEach((freq, idx) => {
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = freq;
        const dur = idx === freqs.length - 1 ? 0.28 : 0.16;
        gainNode.gain.setValueAtTime(0.0001, t0);
        gainNode.gain.exponentialRampToValueAtTime(0.22, t0 + 0.015);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);
        oscillator.start(t0);
        oscillator.stop(t0 + dur + 0.02);
        t0 += dur + 0.05;
      });
    };
    if (ctx.state === 'suspended') {
      ctx.resume().then(start).catch(() => {});
    } else {
      start();
    }
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
  audio.volume = 1;
  try {
    audio.load();
  } catch (_) {
    /* noop */
  }
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
 * @param {{ force?: boolean }} [opts]
 */
export function playNotificationSound(type, orderKey = '', opts = {}) {
  if (typeof window === 'undefined') return;
  const normalized = normalizeType(type);
  if (!normalized) return;
  if (!opts.force && shouldSkipDuplicate(normalized, orderKey)) return;

  if (!audioUnlocked) {
    pendingPlay = { type: normalized, orderKey: String(orderKey || '') };
    // Intentar igual: a veces el contexto ya está permitido (Electron / gesto previo).
  }

  const playKey = buildPlayKey(normalized, orderKey);
  if (playingKeys.has(playKey)) return;

  const template = getPreloadedAudio(normalized);
  if (!template) {
    playFallbackBeep(normalized);
    return;
  }

  const audio = template.cloneNode(true);
  audio.volume = 1;
  audio.currentTime = 0;
  playingKeys.add(playKey);

  const cleanup = () => {
    playingKeys.delete(playKey);
    audio.removeEventListener('ended', cleanup);
    audio.removeEventListener('error', onError);
  };

  const onError = () => {
    cleanup();
    playFallbackBeep(normalized);
  };

  audio.addEventListener('ended', cleanup);
  audio.addEventListener('error', onError);

  const playPromise = audio.play();
  if (playPromise && typeof playPromise.then === 'function') {
    playPromise
      .then(() => {
        audioUnlocked = true;
        notifyUnlockListeners();
      })
      .catch(() => {
        cleanup();
        if (!audioUnlocked) {
          pendingPlay = { type: normalized, orderKey: String(orderKey || '') };
        }
        playFallbackBeep(normalized);
      });
  }
}
