/**
 * Origen del API:
 * - En cada despliegue: VITE_API_URL (Vercel / .env). Sin URLs de clientes en el código.
 * - En desarrollo (npm run dev) sin variable: `/api` → proxy de Vite al backend local (p. ej. :3001).
 * - En producción sin variable: `/api` (mismo origen). El front mostrará error hasta definir VITE_API_URL.
 *
 * Impresión USB (Node + módulo `printer` en Windows):
 * - Debe apuntar al backend local. Use `VITE_LOCAL_PRINTING_API` (build) o en runtime:
 *   `localStorage.setItem('resto_local_printing_api', 'http://127.0.0.1:3001')`
 *   (sin `/api` al final; se añade automáticamente).
 * - Las llamadas bajo `api.printing.*` usan esa base; el resto del sistema sigue usando API_BASE.
 */
import { translateApiErrorMessage } from '../i18n/translateApiError';

const rawApi = import.meta.env.VITE_API_URL;
const hasExplicitApi = rawApi !== undefined && rawApi !== null && String(rawApi).trim() !== '';

function normalizeApiOrigin(url) {
  let o = String(url || '').trim().replace(/\/$/, '');
  if (/\/api\/?$/i.test(o)) o = o.replace(/\/api\/?$/i, '');
  return o;
}

let API_ORIGIN = '';
if (hasExplicitApi) {
  API_ORIGIN = normalizeApiOrigin(String(rawApi).trim());
}

/** Origen del API sin `/api`. Solo VITE_API_URL (o localStorage); nunca un host fijo. */
export function getConfiguredApiOrigin() {
  if (hasExplicitApi && API_ORIGIN) return API_ORIGIN;
  return '';
}

/** URL efectiva del API (`/api` incluido), con override opcional en localStorage. */
export function getApiBase() {
  let origin = getConfiguredApiOrigin();
  if (typeof window !== 'undefined') {
    const ls = String(window.localStorage?.getItem('resto_api_url') || '').trim();
    if (ls) origin = normalizeApiOrigin(ls);
  }
  return origin ? `${origin}/api` : '/api';
}

export const API_BASE = getApiBase();

/** URL del backend sin `/api` (para mostrar en diagnóstico o sockets). */
export function getApiOrigin() {
  if (typeof window !== 'undefined') {
    const ls = String(window.localStorage?.getItem('resto_api_url') || '').trim();
    if (ls) return normalizeApiOrigin(ls);
  }
  const configured = getConfiguredApiOrigin();
  if (configured) return configured;
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}

function isLocalHostName(host) {
  const h = String(host || '').toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
}

/** Resto FADEY instalado: front en http://127.0.0.1:PUERTO (API embebida en la PC). */
export function isDesktopEmbeddedRuntime() {
  if (typeof window === 'undefined') return false;
  const configured = getConfiguredApiOrigin();
  if (!configured) return false;
  try {
    const cfg = new URL(configured);
    if (!isLocalHostName(cfg.hostname)) return false;
  } catch (_) {
    return false;
  }
  try {
    const loc = window.location;
    if (isLocalHostName(loc.hostname)) return true;
    if (loc.origin === configured) return true;
  } catch (_) {
    /* noop */
  }
  return false;
}

export function usesInstalledLocalPrinting() {
  return hasElectronPrinting() || isDesktopEmbeddedRuntime();
}

function assertBackupApiReachable() {
  if (typeof window === 'undefined') return;
  const base = getApiBase();
  const origin = getApiOrigin();
  if (base.startsWith('/') || origin === window.location.origin) {
    throw new Error(
      'El respaldo se estaba enviando al frontend (405). En Vercel → Environment → VITE_API_URL ponga la URL pública de ESTE Web Service de Render (sin /api) y haga Redeploy.',
    );
  }
  if (/\.vercel\.app$/i.test(origin)) {
    throw new Error(
      'VITE_API_URL apunta al frontend (Vercel), no al API. Use la URL del Web Service de Render de este cliente, no la de .vercel.app.',
    );
  }
}

