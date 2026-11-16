import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MdHotel } from 'react-icons/md';
import { api, formatCurrency } from '../../utils/api';

function todayKey() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function plusDays(key, days) {
  const [y, m, d] = key.split('-').map((n) => Number(n));
  const dt = new Date(y, (m || 1) - 1, (d || 1) + days);
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

const ORIGIN = {
  instagram: 'instagram',
  facebook: 'facebook',
  whatsapp: 'whatsapp',
  tiktok: 'tiktok',
  web: 'web',
};

export default function HotelPublicBooking() {
  const [params] = useSearchParams();
  const origen = ORIGIN[String(params.get('origen') || '').toLowerCase()] || 'web';
  const [step, setStep] = useState(1);
  const [search, setSearch] = useState(() => {
    const checkIn = params.get('checkin') || todayKey();
    return {
      checkin: checkIn,
      checkout: params.get('checkout') || plusDays(checkIn, 1),
      adultos: 2,
      ninos: 0,
    };
  });
  const [types, setTypes] = useState([]);
  const [searched, setSearched] = useState(false);
  const [picked, setPicked] = useState(null);
  const [guest, setGuest] = useState({
    guest_name: '',
    guest_doc_type: 'DNI',
    guest_doc_number: '',
    guest_phone: '',
    guest_email: '',
    arrival_time: '',
  });
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const nights = useMemo(() => {
    if (!search.checkin || !search.checkout || search.checkout <= search.checkin) return 0;
    const start = new Date(`${search.checkin}T12:00:00`);
    const end = new Date(`${search.checkout}T12:00:00`);
    return Math.round((end - start) / 86400000);
  }, [search]);

  useEffect(() => {
    const code = String(params.get('codigo') || '').trim();
    if (!code) return;
    api.get(`/public/hotel/reserva/${encodeURIComponent(code)}`, { skipOffline: true })
      .then((row) => {
        setResult(row);
        setStep(3);
      })
      .catch(() => {});
  }, [params]);

  const look = async () => {
    setError('');
    if (nights < 1) {
      setError('La salida tiene que ser después de la entrada.');
      return;
    }
    setBusy(true);
    try {
      const data = await api.get(
        `/public/hotel/disponibilidad?checkin=${search.checkin}&checkout=${search.checkout}&adultos=${search.adultos}&ninos=${search.ninos}`,
        { skipOffline: true }
      );
      setTypes(Array.isArray(data?.tipos) ? data.tipos : []);
      setSearched(true);
      setPicked(null);
    } catch (err) {
      setError(err.message || 'No se pudo consultar la disponibilidad');
    } finally {
      setBusy(false);
    }
  };

  const reserve = async () => {
    if (!picked) return;
    setBusy(true);
    setError('');
    try {
      const created = await api.post('/public/hotel/reservar', {
        ...guest,
        check_in: search.checkin,
        check_out: search.checkout,
        cantidad_adultos: search.adultos,
        cantidad_ninos: search.ninos,
        tipo_habitacion_id: picked.id,
        origen,
      }, { skipOffline: true });
      setResult(created);
      setStep(3);
    } catch (err) {
      setError(err.message || 'No se pudo crear la reserva');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--ui-body-bg)] text-[var(--ui-body-text)]">
      <div className="mx-auto max-w-lg px-4 py-6 space-y-4">
        <header className="flex items-center gap-2">
          <MdHotel className="text-3xl text-[var(--ui-accent)]" />
          <div>
            <h1 className="text-xl font-bold">Reserva tu habitación</h1>
            <p className="text-xs text-[var(--ui-muted)]">Te apartamos la habitación 15 minutos para enviar el pago.</p>
          </div>
        </header>

        {step === 1 ? (
          <section className="card space-y-3">
            <label className="block text-sm">Entrada
              <input type="date" className="input-field mt-1" value={search.checkin} onChange={(e) => setSearch({ ...search, checkin: e.target.value })} />
            </label>
            <label className="block text-sm">Salida
              <input type="date" className="input-field mt-1" value={search.checkout} onChange={(e) => setSearch({ ...search, checkout: e.target.value })} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm">Adultos
                <input type="number" min="1" className="input-field mt-1" value={search.adultos} onChange={(e) => setSearch({ ...search, adultos: e.target.value })} />
              </label>
              <label className="text-sm">Niños
                <input type="number" min="0" className="input-field mt-1" value={search.ninos} onChange={(e) => setSearch({ ...search, ninos: e.target.value })} />
              </label>
            </div>
            <button type="button" className="btn-primary w-full" disabled={busy} onClick={look}>Buscar</button>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            {searched && types.length === 0 && !error ? (
              <p className="text-sm text-[var(--ui-muted)]">No hay habitaciones libres en esas fechas. Pruebe otra entrada o menos personas.</p>
            ) : null}
            {types.map((type) => (
              <button
                key={type.id}
                type="button"
                onClick={() => { setPicked(type); setStep(2); }}
                className="w-full rounded-2xl border border-[color:var(--ui-border)] p-3 text-left"
              >
                <p className="font-semibold">{type.nombre}</p>
                <p className="text-sm text-[var(--ui-muted)]">{type.descripcion}</p>
                <p className="mt-1 text-sm">{type.noches} noche(s) · {type.cantidad_libre} libre(s)</p>
                <p className="text-lg font-bold text-[var(--ui-accent)]">{formatCurrency(type.precio_total)}</p>
                {type.amenidades?.length ? <p className="text-xs text-[var(--ui-muted)]">{type.amenidades.join(' · ')}</p> : null}
              </button>
            ))}
          </section>
        ) : null}

        {step === 2 && picked ? (
          <section className="card space-y-3">
            <p className="font-semibold">{picked.nombre} · {formatCurrency(picked.precio_total)}</p>
            <label className="block text-sm">Nombre
              <input className="input-field mt-1" value={guest.guest_name} onChange={(e) => setGuest({ ...guest, guest_name: e.target.value })} />
            </label>
            <label className="block text-sm">Documento
              <input className="input-field mt-1" value={guest.guest_doc_number} onChange={(e) => setGuest({ ...guest, guest_doc_number: e.target.value })} />
            </label>
            <label className="block text-sm">WhatsApp
              <input className="input-field mt-1" value={guest.guest_phone} onChange={(e) => setGuest({ ...guest, guest_phone: e.target.value })} />
            </label>
            <label className="block text-sm">Correo
              <input className="input-field mt-1" value={guest.guest_email} onChange={(e) => setGuest({ ...guest, guest_email: e.target.value })} />
            </label>
            <label className="block text-sm">Hora de llegada
              <input className="input-field mt-1" placeholder="15:00" value={guest.arrival_time} onChange={(e) => setGuest({ ...guest, arrival_time: e.target.value })} />
            </label>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <button type="button" className="btn-primary w-full" disabled={busy} onClick={reserve}>Apartar 15 minutos</button>
            <button type="button" className="btn-secondary w-full" onClick={() => setStep(1)}>Volver</button>
          </section>
        ) : null}

        {step === 3 && result ? (
          <section className="card space-y-3">
            <p className="text-sm text-[var(--ui-muted)]">Código de reserva</p>
            <p className="text-3xl font-bold tracking-wide">{result.codigo_reserva}</p>
            <p>{result.huesped}</p>
            <p className="text-sm">{result.fecha_checkin} → {result.fecha_checkout}</p>
            <p className="text-lg font-semibold text-[var(--ui-accent)]">{formatCurrency(result.total_hospedaje)}</p>
            <p className="text-sm text-[var(--ui-muted)]">Estado: {result.estado === 'pendiente_pago' ? 'Pendiente de pago' : result.estado}</p>
            {result.whatsapp_url ? (
              <a className="btn-primary block text-center" href={result.whatsapp_url} target="_blank" rel="noreferrer">Enviar comprobante por WhatsApp</a>
            ) : (
              <p className="text-sm text-[var(--ui-muted)]">El hotel aún no tiene WhatsApp configurado. Guarde el código y envíe el pago por el medio que le indiquen.</p>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}
