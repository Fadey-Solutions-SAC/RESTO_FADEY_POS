import { useState, useEffect, useMemo, useCallback } from 'react';
import { api, formatCurrency, formatDate, toLocalDateKey } from '../../utils/api';
import { useSocket } from '../../hooks/useSocket';
import toast from 'react-hot-toast';
import Modal from '../../components/Modal';
import CompactSelect from '../../components/CompactSelect';
import StaffDineInOrderUI from '../../components/StaffDineInOrderUI';
import StaffModifierPromptModal from '../../components/StaffModifierPromptModal';
import { UI_BADGE } from '../../utils/uiBadges';
import { useStaffOrderCart } from '../../hooks/useStaffOrderCart';
import { mergeOrderingCatalog, filterVisibleOrderingProducts, buildOrderItemsPayload, filterOrderingProducts } from '../../utils/orderingCatalog';
import {
  getReservationKitchenReleaseInfo,
  reservationNotesHaveOrder,
} from '../../utils/reservationKitchenTiming';
import { filterTablesForReservationSelect } from '../../utils/reservationTableAvailability';
import { getTableDisplayLabel } from '../../utils/mesaMapTableVisual';
import {
  dismissReservationCajaToast,
  reservationCajaToastId,
} from '../../utils/reservationCajaAvisosSession';
import {
  MdAdd,
  MdExpandMore,
  MdEventSeat,
  MdPerson,
  MdPhone,
  MdCalendarToday,
  MdAccessTime,
  MdChevronRight,
  MdGroupAdd,
  MdForum,
  MdTableRestaurant,
  MdStickyNote2,
  MdRestaurant,
  MdSoupKitchen,
  MdCheckCircle,
  MdClose,
  MdFilterList,
} from 'react-icons/md';

function splitReservationNotes(notes) {
  const raw = String(notes || '').trim();
  const idx = raw.search(/pedido\s+solicitado\s*:/i);
  if (idx < 0) return { nota: raw, pedido: '' };
  return {
    nota: raw.slice(0, idx).replace(/[\s|·\-–]+$/, '').trim(),
    pedido: raw.slice(idx).replace(/^pedido\s+solicitado\s*:\s*/i, '').trim(),
  };
}

const STATUS_PILL = {
  confirmed: 'bg-emerald-100 text-emerald-700',
  pending: 'bg-amber-100 text-amber-700',
  completed: 'bg-sky-100 text-sky-700',
  cancelled: 'bg-red-100 text-red-700',
};

const WAREHOUSE_CATEGORY_NAMES = new Set(['PRODUCTOS ALMACEN', 'INSUMOS']);

