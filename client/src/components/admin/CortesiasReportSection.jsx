import { useState, useEffect, useMemo, useRef } from 'react';
import { api, formatCurrency, formatDateTime } from '../../utils/api';
import { downloadBlobFile } from '../../utils/inventoryCuadreExport';
import {
  formatMesaLabel,
  parseAdjustmentReason,
  adjustmentReferenceAmount,
} from '../../utils/mesaOrderLines';
import {
  buildSalesAdjustmentsCsv,
  buildSalesAdjustmentsTxt,
  buildSalesAdjustmentsDownloadBaseName,
} from '../../utils/salesAdjustmentsExport';
import { MdVolunteerActivism, MdSearch, MdRefresh, MdLocalOffer, MdDelete, MdRemoveCircleOutline, MdVisibility, MdDownload } from 'react-icons/md';
import Modal from '../../components/Modal';
import { adjustmentKindBadge } from '../../utils/uiBadges';
import toast from 'react-hot-toast';

function toInputDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function localMonthStartYmd() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-01`;
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

function recordReferenceAmount(o) {
  if (o.adjustment_kind === 'eliminado') {
    return Number(o.reference_amount ?? o.discount_amount ?? 0);
  }
  return adjustmentReferenceAmount(o);
}

function expandToProductRows(orders) {
  const rows = [];
  for (const o of orders || []) {
    const reason = rowReason(o);
    const kind = o.adjustment_kind;
    const items = (o.items || []).length ? o.items : [{
      product_id: o.product_id,
      product_name: o.product_name || '—',
      quantity: o.quantity_removed || 0,
    }];
    for (const it of items) {
      rows.push({
        key: `${o.id}-${it.product_id || it.product_name}-${it.quantity}`,
        record: o,
        recordId: o.id,
        product_id: it.product_id,
        product_name: it.product_name || '—',
        quantity: Number(it.quantity ?? it.quantity_removed ?? 0),
        kind,
        reason,
        fecha: o.updated_at || o.created_at,
        order_number: o.order_number,
        table_number: o.table_number,
        type: o.type,
        created_by: o.created_by_user_name || o.customer_name || '',
        items,
      });
    }
  }
  return rows;
}

function mesaChannelLabel(row) {
  if (row.type === 'dine_in' && row.table_number) {
    return formatMesaLabel(row.table_number);
  }
  if (row.type === 'delivery') return 'Delivery';
  return 'Mostrador';
}

const HIGHLIGHT_ROW_CLASS = 'bg-amber-100/90 ring-2 ring-inset ring-amber-400 transition-colors duration-500';

const KIND_FILTERS = [
  { id: 'all', label: 'Todos' },
  { id: 'cortesia', label: 'Cortesías' },
  { id: 'descuento', label: 'Descuentos' },
  { id: 'eliminado', label: 'Eliminados' },
];

export default function CortesiasReportSection({
  highlightRecordIds = [],
  highlightFrom = '',
  highlightTo = '',
  onHighlightClear,
}) {
  const [fromDate, setFromDate] = useState(localMonthStartYmd);
  const [toDate, setToDate] = useState(() => toInputDate(new Date()));
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({ summary: {}, orders: [] });
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [detailTarget, setDetailTarget] = useState(null);
  const [adminPassword, setAdminPassword] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [activeHighlightIds, setActiveHighlightIds] = useState(() => new Set());
  const highlightTimerRef = useRef(null);

  const datesValid = Boolean(fromDate && toDate && fromDate <= toDate);

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
    if (!datesValid) {
      setData({ summary: {}, orders: [] });
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ from: fromDate, to: toDate });
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

  const filteredOrders = useMemo(() => {
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
      const products = (o.items || []).map((it) => `${it.quantity}× ${it.product_name}`.toLowerCase()).join(' ');
      return reason.includes(q) || mesa.includes(q) || mesero.includes(q) || num.includes(q) || kind.includes(q) || products.includes(q);
    });
  }, [data.orders, search, kindFilter]);

  const productRows = useMemo(() => expandToProductRows(filteredOrders), [filteredOrders]);

  const referenceTotal = useMemo(() => {
    const seen = new Set();
    let total = 0;
    for (const o of filteredOrders) {
      const id = String(o.id);
      if (seen.has(id)) continue;
      seen.add(id);
      total += recordReferenceAmount(o);
    }
    return total;
  }, [filteredOrders]);

  const filteredSummary = useMemo(() => {
    let courtesyCount = 0;
    let discountCount = 0;
    let eliminadoCount = 0;
    for (const o of filteredOrders) {
      const kind = o.adjustment_kind;
      if (kind === 'cortesia') courtesyCount += 1;
      else if (kind === 'descuento') discountCount += 1;
      else if (kind === 'eliminado') eliminadoCount += 1;
    }
    return {
      count: filteredOrders.length,
      courtesy_count: courtesyCount,
      discount_count: discountCount,
      eliminado_count: eliminadoCount,
      product_lines: productRows.length,
    };
  }, [filteredOrders, productRows.length]);

  const downloadReport = (format = 'csv') => {
    if (!productRows.length) {
      toast.error('No hay productos para descargar en el periodo seleccionado');
      return;
    }
    const payload = {
      fromDate,
      toDate,
      kindFilter,
      productRows,
      referenceTotal,
      formatDateTime,
    };
    const baseName = buildSalesAdjustmentsDownloadBaseName(fromDate, toDate, kindFilter);
    if (format === 'txt') {
      downloadBlobFile(`${baseName}.txt`, buildSalesAdjustmentsTxt(payload));
      toast.success('Informe descargado (TXT)');
      return;
    }
    downloadBlobFile(`${baseName}.csv`, buildSalesAdjustmentsCsv(payload), 'text/csv;charset=utf-8');
    toast.success('Informe descargado (CSV)');
  };

  if (loading && !data.orders.length) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="animate-spin w-8 h-8 border-4 border-violet-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="card border-l-4 border-l-violet-500">
          <p className="text-xs ui-text-muted">Cortesías</p>
          <p className="text-2xl font-bold text-violet-600">{filteredSummary.courtesy_count}</p>
          <p className="text-xs text-[var(--ui-muted)] mt-1">Registros en el periodo</p>
        </div>
        <div className="card border-l-4 border-l-amber-500">
          <p className="text-xs ui-text-muted">Descuentos</p>
          <p className="text-2xl font-bold text-amber-600">{filteredSummary.discount_count}</p>
          <p className="text-xs text-[var(--ui-muted)] mt-1">Registros en el periodo</p>
        </div>
        <div className="card border-l-4 border-l-red-500">
          <p className="text-xs ui-text-muted">Eliminados</p>
          <p className="text-2xl font-bold text-red-600">{filteredSummary.eliminado_count}</p>
          <p className="text-xs text-[var(--ui-muted)] mt-1">Registros en el periodo</p>
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
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs ui-text-muted block mb-1">Buscar</label>
            <div className="relative">
              <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ui-muted)]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Producto, motivo, mesa, mesero, N° pedido…"
                className="input-field pl-9 w-full"
              />
            </div>
          </div>
          <button type="button" onClick={load} className="btn-secondary flex items-center gap-2" disabled={!datesValid}>
            <MdRefresh /> Actualizar
          </button>
          <button
            type="button"
            onClick={() => downloadReport('csv')}
            className="text-xs px-3 py-2 border border-[color:var(--ui-border)] rounded-lg inline-flex items-center gap-1"
            disabled={!productRows.length}
          >
            <MdDownload /> CSV
          </button>
          <button
            type="button"
            onClick={() => downloadReport('txt')}
            className="text-xs px-3 py-2 border border-[color:var(--ui-border)] rounded-lg inline-flex items-center gap-1"
            disabled={!productRows.length}
          >
            <MdDownload /> TXT
          </button>
        </div>
        {!datesValid && (
          <p className="text-xs text-red-600 mt-2">La fecha «Desde» no puede ser posterior a «Hasta».</p>
        )}
        <div className="flex flex-wrap gap-2 mt-4">
          {KIND_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setKindFilter(f.id)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                kindFilter === f.id
                  ? 'bg-[#3B82F6] text-white border-transparent'
                  : 'border-[color:var(--ui-border)] hover:bg-[var(--ui-sidebar-hover)]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-[var(--ui-muted)] mt-3">
          Cortesías y descuentos descuentan inventario al cobrar. Los eliminados de mesa no afectan inventario.
          El valor referencia es un total consolidado del periodo filtrado.
        </p>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--ui-muted)] border-b border-[color:var(--ui-border)]">
              <th className="py-2 pr-3 font-medium">Fecha</th>
              <th className="py-2 pr-3 font-medium">Tipo</th>
              <th className="py-2 pr-3 font-medium">Producto</th>
              <th className="py-2 pr-3 font-medium text-right">Cantidad</th>
              <th className="py-2 pr-3 font-medium">Mesa / pedido</th>
              <th className="py-2 pr-3 font-medium">Motivo</th>
              <th className="py-2 font-medium text-center">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {productRows.map((row) => {
              const isCourtesy = row.kind === 'cortesia';
              const isEliminado = row.kind === 'eliminado';
              return (
                <tr
                  key={row.key}
                  id={`adjustment-row-${row.recordId}`}
                  className={`border-b border-[color:var(--ui-border)] hover:bg-[var(--ui-sidebar-hover)] ${
                    activeHighlightIds.has(String(row.recordId)) ? HIGHLIGHT_ROW_CLASS : ''
                  }`}
                >
                  <td className="py-2.5 pr-3 whitespace-nowrap">{formatDateTime(row.fecha)}</td>
                  <td className="py-2.5 pr-3">
                    <span className={kindBadgeClass(row.kind)}>
                      {isEliminado ? (
                        <MdRemoveCircleOutline className="shrink-0" />
                      ) : isCourtesy ? (
                        <MdVolunteerActivism className="shrink-0" />
                      ) : (
                        <MdLocalOffer className="shrink-0" />
                      )}
                      {kindLabel(row.kind)}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 font-medium">{row.product_name}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums font-semibold text-[#3B82F6]">
                    {row.quantity}
                  </td>
                  <td className="py-2.5 pr-3">
                    <span className="block">{mesaChannelLabel(row)}</span>
                    {row.order_number ? (
                      <span className="text-xs text-[var(--ui-muted)]">Pedido #{row.order_number}</span>
                    ) : null}
                  </td>
                  <td className="py-2.5 pr-3">
                    <button
                      type="button"
                      onClick={() => setDetailTarget(row.record)}
                      className="text-xs text-[#3B82F6] hover:underline inline-flex items-center gap-1"
                    >
                      <MdVisibility className="text-sm" /> Ver motivo
                    </button>
                  </td>
                  <td className="py-2.5 text-center">
                    <button
                      type="button"
                      onClick={() => { setDeleteTarget(row.record); setAdminPassword(''); }}
                      className="p-1.5 rounded-lg text-[var(--ui-muted)] hover:bg-red-50 hover:text-red-600"
                      title="Eliminar registro"
                    >
                      <MdDelete />
                    </button>
                  </td>
                </tr>
              );
            })}
            {productRows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-10 text-center text-[var(--ui-muted)]">
                  {datesValid
                    ? 'No hay productos en el periodo y filtro seleccionados'
                    : 'Seleccione un rango de fechas válido'}
                </td>
              </tr>
            )}
          </tbody>
          {productRows.length > 0 && (
            <tfoot>
              <tr className="bg-[var(--ui-surface-2)] font-bold border-t border-[color:var(--ui-border)]">
                <td colSpan={7} className="py-3 px-3 text-right">
                  <span className="text-[var(--ui-body-text)]">
                    Total valor referencia ({filteredSummary.product_lines} línea{filteredSummary.product_lines === 1 ? '' : 's'}):{' '}
                  </span>
                  <span className="tabular-nums text-emerald-600">{formatCurrency(referenceTotal)}</span>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <Modal
        isOpen={!!detailTarget}
        onClose={() => setDetailTarget(null)}
        title="Detalle del registro"
        size="md"
      >
        {detailTarget && (() => {
          const kind = detailTarget.adjustment_kind;
          const mesaLabel = detailTarget.type === 'dine_in' && detailTarget.table_number
            ? formatMesaLabel(detailTarget.table_number)
            : detailTarget.type === 'delivery'
              ? 'Delivery'
              : 'Mostrador';
          const motivo = rowReason(detailTarget);
          const items = detailTarget.items || [];
          return (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={kindBadgeClass(kind)}>
                  {kind === 'eliminado' ? <MdRemoveCircleOutline /> : kind === 'cortesia' ? <MdVolunteerActivism /> : <MdLocalOffer />}
                  {' '}
                  {kindLabel(kind)}
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
                <div className="rounded-lg border border-[color:var(--ui-border)] p-3">
                  <p className="text-xs text-[var(--ui-muted)] mb-1">Registró</p>
                  <p className="font-medium">{detailTarget.created_by_user_name || detailTarget.customer_name || '—'}</p>
                </div>
                <div className="rounded-lg border border-[color:var(--ui-border)] p-3">
                  <p className="text-xs text-[var(--ui-muted)] mb-1">Pedido</p>
                  <p className="font-medium">{detailTarget.order_number ? `#${detailTarget.order_number}` : '—'}</p>
                </div>
              </div>
              <div className="rounded-lg border border-[color:var(--ui-border)] p-3">
                <p className="text-xs text-[var(--ui-muted)] mb-2 font-medium">Productos</p>
                {items.length ? (
                  <ul className="space-y-1.5">
                    {items.map((it, idx) => (
                      <li key={`${it.product_id || it.product_name}-${idx}`} className="text-sm">
                        <span className="font-semibold text-[var(--ui-body-text)]">
                          {Number(it.quantity ?? it.quantity_removed ?? 0)}× {it.product_name}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-[var(--ui-muted)]">Sin productos registrados</p>
                )}
              </div>
              <div className={`rounded-lg border p-3 sm:col-span-2 ${
                kind === 'eliminado' ? 'border-red-200 bg-red-50/80' : 'border-[color:var(--ui-border)] bg-[var(--ui-surface-2)]'
              }`}>
                <p className={`text-xs font-medium mb-1 ${kind === 'eliminado' ? 'text-red-700' : 'text-[var(--ui-muted)]'}`}>
                  Motivo
                </p>
                <p className={`text-sm whitespace-pre-wrap leading-relaxed ${kind === 'eliminado' ? 'text-red-900' : 'text-[var(--ui-body-text)]'}`}>
                  {motivo}
                </p>
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
