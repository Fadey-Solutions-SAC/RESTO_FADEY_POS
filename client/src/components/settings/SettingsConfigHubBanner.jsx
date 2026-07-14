import { MdSync, MdCircle } from 'react-icons/md';

export default function SettingsConfigHubBanner({ hub, loading, onRefresh, sectionId }) {
  const isRegional = sectionId === 'regional';
  const insights = hub?.section_insights?.[sectionId];
  const op = hub?.section_insights?.operacion;

  return (
    <div className="rounded-xl border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] px-4 py-3 mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className={`flex items-center gap-1.5 text-xs font-medium ${loading ? 'text-amber-600' : 'text-emerald-600'}`}>
          <MdCircle className={`text-[8px] ${loading ? 'animate-pulse' : ''}`} />
          {loading ? 'Sincronizando…' : isRegional ? 'Vista operativa (no guarda)' : 'Tiempo real'}
        </div>
        {insights?.open_status ? (
          <span className={`text-xs px-2 py-0.5 rounded-full ${insights.open_status.is_open ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-[var(--ui-muted)]'}`}>
            Local: {insights.open_status.reason}
            {insights.open_status.hours ? ` (${insights.open_status.hours})` : ''}
          </span>
        ) : null}
        {op ? (
          <span className="text-xs text-[var(--ui-muted)]">
            Hoy: {op.orders_today} cuentas · ventas en operación
          </span>
        ) : null}
      </div>
      <button type="button" onClick={onRefresh} className="text-xs text-gold-600 hover:underline flex items-center gap-1">
        <MdSync className={loading ? 'animate-spin' : ''} /> Actualizar
      </button>
    </div>
  );
}
