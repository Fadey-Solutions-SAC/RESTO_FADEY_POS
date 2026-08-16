import { formatCurrency, formatDate, formatTime, parseApiDate } from '../../utils/api';
import { salesAccountClienteLabel } from '../../utils/salesReportExport';
import { UI_BADGE } from '../../utils/uiBadges';
import i18n from '../../i18n';

export function getAccountAuditStatusBadge(group) {
  const orders = group?.orders || [];
  if (orders.length > 0 && orders.every((o) => o.status === 'cancelled')) {
    return { label: 'Anulada', className: `${UI_BADGE.red} uppercase tracking-wide`, clickable: false };
  }
  if (orders.some((o) => o.status !== 'cancelled' && String(o.payment_status || 'pending') === 'pending')) {
    return { label: 'Pendiente', className: `${UI_BADGE.amber} uppercase tracking-wide`, clickable: false };
  }
  if (group?.isSalesAccount && group.salesOrderCount === 0 && group.courtesyCount > 0) {
    return { label: 'Cortesía', className: `${UI_BADGE.violet} uppercase tracking-wide`, clickable: false };
  }
  const observations = group?.observations;
  if (observations?.observed) {
    return {
      label: 'Observado',
      className: `${UI_BADGE.amber} uppercase tracking-wide cursor-pointer hover:opacity-90 underline-offset-2 hover:underline`,
      clickable: true,
    };
  }
  return { label: 'Correcto', className: `${UI_BADGE.emerald} uppercase tracking-wide`, clickable: false };
}

export function docLabel(docType) {
  if (!docType) return '';
  const key = `docTypes.${docType}`;
  const tr = i18n.t(key, { ns: 'sales', defaultValue: '' });
  return tr || docType;
}

export function getOrderDocument(order) {
  const docType = order?.sale_document_type || order?.document?.doc_type || 'nota_venta';
  const noteNumber = `001-${String(order?.order_number || 0).padStart(8, '0')}`;
  const fullNumber = order?.sale_document_number || order?.document?.full_number || noteNumber;
  return { doc_type: docType, full_number: fullNumber };
}

