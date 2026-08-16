import { DATE_PRESETS } from '../../utils/indicatorsDatePresets';

/** Misma altura y tipografía para filtros, fechas y acciones de Indicadores. */
export const INDICADORES_CTRL =
  'h-8 shrink-0 px-2 rounded-lg text-xs font-medium leading-none border border-[color:var(--ui-border)] inline-flex items-center gap-1 box-border';

export default function IndicatorsDateFilters({ preset, onPresetChange, filters, onFiltersChange }) {
  return (
    <div className="flex items-center gap-1 flex-nowrap">
      {DATE_PRESETS.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onPresetChange(p.id)}
          className={`${INDICADORES_CTRL} px-2.5 justify-center ${
            preset === p.id
              ? 'bg-gold-600 text-white border-gold-600'
              : 'bg-[var(--ui-surface)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]'
          }`}
        >
          {p.label}
        </button>
      ))}
      <label className={`${INDICADORES_CTRL} w-[9.75rem] justify-start bg-[var(--ui-surface)] text-[var(--ui-body-text)] overflow-hidden`}>
        <span className="text-[var(--ui-muted)] shrink-0">Desde</span>
        <input
          type="date"
          aria-label="Desde"
          className="min-w-0 w-full flex-1 bg-transparent border-0 p-0 h-full text-xs leading-none text-[var(--ui-body-text)] outline-none [&::-webkit-calendar-picker-indicator]:scale-75 [&::-webkit-calendar-picker-indicator]:m-0"
          value={filters.from}
          onChange={(e) => {
            onPresetChange('custom');
            onFiltersChange({ ...filters, from: e.target.value });
          }}
        />
      </label>
      <label className={`${INDICADORES_CTRL} w-[9.75rem] justify-start bg-[var(--ui-surface)] text-[var(--ui-body-text)] overflow-hidden`}>
        <span className="text-[var(--ui-muted)] shrink-0">Hasta</span>
        <input
          type="date"
          aria-label="Hasta"
          className="min-w-0 w-full flex-1 bg-transparent border-0 p-0 h-full text-xs leading-none text-[var(--ui-body-text)] outline-none [&::-webkit-calendar-picker-indicator]:scale-75 [&::-webkit-calendar-picker-indicator]:m-0"
          value={filters.to}
          onChange={(e) => {
            onPresetChange('custom');
            onFiltersChange({ ...filters, to: e.target.value });
          }}
        />
      </label>
    </div>
  );
}
