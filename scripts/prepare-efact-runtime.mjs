/**
 * Prepara Python embebido + dependencias e-fact para el instalador
 * Fadey.Impresion.Setup.exe (una sola instalación = impresión + facturación).
 *
 * Salida: build/efact-runtime/  (extraResources → resources/efact-runtime)
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import https from 'https';
import http from 'http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'build', 'efact-runtime');
const TMP = join(ROOT, 'build', 'efact-runtime-tmp');
const PY_VER = '3.12.8';
const PY_ZIP = `python-${PY_VER}-embed-amd64.zip`;
const PY_URL = `https://www.python.org/ftp/python/${PY_VER}/${PY_ZIP}`;
const GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py';
const REQUIREMENTS = join(ROOT, 'server', 'efact', 'requirements.txt');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'resto-fadey-prepare-efact' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        download(res.headers.location, dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} al descargar ${url}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
    });
    req.on('error', reject);
  });
}

function unzipWindows(zipPath, destDir) {
  mkdirSync(destDir, { recursive: true });
  // PowerShell Expand-Archive es fiable en Windows.
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
    ],
    { stdio: 'inherit' },
  );
}

function enableSiteInPth(runtimeDir) {
  const files = ['python312._pth', 'python311._pth', 'python310._pth'];
  for (const name of files) {
    const p = join(runtimeDir, name);
    if (!existsSync(p)) continue;
    let text = readFileSync(p, 'utf8');
    text = text.replace(/^#\s*import\s+site\s*$/m, 'import site');
    if (!/^import\s+site\s*$/m.test(text)) {
      text = `${text.trimEnd()}\nimport site\n`;
    }
    if (!text.includes('.')) {
      text = `.\n${text}`;
    }
    writeFileSync(p, text, 'utf8');
    console.log('[efact-runtime] habilitado import site en', name);
    return;
  }
  console.warn('[efact-runtime] no se encontró python*._pth');
}

async function main() {
  if (process.env.EFACT_RUNTIME_SKIP === '1') {
    console.log('[efact-runtime] omitido (EFACT_RUNTIME_SKIP=1)');
    return;
  }
  if (!existsSync(REQUIREMENTS)) {
    throw new Error(`Falta ${REQUIREMENTS}`);
  }

  mkdirSync(join(ROOT, 'build'), { recursive: true });
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });

  const zipPath = join(TMP, PY_ZIP);
  const getPipPath = join(TMP, 'get-pip.py');

  console.log('[efact-runtime] descargando Python embed', PY_VER);
  await download(PY_URL, zipPath);
  console.log('[efact-runtime] descargando get-pip.py');
  await download(GET_PIP_URL, getPipPath);

  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  unzipWindows(zipPath, OUT);
  enableSiteInPth(OUT);

  const pythonExe = join(OUT, 'python.exe');
  if (!existsSync(pythonExe)) {
    throw new Error('python.exe no apareció tras descomprimir el embed');
  }

  console.log('[efact-runtime] instalando pip');
  execFileSync(pythonExe, [getPipPath, '--no-warn-script-location'], {
    cwd: OUT,
    stdio: 'inherit',
    env: { ...process.env, PYTHONUTF8: '1' },
  });

  console.log('[efact-runtime] instalando requirements e-fact');
  execFileSync(
    pythonExe,
    ['-m', 'pip', 'install', '--no-warn-script-location', '-r', REQUIREMENTS],
    {
      cwd: OUT,
      stdio: 'inherit',
      env: { ...process.env, PYTHONUTF8: '1' },
    },
  );

  // Copia marcada de versión para diagnóstico en cliente.
  writeFileSync(
    join(OUT, 'RESTO_FADEY_EFACT_RUNTIME.txt'),
    `python=${PY_VER}\nbuilt=${new Date().toISOString()}\n`,
    'utf8',
  );

  rmSync(TMP, { recursive: true, force: true });
  console.log('[efact-runtime] listo en', OUT);
}

main().catch((err) => {
  console.error('[efact-runtime] ERROR:', err.message || err);
  process.exit(1);
});
