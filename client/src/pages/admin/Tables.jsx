import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { api, formatCurrency } from '../../utils/api';
import { mergeOrderingCatalog, buildOrderItemsPayload, filterOrderingProducts } from '../../utils/orderingCatalog';
import { useSocket } from '../../hooks/useSocket';
import { useActiveInterval } from '../../hooks/useActiveInterval';
import { useAuth } from '../../context/AuthContext';
import { useStaffOrderCart } from '../../hooks/useStaffOrderCart';
import Modal from '../../components/Modal';
import MesaTransferModal from '../../components/MesaTransferModal';
import StaffDineInOrderUI, { StaffDineInOrderCartPanel } from '../../components/StaffDineInOrderUI';
import StaffMesaPedidoTabs from '../../components/StaffMesaPedidoTabs';
import StaffModifierPromptModal from '../../components/StaffModifierPromptModal';
import toast from 'react-hot-toast';
import { MdTableRestaurant, MdReceipt, MdClose, MdOpenWith, MdSwapHoriz } from 'react-icons/md';
import { KITCHEN_TAKEOUT_NOTE } from '../../utils/ticketPlainText';
import { buildDineInOrderPayload } from '../../utils/mesaOrderLines';
import { buildTablesBySalon } from '../../utils/salonesUtils';
import { useMesaOrderLock } from '../../hooks/useMesaOrderLock';
import { printKitchenBarOnComandaSend } from '../../utils/kitchenBarAutoPrint';

