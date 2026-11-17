import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MdAdd, MdBed, MdHotel, MdMoreVert, MdPerson, MdShoppingCart, MdCheckCircle, MdMeetingRoom, MdPayments, MdEventAvailable } from 'react-icons/md';
import ModuleKpiCard from '../../components/ModuleKpiCard';
import toast from 'react-hot-toast';
import Modal from '../../components/Modal';
import HotelRoomQrModal from '../../components/hotel/HotelRoomQrModal';
import HotelRoomAccountModal from '../../components/hotel/HotelRoomAccountModal';
import HotelBookingsPanel from '../../components/hotel/HotelBookingsPanel';
import HotelReportSection from '../../components/admin/HotelReportSection';
import { resolveHotelSection } from '../../components/hotel/hotelNav';
import { useAuth } from '../../context/AuthContext';
import { api, formatCurrency, PAYMENT_METHODS } from '../../utils/api';
import { showStockInOrderingUI, orderingStockCellIsOut, orderingStockCellText } from '../../utils/productStockDisplay';

const EMPTY_ROOM = {
  number: '',
  name: '',
  floor: '',
  capacity: 2,
  nightly_rate: '',
  caja_station_id: '',
  notes: '',
};

const EMPTY_GUEST = {
  guest_name: '',
  guest_doc_type: 'DNI',
  guest_doc_number: '',
  guest_phone: '',
  guest_email: '',
  nights: 1,
};

const DOC_TYPES = ['DNI', 'CE', 'Pasaporte', 'RUC'];
const PAY_OPTIONS = ['efectivo', 'yape', 'plin', 'tarjeta'];

