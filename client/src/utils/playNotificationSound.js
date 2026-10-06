import { isSoundCategoryEnabled } from './soundPrefs';

/** Cocina y bar (llegada a producción) usan sus WAV; el resto se sintetiza para que cada aviso sea distinto. */
const SOUND_FILES = {
  kitchen: '/sounds/kitchen-notification.wav',
  bar: '/sounds/bar-notification.wav',
};

const SYNTH_TYPES = new Set(['message', 'system', 'ai', 'ready', 'alert']);

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
  if (key === 'ai' || key === 'ia' || key === 'fadey-ai') return 'ai';
  if (key === 'ready' || key === 'listo' || key === 'order-ready' || key === 'waiter-ready') return 'ready';
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
 * Cadena de salida a máximo nivel: ganancia de empuje → limitador duro → salida a escala completa.
 * El limitador mantiene el pico bajo 0 dBFS para que suene lo más fuerte posible sin distorsionar.
 */
function createLoudOutput(ctx, volume = 1, drive = 2.4) {
  const input = ctx.createGain();
  input.gain.value = drive;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.06;
  const master = ctx.createGain();
  master.gain.value = normalizeVolume(volume);
  input.connect(limiter);
  limiter.connect(master);
  master.connect(ctx.destination);
  const dispose = (ms) => setTimeout(() => {
    try {
      input.disconnect();
      limiter.disconnect();
      master.disconnect();
    } catch (_) {
      /* noop */
    }
  }, ms);
  return { input, dispose };
}

/** Nota con envolvente; `partials` = [[forma, multiplicador de frecuencia, nivel], …]. */
function tone(ctx, out, { freq, t0, dur, peak = 0.9, attack = 0.008, partials = [['sine', 1, 1]], glideTo = 0, sustain = false }) {
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.linearRampToValueAtTime(peak, t0 + attack);
  if (sustain) {
    env.gain.setValueAtTime(peak, t0 + dur - 0.03);
    env.gain.linearRampToValueAtTime(0.0001, t0 + dur);
  } else {
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }
  env.connect(out);
  partials.forEach(([wave, mult, level]) => {
    const osc = ctx.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq * mult, t0);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo * mult, t0 + dur * 0.8);
    const mix = ctx.createGain();
    mix.gain.value = level;
    osc.connect(mix);
    mix.connect(env);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  });
}

/** Mensajes: doble «burbuja» con deslizamiento ascendente (tipo chat). */
function synthMessage(ctx, out, t) {
  const bubble = [['sine', 1, 0.8], ['triangle', 2, 0.35]];
  tone(ctx, out, { freq: 880, glideTo: 1320, t0: t, dur: 0.14, partials: bubble });
  tone(ctx, out, { freq: 1175, glideTo: 1760, t0: t + 0.16, dur: 0.2, partials: bubble });
  return t + 0.4;
}

/** Notificaciones: campana «din-don» con parciales metálicos. */
function synthSystem(ctx, out, t) {
  const bell = [['sine', 1, 0.7], ['sine', 2.76, 0.3], ['sine', 5.4, 0.15], ['triangle', 1, 0.3]];
  tone(ctx, out, { freq: 1046.5, t0: t, dur: 0.75, attack: 0.004, partials: bell });
  tone(ctx, out, { freq: 784, t0: t + 0.32, dur: 0.95, attack: 0.004, partials: bell });
  return t + 1.3;
}

/** Fadey IA: arpegio futurista con brillo desafinado (sonido «inteligente»). */
function synthAi(ctx, out, t) {
  const shimmer = [['sine', 1, 0.6], ['sine', 1.005, 0.6], ['triangle', 2, 0.25]];
  [659.25, 987.77, 1318.5, 1975.5].forEach((f, i) => {
    tone(ctx, out, { freq: f, t0: t + i * 0.085, dur: 0.38, attack: 0.006, partials: shimmer });
  });
  tone(ctx, out, { freq: 2637, glideTo: 3520, t0: t + 0.36, dur: 0.32, peak: 0.55, partials: [['sine', 1, 1]] });
  return t + 0.8;
}

/** Pedido listo (mozo/caja): fanfarria corta ascendente Do-Mi-Sol-Do, brillante y clara. */
function synthReady(ctx, out, t) {
  const brass = [['square', 1, 0.4], ['triangle', 1, 0.6], ['sine', 2, 0.25]];
  const seq = [[523.25, 0.11], [659.25, 0.11], [783.99, 0.11], [1046.5, 0.42]];
  let at = t;
  seq.forEach(([f, d]) => {
    tone(ctx, out, { freq: f, t0: at, dur: d, attack: 0.006, partials: brass, sustain: true });
    at += d + 0.025;
  });
  return at + 0.1;
}

/**
 * Alarma de pedido demorado (se mantiene el patrón de áreas): sirena aguda alternada, notas sostenidas,
 * square + sawtooth. Siempre a nivel máximo, sin importar el volumen del área.
 */
function synthAlarm(ctx, out, t) {
  const pattern = [1568, 1047, 1568, 1047, 1568, 1047, 1568, 1047, 1568, 1047];
  const dur = 0.2;
  let at = t;
  pattern.forEach((freq) => {
    tone(ctx, out, {
      freq,
      t0: at,
      dur,
      attack: 0.01,
      partials: [['square', 1, 0.7], ['sawtooth', 2, 0.35]],
      sustain: true,
    });
    at += dur + 0.04;
  });
  return at;
}

