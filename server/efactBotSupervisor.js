/**
 * Arranca el bot Python e-fact (api_server.py) junto con el API Node.
 * En el asistente empaquetado usa Python embebido (resources/efact-runtime)
 * y el código del bot (resources/efact) — misma instalación que impresión.
 *
 * EFACT_BOT_AUTOSTART=0  — desactiva
 * EFACT_API_URL / EFACT_HTTP_PORT — URL/puerto (default http://127.0.0.1:8765)
 * EFACT_PYTHON / EFACT_DIR / EFACT_RESOURCES_DIR — rutas empaquetadas
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

let child = null;
let starting = false;
let stoppedIntentionally = false;
let healthTimer = null;
let restartTimer = null;
let lastSpawnErrorLogAt = 0;

function autostartEnabled() {
  const raw = String(process.env.EFACT_BOT_AUTOSTART || '1').trim().toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'off' && raw !== 'no';
}

function resolveResourcesRoot() {
  if (process.env.EFACT_RESOURCES_DIR) return String(process.env.EFACT_RESOURCES_DIR).trim();
  if (process.resourcesPath) return process.resourcesPath;
  return '';
}

function resolveEfactDir() {
  const fromEnv = String(process.env.EFACT_DIR || '').trim();
  if (fromEnv && fs.existsSync(path.join(fromEnv, 'api_server.py'))) return fromEnv;

  const res = resolveResourcesRoot();
  if (res) {
    const bundled = path.join(res, 'efact');
    if (fs.existsSync(path.join(bundled, 'api_server.py'))) return bundled;
  }

  const local = path.join(__dirname, 'efact');
  if (fs.existsSync(path.join(local, 'api_server.py'))) return local;
  return local;
}

function resolveBundledPythonExe() {
  const fromEnv = String(process.env.EFACT_PYTHON || '').trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  const res = resolveResourcesRoot();
  if (res) {
    const p = path.join(res, 'efact-runtime', 'python.exe');
    if (fs.existsSync(p)) return p;
  }

  const dev = path.join(__dirname, '..', 'build', 'efact-runtime', 'python.exe');
  if (fs.existsSync(dev)) return dev;
  return '';
}

function resolveBotBaseUrl() {
  const fromEnv = String(process.env.EFACT_API_URL || process.env.INTERNAL_EFACT_API_URL || '').trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  const port = String(process.env.EFACT_HTTP_PORT || '8765').trim() || '8765';
  const host = String(process.env.EFACT_HTTP_HOST || '127.0.0.1').trim() || '127.0.0.1';
  return `http://${host}:${port}`;
}

function probeHealth(baseUrl, timeoutMs = 1500) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    try {
      const url = new URL('/health', `${baseUrl}/`);
      const req = http.get(url, { timeout: timeoutMs }, (res) => {
        res.resume();
        done(res.statusCode >= 200 && res.statusCode < 300);
      });
      req.on('error', () => done(false));
      req.on('timeout', () => {
        req.destroy();
        done(false);
      });
    } catch (_) {
      done(false);
    }
  });
}

function findPythonCandidates() {
  const list = [];
  const bundled = resolveBundledPythonExe();
  if (bundled) list.push(bundled);
  if (process.env.EFACT_PYTHON) list.push(String(process.env.EFACT_PYTHON).trim());
  if (process.platform === 'win32') {
    list.push('py');
    list.push('python');
    list.push('python3');
  } else {
    list.push('python3');
    list.push('python');
  }
  return [...new Set(list.filter(Boolean))];
}

function trySpawnWith(cmd, args, env, cwd) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok, proc, err) => {
      if (settled) return;
      settled = true;
      resolve({ ok, proc, err });
    };
    let proc;
    try {
      proc = spawn(cmd, args, {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
      });
    } catch (err) {
      finish(false, null, err);
      return;
    }
    const earlyFail = (err) => finish(false, null, err);
    proc.once('error', earlyFail);
    setTimeout(() => {
      proc.removeListener('error', earlyFail);
      if (proc.exitCode != null || proc.killed) {
        finish(false, null, new Error(`Python salió de inmediato (código ${proc.exitCode})`));
        return;
      }
      finish(true, proc, null);
    }, 400);
  });
}

async function spawnBotProcess(baseUrl) {
  const efactDir = resolveEfactDir();
  const apiScript = path.join(efactDir, 'api_server.py');
  if (!fs.existsSync(apiScript)) {
    console.warn('[efact-bot] No se encontró api_server.py en', apiScript);
    return false;
  }

  let port = '8765';
  let host = '127.0.0.1';
  try {
    const u = new URL(baseUrl);
    if (u.port) port = u.port;
    if (u.hostname) host = u.hostname;
  } catch (_) { /* default */ }

  const env = {
    ...process.env,
    EFACT_HTTP_HOST: host,
    EFACT_HTTP_PORT: String(port),
    EFACT_API_URL: baseUrl,
    EFACT_DIR: efactDir,
    PYTHONUTF8: '1',
  };

  const candidates = findPythonCandidates();
  for (const cmd of candidates) {
    const isPath = /[\\/]/.test(cmd) || /\.exe$/i.test(cmd);
    const args = !isPath && cmd === 'py' ? ['-3', apiScript] : [apiScript];
    const { ok, proc, err } = await trySpawnWith(cmd, args, env, efactDir);
    if (!ok || !proc) {
      const now = Date.now();
      if (now - lastSpawnErrorLogAt > 60_000) {
        lastSpawnErrorLogAt = now;
        console.warn(`[efact-bot] no se pudo iniciar con «${cmd}»:`, err?.message || err || 'fallo');
      }
      continue;
    }

    child = proc;
    child.stdout?.on('data', (d) => {
      const t = String(d || '').trimEnd();
      if (t) console.info('[efact-bot]', t.slice(-400));
    });
    child.stderr?.on('data', (d) => {
      const t = String(d || '').trimEnd();
      if (t) console.warn('[efact-bot]', t.slice(-500));
    });
    child.on('exit', (code, signal) => {
      console.warn(`[efact-bot] proceso terminado (code=${code}, signal=${signal || ''})`);
      child = null;
      if (!stoppedIntentionally && autostartEnabled()) {
        clearTimeout(restartTimer);
        restartTimer = setTimeout(() => {
          void ensureEfactBotRunning();
        }, 4000);
      }
    });
    console.info(`[efact-bot] iniciado con «${cmd}» → ${baseUrl} (cwd=${efactDir})`);
    return true;
  }

  console.warn(
    '[efact-bot] No hay Python embebido ni del sistema. Genere el runtime con: npm run prepare:efact-runtime',
  );
  return false;
}