/** Base `/api` del servidor Node local para rutas `/printing/*` (detección USB, impresión RAW). */
export function getPrintingApiBase() {
  if (isDesktopEmbeddedRuntime()) {
    return getApiBase();
  }
  if (typeof window !== 'undefined') {
    const injected = window.__RESTO_PRINTING_API__ || window.__RESTO_LOCAL_PRINTING_API__;
    if (injected && String(injected).trim()) {
      const o = normalizeApiOrigin(injected);
      if (o) {
        console.info('[printing] Bridge URL (inyectada):', `${o}/api`);
        return `${o}/api`;
      }
    }
    const ls = window.localStorage?.getItem('resto_local_printing_api');
    if (ls && String(ls).trim()) {
      const o = normalizeApiOrigin(ls);
      if (o) {
        console.info('[printing] Bridge URL (localStorage):', `${o}/api`);
        return `${o}/api`;
      }
    }
  }
  const envLocal = import.meta.env.VITE_LOCAL_PRINTING_API;
  if (envLocal !== undefined && envLocal !== null && String(envLocal).trim() !== '') {
    const o = normalizeApiOrigin(envLocal);
    if (o) {
      console.info('[printing] Bridge URL (VITE_LOCAL_PRINTING_API):', `${o}/api`);
      return `${o}/api`;
    }
  }
  if (typeof window !== 'undefined' && import.meta.env.PROD) {
    if (/onrender\.com|vercel\.app/i.test(API_BASE)) {
      const port = String(import.meta.env.VITE_LOCAL_PRINTING_PORT || '3001').trim() || '3001';
      const o = normalizeApiOrigin(`http://127.0.0.1:${port}`);
      console.info(
        '[printing] API principal remota: usando bridge Node local por defecto (ajuste localStorage.resto_local_printing_api si el puerto no es',
        `${port}):`,
        `${o}/api`,
      );
      return `${o}/api`;
    }
  }
  return API_BASE;
}

export function isElectronRuntime() {
  return Boolean(
    typeof window !== 'undefined'
    && (
      window.__ELECTRON__
      || /Electron/i.test(window.navigator?.userAgent || '')
      || Boolean(window?.process?.versions?.electron)
    )
  );
}

export function hasElectronPrinting() {
  return Boolean(
    isElectronRuntime()
    && window.electronPrinting
    && typeof window.electronPrinting.getPrinters === 'function'
  );
}

export const electronPrinting = {
  getConfig: async () => {
    if (!hasElectronPrinting()) throw new Error('Electron printing no disponible');
    return window.electronPrinting.getConfig();
  },
  saveConfig: async (cfg) => {
    if (!hasElectronPrinting()) throw new Error('Electron printing no disponible');
    return window.electronPrinting.saveConfig(cfg);
  },
  getPrinters: async (moduleKey = '') => {
    if (!hasElectronPrinting()) throw new Error('Electron printing no disponible');
    return window.electronPrinting.getPrinters(moduleKey);
  },
  health: async () => {
    if (!hasElectronPrinting()) throw new Error('Electron printing no disponible');
    return window.electronPrinting.health();
  },
  getBridgeOrigin: async () => {
    if (!hasElectronPrinting()) throw new Error('Electron printing no disponible');
    if (typeof window.electronPrinting.getBridgeOrigin !== 'function') {
      return { ok: false, origin: '', port: null };
    }
    return window.electronPrinting.getBridgeOrigin();
  },
  getStatus: async (moduleKey) => {
    if (!hasElectronPrinting()) throw new Error('Electron printing no disponible');
    return window.electronPrinting.getStatus(moduleKey);
  },
  printTest: async (moduleKey) => {
    if (!hasElectronPrinting()) throw new Error('Electron printing no disponible');
    return window.electronPrinting.printTest(moduleKey);
  },
  printModule: async (moduleKey, payload = {}) => {
    if (!hasElectronPrinting()) throw new Error('Electron printing no disponible');
    return window.electronPrinting.printModule(moduleKey, payload);
  },
};

/**
 * Origen del servidor para archivos estáticos (`/uploads/...`), sin el sufijo `/api`.
 * Si VITE_API_URL es `https://host/api`, las imágenes deben ir a `https://host/uploads/...`
 * (no a `https://host/api/uploads/...`).
 */
export function getStaticFilesOrigin() {
  if (!API_ORIGIN) return '';
  return String(API_ORIGIN).replace(/\/api\/?$/i, '');
}

