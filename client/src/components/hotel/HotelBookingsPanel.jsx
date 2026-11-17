import { useCallback, useEffect, useState } from 'react';
import { MdEventAvailable } from 'react-icons/md';
import toast from 'react-hot-toast';
import Modal from '../Modal';
import { api, formatCurrency } from '../../utils/api';

function todayKey() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function plusDays(key, days) {
  const [y, m, d] = key.split('-').map((n) => Number(n));
  const dt = new Date(y, m - 1, d + days);
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

const STATUS_LABEL = {
  pendiente_pago: 'Pendiente de pago',
  confirmada: 'Confirmada',
  check_in: 'En casa',
  check_out: 'Salió',
  cancelada: 'Cancelada',
};

const STATUS_CHIP = {
  pendiente_pago: 'bg-amber-100 text-amber-800',
  confirmada: 'bg-sky-100 text-sky-800',
  check_in: 'bg-emerald-100 text-emerald-800',
  check_out: 'bg-violet-100 text-violet-800',
  cancelada: 'bg-slate-100 text-slate-600',
};

function TypeForm({ onSaved }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [rate, setRate] = useState('');
  const [weekend, setWeekend] = useState('');
  const [amenities, setAmenities] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <button type="button" className="text-xs font-semibold text-sky-700 hover:underline" onClick={() => setOpen(true)}>
        Crear tipo de habitación para la web
      </button>
    );
  }
  const save = async () => {
    setBusy(true);
    try {
      await api.post('/hotel/room-types', {
        name,
        nightly_rate: rate,
        weekend_rate: weekend,
        amenities,
        adults: 2,
        children: 1,
      });
      toast.success('Tipo listo. Asigne las habitaciones a ese tipo para publicarlas.');
      setOpen(false);
      setName('');
      setRate('');
      onSaved?.();
    } catch (err) {
      toast.error(err.message || 'No se pudo crear el tipo');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button type="button" className="text-xs font-semibold text-sky-700 hover:underline" onClick={() => setOpen(true)}>
        Crear tipo de habitación para la web
      </button>
      <Modal isOpen={open} onClose={() => setOpen(false)} title="Tipo de habitación" size="md">
        <div className="space-y-3">
          <input className="input-field" placeholder="Nombre, ej. Matrimonial" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input-field" placeholder="Precio por noche" value={rate} onChange={(e) => setRate(e.target.value)} />
          <input className="input-field" placeholder="Fin de semana, opcional" value={weekend} onChange={(e) => setWeekend(e.target.value)} />
          <input className="input-field" placeholder="WiFi, TV, Aire" value={amenities} onChange={(e) => setAmenities(e.target.value)} />
          <button type="button" className="w-full rounded-lg bg-[#3B82F6] px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-60" disabled={busy} onClick={save}>Guardar tipo</button>
        </div>
      </Modal>
    </>
  );
}

