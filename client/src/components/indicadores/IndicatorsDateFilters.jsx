import { DATE_PRESETS } from '../../utils/indicatorsDatePresets';

export default function IndicatorsDateFilters({ preset, onPresetChange, filters, onFiltersChange }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-wrap gap-1.5 items-center">
        {DATE_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPresetChange(p.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
              preset === p.id
                ? 'bg-gold-600 text-white border-gold-600'
                : 'border-[color:var(--ui-border)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <label className="block text-xs text-[var(--ui-muted)] mb-1">Desde</label>
          <input
            type="date"
            className="input-field py-1.5 min-w-[9.5rem]"
            value={filters.from}
            onChange={(e) => {
              onPresetChange('custom');
              onFiltersChange({ ...filters, from: e.target.value });
            }}
          />
        </div>
        <div>
          <label className="block text-xs text-[var(--ui-muted)] mb-1">Hasta</label>
          <input
            type="date"
            className="input-field py-1.5 min-w-[9.5rem]"
            value={filters.to}
            onChange={(e) => {
              onPresetChange('custom');
              onFiltersChange({ ...filters, to: e.target.value });
            }}
          />
        </div>
      </div>
    </div>
  );
}
