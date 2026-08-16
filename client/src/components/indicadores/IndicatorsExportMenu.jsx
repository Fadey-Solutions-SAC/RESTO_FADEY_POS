import { useState } from 'react';
import { MdDownload, MdClose } from 'react-icons/md';
import { downloadIndicatorsExport, exportHubJsonClient } from '../../utils/indicatorsExport';

const FORMATS = [
  { id: 'csv', label: 'Excel' },
  { id: 'txt', label: 'TXT' },
  { id: 'pdf', label: 'PDF' },
  { id: 'json', label: 'JSON' },
];

const TABS = [
  { id: 'all', label: 'Todo' },
  { id: 'general', label: 'Panel' },
  { id: 'financiero', label: 'Financiero' },
  { id: 'productos', label: 'Productos' },
  { id: 'alertas', label: 'Alertas' },
  { id: 'ia', label: 'IA' },
];

export default function IndicatorsExportMenu({ open, onClose, hub, filters, activeTab }) {
  const [format, setFormat] = useState('csv');
  const [tab, setTab] = useState('all');
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const run = async () => {
    setBusy(true);
    try {
      if (format === 'json' && hub) {
        exportHubJsonClient(hub, `indicadores-${tab}.json`);
      } else {
        await downloadIndicatorsExport({
          format,
          tab: tab === 'all' ? activeTab || 'all' : tab,
          from: filters.from,
          to: filters.to,
        });
      }
      onClose();
    } catch (e) {
      alert(e.message || 'Error al exportar');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="card max-w-md w-full shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-[var(--ui-body-text)] flex items-center gap-2">
            <MdDownload /> Exportar indicadores
          </h3>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-[var(--ui-sidebar-hover)]">
            <MdClose />
          </button>
        </div>
        {hub?.export_meta?.company ? (
          <p className="text-xs text-[var(--ui-muted)] mb-3">Empresa: {hub.export_meta.company}</p>
        ) : null}
        <p className="text-xs text-[var(--ui-muted)] mb-4">
          Período: {filters.from} — {filters.to}
        </p>
        <label className="block text-xs font-medium text-[var(--ui-muted)] mb-1">Formato</label>
        <div className="flex flex-wrap gap-2 mb-4">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFormat(f.id)}
              className={`px-3 py-1.5 rounded-lg text-xs border ${format === f.id ? 'bg-gold-600 text-white border-gold-600' : 'border-[color:var(--ui-border)]'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <label className="block text-xs font-medium text-[var(--ui-muted)] mb-1">Contenido</label>
        <div className="flex flex-wrap gap-2 mb-4">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 rounded-lg text-xs border ${tab === t.id ? 'bg-slate-800 text-white border-slate-800 dark:bg-slate-200 dark:text-slate-900' : 'border-[color:var(--ui-border)]'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn-primary w-full" disabled={busy} onClick={() => void run()}>
          {busy ? 'Generando…' : 'Descargar'}
        </button>
      </div>
    </div>
  );
}
