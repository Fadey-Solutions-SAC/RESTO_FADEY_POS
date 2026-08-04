import { useState, useEffect, useCallback, useMemo } from 'react';
import toast from 'react-hot-toast';
import { useSocket } from './useSocket';
import { useActiveInterval } from './useActiveInterval';
import {
  DEFAULT_PRINTING_CONFIG,
  detectUsbPrintersForModule,
  fetchPrintingConfig,
  getPrinterStatusForModule,
  isPrintingModuleEnabled,
  isValidPrintingIp,
  loadPrintingConfigFromCache,
  normalizePrintingConfig,
  normalizePaperWidthMm,
  printTestForModule,
  PRINTING_CONFIG_UPDATED_EVENT,
  PRINTING_LINK_STATUS_EVENT,
  savePrintingModuleConfig,
  verifyPrintingLinkStatus,
  printingUnreachableMessage,
} from '../utils/printingConfig';
import { hasElectronPrinting } from '../utils/api';

/**
 * Gestión unificada de impresora por módulo (caja | cocina | bar).
 * Al montar: carga config (bridge o caché) y verifica vínculo sin desvincular otros módulos.
 */
export function usePrintingModule(moduleKey, { autoLoad = true } = {}) {
  const [printingConfig, setPrintingConfig] = useState(DEFAULT_PRINTING_CONFIG);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [detectedPrinters, setDetectedPrinters] = useState([]);
  const [busy, setBusy] = useState(false);
  const [linkStatus, setLinkStatus] = useState({ checking: false, connected: false, source: '', detail: '' });
  const [printerStatus, setPrinterStatus] = useState({ status: '', connected: false });

  const moduleConfig = useMemo(
    () => printingConfig?.[moduleKey] || DEFAULT_PRINTING_CONFIG[moduleKey] || {},
    [printingConfig, moduleKey],
  );

  const moduleEnabled = useMemo(() => {
    if (moduleKey !== 'caja' && !configLoaded) return false;
    return isPrintingModuleEnabled(printingConfig, moduleKey);
  }, [printingConfig, moduleKey, configLoaded]);

  const applyConfig = useCallback((cfg) => {
    setPrintingConfig(normalizePrintingConfig(cfg));
    setConfigLoaded(true);
  }, []);

  const refreshLink = useCallback(async () => {
    setLinkStatus((prev) => ({ ...prev, checking: true }));
    const status = await verifyPrintingLinkStatus();
    setLinkStatus({ checking: false, ...status });
    return status.connected;
  }, []);

  const refreshPrinterStatus = useCallback(async () => {
    try {
      const data = await getPrinterStatusForModule(moduleKey);
      setPrinterStatus({
        status: data?.status || 'No disponible',
        connected: Boolean(data?.connected),
      });
    } catch (_) {
      setPrinterStatus({ status: 'No disponible', connected: false });
    }
  }, [moduleKey]);

  const loadConfig = useCallback(async () => {
    try {
      const cfg = await fetchPrintingConfig();
      applyConfig(cfg);
      return cfg;
    } catch (err) {
      console.warn('[printing] fallback hook config:', err?.message || err);
      const cached = loadPrintingConfigFromCache();
      if (cached) {
        applyConfig(cached);
        return cached;
      }
      applyConfig(DEFAULT_PRINTING_CONFIG);
      return DEFAULT_PRINTING_CONFIG;
    }
  }, [applyConfig]);

  const detectUsb = useCallback(async () => {
    setBusy(true);
    try {
      const list = await detectUsbPrintersForModule(moduleKey);
      setDetectedPrinters(list);
      await refreshPrinterStatus();
      return list;
    } catch (err) {
      toast.error(err.message || printingUnreachableMessage());
      return [];
    } finally {
      setBusy(false);
    }
  }, [moduleKey, refreshPrinterStatus]);

  const updateModuleField = useCallback((patch) => {
    setPrintingConfig((prev) => ({
      ...prev,
      [moduleKey]: { ...(prev[moduleKey] || {}), ...patch },
    }));
  }, [moduleKey]);

  const saveModule = useCallback(async () => {
    const cfg = printingConfig?.[moduleKey] || {};
    const tipo = String(cfg.tipo || 'usb').toLowerCase();
    if (tipo === 'red') {
      if (!isValidPrintingIp(cfg.ip)) {
        toast.error('IP inválida en modo Red');
        return null;
      }
      const p = Number(cfg.puerto);
      if (!Number.isFinite(p) || p < 1 || p > 65535) {
        toast.error('Puerto inválido en modo Red');
        return null;
      }
    } else if (moduleKey !== 'caja' && !moduleEnabled) {
      /* cocina/bar desactivados: permitir guardar ancho sin USB */
    } else if (moduleKey === 'caja' || moduleEnabled) {
      if (tipo !== 'red' && !String(cfg.nombre || '').trim()) {
        toast.error('Seleccione una impresora USB o use modo Red');
        return null;
      }
    }
    setBusy(true);
    try {
      const saved = await savePrintingModuleConfig(printingConfig, moduleKey);
      setPrintingConfig(normalizePrintingConfig(saved));
      toast.success('Configuración de impresora guardada');
      await refreshPrinterStatus();
      return saved;
    } catch (err) {
      toast.error(err.message || 'No se pudo guardar');
      return null;
    } finally {
      setBusy(false);
    }
  }, [printingConfig, moduleKey, moduleEnabled, refreshPrinterStatus]);

  const printTest = useCallback(async () => {
    setBusy(true);
    try {
      await printTestForModule(moduleKey);
      toast.success('Prueba enviada a la impresora');
      await refreshPrinterStatus();
    } catch (err) {
      toast.error(err.message || 'No se pudo imprimir prueba');
    } finally {
      setBusy(false);
    }
  }, [moduleKey, refreshPrinterStatus]);

  useSocket('printing-config-update', (cfg) => {
    if (cfg && typeof cfg === 'object') applyConfig(cfg);
  });

  useEffect(() => {
    const onUpdated = (event) => {
      if (event?.detail) applyConfig(event.detail);
    };
    window.addEventListener(PRINTING_CONFIG_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(PRINTING_CONFIG_UPDATED_EVENT, onUpdated);
  }, [applyConfig]);

  useEffect(() => {
    const onLink = (event) => {
      if (event?.detail) {
        setLinkStatus({ checking: false, ...event.detail });
      }
    };
    window.addEventListener(PRINTING_LINK_STATUS_EVENT, onLink);
    return () => window.removeEventListener(PRINTING_LINK_STATUS_EVENT, onLink);
  }, []);

  useActiveInterval(() => {
    if (!autoLoad) return;
    void refreshLink();
  }, 20_000);

  useEffect(() => {
    if (!autoLoad) return undefined;
    let cancelled = false;
    const run = async () => {
      await loadConfig();
      if (cancelled) return;
      await refreshLink();
      if (cancelled) return;
      await refreshPrinterStatus();
      if (cancelled) return;
      if (hasElectronPrinting()) {
        try {
          const list = await detectUsbPrintersForModule(moduleKey);
          if (!cancelled) setDetectedPrinters(list);
        } catch (_) {
          /* noop */
        }
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [autoLoad, loadConfig, refreshLink, refreshPrinterStatus, moduleKey]);

  const paperWidth = normalizePaperWidthMm(moduleConfig.anchoPapel ?? moduleConfig.paperWidth ?? 80);

  const visiblePrinters = useMemo(() => {
    const selectedName = String(moduleConfig.nombre || '').trim();
    if (selectedName && !detectedPrinters.some((p) => p.name === selectedName)) {
      return [{ name: selectedName }, ...detectedPrinters];
    }
    return detectedPrinters;
  }, [moduleConfig.nombre, detectedPrinters]);

  return {
    printingConfig,
    setPrintingConfig,
    moduleConfig,
    moduleEnabled,
    configLoaded,
    paperWidth,
    detectedPrinters: visiblePrinters,
    busy,
    linkStatus,
    printerStatus,
    refreshLink,
    refreshPrinterStatus,
    loadConfig,
    detectUsb,
    updateModuleField,
    saveModule,
    printTest,
  };
}
