/** Misma ficha de totales que Ventas: degradado, círculo de color e icono de fondo. */
const TONES = {
  emerald: {
    wrap: 'from-emerald-50 to-white border-emerald-200/80',
    bubble: 'from-emerald-400 to-emerald-600 shadow-emerald-500/30',
    deco: 'text-emerald-400/70',
  },
  sky: {
    wrap: 'from-sky-50 to-white border-sky-200/80',
    bubble: 'from-sky-400 to-blue-600 shadow-blue-500/30',
    deco: 'text-sky-300/80',
  },
  amber: {
    wrap: 'from-amber-50 to-white border-amber-200/80',
    bubble: 'from-amber-400 to-orange-500 shadow-amber-500/30',
    deco: 'text-amber-300/80',
  },
  violet: {
    wrap: 'from-violet-50 to-white border-violet-200/80',
    bubble: 'from-violet-400 to-purple-600 shadow-purple-500/30',
    deco: 'text-violet-300/80',
  },
};

export const KPI_TONE_CYCLE = ['emerald', 'sky', 'amber', 'violet'];

export default function ModuleKpiCard({
  icon: Icon,
  deco: Deco,
  title,
  value,
  hint,
  tone = 'emerald',
}) {
  const style = TONES[tone] || TONES.emerald;
  const Corner = Deco || Icon;
  return (
    <div className={`relative overflow-hidden rounded-xl border bg-gradient-to-br sm:rounded-2xl ${style.wrap} p-3 shadow-sm sm:p-5`}>
      {Corner ? (
        <Corner className={`pointer-events-none absolute right-2 top-2 text-3xl sm:right-4 sm:top-4 sm:text-5xl ${style.deco}`} />
      ) : null}
      <div className="pointer-events-none absolute -bottom-10 -right-6 h-28 w-48 rounded-full bg-white/50" />
      <div className="relative flex items-start gap-2 sm:gap-4">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br text-white shadow-lg sm:h-14 sm:w-14 ${style.bubble}`}>
          <Icon className="text-lg sm:text-2xl" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold text-slate-800 sm:text-sm" title={title}>{title}</p>
          <p className="mt-0.5 truncate text-xl font-bold tabular-nums leading-none text-slate-900 sm:mt-1 sm:text-4xl" title={String(value)}>{value}</p>
          {hint ? <p className="mt-1 line-clamp-2 text-[10px] text-slate-500 sm:mt-2 sm:text-xs">{hint}</p> : null}
        </div>
      </div>
    </div>
  );
}
