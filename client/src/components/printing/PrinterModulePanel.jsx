import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { MdPrint, MdSave, MdVolumeUp, MdVolumeOff } from 'react-icons/md';
import {
  getPersistedPrintingBridgeOrigin,
  hasElectronPrinting,
  markPrintingLinkConfigured,
  persistPrintingBridgeOrigin,
} from '../../utils/api';
import { usePrintingModule } from '../../hooks/usePrintingModule';
import PrintingAssistantDownloadButton from './PrintingAssistantDownloadButton';
import {
  unlockNotificationAudio,
  playNotificationSound,
  preloadNotificationSound,
  onNotificationAudioUnlockChange,
  isNotificationAudioUnlocked,
} from '../../utils/playNotificationSound';

function soundTypeForModule(moduleKey) {
  const key = String(moduleKey || '').trim().toLowerCase();
  if (key === 'bar') return 'bar';
  if (key === 'caja') return '';
  return 'kitchen';
}

/**
 * Panel unificado de configuración (caja y áreas de producción).
 * Guarda solo el módulo indicado (merge en servidor) para no desvincular los demás.
 */
export default function PrinterModulePanel({
  moduleKey,
  showLinkSection = true,
  showSoundControl = false,
  compact = false,
  onConfigLoaded,
}) {
  const {
    moduleConfig,
    paperWidth,
    detectedPrinters,
    busy,
    linkStatus,
    printerStatus,
    refreshLink,
    detectUsb,
    updateModuleField,
    saveModule,
    printTest,
    loadConfig,
  } = usePrintingModule(moduleKey);

  const [manualPrintingApi, setManualPrintingApi] = useState(() => (
    getPersistedPrintingBridgeOrigin() || 'http://127.0.0.1:3002'
  ));
  const [linking, setLinking] = useState(false);
  const [soundReady, setSoundReady] = useState(() => isNotificationAudioUnlocked());
  const soundType = soundTypeForModule(moduleKey);
  const showSound = Boolean(showSoundControl && soundType);

  useEffect(() => {
    const o = getPersistedPrintingBridgeOrigin();
    if (o) setManualPrintingApi(o);
  }, [moduleKey]);

  useEffect(() => {
    if (!showSound) return undefined;
    preloadNotificationSound(soundType);
    void unlockNotificationAudio();
    return onNotificationAudioUnlockChange((ready) => setSoundReady(Boolean(ready)));
  }, [showSound, soundType]);

  const handleSave = async () => {
    const saved = await saveModule();
    if (saved && onConfigLoaded) onConfigLoaded(saved);
  };

  const handleRefresh = async () => {
    const cfg = await loadConfig();
    if (onConfigLoaded) onConfigLoaded(cfg);
    await refreshLink();
  };

  const linkPrintingAssistantManually = async () => {
    const raw = String(manualPrintingApi || '').trim();
    if (!raw) {
      toast.error('Ingrese una URL local (ej. http://127.0.0.1:3002)');
      return;
    }
    setLinking(true);
    try {
      window.localStorage?.setItem('resto_local_printing_api', raw);
      persistPrintingBridgeOrigin(raw);
      const ok = await refreshLink();
      if (ok) {
        markPrintingLinkConfigured(raw);
        toast.success('Asistente de impresión vinculado');
      } else {
        toast.error('No se pudo vincular el asistente');
      }
    } catch (_) {
      toast.error('No se pudo guardar la URL local');
    } finally {
      setLinking(false);
    }
  };

  const activateSound = async () => {
    if (!soundType) return;
    await unlockNotificationAudio();
    playNotificationSound(soundType, `cfg-test-${Date.now()}`, { force: true });
    toast.success('Sonido de pedidos activado');
  };

  const cfg = moduleConfig;

  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      {showLinkSection && (
        <div className="rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className={`text-sm font-semibold ${linkStatus.connected ? 'text-emerald-700' : 'text-rose-700'}`}>
                {linkStatus.checking ? 'Verificando vínculo…' : linkStatus.connected ? 'Vinculación activa' : 'Sin vinculación'}
              </p>
              <p className="text-xs ui-text-muted mt-0.5">
                {linkStatus.source}{linkStatus.detail ? ` · ${linkStatus.detail}` : ''}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn-secondary text-sm" onClick={() => void handleRefresh()} disabled={busy || linkStatus.checking || linking}>
                Verificar vínculo
              </button>
              <PrintingAssistantDownloadButton disabled={busy || linking} />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <input
              className="input-field flex-1 min-w-[220px]"
              value={manualPrintingApi}
              onChange={(e) => setManualPrintingApi(e.target.value)}
              placeholder="http://127.0.0.1:3002"
              disabled={busy || linking}
            />
            <button
              type="button"
              className="btn-secondary text-sm shrink-0"
              onClick={() => void linkPrintingAssistantManually()}
              disabled={busy || linking || linkStatus.checking}
            >
              Vincular manual
            </button>
          </div>

          {printerStatus.status ? (
            <p className={`text-xs ${printerStatus.connected ? 'text-emerald-600' : 'text-[var(--ui-muted)]'}`}>
              Impresora: {printerStatus.status}
            </p>
          ) : null}
        </div>
      )}

      {showSound ? (
        <div className="rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] p-3 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--ui-body-text)]">Sonido de pedidos nuevos</p>
            <p className="text-xs ui-text-muted mt-0.5">
              {soundReady
                ? 'Activo: sonará al llegar un pedido a esta área.'
                : 'Activando sonido… Si el navegador lo bloquea, pulse el botón.'}
            </p>
          </div>
          <button
            type="button"
            className={`text-sm inline-flex items-center gap-1.5 shrink-0 ${soundReady ? 'btn-secondary' : 'btn-primary'}`}
            onClick={() => void activateSound()}
          >
            {soundReady ? <MdVolumeUp /> : <MdVolumeOff />}
            {soundReady ? 'Probar sonido' : 'Activar sonido'}
          </button>
        </div>
      ) : null}

      {!hasElectronPrinting() && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm text-amber-800">
            La detección USB y la impresión térmica requieren la aplicación de escritorio Resto FADEY abierta en esta PC.
            Use el botón «Descargar asistente de impresión» arriba para instalarla en esta máquina.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Tipo</label>
          <select
            className="input-field"
            value={cfg.tipo || 'usb'}
            onChange={(e) => updateModuleField({ tipo: e.target.value })}
          >
            <option value="usb">USB</option>
            <option value="red">Red</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Ancho de papel</label>
          <select
            className="input-field"
            value={paperWidth}
            onChange={(e) => {
              const width = Number(e.target.value);
              updateModuleField({ anchoPapel: width, paperWidth: width });
            }}
          >
            <option value={50}>50 mm</option>
            <option value={58}>58 mm</option>
            <option value={75}>75 mm</option>
            <option value={80}>80 mm</option>
          </select>
        </div>
        {(cfg.tipo || 'usb') === 'usb' ? (
          <div className="md:col-span-1">
            <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Impresora USB</label>
            <select
              className="input-field"
              value={cfg.nombre || ''}
              onChange={(e) => updateModuleField({ nombre: e.target.value })}
            >
              <option value="">Seleccione una impresora</option>
              {detectedPrinters.map((p) => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
          </div>
        ) : (
          <>
            <div>
              <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">IP</label>
              <input
                className="input-field"
                value={cfg.ip || ''}
                onChange={(e) => updateModuleField({ ip: e.target.value })}
                placeholder="192.168.1.50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Puerto</label>
              <input
                className="input-field"
                type="number"
                min="1"
                max="65535"
                value={Number(cfg.puerto || 9100)}
                onChange={(e) => updateModuleField({ puerto: Number(e.target.value || 9100) })}
              />
            </div>
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary inline-flex items-center gap-2"
          onClick={() => void detectUsb()}
          disabled={busy}
        >
          Detectar impresoras USB
        </button>
        <button
          type="button"
          className="btn-primary inline-flex items-center gap-2"
          onClick={() => void handleSave()}
          disabled={busy}
        >
          <MdSave /> Guardar configuración
        </button>
        <button
          type="button"
          className="btn-secondary inline-flex items-center gap-2"
          onClick={() => void printTest()}
          disabled={busy || !linkStatus.connected}
        >
          <MdPrint /> Imprimir prueba
        </button>
      </div>
    </div>
  );
}
