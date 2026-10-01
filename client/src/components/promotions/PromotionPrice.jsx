const defaultFmt = (amount) => `S/ ${Number(amount || 0).toFixed(2)}`;

/** Precio original tachado + precio promocional destacado. Sin descuento muestra solo el precio normal. */
export default function PromotionPrice({
  original,
  final,
  formatCurrency = defaultFmt,
  stacked = true,
  align = 'right',
  className = '',
  finalClassName = '',
}) {
  const orig = Number(original || 0);
  const fin = final == null ? orig : Number(final || 0);
  const hasDiscount = fin + 0.004 < orig;
  if (!hasDiscount) {
    return <span className={`${className} ${finalClassName}`.trim()}>{formatCurrency(orig)}</span>;
  }
  return (
    <span
      className={`inline-flex ${stacked ? 'flex-col' : 'flex-row items-baseline gap-1.5'} leading-tight ${className}`.trim()}
      style={{ alignItems: stacked ? (align === 'right' ? 'flex-end' : 'flex-start') : undefined }}
    >
      <span className="text-[0.72em] font-medium text-slate-400 line-through decoration-slate-400">{formatCurrency(orig)}</span>
      <span className={`font-bold text-orange-600 ${finalClassName}`.trim()}>{formatCurrency(fin)}</span>
    </span>
  );
}
