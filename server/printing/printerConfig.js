const fs = require('fs');
const path = require('path');

const CONFIG_PATH = process.env.PRINTING_CONFIG_PATH
  ? path.resolve(process.env.PRINTING_CONFIG_PATH)
  : path.join(__dirname, 'printer-config.json');

const DEFAULT_CONFIG = {
  caja: { tipo: 'usb', nombre: '', ip: '', puerto: 9100, autoPrint: true, paperWidth: 80, anchoPapel: 80 },
  cocina: { tipo: 'usb', nombre: '', ip: '', puerto: 9100, autoPrint: true, paperWidth: 80, anchoPapel: 80 },
  bar: { tipo: 'usb', nombre: '', ip: '', puerto: 9100, autoPrint: true, paperWidth: 80, anchoPapel: 80 },
};

function isValidIp(value) {
  return /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(String(value || '').trim());
}

function resolveTipo(raw) {
  return String(raw || 'usb').toLowerCase() === 'red' ? 'red' : 'usb';
}

function resolveAnchoPapel(moduleConfig) {
  const fromPaper = moduleConfig?.anchoPapel ?? moduleConfig?.paperWidth;
  const n = Number(fromPaper || 80);
  if (n === 50) return 50;
  if (n === 58) return 58;
  if (n === 75) return 75;
  return 80;
}

function normalizePuerto(moduleConfig) {
  const puerto = Number(moduleConfig?.puerto ?? 9100);
  return Number.isFinite(puerto) && puerto > 0 && puerto <= 65535 ? puerto : 9100;
}

/** Lectura de archivo / respuestas: no exige IP en red vacía (evita romper configs previas). */
function normalizeModuleLenient(moduleConfig, moduleName) {
  const src = moduleConfig && typeof moduleConfig === 'object' ? moduleConfig : {};
  const tipo = resolveTipo(src.tipo);
  return {
    tipo,
    nombre: String(src.nombre || '').trim(),
    ip: tipo === 'usb' ? '' : String(src.ip || '').trim(),
    puerto: normalizePuerto(src),
    autoPrint: moduleName === 'caja' ? true : Boolean(src.autoPrint ?? true),
    anchoPapel: resolveAnchoPapel(src),
    paperWidth: resolveAnchoPapel(src),
  };
}

/** Guardado: red exige IP/puerto válidos; en USB se permite nombre vacío para guardar ancho/config general. */
function normalizeModuleStrict(moduleConfig, moduleName) {
  const base = normalizeModuleLenient(moduleConfig, moduleName);
  if (base.tipo === 'usb') {
    return {
      ...base,
      ip: '',
      puerto: normalizePuerto(moduleConfig || {}),
    };
  }
  const ip = String(moduleConfig?.ip || '').trim();
  if (!isValidIp(ip)) {
    throw new Error(`IP inválida en ${moduleName}`);
  }
  const puerto = normalizePuerto(moduleConfig || {});
  if (!Number.isFinite(puerto) || puerto <= 0 || puerto > 65535) {
    throw new Error(`Puerto inválido en ${moduleName}`);
  }
  return {
    ...base,
    tipo: 'red',
    ip,
    puerto,
    nombre: String(moduleConfig?.nombre || '').trim(),
  };
}

function isPrintingModuleKey(key) {
  const k = String(key || '').trim();
  if (!k || k === '__proto__' || k === 'constructor' || k === 'prototype') return false;
  return /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(k);
}

function collectPrintingModuleKeys(...objs) {
  const keys = new Set(['caja', 'cocina', 'bar']);
  for (const o of objs) {
    if (!o || typeof o !== 'object') continue;
    for (const k of Object.keys(o)) {
      if (isPrintingModuleKey(k)) keys.add(k);
    }
  }
  return [...keys];
}

function syncPaperFields(mod) {
  const next = mod && typeof mod === 'object' ? { ...mod } : {};
  if (next.paperWidth != null && next.anchoPapel == null) next.anchoPapel = next.paperWidth;
  if (next.anchoPapel != null && next.paperWidth == null) next.paperWidth = next.anchoPapel;
  return next;
}

