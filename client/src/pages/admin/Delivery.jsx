import { useState, useEffect, useCallback } from 'react';
import {
  api,
  formatCurrency,
  formatDate,
  formatDateTime,
  DELIVERY_PAYMENT_MODALITY_OPTIONS,
  labelDeliveryPaymentModality,
  PAYMENT_METHODS,
} from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { mergeOrderingCatalog, buildOrderItemsPayload } from '../../utils/orderingCatalog';
import { showStockInOrderingUI } from '../../utils/productStockDisplay';
import { useSocket } from '../../hooks/useSocket';
import { useActiveInterval } from '../../hooks/useActiveInterval';
import Modal from '../../components/Modal';
import {
  MdDeliveryDining, MdLocationOn, MdCheck, MdTimer, MdAdd,
  MdRemove, MdDelete, MdReceipt, MdSearch, MdShoppingCart,
  MdPerson, MdPhone, MdHome, MdEditNote, MdMap,
} from 'react-icons/md';
import { buildGoogleMapsSearchUrl } from '../../utils/googleMaps';
import toast from 'react-hot-toast';

export default function Delivery() {
  const { user } = useAuth();
  const isMozo = String(user?.role || '') === 'mozo';
  const [orders, setOrders] = useState([]);
  const [tab, setTab] = useState('active');
  const [loading, setLoading] = useState(true);
  /** Preparación/listo solo en cocina/bar; aquí solo cierre operativo por personal autorizado. */
  const canMarkDeliveredFromAdmin = ['admin', 'cajero', 'mozo'].includes(String(user?.role || ''));

  const [showNewOrder, setShowNewOrder] = useState(false);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [cart, setCart] = useState([]);
  const [noteEditorProductId, setNoteEditorProductId] = useState('');
  const [search, setSearch] = useState('');
  const [selectedCat, setSelectedCat] = useState('all');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryPaymentModality, setDeliveryPaymentModality] = useState('contra_entrega');
  const [restaurantAddress, setRestaurantAddress] = useState('');

  const load = useCallback(() => {
    api.get('/orders').then((data) => {
      const list = Array.isArray(data) ? data : [];
      setOrders(list.filter((o) => o.type === 'delivery'));
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  const loadProducts = useCallback(() => {
    Promise.all([
      api.get('/products?active_only=true&available_now=true').catch(() => []),
      api.get('/categories/active').catch(() => []),
      api.get('/admin-modules/combos').catch(() => []),
    ]).then(([prods, cats, combosData]) => {
      const merged = mergeOrderingCatalog(
        Array.isArray(prods) ? prods : [],
        Array.isArray(cats) ? cats : [],
        combosData || [],
      );
      setProducts(merged.products);
      setCategories(merged.categories);
    }).catch(console.error);
  }, []);

  useEffect(() => {
    loadProducts();
    api.get('/restaurant').then((r) => setRestaurantAddress(String(r?.address || '').trim())).catch(() => {});
    if (isMozo) {
      setLoading(false);
      return;
    }
    load();
  }, [isMozo, load, loadProducts]);
  useActiveInterval(load, isMozo ? 0 : 10000);
  useSocket('order-update', isMozo ? () => {} : load);
  useSocket('delivery-update', isMozo ? () => {} : load);
  useSocket('inventory-update', loadProducts);
  useSocket('staff-data-update', (p) => {
    if (['catalog', 'combos'].includes(p?.domain)) loadProducts();
  });

  const activeOrders = orders.filter(o => ['pending', 'preparing', 'ready'].includes(o.status));
  const completedOrders = orders.filter(o => ['delivered', 'cancelled'].includes(o.status));
  const todayKey = new Date().toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const todayDeliveries = orders.filter(
    o => o.status === 'delivered' && formatDate(o.updated_at || o.created_at) === todayKey
  );

  const displayed =
    tab === 'active'
      ? activeOrders
      : tab === 'today'
        ? todayDeliveries
        : completedOrders;

  const statusColors = { pending: 'bg-gold-100 text-gold-700', preparing: 'bg-sky-100 text-sky-700', ready: 'bg-sky-100 text-sky-700', delivered: 'bg-emerald-100 text-emerald-700', cancelled: 'bg-red-100 text-red-700' };
  const statusNames = { pending: 'Pendiente', preparing: 'Preparando', ready: 'Listo para enviar', delivered: 'Entregado', cancelled: 'Cancelado' };

  const updateStatus = async (id, status) => {
    try {
      await api.put(`/orders/${id}/status`, { status });
      toast.success('Estado actualizado');
      load();
    } catch (err) { toast.error(err.message); }
  };

  

  const openNewOrder = () => {
    setShowNewOrder(true);
    setCart([]);
    setNoteEditorProductId('');
    setSearch('');
    setSelectedCat('all');
    setCustomerName('');
    setCustomerPhone('');
    setDeliveryAddress('');
    setDeliveryPaymentModality('contra_entrega');
  };

  const addToCart = (product) => {
    setCart(prev => {
      const isCombo = !!(product.is_combo || product.combo_id);
      const cartKey = isCombo ? `combo:${product.combo_id}` : product.id;
      const existing = prev.find(i => (isCombo ? i.combo_id === product.combo_id : i.product_id === product.id && !i.combo_id));
      if (existing) {
        return prev.map(i => (
          (isCombo ? i.combo_id === product.combo_id : i.product_id === product.id && !i.combo_id)
            ? { ...i, quantity: i.quantity + 1 }
            : i
        ));
      }
      return [
        ...prev,
        {
          product_id: isCombo ? (product.combo_items?.[0]?.product_id || '') : product.id,
          combo_id: isCombo ? product.combo_id : '',
          cart_key: cartKey,
          name: product.name,
          price: product.price,
          quantity: 1,
          note_required: Number(product.note_required || 0) === 1 ? 1 : 0,
          notes: '',
        },
      ];
    });
  };

  const updateQty = (productId, delta) => {
    setCart(prev => prev.map(i => {
      if (i.product_id !== productId) return i;
      const newQty = i.quantity + delta;
      return newQty > 0 ? { ...i, quantity: newQty } : i;
    }).filter(i => i.quantity > 0));
  };

  const removeFromCart = (productId) => setCart(prev => prev.filter(i => i.product_id !== productId));
  const updateItemNote = (productId, nextNote) => {
    setCart(prev => prev.map(i => (i.product_id === productId ? { ...i, notes: String(nextNote || '') } : i)));
  };

  const cartTotal = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);

  const submitDeliveryOrder = async () => {
    if (cart.length === 0) return toast.error('Agrega productos al pedido');
    const missingRequiredNote = cart.find(i => Number(i.note_required || 0) === 1 && !String(i.notes || '').trim());
    if (missingRequiredNote) {
      setNoteEditorProductId(missingRequiredNote.product_id);
      return toast.error(`"${missingRequiredNote.name}" requiere nota obligatoria`);
    }
    if (!customerName.trim()) return toast.error('Ingresa el nombre del cliente');
    if (!deliveryAddress.trim()) return toast.error('Ingresa la dirección de entrega');
    try {
      await api.post('/orders', {
        items: buildOrderItemsPayload(cart),
        type: 'delivery',
        customer_name: customerName.trim(),
        delivery_address: deliveryAddress.trim(),
        delivery_payment_modality: deliveryPaymentModality,
        notes: customerPhone ? `Tel: ${customerPhone}` : '',
      });
      toast.success('Pedido de delivery creado');
      setShowNewOrder(false);
      setCart([]);
      setNoteEditorProductId('');
      if (!isMozo) load();
    } catch (err) { toast.error(err.message); }
  };

  const filteredProducts = products.filter((p) => {
    if (selectedCat !== 'all' && p.category_id !== selectedCat) return false;
    if (search && !(String(p.name || '')).toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  if (loading) return <div className="flex justify-center py-16"><div className="animate-spin w-8 h-8 border-4 border-gold-500 border-t-transparent rounded-full" /></div>;

  return (
    <div>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-5">
        <h1 className="text-2xl font-bold rf-page-title">Delivery</h1>
        {!isMozo && (
          <div className="flex flex-wrap gap-2">
            <button onClick={openNewOrder} className="btn-primary flex items-center gap-2 text-sm">
              <MdAdd /> Nuevo Pedido
            </button>
            <button onClick={() => setTab('active')} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === 'active' ? 'bg-gold-600 text-white' : 'bg-white border text-[var(--ui-muted)] hover:bg-slate-50'}`}>Activos ({activeOrders.length})</button>
            <button onClick={() => setTab('today')} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === 'today' ? 'bg-gold-600 text-white' : 'bg-white border text-[var(--ui-muted)] hover:bg-slate-50'}`}>Hoy ({todayDeliveries.length})</button>
            <button onClick={() => setTab('completed')} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === 'completed' ? 'bg-gold-600 text-white' : 'bg-white border text-[var(--ui-muted)] hover:bg-slate-50'}`}>Completados ({completedOrders.length})</button>
          </div>
        )}
      </div>

      {isMozo ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-10 text-center max-w-lg mx-auto">
          <MdDeliveryDining className="text-5xl text-gold-500 mx-auto mb-4" />
          <p className="text-slate-700 font-medium mb-1">Registrar pedido a domicilio</p>
          <p className="text-sm ui-text-muted mb-6">Aquí solo puedes crear el pedido. El seguimiento lo gestionan caja y administración.</p>
          <button type="button" onClick={openNewOrder} className="btn-primary inline-flex items-center gap-2 px-6 py-3 text-base">
            <MdAdd /> Nuevo pedido de delivery
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
            <div className="card flex items-center gap-3"><div className="w-10 h-10 bg-gold-100 rounded-xl flex items-center justify-center"><MdTimer className="text-gold-600" /></div><div><p className="text-xs ui-text-muted">En proceso</p><p className="text-xl font-bold">{activeOrders.length}</p></div></div>
            <div className="card flex items-center gap-3"><div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center"><MdCheck className="text-emerald-600" /></div><div><p className="text-xs ui-text-muted">Entregados hoy</p><p className="text-xl font-bold">{todayDeliveries.length}</p></div></div>
            <div className="card flex items-center gap-3"><div className="w-10 h-10 bg-sky-100 rounded-xl flex items-center justify-center"><MdDeliveryDining className="text-sky-600" /></div><div><p className="text-xs ui-text-muted">Total Delivery</p><p className="text-xl font-bold text-emerald-600">{formatCurrency(orders.filter(o => o.payment_status === 'paid').reduce((s, o) => s + (o.total || 0), 0))}</p></div></div>
          </div>

          {displayed.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border p-12 text-center text-[var(--ui-muted)]"><MdDeliveryDining className="text-5xl mx-auto mb-3" /><p className="font-medium">No hay pedidos de delivery {tab === 'active' ? 'activos' : tab === 'today' ? 'entregados hoy' : 'completados'}</p></div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {displayed.map((o) => {
                const mapsUrl = buildGoogleMapsSearchUrl(o.delivery_address, { restaurantAddress });
                return (
                <div key={o.id} className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-lg">#{o.order_number}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[o.status]}`}>{statusNames[o.status]}</span>
                    </div>
                    <p className="text-xs text-[var(--ui-muted)]">{formatDateTime(o.created_at)}</p>
                  </div>
                  <div className="space-y-1 mb-3 text-sm">
                    {o.customer_name && <p className="text-[var(--ui-muted)] flex items-center gap-1"><MdPerson className="text-[var(--ui-muted)]" />{o.customer_name}</p>}
                    <div className="text-[var(--ui-muted)] flex flex-col gap-1.5">
                      <p className="flex items-start gap-1">
                        <MdLocationOn className="text-[var(--ui-muted)] shrink-0 mt-0.5" />
                        <span className="break-words">{o.delivery_address || 'Sin dirección'}</span>
                      </p>
                      {mapsUrl && (
                        <a
                          href={mapsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-700 hover:text-sky-800 w-fit"
                        >
                          <MdMap className="text-base" /> Abrir en Google Maps
                        </a>
                      )}
                    </div>
                    {o.notes && <p className="ui-text-muted flex items-center gap-1"><MdPhone className="text-[var(--ui-muted)]" />{o.notes}</p>}
                    <p className="text-[var(--ui-muted)] text-sm">
                      <span className="ui-text-muted">Modalidad de pago:</span>{' '}
                      <span className="font-medium">{labelDeliveryPaymentModality(o.delivery_payment_modality) || '—'}</span>
                      {o.payment_status === 'paid' ? (
                        <span className="ui-text-muted"> · Caja: {PAYMENT_METHODS[o.payment_method] || o.payment_method}</span>
                      ) : null}
                    </p>
                  </div>
                  <div className="border-t border-slate-100 pt-3 mb-3">
                    <p className="text-xs font-semibold ui-text-muted mb-1">Detalle de lo pedido</p>
                    {(o.items || []).map((it, i) => (
                      <div key={i} className="flex justify-between text-sm py-0.5"><span>{it.quantity}x {it.product_name}</span><span className="ui-text-muted">{formatCurrency(it.subtotal)}</span></div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                    <div>
                      <p className="text-xs ui-text-muted">Total compra</p>
                      <p className="font-bold text-lg">{formatCurrency(o.total)}</p>
                    </div>
                    {tab === 'active' && ['pending', 'preparing', 'ready'].includes(o.status) && (
                      <div className="flex flex-wrap gap-2 justify-end items-center">
                        {o.status === 'ready' && canMarkDeliveredFromAdmin && (
                          <button type="button" onClick={() => updateStatus(o.id, 'delivered')} className="text-xs px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100 font-medium">Entregado</button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {showNewOrder ? (
      <Modal isOpen onClose={() => setShowNewOrder(false)} title="Nuevo Pedido de Delivery" size="xl">
        <div className="flex flex-col lg:flex-row gap-4" style={{ minHeight: '65vh' }}>
          <div className="flex-1 flex flex-col">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4 p-3 bg-slate-50 rounded-xl border border-slate-200">
              <div>
                <label className="block text-xs font-medium text-[var(--ui-muted)] mb-1"><MdPerson className="inline mr-1" />Cliente *</label>
                <input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Nombre del cliente" className="input-field text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--ui-muted)] mb-1"><MdPhone className="inline mr-1" />Teléfono</label>
                <input value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder="999 888 777" className="input-field text-sm" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-[var(--ui-muted)] mb-1"><MdHome className="inline mr-1" />Dirección de entrega *</label>
                <input value={deliveryAddress} onChange={e => setDeliveryAddress(e.target.value)} placeholder="Av. ejemplo 123, distrito" className="input-field text-sm" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-[var(--ui-muted)] mb-1">Modalidad de pago</label>
                <select
                  value={deliveryPaymentModality}
                  onChange={(e) => setDeliveryPaymentModality(e.target.value)}
                  className="input-field text-sm max-w-md"
                >
                  {DELIVERY_PAYMENT_MODALITY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <p className="text-[11px] ui-text-muted mt-1">Anticipado o contra entrega; el medio de pago en caja lo registra caja al cobrar.</p>
              </div>
            </div>

            <div className="mb-3">
              <div className="relative">
                <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ui-muted)]" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar producto..." className="input-field pl-10" />
              </div>
            </div>
            <div className="flex gap-2 flex-wrap mb-3">
              <button onClick={() => setSelectedCat('all')} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${selectedCat === 'all' ? 'bg-gold-600 text-white' : 'bg-slate-100 text-[var(--ui-muted)]'}`}>Todos</button>
              {categories.map(c => (
                <button key={c.id} onClick={() => setSelectedCat(c.id)} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${selectedCat === c.id ? 'bg-gold-600 text-white' : 'bg-slate-100 text-[var(--ui-muted)]'}`}>{c.name}</button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {filteredProducts.map(p => (
                  <button key={p.id} onClick={() => addToCart(p)} className="bg-slate-50 rounded-xl p-3 text-left hover:shadow-md transition-shadow border border-slate-100 hover:border-gold-300">
                    <p className="font-medium text-sm truncate">{p.name}</p>
                    <p className="text-gold-600 font-bold text-sm mt-1">{formatCurrency(p.price)}</p>
                    {showStockInOrderingUI(p) ? (
                      <p className="text-xs text-[var(--ui-muted)]">Stock: {p.stock}</p>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="w-full lg:w-72 border-t lg:border-t-0 lg:border-l pt-4 lg:pt-0 lg:pl-4 flex flex-col">
            <h3 className="font-bold rf-section-title mb-3 flex items-center gap-2">
              <MdShoppingCart /> Pedido
              {cart.length > 0 && <span className="text-xs bg-gold-100 text-gold-600 px-2 py-0.5 rounded-full">{cart.length}</span>}
            </h3>

            <div className="flex-1 overflow-y-auto">
              {cart.length === 0 ? (
                <p className="text-center text-[var(--ui-muted)] text-sm py-8">Selecciona productos</p>
              ) : (
                cart.map((item) => {
                  const lineTotal = Number(item.price || 0) * Number(item.quantity || 0);
                  return (
                    <div key={item.product_id} className="border-b border-slate-200 py-2">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="flex-1 min-w-0 truncate font-medium text-slate-800" title={item.name}>
                          {item.name}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => setNoteEditorProductId((prev) => (prev === item.product_id ? '' : item.product_id))}
                            className={`w-7 h-7 rounded flex items-center justify-center border ${
                              item.notes?.trim()
                                ? 'bg-amber-100 border-amber-300 text-amber-700'
                                : 'bg-white hover:bg-slate-200 border border-slate-200'
                            }`}
                            title="Agregar nota"
                          >
                            <MdEditNote className="text-sm" />
                          </button>
                          <button
                            type="button"
                            onClick={() => updateQty(item.product_id, -1)}
                            className="w-6 h-6 bg-white rounded flex items-center justify-center hover:bg-slate-200 border border-slate-200"
                          >
                            <MdRemove className="text-xs" />
                          </button>
                          <span className="w-7 text-center font-bold text-slate-900 tabular-nums">{item.quantity}</span>
                          <button
                            type="button"
                            onClick={() => updateQty(item.product_id, 1)}
                            className="w-6 h-6 bg-white rounded flex items-center justify-center hover:bg-slate-200 border border-slate-200"
                          >
                            <MdAdd className="text-xs" />
                          </button>
                        </div>
                        <span className="w-[5.5rem] shrink-0 text-right font-semibold text-gold-700 tabular-nums">
                          {formatCurrency(lineTotal)}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeFromCart(item.product_id)}
                          className="text-red-400 hover:text-red-600 shrink-0 p-0.5"
                          aria-label="Quitar"
                        >
                          <MdDelete className="text-sm" />
                        </button>
                      </div>
                      {Number(item.note_required || 0) === 1 && (
                        <p className="text-[11px] text-red-600 font-medium mt-0.5">Nota obligatoria</p>
                      )}
                      {(noteEditorProductId === item.product_id || item.notes?.trim()) && (
                        <div className="mt-2">
                          <textarea
                            value={item.notes || ''}
                            onChange={(e) => updateItemNote(item.product_id, e.target.value)}
                            placeholder="Escribe una nota para cocina/bar..."
                            className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 placeholder:ui-text-muted focus:outline-none focus:ring-2 focus:ring-[#3B82F6]"
                            rows={2}
                          />
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {cart.length > 0 && (
              <div className="border-t pt-3 mt-3 space-y-2">
                <div className="flex justify-between font-bold text-lg">
                  <span>Total</span>
                  <span className="text-gold-600">{formatCurrency(cartTotal)}</span>
                </div>
                <button onClick={submitDeliveryOrder} className="btn-primary w-full py-3 flex items-center justify-center gap-2 text-base">
                  <MdDeliveryDining /> Crear Pedido Delivery
                </button>
              </div>
            )}
          </div>
        </div>
      </Modal>
      ) : null}
    </div>
  );
}
