import { useMemo, useState, useEffect } from 'react';
import { formatCurrency } from '../../utils/api';
import {
  TICKET_PREVIEW_TYPES,
  buildTicketPreviewPlainText,
} from '../../utils/ticketPreviewSamples';

/** Vista previa en tiempo real; usa los mismos builders que POS y cocina. */
export default function TicketPreviewPanel({ restaurant, profile, showDeliveryType = true }) {
  const [ticketType, setTicketType] = useState('precuenta');
  const widthMm = Number(profile?.ticket?.paper_width_mm) === 58 ? 58 : 80;

  const previewTypes = useMemo(
    () => (showDeliveryType ? TICKET_PREVIEW_TYPES : TICKET_PREVIEW_TYPES.filter((t) => t.id !== 'delivery')),
    [showDeliveryType],
  );

  useEffect(() => {
    if (!showDeliveryType && ticketType === 'delivery') setTicketType('precuenta');
  }, [showDeliveryType, ticketType]);

  const activeMeta = previewTypes.find((t) => t.id === ticketType) || previewTypes[0];

  const previewText = useMemo(
    () =>
      buildTicketPreviewPlainText(ticketType, {
        restaurant,
        profile,
        formatCurrencyFn: formatCurrency,
      }),
    [ticketType, restaurant, profile],
  );

  const welcome = String(profile?.ticket?.welcome_message || '').trim();
  const promo = String(profile?.ticket?.promo_message || '').trim();
  const showPromoBelow =
    promo && !['pedido', 'delivery'].includes(ticketType);

  return (
    <div className="rounded-xl border border-[color:var(--ui-border)] bg-slate-900 p-4 lg:sticky lg:top-4">
      <p className="text-xs font-semibold text-[var(--ui-muted)] uppercase tracking-wide mb-2">
        Vista previa del ticket
      </p>

      <div className="flex flex-wrap gap-1.5 mb-3" role="tablist" aria-label="Tipo de ticket">
        {previewTypes.map((t) => {
          const active = ticketType === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTicketType(t.id)}
              className={`px-2 py-1 rounded-md text-[10px] sm:text-xs font-semibold border transition-colors ${
                active
                  ? 'bg-emerald-600/90 text-white border-emerald-500'
                  : 'bg-slate-800 text-slate-300 border-slate-600 hover:bg-slate-700'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <p className="text-[10px] text-slate-400 mb-2">{activeMeta.hint}</p>

      {welcome ? (
        <p className="text-[10px] text-amber-200/90 mb-2 border border-amber-500/30 rounded px-2 py-1">
          {welcome}
        </p>
      ) : null}

      <pre className="text-[11px] leading-tight text-emerald-100 font-mono whitespace-pre-wrap break-words max-h-[420px] overflow-y-auto">
        {previewText}
      </pre>

      {showPromoBelow ? (
        <p className="text-[10px] text-sky-200/90 mt-2 border border-sky-500/30 rounded px-2 py-1">
          {promo}
        </p>
      ) : null}

      <p className="text-[10px] ui-text-muted mt-2">
        Ancho simulado: {widthMm} mm · Mismo formato que impresión · Los cambios se reflejan al escribir.
      </p>
    </div>
  );
}
