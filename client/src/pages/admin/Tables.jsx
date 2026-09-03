import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { api, formatCurrency } from '../../utils/api';
import { mergeOrderingCatalog, buildOrderItemsPayload, filterOrderingProducts } from '../../utils/orderingCatalog';
import { useSocket } from '../../hooks/useSocket';
import { useActiveInterval } from '../../hooks/useActiveInterval';
import { useAuth } from '../../context/AuthContext';
import { useStaffOrderCart } from '../../hooks/useStaffOrderCart';
import Modal from '../../components/Modal';
import MesaTransferModal from '../../components/MesaTransferModal';
import MesaMapTableTile from '../../components/MesaMapTableTile';
import StaffDineInOrderUI, { StaffDineInOrderCartPanel, VIEWPORT_CART_MAX_CLASS } from '../../components/StaffDineInOrderUI';
import StaffMesaPedidoTabs from '../../components/StaffMesaPedidoTabs';
import StaffModifierPromptModal from '../../components/StaffModifierPromptModal';
import toast from 'react-hot-toast';
import { MdTableRestaurant, MdReceipt, MdOpenWith, MdSwapHoriz } from 'react-icons/md';
import { KITCHEN_TAKEOUT_NOTE } from '../../utils/ticketPlainText';
import { buildDineInOrderPayload } from '../../utils/mesaOrderLines';
import { buildTablesBySalon } from '../../utils/salonesUtils';
import {
  buildReservationByTableIdForToday,
  getMesaMapChairCount,
  getMesaMapVisualState,
} from '../../utils/mesaMapTableVisual';
import { useMesaOrderLock } from '../../hooks/useMesaOrderLock';
import { printKitchenBarOnComandaSend } from '../../utils/kitchenBarAutoPrint';

