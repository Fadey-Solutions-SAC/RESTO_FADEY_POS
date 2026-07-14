import { useState, useEffect, useMemo, useRef } from 'react';
import { api, formatCurrency, formatDateTime } from '../../utils/api';
import {
  formatMesaLabel,
  parseAdjustmentReason,
  adjustmentReferenceAmount,
  adjustmentAmountCharged,
  isCourtesyOrder,
} from '../../utils/mesaOrderLines';
import { MdVolunteerActivism, MdSearch, MdRefresh, MdLocalOffer, MdDelete, MdRemoveCircleOutline, MdVisibility } from 'react-icons/md';
import Modal from '../../components/Modal';
import { adjustmentKindBadge } from '../../utils/uiBadges';
import toast from 'react-hot-toast';

function toInputDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function kindLabel(kind) {
  if (kind === 'cortesia') return 'Cortesía';
  if (kind === 'descuento') return 'Descuento';
  if (kind === 'eliminado') return 'Eliminado';
  return '—';
}

function kindBadgeClass(kind) {
  return adjustmentKindBadge(kind);
}

function rowReason(o) {
  if (o.adjustment_kind === 'eliminado') {
    return String(o.adjustment_reason || o.removal_reason || '').trim() || 'Sin motivo registrado';
  }
  return parseAdjustmentReason(o) || 'Sin motivo registrado';
}

function rowProductLine(o) {
  if (o.adjustment_kind === 'eliminado') {
    const it = (o.items || [])[0];
    if (!it) return o.product_name || '—';
    return `${Number(it.quantity || 0)}× ${it.product_name} · ${formatCurrency(it.unit_price || 0)} c/u`;
  }
  const items = o.items || [];
  return items.map((it) => `${it.quantity}× ${it.product_name}`).join(', ');
}

const HIGHLIGHT_ROW_CLASS = 'bg-amber-100/90 ring-2 ring-inset ring-amber-400 transition-colors duration-500';

