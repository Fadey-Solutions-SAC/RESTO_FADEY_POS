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
import { MdAdd, MdClose, MdDelete, MdLock, MdReceipt, MdRemove, MdRestaurantMenu } from 'react-icons/md';
import { filterOrderingProducts } from '../../utils/orderingCatalog';

function storageKeyForCliente(id) {
  return `selfOrderCliente:${id}`;
}

export default function SelfOrderCliente() {
  const [searchParams] = useSearchParams();
  const clienteId = String(searchParams.get('cliente') || '').trim();

  const [sessionToken, setSessionToken] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [verifying, setVerifying] = useState(false);
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

  useEffect(() => {
    if (!clienteId) return;
    try {
      const saved = sessionStorage.getItem(storageKeyForCliente(clienteId));
      if (saved) setSessionToken(saved);
    } catch {
      /* private mode */
    }
  }, [clienteId]);

  const loadBootstrap = useCallback(() => {
    if (!clienteId || !sessionToken) return;
    api
      .get(
        `/public/self-order/bootstrap?cliente=${encodeURIComponent(clienteId)}&token=${encodeURIComponent(sessionToken)}`
      )
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
        if (String(err.message || '').includes('Sesión') || String(err.message || '').includes('401')) {
          try {
            sessionStorage.removeItem(storageKeyForCliente(clienteId));
          } catch {
            /* */
          }
          setSessionToken('');
        }
      });
  }, [clienteId, sessionToken]);

  const loadOrders = useCallback(() => {
    if (!clienteId || !sessionToken || bootError) return;
    api
      .get(
        `/public/self-order/client-orders?cliente=${encodeURIComponent(clienteId)}&token=${encodeURIComponent(sessionToken)}`
      )
      .then(setOrders)
      .catch(() => {});
  }, [clienteId, sessionToken, bootError]);

  useEffect(() => {
    if (!clienteId || !sessionToken) return;
    loadBootstrap();
  }, [clienteId, sessionToken, loadBootstrap]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders, bootstrap?.table?.id]);

  useActiveInterval(loadOrders, 8000);

  const STAFF_CATALOG_DOMAINS = useMemo(
    () => new Set(['modifiers', 'auto_pedido_cartas', 'discounts', 'offers', 'combos', 'catalog']),
    []
  );

  useSocket('staff-data-update', (p) => {
    if (!clienteId || !sessionToken || !STAFF_CATALOG_DOMAINS.has(p?.domain)) return;
    void loadBootstrap();
  });
  useSocket('inventory-update', () => {
    if (!clienteId || !sessionToken) return;
    void loadBootstrap();
  });
  useSocket('order-update', () => {
    if (!clienteId || !sessionToken) return;
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
    if (!table || !sessionToken) return toast.error('Sesión no válida');
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
        cliente: clienteId,
        token: sessionToken,
        items: cart.map((i) => ({
          product_id: i.product_id,
          quantity: i.quantity,
          modifier_id: i.modifier_id || '',
          modifier_option: i.modifier_option || '',
          notes: String(i.notes || '').trim(),
        })),
        payment_method: 'efectivo',
        customer_name: table.name,
      });
      toast.success('Pedido enviado. Aparecerá en cocina / bar y quedará en tu cuenta para cobrar.', { id: tid });
      closeOrderPanel();
      loadOrders();
    } catch (err) {
      toast.error(err.message || 'No se pudo enviar el pedido', { id: tid });
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    if (!clienteId) return;
    setVerifying(true);
    try {
      const data = await api.post('/public/self-order/client-verify', {
        customer_id: clienteId,
        password: passwordInput,
      });
      const tok = String(data?.token || '').trim();
      if (!tok) throw new Error('Respuesta inválida');
      try {
        sessionStorage.setItem(storageKeyForCliente(clienteId), tok);
      } catch {
        /* */
      }
      setSessionToken(tok);
      setPasswordInput('');
      toast.success('Identificación correcta');
    } catch (err) {
      toast.error(err.message || 'No se pudo verificar');
    } finally {
      setVerifying(false);
    }
  };

  const handleLogoutCliente = () => {
    try {
      sessionStorage.removeItem(storageKeyForCliente(clienteId));
    } catch {
      /* */
    }
    setSessionToken('');
    setBootstrap(null);
    setBootError('');
    setOrders([]);
    closeOrderPanel();
  };

  if (!clienteId) {
    return (
      <div className="flex min-h-screen min-h-[100dvh] items-center justify-center bg-[var(--ui-body-bg)] p-6 text-center">
        <div className="max-w-md rounded-2xl border border-[color:var(--ui-border)] bg-[var(--ui-surface)] p-8 text-[var(--ui-body-text)] shadow-xl">
          <MdRestaurantMenu className="mx-auto mb-4 text-5xl text-[var(--ui-accent)]" />
          <h1 className="mb-2 text-xl font-bold">Auto pedido (cliente)</h1>
          <p className="text-sm text-[var(--ui-muted)]">
            Falta el identificador en el enlace. Usa el QR o el enlace que te dio el restaurante desde Clientes.
          </p>
        </div>
      </div>
    );
  }

  if (!sessionToken) {
    return (
      <div className="flex min-h-screen min-h-[100dvh] flex-col bg-[var(--ui-body-bg)] p-6 text-[var(--ui-body-text)]">
        <div className="mx-auto mt-[10vh] w-full max-w-sm rounded-2xl border border-[color:var(--ui-border)] bg-[var(--ui-surface)] p-6 shadow-xl">
          <MdLock className="mx-auto mb-3 text-4xl text-[var(--ui-accent)]" />
          <h1 className="mb-1 text-center text-lg font-bold">Identificación</h1>
          <p className="mb-4 text-center text-xs text-[var(--ui-muted)]">
            Introduce la contraseña de cliente que te asignó el restaurante (en Clientes / al registrarte).
          </p>
          <form onSubmit={handleVerify} className="space-y-3">
            <input
              type="password"
              autoComplete="current-password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              placeholder="Contraseña"
              className="input-field px-3 py-2.5"
              required
            />
            <button
              type="submit"
              disabled={verifying}
              className="w-full rounded-lg bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] py-2.5 text-sm font-semibold text-white shadow-lg disabled:opacity-50"
            >
              {verifying ? 'Comprobando…' : 'Continuar'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (bootError || !bootstrap) {
    return (
      <div className="flex min-h-screen min-h-[100dvh] items-center justify-center bg-[var(--ui-body-bg)] p-6 text-center">
        <div className="max-w-md rounded-2xl border border-red-500/40 bg-[var(--ui-surface)] p-8 text-[var(--ui-body-text)]">
          <h1 className="mb-2 text-lg font-bold">No disponible</h1>
          <p className="text-sm text-red-200/90">{bootError || 'Cargando…'}</p>
          {bootError ? (
            <button
              type="button"
              onClick={handleLogoutCliente}
              className="mt-4 text-sm text-[var(--ui-accent)] underline"
            >
              Volver a identificarme
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-0 flex flex-col overflow-hidden bg-[var(--ui-body-bg)] text-[var(--ui-body-text)]">
      <header className="z-20 flex shrink-0 items-center justify-between gap-3 border-b border-[color:var(--ui-border)] bg-[var(--ui-surface)]/95 px-4 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold text-[var(--ui-body-text)]">Auto pedido (QR)</h1>
          <p className="text-xs text-[var(--ui-accent)] truncate">{table?.name || 'Cliente'}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleLogoutCliente}
            className="rounded-lg px-2 py-1.5 text-xs font-medium text-[var(--ui-accent)] hover:bg-[var(--ui-sidebar-hover)]"
          >
            Salir
          </button>
          <button
            type="button"
            onClick={() => setShowCartaModal(true)}
            className="rounded-xl border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] px-3 py-2.5 text-sm font-semibold text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]"
          >
            Ver carta
          </button>
          <button
            type="button"
            onClick={openOrderPanel}
            className="shrink-0 rounded-xl bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[#1D4ED8]/30"
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
          <div className="fixed inset-0 z-40 bg-black/40" onClick={closeOrderPanel} />
          <aside className="fixed right-0 top-0 z-50 flex h-[100dvh] max-h-[100dvh] w-full flex-col border-l border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-body-text)] shadow-2xl md:w-[520px]">
            <div className="flex items-center justify-between border-b border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] px-5 py-4 backdrop-blur-xl">
              <div>
                <h3 className="text-lg font-bold text-[var(--ui-body-text)]">Tu pedido</h3>
              </div>
              <button
                type="button"
                onClick={closeOrderPanel}
                className="rounded-lg p-2 text-[var(--ui-accent)] hover:bg-[var(--ui-sidebar-hover)]"
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
