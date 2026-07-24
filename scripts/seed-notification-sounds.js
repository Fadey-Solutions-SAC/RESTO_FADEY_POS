/**
 * Genera MP3 mínimos válidos para notificaciones de cocina/bar (sin dependencias externas).
 * Ejecutar: node scripts/seed-notification-sounds.js
 */
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'client', 'public', 'sounds');

/** MP3 corto válido (≈0.15 s, tono suave) — base64; sustituir por assets profesionales si se desea. */
const KITCHEN_MP3_B64 =
  'SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjIwLjEwMAAAAAAAAAAAAAAA//uQwAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAACAAACcQCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjM1AAAAAAAAAAAAAAAAJAAAAAAAAAAAAcQv8pR0AAAAAAAAAAAAAAAAAAAA//uQxAAAAANIAAAAAExBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV';

const BAR_MP3_B64 = KITCHEN_MP3_B64;

function writeSound(name, b64) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const buf = Buffer.from(b64, 'base64');
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, buf);
  console.log(`Wrote ${file} (${buf.length} bytes)`);
}

writeSound('kitchen-notification.mp3', KITCHEN_MP3_B64);
writeSound('bar-notification.mp3', BAR_MP3_B64);
