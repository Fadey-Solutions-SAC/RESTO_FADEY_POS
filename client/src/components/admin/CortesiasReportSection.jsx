import { useState, useEffect, useMemo } from 'react';
import { api, formatCurrency, formatDateTime } from '../../utils/api';
import { formatMesaLabel, parseCourtesyReason, courtesyReferenceAmount } from '../../utils/mesaOrderLines';
import { MdVolunteerActivism, MdSearch, MdRefresh } from 'react-icons/md';

function toInputDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function CortesiasReportSection() {
  const [fromDate, setFromDate] = useState(() => {
    const t = new Date();
    t.setDate(t.getDate() - 30);
    return toInputDate(t);
  });
  const [toDate, setToDate] = useState(() => toInputDate(new Date()));
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({ summary: { count: 0, reference_total: 0, money_impact: 0 }, orders: [] });

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);
      const res = await api.get(`/reports/courtesies?${params.toString()}`);
      setData({
        summary: res?.summary || { count: 0, reference_total: 0, money_impact: 0 },
        orders: Array.isArray(res?.orders) ? res.orders : [],
      });
    } catch (err) {
      console.error(err);
      setData({ summary: { count: 0, reference_total: 0, money_impact: 0 }, orders: [] });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [fromDate, toDate]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data.orders;
    return data.orders.filter((o) => {
      const reason = parseCourtesyReason(o).toLowerCase();
      const mesa = String(o.table_number || '').toLowerCase();
      const mesero = String(o.created_by_user_name || o.customer_name || '').toLowerCase();
      const num = String(o.order_number || '');
      return reason.includes(q) || mesa.includes(q) || mesero.includes(q) || num.includes(q);
    });
  }, [data.orders, search]);

  const filteredSummary = useMemo(() => {
    const referenceTotal = filtered.reduce((s, o) => s + courtesyReferenceAmount(o), 0);
    return {
      count: filtered.length,
      reference_total: referenceTotal,
      money_impact: 0,
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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="card border-l-4 border-l-violet-500">
          <p className="text-xs ui-text-muted">Registros de cortesía</p>
          <p className="text-2xl font-bold text-[var(--ui-body-text)]">{filteredSummary.count}</p>
        </div>
        <div className="card border-l-4 border-l-amber-500">
          <p className="text-xs ui-text-muted">Valor de referencia (productos)</p>
          <p className="text-2xl font-bold text-amber-600">{formatCurrency(filteredSummary.reference_total)}</p>
          <p className="text-xs text-[var(--ui-muted)] mt-1">Solo informativo; no es ingreso</p>
        </div>
        <div className="card border-l-4 border-l-emerald-500">
          <p className="text-xs ui-text-muted">Impacto en caja / ventas</p>
          <p className="text-2xl font-bold text-emerald-600">{formatCurrency(0)}</p>
          <p className="text-xs text-[var(--ui-muted)] mt-1">No afecta totales de dinero</p>
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
                placeholder="Motivo, mesa, mesero, N° pedido…"
                className="input-field pl-9 w-full"
              />
            </div>
          </div>
          <button type="button" onClick={load} className="btn-secondary flex items-center gap-2">
            <MdRefresh /> Actualizar
          </button>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--ui-muted)] border-b border-[color:var(--ui-border)]">
              <th className="py-2 pr-3 font-medium">Fecha</th>
              <th className="py-2 pr-3 font-medium">Pedido</th>
              <th className="py-2 pr-3 font-medium">Mesa / canal</th>
              <th className="py-2 pr-3 font-medium">Registró</th>
              <th className="py-2 pr-3 font-medium">Motivo</th>
              <th className="py-2 pr-3 font-medium">Productos</th>
              <th className="py-2 pr-3 font-medium text-right">Ref.</th>
              <th className="py-2 font-medium text-right">Cobrado</th>
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
              return (
                <tr key={o.id} className="border-b border-[color:var(--ui-border)] hover:bg-[var(--ui-sidebar-hover)]">
                  <td className="py-2.5 pr-3 whitespace-nowrap">{formatDateTime(o.updated_at || o.created_at)}</td>
                  <td className="py-2.5 pr-3 font-medium">#{o.order_number}</td>
                  <td className="py-2.5 pr-3">
                    {o.type === 'dine_in' && o.table_number ? formatMesaLabel(o.table_number) : channel}
                  </td>
                  <td className="py-2.5 pr-3">{o.created_by_user_name || o.customer_name || '—'}</td>
                  <td className="py-2.5 pr-3 max-w-[220px]">
                    <span className="inline-flex items-center gap-1 text-violet-600 dark:text-violet-300">
                      <MdVolunteerActivism className="shrink-0" />
                      {parseCourtesyReason(o) || 'Sin motivo registrado'}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 max-w-[260px] truncate" title={productLine}>{productLine || '—'}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-[var(--ui-muted)]">
                    {formatCurrency(courtesyReferenceAmount(o))}
                  </td>
                  <td className="py-2.5 text-right tabular-nums font-semibold text-emerald-600">
                    {formatCurrency(0)}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="py-10 text-center text-[var(--ui-muted)]">
                  No hay cortesías en el periodo seleccionado
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
