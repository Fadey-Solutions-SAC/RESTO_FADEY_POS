/**
 * Sonido de apertura (splash): elegante, tecnológico y futurista, sintetizado con Web Audio (sin archivos).
 * Sincronizado con la animación de RestoFadeyEntrySplash (~3,4 s):
 *  0,00 s  barrido de energía ascendente + sub-bajo (aparece el logo)
 *  0,95 s  acorde de cristal con brillo (pico del «pop» del logo)
 *  0,55–2,6 s  destellos digitales en arpegio (barrido de brillo y circuitos)
 *  3,00 s  cola suave descendente (salida)
 */

const SPLASH_SOUND_OFF_KEY = 'rf_splash_sound_off';
let playedThisLoad = false;

export function isSplashSoundEnabled() {
  try {
    return localStorage.getItem(SPLASH_SOUND_OFF_KEY) !== '1';
  } catch (_) {
    return true;
  }
}

export function setSplashSoundEnabled(enabled) {
  try {
    if (enabled) localStorage.removeItem(SPLASH_SOUND_OFF_KEY);
    else localStorage.setItem(SPLASH_SOUND_OFF_KEY, '1');
  } catch (_) {
    /* noop */
  }
}

function createReverb(ctx, seconds = 2.4, decay = 3) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const impulse = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch += 1) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
  }
  const conv = ctx.createConvolver();
  conv.buffer = impulse;
  return conv;
}

function noiseBuffer(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
  return buf;
}

function panner(ctx, pan) {
  if (typeof ctx.createStereoPanner !== 'function') return ctx.createGain();
  const p = ctx.createStereoPanner();
  p.pan.value = pan;
  return p;
}

/** Barrido de energía: ruido filtrado que sube de grave a agudo. */
function energySweep(ctx, out, t0) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, 1.4);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 6;
  bp.frequency.setValueAtTime(250, t0);
  bp.frequency.exponentialRampToValueAtTime(5200, t0 + 1.0);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.32, t0 + 0.85);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.25);
  src.connect(bp).connect(g).connect(out);
  src.start(t0);
  src.stop(t0 + 1.4);
}

/** Sub-bajo que crece hasta el «pop» del logo. */
function subSwell(ctx, out, t0) {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(42, t0);
  osc.frequency.exponentialRampToValueAtTime(64, t0 + 0.95);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.9);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.2);
  osc.connect(g).connect(out);
  osc.start(t0);
  osc.stop(t0 + 2.3);
}

/** Acorde de cristal (La mayor 9) con leve desafinado estéreo: el momento «elegante». */
function glassChord(ctx, out, t0) {
  const notes = [220, 329.63, 440, 554.37, 659.25, 987.77];
  notes.forEach((f, i) => {
    [-6, 6].forEach((cents, side) => {
      const osc = ctx.createOscillator();
      osc.type = i < 2 ? 'triangle' : 'sine';
      osc.frequency.value = f;
      osc.detune.value = cents;
      const g = ctx.createGain();
      const peak = (i < 2 ? 0.075 : 0.055) / (1 + i * 0.12);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.6 - i * 0.12);
      const p = panner(ctx, side === 0 ? -0.35 : 0.35);
      osc.connect(g).connect(p).connect(out);
      osc.start(t0);
      osc.stop(t0 + 2.7);
    });
  });
}

/** Destellos digitales en arpegio, alternando izquierda/derecha. */
function digitalSparkles(ctx, out, t0) {
  const seq = [1760, 2217.46, 2637.02, 3520, 2637.02, 3520, 4434.92, 5274.04];
  seq.forEach((f, i) => {
    const t = t0 + i * 0.12;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(f * 1.012, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    const p = panner(ctx, i % 2 === 0 ? -0.6 : 0.6);
    osc.connect(g).connect(p).connect(out);
    osc.start(t);
    osc.stop(t + 0.35);
  });
}

/** Pulso de datos breve (tipo «escaneo») entre destellos. */
function dataBlips(ctx, out, t0) {
  [0, 0.07, 0.14].forEach((dt, i) => {
    const t = t0 + dt;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 1200 + i * 400;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.022, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    osc.connect(lp).connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 0.06);
  });
}

/** Cola de salida: barrido suave descendente. */
function exitWhoosh(ctx, out, t0) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, 0.6);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 4;
  bp.frequency.setValueAtTime(3800, t0);
  bp.frequency.exponentialRampToValueAtTime(600, t0 + 0.45);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.08);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
  src.connect(bp).connect(g).connect(out);
  src.start(t0);
  src.stop(t0 + 0.6);
}

/**
 * Reproduce el sonido de apertura una vez por carga de página.
 * En la app de escritorio suena siempre; en navegador solo si permite audio sin clic previo.
 */
export function playSplashSound({ volume = 1 } = {}) {
  if (playedThisLoad || typeof window === 'undefined' || !isSplashSoundEnabled()) return;
  playedThisLoad = true;
  startSplashSound(volume);
}

/** Vista previa (desde un clic, p. ej. Mi perfil): suena aunque esté desactivado o ya haya sonado. */
export function previewSplashSound({ volume = 1 } = {}) {
  if (typeof window === 'undefined') return;
  startSplashSound(volume);
}

function startSplashSound(volume) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  let ctx;
  try {
    ctx = new Ctx();
  } catch (_) {
    return;
  }

  const run = () => {
    const t0 = ctx.currentTime + 0.05;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.2;
    const master = ctx.createGain();
    master.gain.value = Math.min(1, Math.max(0, volume));
    limiter.connect(master).connect(ctx.destination);

    const dry = ctx.createGain();
    dry.gain.value = 0.9;
    dry.connect(limiter);
    const reverb = createReverb(ctx);
    const wet = ctx.createGain();
    wet.gain.value = 0.45;
    reverb.connect(wet).connect(limiter);
    const bus = ctx.createGain();
    bus.gain.value = 2.6;
    bus.connect(dry);
    bus.connect(reverb);

    energySweep(ctx, bus, t0);
    subSwell(ctx, dry, t0);
    dataBlips(ctx, bus, t0 + 0.35);
    glassChord(ctx, bus, t0 + 0.95);
    digitalSparkles(ctx, bus, t0 + 0.6);
    dataBlips(ctx, bus, t0 + 1.9);
    exitWhoosh(ctx, bus, t0 + 3.0);

    setTimeout(() => {
      try {
        void ctx.close();
      } catch (_) {
        /* noop */
      }
    }, 6500);
  };

  if (ctx.state === 'suspended') {
    ctx.resume().then(() => {
      if (ctx.state === 'running') run();
      else void ctx.close();
    }).catch(() => {
      try {
        void ctx.close();
      } catch (_) {
        /* noop */
      }
    });
    setTimeout(() => {
      if (ctx.state === 'suspended') {
        try {
          void ctx.close();
        } catch (_) {
          /* noop */
        }
      }
    }, 600);
  } else {
    run();
  }
}
