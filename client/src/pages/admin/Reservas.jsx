import { useState, useEffect, useMemo, useCallback } from 'react';
import { api, formatCurrency } from '../../utils/api';
import { useSocket } from '../../hooks/useSocket';
import toast from 'react-hot-toast';
import Modal from '../../components/Modal';
import StaffDineInOrderUI from '../../components/StaffDineInOrderUI';
import StaffModifierPromptModal from '../../components/StaffModifierPromptModal';
import { UI_BADGE } from '../../utils/uiBadges';
import { useStaffOrderCart } from '../../hooks/useStaffOrderCart';
import { mergeOrderingCatalog, filterVisibleOrderingProducts, buildOrderItemsPayload, filterOrderingProducts } from '../../utils/orderingCatalog';
import { MdAdd, MdExpandMore, MdEventSeat, MdPerson, MdPhone, MdCalendarToday, MdAccessTime } from 'react-icons/md';

const WAREHOUSE_CATEGORY_NAMES = new Set(['PRODUCTOS ALMACEN', 'INSUMOS']);

export default function Reservas() {
  const todayKey = new Date().toISOString().slice(0, 10);
  const [reservas, setReservas] = useState([]);
  const [tables, setTables] = useState([]);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [modifiers, setModifiers] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [customerSuggestions, setCustomerSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [saveAsNewCustomer, setSaveAsNewCustomer] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ client_name: '', phone: '', date: todayKey, time: '', guests: 1, table_id: '', notes: '' });
  const [search, setSearch] = useState('');
  const [selectedCat, setSelectedCat] = useState('all');
  const [showOptionalOrder, setShowOptionalOrder] = useState(false);

  const {
    cart,
    noteEditorLineKey,
    setNoteEditorLineKey,
    modifierPrompt,
    setModifierPrompt,
    addToCart,
    confirmModifierForCart,
    addProductWithoutOptionalModifier,
    updateQty,
    removeFromCart,
    updateItemNote,
    cartTotal,
    resetCart,
  } = useStaffOrderCart(modifiers);

  const load = useCallback(async () => {
    try {
      const [tablesData, reservationsData, customersData, prods, cats, modifiersData, combosData] = await Promise.all([
        api.get('/tables'),
        api.get('/admin-modules/reservations'),
        api.get('/admin-modules/customers').catch(() => []),
        api.get('/products?active_only=true&available_now=true').catch(() => []),
        api.get('/categories/active').catch(() => []),
        api.get('/admin-modules/modifiers').catch(() => []),
        api.get('/admin-modules/combos').catch(() => []),
      ]);
      setTables(tablesData);
      setReservas(reservationsData || []);
      setCustomers(customersData || []);
      const visibleCategories = (cats || []).filter((c) => !WAREHOUSE_CATEGORY_NAMES.has((c.name || '').toUpperCase()));
      const mergedCatalog = mergeOrderingCatalog(prods || [], visibleCategories, combosData || []);
      const visibleCategoryIds = new Set(mergedCatalog.categories.map((c) => c.id));
      const visibleProducts = filterVisibleOrderingProducts(mergedCatalog.products, visibleCategoryIds);
      setCategories(mergedCatalog.categories);
      setProducts(visibleProducts);
      setModifiers(Array.isArray(modifiersData) ? modifiersData : []);
    } catch (err) {
      toast.error(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useSocket('table-update', () => {
    void load();
  });
  useSocket('order-update', () => {
    void load();
  });
  useSocket('inventory-update', () => {
    void load();
  });
  useSocket('staff-data-update', (p) => {
    const d = p?.domain;
    if (['reservations', 'modifiers', 'customers', 'catalog', 'combos'].includes(d)) void load();
  });
  useEffect(() => {
    const query = String(form.client_name || '').trim().toLowerCase();
    const source = customers || [];
    const suggestions = (!query ? source : source.filter((c) => String(c.name || '').toLowerCase().includes(query))).slice(0, 8);
    setCustomerSuggestions(suggestions);
  }, [form.client_name, customers]);

  const filteredProducts = useMemo(
    () => filterOrderingProducts(products, { search, selectedCat }),
    [products, selectedCat, search],
  );

  const resetForm = () => {
    setForm({ client_name: '', phone: '', date: todayKey, time: '', guests: 1, table_id: '', notes: '' });
    setSaveAsNewCustomer(false);
    setSelectedCustomerId('');
    setShowSuggestions(false);
    setSearch('');
    setSelectedCat('all');
    setShowOptionalOrder(false);
    resetCart();
  };

  const toggleOptionalOrder = () => {
    if (showOptionalOrder) {
      resetCart();
      setSearch('');
      setSelectedCat('all');
    }
    setShowOptionalOrder(!showOptionalOrder);
  };

  const selectCustomer = (customer) => {
    setForm((prev) => ({
      ...prev,
      client_name: customer.name || '',
      phone: customer.phone || prev.phone || '',
    }));
    setSelectedCustomerId(customer.id || '');
    setShowSuggestions(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const clientName = String(form.client_name || '').trim();
      if (!clientName) return toast.error('Ingresa o selecciona el cliente');
      const missingRequiredNote = cart.find(
        (i) => Number(i.note_required || 0) === 1 && !String(i.notes || '').trim()
      );
      if (missingRequiredNote) {
        setNoteEditorLineKey(missingRequiredNote.line_key);
        return toast.error(`"${missingRequiredNote.name}" requiere nota obligatoria`);
      }
      if (saveAsNewCustomer && !selectedCustomerId) {
        await api.post('/admin-modules/customers', {
          name: clientName,
          phone: String(form.phone || '').trim(),
        });
      }
      const requestedSummary = cart
        .map((item) => {
          let s = `${item.quantity}x ${item.name}`;
          if (item.modifier_option) s += ` (${item.modifier_name}: ${item.modifier_option})`;
          return s;
        })
        .join(' | ');
      const notesMerged = [String(form.notes || '').trim(), requestedSummary ? `Pedido solicitado: ${requestedSummary}` : '']
        .filter(Boolean)
        .join('\n');
      const createdReservation = await api.post('/admin-modules/reservations', {
        ...form,
        notes: notesMerged,
        status: 'confirmed',
      });
      let orderCreated = false;
      const hadOrderLines = cart.length > 0;
      if (hadOrderLines) {
        try {
          const selectedTable = tables.find((t) => t.id === form.table_id);
          await api.post('/orders', {
            items: buildOrderItemsPayload(cart),
            type: 'dine_in',
            customer_id: selectedCustomerId || '',
            table_number: selectedTable ? String(selectedTable.number || '') : '',
            customer_name: clientName,
            hold_kitchen_for_reservation: true,
            reservation_date: createdReservation?.date || form.date,
            reservation_time: createdReservation?.time || form.time,
            notes: [
              `RESERVA_ID:${createdReservation.id}`,
              `Reserva: ${createdReservation?.date || form.date} ${createdReservation?.time || form.time}`,
              notesMerged ? `Detalle reserva: ${notesMerged}` : '',
            ]
              .filter(Boolean)
              .join(' | '),
            payment_method: 'efectivo',
          });
          orderCreated = true;
        } catch (orderErr) {
          toast.error(`Reserva guardada, pero el pedido no se registró: ${orderErr.message}`);
        }
      }
      setShowModal(false);
      resetForm();
      if (hadOrderLines) {
        toast.success(
          orderCreated
            ? 'Reserva creada. El pedido se enviará a cocina 45 min antes de la hora reservada'
            : 'Reserva creada'
        );
      } else {
        toast.success('Reserva creada');
      }
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const cancelReserva = async (id) => {
    try {
      await api.put(`/admin-modules/reservations/${id}`, { status: 'cancelled' });
      toast.success('Reserva cancelada');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const tableById = useMemo(() => {
    const map = new Map();
    (tables || []).forEach((t) => map.set(t.id, t));
    return map;
  }, [tables]);

  const tableLabel = (tableId) => {
    if (!tableId) return 'Sin mesa';
    const t = tableById.get(tableId);
    return t ? (t.name || `Mesa ${t.number}`) : 'Mesa asignada';
  };

  const assignTable = async (reservationId, tableId) => {
    try {
      await api.put(`/admin-modules/reservations/${reservationId}`, { table_id: tableId || '' });
      toast.success(tableId ? 'Mesa asignada a la reserva' : 'Mesa quitada de la reserva');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const today = new Date().toISOString().split('T')[0];
  const visibleReservas = reservas.filter((r) => !['cancelled', 'cancelada'].includes(String(r.status || '').toLowerCase()));
  const todayReservas = visibleReservas.filter((r) => r.date === today);
  const statusColors = {
    confirmed: UI_BADGE.emerald,
    pending: UI_BADGE.amber,
    cancelled: UI_BADGE.red,
    completed: UI_BADGE.sky,
  };
  const statusNames = { confirmed: 'Confirmada', pending: 'Pendiente', cancelled: 'Cancelada', completed: 'Completada' };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-bold rf-page-title">Reservas</h1>
        <button
          onClick={() => {
            resetForm();
            setShowModal(true);
          }}
          className="btn-primary flex items-center gap-2"
        >
          <MdAdd /> Nueva Reserva
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        <div className="card flex items-center gap-3">
          <div className="w-10 h-10 bg-sky-100 rounded-xl flex items-center justify-center">
            <MdCalendarToday className="text-sky-600" />
          </div>
          <div>
            <p className="text-xs ui-text-muted">Hoy</p>
            <p className="text-xl font-bold">{todayReservas.length}</p>
          </div>
        </div>
        <div className="card flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
            <MdEventSeat className="text-emerald-600" />
          </div>
          <div>
            <p className="text-xs ui-text-muted">Confirmadas</p>
            <p className="text-xl font-bold">{visibleReservas.filter((r) => r.status === 'confirmed').length}</p>
          </div>
        </div>
        <div className="card flex items-center gap-3">
          <div className="w-10 h-10 bg-gold-100 rounded-xl flex items-center justify-center">
            <MdPerson className="text-gold-600" />
          </div>
          <div>
            <p className="text-xs ui-text-muted">Comensales esperados</p>
            <p className="text-xl font-bold">{todayReservas.reduce((s, r) => s + r.guests, 0)}</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
        {visibleReservas.length === 0 ? (
          <div className="text-center py-12 text-[var(--ui-muted)]">
            <MdEventSeat className="text-5xl mx-auto mb-3" />
            <p className="font-medium">No hay reservas activas</p>
            <p className="text-sm">Las canceladas no se muestran aquí · Crea una nueva reserva para comenzar</p>
          </div>
        ) : (
          <div className="space-y-3">
            {visibleReservas.map((r) => (
              <div key={r.id} className="flex items-center justify-between p-4 rounded-lg border border-slate-100 hover:bg-slate-50">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-gold-100 rounded-full flex items-center justify-center">
                    <span className="font-bold text-gold-700">{r.client_name[0]}</span>
                  </div>
                  <div>
                    <p className="font-bold rf-section-title">{r.client_name}</p>
                    <p className="text-sm ui-text-muted">
                      <MdCalendarToday className="inline text-xs mr-1" />
                      {r.date} · <MdAccessTime className="inline text-xs mr-1" />
                      {r.time} · {r.guests} personas
                    </p>
                    {r.phone && (
                      <p className="text-xs text-[var(--ui-muted)]">
                        <MdPhone className="inline text-xs mr-1" />
                        {r.phone}
                      </p>
                    )}
                    <p className="text-xs ui-text-muted mt-0.5">
                      <MdEventSeat className="inline text-xs mr-1" />
                      {tableLabel(r.table_id)}
                    </p>
                    {r.notes && (
                      <p className="text-xs ui-text-muted mt-1 max-w-[520px] truncate">
                        Nota: {r.notes}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
                  <select
                    value={r.table_id || ''}
                    onChange={(e) => assignTable(r.id, e.target.value)}
                    className="input-field text-xs py-1.5 min-w-[140px] max-w-[200px]"
                    title="Asignar o cambiar mesa"
                  >
                    <option value="">Sin mesa</option>
                    {tables.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name || `Mesa ${t.number}`} (Cap. {t.capacity})
                      </option>
                    ))}
                  </select>
                  <span className={statusColors[r.status] || UI_BADGE.slate}>
                    {statusNames[r.status]}
                  </span>
                  {r.status !== 'cancelled' && (
                    <button
                      onClick={() => cancelReserva(r.id)}
                      className="text-xs px-3 py-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100"
                    >
                      Cancelar
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        isOpen={showModal}
        onClose={() => {
          setShowModal(false);
          resetForm();
        }}
        title="Nueva Reserva"
        size="xl"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Nombre del Cliente</label>
            <input
              value={form.client_name}
              onChange={(e) => {
                setForm({ ...form, client_name: e.target.value });
                setSelectedCustomerId('');
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 120)}
              className="input-field"
              required
              placeholder="Busca o escribe nombre del cliente"
            />
            {showSuggestions && customerSuggestions.length > 0 && (
              <div className="absolute z-20 mt-1 w-full rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] shadow-xl max-h-44 overflow-y-auto">
                {customerSuggestions.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectCustomer(c);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-[#1E3A8A]/40 border-b border-[#3B82F6]/20 last:border-b-0"
                  >
                    <p className="text-sm font-medium text-[#F9FAFB]">{c.name}</p>
                    <p className="text-xs text-[#9CA3AF]">{c.phone || 'Sin teléfono'}</p>
                  </button>
                ))}
              </div>
            )}
            {showSuggestions && customerSuggestions.length === 0 && (
              <div className="absolute z-20 mt-1 w-full rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] shadow-xl p-3">
                <p className="text-xs text-[#9CA3AF]">No hay coincidencias. Puedes crear cliente nuevo con la opción de abajo.</p>
              </div>
            )}
            <label className="flex items-center gap-2 mt-2 text-xs text-[#D1D5DB]">
              <input
                type="checkbox"
                checked={saveAsNewCustomer}
                onChange={(e) => setSaveAsNewCustomer(e.target.checked)}
                className="rounded border-slate-300"
              />
              Guardar como cliente nuevo si no existe (opción de nueva solicitud)
            </label>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Teléfono</label>
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="input-field"
                placeholder="999 999 999"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Comensales</label>
              <input
                type="number"
                min="1"
                max="20"
                value={form.guests}
                onChange={(e) => setForm({ ...form, guests: parseInt(e.target.value, 10) })}
                className="input-field"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Fecha</label>
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="input-field" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Hora</label>
              <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} className="input-field" required />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Mesa</label>
            <select value={form.table_id} onChange={(e) => setForm({ ...form, table_id: e.target.value })} className="input-field">
              <option value="">Sin asignar</option>
              {tables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name || `Mesa ${t.number}`} (Cap. {t.capacity})
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-xl border border-[color:var(--ui-border)] bg-[var(--ui-surface)] overflow-hidden">
            <button
              type="button"
              onClick={toggleOptionalOrder}
              className="w-full flex items-center justify-between gap-3 text-left px-4 py-3 hover:bg-[#1E3A8A]/25 transition-colors"
            >
              <div>
                <span className="text-sm font-semibold text-[#F9FAFB] block">Pedido solicitado (opcional)</span>
                <span className="text-xs text-[#9CA3AF]">
                  {showOptionalOrder ? 'Toca para ocultar' : 'Toca para buscar productos y armar el pedido'}
                </span>
              </div>
              <MdExpandMore
                className={`text-2xl text-[#BFDBFE] shrink-0 transition-transform duration-200 ${
                  showOptionalOrder ? 'rotate-180' : ''
                }`}
                aria-hidden
              />
            </button>
            {showOptionalOrder && (
              <div className="px-4 pb-4 pt-0 border-t border-[#3B82F6]/20">
                <p className="text-xs text-[#9CA3AF] mb-3 pt-3">
                  Misma carta y carrito que en Mesas y Caja: categorías, búsqueda, notas y modificadores. La lista de
                  productos y el carrito se desplazan por separado dentro de este recuadro.
                </p>
                <StaffDineInOrderUI
                  embedded
                  cartLayout="lines"
                  search={search}
                  onSearchChange={setSearch}
                  selectedCat={selectedCat}
                  onSelectedCatChange={setSelectedCat}
                  categories={categories}
                  filteredProducts={filteredProducts}
                  onProductPick={addToCart}
                  cart={cart}
                  noteEditorLineKey={noteEditorLineKey}
                  setNoteEditorLineKey={setNoteEditorLineKey}
                  updateQty={updateQty}
                  removeFromCart={removeFromCart}
                  updateItemNote={updateItemNote}
                  cartTotal={cartTotal}
                  formatCurrency={formatCurrency}
                  footer={
                    cart.length > 0 ? (
                      <>
                        <div className="flex justify-between font-bold text-lg text-white">
                          <span>Total</span>
                          <span className="text-[#BFDBFE]">{formatCurrency(cartTotal)}</span>
                        </div>
                        <p className="text-xs text-[#9CA3AF]">Se programará para cocina 45 min antes de la hora reservada.</p>
                      </>
                    ) : null
                  }
                />
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Notas</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="input-field"
              rows="2"
              placeholder="Observaciones..."
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                setShowModal(false);
                resetForm();
              }}
              className="btn-secondary flex-1"
            >
              Cancelar
            </button>
            <button type="submit" className="btn-primary flex-1">
              Crear Reserva
            </button>
          </div>
        </form>
      </Modal>

      <StaffModifierPromptModal
        open={modifierPrompt.open}
        onClose={() => setModifierPrompt({ open: false, product: null, modifier: null, selectedOption: '' })}
        modifierPrompt={modifierPrompt}
        setModifierPrompt={setModifierPrompt}
        onConfirm={confirmModifierForCart}
        onSkipOptional={addProductWithoutOptionalModifier}
      />
    </div>
  );
}
