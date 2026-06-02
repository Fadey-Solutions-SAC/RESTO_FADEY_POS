import { useState, useEffect, useMemo } from 'react';
import { mergeOrderingCatalog, buildOrderItemsPayload } from '../../utils/orderingCatalog';
import { useSocket } from '../../hooks/useSocket';
import { useActiveInterval } from '../../hooks/useActiveInterval';
import { useAuth } from '../../context/AuthContext';
import { useStaffOrderCart } from '../../hooks/useStaffOrderCart';
import Modal from '../../components/Modal';
import StaffDineInOrderUI from '../../components/StaffDineInOrderUI';
import StaffMesaPedidoTabs from '../../components/StaffMesaPedidoTabs';
import StaffModifierPromptModal from '../../components/StaffModifierPromptModal';
import toast from 'react-hot-toast';
import { MdTableRestaurant, MdReceipt, MdClose } from 'react-icons/md';
import { KITCHEN_TAKEOUT_NOTE } from '../../utils/ticketPlainText';

export default function Tables() {
  const { user } = useAuth();
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedTable, setSelectedTable] = useState(null);
  const [showMenu, setShowMenu] = useState(false);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [modifiers, setModifiers] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedCat, setSelectedCat] = useState('all');
  const [selectedSalon, setSelectedSalon] = useState('all');
  const [showActionModal, setShowActionModal] = useState(false);
  const [actionType, setActionType] = useState('');
  const [sourceTableId, setSourceTableId] = useState('');
  const [targetTableId, setTargetTableId] = useState('');
  const [paraLlevarMesa, setParaLlevarMesa] = useState(false);

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

  const productsById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const loadTables = () => {
    api.get('/tables').then(data => {
      setTables(data);
      if (selectedTable) setSelectedTable(data.find(t => t.id === selectedTable.id) || null);
    }).catch(console.error).finally(() => setLoading(false));
  };

  const loadProducts = () => {
    Promise.all([
      api.get('/products?active_only=true&available_now=true'),
      api.get('/categories/active'),
      api.get('/admin-modules/modifiers').catch(() => []),
      api.get('/admin-modules/combos').catch(() => []),
    ]).then(([prods, cats, mods, combosData]) => {
      const merged = mergeOrderingCatalog(prods, cats, combosData || []);
      setProducts(merged.products);
      setCategories(merged.categories);
      setModifiers(Array.isArray(mods) ? mods : []);
    }).catch(console.error);
  };

  useEffect(() => {
    loadTables();
    loadProducts();
  }, []);
  useActiveInterval(loadTables, 10000);
  useSocket('order-update', loadTables);
  useSocket('table-update', loadTables);
  useSocket('inventory-update', loadProducts);
  useSocket('staff-data-update', (p) => {
    if (['catalog', 'modifiers', 'combos'].includes(p?.domain)) loadProducts();
  });

  const openMenuForTable = (table) => {
    setSelectedTable(table);
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
  };

  const openAction = (type) => {
    if (!type) return;
    const initialSourceId = selectedTable?.id || '';
    setActionType(type);
    setSourceTableId(initialSourceId);
    setTargetTableId('');
    setShowActionModal(true);
  };

  const executeAction = async () => {
    try {
      if (!actionType) return toast.error('Selecciona una acción');
      const sourceForAction = tables.find((t) => t.id === sourceTableId) || null;
      if (actionType === 'move') {
        if (!sourceTableId) return toast.error('Selecciona mesa origen');
        if (!sourceForAction?.id) return toast.error('La mesa origen ya no está disponible, vuelve a seleccionarla');
        if (!targetTableId) return toast.error('Selecciona mesa destino');
        if (sourceForAction?.id === targetTableId) return toast.error('Origen y destino deben ser diferentes');
        await api.post('/tables/move-orders', {
          source_table_id: sourceForAction.id,
          target_table_id: targetTableId,
        });
        toast.success('Pedidos movidos correctamente');
      }
      if (actionType === 'merge') {
        if (!sourceTableId) return toast.error('Selecciona mesa origen');
        if (!targetTableId) return toast.error('Selecciona mesa destino');
        if (sourceTableId === targetTableId) return toast.error('Origen y destino deben ser diferentes');
        await api.post('/tables/merge', {
          target_table_id: targetTableId,
          source_table_ids: [sourceTableId],
        });
        toast.success('Mesas unidas correctamente');
      }
      setShowActionModal(false);
      loadTables();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const submitOrder = async () => {
    if (!selectedTable) return toast.error('Selecciona una mesa');
    if (cart.length === 0) return toast.error('Agrega productos al pedido');
    const missingRequiredNote = cart.find(i => Number(i.note_required || 0) === 1 && !String(i.notes || '').trim());
    if (missingRequiredNote) {
      setNoteEditorLineKey(missingRequiredNote.line_key);
      return toast.error(`"${missingRequiredNote.name}" requiere nota obligatoria`);
    }
    const tid = toast.loading('Enviando pedido…');
    try {
      const created = await api.post('/orders', {
        items: buildOrderItemsPayload(cart),
        type: 'dine_in',
        table_number: String(selectedTable.number),
        customer_name: `Mesa ${selectedTable.number}`,
        payment_method: 'efectivo',
        notes: paraLlevarMesa ? KITCHEN_TAKEOUT_NOTE : '',
      });
      toast.success(`Pedido enviado a Mesa ${selectedTable.number}`, { id: tid });
      closeMenuPanel();
      loadTables();
    } catch (err) {
      toast.error(err.message || 'No se pudo enviar el pedido', { id: tid });
    }
  };

  const salonOptions = useMemo(() => {
    const zones = [...new Set((tables || []).map(t => String(t.zone || 'principal').trim()).filter(Boolean))];
    return ['all', ...zones];
  }, [tables]);

  const salonLabel = (id) => {
    if (id === 'all') return 'Todos';
    return id.replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
  };

  const tablesToShow = selectedSalon === 'all'
    ? tables
    : tables.filter(t => String(t.zone || 'principal') === selectedSalon);
  const actionOptions = [
    { id: 'move', label: 'Mover pedidos' },
    { id: 'merge', label: 'Unir mesas' },
  ];

  const filteredProducts = products.filter(p => {
    if (selectedCat !== 'all' && p.category_id !== selectedCat) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  const activeOrdersForTable = selectedTable?.orders || [];

  if (loading) return <div className="flex h-64 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--ui-accent)] border-t-transparent" /></div>;

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-[var(--ui-body-text)]">Mesas</h1>
        <p className="mt-1 text-sm text-[var(--ui-muted)]">Gestión de salón y consumo por mesa</p>
      </div>

      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-2">
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
        </div>

        {actionOptions.length > 0 && (
          <div className="flex flex-wrap gap-2 md:justify-end">
            {actionOptions.map((action) => (
              <button
                key={action.id}
                type="button"
                onClick={() => openAction(action.id)}
                className="rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] px-3 py-1.5 text-xs font-medium text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]"
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 items-stretch">
          {tablesToShow.map(table => {
            const isOccupied = table.status === 'occupied' || (table.orders && table.orders.length > 0);
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
                className="flex h-full min-h-[7.25rem] flex-col rounded-xl border p-3 text-left transition-all hover:brightness-95"
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

          <div className="min-h-0 flex-1 overflow-hidden bg-[var(--ui-body-bg)] p-3 sm:p-4">
            <div className="flex h-full min-h-0 w-full flex-col rounded-xl border border-[color:var(--ui-border)] bg-[var(--ui-surface)] p-3 sm:p-4">
              <StaffMesaPedidoTabs
                orders={activeOrdersForTable}
                formatCurrency={formatCurrency}
                resetKey={selectedTable?.id}
                className="min-h-0 flex-1"
              >
                <StaffDineInOrderUI
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
                  className="flex-1 min-h-0"
                  cartLayout="lines"
                  footer={
                    cart.length > 0 ? (
                      <div className="space-y-2">
                        <div className="flex justify-between text-lg font-bold text-[var(--ui-body-text)]">
                          <span>Total</span>
                          <span className="text-[var(--ui-accent-muted)]">{formatCurrency(cartTotal)}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setParaLlevarMesa((v) => !v)}
                          className={`mx-auto flex w-1/2 items-center justify-center rounded-lg border py-1 px-2 text-xs font-semibold uppercase tracking-wide transition-colors ${
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
                          className="btn-primary flex w-full items-center justify-center gap-2 rounded-lg py-3 text-base font-semibold shadow-lg"
                        >
                          <MdReceipt /> Enviar Pedido
                        </button>
                      </div>
                    ) : null
                  }
                />
              </StaffMesaPedidoTabs>
            </div>
          </div>
          </aside>
        </div>
      )}

      <Modal
        isOpen={showActionModal}
        onClose={() => setShowActionModal(false)}
        title={actionType === 'merge' ? 'Unir mesas' : 'Mover pedidos'}
        size="md"
      >
        <div className="space-y-3">
          {actionType && (actionType === 'move' || actionType === 'merge') && (
            <div>
              <label className="mb-1 block text-sm text-[var(--ui-body-text)]">
                {actionType === 'merge' ? 'Primera mesa' : 'Mesa origen'}
              </label>
              <select
                value={sourceTableId}
                onChange={(e) => {
                  const nextSourceId = e.target.value;
                  setSourceTableId(nextSourceId);
                }}
                className="input-field"
              >
                <option value="">Seleccionar...</option>
                {tables.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}

          {actionType && (actionType === 'merge' || actionType === 'move') && (
            <div>
              <label className="mb-1 block text-sm text-[var(--ui-body-text)]">
                {actionType === 'merge' ? 'Segunda mesa' : 'Mesa destino'}
              </label>
              <select value={targetTableId} onChange={e => setTargetTableId(e.target.value)} className="input-field">
                <option value="">Seleccionar...</option>
                {tables.filter(t => t.id !== sourceTableId).map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button onClick={() => setShowActionModal(false)} className="btn-secondary flex-1">Cancelar</button>
            <button onClick={executeAction} disabled={!actionType} className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed">
              Ejecutar
            </button>
          </div>
        </div>
      </Modal>

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
