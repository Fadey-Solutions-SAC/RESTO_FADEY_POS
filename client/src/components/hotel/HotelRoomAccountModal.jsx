import { useEffect, useMemo, useState } from 'react';
import { MdReceipt } from 'react-icons/md';
import toast from 'react-hot-toast';
import Modal from '../Modal';
import StaffDineInOrderUI, { StaffDineInOrderCartPanel, VIEWPORT_CART_MAX_CLASS } from '../StaffDineInOrderUI';
import StaffMesaPedidoTabs from '../StaffMesaPedidoTabs';
import StaffModifierPromptModal from '../StaffModifierPromptModal';
import { staffOrderModalProps } from '../staffOrderModalLayout';
import { useStaffOrderCart } from '../../hooks/useStaffOrderCart';
import { api, formatCurrency } from '../../utils/api';
import { buildOrderItemsPayload, filterOrderingProducts, mergeOrderingCatalog } from '../../utils/orderingCatalog';

/** En Caja y Mesas la habitación abre el mismo pedido que una mesa. */
export default function HotelRoomAccountModal({ roomId, onClose }) {
  const [room, setRoom] = useState(null);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [modifiers, setModifiers] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedCat, setSelectedCat] = useState('all');
  const [observation, setObservation] = useState('');
  const [busy, setBusy] = useState(false);
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

  useEffect(() => {
    if (!roomId) {
      setRoom(null);
      setSearch('');
      setSelectedCat('all');
      setObservation('');
      resetCart();
      return undefined;
    }
    let alive = true;
    api.get(`/hotel/rooms/${roomId}`)
      .then((fresh) => {
        if (!alive) return null;
        setRoom(fresh);
        const caja = String(fresh?.caja_station_id || '').trim();
        const stockQs = caja ? `&caja_station_id=${encodeURIComponent(caja)}` : '';
        return Promise.all([
          api.get(`/products?active_only=true&available_now=true${stockQs}`).catch(() => []),
          api.get('/categories/active').catch(() => []),
          api.get('/admin-modules/modifiers').catch(() => []),
          api.get('/admin-modules/combos').catch(() => []),
        ]);
      })
      .then((pack) => {
        if (!alive || !pack) return;
        const [prods, cats, mods, combosData] = pack;
        const merged = mergeOrderingCatalog(
          Array.isArray(prods) ? prods : [],
          Array.isArray(cats) ? cats : [],
          combosData || [],
        );
        setProducts(merged.products);
        setCategories(merged.categories);
        setModifiers(Array.isArray(mods) ? mods : []);
      })
      .catch((err) => {
        if (alive) toast.error(err.message || 'No se pudo abrir la habitación');
      });
    return () => { alive = false; };
  }, [roomId, resetCart]);

  const filteredProducts = useMemo(
    () => filterOrderingProducts(products, { search, selectedCat }),
    [products, search, selectedCat],
  );

  const occupied = room?.status === 'occupied';
  const accountOrders = occupied && room?.account
    ? [room.account]
    : [];

  const submit = async () => {
    if (!room || !occupied) return toast.error('El ingreso se registra en Hotel');
    if (!cart.length) return toast.error('Agrega productos al pedido');
    const missing = cart.find((i) => Number(i.note_required || 0) === 1 && !String(i.notes || '').trim());
    if (missing) {
      setNoteEditorLineKey(missing.line_key);
      return toast.error(`"${missing.name}" requiere nota obligatoria`);
    }
    const note = String(observation || '').trim();
    const items = buildOrderItemsPayload(cart).map((item) => (
      note && !item.notes ? { ...item, notes: note } : item
    ));
    setBusy(true);
    try {
      const fresh = await api.post(`/hotel/rooms/${room.id}/items`, { items });
      setRoom(fresh);
      resetCart();
      setObservation('');
      toast.success(`Pedido cargado a la habitación ${room.number}`);
    } catch (err) {
      toast.error(err.message || 'No se pudo cargar el pedido');
    } finally {
      setBusy(false);
    }
  };

  const footer = cart.length > 0 ? (
    <div className="space-y-2">
      <div className="flex justify-between text-base font-bold text-white">
        <span>Total</span>
        <span className="text-[#BFDBFE]">{formatCurrency(cartTotal)}</span>
      </div>
      <button
        type="button"
        onClick={submit}
        disabled={busy || !occupied}
        className="btn-primary flex w-full items-center justify-center gap-2 py-2.5 text-sm font-semibold"
      >
        <MdReceipt className="shrink-0" /> Cargar a la habitación
      </button>
    </div>
  ) : null;

  return (
    <>
      <Modal
        {...staffOrderModalProps({
          isOpen: Boolean(roomId),
          onClose,
          title: `Agregar Pedido — Habitación ${room?.number || ''}`,
        })}
      >
        {room ? (
          <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex min-h-0 flex-1 gap-2 overflow-hidden lg:flex-row lg:items-stretch">
              <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:max-w-[min(100%,28rem)]">
                <StaffMesaPedidoTabs
                  orders={accountOrders}
                  formatCurrency={formatCurrency}
                  resetKey={room.id}
                  className="h-full min-h-0 flex-1 overflow-hidden"
                  labels={{
                    add: 'Agregar pedido',
                    view: 'Ver pedido',
                    listTitle: 'Productos en la habitación',
                    empty: 'No hay pedidos en esta habitación.',
                    totalMesa: 'Total habitación',
                  }}
                >
                  <StaffDineInOrderUI
                    externalCartAside
                    fillParentHeight
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
                    className="h-full min-h-0 flex-1"
                    orderObservation={observation}
                    onOrderObservationChange={setObservation}
                    footer={footer}
                  />
                </StaffMesaPedidoTabs>
              </div>
              <StaffDineInOrderCartPanel
                elevatedAside
                fillParentHeight
                className={`hidden h-full min-h-0 shrink-0 overflow-hidden lg:flex lg:flex-col ${VIEWPORT_CART_MAX_CLASS}`}
                cart={cart}
                cartLayout="lines"
                formatCurrency={formatCurrency}
                noteEditorLineKey={noteEditorLineKey}
                setNoteEditorLineKey={setNoteEditorLineKey}
                updateQty={updateQty}
                removeFromCart={removeFromCart}
                updateItemNote={updateItemNote}
                orderObservation={observation}
                onOrderObservationChange={setObservation}
                footer={footer}
              />
            </div>
          </div>
        ) : (
          <div className="py-8 flex justify-center"><div className="rf-loader rf-loader--md" /></div>
        )}
      </Modal>
      <StaffModifierPromptModal
        open={modifierPrompt.open}
        onClose={() => setModifierPrompt({ open: false, product: null, modifier: null, selectedOption: '' })}
        modifierPrompt={modifierPrompt}
        setModifierPrompt={setModifierPrompt}
        onConfirm={confirmModifierForCart}
        onSkipOptional={addProductWithoutOptionalModifier}
      />
    </>
  );
}
