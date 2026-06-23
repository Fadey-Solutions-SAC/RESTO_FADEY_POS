import { useState, useEffect, useMemo } from 'react';
import { api, formatCurrency, formatDateTime } from '../../utils/api';
import {
  formatMesaLabel,
  parseAdjustmentReason,
  adjustmentReferenceAmount,
  adjustmentAmountCharged,
  isCourtesyOrder,
} from '../../utils/mesaOrderLines';
import { MdVolunteerActivism, MdSearch, MdRefresh, MdLocalOffer, MdInventory2 } from 'react-icons/md';
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
  return '—';
}

function kindBadgeClass(kind) {
  if (kind === 'cortesia') return 'bg-violet-500/15 text-violet-600 dark:text-violet-300 border-violet-400/30';
  return 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-400/30';
}

export default function CortesiasReportSection() {
  const [fromDate, setFromDate] = useState(() => {
    const t = new Date();
    t.setDate(t.getDate() - 30);
    return toInputDate(t);
  });
  const [toDate, setToDate] = useState(() => toInputDate(new Date()));
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [backfilling, setBackfilling] = useState(false);
  const [data, setData] = useState({
    summary: {
      count: 0,
      courtesy_count: 0,
      discount_count: 0,
      courtesy_reference_total: 0,
      discount_amount_total: 0,
      amount_charged_total: 0,
      kardex_pending: 0,
    },
    orders: [],
  });

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

  const runKardexBackfill = async () => {
    setBackfilling(true);
    try {
      const res = await api.post('/reports/backfill-kardex-ventas', {});
      toast.success(
        `Inventario histórico: ${res.applied || 0} aplicados, ${res.skipped || 0} omitidos${res.no_inventory ? `, ${res.no_inventory} sin receta/insumo` : ''}${res.errors?.length ? `, ${res.errors.length} errores` : ''}`
      );
      await load();
    } catch (err) {
      toast.error(err.message || 'No se pudo aplicar inventario histórico');
    } finally {
      setBackfilling(false);
    }
  };

  useEffect(() => {
    load();
  }, [fromDate, toDate]);

  const filtered = useMemo(() => {
    let rows = data.orders;
    if (kindFilter === 'cortesia') rows = rows.filter((o) => o.adjustment_kind === 'cortesia');
    if (kindFilter === 'descuento') rows = rows.filter((o) => o.adjustment_kind === 'descuento');
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((o) => {
      const reason = parseAdjustmentReason(o).toLowerCase();
      const mesa = String(o.table_number || '').toLowerCase();
      const mesero = String(o.created_by_user_name || o.customer_name || '').toLowerCase();
      const num = String(o.order_number || '');
      const kind = kindLabel(o.adjustment_kind).toLowerCase();
      return reason.includes(q) || mesa.includes(q) || mesero.includes(q) || num.includes(q) || kind.includes(q);
    });
  }, [data.orders, search, kindFilter]);

  const filteredSummary = useMemo(() => {
    let courtesyCount = 0;
    let discountCount = 0;
    let courtesyReference = 0;
    let discountAmount = 0;
    let amountCharged = 0;
    let kardexPending = 0;
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
      }
      if (!o.kardex_applied) kardexPending += 1;
    }
    return {
      count: filtered.length,
      courtesy_count: courtesyCount,
      discount_count: discountCount,
      courtesy_reference_total: courtesyReference,
      discount_amount_total: discountAmount,
      amount_charged_total: amountCharged,
      kardex_pending: kardexPending,
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
            {filteredSummary.courtesy_count} cortesías · {filteredSummary.discount_count} descuentos
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
        <div className="card border-l-4 border-l-sky-500">
          <p className="text-xs ui-text-muted">Inventario pendiente</p>
          <p className="text-2xl font-bold text-sky-600">{filteredSummary.kardex_pending}</p>
          <p className="text-xs text-[var(--ui-muted)] mt-1">Sin salida kardex registrada</p>
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
          {(data.summary?.kardex_pending > 0 || filteredSummary.kardex_pending > 0) && (
            <button
              type="button"
              onClick={runKardexBackfill}
              disabled={backfilling}
              className="btn-primary flex items-center gap-2"
            >
              <MdInventory2 />
              {backfilling ? 'Aplicando…' : 'Aplicar inventario histórico'}
            </button>
          )}
        </div>
        <p className="text-xs text-[var(--ui-muted)] mt-3">
          Descuentos y cortesías descuentan inventario al cobrar. No alteran los totales de ventas de cortesía (S/ 0).
          Si trabajaste sin inventario configurado, usa «Aplicar inventario histórico» para registrar salidas con la fecha del cobro.
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
              <th className="py-2 pr-3 font-medium text-right">Descuento</th>
              <th className="py-2 pr-3 font-medium text-right">Cobrado</th>
              <th className="py-2 font-medium text-center">Inventario</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((o) => {
              const items = o.items || [];
              const productLine = items.map((it) => `${it.quantity}× ${it.product_name}`).join(', ');
              const channel = o.type === 'dine_in'
                ? (o.table_number ? `Mesa ${o.table_number}` : 'Salón')
                : o.type === 'delivery'
                  ? 'Delivery'
                  : 'Mostrador';
              const kind = o.adjustment_kind;
              const reason = parseAdjustmentReason(o) || 'Sin motivo registrado';
              const isCourtesy = kind === 'cortesia' || isCourtesyOrder(o);
              return (
                <tr key={o.id} className="border-b border-[color:var(--ui-border)] hover:bg-[var(--ui-sidebar-hover)]">
                  <td className="py-2.5 pr-3 whitespace-nowrap">{formatDateTime(o.updated_at || o.created_at)}</td>
                  <td className="py-2.5 pr-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${kindBadgeClass(kind)}`}>
                      {isCourtesy ? <MdVolunteerActivism className="shrink-0" /> : <MdLocalOffer className="shrink-0" />}
                      {kindLabel(kind)}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 font-medium">#{o.order_number}</td>
                  <td className="py-2.5 pr-3">
                    {o.type === 'dine_in' && o.table_number ? formatMesaLabel(o.table_number) : channel}
                  </td>
                  <td className="py-2.5 pr-3">{o.created_by_user_name || o.customer_name || '—'}</td>
                  <td className="py-2.5 pr-3 max-w-[220px]">{reason}</td>
                  <td className="py-2.5 pr-3 max-w-[260px] truncate" title={productLine}>{productLine || '—'}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-amber-600">
                    {formatCurrency(adjustmentReferenceAmount(o))}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums font-semibold text-emerald-600">
                    {formatCurrency(adjustmentAmountCharged(o))}
                  </td>
                  <td className="py-2.5 text-center">
                    {o.kardex_applied ? (
                      <span className="text-xs text-emerald-600">OK</span>
                    ) : (
                      <span className="text-xs text-amber-600">Pendiente</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="py-10 text-center text-[var(--ui-muted)]">
                  No hay descuentos ni cortesías en el periodo seleccionado
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
