import { MdPrint, MdSave } from 'react-icons/md';
import { hasElectronPrinting } from '../../utils/api';
import { usePrintingModule } from '../../hooks/usePrintingModule';
import PrintingAssistantDownloadButton from './PrintingAssistantDownloadButton';

/**
 * Panel unificado de configuración de impresora (caja y áreas de producción).
 * Guarda solo el módulo indicado (merge en servidor) para no desvincular los demás.
 */
export default function PrinterModulePanel({
  moduleKey,
  showLinkSection = true,
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

  const handleSave = async () => {
    const saved = await saveModule();
    if (saved && onConfigLoaded) onConfigLoaded(saved);
  };

  const handleRefresh = async () => {
    const cfg = await loadConfig();
    if (onConfigLoaded) onConfigLoaded(cfg);
    await refreshLink();
  };

  const cfg = moduleConfig;

  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      {showLinkSection && (
        <div className="rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className={`text-sm font-semibold ${linkStatus.connected ? 'text-emerald-700' : 'text-rose-700'}`}>
                {linkStatus.checking ? 'Verificando vínculo…' : linkStatus.connected ? 'Vinculación activa' : 'Sin vinculación'}
              </p>
              <p className="text-xs ui-text-muted mt-0.5">
                {linkStatus.source}{linkStatus.detail ? ` · ${linkStatus.detail}` : ''}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn-secondary text-sm" onClick={() => void handleRefresh()} disabled={busy || linkStatus.checking}>
                Verificar vínculo
              </button>
              <PrintingAssistantDownloadButton disabled={busy} />
            </div>
          </div>
          {printerStatus.status ? (
            <p className={`text-xs ${printerStatus.connected ? 'text-emerald-600' : 'text-[var(--ui-muted)]'}`}>
              Impresora: {printerStatus.status}
            </p>
          ) : null}
        </div>
      )}

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
