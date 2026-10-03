/**
 * Método de pago de una venta. Con varios métodos muestra «Multimétodo» y debajo
 * la lista de cada método con su monto; con uno solo, el texto de siempre.
 */
export default function PaymentSummaryDisplay({ detail, fallback = '—', compact = false, methodOnly = false }) {
  const lines = detail?.lines || [];
  if (methodOnly && lines.length === 1) {
    const courtesy = detail.courtesyCount ? ` · Cortesía × ${detail.courtesyCount}` : '';
    return <>{lines[0].label}{courtesy}</>;
  }
  if (lines.length < 2) return <>{fallback || '—'}</>;

  const textSize = compact ? 'text-xs' : 'text-sm';
  return (
    <div className={`${textSize} leading-snug`}>
      {detail.multi ? <p className="font-semibold">Multimétodo</p> : null}
      <ul className="mt-0.5 space-y-0.5">
        {lines.map((line) => (
          <li key={line.method} className="flex items-baseline justify-between gap-3">
            <span>{line.label}</span>
            <span className="tabular-nums font-medium">S/ {Number(line.amount).toFixed(2)}</span>
          </li>
        ))}
        {detail.courtesyCount ? (
          <li className="text-[var(--ui-muted)]">Cortesía × {detail.courtesyCount}</li>
        ) : null}
      </ul>
    </div>
  );
}
