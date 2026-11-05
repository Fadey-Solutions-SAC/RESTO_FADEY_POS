/**
 * Prepara Python embebido + dependencias e-fact para el instalador
 * Fadey.Impresion.Setup.exe (una sola instalación = impresión + facturación).
 *
 * Salida: build/efact-runtime/  (extraResources → resources/efact-runtime)
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync, spawnSync } from 'child_process';
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
const MIN_PY_ZIP_BYTES = 8_000_000;

function download(url, dest, { idleMs = 25000, maxMs = 180000 } = {}) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    const lib = url.startsWith('https') ? https : http;
    let bytes = 0;
    let idleTimer = null;
    let maxTimer = null;
    const fail = (err) => {
      clearTimeout(idleTimer);
      clearTimeout(maxTimer);
      file.destroy();
      try { rmSync(dest, { force: true }); } catch (_) { /* ignore */ }
      reject(err);
    };
    const bumpIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        req.destroy(new Error(`sin datos por ${idleMs / 1000}s`));
      }, idleMs);
    };
    const req = lib.get(url, { headers: { 'User-Agent': 'resto-fadey-prepare-efact' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        clearTimeout(idleTimer);
        clearTimeout(maxTimer);
        file.close();
        try { rmSync(dest, { force: true }); } catch (_) { /* ignore */ }
        download(res.headers.location, dest, { idleMs, maxMs }).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        fail(new Error(`HTTP ${res.statusCode} al descargar ${url}`));
        res.resume();
        return;
      }
      const total = Number(res.headers['content-length'] || 0);
      bumpIdle();
      res.on('data', (chunk) => {
        bytes += chunk.length;
        bumpIdle();
        if (total > 0 && bytes % (1024 * 1024) < chunk.length) {
          console.log(`[efact-runtime] ${Math.round((bytes / total) * 100)}% (${Math.round(bytes / 1024)} KB)`);
        }
      });
      res.pipe(file);
      file.on('finish', () => {
        clearTimeout(idleTimer);
        clearTimeout(maxTimer);
        file.close(() => resolve());
      });
      res.on('error', fail);
    });
    maxTimer = setTimeout(() => req.destroy(new Error(`tiempo máximo ${maxMs / 1000}s`)), maxMs);
    req.on('error', fail);
    bumpIdle();
  });
}

function downloadWithCurl(url, dest) {
  const curl = process.platform === 'win32' ? 'curl.exe' : 'curl';
  const r = spawnSync(
    curl,
    ['-L', '--fail', '--retry', '2', '--connect-timeout', '20', '--max-time', '180', '-o', dest, url],
    { stdio: 'inherit' },
  );
  if (r.status !== 0) throw new Error(`curl no pudo descargar ${url}`);
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

  const zipOk = existsSync(zipPath) && statSync(zipPath).size >= MIN_PY_ZIP_BYTES;
  if (zipOk) {
    console.log('[efact-runtime] ZIP de Python ya descargado, se reutiliza');
  } else {
    if (existsSync(zipPath)) rmSync(zipPath, { force: true });
    console.log('[efact-runtime] descargando Python embed', PY_VER);
    try {
      downloadWithCurl(PY_URL, zipPath);
    } catch (curlErr) {
      console.warn('[efact-runtime] curl falló, reintento con Node:', curlErr.message || curlErr);
      await download(PY_URL, zipPath);
    }
    if (!existsSync(zipPath) || statSync(zipPath).size < MIN_PY_ZIP_BYTES) {
      throw new Error('La descarga de Python quedó incompleta. Revise la conexión y vuelva a ejecutar.');
    }
  }
  console.log('[efact-runtime] descargando get-pip.py');
  try {
    downloadWithCurl(GET_PIP_URL, getPipPath);
  } catch (curlErr) {
    console.warn('[efact-runtime] curl falló en get-pip, reintento con Node:', curlErr.message || curlErr);
    await download(GET_PIP_URL, getPipPath);
  }

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
