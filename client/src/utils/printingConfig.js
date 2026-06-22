import {
  api,
  checkPrintingHealth,
  electronPrinting,
  ensureLocalPrintingAssistantDiscovered,
  hasElectronPrinting,
  normalizeUsbPrinterList,
  printingUnreachableMessage,
  getPersistedPrintingBridgeOrigin,
} from './api';
import { normalizeThermalPaperWidthMm } from './ticketPlainText';

export const PRINTING_CONFIG_CACHE_KEY = 'resto_printing_config_cache_v1';
export const PRINTING_CONFIG_UPDATED_EVENT = 'resto-printing-config-updated';

export const DEFAULT_PRINTING_CONFIG = {
  caja: { tipo: 'usb', nombre: '', ip: '', puerto: 9100, autoPrint: true, paperWidth: 80, anchoPapel: 80 },
  cocina: { tipo: 'usb', nombre: '', ip: '', puerto: 9100, autoPrint: true, paperWidth: 80, anchoPapel: 80 },
  bar: { tipo: 'usb', nombre: '', ip: '', puerto: 9100, autoPrint: true, paperWidth: 80, anchoPapel: 80 },
};

export const PRINTING_MODULE_LABELS = {
  caja: 'Caja',
  cocina: 'Cocina',
  bar: 'Bar',
};

export function normalizePrintingConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return { ...DEFAULT_PRINTING_CONFIG };
  return {
    caja: { ...DEFAULT_PRINTING_CONFIG.caja, ...(cfg.caja || {}) },
    cocina: { ...DEFAULT_PRINTING_CONFIG.cocina, ...(cfg.cocina || {}) },
    bar: { ...DEFAULT_PRINTING_CONFIG.bar, ...(cfg.bar || {}) },
  };
}

export function cachePrintingConfig(cfg) {
  try {
    const normalized = normalizePrintingConfig(cfg);
    window.localStorage?.setItem(PRINTING_CONFIG_CACHE_KEY, JSON.stringify(normalized));
    emitPrintingConfigUpdated(normalized);
    return normalized;
  } catch (_) {
    return normalizePrintingConfig(cfg);
  }
}

export function loadPrintingConfigFromCache() {
  try {
    const raw = window.localStorage?.getItem(PRINTING_CONFIG_CACHE_KEY);
    if (!raw) return null;
    return normalizePrintingConfig(JSON.parse(raw));
  } catch (_) {
    return null;
  }
}

export function emitPrintingConfigUpdated(cfg) {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(PRINTING_CONFIG_UPDATED_EVENT, { detail: normalizePrintingConfig(cfg) }));
  } catch (_) {
    /* noop */
  }
}

export function isAutoPrintFlagEnabled(value) {
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return null;
}

export function isPrintingModuleEnabled(cfg, moduleKey) {
  if (moduleKey === 'caja') {
    const flag = isAutoPrintFlagEnabled(cfg?.caja?.autoPrint);
    return flag === null ? true : flag;
  }
  const flag = isAutoPrintFlagEnabled(cfg?.[moduleKey]?.autoPrint);
  return flag === null ? false : flag;
}

export function isValidPrintingIp(value) {
  return /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(String(value || '').trim());
}

export async function fetchPrintingConfig() {
  const loader = hasElectronPrinting()
    ? electronPrinting.getConfig()
    : api.printing.get('/printing/config');
  const cfg = await loader;
  return cachePrintingConfig(cfg);
}

/**
 * Tras login: descubre asistente, carga config y la persiste en caché local
 * para que cocina/bar/caja no pierdan la vinculación al recargar.
 */
export async function bootstrapPrintingOnLogin() {
  if (typeof window === 'undefined') return loadPrintingConfigFromCache();
  try {
    if (!hasElectronPrinting()) {
      await ensureLocalPrintingAssistantDiscovered();
    }
    return await fetchPrintingConfig();
  } catch (err) {
    console.warn('[printing] bootstrap login:', err?.message || err);
    const cached = loadPrintingConfigFromCache();
    if (cached) return cached;
    return normalizePrintingConfig(DEFAULT_PRINTING_CONFIG);
  }
}

export async function verifyPrintingLinkStatus() {
  try {
    if (hasElectronPrinting()) {
      await electronPrinting.health();
      let detail = 'Impresión con aplicación Resto FADEY instalada';
      try {
        const br = await electronPrinting.getBridgeOrigin();
        if (br?.origin) detail = `Servicio local · ${br.origin}`;
      } catch (_) {
        /* noop */
      }
      return {
        connected: true,
        source: 'Aplicación Resto FADEY',
        detail,
      };
    }
    await checkPrintingHealth();
    const persisted = getPersistedPrintingBridgeOrigin();
    return {
      connected: true,
      source: 'Asistente local vinculado',
      detail: persisted || '',
    };
  } catch (err) {
    return {
      connected: false,
      source: 'Sin vínculo',
      detail: err?.message || printingUnreachableMessage(),
    };
  }
}

export async function detectUsbPrintersForModule(moduleKey) {
  if (hasElectronPrinting()) {
    await electronPrinting.health();
    const data = await electronPrinting.getPrinters(moduleKey);
    return normalizeUsbPrinterList(data);
  }
  await checkPrintingHealth();
  const data = await api.printing.get(`/printers?module=${encodeURIComponent(moduleKey)}`);
  return normalizeUsbPrinterList(data);
}

export async function savePrintingModuleAutoPrint(fullConfig, moduleKey, autoPrint) {
  const moduleCfg = { ...(fullConfig?.[moduleKey] || {}), autoPrint: Boolean(autoPrint) };
  return savePrintingModuleConfig(fullConfig, moduleKey, moduleCfg);
}

export async function savePrintingModuleConfig(fullConfig, moduleKey, moduleCfgOverride = null) {
  const moduleCfg = moduleCfgOverride || fullConfig?.[moduleKey];
  if (!moduleCfg) throw new Error('Configuración de módulo inválida');
  const width = normalizeThermalPaperWidthMm(moduleCfg.anchoPapel ?? moduleCfg.paperWidth ?? 80);
  const payload = {
    [moduleKey]: {
      ...moduleCfg,
      anchoPapel: width,
      paperWidth: width,
    },
  };
  const saved = hasElectronPrinting()
    ? await electronPrinting.saveConfig(payload)
    : await api.printing.put('/printing/config', payload);
  return cachePrintingConfig(saved || { ...fullConfig, ...payload });
}

export async function printTestForModule(moduleKey) {
  if (hasElectronPrinting()) {
    return electronPrinting.printTest(moduleKey);
  }
  return api.printing.post(`/printing/test/${moduleKey}`, {});
}

export async function getPrinterStatusForModule(moduleKey) {
  if (hasElectronPrinting()) {
    return electronPrinting.getStatus(moduleKey);
  }
  return api.printing.get(`/printing/status/${moduleKey}`);
}

export { normalizeThermalPaperWidthMm as normalizePaperWidthMm, printingUnreachableMessage };
