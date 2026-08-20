import {
  api,
  buildConfiguredPrintingLinkStatus,
  checkPrintingHealth,
  electronPrinting,
  ensureLocalPrintingAssistantDiscovered,
  fetchUsbPrintersFromBridge,
  getApiOrigin,
  getPersistedPrintingBridgeOrigin,
  hasElectronPrinting,
  isDesktopEmbeddedRuntime,
  isPrintingLinkConfigured,
  markPrintingLinkConfigured,
  normalizeUsbPrinterList,
  persistPrintingBridgeOrigin,
  printingUnreachableMessage,
  resolvePrintingAssistantOrigin,
  usesInstalledLocalPrinting,
} from './api';
import { tryWakePrintingAssistant } from './printingAssistantWake';
import { normalizeThermalPaperWidthMm } from './ticketPlainText';

export const PRINTING_CONFIG_CACHE_KEY = 'resto_printing_config_cache_v1';
export const PRINTING_CONFIG_UPDATED_EVENT = 'resto-printing-config-updated';
export const PRINTING_LINK_STATUS_EVENT = 'resto-printing-link-status';

export const DEFAULT_STATION_PRINTING = {
  tipo: 'usb', nombre: '', ip: '', puerto: 9100, autoPrint: true, paperWidth: 80, anchoPapel: 80,
};

export const DEFAULT_PRINTING_CONFIG = {
  caja: { ...DEFAULT_STATION_PRINTING, autoPrint: true },
  cocina: { ...DEFAULT_STATION_PRINTING },
  bar: { ...DEFAULT_STATION_PRINTING },
};

export const PRINTING_MODULE_LABELS = {
  caja: 'Caja',
  cocina: 'Cocina',
  bar: 'Bar',
};

export function isPrintingModuleKey(key) {
  const k = String(key || '').trim();
  if (!k || k === '__proto__' || k === 'constructor' || k === 'prototype') return false;
  return /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(k);
}

export function listPrintingUiModules(productionAreas = []) {
  const entries = [{ key: 'caja', label: 'Caja' }];
  const seen = new Set(['caja']);
  const areas = Array.isArray(productionAreas) ? productionAreas : [];
  if (areas.length) {
    for (const a of areas) {
      const id = String(a?.id || '').trim();
      if (!id || seen.has(id) || !isPrintingModuleKey(id)) continue;
      seen.add(id);
      entries.push({ key: id, label: String(a.name || id).trim() || id });
    }
  } else {
    entries.push({ key: 'cocina', label: 'Cocina' }, { key: 'bar', label: 'Bar' });
  }
  return entries;
}

export function ensurePrintingConfigForAreas(cfg, productionAreas = []) {
  const out = normalizePrintingConfig(cfg);
  for (const a of productionAreas || []) {
    const id = String(a?.id || '').trim();
    if (!id || id === 'caja' || !isPrintingModuleKey(id)) continue;
    if (!out[id]) out[id] = { ...DEFAULT_STATION_PRINTING };
  }
  return out;
}

export function printingModuleLabel(moduleKey, productionAreas = []) {
  const k = String(moduleKey || '').trim();
  if (PRINTING_MODULE_LABELS[k]) return PRINTING_MODULE_LABELS[k];
  const hit = (productionAreas || []).find((a) => String(a?.id || '').trim() === k);
  return (hit && String(hit.name || '').trim()) || k;
}

export function normalizePrintingConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return { ...DEFAULT_PRINTING_CONFIG };
  const moduleDefault = DEFAULT_STATION_PRINTING;
  const out = {
    caja: { ...DEFAULT_PRINTING_CONFIG.caja, ...(cfg.caja || {}) },
    cocina: { ...DEFAULT_PRINTING_CONFIG.cocina, ...(cfg.cocina || {}) },
    bar: { ...DEFAULT_PRINTING_CONFIG.bar, ...(cfg.bar || {}) },
  };
  for (const [key, val] of Object.entries(cfg)) {
    if (key === 'caja' || key === 'cocina' || key === 'bar') continue;
    if (!isPrintingModuleKey(key)) continue;
    if (!val || typeof val !== 'object') continue;
    out[key] = { ...moduleDefault, ...val };
  }
  return out;
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

