import { useCallback, useEffect, useMemo, useState } from 'react';
import { MdAdd, MdBed, MdHotel, MdMoreVert, MdPerson, MdShoppingCart } from 'react-icons/md';
import toast from 'react-hot-toast';
import Modal from '../../components/Modal';
import HotelRoomQrModal from '../../components/hotel/HotelRoomQrModal';
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

export default function Hoteleria() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'master_admin';
  const canHotelDesk = isAdmin || String(user?.role || '').toLowerCase() === 'recepcionista';
  const [rooms, setRooms] = useState([]);
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [roomForm, setRoomForm] = useState(null);
  const [guestForm, setGuestForm] = useState(null);
  const [accountRoom, setAccountRoom] = useState(null);
  const [products, setProducts] = useState([]);
  const [productSearch, setProductSearch] = useState('');
  const [payRoom, setPayRoom] = useState(null);
  const [payMethod, setPayMethod] = useState('efectivo');
  const [qrRoom, setQrRoom] = useState(null);
  const [menuRoomId, setMenuRoomId] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get('/hotel/rooms')
      .then((rows) => setRooms(Array.isArray(rows) ? rows : []))
      .catch((err) => toast.error(err.message || 'No se pudieron cargar las habitaciones'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    api.get('/pos/caja-stations')
      .then((data) => setStations(Array.isArray(data?.stations) ? data.stations : []))
      .catch(() => setStations([]));
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
      toast.success('Ingreso registrado. La cuenta ya está en su caja.');
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

  const counts = useMemo(() => ({
    available: rooms.filter((r) => r.status === 'available').length,
    occupied: rooms.filter((r) => r.status === 'occupied').length,
    due: rooms.reduce((s, r) => s + Number(r.account_total || 0), 0),
  }), [rooms]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ui-body-text)] flex items-center gap-2">
            <MdHotel className="text-[var(--ui-accent)]" /> Hotelería
          </h1>
          <p className="text-sm text-[var(--ui-muted)]">Habitaciones, huésped, noches y consumo a cuenta de su caja.</p>
        </div>
        {isAdmin ? (
          <button type="button" className="btn-primary text-sm" onClick={() => setRoomForm({ ...EMPTY_ROOM, caja_station_id: stations[0]?.id || '' })}>
            <MdAdd className="inline mr-1" /> Nueva habitación
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="card">
          <p className="text-xs text-[var(--ui-muted)]">Disponibles</p>
          <p className="text-2xl font-bold text-[var(--ui-body-text)]">{counts.available}</p>
        </div>
        <div className="card">
          <p className="text-xs text-[var(--ui-muted)]">Ocupadas</p>
          <p className="text-2xl font-bold text-[var(--ui-accent)]">{counts.occupied}</p>
        </div>
        <div className="card">
          <p className="text-xs text-[var(--ui-muted)]">Por cobrar</p>
          <p className="text-2xl font-bold text-[var(--ui-body-text)]">{money(counts.due)}</p>
        </div>
      </div>

      {loading ? (
        <div className="min-h-[30vh] flex items-center justify-center"><div className="rf-loader rf-loader--md" /></div>
      ) : rooms.length === 0 ? (
        <div className="card text-sm text-[var(--ui-muted)]">Todavía no hay habitaciones. Cree la primera y asígnele su caja.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {rooms.map((room) => {
            const occupied = room.status === 'occupied';
            const maintenance = room.status === 'maintenance';
            return (
              <article
                key={room.id}
                className="rounded-2xl border bg-[var(--ui-surface)] p-4 text-[var(--ui-body-text)] shadow-sm"
                style={{ borderColor: occupied ? 'var(--ui-accent)' : 'var(--ui-border)' }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-[var(--ui-muted)]">{room.caja_name || 'Sin caja'}</p>
                    <h2 className="text-lg font-bold flex items-center gap-1"><MdBed /> {room.number}</h2>
                    <p className="text-sm text-[var(--ui-muted)]">{room.name}{room.floor ? ` · Piso ${room.floor}` : ''}</p>
                  </div>
                  <span className="text-xs font-semibold px-2 py-1 rounded-full border border-[color:var(--ui-border)]">
                    {occupied ? 'Ocupada' : maintenance ? 'Mantenimiento' : 'Disponible'}
                  </span>
                </div>
                <p className="mt-3 text-sm">Noche: <strong>{money(room.nightly_rate)}</strong> · {room.capacity || 1} pax</p>
                {occupied ? (
                  <div className="mt-2 text-sm space-y-1">
                    <p className="flex items-center gap-1"><MdPerson /> {room.guest_name}</p>
                    <p className="text-[var(--ui-muted)]">{room.guest_doc_type} {room.guest_doc_number} · {room.nights} noche(s)</p>
                    <p>Cuenta: <strong className="text-[var(--ui-accent)]">{money(room.account_total)}</strong></p>
                  </div>
                ) : null}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {!occupied && !maintenance ? (
                    <button type="button" className="btn-primary text-xs" onClick={() => setGuestForm({ room, ...EMPTY_GUEST })}>Ingreso</button>
                  ) : null}
                  {occupied ? (
                    <button type="button" className="btn-primary text-xs" onClick={() => { setPayMethod('efectivo'); setPayRoom(room); }}>Salida</button>
                  ) : null}
                  {canHotelDesk && !occupied ? (
                    <button type="button" className="btn-secondary text-xs" onClick={() => toggleMaintenance(room)}>{maintenance ? 'Activar' : 'Mantenimiento'}</button>
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
      )}

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
            <label className="block text-sm">Caja
              <select className="input-field mt-1" value={roomForm.caja_station_id || ''} onChange={(e) => setRoomForm({ ...roomForm, caja_station_id: e.target.value })}>
                <option value="">Seleccione</option>
                {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
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

      <HotelRoomQrModal room={qrRoom} onClose={() => setQrRoom(null)} />

      <Modal isOpen={!!payRoom} onClose={() => setPayRoom(null)} title={`Salida · Habitación ${payRoom?.number || ''}`} size="sm">
        {payRoom ? (
          <div className="space-y-3">
            <p className="text-sm">La salida se registra en <strong>{payRoom.caja_name || 'la caja de la habitación'}</strong>. Al confirmar, la habitación queda en mantenimiento.</p>
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