async function ensureEfactBotRunning() {
  if (!autostartEnabled()) return { ok: false, skipped: true, reason: 'autostart_off' };
  if (starting) return { ok: false, skipped: true, reason: 'starting' };

  const baseUrl = resolveBotBaseUrl();
  if (await probeHealth(baseUrl)) {
    return { ok: true, already: true, url: baseUrl };
  }

  if (child && child.exitCode == null && !child.killed) {
    await new Promise((r) => setTimeout(r, 800));
    if (await probeHealth(baseUrl)) return { ok: true, already: true, url: baseUrl };
  }

  starting = true;
  stoppedIntentionally = false;
  try {
    const spawned = await spawnBotProcess(baseUrl);
    if (!spawned) return { ok: false, url: baseUrl, reason: 'spawn_failed' };

    for (let i = 0; i < 15; i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      if (await probeHealth(baseUrl)) {
        console.info(`[efact-bot] health OK en ${baseUrl}`);
        return { ok: true, url: baseUrl };
      }
    }
    console.warn(`[efact-bot] proceso lanzado pero /health no responde en ${baseUrl}`);
    return { ok: false, url: baseUrl, reason: 'health_timeout' };
  } finally {
    starting = false;
  }
}

function startEfactBotSupervisor() {
  if (!autostartEnabled()) {
    console.info('[efact-bot] autostart desactivado (EFACT_BOT_AUTOSTART=0)');
    return;
  }
  const apiScript = path.join(resolveEfactDir(), 'api_server.py');
  if (!fs.existsSync(apiScript)) {
    console.warn('[efact-bot] supervisor omitido: falta', apiScript);
    return;
  }

  const bundled = resolveBundledPythonExe();
  if (bundled) console.info('[efact-bot] Python embebido del asistente:', bundled);
  else console.info('[efact-bot] sin runtime embebido; se intentará Python del sistema');

  void ensureEfactBotRunning();

  clearInterval(healthTimer);
  healthTimer = setInterval(() => {
    void ensureEfactBotRunning();
  }, 45_000);
  if (typeof healthTimer.unref === 'function') healthTimer.unref();

  const stop = () => stopEfactBot();
  process.once('exit', stop);
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

function stopEfactBot() {
  stoppedIntentionally = true;
  clearInterval(healthTimer);
  healthTimer = null;
  clearTimeout(restartTimer);
  restartTimer = null;
  if (child && !child.killed) {
    try {
      child.kill();
    } catch (_) { /* ignore */ }
  }
  child = null;
}

module.exports = {
  startEfactBotSupervisor,
  ensureEfactBotRunning,
  stopEfactBot,
  resolveBotBaseUrl,
  resolveEfactDir,
  resolveBundledPythonExe,
  probeHealth,
};