function emitPrintingLinkStatus(status) {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(PRINTING_LINK_STATUS_EVENT, { detail: status }));
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
  return maintainPrintingAssistantLink({ tryWake: true });
}

/**
 * Mantiene vínculo con Resto FADEY mientras hay sesión activa.
 * No borra el origen guardado; solo lo actualiza si encuentra un asistente válido.
 */
export async function maintainPrintingAssistantLink({ tryWake = false } = {}) {
  if (typeof window === 'undefined') {
    return { connected: false, source: 'Sin navegador', detail: '' };
  }

  const finish = async (status) => {
    emitPrintingLinkStatus(status);
    return status;
  };

  try {
    const quick = await verifyPrintingLinkStatus();
    if (quick.connected) {
      try {
        await fetchPrintingConfig();
      } catch (_) {
        loadPrintingConfigFromCache();
      }
      return finish(quick);
    }
  } catch (_) {
    /* continuar con descubrimiento */
  }

  if (!usesInstalledLocalPrinting()) {
    await ensureLocalPrintingAssistantDiscovered();
    if (tryWake) {
      const afterDiscover = await verifyPrintingLinkStatus();
      if (!afterDiscover.connected) {
        tryWakePrintingAssistant();
        await new Promise((r) => setTimeout(r, 1800));
        await ensureLocalPrintingAssistantDiscovered();
      }
    }
  }

  try {
    await fetchPrintingConfig();
    const status = await verifyPrintingLinkStatus();
    return finish(status);
  } catch (err) {
    const cached = loadPrintingConfigFromCache();
    const persisted = getPersistedPrintingBridgeOrigin();
    if (cached || persisted || isPrintingLinkConfigured()) {
      const fallback = buildConfiguredPrintingLinkStatus(
        persisted ? `${persisted} · reconectando…` : 'Esperando servicio Resto FADEY',
      );
      return finish(fallback);
    }
    return finish({
      connected: false,
      source: 'Sin vínculo',
      detail: err?.message || printingUnreachableMessage(),
    });
  }
}

export async function verifyPrintingLinkStatus() {
  let status;
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
      status = {
        connected: true,
        source: 'Aplicación Resto FADEY',
        detail,
      };
    } else if (isDesktopEmbeddedRuntime()) {
      await checkPrintingHealth();
      const origin = getApiOrigin();
      const assistant = await resolvePrintingAssistantOrigin();
      if (assistant) persistPrintingBridgeOrigin(assistant);
      status = {
        connected: true,
        source: 'Aplicación Resto FADEY instalada',
        detail: assistant ? `Servicio local · ${assistant}` : (origin ? `Servicio local · ${origin}` : 'Servicio local en esta PC'),
      };
    } else {
      await checkPrintingHealth();
      const persisted = getPersistedPrintingBridgeOrigin();
      status = {
        connected: true,
        source: 'Asistente local vinculado',
        detail: persisted || '',
      };
    }
  } catch (err) {
    if (isPrintingLinkConfigured()) {
      status = buildConfiguredPrintingLinkStatus(err?.message || 'Reconectando servicio local…');
    } else {
      status = {
        connected: false,
        source: 'Sin vínculo',
        detail: err?.message || printingUnreachableMessage(),
      };
    }
  }
  emitPrintingLinkStatus(status);
  return status;
}

export async function detectUsbPrintersForModule(moduleKey) {
  return fetchUsbPrintersFromBridge(moduleKey);
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
  const merged = saved || { ...fullConfig, ...payload };
  cachePrintingConfig(merged);
  try {
    let origin = getPersistedPrintingBridgeOrigin();
    if (!origin) origin = await resolvePrintingAssistantOrigin();
    if (!origin && isDesktopEmbeddedRuntime()) origin = getApiOrigin();
    markPrintingLinkConfigured(origin);
  } catch (_) {
    markPrintingLinkConfigured();
  }
  return merged;
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
