import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, formatCurrency, formatDate, parseApiDate, toLocalDateKey } from '../../utils/api';
import { useSocket } from '../../hooks/useSocket';
import { getOrderChargeTotal } from '../../utils/mesaOrderLines';
import {
  MdAdd, MdEdit, MdDelete, MdSearch, MdPhone, MdEmail, MdAttachMoney, MdContentCopy,
  MdPeople, MdPersonAdd, MdCreditCard, MdStar, MdChevronRight, MdChevronLeft, MdVisibility,
  MdMoreVert, MdFileDownload, MdCalendarToday, MdBusiness, MdRepeat, MdFiberNew, MdClose,
  MdCheckCircle, MdLocationOn,
} from 'react-icons/md';
import Modal from '../../components/Modal';
import toast from 'react-hot-toast';

const PAGE_SIZE = 10;
const ACTIVE_DAYS = 60;
const FREQUENT_VISITS = 5;

const AVATAR_COLORS = [
  'bg-blue-100 text-blue-700',
  'bg-emerald-100 text-emerald-700',
  'bg-violet-100 text-violet-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-cyan-100 text-cyan-700',
];

const TYPE_META = {
  empresa: { label: 'Empresa', Icon: MdBusiness, cls: 'bg-indigo-50 text-indigo-700 ring-indigo-200' },
  frecuente: { label: 'Frecuente', Icon: MdStar, cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
  regular: { label: 'Regular', Icon: MdRepeat, cls: 'bg-blue-50 text-blue-700 ring-blue-200' },
  nuevo: { label: 'Nuevo', Icon: MdFiberNew, cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
};

const EMPTY_FORM = { name: '', phone: '', email: '', address: '', password: '', doc_type: '1', doc_number: '' };

function selfOrderClienteUrl(customerId) {
  const base = typeof window !== 'undefined' ? window.location.origin : '';
  return `${base}/auto-pedido-cliente?cliente=${encodeURIComponent(customerId)}`;
}

function orderTotalPieces(o) {
  return (o.items || []).reduce((sum, it) => sum + Number(it.quantity || 0), 0);
}

function orderProductsShortLabel(o) {
  const items = o.items || [];
  if (!items.length) return '—';
  const names = items.map((it) => String(it.product_name || '').trim()).filter(Boolean);
  const unique = [...new Set(names)];
  let s = unique.join(', ');
  if (s.length > 42) s = `${s.slice(0, 39)}…`;
  return s;
}

function pedidoColumnText(o) {
  const n = o.order_number ?? '-';
  return `#${n} ${orderProductsShortLabel(o)}`.trim();
}

function visibleEmail(email) {
  const e = String(email || '').trim();
  return e.endsWith('@local.resto') ? '' : e;
}

function docLabel(c) {
  const num = String(c.doc_number || '').trim();
  if (!num) return 'Sin documento';
  if (String(c.doc_type) === '6') return `RUC: ${num}`;
  if (String(c.doc_type) === '1') return `DNI: ${num}`;
  return `Doc: ${num}`;
}

function daysSince(date) {
  if (!date) return null;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
}

function daysAgoLabel(days) {
  if (days == null) return '';
  if (days === 0) return 'Hoy';
  if (days === 1) return 'Hace 1 día';
  return `Hace ${days} días`;
}

function avatarColor(name) {
  const s = String(name || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function Clientes() {
  const navigate = useNavigate();
  const [clientes, setClientes] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [openMenuId, setOpenMenuId] = useState('');
  const [viewClientId, setViewClientId] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editClient, setEditClient] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const searchRef = useRef('');

  const load = useCallback(async (term) => {
    const q = term !== undefined && term !== null ? String(term) : searchRef.current;
    setLoading(true);
    try {
      const [data, ordersData] = await Promise.all([
        api.get(`/admin-modules/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`),
        api.get('/orders?limit=600').catch(() => []),
      ]);
      setClientes(data || []);
      setOrders(ordersData || []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    searchRef.current = search;
  }, [search]);

  useEffect(() => {
    load('');
  }, [load]);

  useSocket('staff-data-update', (p) => {
    if (p?.domain === 'customers') void load('');
  });
  useSocket('order-update', () => {
    void load('');
  });

  useEffect(() => {
    if (!openMenuId) return undefined;
    const close = () => setOpenMenuId('');
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [openMenuId]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, dateFrom, dateTo]);

  const normalizeCustomerEmail = (value) => {
    const raw = String(value || '').trim();
    if (!raw || raw.toLowerCase() === '@gmail.com') return '';
    if (raw.includes('@')) return raw;
    return `${raw}@gmail.com`;
  };

  const pendingOrdersByCustomer = useMemo(() => {
    const map = {};
    (orders || []).forEach((o) => {
      if (String(o.payment_status || '') === 'paid' || String(o.status || '') === 'cancelled') return;
      const cid = String(o.customer_id || '').trim();
      if (!cid) return;
      if (!map[cid]) map[cid] = [];
      map[cid].push(o);
    });
    return map;
  }, [orders]);

  const getCustomerPendingTotal = useCallback(
    (customerId) => (pendingOrdersByCustomer[customerId] || []).reduce((sum, o) => sum + getOrderChargeTotal(o), 0),
    [pendingOrdersByCustomer]
  );

  const enriched = useMemo(() => clientes.map((c) => {
    const lastDate = c.last_visit && c.last_visit !== '-' ? parseApiDate(c.last_visit) : null;
    const createdDate = parseApiDate(c.created_at);
    const lastDays = daysSince(lastDate);
    const createdDays = daysSince(createdDate);
    const visits = Number(c.visits || 0);
    const debt = getCustomerPendingTotal(c.id);
    const active = lastDays != null ? lastDays <= ACTIVE_DAYS : (createdDays != null && createdDays <= 30);
    let type = 'nuevo';
    if (String(c.doc_type) === '6') type = 'empresa';
    else if (visits >= FREQUENT_VISITS) type = 'frecuente';
    else if (visits >= 2) type = 'regular';
    return {
      ...c,
      _lastDate: lastDate,
      _lastKey: lastDate ? toLocalDateKey(lastDate) : '',
      _lastDays: lastDays,
      _createdDate: createdDate,
      _visits: visits,
      _debt: debt,
      _pendingCount: (pendingOrdersByCustomer[c.id] || []).length,
      _active: active,
      _type: type,
      _email: visibleEmail(c.email),
    };
  }), [clientes, getCustomerPendingTotal, pendingOrdersByCustomer]);

  const kpis = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    return {
      total: enriched.length,
      newThisMonth: enriched.filter((c) => c._createdDate && c._createdDate >= monthStart).length,
      active: enriched.filter((c) => c._active).length,
      withDebt: enriched.filter((c) => c._debt > 0).length,
      debtTotal: enriched.reduce((s, c) => s + c._debt, 0),
      frequent: enriched.filter((c) => c._visits >= FREQUENT_VISITS).length,
    };
  }, [enriched]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return enriched.filter((c) => {
      if (term) {
        const hay = [c.name, c.phone, c.doc_number, c._email].map((v) => String(v || '').toLowerCase());
        if (!hay.some((v) => v.includes(term))) return false;
      }
      if (statusFilter === 'active' && !c._active) return false;
      if (statusFilter === 'inactive' && c._active) return false;
      if (statusFilter === 'debt' && !(c._debt > 0)) return false;
      if (statusFilter === 'frequent' && c._visits < FREQUENT_VISITS) return false;
      if (statusFilter === 'empresa' && c._type !== 'empresa') return false;
      if (dateFrom || dateTo) {
        if (!c._lastKey) return false;
        if (dateFrom && c._lastKey < dateFrom) return false;
        if (dateTo && c._lastKey > dateTo) return false;
      }
      return true;
    });
  }, [enriched, search, statusFilter, dateFrom, dateTo]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const rangeStart = filtered.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0;
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, filtered.length);
  const allPageSelected = pageRows.length > 0 && pageRows.every((c) => selectedIds.has(c.id));

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectPage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPageSelected) pageRows.forEach((c) => next.delete(c.id));
      else pageRows.forEach((c) => next.add(c.id));
      return next;
    });
  };

  const exportCsv = () => {
    const rows = selectedIds.size ? filtered.filter((c) => selectedIds.has(c.id)) : filtered;
    if (!rows.length) return toast.error('No hay clientes para exportar');
    const header = ['Nombre', 'Documento', 'Teléfono', 'Correo', 'Dirección', 'Tipo', 'Estado', 'Visitas', 'Consumo total', 'Deuda pendiente', 'Última compra'];
    const lines = rows.map((c) => [
      c.name,
      c.doc_number ? docLabel(c) : '',
      c.phone,
      c._email,
      c.address,
      TYPE_META[c._type].label,
      c._active ? 'Activo' : 'Inactivo',
      c._visits,
      Number(c.total_spent || 0).toFixed(2),
      c._debt.toFixed(2),
      c._lastDate ? formatDate(c.last_visit) : '',
    ].map(csvCell).join(';'));
    const blob = new Blob([`\uFEFF${header.join(';')}\n${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clientes_${toLocalDateKey(new Date())}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success(`${rows.length} cliente(s) exportado(s)`);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...form,
        email: normalizeCustomerEmail(form.email) || (editClient ? editClient.email : ''),
      };
      if (editClient) {
        await api.put(`/admin-modules/customers/${editClient.id}`, payload);
        toast.success('Cliente actualizado');
      } else {
        await api.post('/admin-modules/customers', payload);
        toast.success('Cliente registrado');
      }
      setShowModal(false);
      setEditClient(null);
      setForm(EMPTY_FORM);
      load('');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const openEdit = (c) => {
    setEditClient(c);
    setForm({
      name: c.name || '',
      phone: c.phone || '',
      email: visibleEmail(c.email),
      address: c.address || '',
      password: '',
      doc_type: String(c.doc_type || '1'),
      doc_number: c.doc_number || '',
    });
    setShowModal(true);
  };
  const openNew = () => {
    setEditClient(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  };
  const deleteClient = async (id) => {
    if (!confirm('¿Eliminar cliente?')) return;
    try {
      await api.delete(`/admin-modules/customers/${id}`);
      toast.success('Cliente eliminado');
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      load('');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const copyClienteSelfOrderLink = (customerId) => {
    const url = selfOrderClienteUrl(customerId);
    navigator.clipboard.writeText(url).then(() => toast.success('Enlace copiado')).catch(() => toast.error('No se pudo copiar'));
  };

  const goToCajaToChargeCustomer = (customer) => {
    const customerOrders = pendingOrdersByCustomer[customer.id] || [];
    if (!customerOrders.length) return toast.error('No hay pedidos pendientes para cobrar');
    navigate('/admin/caja?view=cobrar', {
      state: {
        clientCheckout: {
          customerId: customer.id,
          customerName: customer.name,
          orderIds: customerOrders.map((o) => o.id),
          customerForBilling: {
            doc_type: customer.doc_type,
            doc_number: customer.doc_number,
            name: customer.name,
            address: customer.address || '',
            phone: customer.phone || '',
          },
        },
      },
    });
  };

  const viewClient = viewClientId ? enriched.find((c) => c.id === viewClientId) : null;
  const filtersActive = search || statusFilter !== 'all' || dateFrom || dateTo;

  const kpiCards = [
    {
      key: 'total',
      title: 'Total de clientes',
      value: kpis.total,
      hint: `+${kpis.newThisMonth} nuevos este mes`,
      Icon: MdPeople,
      bubble: 'bg-blue-100 text-blue-600',
      bg: 'from-blue-50/80 to-white',
      filter: 'all',
    },
    {
      key: 'active',
      title: 'Clientes activos',
      value: kpis.active,
      hint: `compraron en ${ACTIVE_DAYS} días`,
      Icon: MdPersonAdd,
      bubble: 'bg-emerald-100 text-emerald-600',
      bg: 'from-emerald-50/80 to-white',
      filter: 'active',
    },
    {
      key: 'debt',
      title: 'Con crédito',
      value: kpis.withDebt,
      hint: `${formatCurrency(kpis.debtTotal)} por cobrar`,
      Icon: MdCreditCard,
      bubble: 'bg-violet-100 text-violet-600',
      bg: 'from-violet-50/80 to-white',
      filter: 'debt',
    },
    {
      key: 'frequent',
      title: 'Clientes frecuentes',
      value: kpis.frequent,
      hint: `${FREQUENT_VISITS}+ visitas pagadas`,
      Icon: MdStar,
      bubble: 'bg-amber-100 text-amber-600',
      bg: 'from-amber-50/80 to-white',
      filter: 'frequent',
    },
  ];

  return (
    <div>
      <div className="mb-5 grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
        {kpiCards.map((k) => (
          <button
            key={k.key}
            type="button"
            onClick={() => setStatusFilter(k.filter)}
            className={`group flex h-full items-center gap-4 rounded-2xl border bg-gradient-to-br p-5 text-left shadow-sm transition hover:shadow-md ${k.bg} ${
              statusFilter === k.filter && k.filter !== 'all' ? 'border-blue-400 ring-2 ring-blue-100' : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            <span className={`grid h-14 w-14 shrink-0 place-items-center rounded-full ${k.bubble}`}>
              <k.Icon className="text-2xl" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-slate-800">{k.title}</span>
              <span className="mt-1 block text-3xl font-bold leading-none text-slate-900 tabular-nums">{k.value}</span>
              <span className="mt-1.5 block truncate text-xs text-slate-500">{k.hint}</span>
            </span>
            <MdChevronRight className="shrink-0 text-2xl text-slate-300 transition group-hover:text-slate-500" />
          </button>
        ))}
        <button
          type="button"
          onClick={openNew}
          className="flex h-full min-h-[6.5rem] items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 text-base font-semibold text-white shadow-md shadow-blue-600/30 transition hover:bg-blue-700 sm:col-span-2 lg:col-span-1"
        >
          <MdAdd className="text-2xl" /> Nuevo Cliente
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-[14rem] flex-1">
            <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-lg text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre, teléfono, DNI o correo..."
              className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          >
            <option value="all">Todos los estados</option>
            <option value="active">Activos</option>
            <option value="inactive">Inactivos</option>
            <option value="debt">Con crédito / deuda</option>
            <option value="frequent">Frecuentes</option>
            <option value="empresa">Empresas (RUC)</option>
          </select>
          <div className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700" title="Rango de última compra">
            <MdCalendarToday className="text-slate-400" />
            <input
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => setDateFrom(e.target.value)}
              className="bg-transparent text-sm outline-none"
              aria-label="Desde"
            />
            <span className="text-slate-400">-</span>
            <input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => setDateTo(e.target.value)}
              className="bg-transparent text-sm outline-none"
              aria-label="Hasta"
            />
          </div>
          {filtersActive && (
            <button
              type="button"
              onClick={() => { setSearch(''); setStatusFilter('all'); setDateFrom(''); setDateTo(''); }}
              className="inline-flex h-10 items-center gap-1 rounded-xl px-3 text-sm font-medium text-slate-500 hover:bg-slate-100"
            >
              <MdClose /> Limpiar
            </button>
          )}
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <MdFileDownload className="text-lg" />
            Exportar{selectedIds.size ? ` (${selectedIds.size})` : ''}
          </button>
        </div>

        {loading && !clientes.length ? (
          <div className="py-10 text-center text-slate-500">Cargando clientes...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="w-10 py-3 pl-2">
                    <input type="checkbox" checked={allPageSelected} onChange={toggleSelectPage} className="h-4 w-4 rounded border-slate-300" aria-label="Seleccionar página" />
                  </th>
                  <th className="py-3 pr-3">Cliente</th>
                  <th className="py-3 pr-3">Contacto</th>
                  <th className="py-3 pr-3">Tipo</th>
                  <th className="py-3 pr-3">Estado</th>
                  <th className="py-3 pr-3">Crédito / Deuda</th>
                  <th className="py-3 pr-3">Última compra</th>
                  <th className="py-3 pr-2 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((c) => {
                  const type = TYPE_META[c._type];
                  return (
                    <tr key={c.id} className={`border-b border-slate-100 transition hover:bg-slate-50 ${selectedIds.has(c.id) ? 'bg-blue-50/50' : ''}`}>
                      <td className="py-3 pl-2">
                        <input type="checkbox" checked={selectedIds.has(c.id)} onChange={() => toggleSelect(c.id)} className="h-4 w-4 rounded border-slate-300" aria-label={`Seleccionar ${c.name}`} />
                      </td>
                      <td className="py-3 pr-3">
                        <button type="button" onClick={() => setViewClientId(c.id)} className="flex items-center gap-3 text-left">
                          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-base font-bold ${avatarColor(c.name)}`}>
                            {String(c.name || '?').trim().charAt(0).toUpperCase()}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-semibold text-slate-900">{c.name}</span>
                            <span className="block text-xs text-slate-500">{docLabel(c)}</span>
                          </span>
                        </button>
                      </td>
                      <td className="py-3 pr-3">
                        <span className="flex items-center gap-1.5 text-slate-700">
                          <MdPhone className="text-slate-400" /> {c.phone || '—'}
                        </span>
                        <span className="mt-0.5 flex max-w-[14rem] items-center gap-1.5 truncate text-xs text-slate-500">
                          <MdEmail className="shrink-0 text-slate-400" /> <span className="truncate">{c._email || '—'}</span>
                        </span>
                      </td>
                      <td className="py-3 pr-3">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${type.cls}`}>
                          <type.Icon /> {type.label}
                        </span>
                      </td>
                      <td className="py-3 pr-3">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${c._active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${c._active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                          {c._active ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      <td className="py-3 pr-3">
                        <span className={`block font-semibold tabular-nums ${c._debt > 0 ? 'text-rose-600' : 'text-slate-700'}`}>
                          {formatCurrency(c._debt)}
                        </span>
                        <span className="block text-xs text-slate-500">
                          {c._pendingCount ? `${c._pendingCount} pedido(s) pendiente(s)` : `Consumo: ${formatCurrency(c.total_spent || 0)}`}
                        </span>
                      </td>
                      <td className="py-3 pr-3">
                        {c._lastDate ? (
                          <>
                            <span className="block text-slate-700">{formatDate(c.last_visit)}</span>
                            <span className="block text-xs text-slate-500">{daysAgoLabel(c._lastDays)}</span>
                          </>
                        ) : (
                          <span className="text-xs text-slate-400">Sin compras</span>
                        )}
                      </td>
                      <td className="py-3 pr-2">
                        <div className="relative flex items-center justify-end gap-1">
                          <button type="button" onClick={() => setViewClientId(c.id)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-blue-600" title="Ver detalle">
                            <MdVisibility />
                          </button>
                          <button type="button" onClick={() => openEdit(c)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-blue-600" title="Editar">
                            <MdEdit />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setOpenMenuId((prev) => (prev === c.id ? '' : c.id)); }}
                            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                            title="Más opciones"
                          >
                            <MdMoreVert />
                          </button>
                          {openMenuId === c.id && (
                            <div className="absolute right-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-left shadow-lg">
                              <button type="button" onClick={() => goToCajaToChargeCustomer(c)} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                                <MdAttachMoney className="text-emerald-600" /> Ir a caja a cobrar
                              </button>
                              <button type="button" onClick={() => copyClienteSelfOrderLink(c.id)} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                                <MdContentCopy className="text-blue-600" /> Copiar enlace auto-pedido
                              </button>
                              <button type="button" onClick={() => deleteClient(c.id)} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-rose-600 hover:bg-rose-50">
                                <MdDelete /> Eliminar cliente
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length === 0 && <p className="py-8 text-center text-slate-500">No se encontraron clientes</p>}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 text-sm text-slate-500">
          <span>
            Mostrando {rangeStart} - {rangeEnd} de {filtered.length} clientes
            {selectedIds.size ? ` · ${selectedIds.size} seleccionado(s)` : ''}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setPage(currentPage - 1)}
              className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              aria-label="Página anterior"
            >
              <MdChevronLeft />
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((n) => n === 1 || n === totalPages || Math.abs(n - currentPage) <= 1)
              .map((n, idx, arr) => (
                <span key={n} className="flex items-center gap-1">
                  {idx > 0 && n - arr[idx - 1] > 1 && <span className="px-1">…</span>}
                  <button
                    type="button"
                    onClick={() => setPage(n)}
                    className={`h-9 min-w-[2.25rem] rounded-lg px-2 font-semibold ${n === currentPage ? 'bg-blue-600 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                  >
                    {n}
                  </button>
                </span>
              ))}
            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => setPage(currentPage + 1)}
              className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              aria-label="Página siguiente"
            >
              <MdChevronRight />
            </button>
          </div>
        </div>
      </div>

      <Modal isOpen={!!viewClient} onClose={() => setViewClientId('')} title="Detalle del cliente" size="lg">
        {viewClient && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-4">
              <span className={`grid h-14 w-14 shrink-0 place-items-center rounded-full text-xl font-bold ${avatarColor(viewClient.name)}`}>
                {String(viewClient.name || '?').trim().charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-lg font-bold text-slate-900">{viewClient.name}</p>
                <p className="text-sm text-slate-500">{docLabel(viewClient)}</p>
              </div>
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${TYPE_META[viewClient._type].cls}`}>
                {TYPE_META[viewClient._type].label}
              </span>
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${viewClient._active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                <MdCheckCircle /> {viewClient._active ? 'Activo' : 'Inactivo'}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2 text-sm text-slate-700 sm:grid-cols-3">
              <p className="flex items-center gap-2"><MdPhone className="text-slate-400" /> {viewClient.phone || '—'}</p>
              <p className="flex min-w-0 items-center gap-2"><MdEmail className="shrink-0 text-slate-400" /> <span className="truncate">{viewClient._email || '—'}</span></p>
              <p className="flex min-w-0 items-center gap-2"><MdLocationOn className="shrink-0 text-slate-400" /> <span className="truncate">{viewClient.address || '—'}</span></p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['Visitas', viewClient._visits],
                ['Consumo total', formatCurrency(viewClient.total_spent || 0)],
                ['Deuda pendiente', formatCurrency(viewClient._debt)],
                ['Última compra', viewClient._lastDate ? daysAgoLabel(viewClient._lastDays) : 'Sin compras'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">{label}</p>
                  <p className="mt-1 font-bold tabular-nums text-slate-900">{value}</p>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <p className="mb-2 text-xs font-semibold text-slate-900">Pedidos pendientes por cobrar</p>
              {(pendingOrdersByCustomer[viewClient.id] || []).length === 0 ? (
                <p className="text-xs text-slate-700">No tiene pedidos pendientes.</p>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-[minmax(4.5rem,0.85fr)_minmax(0,1fr)_2.25rem_4.25rem] gap-x-2 border-b border-slate-200 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    <span>Fecha</span>
                    <span className="min-w-0">Pedido</span>
                    <span className="text-right">Cant.</span>
                    <span className="text-right">Precio</span>
                  </div>
                  {(pendingOrdersByCustomer[viewClient.id] || []).map((o) => (
                    <div
                      key={o.id}
                      className="grid grid-cols-[minmax(4.5rem,0.85fr)_minmax(0,1fr)_2.25rem_4.25rem] items-center gap-x-2 border-b border-slate-100 py-1.5 text-xs last:border-0"
                    >
                      <span className="shrink-0 text-slate-700">{formatDate(o.created_at)}</span>
                      <span className="min-w-0 break-words font-medium leading-snug text-slate-900" title={pedidoColumnText(o)}>
                        {pedidoColumnText(o)}
                      </span>
                      <span className="text-right tabular-nums text-slate-800">{orderTotalPieces(o)}</span>
                      <span className="text-right tabular-nums font-medium text-slate-900">{formatCurrency(getOrderChargeTotal(o))}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between border-t border-slate-200 pt-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total a cobrar</span>
                    <span className="text-lg font-bold tabular-nums text-slate-900">{formatCurrency(viewClient._debt)}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => goToCajaToChargeCustomer(viewClient)}
                    className="btn-primary flex w-full items-center justify-center gap-2"
                  >
                    <MdAttachMoney />
                    Ir a caja a cobrar
                  </button>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=96x96&data=${encodeURIComponent(selfOrderClienteUrl(viewClient.id))}`}
                alt="QR auto-pedido"
                className="h-24 w-24 shrink-0 rounded border border-slate-200 bg-white p-0.5"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900">Auto-pedido del cliente</p>
                <p className="text-xs text-slate-500">El cliente puede escanear este QR para hacer pedidos a su nombre.</p>
              </div>
              <button
                type="button"
                onClick={() => copyClienteSelfOrderLink(viewClient.id)}
                className="btn-secondary inline-flex shrink-0 items-center gap-1.5 px-3 py-2 text-sm"
              >
                <MdContentCopy /> Copiar
              </button>
            </div>

            <div className="flex gap-3">
              <button type="button" onClick={() => { const c = viewClient; setViewClientId(''); openEdit(c); }} className="btn-secondary flex flex-1 items-center justify-center gap-2">
                <MdEdit /> Editar
              </button>
              <button type="button" onClick={() => setViewClientId('')} className="btn-primary flex-1">Cerrar</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditClient(null); }} title={editClient ? 'Editar Cliente' : 'Nuevo Cliente'} size="md">
        <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
          {/* Campos señuelo para desviar autofill agresivo del navegador */}
          <input type="text" name="fake-username" autoComplete="username" className="hidden" tabIndex={-1} aria-hidden="true" />
          <input type="password" name="fake-password" autoComplete="current-password" className="hidden" tabIndex={-1} aria-hidden="true" />
          <div><label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Nombre Completo</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="input-field" required /></div>
          <div className="grid grid-cols-[8rem_1fr] gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Documento</label>
              <select value={form.doc_type} onChange={e => setForm({ ...form, doc_type: e.target.value })} className="input-field">
                <option value="1">DNI</option>
                <option value="6">RUC</option>
                <option value="0">Otro</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Número</label>
              <input name="customer-create-doc" autoComplete="off" inputMode="numeric" value={form.doc_number} onChange={e => setForm({ ...form, doc_number: e.target.value.trim() })} className="input-field" placeholder={form.doc_type === '6' ? '11 dígitos' : form.doc_type === '1' ? '8 dígitos' : ''} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Teléfono</label><input name="customer-create-phone" autoComplete="off" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="input-field" /></div>
            <div><label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Email</label><input type="text" name="customer-create-email" autoComplete="off" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} onBlur={e => setForm(prev => ({ ...prev, email: normalizeCustomerEmail(e.target.value) }))} className="input-field" placeholder="@gmail.com" /></div>
          </div>
          <div><label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Dirección</label><input name="customer-create-address" autoComplete="off" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Contraseña {editClient ? '(opcional para actualizar)' : '(opcional, por defecto cliente123)'}</label><input type="password" name="customer-create-password" autoComplete="new-password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} className="input-field" /></div>
          <div className="flex gap-3"><button type="button" onClick={() => setShowModal(false)} className="btn-secondary flex-1">Cancelar</button><button type="submit" className="btn-primary flex-1">{editClient ? 'Guardar' : 'Registrar'}</button></div>
        </form>
      </Modal>
    </div>
  );
}