/** URL absoluta para `/uploads/...` cuando el front y la API están en hosts distintos. */
export function resolveMediaUrl(url) {
  if (!url) return '';
  let s = String(url).trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('/api/uploads/')) {
    s = `/uploads/${s.slice('/api/uploads/'.length)}`;
  }
  if (s.startsWith('/uploads/')) {
    const origin = getStaticFilesOrigin();
    if (origin) return `${origin}${s}`;
    return s;
  }
  if (s.startsWith('/cartas/')) {
    const origin = getStaticFilesOrigin() || (typeof window !== 'undefined' ? window.location.origin : '');
    if (origin) return `${origin}${s}`;
    return s;
  }
  return s;
}

/** Mismo host que el backend (sin ruta `/api`), para Socket.IO y estáticos. */
export function getSocketOrigin() {
  const o = getStaticFilesOrigin();
  if (o) return o;
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}

async function request(endpoint, options = {}) {
  const token = localStorage.getItem('token');
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const url = `${getApiBase()}${endpoint}`;
  let res;
  try {
    res = await fetch(url, { ...options, headers });
  } catch (err) {
    const msg = String(err?.message || err || '');
    if (/failed to fetch|networkerror|load failed|network/i.test(msg)) {
      const origin = getApiOrigin() || url;
      const frontOrigin = typeof window !== 'undefined' ? window.location.origin : 'su dominio Vercel';
      throw new Error(
        `No se pudo conectar al API (${origin}). ` +
          `Vercel → VITE_API_URL = URL de ESTE Web Service de Render (sin /api) y Redeploy. ` +
          `Render → CORS_ORIGIN debe incluir ${frontOrigin}.`,
      );
    }
    throw err;
  }
  const refreshedToken = res.headers.get('X-Refreshed-Token');
  if (refreshedToken && typeof window !== 'undefined') {
    try {
      window.localStorage.setItem('token', refreshedToken);
    } catch (_) {
      /* noop */
    }
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = null;
  }

  if (!res.ok) {
    if (
      res.status === 401
      && data?.code === 'SESSION_IDLE_TIMEOUT'
      && typeof window !== 'undefined'
    ) {
      try {
        window.localStorage.removeItem('token');
      } catch (_) {
        /* noop */
      }
      if (window.location.pathname !== '/') {
        window.location.href = '/';
      }
    }
    const message = translateApiErrorMessage(res, data, endpoint);
    if (import.meta.env.DEV) {
      console.warn('[api]', options.method || 'GET', endpoint, res.status, data || text?.slice(0, 200));
    }
    const err = new Error(message);
    err.status = res.status;
    if (data?.error != null) err.apiError = String(data.error);
    if (data?.code) err.code = data.code;
    if (data?.target_table) err.targetTable = data.target_table;
    throw err;
  }

  return data;
}

function printingUnreachableMessage() {
  if (isElectronRuntime() || isDesktopEmbeddedRuntime()) {
    return 'Abra la aplicación Resto FADEY en esta PC (ícono junto al reloj). Si ya está abierta, clic derecho → «Reintentar servicio de impresión».';
  }
  return 'No se encontró el programa de impresión Resto FADEY en esta computadora. Instálelo, manténgalo abierto junto al reloj y pulse «Verificar vínculo».';
}

/** Puertos del asistente Electron (3001 + alternativas). Ampliable por build sin tocar código. */
function parseAssistantPortsFromEnv() {
  const raw = String(import.meta.env.VITE_PRINTING_ASSISTANT_PORTS || '').trim();
  if (raw) {
    const parts = raw
      .split(/[\s,;]+/)
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isFinite(n) && n > 0 && n <= 65535);
    if (parts.length) return [...new Set(parts)].sort((a, b) => a - b);
  }
  const countRaw = Number(import.meta.env.VITE_PRINTING_ASSISTANT_PORT_COUNT);
  const count = Number.isFinite(countRaw) && countRaw > 0
    ? Math.min(40, Math.max(5, Math.floor(countRaw)))
    : 25;
  return Array.from({ length: count }, (_, i) => 3001 + i);
}

const ASSISTANT_STANDARD_PORTS = parseAssistantPortsFromEnv();

/** Hosts locales a probar (mismo asistente; útil si el navegador resuelve distinto). */
const ASSISTANT_LOCAL_HOSTS = (() => {
  const set = new Set(['127.0.0.1', 'localhost']);
  const extra = String(import.meta.env.VITE_PRINTING_ASSISTANT_HOSTS || '').trim();
  if (extra) {
    extra.split(/[\s,;]+/).forEach((h) => {
      const t = h.trim();
      if (t) set.add(t);
    });
  }
  return [...set];
})();

