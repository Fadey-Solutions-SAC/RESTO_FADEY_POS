/**
 * Iconos PWA desde la imagen de marca (no usar favicon.svg legacy).
 * Invoca scripts/generate-branding-assets.js en la raíz del repo.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const script = join(repoRoot, 'scripts', 'generate-branding-assets.js');
const source = join(repoRoot, 'client', 'public', 'branding', 'resto-fadey-source.png');

if (!existsSync(script)) {
  console.error('No se encontró:', script);
  process.exit(1);
}
if (!existsSync(source)) {
  console.error('Falta la imagen de marca:', source);
  process.exit(1);
}

const result = spawnSync(process.execPath, [script, source], {
  cwd: repoRoot,
  stdio: 'inherit',
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log('OK: iconos PWA desde resto-fadey-source.png');