function normalizeConfig(input, options = {}) {
  const strict = Boolean(options.strict);
  const fn = strict ? normalizeModuleStrict : normalizeModuleLenient;
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const k of collectPrintingModuleKeys(src, DEFAULT_CONFIG)) {
    out[k] = fn(src[k], k);
  }
  return out;
}

function mergeModulePayload(current, incoming) {
  const a = current && typeof current === 'object' ? current : {};
  const b = incoming && typeof incoming === 'object' ? incoming : {};
  return { ...a, ...b };
}

function ensureConfigFile() {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(normalizeConfig(DEFAULT_CONFIG, { strict: false }), null, 2), 'utf8');
    console.log(`[printing] configuración creada en primera ejecución: ${CONFIG_PATH}`);
  }
}

function safeDefaultConfig(reason = '') {
  if (reason) {
    console.warn(`[printing] usando fallback de configuración: ${reason}`);
  }
  return normalizeConfig(DEFAULT_CONFIG, { strict: false });
}

function loadConfig() {
  try {
    ensureConfigFile();
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (jsonErr) {
      console.error('[printing] JSON inválido en printer-config.json:', jsonErr.message || jsonErr);
      const fallback = safeDefaultConfig('JSON inválido');
      try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(fallback, null, 2), 'utf8');
        console.log('[printing] configuración reparada con valores por defecto');
      } catch (writeErr) {
        console.error('[printing] no se pudo reparar printer-config.json:', writeErr.message || writeErr);
      }
      return fallback;
    }
    const normalized = normalizeConfig(parsed, { strict: false });
    console.log(`[printing] configuración cargada: ${CONFIG_PATH}`);
    return normalized;
  } catch (err) {
    console.error('[printing] error lectura/permiso en config:', err.message || err);
    return safeDefaultConfig('error de lectura');
  }
}

function saveConfig(nextConfig) {
  ensureConfigFile();
  let currentRaw = {};
  try {
    currentRaw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    console.error('[printing] error leyendo config actual al guardar:', err.message || err);
    currentRaw = {};
  }
  const incoming = nextConfig && typeof nextConfig === 'object' ? nextConfig : {};
  const keys = collectPrintingModuleKeys(currentRaw, incoming, DEFAULT_CONFIG);
  const merged = {};
  for (const k of keys) {
    merged[k] = syncPaperFields(mergeModulePayload(currentRaw[k], incoming[k]));
  }
  const keysExplicit = keys.filter((k) => Object.prototype.hasOwnProperty.call(incoming, k));
  let finalized = normalizeConfig(merged, { strict: false });
  keysExplicit.forEach((k) => {
    finalized[k] = normalizeModuleStrict(merged[k], k);
  });
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(finalized, null, 2), 'utf8');
  } catch (err) {
    console.error('[printing] error escritura config (permisos/ruta):', err.message || err);
    throw new Error('No se pudo escribir la configuración de impresión');
  }
  console.log(`[printing] configuración guardada: ${CONFIG_PATH}`);
  return finalized;
}

/** Crea config de impresora (mismo default que cocina/bar) para áreas nuevas. */
function ensurePrintingModules(moduleKeys = []) {
  const ids = (Array.isArray(moduleKeys) ? moduleKeys : [moduleKeys])
    .map((k) => String(k || '').trim())
    .filter((k) => isPrintingModuleKey(k) && k !== 'caja');
  if (!ids.length) return loadConfig();
  const current = loadConfig();
  const incoming = {};
  let need = false;
  for (const id of ids) {
    if (!current[id]) {
      incoming[id] = DEFAULT_CONFIG.cocina;
      need = true;
    }
  }
  if (!need) return current;
  return saveConfig(incoming);
}

module.exports = {
  loadConfig,
  saveConfig,
  normalizeConfig,
  DEFAULT_CONFIG,
  isValidIp,
  isPrintingModuleKey,
  ensurePrintingModules,
};
