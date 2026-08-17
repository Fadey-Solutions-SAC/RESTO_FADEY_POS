import { useRef, useState } from 'react';
import { formatCurrency, formatDate, formatTime, parseApiDate, api } from '../../utils/api';
import { salesAccountClienteLabel } from '../../utils/salesReportExport';
import { UI_BADGE } from '../../utils/uiBadges';
import i18n from '../../i18n';
import Modal from '../Modal';
import toast from 'react-hot-toast';

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
  const saleNum = Number(order?.sale_number || 0);
  const noteNumber = saleNum > 0
    ? `001-${String(saleNum).padStart(8, '0')}`
    : `001-${String(order?.order_number || 0).padStart(8, '0')}`;
  const fullNumber = order?.document?.full_number || order?.sale_document_number || noteNumber;
  return { doc_type: docType, full_number: fullNumber };
}

/** Un comprobante por cuenta de venta. Las comandas no son notas/boletas/facturas. */
export function getAccountDocument(group) {
  const orders = group?.orders?.length ? group.orders : (group?.primary ? [group.primary] : []);
  const primary = group?.primary || orders[0];
  if (!primary) return { doc_type: 'nota_venta', full_number: '' };

  const billed = orders.find((o) => String(o?.document?.full_number || '').trim());
  if (billed) {
    return {
      doc_type: billed.document?.doc_type || billed.sale_document_type || 'nota_venta',
      full_number: billed.document.full_number,
    };
  }

  const saleNums = orders.map((o) => Number(o.sale_number || 0)).filter((n) => n > 0);
  const saleNum = saleNums.length ? Math.min(...saleNums) : 0;
  const docType = primary.sale_document_type || primary.document?.doc_type || 'nota_venta';
  const uniqueDocs = [...new Set(
    orders.map((o) => String(o.sale_document_number || '').trim()).filter(Boolean),
  )];

  if (uniqueDocs.length === 1) {
    return { doc_type: docType, full_number: uniqueDocs[0] };
  }
  if (saleNum > 0) {
    return { doc_type: docType, full_number: `001-${String(saleNum).padStart(8, '0')}` };
  }
  return getOrderDocument(primary);
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
  onPurged,
  sortKey,
  sortDir,
  onSort,
}) {
  const colSpan = (isVoidedTab ? 8 : 9) + (showActions ? 1 : 0);
  const obsTapRef = useRef({ key: '', count: 0, timer: null });
  const [purgeGroup, setPurgeGroup] = useState(null);
  const [purgePin, setPurgePin] = useState('');
  const [purgeBusy, setPurgeBusy] = useState(false);

  const closePurgeModal = () => {
    if (purgeBusy) return;
    setPurgeGroup(null);
    setPurgePin('');
  };

  const confirmPurgeSale = async () => {
    const pwd = String(purgePin || '').trim();
    if (!pwd) {
      toast.error('Ingrese la contraseña');
      return;
    }
    const ids = (purgeGroup?.orders || []).map((o) => o.id).filter(Boolean);
    if (!ids.length) {
      toast.error('No se encontró la venta');
      return;
    }
    setPurgeBusy(true);
    try {
      await api.post('/orders/purge-from-system', { pin: pwd, order_ids: ids });
      toast.success('Venta eliminada del sistema');
      setPurgeGroup(null);
      setPurgePin('');
      onPurged?.();
    } catch (err) {
      toast.error(err.message || 'No se pudo eliminar la venta');
    } finally {
      setPurgeBusy(false);
    }
  };

  const handleObservedClick = (group) => {
    const key = group?.key || group?.primary?.id || '';
    if (obsTapRef.current.key !== key) {
      obsTapRef.current = { key, count: 1, timer: null };
    } else {
      obsTapRef.current.count += 1;
    }
    clearTimeout(obsTapRef.current.timer);
    if (obsTapRef.current.count >= 3) {
      obsTapRef.current = { key: '', count: 0, timer: null };
      setPurgePin('');
      setPurgeGroup(group);
      return;
    }
    obsTapRef.current.timer = setTimeout(() => {
      const taps = obsTapRef.current.count;
      obsTapRef.current = { key: '', count: 0, timer: null };
      if (taps >= 1) onStatusClick?.(group);
    }, 700);
  };

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
            const doc = getAccountDocument(group);
            const mesero = o.created_by_user_name || o.customer_name || '-';
            const auditBadge = getAccountAuditStatusBadge(group);
            const isPendingMesa = Boolean(group.isPendingAccount && group.isMesa);
            const isCuentaMesa = Boolean(group.isMesa && (group.isSalesAccount || group.isPendingAccount));
            const comandaCount = (group.orders || []).length;
            const latest = parseApiDate(group.latestAt);
            const earliest = parseApiDate(group.earliestAt);
            const sameDay = comandaCount === 1
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
                        {comandaCount > 1 && !sameDay
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
                  {isPendingMesa ? (
                    <>
                      <p className="font-medium text-[var(--ui-body-text)]">Cuenta mesa</p>
                      <p className="text-xs text-[var(--ui-muted)]">Sin cobrar</p>
                    </>
                  ) : (
                    <>
                      <p className="font-medium text-[var(--ui-body-text)]">{docLabel(doc.doc_type)}</p>
                      <p className="text-xs text-[var(--ui-muted)]">{doc.full_number}</p>
                      {isCuentaMesa && comandaCount > 1 ? (
                        <p className="text-[10px] text-[var(--ui-muted)]">{comandaCount} comandas de producción</p>
                      ) : null}
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
                      onClick={() => handleObservedClick(group)}
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
      <Modal isOpen={!!purgeGroup} onClose={closePurgeModal} title="Eliminar venta del sistema" size="sm">
        <div className="space-y-4">
          <p className="text-sm ui-text-muted">
            Esta venta se eliminará de todo el sistema. Ingrese la contraseña para confirmar.
          </p>
          <div>
            <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Contraseña</label>
            <input
              type="password"
              value={purgePin}
              onChange={(e) => setPurgePin(e.target.value)}
              className="input-field"
              autoFocus
              disabled={purgeBusy}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void confirmPurgeSale();
              }}
            />
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={closePurgeModal} className="btn-secondary flex-1" disabled={purgeBusy}>
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void confirmPurgeSale()}
              className="btn-primary flex-1 bg-red-600 hover:bg-red-700"
              disabled={purgeBusy}
            >
              {purgeBusy ? 'Eliminando…' : 'Eliminar'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
