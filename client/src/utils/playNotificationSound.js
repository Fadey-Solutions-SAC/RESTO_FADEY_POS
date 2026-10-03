const SOUND_FILES = {
  kitchen: '/sounds/kitchen-notification.wav',
  bar: '/sounds/bar-notification.wav',
  message: '/sounds/message-notification.wav',
  system: '/sounds/system-notification.wav',
};

const SOUND_TYPES = Object.keys(SOUND_FILES);

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
  if (key === 'message' || key === 'chat' || key === 'mensaje' || key === 'mensajes') return 'message';
  if (key === 'system' || key === 'notification' || key === 'notif' || key === 'aviso' || key === 'avisos') {
    return 'system';
  }
  if (key === 'alert' || key === 'alarm' || key === 'alerta' || key === 'delay' || key === 'demora') return 'alert';
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

  for (const type of SOUND_TYPES) {
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
    playNotificationSound(next.type, next.orderKey, { force: true, volume: next.volume });
  }
  return true;
}

function normalizeVolume(volume) {
  const v = Number(volume);
  if (!Number.isFinite(v)) return 1;
  return Math.min(1, Math.max(0, v));
}

/**
 * Alarma de pedido demorado: sirena aguda (zona donde el oído es más sensible), notas sostenidas,
 * dos osciladores por nota casi a escala completa (los avisos usan ~22 %) y un limitador para que no distorsione.
 * Nunca baja del 70 % aunque el volumen del área sea menor.
 */
function playAlarmTone(ctx, volume = 1) {
  const level = Math.max(0.7, normalizeVolume(volume));
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -3;
  compressor.knee.value = 0;
  compressor.ratio.value = 20;
  compressor.attack.value = 0.001;
  compressor.release.value = 0.05;
  const master = ctx.createGain();
  master.gain.value = level;
  compressor.connect(master);
  master.connect(ctx.destination);

  const pattern = [1568, 1047, 1568, 1047, 1568, 1047, 1568, 1047, 1568, 1047];
  const dur = 0.2;
  let t0 = ctx.currentTime + 0.02;
  pattern.forEach((freq) => {
    const note = ctx.createGain();
    note.gain.setValueAtTime(0.0001, t0);
    note.gain.linearRampToValueAtTime(0.9, t0 + 0.01);
    note.gain.setValueAtTime(0.9, t0 + dur - 0.03);
    note.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    note.connect(compressor);
    [['square', freq], ['sawtooth', freq * 2]].forEach(([wave, f], i) => {
      const osc = ctx.createOscillator();
      osc.type = wave;
      osc.frequency.value = f;
      const mix = ctx.createGain();
      mix.gain.value = i === 0 ? 0.7 : 0.35;
      osc.connect(mix);
      mix.connect(note);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    });
    t0 += dur + 0.04;
  });
  setTimeout(() => {
    try {
      master.disconnect();
      compressor.disconnect();
    } catch (_) {
      /* noop */
    }
  }, Math.ceil((t0 - ctx.currentTime + 0.5) * 1000));
}

function playFallbackBeep(type, volume = 1) {
  const peak = Math.max(0.0002, 0.22 * normalizeVolume(volume));
  try {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    const start = () => {
      if (type === 'alert') {
        playAlarmTone(ctx, volume);
        return;
      }
      const freqs =
        type === 'bar' ? [990, 1320]
          : type === 'message' ? [740, 980]
            : type === 'system' ? [520, 700, 880]
              : [660, 880, 1100];
      let t0 = ctx.currentTime + 0.01;
      freqs.forEach((freq, idx) => {
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = freq;
        const dur = idx === freqs.length - 1 ? 0.28 : 0.16;
        gainNode.gain.setValueAtTime(0.0001, t0);
        gainNode.gain.exponentialRampToValueAtTime(peak, t0 + 0.015);
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

/** Precarga el audio de un tipo (cocina, bar, mensaje o sistema). */
export function preloadNotificationSound(type) {
  const normalized = normalizeType(type);
  if (!normalized) return;
  getPreloadedAudio(normalized);
}

/**
 * Reproduce una notificación sonora.
 * @param {'kitchen'|'bar'|'cocina'|'message'|'system'|'chat'|'notification'} type
 * @param {string} [orderKey] Id del evento para evitar duplicados simultáneos.
 * @param {{ force?: boolean, volume?: number }} [opts] volume de 0 a 1 (por defecto 1).
 */
export function playNotificationSound(type, orderKey = '', opts = {}) {
  if (typeof window === 'undefined') return;
  const normalized = normalizeType(type);
  if (!normalized) return;
  if (!opts.force && shouldSkipDuplicate(normalized, orderKey)) return;
  const volume = normalizeVolume(opts.volume ?? 1);

  if (!audioUnlocked) {
    pendingPlay = { type: normalized, orderKey: String(orderKey || ''), volume };
    // Intentar igual: a veces el contexto ya está permitido (Electron / gesto previo).
  }

  const playKey = buildPlayKey(normalized, orderKey);
  if (playingKeys.has(playKey)) return;

  const template = getPreloadedAudio(normalized);
  if (!template) {
    playFallbackBeep(normalized, volume);
    return;
  }

  const audio = template.cloneNode(true);
  audio.volume = volume;
  audio.currentTime = 0;
  playingKeys.add(playKey);

  const cleanup = () => {
    playingKeys.delete(playKey);
    audio.removeEventListener('ended', cleanup);
    audio.removeEventListener('error', onError);
  };

  const onError = () => {
    cleanup();
    playFallbackBeep(normalized, volume);
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
          pendingPlay = { type: normalized, orderKey: String(orderKey || ''), volume };
        }
        playFallbackBeep(normalized, volume);
      });
  }
}
