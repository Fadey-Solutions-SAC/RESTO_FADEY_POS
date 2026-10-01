import { MdLocalOffer } from 'react-icons/md';

const defaultFmt = (amount) => `S/ ${Number(amount || 0).toFixed(2)}`;

/** Resumen del carrito cuando hay promociones aplicadas (subtotal, descuento, ahorro). */
export default function PromotionSummary({ pricing, formatCurrency = defaultFmt, compact = false, className = '' }) {
  const discount = Number(pricing?.discount_total || 0);
  if (!(discount > 0)) return null;
  const textSize = compact ? 'text-[11px]' : 'text-xs';
  return (
    <div
      className={`rounded-lg border border-orange-200 bg-orange-50/70 px-2.5 py-1.5 ${textSize} ${className}`.trim()}
    >
      <div className="flex items-center justify-between gap-2 text-slate-600">
        <span>Subtotal</span>
        <span className="tabular-nums">{formatCurrency(pricing.original_total)}</span>
      </div>
      <div className="flex items-center justify-between gap-2 font-semibold text-orange-700">
        <span className="inline-flex items-center gap-1">
          <MdLocalOffer aria-hidden /> Descuento por promociones
        </span>
        <span className="tabular-nums">-{formatCurrency(discount)}</span>
      </div>
    </div>
  );
}