function money(n) {
  return formatCurrency(Number(n) || 0);
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function Hoteleria() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const section = resolveHotelSection(searchParams);
  const isAdmin = user?.role === 'admin' || user?.role === 'master_admin';
  const canHotelDesk = isAdmin || String(user?.role || '').toLowerCase() === 'recepcionista';
  const [rooms, setRooms] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [dayIncome, setDayIncome] = useState(null);
  const [roomQuery, setRoomQuery] = useState('');
  const [stations, setStations] = useState([]);
  const [roomTypes, setRoomTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [roomForm, setRoomForm] = useState(null);
  const [guestForm, setGuestForm] = useState(null);
  const [accountRoom, setAccountRoom] = useState(null);
  const [products, setProducts] = useState([]);
  const [productSearch, setProductSearch] = useState('');
  const [payRoom, setPayRoom] = useState(null);
  const [payMethod, setPayMethod] = useState('efectivo');
  const [qrRoom, setQrRoom] = useState(null);
  const [pedidoRoomId, setPedidoRoomId] = useState(null);
  const [menuRoomId, setMenuRoomId] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get('/hotel/rooms')
      .then((rows) => setRooms(Array.isArray(rows) ? rows : []))
      .catch((err) => toast.error(err.message || 'No se pudieron cargar las habitaciones'))
      .finally(() => setLoading(false));
    api.get('/hotel/bookings')
      .then((rows) => setBookings(Array.isArray(rows) ? rows : []))
      .catch(() => setBookings([]));
  }, []);

  useEffect(() => {
    load();
    api.get('/pos/caja-stations')
      .then((data) => setStations(Array.isArray(data?.stations) ? data.stations : []))
      .catch(() => setStations([]));
    api.get('/hotel/room-types')
      .then((rows) => setRoomTypes(Array.isArray(rows) ? rows : []))
      .catch(() => setRoomTypes([]));
  }, [load]);

  const openAccount = async (room) => {
    setProductSearch('');
    setAccountRoom(room);
    try {
      const caja = String(room?.caja_station_id || '').trim();
      const stockQs = caja ? `&caja_station_id=${encodeURIComponent(caja)}` : '';
      const list = await api.get(`/products?active_only=true&available_now=true${stockQs}`);
      setProducts(Array.isArray(list) ? list : []);
    } catch (err) {
      toast.error(err.message || 'No se pudieron cargar los productos');
    }
  };

  const refreshAccount = async (id) => {
    const fresh = await api.get(`/hotel/rooms/${id}`);
    setAccountRoom(fresh);
    setRooms((prev) => prev.map((r) => (r.id === id ? fresh : r)));
    return fresh;
  };

  const saveRoom = async () => {
    if (!roomForm) return;
    setBusy(true);
    try {
      const payload = {
        ...roomForm,
        nightly_rate: Number(roomForm.nightly_rate),
        capacity: Number(roomForm.capacity) || 2,
      };
      if (roomForm.id) await api.put(`/hotel/rooms/${roomForm.id}`, payload);
      else await api.post('/hotel/rooms', payload);
      toast.success(roomForm.id ? 'Habitación actualizada' : 'Habitación creada');
      setRoomForm(null);
      load();
    } catch (err) {
      toast.error(err.message || 'No se pudo guardar');
    } finally {
      setBusy(false);
    }
  };

  const checkIn = async () => {
    if (!guestForm?.room) return;
    setBusy(true);
    try {
      await api.post(`/hotel/rooms/${guestForm.room.id}/check-in`, {
        guest_name: guestForm.guest_name,
        guest_doc_type: guestForm.guest_doc_type,
        guest_doc_number: guestForm.guest_doc_number,
        guest_phone: guestForm.guest_phone,
        guest_email: guestForm.guest_email,
        nights: Number(guestForm.nights) || 1,
      });
      toast.success('Ingreso registrado');
      setGuestForm(null);
      load();
    } catch (err) {
      toast.error(err.message || 'No se pudo registrar el ingreso');
    } finally {
      setBusy(false);
    }
  };

  const saveStay = async () => {
    if (!accountRoom) return;
    setBusy(true);
    try {
      await api.post(`/hotel/rooms/${accountRoom.id}/stay`, {
        guest_name: accountRoom.guest_name,
        guest_doc_type: accountRoom.guest_doc_type,
        guest_doc_number: accountRoom.guest_doc_number,
        guest_phone: accountRoom.guest_phone,
        guest_email: accountRoom.guest_email,
        nights: Number(accountRoom.nights) || 1,
      });
      await refreshAccount(accountRoom.id);
      toast.success('Cuenta actualizada');
    } catch (err) {
      toast.error(err.message || 'No se pudo actualizar la estadía');
    } finally {
      setBusy(false);
    }
  };

  const addProduct = async (product) => {
    if (!accountRoom) return;
    setBusy(true);
    try {
      await api.post(`/hotel/rooms/${accountRoom.id}/items`, {
        items: [{ product_id: product.id, quantity: 1 }],
      });
      await refreshAccount(accountRoom.id);
      toast.success(`${product.name} cargado a la cuenta`);
    } catch (err) {
      toast.error(err.message || 'No se pudo cargar el producto');
    } finally {
      setBusy(false);
    }
  };

  const payStay = async () => {
    if (!payRoom?.current_order_id) return;
    setBusy(true);
    try {
      await api.post('/pos/checkout-table', {
        order_ids: [payRoom.current_order_id],
        payment_method: payMethod,
        hotel_checkout: true,
      });
      toast.success('Habitación cobrada en su caja');
      setPayRoom(null);
      setAccountRoom(null);
      load();
    } catch (err) {
      toast.error(err.message || 'No se pudo cobrar. Abra la caja correspondiente.');
    } finally {
      setBusy(false);
    }
  };

  const removeRoom = async (room) => {
    if (!window.confirm(`¿Eliminar la habitación ${room.number}?`)) return;
    try {
      await api.delete(`/hotel/rooms/${room.id}`);
      toast.success('Habitación eliminada');
      load();
    } catch (err) {
      toast.error(err.message || 'No se pudo eliminar');
    }
  };

  const toggleMaintenance = async (room) => {
    try {
      await api.post(`/hotel/rooms/${room.id}/maintenance`, { enabled: room.status !== 'maintenance' });
      load();
    } catch (err) {
      toast.error(err.message || 'No se pudo cambiar el estado');
    }
  };

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    return products.filter((p) => !q || String(p.name || '').toLowerCase().includes(q)).slice(0, 30);
  }, [products, productSearch]);

  const today = todayKey();
  const activeBookings = useMemo(
    () => bookings.filter((row) => !row.expired && !['cancelada', 'check_out'].includes(row.status)),
    [bookings],
  );
  const counts = useMemo(() => ({
    available: rooms.filter((r) => r.status === 'available').length,
    occupied: rooms.filter((r) => r.status === 'occupied').length,
    maintenance: rooms.filter((r) => r.status === 'maintenance').length,
    reserved: activeBookings.filter((row) => row.status === 'confirmada' || row.status === 'pendiente_pago').length,
    due: rooms.reduce((sum, room) => sum + Number(room.account_total || 0), 0),
  }), [rooms, activeBookings]);

  const guests = useMemo(() => {
    const map = new Map();
    const add = (row) => {
      const name = String(row.name || '').trim();
      if (!name) return;
      const doc = String(row.doc || '').trim();
      const key = doc ? `doc:${doc.toLowerCase()}` : `name:${name.toLowerCase()}`;
      const current = map.get(key) || { name, doc, phone: row.phone || '', stays: 0, where: '' };
      current.stays += 1;
      if (row.phone) current.phone = row.phone;
      if (row.where) current.where = row.where;
      map.set(key, current);
    };
    rooms.filter((room) => room.status === 'occupied').forEach((room) => add({
      name: room.guest_name,
      doc: room.guest_doc_number,
      phone: room.guest_phone,
      where: `En casa · Hab. ${room.number}`,
    }));
    activeBookings.forEach((row) => add({
      name: row.guest_name,
      doc: row.guest_doc_number,
      phone: row.guest_phone,
      where: row.status === 'check_in' ? 'En casa' : `Reserva ${row.check_in}`,
    }));
    return [...map.values()].sort((a, b) => b.stays - a.stays || a.name.localeCompare(b.name));
  }, [rooms, activeBookings]);

  const shownRooms = useMemo(() => {
    const q = roomQuery.trim().toLowerCase();
    return rooms.filter((room) => {
      if (section === 'estadias' || section === 'cuentas') {
        if (room.status !== 'occupied') return false;
      } else if (section === 'limpieza') {
        if (room.status !== 'maintenance') return false;
      } else if (section !== 'habitaciones') {
        return false;
      }
      if (!q) return true;
      return `${room.number} ${room.name} ${room.guest_name || ''}`.toLowerCase().includes(q);
    });
  }, [rooms, section, roomQuery]);

  const roomSections = section === 'habitaciones' || section === 'estadias' || section === 'cuentas' || section === 'limpieza';
  const upcomingIn = activeBookings.filter((row) => row.status !== 'check_in' && String(row.check_in || '') >= today).slice(0, 5);
  const upcomingOut = rooms.filter((room) => room.status === 'occupied' && room.check_out).slice(0, 5);
  const dueRooms = rooms.filter((room) => room.status === 'occupied' && Number(room.account_total || 0) > 0).slice(0, 5);

  useEffect(() => {
    if (section !== 'dashboard') return undefined;
    const day = todayKey();
    api.get(`/reports/hoteleria?from=${day}&to=${day}`)
      .then((data) => {
        const paid = (data?.rows || []).filter((row) => row.status_key === 'paid' && String(row.paid_at || '').slice(0, 10) === day);
        setDayIncome(paid.reduce((sum, row) => sum + Number(row.total || 0), 0));
      })
      .catch(() => setDayIncome(null));
    return undefined;
  }, [section, rooms]);

  const openSection = (id) => setSearchParams({ seccion: id });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ui-body-text)] flex items-center gap-2">
            <MdHotel className="text-[var(--ui-accent)]" /> Hotelería
          </h1>
          <p className="text-sm text-[var(--ui-muted)]">La cuenta y la caja siguen siendo las de siempre.</p>
        </div>
        {isAdmin && section === 'habitaciones' ? (
          <button type="button" className="inline-flex items-center gap-1 rounded-lg bg-[#3B82F6] px-3 py-2 text-sm font-semibold text-white hover:bg-blue-600" onClick={() => setRoomForm({ ...EMPTY_ROOM, caja_station_id: 'recepcion' })}>
            <MdAdd /> Nueva habitación
          </button>
        ) : null}
      </div>

      {section === 'dashboard' ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            <ModuleKpiCard icon={MdCheckCircle} title="Disponibles" value={counts.available} tone="emerald" />
            <ModuleKpiCard icon={MdMeetingRoom} title="Ocupadas" value={counts.occupied} tone="amber" />
            <ModuleKpiCard icon={MdEventAvailable} title="Reservadas" value={counts.reserved} tone="sky" />
            <ModuleKpiCard icon={MdBed} title="Mantenimiento" value={counts.maintenance} tone="violet" />
            <ModuleKpiCard icon={MdPayments} title="Por cobrar" value={money(counts.due)} tone="sky" />
            <ModuleKpiCard icon={MdCheckCircle} title="Cobrado hoy" value={dayIncome == null ? '—' : money(dayIncome)} tone="emerald" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <section className="card space-y-2">
              <h2 className="font-semibold">Próximos ingresos</h2>
              {upcomingIn.length === 0 ? <p className="text-sm text-[var(--ui-muted)]">No hay reservas por llegar.</p> : upcomingIn.map((row) => (
                <p key={row.id} className="text-sm">{row.check_in} · {row.guest_name}</p>
              ))}
            </section>
            <section className="card space-y-2">
              <h2 className="font-semibold">Próximas salidas</h2>
              {upcomingOut.length === 0 ? <p className="text-sm text-[var(--ui-muted)]">Nadie tiene fecha de salida cargada.</p> : upcomingOut.map((room) => (
                <p key={room.id} className="text-sm">Hab. {room.number} · {room.guest_name} · {room.check_out}</p>
              ))}
            </section>
            <section className="card space-y-2">
              <h2 className="font-semibold">Cuentas pendientes</h2>
              {dueRooms.length === 0 ? <p className="text-sm text-[var(--ui-muted)]">No hay saldo en habitaciones ocupadas.</p> : dueRooms.map((room) => (
                <button key={room.id} type="button" className="block w-full text-left text-sm" onClick={() => openSection('cuentas')}>
                  Hab. {room.number} · <strong className="text-violet-700">{money(room.account_total)}</strong>
                </button>
              ))}
              {counts.maintenance > 0 ? (
                <button type="button" className="text-sm font-semibold text-amber-800" onClick={() => openSection('limpieza')}>
                  {counts.maintenance} en mantenimiento
                </button>
              ) : null}
            </section>
          </div>
        </>
      ) : null}

      {section === 'reservas' && canHotelDesk ? <HotelBookingsPanel isAdmin={isAdmin} onChanged={load} /> : null}
      {section === 'reservas' && !canHotelDesk ? <p className="card text-sm text-[var(--ui-muted)]">Las reservas las registra recepción o el administrador.</p> : null}

      {section === 'huespedes' ? (
        <section className="card overflow-x-auto">
          <h2 className="font-semibold mb-2">Huéspedes de reservas y estadías abiertas</h2>
          <p className="text-xs text-[var(--ui-muted)] mb-3">Si el documento coincide, se muestra una sola vez. El historial cobrado está en Informes.</p>
          {guests.length === 0 ? <p className="text-sm text-[var(--ui-muted)]">Todavía no hay huéspedes cargados.</p> : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[color:var(--ui-border)] text-left text-[var(--ui-muted)]">
                  <th className="py-2 pr-3">Nombre</th>
                  <th className="py-2 pr-3">Documento</th>
                  <th className="py-2 pr-3">Teléfono</th>
                  <th className="py-2 pr-3">Dónde</th>
                  <th className="py-2">Veces</th>
                </tr>
              </thead>
              <tbody>
                {guests.map((guest) => (
                  <tr key={`${guest.doc}-${guest.name}`} className="border-b border-[color:var(--ui-border)]">
                    <td className="py-2 pr-3 font-medium">{guest.name}</td>
                    <td className="py-2 pr-3">{guest.doc || '—'}</td>
                    <td className="py-2 pr-3">{guest.phone || '—'}</td>
                    <td className="py-2 pr-3">{guest.where || '—'}</td>
                    <td className="py-2">{guest.stays > 1 ? 'Recurrente' : '1'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : null}

      {section === 'informes' ? <HotelReportSection /> : null}

      {section === 'configuracion' ? (
        <section className="card space-y-3">
          <h2 className="font-semibold">Tipos y tarifas</h2>
          <p className="text-sm text-[var(--ui-muted)]">Cada habitación guarda su tarifa por noche, piso y capacidad. El tipo publica esa tarifa en la web y, si tiene precio de fin de semana, la reserva lo usa al cotizar.</p>
          {roomTypes.length === 0 ? <p className="text-sm text-[var(--ui-muted)]">Aún no hay tipos.</p> : (
            <ul className="space-y-2">
              {roomTypes.map((type) => (
                <li key={type.id} className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm">
                  <strong>{type.name}</strong> · {money(type.nightly_rate)} por noche
                  {Number(type.weekend_rate) > 0 ? ` · fin de semana ${money(type.weekend_rate)}` : ''}
                </li>
              ))}
            </ul>
          )}
          {isAdmin ? <HotelBookingsPanel isAdmin onlyTypes onChanged={() => api.get('/hotel/room-types').then((rows) => setRoomTypes(Array.isArray(rows) ? rows : [])).catch(() => {})} /> : (
            <p className="text-sm text-[var(--ui-muted)]">Solo el administrador crea tipos y habitaciones.</p>
          )}
        </section>
      ) : null}

      {roomSections && (section === 'habitaciones' || section === 'estadias' || section === 'cuentas') ? (
        <input className="input-field" placeholder="Buscar habitación o huésped" value={roomQuery} onChange={(e) => setRoomQuery(e.target.value)} />
      ) : null}
      {section === 'limpieza' ? (
        <p className="text-sm text-[var(--ui-muted)]">Al cobrar, la habitación pasa a mantenimiento y no se puede reservar ni ocupar hasta que recepción la active.</p>
      ) : null}

      {roomSections && loading ? (
        <div className="min-h-[30vh] flex items-center justify-center"><div className="rf-loader rf-loader--md" /></div>
      ) : null}
      {roomSections && !loading && shownRooms.length === 0 ? (
        <div className="card text-sm text-[var(--ui-muted)]">
          {section === 'limpieza' ? 'No hay habitaciones en mantenimiento.' : section === 'habitaciones' && rooms.length === 0 ? 'Todavía no hay habitaciones. Cree la primera y elija Recepción o una caja.' : 'No hay habitaciones en esta vista.'}
        </div>
      ) : null}
      {roomSections && !loading && shownRooms.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {shownRooms.map((room) => {
            const occupied = room.status === 'occupied';
            const maintenance = room.status === 'maintenance';
            return (
              <article
                key={room.id}
                className={`rounded-2xl border bg-[var(--ui-surface)] p-4 text-[var(--ui-body-text)] shadow-sm ${
                  occupied ? 'border-amber-300' : maintenance ? 'border-slate-300' : 'border-emerald-300'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-[var(--ui-muted)]">{room.caja_name || 'Sin caja'}</p>
                    <h2 className="text-lg font-bold flex items-center gap-1"><MdBed /> {room.number}</h2>
                    <p className="text-sm text-[var(--ui-muted)]">{room.name}{room.floor ? ` · Piso ${room.floor}` : ''}</p>
                  </div>
                  <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
                    occupied ? 'bg-amber-100 text-amber-800' : maintenance ? 'bg-slate-100 text-slate-600' : 'bg-emerald-100 text-emerald-700'
                  }`}>
                    {occupied ? 'Ocupada' : maintenance ? 'Mantenimiento' : 'Disponible'}
                  </span>
                </div>
                <p className="mt-3 text-sm">Noche: <strong>{money(room.nightly_rate)}</strong> · {room.capacity || 1} pax</p>
                {occupied ? (
                  <div className="mt-2 text-sm space-y-1">
                    <p className="flex items-center gap-1"><MdPerson /> {room.guest_name}</p>
                    <p className="text-[var(--ui-muted)]">{room.guest_doc_type} {room.guest_doc_number} · {room.nights} noche(s)</p>
                    <p>Cuenta: <strong className="text-violet-700">{money(room.account_total)}</strong></p>
                  </div>
                ) : null}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {!occupied && !maintenance ? (
                    <button type="button" className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700" onClick={() => setGuestForm({ room, ...EMPTY_GUEST })}>Ingreso</button>
                  ) : null}
                  {occupied ? (
                    <>
                      <button type="button" className="rounded-lg bg-sky-100 px-3 py-1.5 text-xs font-semibold text-sky-800 hover:bg-sky-200" onClick={() => setPedidoRoomId(room.id)}>Pedido</button>
                      <button type="button" className="rounded-lg bg-[#3B82F6] px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-600" onClick={() => { setPayMethod('efectivo'); setPayRoom(room); }}>Salida</button>
                    </>
                  ) : null}
                  {canHotelDesk && !occupied ? (
                    <button type="button" className="rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-200" onClick={() => toggleMaintenance(room)}>{maintenance ? 'Activar' : 'Mantenimiento'}</button>
                  ) : null}
                  <div className="relative ml-auto">
                    <button
                      type="button"
                      className="btn-secondary text-xs px-2"
                      aria-label="Más opciones"
                      aria-expanded={menuRoomId === room.id}
                      onClick={() => setMenuRoomId((id) => (id === room.id ? null : room.id))}
                    >
                      <MdMoreVert className="text-lg" />
                    </button>
                    {menuRoomId === room.id ? (
                      <>
                        <button type="button" className="fixed inset-0 z-10 cursor-default" aria-label="Cerrar menú" onClick={() => setMenuRoomId(null)} />
                        <div className="absolute right-0 top-full z-20 mt-1 min-w-[9.5rem] rounded-xl border border-[color:var(--ui-border)] bg-[var(--ui-surface)] py-1 shadow-lg">
                          {occupied ? (
                            <button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--ui-sidebar-hover)]" onClick={() => { setMenuRoomId(null); openAccount(room); }}>Cuenta</button>
                          ) : null}
                          <button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--ui-sidebar-hover)]" onClick={() => { setMenuRoomId(null); setQrRoom(room); }}>Ver QR</button>
                          {isAdmin && !occupied ? (
                            <button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--ui-sidebar-hover)]" onClick={() => { setMenuRoomId(null); setRoomForm({ ...room }); }}>Editar</button>
                          ) : null}
                          {isAdmin && !occupied ? (
                            <button type="button" className="block w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-[var(--ui-sidebar-hover)]" onClick={() => { setMenuRoomId(null); removeRoom(room); }}>Eliminar</button>
                          ) : null}
                        </div>
                      </>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      <Modal isOpen={!!roomForm} onClose={() => setRoomForm(null)} title={roomForm?.id ? 'Editar habitación' : 'Nueva habitación'} size="md">
        {roomForm ? (
          <div className="space-y-3">
            <label className="block text-sm">Número
              <input className="input-field mt-1" value={roomForm.number} onChange={(e) => setRoomForm({ ...roomForm, number: e.target.value })} />
            </label>
            <label className="block text-sm">Nombre
              <input className="input-field mt-1" value={roomForm.name} onChange={(e) => setRoomForm({ ...roomForm, name: e.target.value })} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">Piso
                <input className="input-field mt-1" value={roomForm.floor || ''} onChange={(e) => setRoomForm({ ...roomForm, floor: e.target.value })} />
              </label>
              <label className="block text-sm">Capacidad
                <input type="number" min="1" className="input-field mt-1" value={roomForm.capacity} onChange={(e) => setRoomForm({ ...roomForm, capacity: e.target.value })} />
              </label>
            </div>
            <label className="block text-sm">Costo por noche
              <input type="number" min="0" step="0.5" className="input-field mt-1" value={roomForm.nightly_rate} onChange={(e) => setRoomForm({ ...roomForm, nightly_rate: e.target.value })} />
            </label>
            {roomTypes.length ? (
              <label className="block text-sm">Tipo para la web
                <select className="input-field mt-1" value={roomForm.room_type_id || ''} onChange={(e) => setRoomForm({ ...roomForm, room_type_id: e.target.value })}>
                  <option value="">Sin tipo</option>
                  {roomTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
                </select>
              </label>
            ) : null}
            <label className="block text-sm">Caja
              <select className="input-field mt-1" value={roomForm.caja_station_id || 'recepcion'} onChange={(e) => setRoomForm({ ...roomForm, caja_station_id: e.target.value })}>
                <option value="recepcion">Recepción</option>
                {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <p className="text-xs text-[var(--ui-muted)]">Recepción no se vincula a una caja y la habitación solo aparece en Hotel.</p>
            <label className="block text-sm">Notas
              <input className="input-field mt-1" value={roomForm.notes || ''} onChange={(e) => setRoomForm({ ...roomForm, notes: e.target.value })} />
            </label>
            <button type="button" className="btn-primary w-full" disabled={busy} onClick={saveRoom}>Guardar</button>
          </div>
        ) : null}
      </Modal>

      <Modal isOpen={!!guestForm} onClose={() => setGuestForm(null)} title={`Ingreso · Habitación ${guestForm?.room?.number || ''}`} size="md">
        {guestForm ? (
          <div className="space-y-3">
            <p className="text-sm text-[var(--ui-muted)]">{money(guestForm.room.nightly_rate)} por noche · {guestForm.room.caja_name || 'Caja asignada'}</p>
            <label className="block text-sm">Huésped
              <input className="input-field mt-1" value={guestForm.guest_name} onChange={(e) => setGuestForm({ ...guestForm, guest_name: e.target.value })} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">Documento
                <select className="input-field mt-1" value={guestForm.guest_doc_type} onChange={(e) => setGuestForm({ ...guestForm, guest_doc_type: e.target.value })}>
                  {DOC_TYPES.map((d) => <option key={d}>{d}</option>)}
                </select>
              </label>
              <label className="block text-sm">Número
                <input className="input-field mt-1" value={guestForm.guest_doc_number} onChange={(e) => setGuestForm({ ...guestForm, guest_doc_number: e.target.value })} />
              </label>
            </div>
            <label className="block text-sm">Teléfono
              <input className="input-field mt-1" value={guestForm.guest_phone} onChange={(e) => setGuestForm({ ...guestForm, guest_phone: e.target.value })} />
            </label>
            <label className="block text-sm">Correo
              <input className="input-field mt-1" value={guestForm.guest_email} onChange={(e) => setGuestForm({ ...guestForm, guest_email: e.target.value })} />
            </label>
            <label className="block text-sm">Noches
              <input type="number" min="1" className="input-field mt-1" value={guestForm.nights} onChange={(e) => setGuestForm({ ...guestForm, nights: e.target.value })} />
            </label>
            <p className="text-sm font-semibold">Hospedaje: {money(Number(guestForm.room.nightly_rate) * (Number(guestForm.nights) || 0))}</p>
            <button type="button" className="btn-primary w-full" disabled={busy} onClick={checkIn}>Registrar ingreso</button>
          </div>
        ) : null}
      </Modal>

      <Modal isOpen={!!accountRoom} onClose={() => setAccountRoom(null)} title={`Cuenta · Habitación ${accountRoom?.number || ''}`} size="lg">
        {accountRoom ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2 text-sm">
              <p className="font-semibold">{accountRoom.guest_name}</p>
              <label className="block">Noches
                <input type="number" min="1" className="input-field mt-1" value={accountRoom.nights || 1} onChange={(e) => setAccountRoom({ ...accountRoom, nights: e.target.value })} />
              </label>
              <button type="button" className="btn-secondary text-xs" disabled={busy} onClick={saveStay}>Actualizar noches</button>
              <ul className="mt-3 space-y-1">
                {(accountRoom.account?.items || []).map((it) => (
                  <li key={it.id} className="flex justify-between gap-2 border-b border-[color:var(--ui-border)] py-1">
                    <span>{it.quantity} × {it.product_name}</span>
                    <span>{money(it.subtotal)}</span>
                  </li>
                ))}
              </ul>
              <p className="font-bold text-[var(--ui-accent)]">Total {money(accountRoom.account_total)}</p>
            </div>
            <div>
              <p className="text-sm font-semibold mb-2 flex items-center gap-1"><MdShoppingCart /> Cargar producto</p>
              <input className="input-field mb-2" placeholder="Buscar" value={productSearch} onChange={(e) => setProductSearch(e.target.value)} />
              <div className="max-h-72 overflow-auto space-y-1">
                {filteredProducts.map((p) => (
                  <button key={p.id} type="button" disabled={busy} className="w-full text-left rounded-lg border border-[color:var(--ui-border)] px-3 py-2 text-sm hover:bg-[var(--ui-sidebar-hover)]" onClick={() => addProduct(p)}>
                    <span className="font-medium">{p.name}</span>
                    {showStockInOrderingUI(p) ? (
                      <span className={`ml-2 text-xs ${orderingStockCellIsOut(p) ? 'text-red-600' : 'text-[var(--ui-muted)]'}`}>
                        Stock {orderingStockCellText(p)}
                      </span>
                    ) : null}
                    <span className="float-right text-[var(--ui-accent)]">{money(p.price)}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      <HotelRoomAccountModal roomId={pedidoRoomId} onClose={() => { setPedidoRoomId(null); load(); }} />

      <HotelRoomQrModal room={qrRoom} onClose={() => setQrRoom(null)} />

      <Modal isOpen={!!payRoom} onClose={() => setPayRoom(null)} title={`Salida · Habitación ${payRoom?.number || ''}`} size="sm">
        {payRoom ? (
          <div className="space-y-3">
            <p className="text-sm">La salida se registra en <strong>{payRoom.caja_name || 'Recepción'}</strong>. Al confirmar, la habitación queda en mantenimiento.</p>
            <p className="text-2xl font-bold text-[var(--ui-accent)]">{money(payRoom.account_total)}</p>
            <label className="block text-sm">Medio de pago
              <select className="input-field mt-1" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                {PAY_OPTIONS.map((id) => <option key={id} value={id}>{PAYMENT_METHODS[id] || id}</option>)}
              </select>
            </label>
            <button type="button" className="btn-primary w-full" disabled={busy} onClick={payStay}>Confirmar salida</button>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
