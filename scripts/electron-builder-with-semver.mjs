/**
 * electron-builder exige semver A.B.C (3 segmentos).
 * El sistema usa A.B.C.D en package.json (UI). Aquí se convierte solo para el build:
 *   1.1.6.3 → 1.1.63   (C*10 + D, con C,D en 0–9)
 * Luego restaura package.json.
 */
import { readFileSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = join(root, 'package.json');

function toElectronSemver(version) {
  const parts = String(version || '')
    .trim()
    .split('.')
    .map((p) => Number(p));
  if (parts.length === 3 && parts.every((n) => Number.isInteger(n) && n >= 0)) {
    return parts.join('.');
  }
  if (parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 9)) {
    const [a, b, c, d] = parts;
    return `${a}.${b}.${c * 10 + d}`;
  }
  if (parts.length >= 5 && parts.every((n) => Number.isInteger(n) && n >= 0)) {
    // 1.0.0.0.0 → 1.0.0 (primeros 3) + build metadata opcional
    return `${parts[0]}.${parts[1]}.${parts[2]}`;
  }
  throw new Error(`Versión no convertible a semver para electron-builder: ${version}`);
}

const original = readFileSync(pkgPath, 'utf8');
const pkg = JSON.parse(original);
const displayVersion = String(pkg.version || '').trim();
const electronVersion = toElectronSemver(displayVersion);

pkg.version = electronVersion;
if (!pkg.extraMetadata || typeof pkg.extraMetadata !== 'object') pkg.extraMetadata = {};
pkg.extraMetadata.main = pkg.extraMetadata.main || 'electron/main.js';
pkg.extraMetadata.restoFadeyDisplayVersion = displayVersion;

writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
console.log(`[electron-semver] UI ${displayVersion} → instalador/semver ${electronVersion}`);

const args = process.argv.slice(2);
let exitCode = 1;
try {
  const r = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['electron-builder', ...args],
    { cwd: root, stdio: 'inherit', env: process.env, shell: process.platform === 'win32' },
  );
  exitCode = r.status == null ? 1 : r.status;
} finally {
  writeFileSync(pkgPath, original, 'utf8');
  console.log(`[electron-semver] package.json restaurado a ${displayVersion}`);
}

process.exit(exitCode);
