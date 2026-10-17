import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  MdAccountBalanceWallet, MdAdd, MdCalendarMonth, MdCleaningServices, MdClose, MdDownload,
  MdEdit, MdFilterAlt, MdInventory2, MdPeople, MdPerson, MdPictureAsPdf,
  MdRefresh, MdSearch, MdShoppingCart, MdVisibility, MdWallet,
} from 'react-icons/md';
import toast from 'react-hot-toast';
import { api, formatCurrency, formatDateKey, formatDateTime, toLocalDateKey } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../hooks/useSocket';
import Modal from '../Modal';
import {
  exportExpenseDashboardExcel,
  exportExpenseDashboardPdf,
  exportExpenseDashboardTxt,
} from '../../utils/expenseDashboardExport';

const CATEGORY_STYLE = {
  supplies: {
    color: '#ef476f',
    card: 'border-rose-200 bg-rose-50/80',
    icon: 'bg-rose-100 text-rose-600',
    badge: 'bg-rose-100 text-rose-700',
    Icon: MdShoppingCart,
  },
  operating: {
    color: '#f97316',
    card: 'border-orange-200 bg-orange-50/80',
    icon: 'bg-orange-100 text-orange-600',
    badge: 'bg-orange-100 text-orange-700',
    Icon: MdCleaningServices,
  },
  staff: {
    color: '#8b5cf6',
    card: 'border-violet-200 bg-violet-50/80',
    icon: 'bg-violet-100 text-violet-600',
    badge: 'bg-violet-100 text-violet-700',
    Icon: MdPeople,
  },
  other: {
    color: '#10b981',
    card: 'border-emerald-200 bg-emerald-50/80',
    icon: 'bg-emerald-100 text-emerald-600',
    badge: 'bg-emerald-100 text-emerald-700',
    Icon: MdInventory2,
  },
};

function initialDateRange() {
  const today = toLocalDateKey(new Date()) || new Date().toISOString().slice(0, 10);
  return { from: `${today.slice(0, 8)}01`, to: today };
}

function queryString(filters, page = 1, exporting = false) {
  const qs = new URLSearchParams({
    from: filters.from,
    to: filters.to,
    page: String(page),
    page_size: '25',
  });
  if (filters.category) qs.set('category', filters.category);
  if (filters.user_id) qs.set('user_id', filters.user_id);
  if (filters.search) qs.set('search', filters.search);
  if (exporting) qs.set('export', '1');
  return qs.toString();
}

function ExpenseTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 shadow-lg">
      <p className="font-semibold">{label || row.name}</p>
      <p className="mt-1">{formatCurrency(row.amount)} · {Number(row.percentage || 0).toFixed(1)}%</p>
    </div>
  );
}

