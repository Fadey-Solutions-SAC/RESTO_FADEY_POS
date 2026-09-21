/**
 * Genera WAV audibles para notificaciones (sin dependencias).
 * Ejecutar: node scripts/seed-notification-sounds.js
 */
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'client', 'public', 'sounds');
const SAMPLE_RATE = 22050;

function writeWav(filePath, samples) {
  const numSamples = samples.length;
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numSamples; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
  console.log(`Wrote ${filePath} (${buffer.length} bytes)`);
}

function tone(freq, durationSec, gain = 0.45) {
  const n = Math.floor(SAMPLE_RATE * durationSec);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = i / SAMPLE_RATE;
    const env = Math.min(1, i / (SAMPLE_RATE * 0.012)) * Math.min(1, (n - i) / (SAMPLE_RATE * 0.04));
    out[i] = Math.sin(2 * Math.PI * freq * t) * gain * env;
  }
  return out;
}

function silence(durationSec) {
  return new Float32Array(Math.floor(SAMPLE_RATE * durationSec));
}

function concat(...parts) {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Cocina: tres tonos ascendentes (alerta clara). */
const kitchenSamples = concat(
  tone(660, 0.18, 0.5),
  silence(0.06),
  tone(880, 0.18, 0.5),
  silence(0.06),
  tone(1100, 0.28, 0.55),
);

/** Bar: dos tonos más agudos. */
const barSamples = concat(
  tone(990, 0.16, 0.5),
  silence(0.05),
  tone(1320, 0.32, 0.55),
);

/** Mensajes del equipo: dos tonos suaves. */
const messageSamples = concat(
  tone(740, 0.12, 0.42),
  silence(0.04),
  tone(980, 0.2, 0.48),
);

/** Avisos / notificaciones del sistema: tres tonos cortos. */
const systemSamples = concat(
  tone(520, 0.1, 0.45),
  silence(0.035),
  tone(700, 0.1, 0.45),
  silence(0.035),
  tone(880, 0.22, 0.5),
);

writeWav(path.join(OUT_DIR, 'kitchen-notification.wav'), kitchenSamples);
writeWav(path.join(OUT_DIR, 'bar-notification.wav'), barSamples);
writeWav(path.join(OUT_DIR, 'message-notification.wav'), messageSamples);
writeWav(path.join(OUT_DIR, 'system-notification.wav'), systemSamples);
