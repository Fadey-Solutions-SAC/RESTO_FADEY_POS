import { toLocalDateKey } from '../utils/api';

/** Altura unificada para filtros de fecha (compras, informes, etc.). */
export const DATE_FILTER_CTRL =
  'h-9 shrink-0 px-2.5 rounded-none text-sm font-medium leading-none border border-[color:var(--ui-border)] inline-flex items-center gap-1.5 box-border bg-[var(--ui-surface)] text-[var(--ui-body-text)]';

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
 * Al hacer clic en el año del picker nativo se puede cambiar a otro año (rango min/max).
 *
 * emptySeed:
 * - 'monthStart' (default en Desde): inicio del mes actual — alineado con Productos/Finanzas/Descuentos/Indicadores
 * - 'yearStart': 1 de enero del año actual
 * - 'today': hoy
 * - false: no rellenar al enfocar
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
      className={`${DATE_FILTER_CTRL} ${widthClass} justify-start overflow-hidden ${roundedNone ? 'rounded-none' : 'rounded-lg'} ${className}`}
    >
      <span className="text-[var(--ui-muted)] shrink-0 text-xs">{label}</span>
      <input
        type="date"
        aria-label={label}
        min={min}
        max={max}
        className="min-w-0 w-full flex-1 bg-transparent border-0 p-0 h-full text-sm leading-none text-[var(--ui-body-text)] outline-none [&::-webkit-calendar-picker-indicator]:scale-90 [&::-webkit-calendar-picker-indicator]:m-0"
        value={value || ''}
        onFocus={() => {
          // Solo si el campo está vacío: no toca defaults ya puestos (p. ej. inicio de mes → hoy).
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
      className={`${DATE_FILTER_CTRL} px-3 justify-center whitespace-nowrap ${
        active
          ? 'bg-[#3B82F6] text-white border-transparent'
          : 'hover:bg-[var(--ui-sidebar-hover)]'
      } ${className}`}
    >
      {children}
    </button>
  );
}