function buildMesaOrderNotes(paraLlevar, observation) {
  const parts = [];
  if (paraLlevar) parts.push(KITCHEN_TAKEOUT_NOTE);
  const obs = String(observation || '').trim();
  if (obs) parts.push(obs);
  return parts.join('\n');
}

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
  const [mesaOrderObservation, setMesaOrderObservation] = useState('');
  const [mesaTransfer, setMesaTransfer] = useState(null);
  const [reservations, setReservations] = useState([]);
  const [precuentaTableIds] = useState(() => new Set());
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
      api.get('/admin-modules/reservations').catch(() => []),
    ])
      .then(([data, salonesRes, reservationsData]) => {
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
        setReservations(Array.isArray(reservationsData) ? reservationsData : []);
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
    if (p?.domain === 'reservations') loadTables();
  });

  const openMenuForTable = (table) => {
    setSelectedTable(table);
    lockMesa(table);
    setShowMenu(true);
    setParaLlevarMesa(false);
    setMesaOrderObservation('');
    resetCart();
    setSearch('');
    setSelectedCat('all');
  };

  const closeMenuPanel = () => {
    setShowMenu(false);
    setParaLlevarMesa(false);
    setMesaOrderObservation('');
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
          notes: buildMesaOrderNotes(paraLlevarMesa, mesaOrderObservation),
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

  const reservationByTableId = useMemo(
    () => buildReservationByTableIdForToday(reservations),
    [reservations]
  );

  const filteredProducts = filterOrderingProducts(products, { search, selectedCat });
  const activeOrdersForTable = selectedTable?.orders || [];

  const openMesaTransfer = (mode) => {
    setMesaTransfer({ mode });
  };

  const mesaOrderSubmitFooter = cart.length > 0 ? (
    <div className="space-y-2">
      <div className="flex justify-between text-base font-bold text-white">
        <span>Total</span>
        <span className="text-[#BFDBFE]">{formatCurrency(cartTotal)}</span>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setParaLlevarMesa((v) => !v)}
          className={`min-w-0 flex-1 rounded-lg border py-2.5 px-2 text-xs font-semibold uppercase tracking-wide transition-colors flex items-center justify-center ${
            paraLlevarMesa
              ? 'bg-[var(--ui-accent)] text-white border-transparent shadow-sm'
              : 'border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] text-[#E5E7EB] hover:bg-[var(--ui-sidebar-hover)]'
          }`}
        >
          PARA LLEVAR
        </button>
        <button
          type="button"
          onClick={submitOrder}
          className="btn-primary flex min-w-0 flex-1 items-center justify-center gap-2 py-2.5 text-sm font-semibold"
        >
          <MdReceipt className="shrink-0" /> Enviar Pedido
        </button>
      </div>
    </div>
  ) : null;

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

      <div className="rf-mesa-map-toolbar mb-2 shrink-0">
        <div className="rf-mesa-map-toolbar__zones scrollbar-hide">
          {salonOptions.map((salonId) => {
            const active = selectedSalon === salonId;
            return (
              <button
                key={salonId}
                type="button"
                onClick={() => setSelectedSalon(salonId)}
                className={`rf-mesa-map-toolbar__zone-btn ${
                  active
                    ? 'border-[color:var(--ui-border)] bg-[var(--ui-accent)] text-white shadow-sm'
                    : 'border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]'
                }`}
              >
                {salonLabel(salonId)}
              </button>
            );
          })}
        </div>
        <div className="rf-mesa-map-toolbar__actions">
          <div className="rf-mesa-map-toolbar__divider hidden sm:block" aria-hidden="true" />
          <button
            type="button"
            onClick={() => openMesaTransfer('move_table')}
            className="btn-mesa-map-toolbar btn-mesa-move-table"
            title="Mover toda la cuenta a otra mesa"
          >
            <MdOpenWith className="shrink-0 text-sm" />
            <span>Mover mesa</span>
          </button>
          <button
            type="button"
            onClick={() => openMesaTransfer('move_orders')}
            className="btn-mesa-map-toolbar btn-mesa-move-orders"
            title="Mover pedidos seleccionados a otra mesa"
          >
            <MdSwapHoriz className="shrink-0 text-sm" />
            <span>Mover ped.</span>
          </button>
        </div>
      </div>

      <div className="rf-mesa-map-legend shrink-0 mb-2">
        <span className="rf-mesa-map-legend__item">
          <span className="rf-mesa-map-legend__dot" style={{ background: '#22c55e' }} />
          Libre
        </span>
        <span className="rf-mesa-map-legend__item">
          <span className="rf-mesa-map-legend__dot" style={{ background: '#f97316' }} />
          Ocupada
        </span>
        <span className="rf-mesa-map-legend__item">
          <span className="rf-mesa-map-legend__dot" style={{ background: '#9333ea' }} />
          Pre-cuenta
        </span>
        <span className="rf-mesa-map-legend__item">
          <span className="rf-mesa-map-legend__dot" style={{ background: '#9ca3af' }} />
          Reservada
        </span>
      </div>

      {tablesToShow.length > 0 ? (
        <div className="rf-mesa-map-grid">
          {tablesToShow.map((table) => {
            const isActive = showMenu && selectedTable?.id === table.id;
            const visualState = getMesaMapVisualState(table, reservationByTableId, precuentaTableIds);
            const chairCount = getMesaMapChairCount(table, reservationByTableId, tables);
            return (
              <MesaMapTableTile
                key={table.id}
                table={table}
                visualState={visualState}
                chairCount={chairCount}
                selected={isActive}
                onClick={() => openMenuForTable(table)}
              />
            );
          })}
        </div>
      ) : (
        <div className="py-16 text-center text-[var(--ui-muted)]">
          <MdTableRestaurant className="mx-auto mb-3 text-5xl opacity-40" />
          <p>No hay mesas en este salón</p>
        </div>
      )}

      <Modal
        isOpen={showMenu && Boolean(selectedTable)}
        onClose={closeMenuPanel}
        title={`Agregar Pedido — ${selectedTable?.name || ''}`}
        size="xl"
        maxHeightClass="max-h-[min(92vh,920px)]"
        bodyClassName="!overflow-hidden flex min-h-0 flex-1 flex-col !px-4 !pb-4 !pt-2 sm:!px-6 sm:!pb-6"
      >
        {selectedTable ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex min-h-0 flex-1 gap-2 overflow-hidden lg:flex-row lg:items-start">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
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
                    orderObservation={mesaOrderObservation}
                    onOrderObservationChange={setMesaOrderObservation}
                    footer={mesaOrderSubmitFooter}
                  />
                </StaffMesaPedidoTabs>
              </div>
              <StaffDineInOrderCartPanel
                elevatedAside
                fillParentHeight
                className={`hidden min-h-0 shrink-0 overflow-hidden lg:flex lg:flex-col lg:self-start ${VIEWPORT_CART_MAX_CLASS}`}
                cart={cart}
                cartLayout="lines"
                formatCurrency={formatCurrency}
                noteEditorLineKey={noteEditorLineKey}
                setNoteEditorLineKey={setNoteEditorLineKey}
                updateQty={updateQty}
                removeFromCart={removeFromCart}
                updateItemNote={updateItemNote}
                orderObservation={mesaOrderObservation}
                onOrderObservationChange={setMesaOrderObservation}
                footer={mesaOrderSubmitFooter}
              />
            </div>
          </div>
        ) : null}
      </Modal>

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