function ExpenseKpi({ title, amount, operations, style, iconClass, Icon, comparison }) {
  return (
    <div className={`rounded-xl border p-3 shadow-sm ${style}`}>
      <div className="flex items-start gap-2.5">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${iconClass}`}>
          <Icon className="text-xl" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-600 truncate">{title}</p>
          <p className="mt-0.5 text-lg font-bold text-slate-950 tabular-nums">{formatCurrency(amount)}</p>
          <p className="mt-0.5 text-[10px] text-slate-500">
            {comparison || `${operations || 0} operación(es)`}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function InventoryExpensesDashboard({ onNewExpense }) {
  const { user } = useAuth();
  const initial = useMemo(initialDateRange, []);
  const [draft, setDraft] = useState({ ...initial, category: '', user_id: '', search: '' });
  const [filters, setFilters] = useState({ ...initial, category: '', user_id: '', search: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState('');
  const [restaurantName, setRestaurantName] = useState('Resto Fadey');
  const [newExpenseOpen, setNewExpenseOpen] = useState(false);
  const [detailGroup, setDetailGroup] = useState(null);
  const [editRow, setEditRow] = useState(null);
  const [editForm, setEditForm] = useState({ quantity: '', unit_cost: '', purchase_date: '', notes: '', password: '' });
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get(`/inventory/expenses-dashboard?${queryString(filters, page)}`, { skipOffline: true });
      setData(result);
      setError('');
    } catch (err) {
      setError(err.message || 'No se pudo cargar el panel de gastos');
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    api.get('/restaurant')
      .then((row) => setRestaurantName(row?.name || row?.restaurant?.name || 'Resto Fadey'))
      .catch(() => {});
  }, []);

  useSocket('inventory-update', () => void loadData());

  useEffect(() => {
    setDetailGroup((current) => {
      if (!current?.id || !data?.groups) return current;
      return data.groups.find((group) => group.id === current.id) || current;
    });
  }, [data]);

  const chartData = data?.summary?.by_category || [];
  const hasData = Number(data?.summary?.total || 0) > 0 && chartData.some((row) => Number(row.amount || 0) > 0);
  const comparison = data?.summary?.comparison_available
    ? `${Number(data.summary.variation_pct || 0) >= 0 ? '↑' : '↓'} ${Math.abs(Number(data.summary.variation_pct || 0)).toFixed(1)}% vs. periodo anterior`
    : 'Sin base de comparación';

  const applyFilters = () => {
    if (!draft.from || !draft.to) {
      toast.error('Selecciona las fechas del periodo');
      return;
    }
    if (draft.from > draft.to) {
      toast.error('La fecha inicial no puede ser posterior a la fecha final');
      return;
    }
    setPage(1);
    setFilters({ ...draft, search: String(draft.search || '').trim() });
  };

  const applyHeaderFilter = (field, value) => {
    const nextDraft = { ...draft, [field]: value };
    setDraft(nextDraft);
    if (field === 'user_id') {
      setPage(1);
      setFilters((prev) => ({ ...prev, user_id: value }));
      return;
    }
    if (nextDraft.from && nextDraft.to && nextDraft.from <= nextDraft.to) {
      setPage(1);
      setFilters((prev) => ({ ...prev, from: nextDraft.from, to: nextDraft.to }));
    }
  };

  const clearFilters = () => {
    const next = { ...initialDateRange(), category: '', user_id: '', search: '' };
    setDraft(next);
    setFilters(next);
    setPage(1);
  };

  const exportData = async (format) => {
    if (exporting) return;
    setExporting(format);
    try {
      const full = await api.get(`/inventory/expenses-dashboard?${queryString(filters, 1, true)}`, { skipOffline: true });
      const context = {
        restaurant: restaurantName,
        user: user?.full_name || user?.username || '—',
      };
      if (format === 'excel') exportExpenseDashboardExcel(full, context);
      else if (format === 'txt') exportExpenseDashboardTxt(full, context);
      else exportExpenseDashboardPdf(full, context);
      toast.success(format === 'pdf' ? 'Informe listo para guardar como PDF' : `Informe exportado en ${format.toUpperCase()}`);
    } catch (err) {
      toast.error(err.message || 'No se pudo exportar el informe');
    } finally {
      setExporting('');
    }
  };

  const startEdit = (row) => {
    setEditRow(row);
    setEditForm({
      quantity: String(row.quantity ?? 0),
      unit_cost: String(row.unit_cost ?? 0),
      purchase_date: String(row.date_key || '').slice(0, 10),
      notes: String(row.notes || ''),
      password: '',
    });
  };

  const saveEdit = async () => {
    if (!editRow || saving) return;
    const quantity = Number(editForm.quantity);
    const unitCost = Number(editForm.unit_cost);
    if (!Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(unitCost) || unitCost < 0) {
      toast.error('Revisa la cantidad y el precio unitario');
      return;
    }
    if (!editForm.password.trim()) {
      toast.error('Ingresa la contraseña de administrador');
      return;
    }
    setSaving(true);
    try {
      await api.put('/inventory/expenses', {
        admin_password: editForm.password,
        requirement_id: editRow.requirement_id || null,
        purchase_date: editForm.purchase_date,
        notes: editForm.notes,
        updates: [{ id: editRow.source_id, quantity, unit_cost: unitCost }],
      });
      toast.success('Gasto actualizado');
      setEditRow(null);
      await loadData();
    } catch (err) {
      toast.error(err.message || 'No se pudo actualizar el gasto');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) {
    return <div className="card flex min-h-64 items-center justify-center"><div className="rf-loader rf-loader--md" /></div>;
  }

  return (
    <div className="space-y-3">
      <section className="rounded-2xl border border-[color:var(--ui-border)] bg-[var(--ui-surface)] p-4 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <span
            aria-hidden="true"
            className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-sky-100 text-sky-600 shadow-sm ring-1 ring-sky-200/70"
          >
            <MdAccountBalanceWallet className="text-4xl" />
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-body-bg)] px-2 py-1.5">
              <MdCalendarMonth className="text-sky-600" />
              <input type="date" value={draft.from} onChange={(e) => applyHeaderFilter('from', e.target.value)} className="bg-transparent text-xs text-[var(--ui-body-text)] outline-none" />
              <span className="text-xs text-[var(--ui-muted)]">a</span>
              <input type="date" value={draft.to} onChange={(e) => applyHeaderFilter('to', e.target.value)} className="bg-transparent text-xs text-[var(--ui-body-text)] outline-none" />
            </label>
            <label className="inline-flex items-center gap-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-body-bg)] px-2 py-1.5">
              <MdPerson className="text-sky-600" />
              <select value={draft.user_id} onChange={(e) => applyHeaderFilter('user_id', e.target.value)} className="min-w-36 bg-transparent text-xs text-[var(--ui-body-text)] outline-none">
                <option value="">Todos los usuarios</option>
                {(data?.users || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => setNewExpenseOpen(true)} className="btn-primary inline-flex items-center gap-1.5 text-xs">
              <MdAdd className="text-lg" /> Nuevo gasto
            </button>
            <button type="button" onClick={() => void exportData('excel')} disabled={Boolean(exporting)} className="btn-secondary inline-flex items-center gap-1 text-xs">
              <MdDownload /> Excel
            </button>
            <button type="button" onClick={() => void exportData('pdf')} disabled={Boolean(exporting)} className="btn-secondary inline-flex items-center gap-1 text-xs">
              <MdPictureAsPdf /> PDF
            </button>
            <button type="button" onClick={() => void exportData('txt')} disabled={Boolean(exporting)} className="btn-secondary inline-flex items-center gap-1 text-xs">
              <MdDownload /> TXT
            </button>
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
          <button type="button" onClick={() => void loadData()} className="ml-3 font-semibold underline">Reintentar</button>
        </div>
      ) : null}

      <section className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <ExpenseKpi
          title="Total de gastos"
          amount={data?.summary?.total}
          operations={data?.summary?.operations}
          style="border-sky-200 bg-sky-50/80"
          iconClass="bg-sky-100 text-sky-600"
          Icon={MdWallet}
          comparison={comparison}
        />
        {(data?.summary?.by_category || []).map((row) => {
          const skin = CATEGORY_STYLE[row.id] || CATEGORY_STYLE.other;
          return <ExpenseKpi key={row.id} title={row.name} amount={row.amount} operations={row.operations} style={skin.card} iconClass={skin.icon} Icon={skin.Icon} />;
        })}
      </section>

      <section className="grid gap-3 xl:grid-cols-2">
        <div className="rounded-2xl border border-[color:var(--ui-border)] bg-[var(--ui-surface)] p-4 shadow-sm">
          <h3 className="text-sm font-bold text-[var(--ui-body-text)]">Gastos por categoría</h3>
          <div className="mt-2 h-64">
            {hasData ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 18, right: 10, left: 0, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-8} textAnchor="end" />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(value) => `S/ ${value}`} />
                  <Tooltip content={<ExpenseTooltip />} />
                  <Bar dataKey="amount" radius={[7, 7, 0, 0]}>
                    {chartData.map((row) => <Cell key={row.id} fill={(CATEGORY_STYLE[row.id] || CATEGORY_STYLE.other).color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="flex h-full items-center justify-center text-sm text-[var(--ui-muted)]">No hay gastos para graficar en este periodo.</div>}
          </div>
        </div>

        <div className="rounded-2xl border border-[color:var(--ui-border)] bg-[var(--ui-surface)] p-4 shadow-sm">
          <h3 className="text-sm font-bold text-[var(--ui-body-text)]">Distribución de gastos</h3>
          <div className="mt-2 grid min-h-64 items-center gap-2 sm:grid-cols-[1fr_1fr]">
            {hasData ? (
              <>
                <div className="relative h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={chartData.filter((row) => row.amount > 0)} dataKey="amount" nameKey="name" innerRadius="53%" outerRadius="82%" paddingAngle={2}>
                        {chartData.filter((row) => row.amount > 0).map((row) => <Cell key={row.id} fill={(CATEGORY_STYLE[row.id] || CATEGORY_STYLE.other).color} />)}
                      </Pie>
                      <Tooltip content={<ExpenseTooltip />} />
                      <Legend verticalAlign="bottom" height={24} iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pb-6">
                    <span className="text-[10px] text-[var(--ui-muted)]">Total</span>
                    <strong className="text-base text-[var(--ui-body-text)]">{formatCurrency(data.summary.total)}</strong>
                  </div>
                </div>
                <div className="space-y-2">
                  {chartData.map((row) => (
                    <div key={row.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-2 text-xs">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: (CATEGORY_STYLE[row.id] || CATEGORY_STYLE.other).color }} />
                      <span className="truncate text-[var(--ui-body-text)]">{row.name}</span>
                      <span className="text-right tabular-nums text-[var(--ui-muted)]">{formatCurrency(row.amount)} · {row.percentage.toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </>
            ) : <div className="col-span-full flex h-56 items-center justify-center text-sm text-[var(--ui-muted)]">Sin movimientos en el periodo seleccionado.</div>}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-[color:var(--ui-border)] bg-[var(--ui-surface)] shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-[color:var(--ui-border)] p-3">
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--ui-body-text)]"><MdFilterAlt className="text-sky-600" /> Filtros</span>
          <select value={draft.category} onChange={(e) => setDraft((prev) => ({ ...prev, category: e.target.value }))} className="input-field w-auto min-w-44 py-2 text-xs">
            <option value="">Todas las categorías</option>
            {(data?.categories || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <label className="relative min-w-56 flex-1">
            <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ui-muted)]" />
            <input value={draft.search} onChange={(e) => setDraft((prev) => ({ ...prev, search: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') applyFilters(); }} className="input-field w-full py-2 pl-9 text-xs" placeholder="Buscar producto, concepto, almacén o nota…" />
          </label>
          <button type="button" onClick={applyFilters} className="btn-primary inline-flex items-center gap-1 text-xs"><MdSearch /> Aplicar</button>
          <button type="button" onClick={clearFilters} className="btn-secondary inline-flex items-center gap-1 text-xs"><MdRefresh /> Limpiar</button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-xs">
            <thead className="bg-sky-100 text-slate-800">
              <tr>
                <th className="px-3 py-2 text-left">#</th>
                <th className="px-3 py-2 text-left">Fecha</th>
                <th className="px-3 py-2 text-left">Categoría</th>
                <th className="px-3 py-2 text-left">Resumen de la compra</th>
                <th className="px-3 py-2 text-right">Ítems</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-left">Usuario</th>
                <th className="px-3 py-2 text-left">Almacén</th>
                <th className="px-3 py-2 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {(data?.groups || []).map((group, index) => {
                const skin = CATEGORY_STYLE[group.category] || CATEGORY_STYLE.other;
                return (
                  <tr
                    key={group.id}
                    className="cursor-pointer border-t border-[color:var(--ui-border)] hover:bg-[var(--ui-sidebar-hover)]"
                    onClick={() => setDetailGroup(group)}
                  >
                    <td className="px-3 py-2 tabular-nums">{(data.pagination.page - 1) * data.pagination.page_size + index + 1}</td>
                    <td className="px-3 py-2 whitespace-nowrap" title={formatDateTime(group.occurred_at)}>{formatDateKey(group.date_key)}</td>
                    <td className="px-3 py-2"><span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold ${skin.badge}`}>{group.category_name}</span></td>
                    <td className="max-w-80 px-3 py-2 font-medium text-[var(--ui-body-text)]"><span className="line-clamp-2">{group.concept}</span></td>
                    <td className="px-3 py-2 text-right tabular-nums">{group.item_count}</td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums whitespace-nowrap">{formatCurrency(group.total)}</td>
                    <td className="px-3 py-2">{group.user_name || '—'}</td>
                    <td className="px-3 py-2">{group.warehouse_name || '—'}</td>
                    <td className="px-3 py-2 text-center">
                      <button
                        type="button"
                        onClick={(event) => { event.stopPropagation(); setDetailGroup(group); }}
                        className="inline-grid h-7 w-7 place-items-center rounded-md bg-sky-50 text-sky-700 hover:bg-sky-100"
                        title="Ver detalle de la compra"
                      >
                        <MdVisibility />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!data?.groups?.length ? (
                <tr><td colSpan="9" className="px-4 py-12 text-center text-sm text-[var(--ui-muted)]">No existen movimientos para los filtros seleccionados.</td></tr>
              ) : null}
            </tbody>
            {data?.groups?.length ? (
              <tfoot><tr className="border-t-2 border-sky-200 bg-sky-50 font-bold text-slate-900"><td colSpan="5" className="px-3 py-2">TOTAL DEL FILTRO</td><td className="px-3 py-2 text-right">{formatCurrency(data.summary.total)}</td><td colSpan="3" /></tr></tfoot>
            ) : null}
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[color:var(--ui-border)] px-3 py-2 text-xs">
          <span className="text-[var(--ui-muted)]">{data?.pagination?.total_rows || 0} compra(s) · {data?.pagination?.total_items || 0} producto(s)</span>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-secondary px-3 py-1.5 text-xs" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>Anterior</button>
            <span className="text-[var(--ui-body-text)]">Página {data?.pagination?.page || 1} de {data?.pagination?.total_pages || 1}</span>
            <button type="button" className="btn-secondary px-3 py-1.5 text-xs" disabled={page >= Number(data?.pagination?.total_pages || 1) || loading} onClick={() => setPage((value) => value + 1)}>Siguiente</button>
          </div>
        </div>
      </section>

      <Modal
        isOpen={Boolean(detailGroup)}
        onClose={() => { if (!saving) setDetailGroup(null); }}
        title={detailGroup ? `Detalle de compra · ${formatDateKey(detailGroup.date_key)}` : 'Detalle de compra'}
        size="xl"
      >
        {detailGroup ? (
          <div className="space-y-4">
            <div className="grid gap-2 rounded-lg bg-[var(--ui-body-bg)] p-3 text-xs sm:grid-cols-2">
              <p><span className="text-[var(--ui-muted)]">Fecha:</span> <strong className="text-[var(--ui-body-text)]">{formatDateKey(detailGroup.date_key)}</strong></p>
              <p><span className="text-[var(--ui-muted)]">Categoría:</span> <strong className="text-[var(--ui-body-text)]">{detailGroup.category_name}</strong></p>
              <p><span className="text-[var(--ui-muted)]">Productos:</span> <strong className="text-[var(--ui-body-text)]">{detailGroup.item_count}</strong></p>
              <p><span className="text-[var(--ui-muted)]">Total:</span> <strong className="text-[var(--ui-body-text)]">{formatCurrency(detailGroup.total)}</strong></p>
              <p><span className="text-[var(--ui-muted)]">Usuario:</span> <strong className="text-[var(--ui-body-text)]">{detailGroup.user_name || '—'}</strong></p>
              <p><span className="text-[var(--ui-muted)]">Almacén:</span> <strong className="text-[var(--ui-body-text)]">{detailGroup.warehouse_name || '—'}</strong></p>
              <p className="sm:col-span-2"><span className="text-[var(--ui-muted)]">Pago:</span> <strong className="text-[var(--ui-body-text)]">{detailGroup.payment_status === 'paid' ? 'Pagado' : (detailGroup.payment_status === 'mixed' ? 'Parcial' : '—')}</strong></p>
              <p className="sm:col-span-2"><span className="text-[var(--ui-muted)]">Nota:</span> <strong className="text-[var(--ui-body-text)]">{detailGroup.notes || '—'}</strong></p>
            </div>
            <div className="overflow-x-auto rounded-lg border border-[color:var(--ui-border)]">
              <table className="w-full min-w-[720px] text-xs">
                <thead className="bg-sky-100 text-slate-800">
                  <tr>
                    <th className="px-3 py-2 text-left">#</th>
                    <th className="px-3 py-2 text-left">Producto / concepto</th>
                    <th className="px-3 py-2 text-right">Cantidad</th>
                    <th className="px-3 py-2 text-right">Precio unitario</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2 text-left">Usuario</th>
                    <th className="px-3 py-2 text-left">Almacén</th>
                    <th className="px-3 py-2 text-left">Nota</th>
                    <th className="px-3 py-2 text-center">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {(detailGroup.items || []).map((row, index) => (
                    <tr key={row.id} className="border-t border-[color:var(--ui-border)]">
                      <td className="px-3 py-2 tabular-nums">{index + 1}</td>
                      <td className="px-3 py-2 font-medium text-[var(--ui-body-text)]">{row.concept}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.quantity}</td>
                      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatCurrency(row.unit_cost)}</td>
                      <td className="px-3 py-2 text-right font-bold tabular-nums whitespace-nowrap">{formatCurrency(row.total)}</td>
                      <td className="px-3 py-2">{row.user_name || '—'}</td>
                      <td className="px-3 py-2">{row.warehouse_name || '—'}</td>
                      <td className="max-w-48 px-3 py-2 text-[var(--ui-muted)]">{row.notes || '—'}</td>
                      <td className="px-3 py-2 text-center">
                        {row.can_edit ? (
                          <button type="button" onClick={() => startEdit(row)} className="inline-grid h-7 w-7 place-items-center rounded-md bg-sky-50 text-sky-700 hover:bg-sky-100" title="Editar producto"><MdEdit /></button>
                        ) : <span className="text-[10px] text-[var(--ui-muted)]">Solo lectura</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-sky-200 bg-sky-50 font-bold text-slate-900">
                    <td colSpan="4" className="px-3 py-2">TOTAL DE LA COMPRA</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(detailGroup.total)}</td>
                    <td colSpan="4" />
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="flex justify-end">
              <button type="button" className="btn-secondary inline-flex items-center gap-1" onClick={() => setDetailGroup(null)}><MdClose /> Cerrar</button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal isOpen={Boolean(editRow)} onClose={() => { if (!saving) setEditRow(null); }} title="Editar gasto de compra" size="md">
        {editRow ? (
          <div className="space-y-4">
            <div className="rounded-lg bg-[var(--ui-body-bg)] p-3">
              <p className="text-sm font-semibold text-[var(--ui-body-text)]">{editRow.concept}</p>
              <p className="text-xs text-[var(--ui-muted)]">Esta edición actualiza el registro de compra vinculado; no genera otra entrada de inventario ni otro egreso de caja.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-[var(--ui-muted)]">Cantidad<input type="number" min="0" step="0.0001" className="input-field mt-1 w-full" value={editForm.quantity} onChange={(e) => setEditForm((prev) => ({ ...prev, quantity: e.target.value }))} /></label>
              <label className="text-xs text-[var(--ui-muted)]">Precio unitario<input type="number" min="0" step="0.01" className="input-field mt-1 w-full" value={editForm.unit_cost} onChange={(e) => setEditForm((prev) => ({ ...prev, unit_cost: e.target.value }))} /></label>
              <label className="text-xs text-[var(--ui-muted)]">Fecha de compra<input type="date" className="input-field mt-1 w-full" value={editForm.purchase_date} onChange={(e) => setEditForm((prev) => ({ ...prev, purchase_date: e.target.value }))} /></label>
              <label className="text-xs text-[var(--ui-muted)]">Contraseña de administrador<input type="password" className="input-field mt-1 w-full" value={editForm.password} onChange={(e) => setEditForm((prev) => ({ ...prev, password: e.target.value }))} /></label>
            </div>
            <label className="block text-xs text-[var(--ui-muted)]">Nota<input className="input-field mt-1 w-full" value={editForm.notes} onChange={(e) => setEditForm((prev) => ({ ...prev, notes: e.target.value }))} /></label>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary inline-flex items-center gap-1" disabled={saving} onClick={() => setEditRow(null)}><MdClose /> Cancelar</button>
              <button type="button" className="btn-primary" disabled={saving} onClick={() => void saveEdit()}>{saving ? 'Guardando…' : 'Guardar cambios'}</button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal isOpen={newExpenseOpen} onClose={() => setNewExpenseOpen(false)} title="Registrar gasto en su módulo de origen" size="md">
        <div className="space-y-3">
          <p className="text-sm text-[var(--ui-muted)]">
            Elige el tipo de operación. Así el gasto se registra una sola vez y conserva su vínculo con inventario, caja o personal.
          </p>
          {[
            { id: 'purchase', title: 'Compra de insumos o mercadería', detail: 'Abrir Recepción para registrar productos, cantidades, costos y entrada de inventario.', Icon: MdShoppingCart, tone: 'bg-rose-100 text-rose-700' },
            { id: 'cash', title: 'Gasto operativo u otro egreso', detail: 'Abrir Egresos de Caja para registrar el pago en el turno correspondiente.', Icon: MdWallet, tone: 'bg-orange-100 text-orange-700' },
            { id: 'payroll', title: 'Gasto de personal', detail: 'Abrir Personal y nómina para registrar el pago del trabajador.', Icon: MdPeople, tone: 'bg-violet-100 text-violet-700' },
          ].map(({ id, title, detail, Icon, tone }) => (
            <button
              key={id}
              type="button"
              className="flex w-full items-start gap-3 rounded-xl border border-[color:var(--ui-border)] bg-[var(--ui-body-bg)] p-3 text-left hover:bg-[var(--ui-sidebar-hover)]"
              onClick={() => {
                setNewExpenseOpen(false);
                onNewExpense?.(id);
              }}
            >
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${tone}`}><Icon className="text-xl" /></span>
              <span>
                <span className="block text-sm font-semibold text-[var(--ui-body-text)]">{title}</span>
                <span className="mt-0.5 block text-xs text-[var(--ui-muted)]">{detail}</span>
              </span>
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}
