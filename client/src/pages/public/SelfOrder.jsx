import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, formatCurrency } from '../../utils/api';
import { useActiveInterval } from '../../hooks/useActiveInterval';
import { useSocket } from '../../hooks/useSocket';
import { useStaffOrderCart } from '../../hooks/useStaffOrderCart';
import StaffDineInOrderUI from '../../components/StaffDineInOrderUI';
import StaffModifierPromptModal from '../../components/StaffModifierPromptModal';
import CartasHorizontalCarousel from '../../components/CartasHorizontalCarousel';
import Modal from '../../components/Modal';
import toast from 'react-hot-toast';
import { MdAdd, MdClose, MdDelete, MdReceipt, MdRemove, MdRestaurantMenu } from 'react-icons/md';
import { filterOrderingProducts } from '../../utils/orderingCatalog';

export default function SelfOrder() {
  const [searchParams] = useSearchParams();
  const mesaParam = String(searchParams.get('mesa') || '').trim();

  const [bootstrap, setBootstrap] = useState(null);
  const [bootError, setBootError] = useState('');
  const [orders, setOrders] = useState([]);
  const [showOrderPanel, setShowOrderPanel] = useState(false);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [modifiers, setModifiers] = useState([]);
  const [cartas, setCartas] = useState([]);
  const [showCartaModal, setShowCartaModal] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedCat, setSelectedCat] = useState('all');

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

  const loadBootstrap = useCallback(() => {
    if (!mesaParam) return;
    api
      .get(`/public/self-order/bootstrap?mesa=${encodeURIComponent(mesaParam)}`)
      .then((data) => {
        setBootstrap(data);
        setProducts(data.products || []);
        setCategories(data.categories || []);
        setModifiers(Array.isArray(data.modifiers) ? data.modifiers : []);
        setCartas(Array.isArray(data.cartas) ? data.cartas : []);
        setBootError('');
      })
      .catch((err) => {
        setBootError(err.message || 'No se pudo cargar');
        setBootstrap(null);
      });
  }, [mesaParam]);

  const loadOrders = useCallback(() => {
    if (!mesaParam || bootError) return;
    api
      .get(`/public/self-order/orders?mesa=${encodeURIComponent(mesaParam)}`)
      .then(setOrders)
      .catch(() => {});
  }, [mesaParam, bootError]);

  useEffect(() => {
    if (!mesaParam) return;
    loadBootstrap();
  }, [mesaParam, loadBootstrap]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders, bootstrap?.table?.id]);

  useActiveInterval(loadOrders, 8000);

  const STAFF_CATALOG_DOMAINS = useMemo(
    () => new Set(['modifiers', 'auto_pedido_cartas', 'discounts', 'offers', 'combos', 'catalog']),
    []
  );

  useSocket('staff-data-update', (p) => {
    if (!mesaParam || !STAFF_CATALOG_DOMAINS.has(p?.domain)) return;
    void loadBootstrap();
  });
  useSocket('inventory-update', () => {
    if (!mesaParam) return;
    void loadBootstrap();
  });
  useSocket('order-update', () => {
    if (!mesaParam) return;
    void loadOrders();
  });

  const filteredProducts = useMemo(
    () => filterOrderingProducts(products, { search, selectedCat }),
    [products, selectedCat, search],
  );

  const table = bootstrap?.table;

  const openOrderPanel = () => {
    setShowOrderPanel(true);
  };

  const closeOrderPanel = () => {
    setShowOrderPanel(false);
  };

  const submitOrder = async () => {
    if (!table) return toast.error('Mesa no disponible');
    if (cart.length === 0) return toast.error('Agrega productos al pedido');
    const missingRequiredNote = cart.find(
      (i) => Number(i.note_required || 0) === 1 && !String(i.notes || '').trim()
    );
    if (missingRequiredNote) {
      setNoteEditorLineKey(missingRequiredNote.line_key);
      return toast.error(`"${missingRequiredNote.name}" requiere nota obligatoria`);
    }
    const tid = toast.loading('Enviando pedido…');
    try {
      await api.post('/public/self-order/orders', {
        mesa: String(table.number),
        table_id: String(table.id || ''),
        items: cart.map((i) => ({
          product_id: i.product_id,
          quantity: i.quantity,
          modifier_id: i.modifier_id || '',
          modifier_option: i.modifier_option || '',
          notes: String(i.notes || '').trim(),
        })),
        payment_method: 'efectivo',
        customer_name: `Mesa ${table.number}`,
      });
      toast.success(`Pedido enviado — mesa ${table.number}`, { id: tid });
      resetCart();
      closeOrderPanel();
      loadOrders();
    } catch (err) {
      toast.error(err.message || 'No se pudo enviar el pedido', { id: tid });
    }
  };

  if (!mesaParam) {
    return (
      <div className="min-h-screen bg-[var(--ui-body-bg)] flex items-center justify-center p-6 text-center">
        <div className="max-w-md rounded-2xl border border-[color:var(--ui-border)] bg-[var(--ui-surface)] p-8 text-[var(--ui-body-text)] shadow-xl">
          <MdRestaurantMenu className="text-5xl mx-auto mb-4 text-[var(--ui-accent)]" />
          <h1 className="text-xl font-bold mb-2">Auto pedido</h1>
          <p className="text-[var(--ui-muted)] text-sm">
            Escanea el código QR de tu mesa para ver la carta y hacer tu pedido. Si llegaste aquí sin QR, pide al personal el enlace con el número de mesa.
          </p>
        </div>
      </div>
    );
  }

  if (bootError || !bootstrap) {
    return (
      <div className="min-h-screen bg-[var(--ui-body-bg)] flex items-center justify-center p-6 text-center">
        <div className="max-w-md rounded-2xl border border-red-500/40 bg-[var(--ui-surface)] p-8 text-[var(--ui-body-text)]">
          <h1 className="text-lg font-bold mb-2">No disponible</h1>
          <p className="text-red-200/90 text-sm">{bootError || 'Cargando…'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-0 flex flex-col overflow-hidden bg-[var(--ui-body-bg)] text-[var(--ui-body-text)]">
      <header className="z-20 flex shrink-0 items-center justify-between gap-3 border-b border-[color:var(--ui-border)] bg-[var(--ui-surface)]/95 px-4 py-3">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-[var(--ui-body-text)] truncate">Auto pedido</h1>
          <p className="text-xs text-[var(--ui-accent)] truncate">{table?.name || `Mesa ${table?.number}`}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setShowCartaModal(true)}
            className="px-3 py-2.5 rounded-xl border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] text-sm font-semibold hover:bg-[var(--ui-sidebar-hover)]"
          >
            Ver carta
          </button>
          <button
            type="button"
            onClick={openOrderPanel}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] text-white text-sm font-semibold shadow-lg shadow-[#1D4ED8]/30"
          >
            Hacer pedido ({cart.length})
          </button>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--ui-surface-2)]">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-3">
          <StaffDineInOrderUI
            stackedSelfOrder
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
            minHeightClass="min-h-0 flex-1"
            className="min-h-0 min-w-0 flex-1"
            productActionLabel="Agregar pedido"
            singleColumnProductList
            showProductThumbnail
            hideProductStock
          />
        </div>
      </main>

      <Modal
        isOpen={showCartaModal}
        onClose={() => setShowCartaModal(false)}
        title="Carta"
        size="full"
        maxHeightClass="max-h-[min(92dvh,calc(100dvh-1rem))]"
        bodyClassName="flex flex-col min-h-0 overflow-hidden !p-3 sm:!p-4"
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden" style={{ minHeight: 'min(70dvh, 520px)' }}>
          <CartasHorizontalCarousel cartas={cartas} showSwipeHint={false} className="min-h-0 flex-1" />
        </div>
      </Modal>

      {showOrderPanel && table && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={closeOrderPanel} />
          <aside className="fixed top-0 right-0 flex h-[100dvh] max-h-[100dvh] w-full flex-col border-l border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-body-text)] shadow-2xl md:w-[520px] z-50">
            <div className="px-5 py-4 border-b border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] backdrop-blur-xl flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-[var(--ui-body-text)]">Tu pedido</h3>
              </div>
              <button
                type="button"
                onClick={closeOrderPanel}
                className="p-2 rounded-lg hover:bg-[var(--ui-sidebar-hover)] text-[var(--ui-accent)]"
                aria-label="Cerrar"
              >
                <MdClose className="text-xl" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
              <div className="min-h-0 flex-1 overflow-y-auto space-y-2 pr-1">
                {cart.length === 0 ? (
                  <p className="text-sm text-[var(--ui-muted)]">No hay productos en tu lista.</p>
                ) : (
                  cart.map((item) => (
                    <div key={item.line_key} className="rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-[var(--ui-body-text)]">{item.name}</p>
                          {item.modifier_name && item.modifier_option ? (
                            <p className="mt-0.5 truncate text-[11px] text-[var(--ui-muted)]">
                              {item.modifier_name}: {item.modifier_option}
                            </p>
                          ) : null}
                          <p className="mt-0.5 text-xs text-[var(--ui-accent)]">{formatCurrency(item.price)} c/u</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeFromCart(item.line_key)}
                          className="shrink-0 rounded-lg p-1.5 text-[var(--ui-accent)] hover:bg-[var(--ui-sidebar-hover)]"
                          aria-label="Quitar del pedido"
                        >
                          <MdDelete className="text-xl" />
                        </button>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => updateQty(item.line_key, -1)}
                            className="flex h-9 w-9 items-center justify-center rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]"
                            aria-label="Menos"
                          >
                            <MdRemove className="text-lg" />
                          </button>
                          <span className="min-w-[2rem] text-center text-sm font-bold tabular-nums text-[var(--ui-body-text)]">{item.quantity}</span>
                          <button
                            type="button"
                            onClick={() => updateQty(item.line_key, 1)}
                            className="flex h-9 w-9 items-center justify-center rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]"
                            aria-label="Más"
                          >
                            <MdAdd className="text-lg" />
                          </button>
                        </div>
                        <p className="text-sm font-semibold tabular-nums text-[var(--ui-body-text)]">
                          {formatCurrency(Number(item.price || 0) * Number(item.quantity || 0))}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="mt-3 border-t border-[color:var(--ui-border)] pt-3 space-y-2">
                <div className="flex justify-between text-lg font-bold text-[var(--ui-body-text)]">
                  <span>Total</span>
                  <span className="text-[var(--ui-accent)]">{formatCurrency(cartTotal)}</span>
                </div>
                <button
                  type="button"
                  onClick={submitOrder}
                  disabled={cart.length === 0}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] py-3 text-base font-semibold text-white shadow-lg shadow-[#1D4ED8]/30 transition-all hover:from-[#1D4ED8] hover:to-[#1E40AF] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <MdReceipt /> Enviar
                </button>
              </div>
            </div>
          </aside>
        </>
      )}

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
