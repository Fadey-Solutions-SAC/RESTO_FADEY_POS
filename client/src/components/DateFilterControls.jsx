import { toLocalDateKey } from '../utils/api';

/** Altura unificada (misma que «Semana» / recuadros de fecha). */
export const DATE_FILTER_H = 'h-10 min-h-10';

/** Base compartida sin colores de fondo/texto (evita pelear con el estado activo). */
export const DATE_FILTER_CTRL =
  `${DATE_FILTER_H} shrink-0 px-2.5 rounded-none text-sm font-medium leading-none border border-[color:var(--ui-border)] inline-flex items-center gap-1.5 box-border`;

export function currentLocalYear() {
  return String(toLocalDateKey(new Date()) || '').slice(0, 4) || String(new Date().getFullYear());
}

export function currentYearDateBounds() {
  const today = toLocalDateKey(new Date()) || `${currentLocalYear()}-12-31`;
  const y = currentLocalYear();
  const monthStart = `${String(today).slice(0, 7)}-01`;
  return {
    year: y,
    min: `${Number(y) - 15}-01-01`,
    max: `${Number(y) + 5}-12-31`,
    yearStart: `${y}-01-01`,
    monthStart,
    today,
  };
}

/**
 * Input date con etiqueta delante (Desde/Hasta).
 * Si está vacío, al enfocar ancla el calendario al año/mes actual (no cambia defaults ya cargados).
 */
export function InlineDateField({
  label,
  value,
  onChange,
  className = '',
  widthClass = 'w-[11.5rem]',
  roundedNone = true,
  emptySeed,
}) {
  const { min, max, today, yearStart, monthStart } = currentYearDateBounds();
  const isDesde = label?.toLowerCase().includes('desde');
  const seedKey = emptySeed === undefined
    ? (isDesde ? 'monthStart' : 'today')
    : emptySeed;
  const seed =
    seedKey === false
      ? null
      : seedKey === 'yearStart'
        ? yearStart
        : seedKey === 'today'
          ? today
          : monthStart;

  return (
    <label
      className={`${DATE_FILTER_CTRL} ${widthClass} justify-start overflow-hidden bg-[var(--ui-surface)] text-[var(--ui-body-text)] ${roundedNone ? 'rounded-none' : 'rounded-lg'} ${className}`}
    >
      <span className="text-[var(--ui-muted)] shrink-0 text-xs">{label}</span>
      <input
        type="date"
        aria-label={label}
        min={min}
        max={max}
        className="min-w-0 w-full flex-1 bg-transparent border-0 p-0 h-full min-h-0 text-sm leading-none text-[var(--ui-body-text)] outline-none [&::-webkit-calendar-picker-indicator]:scale-90 [&::-webkit-calendar-picker-indicator]:m-0"
        value={value || ''}
        onFocus={() => {
          if (!value && seed) onChange?.(seed);
        }}
        onChange={(e) => onChange?.(e.target.value)}
      />
    </label>
  );
}

export function DateFilterPeriodButton({
  active,
  onClick,
  children,
  className = '',
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`${DATE_FILTER_CTRL} px-3 justify-center whitespace-nowrap ${
        active
          ? 'bg-[var(--ui-accent)] text-white border-[var(--ui-accent)]'
          : 'bg-[var(--ui-surface)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]'
      } ${className}`}
    >
      {children}
    </button>
  );
}
