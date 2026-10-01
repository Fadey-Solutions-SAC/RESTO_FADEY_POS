import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  MdAdd,
  MdSearch,
  MdLocalOffer,
  MdInventory2,
  MdShoppingBag,
  MdSavings,
  MdVisibility,
  MdEdit,
  MdPause,
  MdPlayArrow,
  MdMoreVert,
  MdContentCopy,
  MdDelete,
  MdTrendingUp,
  MdTrendingDown,
  MdSchedule,
  MdEvent,
  MdRestaurantMenu,
} from 'react-icons/md';
import toast from 'react-hot-toast';
import { api, formatCurrency, resolveMediaUrl } from '../../utils/api';
import { useSocket } from '../../hooks/useSocket';
import Modal from '../../components/Modal';
import {
  PROMOTION_TYPES,
  PROMOTION_TYPE_LABELS,
  PROMOTION_STATUS_LABELS,
  promotionBadgeLabel,
  promotionEngine,
  refreshActivePromotions,
  validatePromotionInput,
} from '../../utils/promotions';
import PromotionStatus from '../../components/promotions/PromotionStatus';
import PromotionSelector from '../../components/promotions/PromotionSelector';
import PromotionCard from '../../components/promotions/PromotionCard';
import { promotionTone } from '../../components/promotions/PromotionBadge';

const DAY_OPTIONS = [
  { value: 1, short: 'L', label: 'Lunes' },
  { value: 2, short: 'M', label: 'Martes' },
  { value: 3, short: 'X', label: 'Miércoles' },
  { value: 4, short: 'J', label: 'Jueves' },
  { value: 5, short: 'V', label: 'Viernes' },
  { value: 6, short: 'S', label: 'Sábado' },
  { value: 0, short: 'D', label: 'Domingo' },
];

const STATUS_TABS = [
  { key: 'all', label: 'Todas' },
  { key: 'active', label: 'Activas' },
  { key: 'scheduled', label: 'Programadas' },
  { key: 'paused', label: 'Pausadas' },
  { key: 'finished', label: 'Finalizadas' },
];

const TYPE_PILL = {
  percent: 'bg-orange-50 text-orange-700 ring-orange-200',
  fixed: 'bg-orange-50 text-orange-700 ring-orange-200',
  price: 'bg-blue-50 text-blue-700 ring-blue-200',
  '2x1': 'bg-violet-50 text-violet-700 ring-violet-200',
  '3x2': 'bg-violet-50 text-violet-700 ring-violet-200',
  combo: 'bg-violet-50 text-violet-700 ring-violet-200',
  quantity: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
};

const VALUE_FIELD = {
  percent: { label: 'Porcentaje de descuento (%)', step: '0.01', max: 100 },
  fixed: { label: 'Monto a descontar por unidad (S/)', step: '0.01' },
  price: { label: 'Precio promocional por unidad (S/)', step: '0.01' },
  combo: { label: 'Precio del combo (S/)', step: '0.01' },
  quantity: { label: 'Porcentaje de descuento (%)', step: '0.01', max: 100 },
};

const TYPE_HINT = {
  percent: 'Descuenta un porcentaje del precio de cada producto.',
  fixed: 'Resta un monto fijo a cada unidad.',
  price: 'Fija un precio especial por unidad.',
  '2x1': 'Por cada 2 unidades del mismo producto, una es gratis.',
  '3x2': 'Por cada 3 unidades del mismo producto, una es gratis.',
  combo: 'Cuando el pedido lleva todos los productos elegidos, el conjunto se cobra al precio del combo.',
  quantity: 'Aplica el porcentaje cuando se piden al menos la cantidad mínima del producto.',
};

function emptyForm() {
  return {
    name: '',
    description: '',
    type: 'percent',
    value: '',
    status: 'active',
    start_date: '',
    end_date: '',
    no_end_date: true,
    days: [],
    start_time: '',
    end_time: '',
    product_ids: [],
    category_ids: [],
    min_quantity: '',
    min_purchase: '',
    usage_limit: '',
    per_customer_limit: '',
    combinable: false,
    priority: '0',
  };
}

