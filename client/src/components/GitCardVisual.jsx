import { resolveMediaUrl } from '../utils/api';

function slotClass(kind) {
  if (kind === 'confirmed') return 'bg-emerald-400 text-emerald-950';
  if (kind === 'pending') return 'bg-amber-300/90 text-amber-950 ring-2 ring-amber-100/80';
  return 'bg-white/15 text-white/70';
}

export default function GitCardVisual({ card, compact = false }) {
  if (!card) return null;
  const colors = card.colors || {};
  const progress = card.progress || { confirmed: 0, pending: 0, goal: 0, remaining: 0 };
  const goal = Math.max(0, Number(progress.goal || 0));
  const confirmed = Number(progress.confirmed || 0);
  const pending = Number(progress.pending || 0);
  const slots = Array.from({ length: Math.max(goal, 1) }, (_, i) => {
    if (i < confirmed) return 'confirmed';
    if (i < confirmed + pending) return 'pending';
    return 'empty';
  });
  const statusLabel = {
    none: 'Sin tarjeta activa',
    active: 'Activa',
    pending: 'Compra pendiente',
    completed: 'Completada',
    reward_available: 'Recompensa disponible',
    reward_used: 'Recompensa utilizada',
    expired: 'Vencida',
  }[card.status] || card.status || '—';

  return (
    <article
      className={`relative overflow-hidden rounded-2xl shadow-lg ${compact ? 'p-4' : 'p-5 sm:p-6'}`}
      style={{ background: colors.bg || '#111827', color: colors.text || '#f8fafc' }}
    >
      <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-20" style={{ background: colors.accent }} />
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {card.logo_url ? (
            <img src={resolveMediaUrl(card.logo_url)} alt="" className="h-10 w-10 rounded-full bg-white object-cover" />
          ) : (
            <span className="grid h-10 w-10 place-items-center rounded-full text-sm font-bold" style={{ background: colors.accent, color: colors.bg }}>
              {(card.restaurant_name || 'R').slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-xs uppercase tracking-wider opacity-80">{card.program_name || 'GIT Cards'}</p>
            <p className="truncate text-lg font-semibold">{card.restaurant_name || 'Restaurante'}</p>
          </div>
        </div>
        <span className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: colors.accent, color: colors.bg }}>
          {statusLabel}
        </span>
      </div>
      <div className="mt-4">
        <p className="text-base font-semibold">{card.customer?.name || 'Cliente'}</p>
        {card.customer?.doc_masked ? (
          <p className="text-xs opacity-70">Doc. {card.customer.doc_masked}</p>
        ) : null}
      </div>
      <div className={`mt-4 flex flex-wrap ${compact ? 'gap-1.5' : 'gap-2'}`}>
        {slots.map((kind, i) => (
          <span
            key={`${kind}-${i}`}
            className={`grid ${compact ? 'h-8 w-8 text-xs' : 'h-10 w-10 text-sm'} place-items-center rounded-full font-bold ${slotClass(kind)}`}
            title={kind === 'confirmed' ? 'Avance confirmado' : kind === 'pending' ? 'Pendiente de validación' : 'Sin avance'}
          >
            {i + 1}
          </span>
        ))}
      </div>
      <div className="mt-4 flex items-end justify-between gap-3 text-sm">
        <div>
          <p className="opacity-70">Progreso</p>
          <p className="font-semibold">{confirmed} / {goal} confirmados</p>
          {pending > 0 ? <p className="text-xs opacity-80">{pending} pendiente(s) de validación</p> : null}
        </div>
        <div className="text-right">
          <p className="opacity-70">Recompensa</p>
          <p className="font-semibold">{card.reward_title || '—'}</p>
        </div>
      </div>
    </article>
  );
}