const SYNTHS = {
  message: synthMessage,
  system: synthSystem,
  ai: synthAi,
  ready: synthReady,
  alert: synthAlarm,
};

function playSynth(type, volume = 1) {
  const synth = SYNTHS[type];
  if (!synth) return false;
  try {
    const ctx = getSharedAudioContext();
    if (!ctx) return false;
    const start = () => {
      const level = type === 'alert' ? 1 : volume;
      const { input, dispose } = createLoudOutput(ctx, level);
      const t0 = ctx.currentTime + 0.02;
      const end = synth(ctx, input, t0);
      dispose(Math.ceil((end - ctx.currentTime + 0.5) * 1000));
    };
    if (ctx.state === 'suspended') {
      ctx.resume().then(start).catch(() => {});
    } else {
      start();
    }
    return true;
  } catch (_) {
    return false;
  }
}

/** Respaldo si el WAV de cocina/bar no carga: mismo carácter que antes, a nivel máximo. */
function playFallbackBeep(type, volume = 1) {
  if (playSynth(type, volume)) return;
  try {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    const start = () => {
      const { input, dispose } = createLoudOutput(ctx, volume);
      const freqs = type === 'bar' ? [990, 1320] : [660, 880, 1100];
      let t0 = ctx.currentTime + 0.01;
      freqs.forEach((freq, idx) => {
        const dur = idx === freqs.length - 1 ? 0.28 : 0.16;
        tone(ctx, input, { freq, t0, dur, partials: [['sine', 1, 1]] });
        t0 += dur + 0.05;
      });
      dispose(Math.ceil((t0 - ctx.currentTime + 0.5) * 1000));
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

/** Ganancia extra sobre el WAV (HTMLAudio no pasa de 1.0); el limitador evita que distorsione. */
const SOUND_BOOST = { kitchen: 4, bar: 4 };
const decodedBuffers = {};

async function getDecodedBuffer(ctx, type) {
  if (decodedBuffers[type]) return decodedBuffers[type];
  const src = SOUND_FILES[type];
  if (!src) return null;
  decodedBuffers[type] = fetch(src)
    .then((r) => {
      if (!r.ok) throw new Error('sound fetch');
      return r.arrayBuffer();
    })
    .then((buf) => new Promise((resolve, reject) => {
      const p = ctx.decodeAudioData(buf, resolve, reject);
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    }))
    .catch((err) => {
      delete decodedBuffers[type];
      throw err;
    });
  return decodedBuffers[type];
}

async function playBoostedSound(type, volume) {
  const ctx = getSharedAudioContext();
  if (!ctx) return false;
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch (_) {
      return false;
    }
  }
  if (ctx.state !== 'running') return false;
  const buffer = await getDecodedBuffer(ctx, type);
  if (!buffer) return false;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = normalizeVolume(volume) * (SOUND_BOOST[type] || 1);
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.08;
  source.connect(gain);
  gain.connect(limiter);
  limiter.connect(ctx.destination);
  source.onended = () => {
    try {
      source.disconnect();
      gain.disconnect();
      limiter.disconnect();
    } catch (_) {
      /* noop */
    }
  };
  source.start();
  return true;
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
 * @param {'kitchen'|'bar'|'message'|'system'|'ai'|'ready'|'alert'} type
 * @param {string} [orderKey] Id del evento para evitar duplicados simultáneos.
 * @param {{ force?: boolean, volume?: number, preview?: boolean }} [opts]
 *   volume de 0 a 1 (por defecto 1); preview suena aunque el tipo esté desactivado en este equipo.
 */
export function playNotificationSound(type, orderKey = '', opts = {}) {
  if (typeof window === 'undefined') return;
  const normalized = normalizeType(type);
  if (!normalized) return;
  if (!opts.preview && !isSoundCategoryEnabled(normalized)) return;
  if (!opts.force && shouldSkipDuplicate(normalized, orderKey)) return;
  const volume = normalizeVolume(opts.volume ?? 1);

  if (!audioUnlocked) {
    pendingPlay = { type: normalized, orderKey: String(orderKey || ''), volume };
    // Intentar igual: a veces el contexto ya está permitido (Electron / gesto previo).
  }

  const playKey = buildPlayKey(normalized, orderKey);
  if (playingKeys.has(playKey)) return;

  if (SYNTH_TYPES.has(normalized)) {
    playingKeys.add(playKey);
    const ok = playSynth(normalized, volume);
    if (ok && getSharedAudioContext()?.state === 'running') {
      pendingPlay = null;
      audioUnlocked = true;
      notifyUnlockListeners();
    }
    setTimeout(() => playingKeys.delete(playKey), 1200);
    return;
  }

  if (SOUND_FILES[normalized]) {
    playingKeys.add(playKey);
    playBoostedSound(normalized, volume)
      .then((ok) => {
        if (ok) {
          pendingPlay = null;
          audioUnlocked = true;
          notifyUnlockListeners();
          setTimeout(() => playingKeys.delete(playKey), 1500);
          return;
        }
        playingKeys.delete(playKey);
        playWithHtmlAudio(normalized, orderKey, volume, playKey);
      })
      .catch(() => {
        playingKeys.delete(playKey);
        playWithHtmlAudio(normalized, orderKey, volume, playKey);
      });
    return;
  }
  playWithHtmlAudio(normalized, orderKey, volume, playKey);
}

function playWithHtmlAudio(normalized, orderKey, volume, playKey) {
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