function promotionToForm(p) {
  return {
    name: p.name || '',
    description: p.description || '',
    type: p.type || 'percent',
    value: p.value ? String(p.value) : '',
    status: p.status === 'paused' ? 'paused' : 'active',
    start_date: p.start_date || '',
    end_date: p.end_date || '',
    no_end_date: Boolean(p.no_end_date) || !p.end_date,
    days: Array.isArray(p.days) ? p.days : [],
    start_time: p.start_time || '',
    end_time: p.end_time || '',
    product_ids: p.product_ids || [],
    category_ids: p.category_ids || [],
    min_quantity: p.min_quantity ? String(p.min_quantity) : '',
    min_purchase: p.min_purchase ? String(p.min_purchase) : '',
    usage_limit: p.usage_limit ? String(p.usage_limit) : '',
    per_customer_limit: p.per_customer_limit ? String(p.per_customer_limit) : '',
    combinable: Boolean(p.combinable),
    priority: String(p.priority || 0),
  };
}

function formToPayload(f) {
  const usesValue = Boolean(VALUE_FIELD[f.type]);
  return {
    name: f.name.trim(),
    description: f.description.trim(),
    type: f.type,
    value: usesValue ? Number(f.value || 0) : 0,
    status: f.status,
    start_date: f.start_date,
    end_date: f.no_end_date ? '' : f.end_date,
    no_end_date: f.no_end_date,
    days: f.days,
    start_time: f.start_time,
    end_time: f.end_time,
    product_ids: f.product_ids,
    category_ids: f.type === 'combo' ? [] : f.category_ids,
    min_quantity: Number(f.min_quantity || 0),
    min_purchase: Number(f.min_purchase || 0),
    usage_limit: Number(f.usage_limit || 0),
    per_customer_limit: Number(f.per_customer_limit || 0),
    combinable: f.combinable,
    priority: Number(f.priority || 0),
  };
}

function fmtDay(key) {
  const m = String(key || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

function validityText(p) {
  const from = fmtDay(p.start_date);
  const to = p.no_end_date || !p.end_date ? '' : fmtDay(p.end_date);
  if (!from && !to) return 'Sin fecha de fin';
  if (!to) return `Desde ${from}`;
  if (!from) return `Hasta ${to}`;
  return `${from} - ${to}`;
}

function daysText(days) {
  if (!days?.length || days.length === 7) return 'Todos los días';
  const sorted = DAY_OPTIONS.filter((d) => days.includes(d.value));
  const weekdays = [1, 2, 3, 4, 5];
  if (sorted.length === 5 && weekdays.every((d) => days.includes(d))) return 'Lunes a viernes';
  if (sorted.length === 2 && days.includes(0) && days.includes(6)) return 'Fines de semana';
  return sorted.map((d) => d.label.slice(0, 3)).join(', ');
}

function hoursText(p) {
  if (!p.start_time || !p.end_time || p.start_time === p.end_time) return 'Todo el día';
  return `${p.start_time} - ${p.end_time}`;
}

function promoValueText(p) {
  switch (p.type) {
    case 'percent':
      return `${p.value}% de descuento`;
    case 'fixed':
      return `${formatCurrency(p.value)} menos por unidad`;
    case 'price':
      return `Precio especial ${formatCurrency(p.value)}`;
    case 'combo':
      return `Combo a ${formatCurrency(p.value)}`;
    case 'quantity':
      return `${p.value}% desde ${p.min_quantity} unidades`;
    default:
      return PROMOTION_TYPE_LABELS[p.type] || p.type;
  }
}

function trendPct(cur, prev) {
  const c = Number(cur || 0);
  const p = Number(prev || 0);
  if (!p) return c > 0 ? 100 : 0;
  return Math.round(((c - p) / p) * 100);
}

function TypePill({ type }) {
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${
        TYPE_PILL[type] || 'bg-slate-100 text-slate-600 ring-slate-200'
      }`}
    >
      {PROMOTION_TYPE_LABELS[type] || type}
    </span>
  );
}

function Thumb({ product, size = 'h-8 w-8' }) {
  const img = String(resolveMediaUrl(product?.image || '') || '').trim();
  return img ? (
    <img src={img} alt="" title={product?.name} className={`${size} shrink-0 rounded-md object-cover ring-2 ring-white`} />
  ) : (
    <span
      title={product?.name}
      className={`${size} grid shrink-0 place-items-center rounded-md bg-slate-100 text-slate-400 ring-2 ring-white`}
    >
      <MdRestaurantMenu className="text-sm" />
    </span>
  );
}

function KpiCard({ title, value, Icon, bubble, bg, trend, trendLabel = 'vs mes anterior', note }) {
  const up = trend >= 0;
  return (
    <div className={`flex min-w-0 flex-col gap-3 rounded-2xl border border-slate-200 bg-gradient-to-br p-5 shadow-sm ${bg}`}>
      <span className="block truncate whitespace-nowrap text-sm font-semibold text-slate-800" title={title}>
        {title}
      </span>
      <span className="flex items-center gap-3">
        <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ${bubble}`}>
          <Icon className="text-2xl" />
        </span>
        <span className="min-w-0 flex-1 truncate whitespace-nowrap text-3xl font-bold leading-none text-slate-900 tabular-nums">
          {value}
        </span>
      </span>
      {trend == null ? (
        <span className="text-xs text-slate-500">{note}</span>
      ) : (
        <span className={`inline-flex items-center gap-1 text-xs font-semibold ${up ? 'text-emerald-600' : 'text-red-500'}`}>
          {up ? <MdTrendingUp /> : <MdTrendingDown />}
          {up ? '+' : ''}
          {trend}% <span className="font-normal text-slate-500">{trendLabel}</span>
        </span>
      )}
    </div>
  );
}