export default function Reservas() {
  const todayKey = toLocalDateKey(new Date());
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
            table_id: form.table_id || '',
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
        const noTable = !String(form.table_id || '').trim();
        const releaseInfo = getReservationKitchenReleaseInfo(
          createdReservation?.date || form.date,
          createdReservation?.time || form.time
        );
        toast.success(
          orderCreated
            ? noTable
              ? releaseInfo.due
                ? 'Reserva creada. Pedido a cocina; asigne mesa desde Caja o Reservas'
                : `Reserva creada. Pedido retenido hasta cocina (${releaseInfo.label}). Asigne mesa desde Caja o Reservas`
              : releaseInfo.due
                ? 'Reserva creada. Pedido enviado a cocina'
                : `Reserva creada. ${releaseInfo.label}`
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
    return t ? getTableDisplayLabel(t) : 'Mesa asignada';
  };

  const assignTable = async (reservationId, tableId) => {
    try {
      await api.put(`/admin-modules/reservations/${reservationId}`, { table_id: tableId || '' });
      toast.success(tableId ? 'Mesa asignada a la reserva' : 'Mesa quitada de la reserva');
      if (tableId) {
        const toastId = reservationCajaToastId(reservationId);
        dismissReservationCajaToast(toastId);
        toast.dismiss(toastId);
      }
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const [dateFilter, setDateFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const today = todayKey;
  const visibleReservas = reservas.filter((r) => !['cancelled', 'cancelada'].includes(String(r.status || '').toLowerCase()));
  const todayReservas = visibleReservas.filter((r) => r.date === today);
  const listedReservas = visibleReservas.filter((r) => (
    (!dateFilter || r.date === dateFilter)
    && (statusFilter === 'all' || String(r.status || '') === statusFilter)
  ));

  const formSelectableTables = useMemo(
    () =>
      filterTablesForReservationSelect({
        tables,
        reservations: visibleReservas,
        date: form.date,
        time: form.time,
        includeTableId: form.table_id,
      }),
    [tables, visibleReservas, form.date, form.time, form.table_id]
  );
  const statusColors = {
    confirmed: UI_BADGE.emerald,
    pending: UI_BADGE.amber,
    cancelled: UI_BADGE.red,
    completed: UI_BADGE.sky,
  };
  const statusNames = { confirmed: 'Confirmada', pending: 'Pendiente', cancelled: 'Cancelada', completed: 'Completada' };

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto] gap-4 mb-5 items-stretch">
        {[
          {
            key: 'hoy',
            title: 'Hoy',
            value: todayReservas.length,
            hint: 'reservas para hoy',
            Icon: MdCalendarToday,
            bubble: 'bg-blue-100 text-blue-600',
            onClick: () => { setDateFilter(today); setStatusFilter('all'); },
          },
          {
            key: 'confirmadas',
            title: 'Confirmadas',
            value: visibleReservas.filter((r) => r.status === 'confirmed').length,
            hint: 'reservas confirmadas',
            Icon: MdGroupAdd,
            bubble: 'bg-emerald-100 text-emerald-600',
            onClick: () => { setDateFilter(''); setStatusFilter('confirmed'); },
          },
          {
            key: 'comensales',
            title: 'Comensales esperados',
            value: todayReservas.reduce((s, r) => s + (Number(r.guests) || 0), 0),
            hint: 'personas hoy',
            Icon: MdForum,
            bubble: 'bg-violet-100 text-violet-600',
            onClick: () => { setDateFilter(today); setStatusFilter('all'); },
          },
        ].map((k) => (
          <button
            key={k.key}
            type="button"
            onClick={k.onClick}
            className="group flex h-full items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-slate-300 hover:shadow-md"
          >
            <span className={`grid h-14 w-14 shrink-0 place-items-center rounded-full ${k.bubble}`}>
              <k.Icon className="text-2xl" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-slate-800">{k.title}</span>
              <span className="mt-1 block text-3xl font-bold leading-none text-slate-900 tabular-nums">{k.value}</span>
              <span className="mt-1.5 block text-xs text-slate-500">{k.hint}</span>
            </span>
            <MdChevronRight className="shrink-0 text-2xl text-slate-300 transition group-hover:text-slate-500" />
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            resetForm();
            setShowModal(true);
          }}
          className="flex h-full min-h-[6.5rem] items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 text-base font-semibold text-white shadow-md shadow-blue-600/30 transition hover:bg-blue-700 sm:col-span-2 lg:col-span-1"
        >
          <MdAdd className="text-2xl" /> Nueva Reserva
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <h2 className="flex items-center gap-2.5 text-xl font-bold text-slate-900">
            <MdCalendarToday className="text-2xl text-blue-600" />
            Reservas
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
              <MdCalendarToday className="text-slate-500" />
              <input
                type="date"
                className="bg-transparent text-sm outline-none"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                aria-label="Filtrar por fecha"
              />
              {dateFilter ? (
                <button
                  type="button"
                  className="text-slate-400 hover:text-slate-600"
                  onClick={() => setDateFilter('')}
                  aria-label="Ver todas las fechas"
                >
                  <MdClose />
                </button>
              ) : (
                <span className="text-xs text-slate-400">Todas</span>
              )}
            </label>
            <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
              <MdFilterList className="text-slate-500" />
              <select
                className="bg-transparent text-sm outline-none"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filtrar por estado"
              >
                <option value="all">Todos los estados</option>
                <option value="confirmed">Confirmadas</option>
                <option value="pending">Pendientes</option>
                <option value="completed">Completadas</option>
              </select>
            </label>
          </div>
        </div>

        {listedReservas.length === 0 ? (
          <div className="text-center py-12 text-[var(--ui-muted)]">
            <MdEventSeat className="text-5xl mx-auto mb-3" />
            <p className="font-medium">
              {visibleReservas.length === 0 ? 'No hay reservas activas' : 'No hay reservas con estos filtros'}
            </p>
            <p className="text-sm">
              {visibleReservas.length === 0
                ? 'Las canceladas no se muestran aquí · Crea una nueva reserva para comenzar'
                : 'Cambie la fecha o el estado para ver otras reservas'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {listedReservas.map((r) => {
              const { nota, pedido } = splitReservationNotes(r.notes);
              const initial = String(r.client_name || '?').trim().charAt(0) || '?';
              return (
                <div
                  key={r.id}
                  className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 p-4 transition hover:border-slate-300 hover:shadow-sm lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] lg:items-center"
                >
                  <div className="flex min-w-0 items-start gap-3 lg:border-r lg:border-slate-200 lg:pr-4">
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-blue-100 text-lg font-bold text-blue-700">
                      {initial}
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="truncate text-base font-bold text-slate-900">{r.client_name}</p>
                      <p className="flex items-center gap-1.5 text-sm text-slate-600">
                        <MdCalendarToday className="text-slate-400" />
                        {formatDate(r.date)}
                        <span className="text-slate-300">·</span>
                        <MdAccessTime className="text-slate-400" />
                        {r.time}
                      </p>
                      <p className="flex items-center gap-1.5 text-sm text-slate-600">
                        <MdPerson className="text-slate-400" />
                        {r.guests} persona{Number(r.guests) === 1 ? '' : 's'}
                      </p>
                      {r.phone ? (
                        <p className="flex items-center gap-1.5 text-sm text-slate-600">
                          <MdPhone className="text-slate-400" />
                          {r.phone}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="min-w-0 space-y-2 text-sm lg:border-r lg:border-slate-200 lg:pr-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <MdTableRestaurant className="text-slate-400" />
                      <span className="text-slate-500">Mesa:</span>
                      <CompactSelect
                        value={r.table_id || ''}
                        onChange={(v) => assignTable(r.id, v)}
                        title="Asignar o cambiar mesa"
                        className="min-w-[140px] max-w-[220px]"
                        placeholder="Sin mesa"
                        options={[
                          { value: '', label: 'Sin mesa' },
                          ...filterTablesForReservationSelect({
                            tables,
                            reservations: visibleReservas,
                            date: r.date,
                            time: r.time,
                            excludeReservationId: r.id,
                            includeTableId: r.table_id,
                          }).map((t) => ({
                            value: t.id,
                            label: `${getTableDisplayLabel(t)} (Cap. ${t.capacity})`,
                          })),
                        ]}
                      />
                    </div>
                    {nota ? (
                      <p className="flex items-start gap-2 text-slate-700">
                        <MdStickyNote2 className="mt-0.5 shrink-0 text-slate-400" />
                        <span className="min-w-0 break-words whitespace-pre-wrap">
                          <span className="text-slate-500">Nota: </span>{nota}
                        </span>
                      </p>
                    ) : null}
                    {pedido ? (
                      <p className="flex items-start gap-2 text-slate-700">
                        <MdRestaurant className="mt-0.5 shrink-0 text-slate-400" />
                        <span className="min-w-0 break-words">
                          <span className="block text-slate-500">Pedido solicitado:</span>
                          {pedido}
                        </span>
                      </p>
                    ) : null}
                    {reservationNotesHaveOrder(r.notes) ? (
                      <p className="flex items-center gap-2 font-medium text-[var(--ui-accent)]">
                        <MdSoupKitchen className="shrink-0" />
                        {getReservationKitchenReleaseInfo(r.date, r.time).label}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex items-center justify-between gap-3 lg:justify-end">
                    <div className="flex flex-col items-stretch gap-2">
                      <span
                        className={`inline-flex items-center justify-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold ${STATUS_PILL[r.status] || 'bg-slate-100 text-slate-700'}`}
                      >
                        {r.status === 'confirmed' ? <MdCheckCircle /> : null}
                        {statusNames[r.status] || r.status}
                      </span>
                      {r.status !== 'cancelled' ? (
                        <button
                          type="button"
                          onClick={() => cancelReserva(r.id)}
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-sm text-slate-700 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                        >
                          <MdClose /> Cancelar
                        </button>
                      ) : null}
                    </div>
                    <MdChevronRight className="hidden shrink-0 text-2xl text-slate-300 lg:block" />
                  </div>
                </div>
              );
            })}
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
        maxHeightClass="h-[min(92vh,920px)] max-h-[min(92vh,920px)]"
        bodyClassName="!overflow-y-auto !overflow-x-hidden"
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="min-w-0">
              <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Teléfono</label>
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="input-field w-full"
                placeholder="999 999 999"
              />
            </div>
            <div className="min-w-0">
              <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Comensales</label>
              <input
                type="number"
                min="1"
                max="20"
                value={form.guests}
                onChange={(e) => setForm({ ...form, guests: parseInt(e.target.value, 10) })}
                className="input-field w-full"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="min-w-0">
              <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Fecha</label>
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="input-field w-full" required />
            </div>
            <div className="min-w-0">
              <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Hora</label>
              <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} className="input-field w-full" required />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Mesa</label>
            <CompactSelect
              value={form.table_id}
              onChange={(v) => setForm({ ...form, table_id: v })}
              placeholder="Sin asignar"
              emptyHint="No hay mesas libres: las ocupadas o con reserva hoy no aparecen."
              options={[
                { value: '', label: 'Sin asignar' },
                ...formSelectableTables.map((t) => ({
                  value: t.id,
                  label: `${getTableDisplayLabel(t)} (Cap. ${t.capacity})`,
                })),
              ]}
            />
            {formSelectableTables.length === 0 ? (
              <p className="text-[11px] text-[var(--ui-muted)] mt-1">
                No hay mesas libres: las ocupadas o con reserva hoy no aparecen.
              </p>
            ) : null}
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
                        <p className="text-xs text-[#9CA3AF]">
                          Cocina recibe el pedido 30 min antes de la hora (o al crear si ya faltan ≤30 min). Sin mesa
                          también se programa igual y Caja recibe aviso para asignar mesa.
                        </p>
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