function SortableTh({ label, colKey, sortKey, sortDir, onSort }) {
  if (!onSort) {
    return <th className="pb-2 font-medium">{label}</th>;
  }
  const active = sortKey === colKey;
  return (
    <th
      className="pb-2 font-medium cursor-pointer select-none hover:text-[var(--ui-body-text)]"
      onClick={() => onSort(colKey)}
      title={active ? (sortDir === 'asc' ? 'Orden ascendente' : 'Orden descendente') : `Ordenar por ${label}`}
    >
      {label}
      {active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
    </th>
  );
}

/** Tabla de cuentas de venta (mismo diseño en Ventas e Informes). */
export default function VentasCuentasTable({
  groups = [],
  emptyMessage = 'Sin ventas encontradas',
  isVoidedTab = false,
  showActions = false,
  renderActions,
  onStatusClick,
  sortKey,
  sortDir,
  onSort,
}) {
  const colSpan = (isVoidedTab ? 8 : 9) + (showActions ? 1 : 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[var(--ui-muted)] border-b border-[color:var(--ui-border)]">
            <SortableTh label="Fecha" colKey="fecha" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortableTh label="Mesa" colKey="mesa" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <th className="pb-2 font-medium">Caja</th>
            <th className="pb-2 font-medium">Mesero</th>
            <th className="pb-2 font-medium">Cliente</th>
            <th className="pb-2 font-medium">Documento</th>
            {!isVoidedTab ? <th className="pb-2 font-medium">Pagos</th> : null}
            <SortableTh
              label={isVoidedTab ? 'Monto ref.' : 'Venta'}
              colKey="venta"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
            />
            <th className="pb-2 font-medium">Estado</th>
            {showActions ? <th className="pb-2 font-medium">Opciones</th> : null}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const o = group.primary || {};
            const doc = getOrderDocument(o);
            const mesero = o.created_by_user_name || o.customer_name || '-';
            const auditBadge = getAccountAuditStatusBadge(group);
            const isPendingMesa = Boolean(group.isPendingAccount && group.isMesa);
            const isCuentaMesa = Boolean(group.isMesa && (group.isSalesAccount || group.isPendingAccount));
            const latest = parseApiDate(group.latestAt);
            const earliest = parseApiDate(group.earliestAt);
            const sameDay = group.comprobanteCount === 1
              || (latest && earliest && formatDate(group.latestAt) === formatDate(group.earliestAt));
            return (
              <tr key={group.key} className="border-b border-[color:var(--ui-border)] hover:bg-[var(--ui-sidebar-hover)]">
                <td className="py-2.5">
                  {isPendingMesa ? (
                    <p className="font-medium text-[var(--ui-muted)]">—</p>
                  ) : (
                    <>
                      <p className="font-medium text-[var(--ui-body-text)]">{formatDate(group.latestAt)}</p>
                      <p className="text-xs text-[var(--ui-muted)]">
                        {group.comprobanteCount > 1 && !sameDay
                          ? `${formatTime(group.earliestAt)} – ${formatTime(group.latestAt)}`
                          : formatTime(group.latestAt)}
                      </p>
                    </>
                  )}
                </td>
                <td className="py-2.5 text-[var(--ui-body-text)] font-semibold">{group.mesaLabel}</td>
                <td className="py-2.5 text-[var(--ui-muted)]">Caja 01</td>
                <td className="py-2.5 text-[var(--ui-body-text)]">{mesero}</td>
                <td className="py-2.5 text-[var(--ui-body-text)]">
                  {isPendingMesa ? '—' : salesAccountClienteLabel(o)}
                </td>
                <td className="py-2.5">
                  {isCuentaMesa ? (
                    <>
                      <p className="font-medium text-[var(--ui-body-text)]">Cuenta mesa</p>
                      {!isPendingMesa && group.comprobanteCount > 1 ? (
                        <p className="text-xs text-[var(--ui-muted)]">{group.comprobanteCount} comandas cobradas</p>
                      ) : isPendingMesa ? (
                        <p className="text-xs text-[var(--ui-muted)]">Sin cobrar</p>
                      ) : (
                        <p className="text-xs text-[var(--ui-muted)]">{docLabel(doc.doc_type)} · {doc.full_number}</p>
                      )}
                    </>
                  ) : group.comprobanteCount > 1 ? (
                    <>
                      <p className="font-medium text-[var(--ui-body-text)]">{group.comprobanteCount} documentos</p>
                      <p className="text-xs text-[var(--ui-muted)]">{docLabel(doc.doc_type)} · {doc.full_number}…</p>
                    </>
                  ) : (
                    <>
                      <p className="font-medium text-[var(--ui-body-text)]">{docLabel(doc.doc_type)}</p>
                      <p className="text-xs text-[var(--ui-muted)]">{doc.full_number}</p>
                    </>
                  )}
                </td>
                {!isVoidedTab ? (
                  <td className="py-2.5 font-medium text-[var(--ui-body-text)] text-xs leading-relaxed">
                    {group.paymentSummary || '-'}
                  </td>
                ) : null}
                <td className="py-2.5 font-bold text-[var(--ui-body-text)]">{formatCurrency(group.total)}</td>
                <td className="py-2.5">
                  {auditBadge.clickable ? (
                    <button
                      type="button"
                      onClick={() => onStatusClick?.(group)}
                      className={auditBadge.className}
                      title="Ver en Descuentos y Cortesías"
                    >
                      {auditBadge.label}
                    </button>
                  ) : (
                    <span className={auditBadge.className}>{auditBadge.label}</span>
                  )}
                </td>
                {showActions ? (
                  <td className="py-2.5">{renderActions?.(group, o)}</td>
                ) : null}
              </tr>
            );
          })}
          {groups.length === 0 && (
            <tr>
              <td colSpan={colSpan} className="py-8 text-center text-[var(--ui-muted)]">{emptyMessage}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