export default function Tables() {
  const { user } = useAuth();
  const [tables, setTables] = useState([]);
  const [salonesConfig, setSalonesConfig] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedTable, setSelectedTable] = useState(null);
  const [showMenu, setShowMenu] = useState(false);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [modifiers, setModifiers] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedCat, setSelectedCat] = useState('all');
  const [selectedSalon, setSelectedSalon] = useState('all');
  const [paraLlevarMesa, setParaLlevarMesa] = useState(false);
  const [mesaTransfer, setMesaTransfer] = useState(null);
  const showMenuRef = useRef(false);

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

  const {
    lockMesa,
    clearMesaLock,
    syncLockRenumber,
    validateMesaForSubmit,
    resolveLockedTable,
  } = useMesaOrderLock();

  const productsById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  useEffect(() => {
    if (!showMenu) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [showMenu]);

  useEffect(() => {
    if (!selectedTable?.id) return;
    const fresh = tables.find((t) => t.id === selectedTable.id);
    if (fresh) syncLockRenumber(fresh);
  }, [tables, selectedTable?.id, syncLockRenumber]);

  const loadTables = useCallback(() => {
    const role = String(user?.role || '').toLowerCase();
    const mozoCaja = String(user?.caja_station_id || '').trim();
    const qs =
      (role === 'mozo' || role === 'cajero') && mozoCaja
        ? `?caja_station_id=${encodeURIComponent(mozoCaja)}`
        : '';
    Promise.all([
      api.get(`/tables${qs}`),
      api.get(`/tables/salones${qs}`).catch(() => ({ salones: [] })),
    ])
      .then(([data, salonesRes]) => {
        let list = Array.isArray(data) ? data : [];
        let salones = Array.isArray(salonesRes?.salones) ? salonesRes.salones : [];
        if ((role === 'mozo' || role === 'cajero') && mozoCaja) {
          const PRIMARY = 'b0b0b0b0-b0b0-4000-b0b0-b0b0b0b0b001';
          const salonCaja = (s) => String(s?.caja_station_id || '').trim() || PRIMARY;
          salones = salones.filter((s) => salonCaja(s) === mozoCaja);
          const salonByZone = new Map(salones.map((s) => [String(s.id), s]));
          list = list.filter((t) => {
            const direct = String(t?.caja_station_id || '').trim();
            if (direct) return direct === mozoCaja;
            return salonCaja(salonByZone.get(String(t?.zone || 'principal'))) === mozoCaja;
          });
        } else if ((role === 'mozo' || role === 'cajero') && !mozoCaja) {
          list = [];
          salones = [];
        }
        setTables(list);
        setSalonesConfig(salones);
        setSelectedTable((prev) => (prev ? list.find((t) => t.id === prev.id) || null : null));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [user?.role, user?.caja_station_id]);

  const loadProducts = useCallback(() => {
    Promise.all([
      api.get('/products?active_only=true&available_now=true').catch(() => []),
      api.get('/categories/active').catch(() => []),
      api.get('/admin-modules/modifiers').catch(() => []),
      api.get('/admin-modules/combos').catch(() => []),
    ]).then(([prods, cats, mods, combosData]) => {
      const merged = mergeOrderingCatalog(
        Array.isArray(prods) ? prods : [],
        Array.isArray(cats) ? cats : [],
        combosData || [],
      );
      setProducts(merged.products);
      setCategories(merged.categories);
      setModifiers(Array.isArray(mods) ? mods : []);
    }).catch(console.error);
  }, []);

  useEffect(() => {
    showMenuRef.current = showMenu;
  }, [showMenu]);

  useEffect(() => {
    loadTables();
    loadProducts();
  }, [loadTables, loadProducts]);

  const pollTables = useCallback(() => {
    if (showMenuRef.current) return;
    loadTables();
  }, [loadTables]);

  useActiveInterval(pollTables, 10000);
  useSocket('order-update', loadTables);
  useSocket('table-update', loadTables);
  useEffect(() => {
    const onSynced = () => loadTables();
    window.addEventListener('rf-offline-synced', onSynced);
    return () => window.removeEventListener('rf-offline-synced', onSynced);
  }, [loadTables]);
  useSocket('salones-update', loadTables);
  useSocket('inventory-update', loadProducts);
  useSocket('staff-data-update', (p) => {
    if (['catalog', 'modifiers', 'combos'].includes(p?.domain)) loadProducts();
  });

  const openMenuForTable = (table) => {
    setSelectedTable(table);
    lockMesa(table);
    setShowMenu(true);
    setParaLlevarMesa(false);
    resetCart();
    setSearch('');
    setSelectedCat('all');
  };

  const closeMenuPanel = () => {
    setShowMenu(false);
    setParaLlevarMesa(false);
    resetCart();
    setSearch('');
    setSelectedCat('all');
    clearMesaLock();
  };

  const submitOrder = async () => {
    if (!selectedTable) return toast.error('Selecciona una mesa');
    const mesaErr = validateMesaForSubmit(tables, selectedTable);
    if (mesaErr) return toast.error(mesaErr);
    if (cart.length === 0) return toast.error('Agrega productos al pedido');
    const missingRequiredNote = cart.find(i => Number(i.note_required || 0) === 1 && !String(i.notes || '').trim());
    if (missingRequiredNote) {
      setNoteEditorLineKey(missingRequiredNote.line_key);
      return toast.error(`"${missingRequiredNote.name}" requiere nota obligatoria`);
    }
    const tableForOrder = resolveLockedTable(tables, selectedTable);
    const tid = toast.loading('Enviando pedido…');
    try {
      const created = await api.post('/orders', buildDineInOrderPayload({
        table: tableForOrder,
        cartItems: buildOrderItemsPayload(cart),
        extra: {
          notes: paraLlevarMesa ? KITCHEN_TAKEOUT_NOTE : '',
        },
      }));
      void printKitchenBarOnComandaSend(created, {
        merged: Boolean(created.merged_into_existing),
      });
      toast.success(`Pedido enviado a Mesa ${tableForOrder?.number ?? selectedTable.number}`, { id: tid });
      closeMenuPanel();
      loadTables();
    } catch (err) {
      toast.error(err.message || 'No se pudo enviar el pedido', { id: tid });
    }
  };

  const tablesBySalon = useMemo(
    () => buildTablesBySalon(salonesConfig, tables),
    [salonesConfig, tables]
  );

  const salonOptions = useMemo(() => {
    const zones = tablesBySalon.map((s) => s.zone);
    return ['all', ...zones];
  }, [tablesBySalon]);

  const salonLabel = (id) => {
    if (id === 'all') return 'Todos';
    const found = tablesBySalon.find((s) => s.zone === id);
    return found?.label ?? id;
  };

  const tablesToShow = selectedSalon === 'all'
    ? tables
    : tables.filter(t => String(t.zone || 'principal') === selectedSalon);

  const filteredProducts = filterOrderingProducts(products, { search, selectedCat });
  const activeOrdersForTable = selectedTable?.orders || [];

  const openMesaTransfer = (mode) => {
    setMesaTransfer({ mode });
  };

  const mesaToolbarMoveTableClass =
    'inline-flex items-center gap-1.5 rounded-lg border border-sky-700 bg-sky-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400';
  const mesaToolbarMoveOrdersClass =
    'inline-flex items-center gap-1.5 rounded-lg border border-amber-700 bg-amber-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400';

  if (loading) return <div className="flex h-64 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--ui-accent)] border-t-transparent" /></div>;

  const isMozo = String(user?.role || '').toLowerCase() === 'mozo';
  const mozoSinCaja = isMozo && !String(user?.caja_station_id || '').trim();

  return (
    <div>
      {mozoSinCaja && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Su usuario mozo no tiene caja asignada. Pida al administrador que lo vincule en Configuración → Usuarios.
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {salonOptions.map(salonId => (
          <button
            key={salonId}
            onClick={() => setSelectedSalon(salonId)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors ${
              selectedSalon === salonId
                ? 'border-[color:var(--ui-border)] bg-[var(--ui-accent)] text-white shadow-sm'
                : 'border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]'
            }`}
          >
            {salonLabel(salonId)}
          </button>
        ))}
        <div className="mt-1 flex w-full flex-wrap items-center gap-2 border-t border-[color:var(--ui-border)] pt-2 sm:ml-auto sm:mt-0 sm:w-auto sm:border-t-0 sm:pt-0">
          <button
            type="button"
            onClick={() => openMesaTransfer('move_table')}
            className={mesaToolbarMoveTableClass}
            title="Mover toda la cuenta a otra mesa"
          >
            <MdOpenWith className="text-base" />
            Mover mesa
          </button>
          <button
            type="button"
            onClick={() => openMesaTransfer('move_orders')}
            className={mesaToolbarMoveOrdersClass}
            title="Mover pedidos seleccionados a otra mesa"
          >
            <MdSwapHoriz className="text-base" />
            Mover pedidos
          </button>
        </div>
      </div>

      <div className="card">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 items-stretch">
          {tablesToShow.map(table => {
            const isOccupied = table.status === 'occupied' || (table.orders && table.orders.length > 0);
            const isActive = showMenu && selectedTable?.id === table.id;
            const cardStyle = isOccupied
              ? { borderColor: '#f87171', backgroundColor: '#fee2e2' }
              : { borderColor: '#34d399', backgroundColor: '#dcfce7' };
            const badgeStyle = isOccupied
              ? { backgroundColor: '#dc2626', color: '#ffffff' }
              : { backgroundColor: '#059669', color: '#ffffff' };
            return (
              <button
                key={table.id}
                type="button"
                onClick={() => openMenuForTable(table)}
                className={`flex h-full min-h-[7.25rem] flex-col rounded-xl border p-3 text-left transition-all hover:brightness-95 ${
                  isActive ? 'ring-2 ring-[var(--ui-accent)] ring-offset-2' : ''
                }`}
                style={cardStyle}
              >
                <div className="flex min-h-0 flex-1 flex-col justify-between gap-2">
                  <span className="inline-flex w-fit max-w-full items-center rounded-md bg-[var(--ui-accent)] px-2 py-0.5">
                    <span className="truncate font-bold text-white">{table.name}</span>
                  </span>
                  <p className="text-xs font-semibold text-neutral-900 tabular-nums">{table.capacity} pers.</p>
                  <span className="mt-auto inline-flex w-fit text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full" style={badgeStyle}>
                    {isOccupied ? 'Ocupada' : 'Disponible'}
                  </span>
                </div>
              </button>
            );
          })}
          {tablesToShow.length === 0 && (
            <div className="col-span-full py-16 text-center text-[var(--ui-muted)]">
              <MdTableRestaurant className="mx-auto mb-3 text-5xl opacity-40" />
              <p>No hay mesas en este salón</p>
            </div>
          )}
        </div>
      </div>

      {showMenu && selectedTable && (
        <div className="fixed top-14 left-0 right-0 bottom-0 z-[100] flex min-h-0">
          <button
            type="button"
            className="min-h-0 min-w-0 flex-1 cursor-default border-0 bg-black/40 p-0"
            aria-label="Cerrar panel"
            onClick={closeMenuPanel}
          />
          <aside
            className="flex h-full min-h-0 w-full min-w-0 shrink-0 flex-col border-l border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-body-text)] shadow-2xl md:w-1/2 md:max-w-[920px]"
            aria-labelledby="tables-add-order-title"
          >
          <div className="flex shrink-0 items-center justify-between border-b border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] px-4 py-3 sm:px-5">
            <div>
              <h3 id="tables-add-order-title" className="text-lg font-bold text-[var(--ui-body-text)]">
                Agregar Pedido — {selectedTable.name}
              </h3>
              <p className="text-xs text-[var(--ui-muted)]">Mesa {selectedTable.number}</p>
            </div>
            <button
              type="button"
              onClick={closeMenuPanel}
              className="rounded-lg p-2 text-[var(--ui-muted)] hover:bg-[var(--ui-sidebar-hover)] hover:text-[var(--ui-body-text)]"
              aria-label="Cerrar ventana"
            >
              <MdClose className="text-xl" />
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--ui-body-bg)] p-3 sm:p-4">
            <div className="flex h-full min-h-0 w-full gap-2 overflow-hidden lg:flex-row lg:items-stretch">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-[color:var(--ui-border)] bg-[var(--ui-surface)] p-3 sm:p-4">
                <StaffMesaPedidoTabs
                  orders={activeOrdersForTable}
                  formatCurrency={formatCurrency}
                  resetKey={selectedTable?.id}
                  className="min-h-0 flex-1 overflow-hidden"
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
                    className="min-h-0 flex-1"
                    cartLayout="lines"
                    footer={
                      cart.length > 0 ? (
                        <div className="space-y-2">
                          <div className="flex justify-between text-base font-bold text-[var(--ui-body-text)]">
                            <span>Total</span>
                            <span className="text-[var(--ui-accent-muted)]">{formatCurrency(cartTotal)}</span>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setParaLlevarMesa((v) => !v)}
                              className={`min-w-0 flex-1 rounded-lg border py-2.5 px-2 text-xs font-semibold uppercase tracking-wide transition-colors flex items-center justify-center ${
                                paraLlevarMesa
                                  ? 'border-transparent bg-[var(--ui-accent)] text-white shadow-sm'
                                  : 'border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]'
                              }`}
                            >
                              PARA LLEVAR
                            </button>
                            <button
                              type="button"
                              onClick={submitOrder}
                              className="btn-primary flex min-w-0 flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold shadow-lg"
                            >
                              <MdReceipt /> Enviar Pedido
                            </button>
                          </div>
                        </div>
                      ) : null
                    }
                  />
                </StaffMesaPedidoTabs>
              </div>
              <StaffDineInOrderCartPanel
                elevatedAside
                fillParentHeight
                className="hidden min-h-0 shrink-0 overflow-hidden lg:flex lg:h-full lg:max-h-full lg:flex-col lg:self-stretch"
                cart={cart}
                cartLayout="lines"
                formatCurrency={formatCurrency}
                noteEditorLineKey={noteEditorLineKey}
                setNoteEditorLineKey={setNoteEditorLineKey}
                updateQty={updateQty}
                removeFromCart={removeFromCart}
                updateItemNote={updateItemNote}
                footer={
                  cart.length > 0 ? (
                    <div className="space-y-2">
                      <div className="flex justify-between text-base font-bold text-[var(--ui-body-text)]">
                        <span>Total</span>
                        <span className="text-[var(--ui-accent-muted)]">{formatCurrency(cartTotal)}</span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setParaLlevarMesa((v) => !v)}
                          className={`min-w-0 flex-1 rounded-lg border py-2.5 px-2 text-xs font-semibold uppercase tracking-wide transition-colors flex items-center justify-center ${
                            paraLlevarMesa
                              ? 'border-transparent bg-[var(--ui-accent)] text-white shadow-sm'
                              : 'border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]'
                          }`}
                        >
                          PARA LLEVAR
                        </button>
                        <button
                          type="button"
                          onClick={submitOrder}
                          className="btn-primary flex min-w-0 flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold shadow-lg"
                        >
                          <MdReceipt /> Enviar Pedido
                        </button>
                      </div>
                    </div>
                  ) : null
                }
              />
            </div>
          </div>
          </aside>
        </div>
      )}

      <StaffModifierPromptModal
        open={modifierPrompt.open}
        onClose={() => setModifierPrompt({ open: false, product: null, modifier: null, selectedOption: '' })}
        modifierPrompt={modifierPrompt}
        setModifierPrompt={setModifierPrompt}
        onConfirm={confirmModifierForCart}
        onSkipOptional={addProductWithoutOptionalModifier}
      />

      <MesaTransferModal
        open={Boolean(mesaTransfer?.mode)}
        onClose={() => setMesaTransfer(null)}
        mode={mesaTransfer?.mode}
        tables={tables}
        pickSourceAndTarget
        onComplete={() => loadTables()}
      />
    </div>
  );
}