export default function CortesiasReportSection({
  highlightRecordIds = [],
  highlightFrom = '',
  highlightTo = '',
  onHighlightClear,
}) {
  const [fromDate, setFromDate] = useState(() => {
    const t = new Date();
    t.setDate(t.getDate() - 30);
    return toInputDate(t);
  });
  const [toDate, setToDate] = useState(() => toInputDate(new Date()));
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({
    summary: {
      count: 0,
      courtesy_count: 0,
      discount_count: 0,
      courtesy_reference_total: 0,
      discount_amount_total: 0,
      amount_charged_total: 0,
    },
    orders: [],
  });
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [detailTarget, setDetailTarget] = useState(null);
  const [adminPassword, setAdminPassword] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [activeHighlightIds, setActiveHighlightIds] = useState(() => new Set());
  const highlightTimerRef = useRef(null);

  useEffect(() => {
    if (highlightFrom) setFromDate(highlightFrom);
    if (highlightTo) setToDate(highlightTo);
  }, [highlightFrom, highlightTo]);

  useEffect(() => {
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = null;
    }
    const ids = (highlightRecordIds || []).map(String).filter(Boolean);
    if (!ids.length) {
      setActiveHighlightIds(new Set());
      return undefined;
    }
    setActiveHighlightIds(new Set(ids));
    const scrollTimer = window.setTimeout(() => {
      const first = document.getElementById(`adjustment-row-${ids[0]}`);
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 250);
    highlightTimerRef.current = window.setTimeout(() => {
      setActiveHighlightIds(new Set());
      onHighlightClear?.();
      highlightTimerRef.current = null;
    }, 20000);
    return () => {
      window.clearTimeout(scrollTimer);
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = null;
      }
    };
  }, [highlightRecordIds, data.orders, onHighlightClear]);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);
      const res = await api.get(`/reports/sales-adjustments?${params.toString()}`);
      setData({
        summary: res?.summary || {},
        orders: Array.isArray(res?.orders) ? res.orders : [],
      });
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'No se pudo cargar el informe');
      setData({ summary: {}, orders: [] });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [fromDate, toDate]);

  const confirmDeleteAdjustment = async () => {
    if (!deleteTarget) return;
    const pwd = String(adminPassword || '').trim();
    if (!pwd) return toast.error('Ingrese la contraseña de administrador');
    setDeleteBusy(true);
    try {
      await api.delete(`/reports/sales-adjustments/${deleteTarget.id}`, { admin_password: pwd });
      toast.success('Registro eliminado');
      setDeleteTarget(null);
      setAdminPassword('');
      await load();
    } catch (err) {
      toast.error(err.message || 'No se pudo eliminar');
    } finally {
      setDeleteBusy(false);
    }
  };

  const filtered = useMemo(() => {
    let rows = data.orders;
    if (kindFilter === 'cortesia') rows = rows.filter((o) => o.adjustment_kind === 'cortesia');
    if (kindFilter === 'descuento') rows = rows.filter((o) => o.adjustment_kind === 'descuento');
    if (kindFilter === 'eliminado') rows = rows.filter((o) => o.adjustment_kind === 'eliminado');
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((o) => {
      const reason = rowReason(o).toLowerCase();
      const mesa = String(o.table_number || '').toLowerCase();
      const mesero = String(o.created_by_user_name || o.customer_name || '').toLowerCase();
      const num = String(o.order_number || '');
      const kind = kindLabel(o.adjustment_kind).toLowerCase();
      const productLine = rowProductLine(o).toLowerCase();
      return reason.includes(q) || mesa.includes(q) || mesero.includes(q) || num.includes(q) || kind.includes(q) || productLine.includes(q);
    });
  }, [data.orders, search, kindFilter]);

  const filteredSummary = useMemo(() => {
    let courtesyCount = 0;
    let discountCount = 0;
    let courtesyReference = 0;
    let discountAmount = 0;
    let amountCharged = 0;
    let eliminadoCount = 0;
    let eliminadoReference = 0;
    for (const o of filtered) {
      const kind = o.adjustment_kind;
      const ref = adjustmentReferenceAmount(o);
      const charged = adjustmentAmountCharged(o);
      if (kind === 'cortesia') {
        courtesyCount += 1;
        courtesyReference += ref;
      } else if (kind === 'descuento') {
        discountCount += 1;
        discountAmount += ref;
        amountCharged += charged;
      } else if (kind === 'eliminado') {
        eliminadoCount += 1;
        eliminadoReference += Number(o.reference_amount ?? o.discount_amount ?? ref ?? 0);
      }
    }
    return {
      count: filtered.length,
      courtesy_count: courtesyCount,
      discount_count: discountCount,
      eliminado_count: eliminadoCount,
      courtesy_reference_total: courtesyReference,
      discount_amount_total: discountAmount,
      eliminado_reference_total: eliminadoReference,
      amount_charged_total: amountCharged,
    };
  }, [filtered]);

  if (loading && !data.orders.length) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="animate-spin w-8 h-8 border-4 border-violet-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="card border-l-4 border-l-violet-500">
          <p className="text-xs ui-text-muted">Registros totales</p>
          <p className="text-2xl font-bold text-[var(--ui-body-text)]">{filteredSummary.count}</p>
          <p className="text-xs text-[var(--ui-muted)] mt-1">
            {filteredSummary.courtesy_count} cortesías · {filteredSummary.discount_count} descuentos · {filteredSummary.eliminado_count} eliminados
          </p>
        </div>
        <div className="card border-l-4 border-l-amber-500">
          <p className="text-xs ui-text-muted">Valor descontado / referencia</p>
          <p className="text-2xl font-bold text-amber-600">
            {formatCurrency(filteredSummary.courtesy_reference_total + filteredSummary.discount_amount_total)}
          </p>
          <p className="text-xs text-[var(--ui-muted)] mt-1">Informativo; no suma como ingreso extra</p>
        </div>
        <div className="card border-l-4 border-l-emerald-500">
          <p className="text-xs ui-text-muted">Cobrado (solo descuentos parciales)</p>
          <p className="text-2xl font-bold text-emerald-600">{formatCurrency(filteredSummary.amount_charged_total)}</p>
          <p className="text-xs text-[var(--ui-muted)] mt-1">Cortesías cobran S/ 0.00</p>
        </div>
        <div className="card border-l-4 border-l-red-500">
          <p className="text-xs ui-text-muted">Productos eliminados (valor)</p>
          <p className="text-2xl font-bold text-red-600">{formatCurrency(filteredSummary.eliminado_reference_total)}</p>
          <p className="text-xs text-[var(--ui-muted)] mt-1">{filteredSummary.eliminado_count} registro(s) de baja en mesa</p>
        </div>
      </div>

      <div className="card mb-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs ui-text-muted block mb-1">Desde</label>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="input-field" />
          </div>
          <div>
            <label className="text-xs ui-text-muted block mb-1">Hasta</label>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="input-field" />
          </div>
          <div>
            <label className="text-xs ui-text-muted block mb-1">Tipo</label>
            <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} className="input-field">
              <option value="all">Todos</option>
              <option value="cortesia">Cortesías</option>
              <option value="descuento">Descuentos</option>
              <option value="eliminado">Eliminados</option>
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs ui-text-muted block mb-1">Buscar</label>
            <div className="relative">
              <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ui-muted)]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Motivo, mesa, mesero, N° pedido…"
                className="input-field pl-9 w-full"
              />
            </div>
          </div>
          <button type="button" onClick={load} className="btn-secondary flex items-center gap-2">
            <MdRefresh /> Actualizar
          </button>
        </div>
        <p className="text-xs text-[var(--ui-muted)] mt-3">
          Cortesías y descuentos descuentan inventario al cobrar (el producto sí se entregó). Los eliminados de mesa no afectan inventario.
        </p>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--ui-muted)] border-b border-[color:var(--ui-border)]">
              <th className="py-2 pr-3 font-medium">Fecha</th>
              <th className="py-2 pr-3 font-medium">Tipo</th>
              <th className="py-2 pr-3 font-medium">Pedido</th>
              <th className="py-2 pr-3 font-medium">Mesa / canal</th>
              <th className="py-2 pr-3 font-medium">Registró</th>
              <th className="py-2 pr-3 font-medium">Motivo</th>
              <th className="py-2 pr-3 font-medium">Productos</th>
              <th className="py-2 pr-3 font-medium text-right">Precio / valor</th>
              <th className="py-2 pr-3 font-medium text-right">Cobrado</th>
              <th className="py-2 font-medium text-center">Inventario</th>
              <th className="py-2 font-medium text-center">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((o) => {
              const productLine = rowProductLine(o);
              const channel = o.type === 'dine_in'
                ? (o.table_number ? `Mesa ${o.table_number}` : 'Salón')
                : o.type === 'delivery'
                  ? 'Delivery'
                  : 'Mostrador';
              const kind = o.adjustment_kind;
              const reason = rowReason(o);
              const isCourtesy = kind === 'cortesia' || isCourtesyOrder(o);
              const isEliminado = kind === 'eliminado';
              const refAmount = isEliminado
                ? Number(o.reference_amount ?? o.discount_amount ?? 0)
                : adjustmentReferenceAmount(o);
              return (
                <tr
                  key={o.id}
                  id={`adjustment-row-${o.id}`}
                  className={`border-b border-[color:var(--ui-border)] hover:bg-[var(--ui-sidebar-hover)] ${
                    activeHighlightIds.has(String(o.id)) ? HIGHLIGHT_ROW_CLASS : ''
                  }`}
                >
                  <td className="py-2.5 pr-3 whitespace-nowrap">{formatDateTime(o.updated_at || o.created_at)}</td>
                  <td className="py-2.5 pr-3">
                    <span className={kindBadgeClass(kind)}>
                      {isEliminado ? (
                        <MdRemoveCircleOutline className="shrink-0" />
                      ) : isCourtesy ? (
                        <MdVolunteerActivism className="shrink-0" />
                      ) : (
                        <MdLocalOffer className="shrink-0" />
                      )}
                      {kindLabel(kind)}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 font-medium">{o.order_number ? `#${o.order_number}` : '—'}</td>
                  <td className="py-2.5 pr-3">
                    {o.type === 'dine_in' && o.table_number ? formatMesaLabel(o.table_number) : channel}
                  </td>
                  <td className="py-2.5 pr-3">{o.created_by_user_name || o.customer_name || '—'}</td>
                  <td className="py-2.5 pr-3 max-w-[220px]">
                    {isEliminado ? (
                      <button
                        type="button"
                        onClick={() => setDetailTarget(o)}
                        className="text-xs text-[#3B82F6] hover:underline inline-flex items-center gap-1"
                      >
                        <MdVisibility className="text-sm" /> Observar motivo
                      </button>
                    ) : (
                      reason
                    )}
                  </td>
                  <td className="py-2.5 pr-3 max-w-[260px] truncate" title={productLine}>{productLine || '—'}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-amber-600">
                    {formatCurrency(refAmount)}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums font-semibold text-emerald-600">
                    {isEliminado ? '—' : formatCurrency(adjustmentAmountCharged(o))}
                  </td>
                  <td className="py-2.5 text-center">
                    {isEliminado ? (
                      <span className="text-xs text-[var(--ui-muted)]">—</span>
                    ) : o.kardex_applied ? (
                      <span className="text-xs text-emerald-600">OK</span>
                    ) : (
                      <span className="text-xs text-[var(--ui-muted)]">Sin receta</span>
                    )}
                  </td>
                  <td className="py-2.5 text-center">
                    <div className="inline-flex items-center gap-1">
                      {isEliminado ? (
                        <button
                          type="button"
                          onClick={() => setDetailTarget(o)}
                          className="p-1.5 rounded-lg text-[var(--ui-muted)] hover:bg-sky-50 hover:text-sky-600"
                          title="Observar eliminación"
                        >
                          <MdVisibility />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => { setDeleteTarget(o); setAdminPassword(''); }}
                        className="p-1.5 rounded-lg text-[var(--ui-muted)] hover:bg-red-50 hover:text-red-600"
                        title="Eliminar registro"
                      >
                        <MdDelete />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={11} className="py-10 text-center text-[var(--ui-muted)]">
                  No hay descuentos, cortesías ni eliminaciones en el periodo seleccionado
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal
        isOpen={!!detailTarget}
        onClose={() => setDetailTarget(null)}
        title="Producto eliminado de mesa"
        size="md"
      >
        {detailTarget?.adjustment_kind === 'eliminado' && (() => {
          const it = (detailTarget.items || [])[0];
          const mesaLabel = detailTarget.type === 'dine_in' && detailTarget.table_number
            ? formatMesaLabel(detailTarget.table_number)
            : detailTarget.type === 'delivery'
              ? 'Delivery'
              : 'Mostrador';
          const motivo = rowReason(detailTarget);
          const refAmount = Number(detailTarget.reference_amount ?? detailTarget.discount_amount ?? 0);
          return (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={kindBadgeClass('eliminado')}>
                  <MdRemoveCircleOutline /> {kindLabel('eliminado')}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border border-[color:var(--ui-border)] p-3">
                  <p className="text-xs text-[var(--ui-muted)] mb-1">Fecha y hora</p>
                  <p className="font-medium">{formatDateTime(detailTarget.updated_at || detailTarget.created_at)}</p>
                </div>
                <div className="rounded-lg border border-[color:var(--ui-border)] p-3">
                  <p className="text-xs text-[var(--ui-muted)] mb-1">Mesa / canal</p>
                  <p className="font-medium">{mesaLabel}</p>
                </div>
                <div className="rounded-lg border border-[color:var(--ui-border)] p-3 sm:col-span-2">
                  <p className="text-xs text-[var(--ui-muted)] mb-1">Producto</p>
                  <p className="font-semibold text-[var(--ui-body-text)]">
                    {it ? `${Number(it.quantity || 0)}× ${it.product_name}` : '—'}
                  </p>
                  {it ? (
                    <p className="text-xs text-[var(--ui-muted)] mt-1">
                      Precio unitario: {formatCurrency(it.unit_price || 0)} · Total línea: {formatCurrency(refAmount)}
                    </p>
                  ) : null}
                </div>
                <div className="rounded-lg border border-red-200 bg-red-50/80 p-3 sm:col-span-2">
                  <p className="text-xs text-red-700 font-medium mb-1">Motivo de eliminación</p>
                  <p className="text-sm text-red-900 whitespace-pre-wrap leading-relaxed">{motivo}</p>
                </div>
                <div className="rounded-lg border border-[color:var(--ui-border)] p-3">
                  <p className="text-xs text-[var(--ui-muted)] mb-1">Registró</p>
                  <p className="font-medium">{detailTarget.created_by_user_name || '—'}</p>
                </div>
                <div className="rounded-lg border border-[color:var(--ui-border)] p-3">
                  <p className="text-xs text-[var(--ui-muted)] mb-1">Pedido</p>
                  <p className="font-medium">{detailTarget.order_number ? `#${detailTarget.order_number}` : '—'}</p>
                </div>
              </div>
              <button type="button" onClick={() => setDetailTarget(null)} className="btn-secondary w-full">
                Cerrar
              </button>
            </div>
          );
        })()}
      </Modal>

      <Modal isOpen={!!deleteTarget} onClose={() => { if (!deleteBusy) { setDeleteTarget(null); setAdminPassword(''); } }} title="Eliminar registro" size="sm">
        <div className="space-y-4">
          <p className="text-sm ui-text-muted">
            {deleteTarget?.adjustment_kind === 'eliminado'
              ? `Se eliminará el registro de producto eliminado «${(deleteTarget?.items?.[0]?.product_name) || '—'}».`
              : `Se eliminará el pedido #${deleteTarget?.order_number} (${kindLabel(deleteTarget?.adjustment_kind)}).`}
            {' '}Ingrese la contraseña de un administrador para confirmar.
          </p>
          <div>
            <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Contraseña admin</label>
            <input
              type="password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              className="input-field"
              autoFocus
              disabled={deleteBusy}
            />
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={() => { setDeleteTarget(null); setAdminPassword(''); }} className="btn-secondary flex-1" disabled={deleteBusy}>Cancelar</button>
            <button type="button" onClick={() => void confirmDeleteAdjustment()} className="btn-primary flex-1 bg-red-600 hover:bg-red-700" disabled={deleteBusy}>
              {deleteBusy ? 'Eliminando…' : 'Eliminar'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
