/** Etiquetas de estado legibles en tema claro y oscuro (usar con clases `.ui-badge--*` en index.css). */
export const UI_BADGE = {
  violet: 'ui-badge ui-badge--violet',
  red: 'ui-badge ui-badge--red',
  amber: 'ui-badge ui-badge--amber',
  emerald: 'ui-badge ui-badge--emerald',
  sky: 'ui-badge ui-badge--sky',
  blue: 'ui-badge ui-badge--blue',
  slate: 'ui-badge ui-badge--slate',
  orange: 'ui-badge ui-badge--orange',
  indigo: 'ui-badge ui-badge--indigo',
  purple: 'ui-badge ui-badge--purple',
};

export function adjustmentKindBadge(kind) {
  if (kind === 'cortesia') return UI_BADGE.violet;
  if (kind === 'eliminado') return UI_BADGE.red;
  if (kind === 'descuento') return UI_BADGE.amber;
  return UI_BADGE.slate;
}

export function paymentStatusBadge(status) {
  const ps = String(status || 'pending');
  if (ps === 'paid') return UI_BADGE.emerald;
  if (ps === 'refunded') return UI_BADGE.orange;
  return UI_BADGE.amber;
}

export function saleStatusBadge(order) {
  if (order?.status === 'cancelled') return { label: 'Anulada', className: UI_BADGE.red };
  if (String(order?.payment_method || '').trim().toLowerCase() === 'cortesia') {
    return { label: 'Cortesía', className: UI_BADGE.violet };
  }
  const ps = String(order?.payment_status || 'pending');
  const label = ps === 'paid' ? 'Pagado' : ps === 'pending' ? 'Pendiente' : ps === 'refunded' ? 'Reembolsado' : ps;
  return { label, className: paymentStatusBadge(ps) };
}