/** Origen guardado por el usuario o por descubrimiento automático (sin `/api`). */
export function getPersistedPrintingBridgeOrigin() {
  if (typeof window === 'undefined') return '';
  try {
    const ls = window.localStorage?.getItem('resto_local_printing_api');
    const o = normalizeApiOrigin(ls || '');
    return o || '';
  } catch (_) {
    return '';
  }
}

async function fetchPrintingHealthDetail(url, timeoutMs = 3200) {
  try {
    const opts = {
      method: 'GET',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      mode: 'cors',
    };
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      opts.signal = AbortSignal.timeout(timeoutMs);
    }
    const res = await fetch(url, opts);
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = null;
    }
    const ok = Boolean(res.ok && data && String(data.status || '').toLowerCase() === 'ok');
    const assistant = ok && String(data?.mode || '').toLowerCase() === 'assistant';
    return { ok, assistant };
  } catch (_) {
    return { ok: false, assistant: false };
  }
}

async function probeOriginHealth(originBase, timeoutMs) {
  const base = String(originBase || '').trim().replace(/\/$/, '');
  if (!base) return { ok: false, assistant: false, origin: '' };
  let r = await fetchPrintingHealthDetail(`${base}/api/health`, timeoutMs);
  if (r.ok) return { ...r, origin: base };
  r = await fetchPrintingHealthDetail(`${base}/health`, timeoutMs);
  return { ...r, origin: base };
}

/**
 * Escanea localhost en varios hosts/puertos y guarda `resto_local_printing_api` para **este** origen (cada
 * dominio Vercel tiene su propio localStorage; el mismo .exe del asistente sirve para todos los clientes).
 * Solo acepta respuestas con `mode: 'assistant'` para no confundir con otro Node en el mismo puerto.
 */
async function discoverAssistantAndPersist() {
  const timeoutMs = 2400;
  const tasks = [];
  for (const host of ASSISTANT_LOCAL_HOSTS) {
    for (const port of ASSISTANT_STANDARD_PORTS) {
      const origin = `http://${host}:${port}`;
      tasks.push(
        probeOriginHealth(origin, timeoutMs).then((row) => ({
          port,
          host,
          origin: row.origin || origin,
          ok: row.ok,
          assistant: row.assistant,
        })),
      );
    }
  }
  const rows = await Promise.all(tasks);
  const assistants = rows.filter((r) => r.ok && r.assistant);
  if (!assistants.length) return false;

  assistants.sort((a, b) => {
    if (a.port !== b.port) return a.port - b.port;
    const rank = (h) => (h === '127.0.0.1' ? 0 : 1);
    return rank(a.host) - rank(b.host);
  });
  const pick = assistants[0];
  try {
    window.localStorage?.setItem('resto_local_printing_api', pick.origin);
  } catch (_) {
    /* noop */
  }
  console.info('[printing] Asistente Electron detectado en', pick.origin, '(repo/dominio independiente)');
  return true;
}

/**
 * Ejecuta el descubrimiento del asistente local (mismo instalador para cualquier cliente / URL).
 * No lanza error; útil tras login o si el asistente tardó en abrir.
 */
export async function ensureLocalPrintingAssistantDiscovered() {
  if (typeof window === 'undefined') return false;
  if (hasElectronPrinting() || isDesktopEmbeddedRuntime()) return true;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (await discoverAssistantAndPersist()) return true;
    await new Promise((r) => setTimeout(r, 700 + attempt * 350));
  }
  return false;
}

/** Origen del bridge sin sufijo `/api` (ej. `http://127.0.0.1:3001`). */
function getPrintingBridgeOriginOnly() {
  const apiBase = String(getPrintingApiBase() || '').trim().replace(/\/$/, '');
  const stripped = apiBase.replace(/\/api\/?$/i, '');
  return stripped || apiBase;
}