export default function HotelBookingsPanel({ onChanged, isAdmin = false, onlyTypes = false }) {
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [freeRooms, setFreeRooms] = useState([]);
  const [form, setForm] = useState(null);

  const load = useCallback(() => {
    api.get(`/hotel/bookings?from=${todayKey()}`)
      .then((list) => setRows(Array.isArray(list) ? list : []))
      .catch(() => setRows([]));
  }, []);

  useEffect(() => { load(); }, [load]);

  const start = () => {
    const checkIn = todayKey();
    setForm({
      check_in: checkIn,
      check_out: plusDays(checkIn, 1),
      adults: 1,
      children: 0,
      room_id: '',
      guest_name: '',
      guest_doc_type: 'DNI',
      guest_doc_number: '',
      guest_phone: '',
      guest_email: '',
    });
    setOpen(true);
    setFreeRooms([]);
    void searchRooms({
      check_in: checkIn,
      check_out: plusDays(checkIn, 1),
      adults: 1,
      children: 0,
    });
  };

  const searchRooms = async (next = form) => {
    if (!next?.check_in || !next?.check_out) return;
    try {
      const data = await api.get(
        `/hotel/availability?checkin=${next.check_in}&checkout=${next.check_out}&adultos=${next.adults || 1}&ninos=${next.children || 0}`
      );
      setFreeRooms(Array.isArray(data?.rooms) ? data.rooms : []);
    } catch (err) {
      toast.error(err.message || 'No se pudo buscar disponibilidad');
    }
  };

  const save = async () => {
    if (!form?.room_id) return toast.error('Elija la habitación libre');
    setBusy(true);
    try {
      await api.post('/hotel/bookings', { ...form, channel: 'recepcion' });
      toast.success('Reserva confirmada. La habitación queda apartada.');
      setOpen(false);
      load();
    } catch (err) {
      toast.error(err.message || 'No se pudo reservar');
    } finally {
      setBusy(false);
    }
  };

  const act = async (id, action) => {
    setBusy(true);
    try {
      if (action === 'check-in') await api.post(`/hotel/bookings/${id}/check-in`, {});
      else if (action === 'cancel') await api.post(`/hotel/bookings/${id}/cancel`, {});
      else await api.post(`/hotel/bookings/${id}/confirm`, {});
      toast.success(action === 'check-in' ? 'Ingreso hecho. La cuenta ya está en la habitación.' : 'Reserva actualizada');
      load();
      if (action === 'check-in') onChanged?.();
    } catch (err) {
      toast.error(err.message || 'No se pudo completar');
    } finally {
      setBusy(false);
    }
  };

  const visible = rows.filter((row) => !row.expired && row.status !== 'check_out' && row.status !== 'cancelada');

  if (onlyTypes) {
    return isAdmin ? <TypeForm onSaved={onChanged} /> : null;
  }

  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-[var(--ui-body-text)]">Reservas</h2>
          <p className="text-xs text-[var(--ui-muted)]">Aparta la habitación antes de que llegue el huésped. El ingreso abre la misma cuenta de siempre.</p>
        </div>
        <button type="button" className="inline-flex items-center gap-1 rounded-lg bg-[#3B82F6] px-3 py-2 text-xs font-semibold text-white hover:bg-blue-600" onClick={start}>
          <MdEventAvailable className="text-base" /> Nueva reserva
        </button>
      </div>
      {visible.length === 0 ? (
        <p className="text-sm text-[var(--ui-muted)]">No hay reservas por llegar.</p>
      ) : (
        <ul className="space-y-2">
          {visible.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[color:var(--ui-border)] px-3 py-2">
              <div className="min-w-0 text-sm">
                <p className="font-semibold">{row.code} · {row.guest_name}</p>
                <p className="text-[var(--ui-muted)]">
                  {row.check_in} → {row.check_out}
                  {' · '}
                  {(row.rooms || []).map((room) => room.room_number).filter(Boolean).join(', ') || 'Sin número'}
                  {' · '}
                  {formatCurrency(row.lodging_total)}
                </p>
                <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_CHIP[row.status] || 'bg-slate-100 text-slate-600'}`}>
                  {row.expired ? 'Venció el apartado' : (STATUS_LABEL[row.status] || row.status)}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {row.status === 'pendiente_pago' && !row.expired ? (
                  <button type="button" className="rounded-lg bg-sky-100 px-3 py-1.5 text-xs font-semibold text-sky-800 disabled:opacity-60" disabled={busy} onClick={() => act(row.id, 'confirm')}>Confirmar</button>
                ) : null}
                {['confirmada', 'pendiente_pago'].includes(row.status) && !row.expired ? (
                  <button type="button" className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60" disabled={busy} onClick={() => act(row.id, 'check-in')}>Ingreso</button>
                ) : null}
                {row.status !== 'check_in' ? (
                  <button type="button" className="rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-800 disabled:opacity-60" disabled={busy} onClick={() => act(row.id, 'cancel')}>Cancelar</button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {open && form ? (
        <Modal isOpen={open} onClose={() => setOpen(false)} title="Nueva reserva" size="lg">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">Entrada
                <input type="date" className="input-field mt-1" value={form.check_in} onChange={(e) => setForm({ ...form, check_in: e.target.value })} />
              </label>
              <label className="text-sm">Salida
                <input type="date" className="input-field mt-1" value={form.check_out} onChange={(e) => setForm({ ...form, check_out: e.target.value })} />
              </label>
              <label className="text-sm">Adultos
                <input type="number" min="1" className="input-field mt-1" value={form.adults} onChange={(e) => setForm({ ...form, adults: e.target.value })} />
              </label>
              <label className="text-sm">Niños
                <input type="number" min="0" className="input-field mt-1" value={form.children} onChange={(e) => setForm({ ...form, children: e.target.value })} />
              </label>
            </div>
            <button type="button" className="rounded-lg bg-sky-100 px-3 py-2 text-xs font-semibold text-sky-800 hover:bg-sky-200" onClick={() => searchRooms(form)}>Ver habitaciones libres</button>
            <label className="block text-sm">Habitación
              <select className="input-field mt-1" value={form.room_id} onChange={(e) => setForm({ ...form, room_id: e.target.value })}>
                <option value="">Seleccione</option>
                {freeRooms.map((room) => (
                  <option key={room.id} value={room.id}>{room.number} · {room.name}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm">Huésped
              <input className="input-field mt-1" value={form.guest_name} onChange={(e) => setForm({ ...form, guest_name: e.target.value })} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">Documento
                <input className="input-field mt-1" value={form.guest_doc_number} onChange={(e) => setForm({ ...form, guest_doc_number: e.target.value })} />
              </label>
              <label className="text-sm">WhatsApp
                <input className="input-field mt-1" value={form.guest_phone} onChange={(e) => setForm({ ...form, guest_phone: e.target.value })} />
              </label>
            </div>
            <button type="button" className="w-full rounded-lg bg-[#3B82F6] px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-60" disabled={busy} onClick={save}>Confirmar reserva</button>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
