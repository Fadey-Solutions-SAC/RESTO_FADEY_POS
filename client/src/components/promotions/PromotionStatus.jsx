import { PROMOTION_STATUS_LABELS } from '../../utils/promotions';

const STATUS_CLASSES = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  scheduled: 'bg-blue-50 text-blue-700 ring-blue-200',
  paused: 'bg-amber-50 text-amber-700 ring-amber-200',
  finished: 'bg-slate-100 text-slate-600 ring-slate-200',
};

const DOT_CLASSES = {
  active: 'bg-emerald-500',
  scheduled: 'bg-blue-500',
  paused: 'bg-amber-500',
  finished: 'bg-slate-400',
};

export default function PromotionStatus({ status, className = '' }) {
  const key = STATUS_CLASSES[status] ? status : 'finished';
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${STATUS_CLASSES[key]} ${className}`.trim()}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${DOT_CLASSES[key]}`} aria-hidden />
      {PROMOTION_STATUS_LABELS[key] || key}
    </span>
  );
}