export async function checkPrintingHealth() {
  if (isDesktopEmbeddedRuntime()) {
    const origin = getApiOrigin();
    if (!origin) throw new Error('API local no configurada');
    try {
      const opts = {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        mode: 'cors',
      };
      if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
        opts.signal = AbortSignal.timeout(5000);
      }
      const res = await fetch(`${origin}/api/healthz`, opts);
      if (res.ok) return true;
    } catch (_) {
      /* noop */
    }
    throw new Error(printingUnreachableMessage());
  }

  const persisted = getPersistedPrintingBridgeOrigin();
  if (persisted) {
    const probe = await probeOriginHealth(persisted, 4500);
    if (probe.ok) return true;
  }

  /** Si el asistente Electron quedó en otro puerto (3002…), lo encontramos sin depender de localStorage. */
  if (await discoverAssistantAndPersist()) {
    return true;
  }

  const apiBase = String(getPrintingApiBase() || '').trim().replace(/\/$/, '');
  const origin = getPrintingBridgeOriginOnly();
  const urls = [...new Set([`${apiBase}/health`, `${origin}/health`].filter(Boolean))];

  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const url of urls) {
      try {
        const opts = {
          method: 'GET',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          mode: 'cors',
        };
        if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
          opts.signal = AbortSignal.timeout(8000);
        }
        const res = await fetch(url, opts);
        const text = await res.text();
        let data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch (_) {
          data = null;
        }
        if (res.ok && data && String(data.status || '').toLowerCase() === 'ok') {
          return true;
        }
      } catch (err) {
        lastErr = err;
      }
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 400));
  }

  console.warn('[printing] health falló tras reintentos y descubrimiento:', lastErr?.message || lastErr, urls);
  throw new Error(printingUnreachableMessage());
}

async function printingRequest(endpoint, options = {}) {
  const token = localStorage.getItem('token');
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const base = getPrintingApiBase();
  let res;
  try {
    res = await fetch(`${base}${endpoint}`, { ...options, headers });
  } catch (err) {
    const msg = err && err.message ? String(err.message) : 'fetch';
    console.warn('[printing] fetch falló hacia', base, msg);
    if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) {
      throw new Error(printingUnreachableMessage());
    }
    throw new Error(printingUnreachableMessage());
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = null;
  }
  if (!res.ok) {
    if (data?.error) throw new Error(data.error);
    if (res.status === 404) {
      throw new Error(
        'No responde el programa de impresión en esta PC. Instale Resto FADEY, déjelo abierto junto al reloj y pulse «Verificar vínculo».',
      );
    }
    throw new Error(
      data?.message || `Error ${res.status}: el servidor de impresión no devolvió JSON válido`
    );
  }
  return data;
}

/** Lista desde GET /api/printing/printers o GET /api/printers (array o legado { printers }). */
export function normalizeUsbPrinterList(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.printers)) return data.printers;
  return [];
}

export { printingUnreachableMessage };

