export default function IndicatorStatCard({
  icon: Icon,
  label,
  value,
  sub,
  trend,
  accent = 'default',
  size = 'md',
  onClick,
}) {
  const clickable = typeof onClick === 'function';
  const accentRing =
    accent === 'emerald'
      ? 'border-emerald-500/25'
      : accent === 'amber'
        ? 'border-amber-500/25'
        : accent === 'sky'
          ? 'border-sky-500/25'
          : 'border-gold-500/20';
  const large = size === 'lg';
  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? onClick : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={`stat-card-premium flex h-full min-h-0 w-full min-w-0 flex-col justify-center overflow-hidden rounded-xl border ${accentRing} bg-[var(--ui-surface)] ${
        large ? 'p-4' : 'p-3'
      } ${
        clickable
          ? 'cursor-pointer transition hover:border-gold-500/45 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/40'
          : ''
      }`}
      title={clickable ? 'Ver detalle' : undefined}
    >
      <div className="flex items-center gap-2 mb-1 min-w-0">
        {Icon ? <Icon className={`${large ? 'text-xl' : 'text-lg'} shrink-0 text-gold-600`} /> : null}
        <p className={`${large ? 'text-xs sm:text-sm' : 'text-[11px] sm:text-xs'} min-w-0 text-[var(--ui-muted)] uppercase tracking-wide leading-tight line-clamp-2`}>
          {label}
        </p>
      </div>
      <p
        className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap font-bold tabular-nums leading-none text-[var(--ui-body-text)] text-[clamp(0.95rem,1.5vw,1.65rem)]"
        title={typeof value === 'string' || typeof value === 'number' ? String(value) : undefined}
      >
        {value}
      </p>
      {sub ? <p className="mt-1 truncate text-[11px] text-[var(--ui-muted)]">{sub}</p> : null}
      {trend != null ? (
        <p className={`mt-1 truncate text-[11px] font-medium ${Number(trend) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
          {Number(trend) >= 0 ? '+' : ''}{trend}% vs mes anterior
        </p>
      ) : null}
      {clickable ? (
        <p className="text-[10px] text-[var(--ui-muted)] mt-2 opacity-80">Clic para ver detalle</p>
      ) : null}
    </div>
  );
}
