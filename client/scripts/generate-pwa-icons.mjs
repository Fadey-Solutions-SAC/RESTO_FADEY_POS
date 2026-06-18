/**
 * Iconos PWA desde la imagen de marca (no usar favicon.svg legacy).
 * Invoca scripts/generate-branding-assets.js en la raíz del repo.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientRoot = join(__dirname, '..');
const publicDir = join(clientRoot, 'public');
const repoRoot = join(clientRoot, '..');
const script = join(repoRoot, 'scripts', 'generate-branding-assets.js');
const source = join(publicDir, 'branding', 'resto-fadey-source.png');

/** Vercel usa Root Directory = client; no hay scripts/ de la raíz del repo. */
function hasCommittedBrandingAssets() {
  return (
    existsSync(join(publicDir, 'pwa-icon-192.png')) &&
    existsSync(join(publicDir, 'pwa-icon-512.png')) &&
    existsSync(join(publicDir, 'branding', 'resto-fadey-logo.png'))
  );
}

if (!existsSync(script) || !existsSync(source)) {
  if (hasCommittedBrandingAssets()) {
    console.log('OK: iconos PWA ya en public/ (deploy solo client/, sin regenerar)');
    process.exit(0);
  }
  if (!existsSync(script)) {
    console.error('No se encontró:', script);
    process.exit(1);
  }
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