export const api = {
  /** `options` se fusiona con fetch (p. ej. `{ cache: 'no-store' }`). */
  get: (endpoint, options = {}) => request(endpoint, { method: 'GET', cache: 'no-store', ...options }),
  post: (endpoint, body) => request(endpoint, { method: 'POST', body: JSON.stringify(body) }),
  put: (endpoint, body) => request(endpoint, { method: 'PUT', body: JSON.stringify(body) }),
  patch: (endpoint, body) => request(endpoint, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (endpoint, body) =>
    request(endpoint, {
      method: 'DELETE',
      ...(body != null ? { body: JSON.stringify(body) } : {}),
    }),
  /** Mismo token que el API principal; base URL puede ser el Node local (USB / RAW). */
  printing: {
    get: (endpoint, options = {}) => printingRequest(endpoint, { method: 'GET', cache: 'no-store', ...options }),
    post: (endpoint, body = {}) => printingRequest(endpoint, { method: 'POST', body: JSON.stringify(body) }),
    put: (endpoint, body) => printingRequest(endpoint, { method: 'PUT', body: JSON.stringify(body) }),
  },
  upload: async (file) => {
    const token = localStorage.getItem('token');
    const formData = new FormData();
    formData.append('image', file);
    const res = await fetch(`${getApiBase()}/upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'No se pudo subir el archivo');
    return data;
  },
  /** Respaldo SQLite (solo master_admin en servidor). */
  restoreBackup: async (file) => {
    assertBackupApiReachable();
    const token = localStorage.getItem('token');
    if (!token) throw new Error('Debe iniciar sesión como administrador maestro');
    const formData = new FormData();
    formData.append('backup', file);
    let res;
    try {
      res = await fetch(`${getApiBase()}/restaurant/restore`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
    } catch (err) {
      const msg = String(err?.message || err || '');
      if (/failed to fetch|network/i.test(msg)) {
        throw new Error(
          `No se pudo conectar al API (${getApiOrigin() || API_BASE}). Revise VITE_API_URL en Vercel, CORS_ORIGIN en Render y que el servicio Node esté en verde.`,
        );
      }
      throw err;
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      if (/text\/html/i.test(String(res.headers.get('content-type') || '')) || text.trimStart().startsWith('<!')) {
        throw new Error('El servidor devolvió HTML. VITE_API_URL en Vercel debe apuntar a su API en Render (sin /api).');
      }
    }
    if (!res.ok) {
      const serverMsg = data?.error ? String(data.error).trim() : '';
      const extra = data?.db_path ? ` (${data.db_path})` : '';
      throw new Error(
        serverMsg
        || (text && text.length < 300 ? text.trim() : '')
        || translateApiErrorMessage(res, data, '/restaurant/restore')
        || `Error HTTP ${res.status}${extra}`,
      );
    }
    return data;
  },
  downloadBackup: async () => {
    assertBackupApiReachable();
    const token = localStorage.getItem('token');
    if (!token) throw new Error('Debe iniciar sesión como administrador maestro');
    let res;
    try {
      res = await fetch(`${getApiBase()}/restaurant/backup`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      const msg = String(err?.message || err || '');
      if (/failed to fetch|network/i.test(msg)) {
        throw new Error(
          `No se pudo conectar al API (${getApiOrigin() || API_BASE}). Revise VITE_API_URL en Vercel y que Render esté activo.`,
        );
      }
      throw err;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.error || `No se pudo descargar el backup (${res.status})`);
    }
    const contentType = String(res.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/html')) {
      throw new Error('El servidor devolvió HTML en lugar del .db. Revise VITE_API_URL en Vercel.');
    }
    const blob = await res.blob();
    const head = await blob.slice(0, 16).text();
    if (!head.startsWith('SQLite format')) {
      throw new Error('La respuesta no es un archivo SQLite válido. Revise VITE_API_URL en Vercel.');
    }
    const disposition = res.headers.get('content-disposition') || '';
    const match = disposition.match(/filename="?([^"]+)"?/i);
    const filename = match?.[1] || `restaurant_backup_${new Date().toISOString().slice(0, 10)}.db`;
    return { blob, filename };
  },
  /** Certificado SUNAT .pfx / .p12 → `uploads/billing-certs/` en el servidor Node. */
  uploadBillingCert: async (file) => {
    const token = localStorage.getItem('token');
    const formData = new FormData();
    formData.append('cert', file);
    const res = await fetch(`${getApiBase()}/upload/billing-cert`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || 'No se pudo subir el certificado');
    return data;
  },
};

/** Zona horaria del negocio para mostrar fechas del API (SQLite guarda UTC naive en la nube). */
export const APP_DISPLAY_TIMEZONE = 'America/Lima';

export const parseApiDate = (value) => {
  if (!value) return null;
  const safe = String(value).replace(' ', 'T');
  const withZone = /Z$|[+-]\d{2}:\d{2}$/.test(safe) ? safe : `${safe}Z`;
  const d = new Date(withZone);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Fecha/hora sin zona (típico SQLite) → hora local del navegador.
 * Evita desfasar el día al forzar "Z" como parseApiDate en timestamps locales.
 */
export function parseLocalNaiveDateTime(value) {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(normalized)) {
    const d = new Date(normalized);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Apertura de caja: timestamps naive del API se interpretan como UTC (SQLite en nube). */
export function parseCashRegisterOpenedAt(value) {
  return parseApiDate(value);
}

/** Fecha local dd/mm/aaaa en zona del negocio. */
function formatPeDateDdMmYyyy(d) {
  const parts = new Intl.DateTimeFormat('es-PE', {
    timeZone: APP_DISPLAY_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(d);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.day}/${map.month}/${map.year}`;
}

/** Hora 12 h en zona del negocio (ej. 3:29 p.m.). */
function formatPeTime12hNoSeconds(d) {
  const parts = new Intl.DateTimeFormat('es-PE', {
    timeZone: APP_DISPLAY_TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(d);
  const map = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  let h12 = Number(map.hour) || 12;
  if (h12 > 12) h12 = h12 % 12 || 12;
  if (h12 === 0) h12 = 12;
  const mm = String(map.minute || '0').padStart(2, '0');
  const suffix = String(map.dayPeriod || '').toLowerCase().includes('p') ? 'p.m.' : 'a.m.';
  return `${h12}:${mm} ${suffix}`;
}

function peDateTimePartsFromDate(d) {
  return {
    date: formatPeDateDdMmYyyy(d),
    time: formatPeTime12hNoSeconds(d),
  };
}

/** Fecha (dd/mm/aaaa) y hora solo h:mm (12 h, sin segundos) para arqueo / impresión. */
export function formatPeDateTimeParts(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return { date: '—', time: '—' };
    return peDateTimePartsFromDate(value);
  }
  const d = parseCashRegisterOpenedAt(value);
  if (!d) return { date: '—', time: '—' };
  return peDateTimePartsFromDate(d);
}

/** Una sola cadena: `dd/mm/aaaa h:mm a.m.|p.m.` */
export function formatPeDateTimeLine(value) {
  const { date, time } = formatPeDateTimeParts(value);
  if (date === '—') return '—';
  return `${date} ${time}`;
}

export const toLocalDateKey = (value) => {
  const d = parseApiDate(value);
  if (!d) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_DISPLAY_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
};

/** Rango inclusivo yyyy-MM-dd (desde/hasta incluidos) en zona America/Lima. */
export function isDateKeyInInclusiveRange(value, fromKey, toKey) {
  const dateKey = toLocalDateKey(value);
  if (!dateKey) return false;
  const from = String(fromKey || '').trim();
  const to = String(toKey || '').trim();
  if (from && dateKey < from) return false;
  if (to && dateKey > to) return false;
  return true;
}

export const formatCurrency = (amount, symbol = 'S/') => {
  return `${symbol} ${Number(amount || 0).toFixed(2)}`;
};

const insumoQtyFormatter = new Intl.NumberFormat('es-PE', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 4,
});

/**
 * Convierte texto tipeado (p. ej. 10,5 o 1.234,5) a número. Evita `parseFloat` que con "10,5" devuelve 10.
 */
export function parseLocaleNumber(value) {
  if (value == null || value === '') return NaN;
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  let s = String(value).trim().replace(/\s/g, '');
  if (!s) return NaN;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (lastComma > -1) {
    s = s.replace(',', '.');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

export function formatInsumoQty(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return insumoQtyFormatter.format(v);
}

/** Cantidad en U.M. + unidad (ej. "10 kg", "1,5 L") */
export function formatInsumoWithUnit(qty, unidad) {
  const u = String(unidad || '').trim();
  if (!u) return formatInsumoQty(qty);
  return `${formatInsumoQty(qty)} ${u}`;
}

/** Clave yyyy-MM-dd → dd/mm/aaaa sin desfase por zona horaria. */
export function formatDateKey(dateKey) {
  const ymd = String(dateKey || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return '';
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

export const formatDate = (dateStr) => {
  if (!dateStr) return '';
  const raw = String(dateStr).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return formatDateKey(raw);
  }
  const d = parseApiDate(dateStr);
  if (!d) return '';
  return d.toLocaleDateString('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: APP_DISPLAY_TIMEZONE,
  });
};

export const formatDateTime = (dateStr) => {
  if (!dateStr) return '';
  const d = parseApiDate(dateStr);
  if (!d) return '';
  return d.toLocaleString('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: APP_DISPLAY_TIMEZONE,
  });
};

export const formatTime = (dateStr) => {
  if (!dateStr) return '';
  const d = parseApiDate(dateStr);
  if (!d) return '';
  return d.toLocaleTimeString('es-PE', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: APP_DISPLAY_TIMEZONE,
  });
};

/** ISO instant del servidor → hora local del negocio (p. ej. generated_at). */
export function formatInstantTime(value, opts = {}) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('es-PE', {
    hour: '2-digit',
    minute: '2-digit',
    second: opts.withSeconds ? '2-digit' : undefined,
    timeZone: APP_DISPLAY_TIMEZONE,
  });
}

export const ORDER_STATUS = {
  pending: { label: 'Pendiente', color: 'badge-pending' },
  preparing: { label: 'En Preparación', color: 'badge-preparing' },
  ready: { label: 'Listo', color: 'badge-ready' },
  delivered: { label: 'Entregado', color: 'badge-delivered' },
  cancelled: { label: 'Cancelado', color: 'badge-cancelled' },
};

export const ORDER_TYPES = {
  dine_in: 'Mesa',
  delivery: 'Delivery',
  pickup: 'Para llevar',
};

export const PAYMENT_METHODS = {
  efectivo: 'Efectivo',
  yape: 'Yape',
  plin: 'Plin',
  tarjeta: 'Tarjeta',
  online: 'Online',
  cuenta_cliente: 'Cuenta cliente',
};

/** Al crear pedido delivery: anticipado vs contra entrega (distinto del medio de pago en caja). */
export const DELIVERY_PAYMENT_MODALITY_OPTIONS = [
  { value: 'anticipado', label: 'Anticipado' },
  { value: 'contra_entrega', label: 'Contra entrega' },
];

export function labelDeliveryPaymentModality(raw) {
  const k = String(raw || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_');
  if (k === 'anticipado') return 'Anticipado';
  if (k === 'contra_entrega') return 'Contra entrega';
  return '';
}

const normalizeMethodName = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '');

const mapMethodNameToId = (value) => {
  const normalized = normalizeMethodName(value);
  if (!normalized) return '';
  if (normalized.includes('efect')) return 'efectivo';
  if (normalized.includes('tarjet')) return 'tarjeta';
  if (normalized.includes('yape')) return 'yape';
  if (normalized.includes('plin')) return 'plin';
  if (normalized === 'efectivo' || normalized === 'tarjeta' || normalized === 'yape' || normalized === 'plin') return normalized;
  return '';
};

export const getPaymentMethodOptions = (appConfig, { includeOnline = false } = {}) => {
  const pagos = appConfig?.pagos_sistema || {};
  const formasPago = Array.isArray(appConfig?.formas_pago)
    ? appConfig.formas_pago
    : Array.isArray(appConfig?.settings?.formas_pago)
      ? appConfig.settings.formas_pago
      : [];

  const activeFormas = formasPago.filter((item) => Number(item?.active ?? 1) === 1);
  const seen = new Set();
  const options = [];

  for (const item of activeFormas) {
    const id = mapMethodNameToId(item?.name);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const rawName = String(item?.name || '').trim();
    options.push({ value: id, label: rawName || PAYMENT_METHODS[id] || id });
  }

  const pagosSistemaIds = [
    { value: 'efectivo', enabled: Number(pagos.acepta_efectivo ?? 1) === 1 },
    { value: 'tarjeta', enabled: Number(pagos.acepta_tarjeta ?? 1) === 1 },
    { value: 'yape', enabled: Number(pagos.acepta_yape ?? 1) === 1 },
    { value: 'plin', enabled: Number(pagos.acepta_plin ?? 1) === 1 },
  ];

  for (const { value, enabled } of pagosSistemaIds) {
    if (!enabled || seen.has(value)) continue;
    seen.add(value);
    options.push({ value, label: PAYMENT_METHODS[value] || value });
  }

  if (includeOnline) options.push({ value: 'online', label: PAYMENT_METHODS.online });
  if (options.length === 0) {
    return [
      { value: 'efectivo', label: PAYMENT_METHODS.efectivo },
      { value: 'yape', label: PAYMENT_METHODS.yape },
      { value: 'plin', label: PAYMENT_METHODS.plin },
      { value: 'tarjeta', label: PAYMENT_METHODS.tarjeta },
    ];
  }
  return options;
};

const MULTI_PAY_ORDER = ['efectivo', 'yape', 'plin', 'tarjeta'];

/** Orden estándar para desglose multimétodo en caja (Yape/Plin independientes). */
export const orderMultiPaymentOptions = (options) => {
  const list = Array.isArray(options) ? options : [];
  const byValue = new Map(list.map((o) => [o.value, o]));
  const ordered = MULTI_PAY_ORDER.filter((id) => byValue.has(id)).map((id) => byValue.get(id));
  for (const o of list) {
    if (!MULTI_PAY_ORDER.includes(o.value)) ordered.push(o);
  }
  return ordered.length
    ? ordered
    : MULTI_PAY_ORDER.map((value) => ({ value, label: PAYMENT_METHODS[value] || value }));
};

export const getMultiPaymentMethodOptions = (appConfig) =>
  orderMultiPaymentOptions(getPaymentMethodOptions(appConfig, { includeOnline: false }));