function FormSection({ title, children }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h4 className="mb-3 text-sm font-bold text-slate-800">{title}</h4>
      {children}
    </section>
  );
}

function Field({ label, children, hint }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs font-semibold text-slate-600">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-slate-500">{hint}</span> : null}
    </label>
  );
}

export default function Promociones() {
  const [data, setData] = useState({ promotions: [], summary: {} });
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selected, setSelected] = useState([]);
  const [menu, setMenu] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/promotions');
      setData({ promotions: res?.promotions || [], summary: res?.summary || {} });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCatalog = useCallback(async () => {
    try {
      const [prods, cats] = await Promise.all([
        api.get('/products?active_only=true'),
        api.get('/categories').catch(() => []),
      ]);
      setProducts(Array.isArray(prods) ? prods : []);
      setCategories(Array.isArray(cats) ? cats : []);
    } catch {
      toast.error('No se pudo cargar el catálogo de productos');
    }
  }, []);

  useEffect(() => {
    void load();
    void loadCatalog();
  }, [load, loadCatalog]);

  useSocket('staff-data-update', (p) => {
    if (p?.domain === 'promotions' || p?.domain === 'orders') void load();
    if (p?.domain === 'catalog') void loadCatalog();
  });

  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [menu]);

  const productsById = useMemo(() => new Map(products.map((p) => [String(p.id), p])), [products]);

  const promoProducts = useCallback(
    (p) => {
      const ids = new Set(p.product_ids || []);
      const catSet = new Set(p.category_ids || []);
      if (catSet.size) products.forEach((prod) => catSet.has(String(prod.category_id || '')) && ids.add(String(prod.id)));
      return [...ids].map((id) => productsById.get(id)).filter(Boolean);
    },
    [products, productsById],
  );

  const counts = useMemo(() => {
    const c = { all: data.promotions.length, active: 0, scheduled: 0, paused: 0, finished: 0 };
    data.promotions.forEach((p) => {
      c[p.computed_status] = (c[p.computed_status] || 0) + 1;
    });
    return c;
  }, [data.promotions]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.promotions.filter((p) => {
      if (statusFilter !== 'all' && p.computed_status !== statusFilter) return false;
      if (typeFilter !== 'all' && p.type !== typeFilter) return false;
      if (q && !`${p.name} ${p.description}`.toLowerCase().includes(q)) return false;
      const end = p.no_end_date ? '' : p.end_date;
      if (dateFrom && end && end < dateFrom) return false;
      if (dateTo && p.start_date && p.start_date > dateTo) return false;
      return true;
    });
  }, [data.promotions, search, statusFilter, typeFilter, dateFrom, dateTo]);

  const afterChange = async () => {
    await load();
    void refreshActivePromotions();
  };

  const openNew = () => {
    setEditingId('');
    setForm(emptyForm());
    setFormOpen(true);
  };

  const openEdit = (p) => {
    setEditingId(p.id);
    setForm(promotionToForm(p));
    setFormOpen(true);
  };

  const openDetail = async (p) => {
    setDetail({ ...p, recent_usages: null });
    try {
      const full = await api.get(`/promotions/${p.id}`);
      setDetail(full);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const setStatus = async (p, status) => {
    try {
      await api.patch(`/promotions/${p.id}/status`, { status });
      toast.success(status === 'paused' ? 'Promoción pausada' : 'Promoción activada');
      await afterChange();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const duplicate = async (p) => {
    try {
      await api.post(`/promotions/${p.id}/duplicate`, {});
      toast.success('Promoción duplicada (en pausa)');
      await afterChange();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const remove = async (p) => {
    if (!confirm(`¿Eliminar la promoción «${p.name}»? El historial de usos se conserva en los pedidos.`)) return;
    try {
      await api.delete(`/promotions/${p.id}`);
      toast.success('Promoción eliminada');
      setSelected((prev) => prev.filter((id) => id !== p.id));
      await afterChange();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const bulk = async (action) => {
    const list = data.promotions.filter((p) => selected.includes(p.id));
    if (!list.length) return;
    if (action === 'delete' && !confirm(`¿Eliminar ${list.length} promoción(es)?`)) return;
    try {
      for (const p of list) {
        if (action === 'delete') await api.delete(`/promotions/${p.id}`);
        else await api.patch(`/promotions/${p.id}/status`, { status: action });
      }
      toast.success('Cambios aplicados');
      setSelected([]);
      await afterChange();
    } catch (err) {
      toast.error(err.message);
      await afterChange();
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    const payload = formToPayload(form);
    const error = validatePromotionInput(payload);
    if (error) {
      toast.error(error);
      return;
    }
    setSaving(true);
    try {
      if (editingId) await api.put(`/promotions/${editingId}`, payload);
      else await api.post('/promotions', payload);
      toast.success(editingId ? 'Promoción actualizada' : 'Promoción creada');
      setFormOpen(false);
      await afterChange();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const previewProduct = useMemo(() => {
    const first = form.product_ids.map((id) => productsById.get(String(id))).find(Boolean);
    if (first) return first;
    if (form.category_ids.length) {
      return products.find((p) => form.category_ids.includes(String(p.category_id || ''))) || null;
    }
    return null;
  }, [form.product_ids, form.category_ids, productsById, products]);

  const preview = useMemo(() => {
    if (!previewProduct) return null;
    const draft = {
      ...formToPayload(form),
      id: editingId || 'draft',
      status: 'active',
      start_date: '',
      end_date: '',
      no_end_date: true,
      days: [],
      start_time: '',
      end_time: '',
      usage_limit: 0,
    };
    const clock = promotionEngine.clockFromDate(new Date());
    return promotionEngine.getProductPromotionPreview(previewProduct, [draft], clock);
  }, [form, previewProduct, editingId]);

  const summary = data.summary || {};
  const kpis = [
    {
      title: 'Promociones activas',
      value: summary.active || 0,
      Icon: MdLocalOffer,
      bubble: 'bg-emerald-100 text-emerald-600',
      bg: 'from-emerald-50/80 to-white',
      note: 'Vigentes en este momento',
    },
    {
      title: 'Productos en promoción',
      value: summary.promoted_products || 0,
      Icon: MdInventory2,
      bubble: 'bg-blue-100 text-blue-600',
      bg: 'from-blue-50/80 to-white',
      note: 'Con cinta en catálogo, QR, Mesas y Caja',
    },
    {
      title: 'Promociones utilizadas',
      value: summary.uses_month || 0,
      Icon: MdShoppingBag,
      bubble: 'bg-violet-100 text-violet-600',
      bg: 'from-violet-50/80 to-white',
      trend: trendPct(summary.uses_month, summary.uses_prev_month),
    },
    {
      title: 'Descuentos otorgados',
      value: formatCurrency(summary.discount_month || 0),
      Icon: MdSavings,
      bubble: 'bg-orange-100 text-orange-600',
      bg: 'from-orange-50/80 to-white',
      trend: trendPct(summary.discount_month, summary.discount_prev_month),
    },
  ];

  const allVisibleSelected = filtered.length > 0 && filtered.every((p) => selected.includes(p.id));
  const menuPromo = menu ? data.promotions.find((p) => p.id === menu.id) : null;
  const setF = (patch) => setForm((prev) => ({ ...prev, ...patch }));
  const valueField = VALUE_FIELD[form.type];

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-5 grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
        {kpis.map((k) => (
          <KpiCard key={k.title} {...k} />
        ))}
        <button
          type="button"
          onClick={openNew}
          className="flex h-full min-h-[6.5rem] items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 text-base font-semibold text-white shadow-md shadow-blue-600/30 transition hover:bg-blue-700 sm:col-span-2 lg:col-span-1"
        >
          <MdAdd className="text-2xl" /> Nueva promoción
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap gap-2">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setStatusFilter(t.key)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                statusFilter === t.key ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {t.label} <span className="ml-1 opacity-75">{counts[t.key] || 0}</span>
            </button>
          ))}
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-[14rem] flex-1">
            <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-lg text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar promoción..."
              className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-400"
          >
            <option value="all">Todos los estados</option>
            {Object.entries(PROMOTION_STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-400"
          >
            <option value="all">Todos los tipos</option>
            {PROMOTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {PROMOTION_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-2">
            <MdEvent className="text-slate-400" />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-9 bg-transparent text-sm text-slate-700 outline-none"
              aria-label="Desde"
            />
            <span className="text-slate-400">-</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-9 bg-transparent text-sm text-slate-700 outline-none"
              aria-label="Hasta"
            />
          </div>
        </div>

        {selected.length > 0 ? (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-blue-50 px-3 py-2 text-sm text-blue-800">
            <span className="font-semibold">{selected.length} seleccionada(s)</span>
            <button type="button" onClick={() => bulk('active')} className="rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-emerald-700 shadow-sm">
              Activar
            </button>
            <button type="button" onClick={() => bulk('paused')} className="rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-amber-700 shadow-sm">
              Pausar
            </button>
            <button type="button" onClick={() => bulk('delete')} className="rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-red-600 shadow-sm">
              Eliminar
            </button>
            <button type="button" onClick={() => setSelected([])} className="ml-auto text-xs font-medium text-blue-700 hover:underline">
              Quitar selección
            </button>
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="w-10 py-3 pl-2">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={() =>
                      setSelected(allVisibleSelected ? [] : filtered.map((p) => p.id))
                    }
                    className="rounded border-slate-300"
                    aria-label="Seleccionar todas"
                  />
                </th>
                <th className="py-3">Promoción</th>
                <th className="py-3">Tipo</th>
                <th className="py-3">Productos</th>
                <th className="py-3">Vigencia</th>
                <th className="py-3">Horario</th>
                <th className="py-3">Estado</th>
                <th className="py-3 text-right">Usos</th>
                <th className="py-3 text-right">Descuento total</th>
                <th className="py-3 pr-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-500">
                    <MdLocalOffer className="mx-auto mb-2 text-4xl text-slate-300" />
                    No hay promociones para estos filtros.
                  </td>
                </tr>
              ) : (
                filtered.map((p) => {
                  const items = promoProducts(p);
                  const isPaused = p.computed_status === 'paused';
                  return (
                    <tr key={p.id} className="border-b border-slate-100 align-middle hover:bg-slate-50/70">
                      <td className="py-3 pl-2">
                        <input
                          type="checkbox"
                          checked={selected.includes(p.id)}
                          onChange={() =>
                            setSelected((prev) => (prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id]))
                          }
                          className="rounded border-slate-300"
                          aria-label={`Seleccionar ${p.name}`}
                        />
                      </td>
                      <td className="max-w-[16rem] py-3">
                        <div className="flex items-center gap-3">
                          <span
                            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[10px] font-extrabold text-white shadow-sm"
                            style={{ background: promotionTone(p.type, p.id) }}
                          >
                            {promotionBadgeLabel(p)}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-slate-800" title={p.name}>
                              {p.name}
                            </p>
                            <p className="truncate text-xs text-slate-500" title={p.description || promoValueText(p)}>
                              {p.description || promoValueText(p)}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3">
                        <TypePill type={p.type} />
                      </td>
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-700 tabular-nums">{items.length}</span>
                          <div className="flex -space-x-2">
                            {items.slice(0, 3).map((prod) => (
                              <Thumb key={prod.id} product={prod} />
                            ))}
                          </div>
                          {items.length > 3 ? <span className="text-xs text-slate-500">+{items.length - 3}</span> : null}
                        </div>
                      </td>
                      <td className="whitespace-nowrap py-3 text-xs text-slate-600">{validityText(p)}</td>
                      <td className="py-3 text-xs text-slate-600">
                        <p className="whitespace-nowrap">{hoursText(p)}</p>
                        <p className="whitespace-nowrap text-slate-400">{daysText(p.days)}</p>
                      </td>
                      <td className="py-3">
                        <PromotionStatus status={p.computed_status} />
                      </td>
                      <td className="py-3 text-right tabular-nums text-slate-700">
                        {p.stats?.uses || 0}
                        {p.usage_limit ? <span className="text-xs text-slate-400"> / {p.usage_limit}</span> : null}
                      </td>
                      <td className="py-3 text-right font-semibold tabular-nums text-orange-600">
                        {formatCurrency(p.stats?.discount_total || 0)}
                      </td>
                      <td className="py-3 pr-2">
                        <div className="flex items-center justify-end gap-1">
                          <button type="button" onClick={() => openDetail(p)} className="rounded-lg p-1.5 text-slate-500 hover:bg-blue-50 hover:text-blue-600" title="Ver">
                            <MdVisibility />
                          </button>
                          <button type="button" onClick={() => openEdit(p)} className="rounded-lg p-1.5 text-slate-500 hover:bg-blue-50 hover:text-blue-600" title="Editar">
                            <MdEdit />
                          </button>
                          <button
                            type="button"
                            onClick={() => setStatus(p, isPaused ? 'active' : 'paused')}
                            className={`rounded-lg p-1.5 ${isPaused ? 'text-emerald-600 hover:bg-emerald-50' : 'text-amber-600 hover:bg-amber-50'}`}
                            title={isPaused ? 'Activar' : 'Pausar'}
                          >
                            {isPaused ? <MdPlayArrow /> : <MdPause />}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const r = e.currentTarget.getBoundingClientRect();
                              setMenu((prev) => (prev?.id === p.id ? null : { id: p.id, top: r.bottom + 4, left: Math.max(8, r.right - 176) }));
                            }}
                            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                            title="Más acciones"
                          >
                            <MdMoreVert />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {menu && menuPromo ? (
        <div
          className="fixed z-50 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-sm shadow-xl"
          style={{ top: menu.top, left: menu.left }}
          onClick={(e) => e.stopPropagation()}
        >
          <button type="button" onClick={() => { setMenu(null); void duplicate(menuPromo); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-slate-700 hover:bg-slate-50">
            <MdContentCopy /> Duplicar
          </button>
          <button type="button" onClick={() => { setMenu(null); void remove(menuPromo); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-red-600 hover:bg-red-50">
            <MdDelete /> Eliminar
          </button>
        </div>
      ) : null}

      <Modal isOpen={formOpen} onClose={() => setFormOpen(false)} title={editingId ? 'Editar promoción' : 'Nueva promoción'} size="full">
        <form onSubmit={submit} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="min-w-0 space-y-4">
            <FormSection title="Información general">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Nombre">
                  <input value={form.name} onChange={(e) => setF({ name: e.target.value })} className="input-field" required />
                </Field>
                <Field label="Estado">
                  <select value={form.status} onChange={(e) => setF({ status: e.target.value })} className="input-field">
                    <option value="active">Activa (según fechas y horario)</option>
                    <option value="paused">Pausada</option>
                  </select>
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Descripción">
                    <textarea value={form.description} onChange={(e) => setF({ description: e.target.value })} className="input-field" rows={2} />
                  </Field>
                </div>
                <Field label="Tipo de promoción" hint={TYPE_HINT[form.type]}>
                  <select value={form.type} onChange={(e) => setF({ type: e.target.value })} className="input-field">
                    {PROMOTION_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {PROMOTION_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </Field>
                {valueField ? (
                  <Field label={valueField.label}>
                    <input
                      type="number"
                      min="0"
                      max={valueField.max}
                      step={valueField.step}
                      value={form.value}
                      onChange={(e) => setF({ value: e.target.value })}
                      className="input-field"
                      required
                    />
                  </Field>
                ) : null}
              </div>
            </FormSection>

            <FormSection title={form.type === 'combo' ? 'Productos del combo' : 'Productos y categorías'}>
              <PromotionSelector
                products={products}
                categories={categories}
                productIds={form.product_ids}
                categoryIds={form.type === 'combo' ? [] : form.category_ids}
                allowCategories={form.type !== 'combo'}
                onChange={({ product_ids, category_ids }) => setF({ product_ids, category_ids })}
              />
            </FormSection>

            <FormSection title="Vigencia y horario">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Fecha de inicio">
                  <input type="date" value={form.start_date} onChange={(e) => setF({ start_date: e.target.value })} className="input-field" />
                </Field>
                <Field label="Fecha de fin">
                  <input
                    type="date"
                    value={form.no_end_date ? '' : form.end_date}
                    disabled={form.no_end_date}
                    onChange={(e) => setF({ end_date: e.target.value })}
                    className="input-field disabled:opacity-50"
                  />
                </Field>
                <label className="flex items-end gap-2 pb-2 text-sm text-slate-700">
                  <input type="checkbox" checked={form.no_end_date} onChange={(e) => setF({ no_end_date: e.target.checked })} className="rounded border-slate-300" />
                  Sin fecha de fin
                </label>
              </div>
              <div className="mt-3">
                <span className="mb-1.5 block text-xs font-semibold text-slate-600">Días de la semana (vacío = todos)</span>
                <div className="flex flex-wrap gap-1.5">
                  {DAY_OPTIONS.map((d) => {
                    const on = form.days.includes(d.value);
                    return (
                      <button
                        key={d.value}
                        type="button"
                        title={d.label}
                        onClick={() => setF({ days: on ? form.days.filter((x) => x !== d.value) : [...form.days, d.value] })}
                        className={`h-9 w-9 rounded-full text-xs font-bold transition ${
                          on ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {d.short}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Hora de inicio" hint="Vacío = todo el día">
                  <input type="time" value={form.start_time} onChange={(e) => setF({ start_time: e.target.value })} className="input-field" />
                </Field>
                <Field label="Hora de fin">
                  <input type="time" value={form.end_time} onChange={(e) => setF({ end_time: e.target.value })} className="input-field" />
                </Field>
              </div>
            </FormSection>

            <FormSection title="Reglas">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label={form.type === 'quantity' ? 'Cantidad mínima (obligatoria)' : 'Cantidad mínima por producto'}>
                  <input type="number" min="0" step="1" value={form.min_quantity} onChange={(e) => setF({ min_quantity: e.target.value })} className="input-field" />
                </Field>
                <Field label="Compra mínima del pedido (S/)">
                  <input type="number" min="0" step="0.01" value={form.min_purchase} onChange={(e) => setF({ min_purchase: e.target.value })} className="input-field" />
                </Field>
                <Field label="Prioridad" hint="Mayor número gana si hay varias">
                  <input type="number" step="1" value={form.priority} onChange={(e) => setF({ priority: e.target.value })} className="input-field" />
                </Field>
                <Field label="Límite total de usos" hint="Pedidos; vacío = sin límite">
                  <input type="number" min="0" step="1" value={form.usage_limit} onChange={(e) => setF({ usage_limit: e.target.value })} className="input-field" />
                </Field>
                <Field label="Límite por cliente" hint="Solo con cliente identificado">
                  <input type="number" min="0" step="1" value={form.per_customer_limit} onChange={(e) => setF({ per_customer_limit: e.target.value })} className="input-field" />
                </Field>
                <label className="flex items-start gap-2 pt-6 text-sm text-slate-700">
                  <input type="checkbox" checked={form.combinable} onChange={(e) => setF({ combinable: e.target.checked })} className="mt-0.5 rounded border-slate-300" />
                  <span>
                    Combinable
                    <span className="block text-[11px] text-slate-500">Se suma a otra promoción también combinable</span>
                  </span>
                </label>
              </div>
            </FormSection>
          </div>

          <aside className="space-y-3 lg:sticky lg:top-0 lg:self-start">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Vista previa</p>
              {previewProduct ? (
                <PromotionCard product={previewProduct} preview={preview} formatCurrency={formatCurrency} />
              ) : (
                <div className="grid aspect-[4/3] place-items-center rounded-xl border border-dashed border-slate-300 bg-white px-4 text-center text-xs text-slate-500">
                  Selecciona un producto para ver cómo se verá en el catálogo
                </div>
              )}
              <div className="mt-3 space-y-1 text-xs text-slate-600">
                <p className="font-semibold text-slate-800">{form.name || 'Nombre de la promoción'}</p>
                <p>{promoValueText({ ...formToPayload(form) })}</p>
                <p className="flex items-center gap-1">
                  <MdEvent className="text-slate-400" /> {validityText(formToPayload(form))}
                </p>
                <p className="flex items-center gap-1">
                  <MdSchedule className="text-slate-400" /> {daysText(form.days)} · {hoursText(form)}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setFormOpen(false)} className="btn-secondary flex-1">
                Cancelar
              </button>
              <button type="submit" disabled={saving} className="btn-primary flex-1 disabled:opacity-60">
                {saving ? 'Guardando…' : editingId ? 'Guardar' : 'Crear'}
              </button>
            </div>
          </aside>
        </form>
      </Modal>

      <Modal isOpen={Boolean(detail)} onClose={() => setDetail(null)} title="Detalle de la promoción" size="xl">
        {detail ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className="grid h-12 w-12 shrink-0 place-items-center rounded-xl text-xs font-extrabold text-white"
                  style={{ background: promotionTone(detail.type, detail.id) }}
                >
                  {promotionBadgeLabel(detail)}
                </span>
                <div className="min-w-0">
                  <h3 className="truncate text-lg font-bold text-slate-900">{detail.name}</h3>
                  <p className="text-sm text-slate-500">{detail.description || promoValueText(detail)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <TypePill type={detail.type} />
                <PromotionStatus status={detail.computed_status} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                ['Usos (pedidos)', detail.stats?.uses || 0],
                ['Productos vendidos', detail.stats?.items_sold || 0],
                ['Total descontado', formatCurrency(detail.stats?.discount_total || 0)],
                ['Ingresos generados', formatCurrency(detail.stats?.revenue_total || 0)],
                ['Ahorro de clientes', formatCurrency(detail.stats?.savings_total || 0)],
                ['Límite de usos', detail.usage_limit ? `${detail.uses || 0} / ${detail.usage_limit}` : 'Sin límite'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">{label}</p>
                  <p className="mt-1 text-lg font-bold text-slate-900 tabular-nums">{value}</p>
                </div>
              ))}
            </div>

            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 p-3">
                <p className="mb-1 text-xs font-semibold uppercase text-slate-500">Vigencia y horario</p>
                <p>{validityText(detail)}</p>
                <p className="text-slate-600">
                  {daysText(detail.days)} · {hoursText(detail)}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 p-3">
                <p className="mb-1 text-xs font-semibold uppercase text-slate-500">Reglas</p>
                <p className="text-slate-600">
                  {detail.min_quantity ? `Mín. ${detail.min_quantity} unid. · ` : ''}
                  {detail.min_purchase ? `Compra mín. ${formatCurrency(detail.min_purchase)} · ` : ''}
                  {detail.per_customer_limit ? `Máx. ${detail.per_customer_limit} por cliente · ` : ''}
                  Prioridad {detail.priority || 0} · {detail.combinable ? 'Combinable' : 'No combinable'}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-3">
              <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Productos</p>
              <div className="flex flex-wrap gap-2">
                {promoProducts(detail).map((prod) => (
                  <span key={prod.id} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 py-0.5 pl-0.5 pr-2.5 text-xs text-slate-700">
                    <Thumb product={prod} size="h-6 w-6" />
                    {prod.name}
                  </span>
                ))}
                {(detail.category_ids || []).map((cid) => {
                  const cat = categories.find((c) => String(c.id) === String(cid));
                  return cat ? (
                    <span key={cid} className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                      Categoría: {cat.name}
                    </span>
                  ) : null;
                })}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-3">
              <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Últimos usos</p>
              {detail.recent_usages == null ? (
                <p className="py-3 text-center text-sm text-slate-500">Cargando…</p>
              ) : detail.recent_usages.length === 0 ? (
                <p className="py-3 text-center text-sm text-slate-500">Aún no se ha usado esta promoción.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-xs">
                    <thead>
                      <tr className="border-b text-left text-slate-500">
                        <th className="py-1.5">Pedido</th>
                        <th className="py-1.5">Producto</th>
                        <th className="py-1.5 text-right">Cant.</th>
                        <th className="py-1.5 text-right">Original</th>
                        <th className="py-1.5 text-right">Descuento</th>
                        <th className="py-1.5 text-right">Final</th>
                        <th className="py-1.5">Origen</th>
                        <th className="py-1.5">Fecha</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.recent_usages.map((u) => (
                        <tr key={u.id} className="border-b border-slate-100">
                          <td className="py-1.5">#{u.order_number || String(u.order_id || '').slice(0, 6)}</td>
                          <td className="py-1.5">{u.product_name}</td>
                          <td className="py-1.5 text-right tabular-nums">{u.quantity}</td>
                          <td className="py-1.5 text-right tabular-nums">{formatCurrency(u.original_amount)}</td>
                          <td className="py-1.5 text-right tabular-nums text-orange-600">-{formatCurrency(u.discount_amount)}</td>
                          <td className="py-1.5 text-right font-semibold tabular-nums">{formatCurrency(u.final_amount)}</td>
                          <td className="py-1.5">{u.user_name || u.source}</td>
                          <td className="py-1.5 whitespace-nowrap">{String(u.created_at || '').slice(0, 16).replace('T', ' ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => { const d = detail; setDetail(null); openEdit(d); }} className="btn-secondary flex items-center gap-1.5">
                <MdEdit /> Editar
              </button>
              <button type="button" onClick={() => { void duplicate(detail); }} className="btn-secondary flex items-center gap-1.5">
                <MdContentCopy /> Duplicar
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
