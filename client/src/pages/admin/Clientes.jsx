import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, formatCurrency, formatDate } from '../../utils/api';
import { useSocket } from '../../hooks/useSocket';
import { getOrderChargeTotal } from '../../utils/mesaOrderLines';
import { MdAdd, MdEdit, MdDelete, MdSearch, MdPhone, MdEmail, MdReceipt, MdAttachMoney, MdContentCopy } from 'react-icons/md';
import Modal from '../../components/Modal';
import toast from 'react-hot-toast';

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

export default function Clientes() {
  const navigate = useNavigate();
  const [clientes, setClientes] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editClient, setEditClient] = useState(null);
  const [expandedClientId, setExpandedClientId] = useState('');
  const [form, setForm] = useState({ name: '', phone: '', email: '', address: '', password: '' });
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
    if (p?.domain === 'customers') void load(searchRef.current);
  });
  useSocket('order-update', () => {
    void load(searchRef.current);
  });

  const normalizeCustomerEmail = (value) => {
    const raw = String(value || '').trim();
    if (!raw || raw.toLowerCase() === '@gmail.com') return '';
    if (raw.includes('@')) return raw;
    return `${raw}@gmail.com`;
  };

  const filtered = clientes.filter(c =>
    (c.name || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.phone || '').includes(search) ||
    (c.email || '').toLowerCase().includes(search.toLowerCase())
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...form,
        email: normalizeCustomerEmail(form.email),
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
      setForm({ name: '', phone: '', email: '', address: '', password: '' });
      load(search);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const openEdit = (c) => {
    setEditClient(c);
    setForm({ name: c.name || '', phone: c.phone || '', email: c.email || '', address: c.address || '', password: '' });
    setShowModal(true);
  };
  const openNew = () => {
    setEditClient(null);
    setForm({ name: '', phone: '', email: '', address: '', password: '' });
    setShowModal(true);
  };
  const deleteClient = async (id) => {
    if (!confirm('¿Eliminar cliente?')) return;
    try {
      await api.delete(`/admin-modules/customers/${id}`);
      toast.success('Cliente eliminado');
      load(search);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const totalVisits = clientes.reduce((s, c) => s + Number(c.visits || 0), 0);
  const totalIncome = clientes.reduce((s, c) => s + Number(c.total_spent || 0), 0);
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
  const getCustomerPendingTotal = (customerId) =>
    (pendingOrdersByCustomer[customerId] || []).reduce((sum, o) => sum + getOrderChargeTotal(o), 0);
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

  return (
    <div>
      <div className="flex items-center justify-end mb-5">
        <button onClick={openNew} className="btn-primary flex items-center gap-2"><MdAdd /> Nuevo Cliente</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        <div className="card"><p className="text-xs ui-text-muted">Total Clientes</p><p className="text-xl font-bold">{clientes.length}</p></div>
        <div className="card"><p className="text-xs ui-text-muted">Visitas Totales</p><p className="text-xl font-bold">{totalVisits}</p></div>
        <div className="card"><p className="text-xs ui-text-muted">Ingreso por Clientes</p><p className="text-xl font-bold text-emerald-600">{formatCurrency(totalIncome)}</p></div>
      </div>

      <div className="card p-5">
        <div className="relative mb-4">
          <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ui-muted)]" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nombre o teléfono..." className="input-field pl-9" />
        </div>
        {loading ? (
          <div className="text-center py-10 text-[var(--ui-muted)]">Cargando clientes...</div>
        ) : (
        <div className="space-y-3">
          {filtered.map(c => (
            <div key={c.id} className="p-4 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] hover:bg-[color-mix(in_srgb,var(--ui-accent)_6%,var(--ui-surface-2))]">
              <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-gold-100 rounded-full flex items-center justify-center"><span className="font-bold text-gold-700 text-lg">{c.name[0]}</span></div>
                <div>
                  <p className="font-bold text-[var(--ui-body-text)]">{c.name}</p>
                  <p className="text-sm text-[var(--ui-muted)]"><MdPhone className="inline text-xs" /> {c.phone} · <MdEmail className="inline text-xs" /> {c.email}</p>
                  <p className="text-xs text-[var(--ui-muted)]">{Number(c.visits || 0)} visitas · Última: {c.last_visit || '-'} · Total: {formatCurrency(c.total_spent || 0)}</p>
                  <p className="text-xs text-sky-300 mt-1">
                    Pedidos pendientes: <strong>{(pendingOrdersByCustomer[c.id] || []).length}</strong>
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setExpandedClientId(prev => prev === c.id ? '' : c.id)} className="p-2 hover:bg-[var(--ui-sidebar-hover)] rounded-lg text-[var(--ui-muted)]"><MdReceipt /></button>
                <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(c); }} className="p-2 hover:bg-[var(--ui-sidebar-hover)] rounded-lg text-[var(--ui-muted)]"><MdEdit /></button>
                <button onClick={(e) => { e.stopPropagation(); deleteClient(c.id); }} className="p-2 hover:bg-red-900/40 rounded-lg text-[var(--ui-muted)] hover:text-red-300"><MdDelete /></button>
              </div>
              </div>
              {expandedClientId === c.id && (
                <div className="mt-3 rounded-lg border border-slate-300 bg-white p-3">
                  <p className="text-xs font-semibold text-slate-900 mb-2">Pedidos pendientes por cobrar</p>
                  {(pendingOrdersByCustomer[c.id] || []).length === 0 ? (
                    <p className="text-xs text-slate-700">No tiene pedidos pendientes.</p>
                  ) : (
                    <div className="space-y-2">
                      <div className="grid grid-cols-[minmax(4.5rem,0.85fr)_minmax(0,1fr)_2.25rem_4.25rem] gap-x-2 border-b border-slate-200 pb-1 text-[10px] font-semibold uppercase tracking-wide ui-text-muted">
                        <span>Fecha</span>
                        <span className="min-w-0">Pedido</span>
                        <span className="text-right">Cant.</span>
                        <span className="text-right">Precio</span>
                      </div>
                      {(pendingOrdersByCustomer[c.id] || []).map((o) => (
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
                      <div className="mt-3 flex justify-end border-t border-slate-200 pt-2">
                        <div className="rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] px-4 py-2.5 text-right shadow-md text-[var(--ui-body-text)]">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ui-muted)]">
                            Total a cobrar
                          </p>
                          <p className="text-lg font-bold tabular-nums">
                            {formatCurrency(getCustomerPendingTotal(c.id))}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => goToCajaToChargeCustomer(c)}
                        className="btn-primary flex w-full items-center justify-center gap-2"
                      >
                        <MdAttachMoney />
                        Ir a caja a cobrar
                      </button>
                    </div>
                  )}
                  <div className="mt-3 flex items-center gap-3 border-t border-slate-200 pt-3">
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=96x96&data=${encodeURIComponent(selfOrderClienteUrl(c.id))}`}
                      alt="QR auto-pedido"
                      className="h-24 w-24 shrink-0 rounded border border-slate-200 bg-white p-0.5"
                    />
                    <button
                      type="button"
                      onClick={() => copyClienteSelfOrderLink(c.id)}
                      className="btn-secondary inline-flex shrink-0 items-center gap-1.5 px-3 py-2 text-sm"
                    >
                      <MdContentCopy /> Copiar
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {filtered.length === 0 && <p className="text-center py-8 text-[var(--ui-muted)]">No se encontraron clientes</p>}
        </div>
        )}
      </div>

      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditClient(null); }} title={editClient ? 'Editar Cliente' : 'Nuevo Cliente'} size="md">
        <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
          {/* Campos señuelo para desviar autofill agresivo del navegador */}
          <input type="text" name="fake-username" autoComplete="username" className="hidden" tabIndex={-1} aria-hidden="true" />
          <input type="password" name="fake-password" autoComplete="current-password" className="hidden" tabIndex={-1} aria-hidden="true" />
          <div><label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Nombre Completo</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="input-field" required /></div>
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
