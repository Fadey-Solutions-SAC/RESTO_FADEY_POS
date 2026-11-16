import { useEffect, useMemo, useState } from 'react';
import { MdShoppingCart } from 'react-icons/md';
import toast from 'react-hot-toast';
import Modal from '../Modal';
import { api, formatCurrency } from '../../utils/api';
import { orderingStockCellIsOut, orderingStockCellText, showStockInOrderingUI } from '../../utils/productStockDisplay';

function money(n) {
  return formatCurrency(Number(n) || 0);
}

/** En Caja y Mesas la habitación solo muestra la cuenta y permite cargar productos. */
export default function HotelRoomAccountModal({ roomId, onClose }) {
  const [room, setRoom] = useState(null);
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!roomId) {
      setRoom(null);
      setSearch('');
      return undefined;
    }
    let alive = true;
    api.get(`/hotel/rooms/${roomId}`)
      .then((fresh) => {
        if (!alive) return;
        setRoom(fresh);
        const caja = String(fresh?.caja_station_id || '').trim();
        const stockQs = caja ? `&caja_station_id=${encodeURIComponent(caja)}` : '';
        return api.get(`/products?active_only=true&available_now=true${stockQs}`);
      })
      .then((list) => {
        if (!alive || !Array.isArray(list)) return;
        setProducts(list);
      })
      .catch((err) => {
        if (alive) toast.error(err.message || 'No se pudo abrir la habitación');
      });
    return () => { alive = false; };
  }, [roomId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => !q || String(p.name || '').toLowerCase().includes(q)).slice(0, 40);
  }, [products, search]);

  const occupied = room?.status === 'occupied';

  const addProduct = async (product) => {
    if (!room || !occupied) return;
    setBusy(true);
    try {
      await api.post(`/hotel/rooms/${room.id}/items`, {
        items: [{ product_id: product.id, quantity: 1 }],
      });
      const fresh = await api.get(`/hotel/rooms/${room.id}`);
      setRoom(fresh);
      toast.success(`${product.name} cargado a la cuenta`);
    } catch (err) {
      toast.error(err.message || 'No se pudo cargar el producto');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={Boolean(roomId)}
      onClose={onClose}
      title={`Habitación ${room?.number || ''}`}
      size="lg"
    >
      {room ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2 text-sm">
            <p className="font-semibold">{occupied ? (room.guest_name || 'Huésped') : 'Sin ingreso'}</p>
            {!occupied ? (
              <p className="text-[var(--ui-muted)]">
                El ingreso, la salida y el mantenimiento se hacen en Hotel. Aquí solo se ven y se cargan productos cuando la habitación está ocupada.
              </p>
            ) : (
              <ul className="space-y-1">
                {(room.account?.items || []).map((it) => (
                  <li key={it.id} className="flex justify-between gap-2 border-b border-[color:var(--ui-border)] py-1">
                    <span>{it.quantity} × {it.product_name}</span>
                    <span>{money(it.subtotal)}</span>
                  </li>
                ))}
              </ul>
            )}
            {occupied ? <p className="font-bold text-[var(--ui-accent)]">Total {money(room.account_total)}</p> : null}
          </div>
          <div>
            <p className="text-sm font-semibold mb-2 flex items-center gap-1"><MdShoppingCart /> Cargar producto</p>
            {occupied ? (
              <>
                <input className="input-field mb-2" placeholder="Buscar" value={search} onChange={(e) => setSearch(e.target.value)} />
                <div className="max-h-72 overflow-auto space-y-1">
                  {filtered.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      disabled={busy}
                      className="w-full text-left rounded-lg border border-[color:var(--ui-border)] px-3 py-2 text-sm hover:bg-[var(--ui-sidebar-hover)]"
                      onClick={() => addProduct(p)}
                    >
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
              </>
            ) : (
              <p className="text-sm text-[var(--ui-muted)]">No hay cuenta abierta.</p>
            )}
          </div>
        </div>
      ) : (
        <div className="py-8 flex justify-center"><div className="rf-loader rf-loader--md" /></div>
      )}
    </Modal>
  );
}
