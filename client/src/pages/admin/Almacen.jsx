import { useState, useEffect, useMemo } from 'react';
import { useSocket } from '../../hooks/useSocket';
import { useSearchParams } from 'react-router-dom';
import { api, formatCurrency, formatInsumoQty, formatInsumoWithUnit } from '../../utils/api';
import { UI_BADGE } from '../../utils/uiBadges';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';
import { MdSearch, MdWarning, MdAdd, MdRemove, MdDownload, MdDeleteOutline, MdEdit } from 'react-icons/md';
import Modal from '../../components/Modal';
import LogisticaKardexModule from '../../components/LogisticaKardexModule';
import InsumoCreateModal from '../../components/InsumoCreateModal';
import { isProductLowStock, productStockStatus } from '../../utils/productStockDisplay';

const WAREHOUSE_CATEGORY_NAMES = {
  products: 'PRODUCTOS ALMACEN',
  supplies: 'INSUMOS',
};

const DEFAULT_STOCK_WAREHOUSE = '';

function parseWarehouseMeta(description, fallbackStock) {
  const raw = description || '';
  const transformedMatch = raw.match(/\[WAREHOUSE_PROCESS:(transformed|non_transformed)\]/);
  const mainMatch = raw.match(/\[STOCK_MAIN:(-?\d+)\]/);
  const kitchenMatch = raw.match(/\[STOCK_KITCHEN:(-?\d+)\]/);
  const notes = raw.replace(/\[(WAREHOUSE_PROCESS|STOCK_MAIN|STOCK_KITCHEN):[^\]]+\]\s*/g, '').trim();

  const fallback = Math.max(0, Number(fallbackStock || 0));
  let stockMain = mainMatch ? Math.max(0, parseInt(mainMatch[1], 10) || 0) : fallback;
  let stockKitchen = kitchenMatch ? Math.max(0, parseInt(kitchenMatch[1], 10) || 0) : 0;

  if (!mainMatch && kitchenMatch) {
    stockMain = Math.max(0, fallback - stockKitchen);
  }
  if (!mainMatch && !kitchenMatch) {
    stockMain = fallback;
    stockKitchen = 0;
  }

  return {
    process: transformedMatch ? transformedMatch[1] : 'non_transformed',
    stockMain,
    stockKitchen,
    notes,
  };
}

function buildWarehouseDescription(notes, process, stockMain, stockKitchen) {
  const cleanNotes = (notes || '').trim();
  const tags = [
    `[WAREHOUSE_PROCESS:${process}]`,
    `[STOCK_MAIN:${Math.max(0, parseInt(stockMain, 10) || 0)}]`,
    `[STOCK_KITCHEN:${Math.max(0, parseInt(stockKitchen, 10) || 0)}]`,
  ].join('\n');
  return cleanNotes ? `${tags}\n${cleanNotes}` : tags;
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('es-PE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function insumoUnidadMedidaDisplay(insumo) {
  return (String(insumo?.unidad_medida || 'kg').replace(/[0-9]/g, '') || 'kg').trim();
}

/** Estado visual alineado con KPI stock bajo del kardex. */
function insumoEstadoStock(insumo) {
  const uMin = Number(insumo.minimo_unidades || 0);
  const uAct = Number(insumo.stock_unidades ?? 0);
  const sMin = Number(insumo.stock_minimo || 0);
  const sAct = Number(insumo.stock_actual ?? 0);
  const lowU = uMin > 0 && uAct < uMin;
  const lowM = sMin > 0 && sAct < sMin;
  if (lowU || lowM) return 'bajo';
  if (sAct <= 1e-9 && uAct <= 1e-9) return 'agotado';
  return 'normal';
}

/** Almacén que muestra lista y KPI de insumos kardex (columna linked_insumos o nombre heredado). */
function isInsumosWarehouse(warehouse) {
  if (!warehouse) return false;
  if (Number(warehouse.linked_insumos) === 1) return true;
  return String(warehouse.name || '').toLowerCase().includes('insumos');
}

/** Producto de catálogo asociado a un almacén (por defecto o con fila de stock). */
function productInventoryInvestment(p) {
  const pc = p.purchase_price;
  if (pc == null || pc === '' || !Number.isFinite(Number(pc)) || Number(pc) <= 0) return 0;
  return Number(pc) * Number(p.stock || 0);
}

function productLinkedToWarehouse(p, whId) {
  if (!whId) return true;
  if (String(p.stock_warehouse_id || '') === String(whId)) return true;
  return (p.warehouse_stocks || []).some((ws) => String(ws.warehouse_id) === String(whId));
}

function CreateProductModal({
  isOpen,
  onClose,
  itemForm,
  setItemForm,
  categoryOptionsForCreate,
  getCategoryIdByType,
  warehouses,
  handleCreateItem,
}) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Nuevo producto" size="sm" placement="right">
      <form onSubmit={handleCreateItem} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Nombre</label>
          <input
            value={itemForm.name}
            onChange={e => setItemForm({ ...itemForm, name: formatCatalogNameInput(e.target.value) })}
            className="input-field"
            required
            placeholder="Ej: Gaseosa 500ml o Harina x Kg"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Descripción</label>
          <input
            value={itemForm.description}
            onChange={e => setItemForm({ ...itemForm, description: e.target.value })}
            className="input-field"
            placeholder="Descripción breve"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Precio venta</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={itemForm.price}
              onChange={e => setItemForm({ ...itemForm, price: e.target.value })}
              className="input-field"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Precio compra (opc.)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={itemForm.purchase_price}
              onChange={e => setItemForm({ ...itemForm, purchase_price: e.target.value })}
              className="input-field"
              placeholder="Inversión en inventario"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Stock inicial</label>
          <input
            type="number"
            min="0"
            value={itemForm.stock}
            onChange={e => setItemForm({ ...itemForm, stock: e.target.value })}
            className="input-field"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Categoría de producto</label>
          <select
            value={itemForm.category_id}
            onChange={e => setItemForm({ ...itemForm, category_id: e.target.value })}
            className="input-field"
          >
            <option value="">Sin categoría (solo almacén)</option>
            {categoryOptionsForCreate.length === 0 && (
              <option value="">No hay categorías disponibles</option>
            )}
            {categoryOptionsForCreate.map(c => (
              <option key={c.id} value={c.id}>
                {c.id === getCategoryIdByType('products') ? 'PRODUCTOS ALMACEN (solo almacén)' : c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Almacén destino</label>
          <select
            value={itemForm.stock_warehouse}
            onChange={e => setItemForm({ ...itemForm, stock_warehouse: e.target.value })}
            className="input-field"
          >
            {warehouses.map(w => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-[var(--ui-body-text)] cursor-pointer">
          <input
            type="checkbox"
            checked={Number(itemForm.note_required || 0) === 1}
            onChange={(e) => setItemForm({ ...itemForm, note_required: e.target.checked ? 1 : 0 })}
            className="rounded"
          />
          <span>Nota obligatoria al pedir</span>
        </label>
        <div className="flex gap-3">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
          <button type="submit" className="btn-primary flex-1">Guardar</button>
        </div>
      </form>
    </Modal>
  );
}

const ALMACEN_VIEWS = [
  { id: 'movimiento_interno', label: 'Movimiento interno' },
  { id: 'ir_modulo_logistica', label: 'Inventario y kardex' },
  { id: 'requerimiento', label: 'Requerimiento' },
  { id: 'recepcion', label: 'Recepción' },
  { id: 'ir_modulo_gastos', label: 'Ir a módulo de gastos' },
];

export default function Almacen() {
  const { user } = useAuth();
  const planAllowsAlmacenAvanzado = user?.service_plan !== 'basico';
  const almacenViewsForPlan = useMemo(() => {
    const subAlmacen = user?.sub_permissions?.almacen || {};
    return ALMACEN_VIEWS.filter((v) => {
      if (!planAllowsAlmacenAvanzado && ['requerimiento', 'recepcion'].includes(v.id)) return false;
      if (subAlmacen[v.id] === false) return false;
      return true;
    });
  }, [planAllowsAlmacenAvanzado, user?.sub_permissions?.almacen]);

  const [searchParams, setSearchParams] = useSearchParams();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState(searchParams.get('view') || 'movimiento_interno');
  const [selectedWarehouseView, setSelectedWarehouseView] = useState('');
  const [search, setSearch] = useState('');
  const [stockModal, setStockModal] = useState(null);
  const [stockChange, setStockChange] = useState('');
  const [stockReason, setStockReason] = useState('');
  const [showDeleteFlow, setShowDeleteFlow] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [stockWarehouse, setStockWarehouse] = useState(DEFAULT_STOCK_WAREHOUSE);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showInsumoModal, setShowInsumoModal] = useState(false);
  const [showWarehouseModal, setShowWarehouseModal] = useState(false);
  const [showRequirementModal, setShowRequirementModal] = useState(false);
  const [selectedRequirementIds, setSelectedRequirementIds] = useState([]);
  const [latestRequirement, setLatestRequirement] = useState(null);
  const [receptionForm, setReceptionForm] = useState({});
  const [receptionExtraLines, setReceptionExtraLines] = useState([]);
  const [showReceptionAddModal, setShowReceptionAddModal] = useState(false);
  const [receptionAddDraft, setReceptionAddDraft] = useState({
    pickValue: '',
    warehouse_id: '',
    quantity: '1',
    unit_cost: '0',
  });
  const [createModalAfterReception, setCreateModalAfterReception] = useState(false);
  const [receptionNotes, setReceptionNotes] = useState('');
  /** Filas marcadas para incluir en el registro de recepción (`req:productId` | `extra:lineId`). */
  const [receptionSelectedKeys, setReceptionSelectedKeys] = useState([]);
  const [expenseHistory, setExpenseHistory] = useState([]);
  const [expenseEditGroupId, setExpenseEditGroupId] = useState(null);
  const [expenseEditDraft, setExpenseEditDraft] = useState({});
  const [expenseEditNotes, setExpenseEditNotes] = useState('');
  const [showExpensePasswordModal, setShowExpensePasswordModal] = useState(false);
  const [expenseAdminPassword, setExpenseAdminPassword] = useState('');
  const [expenseSavePending, setExpenseSavePending] = useState(false);
  const [kardexBajoMin, setKardexBajoMin] = useState([]);
  const [kardexInsumos, setKardexInsumos] = useState([]);
  /** En almacén de insumos: ver todos, solo cocina o solo bar. */
  const [insumosVistaArea, setInsumosVistaArea] = useState('all');
  const [warehouseForm, setWarehouseForm] = useState({ name: '', description: '', linkedInsumos: false });
  const [itemForm, setItemForm] = useState({
    name: '',
    description: '',
    price: '',
    purchase_price: '',
    stock: '0',
    category_id: '',
    stock_warehouse: DEFAULT_STOCK_WAREHOUSE,
    note_required: 0,
  });
  const [stockPurchasePrice, setStockPurchasePrice] = useState('');

  const getCategoryIdByType = (type) => categories.find(c => c.name === WAREHOUSE_CATEGORY_NAMES[type])?.id || '';
  const productCategoryOptions = categories.filter(c => {
    const name = (c.name || '').toUpperCase();
    return name !== WAREHOUSE_CATEGORY_NAMES.supplies && name !== WAREHOUSE_CATEGORY_NAMES.products;
  });
  const categoryOptionsForCreate = [
    ...categories.filter(c => c.id === getCategoryIdByType('products')),
    ...productCategoryOptions,
    ...categories.filter(c => (c.name || '').toUpperCase() === WAREHOUSE_CATEGORY_NAMES.supplies),
  ];
  const principalWarehouse = warehouses.find(w => w.name === 'Almacen Principal') || warehouses[0];
  /** Ítems ya listados en el requerimiento (producto o insumo kardex comparten `product_id` en la fila). */
  const receptionRequirementIds = useMemo(
    () => new Set((latestRequirement?.items || []).map((i) => i.product_id).filter(Boolean)),
    [latestRequirement]
  );

  const receptionPickProducts = useMemo(() => {
    const whId = receptionAddDraft.warehouse_id;
    const selectedWh = warehouses.find((w) => String(w.id) === String(whId));
    const insumosDestino = selectedWh && isInsumosWarehouse(selectedWh);
    const extraIds = new Set(receptionExtraLines.map((l) => l.product_id));
    const isSupplySku = (p) => (p.category_name || '').toUpperCase() === WAREHOUSE_CATEGORY_NAMES.supplies;

    let list = products.filter((p) => !receptionRequirementIds.has(p.id) && !extraIds.has(p.id));

    if (insumosDestino) {
      list = list.filter((p) => isSupplySku(p));
    } else if (whId) {
      list = list.filter((p) => productLinkedToWarehouse(p, whId));
    }

    return list
      .slice()
      .sort((a, b) => String(a.name || '').localeCompare(b.name || '', 'es'));
  }, [products, receptionRequirementIds, receptionExtraLines, receptionAddDraft.warehouse_id, warehouses]);

  const receptionPickInsumos = useMemo(() => {
    const whId = receptionAddDraft.warehouse_id;
    const selectedWh = warehouses.find((w) => String(w.id) === String(whId));
    if (!selectedWh || !isInsumosWarehouse(selectedWh)) {
      return [];
    }
    const extraIds = new Set(receptionExtraLines.map((l) => l.product_id));
    return kardexInsumos
      .filter((ins) => Number(ins.activo) !== 0 && ins.id && !receptionRequirementIds.has(ins.id) && !extraIds.has(ins.id))
      .slice()
      .sort((a, b) => String(a.nombre || '').localeCompare(b.nombre || '', 'es'));
  }, [kardexInsumos, receptionRequirementIds, receptionExtraLines, receptionAddDraft.warehouse_id, warehouses]);

  const receptionPickListEmpty = receptionPickProducts.length === 0 && receptionPickInsumos.length === 0;
  const sameWarehouseId = (a, b) => String(a || '') === String(b || '');

  const receptionReqKey = (productId) => `req:${productId}`;
  const receptionExtraKey = (lineId) => `extra:${lineId}`;

  const allReceptionRowKeys = useMemo(() => {
    const reqKeys = (latestRequirement?.items || []).map((item) => receptionReqKey(item.product_id));
    const extraKeys = receptionExtraLines.map((line) => receptionExtraKey(line.lineId));
    return [...reqKeys, ...extraKeys];
  }, [latestRequirement, receptionExtraLines]);

  const selectAllReceptionRows = () => setReceptionSelectedKeys(allReceptionRowKeys);
  const deselectAllReceptionRows = () => setReceptionSelectedKeys([]);

  const toggleReceptionRow = (key) => {
    setReceptionSelectedKeys((prev) => (
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    ));
  };

  const isReceptionRowSelected = (key) => receptionSelectedKeys.includes(key);
  const getDefaultCreateWarehouseId = () => {
    if (selectedWarehouseView && warehouses.some(w => sameWarehouseId(w.id, selectedWarehouseView))) {
      return String(selectedWarehouseView);
    }
    if (stockWarehouse && warehouses.some(w => sameWarehouseId(w.id, stockWarehouse))) {
      return String(stockWarehouse);
    }
    return String(principalWarehouse?.id || warehouses[0]?.id || '');
  };

  const load = async () => {
    try {
      const [currentCategories, warehouseData, dashK, insK] = await Promise.all([
        api.get('/categories'),
        api.get('/inventory/warehouse-stock'),
        planAllowsAlmacenAvanzado
          ? api.get('/kardex-inventory/dashboard').catch(() => null)
          : Promise.resolve(null),
        api.get('/kardex-inventory/insumos').catch(() => []),
      ]);
      setKardexBajoMin(dashK?.insumos_bajo_minimo && Array.isArray(dashK.insumos_bajo_minimo) ? dashK.insumos_bajo_minimo : []);
      setKardexInsumos(Array.isArray(insK) ? insK : []);
      setCategories(currentCategories);
      setWarehouses(warehouseData.warehouses || []);
      const warehouseProducts = (warehouseData.products || [])
        .filter(p => {
          const categoryName = (p.category_name || '').toUpperCase();
          const isSupply = categoryName === WAREHOUSE_CATEGORY_NAMES.supplies;
          const isNonTransformed = p.process_type === 'non_transformed';
          return isSupply || isNonTransformed;
        })
        .map(p => {
          const parsed = parseWarehouseMeta(p.description, p.stock);
          return {
            ...p,
            process: p.process_type === 'non_transformed' ? 'non_transformed' : (p.process_type === 'transformed' ? 'transformed' : parsed.process),
            stock_main: Number((p.warehouse_stocks || []).find(ws => ws.warehouse_name === 'Almacen Principal')?.quantity || 0),
            stock_kitchen: Number((p.warehouse_stocks || []).find(ws => ws.warehouse_name === 'Almacen Cocina')?.quantity || 0),
            stock: Number(p.total_stock || 0),
            notes: parsed.notes,
            warehouse_stocks: p.warehouse_stocks || [],
          };
        });
      setProducts(warehouseProducts);
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'No se pudo cargar almacén');
    } finally {
      setLoading(false);
    }
  };

  useSocket('inventory-update', () => {
    void load();
  });
  useSocket('staff-data-update', (p) => {
    if (p?.domain === 'catalog') void load();
  });

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (activeView === 'recepcion') {
      setReceptionExtraLines([]);
    }
  }, [activeView]);
  useEffect(() => {
    const loadViewData = async () => {
      try {
        if (activeView === 'recepcion') {
          const requirement = await api.get('/inventory/requirements/latest?status=pending');
          setLatestRequirement(requirement);
          const nextForm = {};
          (requirement?.items || []).forEach(item => {
            nextForm[item.product_id] = {
              quantity: String(Number(item.suggested_qty || 0)),
              unit_cost: String(Number(item.unit_cost || 0)),
              warehouse_id: item.warehouse_id || '',
            };
          });
          setReceptionForm(nextForm);
          setReceptionSelectedKeys((requirement?.items || []).map((item) => receptionReqKey(item.product_id)));
        }
        if (activeView === 'ir_modulo_gastos') {
          const expenses = await api.get('/inventory/expenses');
          setExpenseHistory(expenses || []);
        }
      } catch (err) {
        toast.error(err.message || 'No se pudo cargar la información');
      }
    };
    loadViewData();
  }, [activeView]);
  useEffect(() => {
    if (!warehouses.length) return;
    if (!itemForm.stock_warehouse) {
      setItemForm(prev => ({ ...prev, stock_warehouse: getDefaultCreateWarehouseId() }));
    }
    if (!stockWarehouse) {
      setStockWarehouse(principalWarehouse?.id || warehouses[0].id);
    }
  }, [warehouses, selectedWarehouseView]);
  useEffect(() => {
    if (!showCreateModal) return;
    const defaultWarehouseId = getDefaultCreateWarehouseId();
    if (!defaultWarehouseId) return;
    setItemForm(prev => ({ ...prev, stock_warehouse: defaultWarehouseId }));
  }, [showCreateModal, selectedWarehouseView, stockWarehouse, warehouses]);
  useEffect(() => {
    if (!categories.length) return;
    if (itemForm.category_id) return;
    setItemForm(prev => ({ ...prev, category_id: '' }));
  }, [categories]);
  useEffect(() => {
    if (!almacenViewsForPlan.some((v) => v.id === activeView)) {
      setActiveView(almacenViewsForPlan[0]?.id || 'movimiento_interno');
      setSearchParams({ view: almacenViewsForPlan[0]?.id || 'movimiento_interno' }, { replace: true });
    }
  }, [almacenViewsForPlan, activeView, setSearchParams]);

  useEffect(() => {
    const requestedView = searchParams.get('view');
    const isValidView = almacenViewsForPlan.some(option => option.id === requestedView);
    if (isValidView && requestedView !== activeView) {
      setActiveView(requestedView);
      return;
    }
    if (!isValidView && activeView !== 'movimiento_interno') {
      setSearchParams({ view: activeView }, { replace: true });
      return;
    }
    if (!isValidView && !requestedView) {
      setSearchParams({ view: 'movimiento_interno' }, { replace: true });
    }
  }, [activeView, searchParams, setSearchParams, almacenViewsForPlan]);

  useEffect(() => {
    const w = warehouses.find((x) => sameWarehouseId(x.id, selectedWarehouseView));
    if (!isInsumosWarehouse(w)) {
      setInsumosVistaArea('all');
    }
  }, [selectedWarehouseView, warehouses]);

  const scopedProducts = products.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase());
    return matchSearch;
  });
  const lowFromWarehouse = products.filter(
    (p) => p.process === 'non_transformed' && isProductLowStock(p.stock, p.min_stock)
  );
  const lowFromKardex = (kardexBajoMin || []).map((i) => {
    const uMin = Number(i.minimo_unidades) || 0;
    const sMin = Number(i.stock_minimo) || 0;
    const uAct = Number(i.stock_unidades) || 0;
    const sAct = Number(i.stock_actual) || 0;
    const bajoU = uMin > 0 && uAct < uMin;
    return {
      id: i.id,
      name: i.nombre,
      stock: bajoU ? uAct : sAct,
      minimo: bajoU ? uMin : sMin,
      isKardex: true,
      kardexPorU: bajoU,
      umed: String(i.unidad_medida || 'kg').replace(/[0-9]/g, '').trim() || 'kg',
    };
  });
  const lowStockGlobal = [...lowFromWarehouse, ...lowFromKardex];
  const productsForSelectedWarehouse = selectedWarehouseView
    ? scopedProducts.filter(p =>
      (p.warehouse_stocks || []).some(ws => sameWarehouseId(ws.warehouse_id, selectedWarehouseView))
    )
    : [];

  const warehouseUsageMap = products.reduce((acc, product) => {
    (product.warehouse_stocks || []).forEach(ws => {
      const qty = Number(ws.quantity || 0);
      if (!acc[ws.warehouse_id]) acc[ws.warehouse_id] = 0;
      if (qty > 0) acc[ws.warehouse_id] += 1;
    });
    return acc;
  }, {});

  const lowStock = productsForSelectedWarehouse.filter(
    (p) => p.process === 'non_transformed' && isProductLowStock(p.stock, p.min_stock)
  );
  const selectedWarehouse = warehouses.find((w) => sameWarehouseId(w.id, selectedWarehouseView));
  const selectedIsInsumosWarehouse = isInsumosWarehouse(selectedWarehouse);
  const insumosActivos = (kardexInsumos || []).filter((i) => Number(i.activo) !== 0);
  const insumosPorVista =
    !selectedIsInsumosWarehouse || insumosVistaArea === 'all'
      ? insumosActivos
      : insumosActivos.filter((i) => {
          const a = String(i.insumo_area || 'cocina').toLowerCase() === 'bar' ? 'bar' : 'cocina';
          return a === insumosVistaArea;
        });
  const insumosTablaFiltrados = selectedIsInsumosWarehouse
    ? insumosPorVista.filter((i) =>
        String(i.nombre || '')
          .toLowerCase()
          .includes(search.toLowerCase())
      )
    : [];
  const insumosTotalValue = insumosPorVista.reduce(
    (s, i) => s + Number(i.stock_actual || 0) * Number(i.costo_promedio || 0),
    0
  );
  const insumosLowCount = insumosPorVista.filter((i) => {
    const uMin = Number(i.minimo_unidades || 0);
    const uAct = Number(i.stock_unidades || 0);
    const sMin = Number(i.stock_minimo || 0);
    const sAct = Number(i.stock_actual || 0);
    return (uMin > 0 && uAct < uMin) || (sMin > 0 && sAct < sMin);
  }).length;
  const insumosTotalUnits = insumosPorVista.reduce((s, i) => s + Number(i.stock_unidades || 0), 0);
  const totalValue = selectedIsInsumosWarehouse
    ? insumosTotalValue
    : productsForSelectedWarehouse.reduce((s, p) => s + (p.price * p.stock), 0);
  const totalInventoryInvestment = selectedIsInsumosWarehouse
    ? insumosTotalValue
    : productsForSelectedWarehouse.reduce((s, p) => s + productInventoryInvestment(p), 0);
  const expenseGroups = Object.values(
    (expenseHistory || []).reduce((acc, expense) => {
      const key = expense.requirement_id || expense.id;
      if (!acc[key]) {
        acc[key] = {
          id: key,
          requirement_id: expense.requirement_id || null,
          created_at: expense.created_at,
          notes: expense.notes || '',
          total: 0,
          items: [],
        };
      }
      acc[key].items.push(expense);
      acc[key].total += Number(expense.total_cost || 0);
      if (expense.created_at && expense.created_at > acc[key].created_at) {
        acc[key].created_at = expense.created_at;
      }
      return acc;
    }, {})
  ).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  const startExpenseGroupEdit = (group) => {
    const draft = {};
    (group.items || []).forEach((item) => {
      draft[item.id] = {
        quantity: String(Number(item.quantity || 0)),
        unit_cost: String(Number(item.unit_cost || 0)),
      };
    });
    setExpenseEditGroupId(group.id);
    setExpenseEditDraft(draft);
    setExpenseEditNotes(String(group.notes || ''));
  };

  const cancelExpenseGroupEdit = () => {
    setExpenseEditGroupId(null);
    setExpenseEditDraft({});
    setExpenseEditNotes('');
    setExpenseAdminPassword('');
    setShowExpensePasswordModal(false);
  };

  const expenseEditDraftTotal = (group) => (group.items || []).reduce((sum, item) => {
    const row = expenseEditDraft[item.id] || {};
    const qty = Number(row.quantity || 0);
    const cost = Number(row.unit_cost || 0);
    return sum + qty * cost;
  }, 0);

  const requestSaveExpenseGroup = (group) => {
    if (!group?.items?.length) return;
    for (const item of group.items) {
      const row = expenseEditDraft[item.id] || {};
      const qty = Number(row.quantity || 0);
      const cost = Number(row.unit_cost || 0);
      if (!Number.isFinite(qty) || qty < 0) {
        toast.error('Revisa las cantidades ingresadas');
        return;
      }
      if (!Number.isFinite(cost) || cost < 0) {
        toast.error('Revisa los precios unitarios ingresados');
        return;
      }
    }
    setShowExpensePasswordModal(true);
  };

  const saveExpenseGroupEdit = async (group) => {
    if (!group?.items?.length) return;
    const pwd = String(expenseAdminPassword || '').trim();
    if (!pwd) {
      toast.error('Ingresa la contraseña de administrador');
      return;
    }
    setExpenseSavePending(true);
    try {
      await api.put('/inventory/expenses', {
        admin_password: pwd,
        requirement_id: group.requirement_id || null,
        notes: expenseEditNotes,
        updates: group.items.map((item) => ({
          id: item.id,
          quantity: Number(expenseEditDraft[item.id]?.quantity || 0),
          unit_cost: Number(expenseEditDraft[item.id]?.unit_cost || 0),
        })),
      });
      toast.success('Gasto actualizado');
      cancelExpenseGroupEdit();
      const expenses = await api.get('/inventory/expenses');
      setExpenseHistory(expenses || []);
    } catch (err) {
      toast.error(err.message || 'No se pudo guardar');
    } finally {
      setExpenseSavePending(false);
    }
  };

  const handleStock = async (type) => {
    const amount = parseInt(stockChange);
    if (!amount || amount <= 0) return toast.error('Cantidad inválida');
    const selectedWarehouse = warehouses.find(w => w.id === stockWarehouse);
    if (!selectedWarehouse) return toast.error('Selecciona un almacén válido');
    const signedQty = type === 'add' ? amount : -amount;
    try {
      await api.put(`/inventory/warehouse-adjust/${stockModal.id}`, {
        warehouse_id: selectedWarehouse.id,
        quantity_change: signedQty,
        reason: stockReason || (type === 'add' ? 'Ingreso manual' : 'Descuento manual'),
      });
      toast.success(`Stock ${type === 'add' ? 'agregado' : 'reducido'} en ${selectedWarehouse.name}`);
      setStockModal(null); setStockChange(''); setStockReason(''); setStockWarehouse(principalWarehouse?.id || ''); load();
    } catch (err) { toast.error(err.message); }
  };

  const closeStockModal = () => {
    setStockModal(null);
    setStockChange('');
    setStockReason('');
    setStockPurchasePrice('');
    setShowDeleteFlow(false);
    setDeleteReason('');
  };

  const handleSavePurchasePrice = async () => {
    if (!stockModal?.id) return;
    const raw = String(stockPurchasePrice ?? '').trim();
    try {
      await api.put(`/products/${stockModal.id}`, {
        purchase_price: raw === '' ? null : parseFloat(raw),
      });
      toast.success('Precio de compra actualizado');
      closeStockModal();
      load();
    } catch (err) {
      toast.error(err.message || 'No se pudo guardar el precio de compra');
    }
  };

  const handleDeleteProductFromAdjust = async () => {
    if (!stockModal) return;
    const reason = (deleteReason || '').trim();
    if (!reason) return;
    try {
      await api.delete(`/products/${stockModal.id}`);
      closeStockModal();
      load();
    } catch {}
  };

  const handleCreateItem = async (e) => {
    e.preventDefault();
    try {
      const initialStock = parseInt(itemForm.stock || '0') || 0;
      const selectedWarehouseId = itemForm.stock_warehouse;

      const rawPurchase = String(itemForm.purchase_price ?? '').trim();
      const created = await api.post('/products', {
        name: itemForm.name,
        description: buildWarehouseDescription(itemForm.description, 'non_transformed', initialStock, 0),
        price: parseFloat(itemForm.price || '0'),
        purchase_price: rawPurchase === '' ? null : parseFloat(rawPurchase),
        stock: 0,
        category_id: itemForm.category_id || null,
        process_type: 'non_transformed',
        stock_warehouse_id: selectedWarehouseId || '',
        note_required: Number(itemForm.note_required || 0) === 1 ? 1 : 0,
      });

      if (selectedWarehouseId) {
        await api.post('/inventory/warehouse-stock', {
          product_id: created.id,
          warehouse_id: selectedWarehouseId,
          quantity: initialStock,
        });
      }
      toast.success('Producto creado');
      if (createModalAfterReception) {
        setCreateModalAfterReception(false);
        setReceptionExtraLines((prev) => [
          ...prev,
          {
            lineId: `rx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            lineKind: 'product',
            product_id: created.id,
            product_name: created.name || itemForm.name,
            warehouse_id: String(selectedWarehouseId || principalWarehouse?.id || ''),
            quantity: '1',
            unit_cost: String(
              parseFloat(itemForm.purchase_price || itemForm.price || '0') || 0
            ),
          },
        ]);
      }
      setShowCreateModal(false);
      setItemForm({
        name: '',
        description: '',
        price: '',
        purchase_price: '',
        stock: '0',
        category_id: '',
        stock_warehouse: getDefaultCreateWarehouseId(),
        note_required: 0,
      });
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleCreateWarehouse = async (e) => {
    e.preventDefault();
    if (!warehouseForm.name.trim()) return toast.error('Ingresa nombre de almacén');
    try {
      await api.post('/inventory/warehouses', {
        name: warehouseForm.name.trim(),
        description: warehouseForm.description,
        linked_insumos: !!warehouseForm.linkedInsumos,
      });
      toast.success('Almacén creado');
      setShowWarehouseModal(false);
      setWarehouseForm({ name: '', description: '', linkedInsumos: false });
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDeleteInsumo = async (insumo) => {
    if (!insumo?.id) return;
    if (!confirm(`¿Eliminar insumo "${insumo.nombre}"?`)) return;
    try {
      await api.delete(`/kardex-inventory/insumos/${insumo.id}`);
      toast.success('Insumo eliminado');
      await load();
    } catch (err) {
      toast.error(err.message || 'No se pudo eliminar el insumo');
    }
  };

  const handleDeleteWarehouse = async (warehouse) => {
    if (!warehouse) return;
    if ((warehouseUsageMap[warehouse.id] || 0) > 0) {
      return toast.error('No se puede eliminar: el almacén tiene productos con stock');
    }
    if (!confirm(`¿Eliminar almacén "${warehouse.name}"?`)) return;
    try {
      await api.delete(`/inventory/warehouses/${warehouse.id}`);
      toast.success('Almacén eliminado');
      if (stockWarehouse === warehouse.id) {
        setStockWarehouse(principalWarehouse?.id || '');
      }
      if (itemForm.stock_warehouse === warehouse.id) {
        setItemForm(prev => ({ ...prev, stock_warehouse: principalWarehouse?.id || '' }));
      }
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const openNewRequirement = () => {
    if (!lowStockGlobal.length) {
      toast('No hay productos con stock bajo');
      return;
    }
    setSelectedRequirementIds(lowStockGlobal.map(p => p.id));
    setShowRequirementModal(true);
  };

  const toggleRequirementItem = (productId) => {
    setSelectedRequirementIds(prev => (
      prev.includes(productId)
        ? prev.filter(id => id !== productId)
        : [...prev, productId]
    ));
  };

  const downloadRequirementTemplate = async () => {
    if (!selectedRequirementIds.length) {
      toast.error('Selecciona al menos un producto');
      return;
    }
    try {
      const pIds = selectedRequirementIds.filter((id) => {
        const row = lowStockGlobal.find((x) => x.id === id);
        return row && !row.isKardex;
      });
      const inIds = selectedRequirementIds.filter((id) => {
        const row = lowStockGlobal.find((x) => x.id === id);
        return row && row.isKardex;
      });
      const requirement = await api.post('/inventory/requirements/low-stock', {
        product_ids: pIds,
        insumo_ids: inIds,
      });
      setLatestRequirement(requirement);
      const nextForm = {};
      (requirement.items || []).forEach(item => {
        nextForm[item.product_id] = {
          quantity: String(Number(item.suggested_qty || 0)),
          unit_cost: '0',
          warehouse_id: item.warehouse_id || '',
        };
      });
      setReceptionForm(nextForm);
      setReceptionSelectedKeys((requirement.items || []).map((item) => receptionReqKey(item.product_id)));

      const rows = (requirement.items || []).map((p) => {
        const suggested = Math.max(0, Number(p.suggested_qty || 0));
        return [
          p.product_name || '',
          p.category_name || 'Sin categoría',
          String(Number(p.current_stock || 0)),
          '20',
          String(suggested),
          String(Number(p.price || 0)),
          '',
        ];
      });
      const header = [
        'Producto',
        'Categoría',
        'Stock actual',
        'Stock mínimo sugerido',
        'Cantidad sugerida',
        'Precio unitario',
        'Observación',
      ];
      const escapeCsv = (value) => `"${String(value || '').replace(/"/g, '""')}"`;
      const csvContent = [header, ...rows]
        .map(cols => cols.map(escapeCsv).join(','))
        .join('\n');
      const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
      const date = new Date().toISOString().slice(0, 10);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `requerimiento-stock-bajo-${date}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
      setShowRequirementModal(false);
      toast.success('Plantilla descargada y requerimiento guardado');
    } catch (err) {
      toast.error(err.message || 'No se pudo generar requerimiento');
    }
  };

  const updateReceptionField = (productId, field, value) => {
    setReceptionForm(prev => ({
      ...prev,
      [productId]: {
        ...(prev[productId] || {}),
        [field]: value,
      },
    }));
  };

  const registerReception = async () => {
    if (!latestRequirement?.id) {
      toast.error('No hay requerimiento disponible');
      return;
    }
    const seenExtra = new Set();
    for (const line of receptionExtraLines) {
      if (receptionRequirementIds.has(line.product_id)) {
        toast.error(`"${line.product_name}" ya está en el requerimiento; ajusta esa fila.`);
        return;
      }
      if (seenExtra.has(line.product_id)) {
        toast.error('Hay productos adicionales duplicados; elimina la fila repetida.');
        return;
      }
      seenExtra.add(line.product_id);
    }

    const payloadFromReq = (latestRequirement.items || [])
      .filter((item) => isReceptionRowSelected(receptionReqKey(item.product_id)))
      .map(item => {
        const draft = receptionForm[item.product_id] || {};
        return {
          product_id: item.product_id,
          warehouse_id: draft.warehouse_id || item.warehouse_id || '',
          quantity: Number(draft.quantity || 0),
          unit_cost: Number(draft.unit_cost || 0),
        };
      })
      .filter(item => item.quantity > 0);

    const payloadExtra = receptionExtraLines
      .filter((line) => isReceptionRowSelected(receptionExtraKey(line.lineId)))
      .map((line) => ({
      product_id: line.product_id,
      warehouse_id: line.warehouse_id || principalWarehouse?.id || '',
      quantity: Number(line.quantity || 0),
      unit_cost: Number(line.unit_cost || 0),
    })).filter((item) => item.quantity > 0);

    const payloadItems = [...payloadFromReq, ...payloadExtra];

    if (!payloadItems.length) {
      toast.error('Selecciona al menos un producto e ingresa cantidades para recepcionar');
      return;
    }
    const invalidCost = payloadItems.some(item => Number(item.unit_cost || 0) <= 0);
    if (invalidCost) {
      toast.error('Debes colocar el precio de compra en todos los productos recepcionados');
      return;
    }

    try {
      await api.post('/inventory/receptions/receive', {
        requirement_id: latestRequirement.id,
        notes: receptionNotes,
        items: payloadItems,
      });
      toast.success('Recepción registrada');
      setReceptionNotes('');
      setReceptionExtraLines([]);
      const [requirement, expenses] = await Promise.all([
        api.get('/inventory/requirements/latest?status=pending'),
        api.get('/inventory/expenses'),
      ]);
      setLatestRequirement(requirement);
      const nextForm = {};
      (requirement?.items || []).forEach((item) => {
        nextForm[item.product_id] = {
          quantity: String(Number(item.suggested_qty || 0)),
          unit_cost: String(Number(item.unit_cost || 0)),
          warehouse_id: item.warehouse_id || '',
        };
      });
      setReceptionForm(nextForm);
      setReceptionSelectedKeys((requirement?.items || []).map((item) => receptionReqKey(item.product_id)));
      setExpenseHistory(expenses || []);
      await load();
    } catch (err) {
      toast.error(err.message || 'No se pudo registrar recepción');
    }
  };

  const openReceptionAddModal = () => {
    if (!latestRequirement?.items?.length) {
      toast.error('No hay requerimiento pendiente. Cree uno en Requerimiento.');
      return;
    }
    setReceptionAddDraft({
      pickValue: '',
      warehouse_id: String(principalWarehouse?.id || warehouses[0]?.id || ''),
      quantity: '1',
      unit_cost: '0',
    });
    setShowReceptionAddModal(true);
  };

  const confirmReceptionAddLine = () => {
    const raw = receptionAddDraft.pickValue;
    if (!raw || !String(raw).includes(':')) return toast.error('Selecciona un producto o insumo');
    const [kind, ...rest] = String(raw).split(':');
    const pid = rest.join(':');
    if (!pid) return toast.error('Selección inválida');
    const lineKind = kind === 'i' ? 'insumo' : 'product';
    const qty = Number(receptionAddDraft.quantity || 0);
    const cost = Number(receptionAddDraft.unit_cost || 0);
    if (qty <= 0) return toast.error('La cantidad debe ser mayor a 0');
    if (cost <= 0) return toast.error('Indica el costo de compra unitario');
    if (receptionRequirementIds.has(pid)) {
      return toast.error('Este ítem ya está en el requerimiento');
    }
    if (receptionExtraLines.some((l) => l.product_id === pid)) {
      return toast.error('Este ítem ya está en la lista adicional');
    }
    let label = 'Producto';
    if (lineKind === 'insumo') {
      label = kardexInsumos.find((k) => k.id === pid)?.nombre || 'Insumo';
    } else {
      label = products.find((p) => p.id === pid)?.name || 'Producto';
    }
    const newLineId = `rx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setReceptionExtraLines((prev) => [
      ...prev,
      {
        lineId: newLineId,
        lineKind,
        product_id: pid,
        product_name: label,
        warehouse_id: String(receptionAddDraft.warehouse_id || principalWarehouse?.id || ''),
        quantity: String(qty),
        unit_cost: String(cost),
      },
    ]);
    setReceptionSelectedKeys((prev) => [...prev, receptionExtraKey(newLineId)]);
    setShowReceptionAddModal(false);
  };

  const updateReceptionExtraField = (lineId, field, value) => {
    setReceptionExtraLines((prev) =>
      prev.map((line) => (line.lineId === lineId ? { ...line, [field]: value } : line))
    );
  };

  const removeReceptionExtraLine = (lineId) => {
    setReceptionExtraLines((prev) => prev.filter((l) => l.lineId !== lineId));
    setReceptionSelectedKeys((prev) => prev.filter((k) => k !== receptionExtraKey(lineId)));
  };

  const calcReceptionTotal = (productId) => {
    const row = receptionForm[productId] || {};
    const qty = Number(row.quantity || 0);
    const cost = Number(row.unit_cost || 0);
    return qty * cost;
  };

  if (loading) return <div className="flex justify-center py-16"><div className="animate-spin w-8 h-8 border-4 border-gold-500 border-t-transparent rounded-full" /></div>;
  const activeViewLabel = almacenViewsForPlan.find(option => option.id === activeView)?.label || 'Movimiento interno';

  if (activeView !== 'movimiento_interno') {
    return (
      <>
      <div>
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-2xl font-bold text-[var(--ui-body-text)]">Almacenes e Inventario · {activeViewLabel}</h1>
        </div>

        {activeView === 'requerimiento' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
            <h3 className="font-bold rf-section-title mb-2">Requerimiento interno</h3>
            <p className="ui-text-muted mb-4">Nuevo requerimiento tomará todos los productos con stock bajo para descargar plantilla en Excel.</p>
            <button className="btn-primary" onClick={openNewRequirement}>
              Nuevo requerimiento
            </button>
          </div>
        )}

        {activeView === 'recepcion' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
            <h3 className="font-bold rf-section-title mb-2">Recepción de mercadería</h3>
            <p className="ui-text-muted mb-4">
              Se usa el último requerimiento descargado. Ingresa cantidad y costo para recepcionar compra.
              Puedes <strong>agregar productos adicionales</strong> no incluidos en el requerimiento (existente o nuevo).
            </p>
            {!latestRequirement?.items?.length ? (
              <div className="text-sm ui-text-muted bg-slate-50 border border-slate-200 rounded-lg p-4">
                No hay requerimientos descargados. Primero crea uno en Requerimiento.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="text-xs ui-text-muted">
                  Requerimiento: <strong>{latestRequirement.id?.slice(0, 8)}</strong> · Estado: <strong>{latestRequirement.status}</strong>
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                  <button type="button" className="btn-secondary text-sm flex items-center gap-1" onClick={openReceptionAddModal}>
                    <MdAdd className="text-lg" /> Agregar producto adicional
                  </button>
                  <button type="button" className="btn-secondary text-sm" onClick={selectAllReceptionRows}>
                    Seleccionar todo
                  </button>
                  <button type="button" className="btn-secondary text-sm" onClick={deselectAllReceptionRows}>
                    Deseleccionar todo
                  </button>
                  <span className="text-xs ui-text-muted">
                    {receptionSelectedKeys.length} de {allReceptionRowKeys.length} seleccionado(s)
                  </span>
                </div>
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="text-left p-2.5 font-medium w-12">
                          <input
                            type="checkbox"
                            checked={allReceptionRowKeys.length > 0 && receptionSelectedKeys.length === allReceptionRowKeys.length}
                            onChange={(e) => (e.target.checked ? selectAllReceptionRows() : deselectAllReceptionRows())}
                            title="Seleccionar todo"
                          />
                        </th>
                        <th className="text-left p-2.5 font-medium">Producto</th>
                        <th className="text-left p-2.5 font-medium">Stock</th>
                        <th className="text-left p-2.5 font-medium">Almacén</th>
                        <th className="text-left p-2.5 font-medium">Cantidad compra</th>
                        <th className="text-left p-2.5 font-medium">Costo compra</th>
                        <th className="text-left p-2.5 font-medium">Total</th>
                        <th className="text-left p-2.5 font-medium w-24"> </th>
                      </tr>
                    </thead>
                    <tbody>
                      {latestRequirement.items.map(item => (
                        <tr key={item.id} className={`border-b border-slate-100 ${!isReceptionRowSelected(receptionReqKey(item.product_id)) ? 'opacity-50' : ''}`}>
                          <td className="p-2.5">
                            <input
                              type="checkbox"
                              checked={isReceptionRowSelected(receptionReqKey(item.product_id))}
                              onChange={() => toggleReceptionRow(receptionReqKey(item.product_id))}
                            />
                          </td>
                          <td className="p-2.5 font-medium text-slate-700">{item.product_name}</td>
                          <td className="p-2.5 text-red-600 font-semibold">{item.current_stock}</td>
                          <td className="p-2.5 text-[var(--ui-muted)]">{item.warehouse_name || '-'}</td>
                          <td className="p-2.5">
                            <input
                              type="number"
                              min="0"
                              value={receptionForm[item.product_id]?.quantity || '0'}
                              onChange={e => updateReceptionField(item.product_id, 'quantity', e.target.value)}
                              className="input-field py-1.5"
                            />
                          </td>
                          <td className="p-2.5">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={receptionForm[item.product_id]?.unit_cost || '0'}
                              onChange={e => updateReceptionField(item.product_id, 'unit_cost', e.target.value)}
                              className="input-field py-1.5"
                            />
                          </td>
                          <td className="p-2.5 font-semibold text-slate-700">{formatCurrency(calcReceptionTotal(item.product_id))}</td>
                          <td className="p-2.5" />
                        </tr>
                      ))}
                      {receptionExtraLines.map((line) => (
                        <tr key={line.lineId} className={`border-b border-slate-100 bg-sky-50/40 ${!isReceptionRowSelected(receptionExtraKey(line.lineId)) ? 'opacity-50' : ''}`}>
                          <td className="p-2.5">
                            <input
                              type="checkbox"
                              checked={isReceptionRowSelected(receptionExtraKey(line.lineId))}
                              onChange={() => toggleReceptionRow(receptionExtraKey(line.lineId))}
                            />
                          </td>
                          <td className="p-2.5 font-medium text-slate-800">
                            {line.product_name}
                            <span className="ml-2 text-[10px] uppercase tracking-wide text-sky-700 font-semibold">Adicional</span>
                          </td>
                          <td className="p-2.5 text-sky-600 font-semibold">
                            {line.lineKind === 'insumo'
                              ? (() => {
                                  const k = kardexInsumos.find((x) => x.id === line.product_id);
                                  if (!k) return '—';
                                  return formatInsumoWithUnit(k.stock_actual, insumoUnidadMedidaDisplay(k));
                                })()
                              : (products.find((p) => p.id === line.product_id)?.stock ?? '—')}
                          </td>
                          <td className="p-2.5 text-[var(--ui-muted)]">
                            <select
                              className="input-field py-1.5 text-sm"
                              value={line.warehouse_id}
                              onChange={(e) => updateReceptionExtraField(line.lineId, 'warehouse_id', e.target.value)}
                            >
                              {warehouses.map((w) => (
                                <option key={w.id} value={w.id}>{w.name}</option>
                              ))}
                            </select>
                          </td>
                          <td className="p-2.5">
                            <input
                              type="number"
                              min="0"
                              value={line.quantity}
                              onChange={(e) => updateReceptionExtraField(line.lineId, 'quantity', e.target.value)}
                              className="input-field py-1.5"
                            />
                          </td>
                          <td className="p-2.5">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={line.unit_cost}
                              onChange={(e) => updateReceptionExtraField(line.lineId, 'unit_cost', e.target.value)}
                              className="input-field py-1.5"
                            />
                          </td>
                          <td className="p-2.5 font-semibold text-slate-700">
                            {formatCurrency((Number(line.quantity || 0)) * (Number(line.unit_cost || 0)))}
                          </td>
                          <td className="p-2.5">
                            <button
                              type="button"
                              className="text-xs text-red-600 hover:underline"
                              onClick={() => removeReceptionExtraLine(line.lineId)}
                            >
                              Quitar
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Notas</label>
                  <input
                    value={receptionNotes}
                    onChange={e => setReceptionNotes(e.target.value)}
                    className="input-field"
                    placeholder="Observaciones de compra (opcional)"
                  />
                </div>
                <button className="btn-primary" onClick={registerReception}>
                  Registrar recepción
                </button>
              </div>
            )}
          </div>
        )}

        {activeView === 'ir_modulo_gastos' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
            <h3 className="font-bold rf-section-title mb-2">Módulo de gastos</h3>
            <p className="ui-text-muted mb-4">
              Gastos separados por compra, con fecha y detalle de productos recepcionados.
              Para guardar cambios se solicita la contraseña de un usuario administrador.
            </p>
            <div className="space-y-4">
              {expenseGroups.length === 0 && (
                <p className="text-sm ui-text-muted">Aún no hay gastos registrados.</p>
              )}
              {expenseGroups.map(group => {
                const isEditing = expenseEditGroupId === group.id;
                const displayTotal = isEditing ? expenseEditDraftTotal(group) : group.total;
                return (
                <div key={group.id} className="border border-slate-200 rounded-xl p-4 bg-slate-50/60">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <p className="font-semibold rf-section-title">
                      Compra {group.requirement_id ? `· Req ${group.requirement_id.slice(0, 8)}` : ''}
                    </p>
                    <div className="flex items-center gap-2 shrink-0">
                      <p className="text-xs ui-text-muted">{formatDateTime(group.created_at)}</p>
                      {!isEditing ? (
                        <button
                          type="button"
                          onClick={() => startExpenseGroupEdit(group)}
                          className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-slate-200 text-slate-800 hover:bg-slate-300"
                        >
                          <MdEdit className="text-sm" /> Editar
                        </button>
                      ) : (
                        <>
                          <button type="button" onClick={cancelExpenseGroupEdit} className="text-xs px-2.5 py-1.5 rounded-lg btn-secondary">
                            Cancelar
                          </button>
                          <button type="button" onClick={() => requestSaveExpenseGroup(group)} className="text-xs px-2.5 py-1.5 rounded-lg btn-primary">
                            Guardar
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {isEditing ? (
                    <div className="mb-3">
                      <label className="block text-xs font-medium text-[var(--ui-muted)] mb-1">Notas de la compra</label>
                      <input
                        className="input-field text-sm py-1.5"
                        value={expenseEditNotes}
                        onChange={(e) => setExpenseEditNotes(e.target.value)}
                        placeholder="Observaciones (opcional)"
                      />
                    </div>
                  ) : group.notes ? (
                    <p className="text-xs ui-text-muted mb-2">{group.notes}</p>
                  ) : null}
                  <div className="grid grid-cols-12 text-xs ui-text-muted border-b border-slate-200 pb-1 mb-1.5">
                    <div className="col-span-7">Lista de productos</div>
                    <div className="col-span-3 text-right">Precio por unidad</div>
                    <div className="col-span-2 text-right">Cantidad comprada</div>
                  </div>
                  <div className="space-y-1.5">
                    {group.items.map(item => (
                      <div key={item.id} className="text-sm grid grid-cols-12 items-center gap-1 border-b border-slate-200/70 pb-1">
                        <span className="col-span-7 text-slate-700">{item.product_name || 'Producto'}</span>
                        {isEditing ? (
                          <>
                            <div className="col-span-3">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                className="input-field py-1 text-sm text-right"
                                value={expenseEditDraft[item.id]?.unit_cost ?? ''}
                                onChange={(e) => setExpenseEditDraft((prev) => ({
                                  ...prev,
                                  [item.id]: { ...prev[item.id], unit_cost: e.target.value },
                                }))}
                              />
                            </div>
                            <div className="col-span-2">
                              <input
                                type="number"
                                min="0"
                                step="1"
                                className="input-field py-1 text-sm text-right"
                                value={expenseEditDraft[item.id]?.quantity ?? ''}
                                onChange={(e) => setExpenseEditDraft((prev) => ({
                                  ...prev,
                                  [item.id]: { ...prev[item.id], quantity: e.target.value },
                                }))}
                              />
                            </div>
                          </>
                        ) : (
                          <>
                            <span className="col-span-3 text-right text-slate-700">{formatCurrency(item.unit_cost)}</span>
                            <span className="col-span-2 text-right text-slate-700">{item.quantity}</span>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex justify-end">
                    <p className="font-bold text-red-700">Total compra: {formatCurrency(displayTotal)}</p>
                  </div>
                </div>
              );
              })}
            </div>
          </div>
        )}

        <Modal
          isOpen={showExpensePasswordModal}
          onClose={() => {
            if (expenseSavePending) return;
            setShowExpensePasswordModal(false);
            setExpenseAdminPassword('');
          }}
          title="Confirmar con contraseña admin"
          size="sm"
        >
          <div className="space-y-4">
            <p className="text-sm text-[var(--ui-muted)]">
              Ingresa la contraseña de un usuario <strong>administrador</strong> para guardar los cambios en este gasto.
            </p>
            <input
              type="password"
              className="input-field"
              value={expenseAdminPassword}
              onChange={(e) => setExpenseAdminPassword(e.target.value)}
              placeholder="Contraseña de administrador"
              autoComplete="current-password"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const group = expenseGroups.find((g) => g.id === expenseEditGroupId);
                  if (group) void saveExpenseGroupEdit(group);
                }
              }}
            />
            <div className="flex gap-3">
              <button
                type="button"
                className="btn-secondary flex-1"
                disabled={expenseSavePending}
                onClick={() => {
                  setShowExpensePasswordModal(false);
                  setExpenseAdminPassword('');
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary flex-1"
                disabled={expenseSavePending}
                onClick={() => {
                  const group = expenseGroups.find((g) => g.id === expenseEditGroupId);
                  if (group) void saveExpenseGroupEdit(group);
                }}
              >
                {expenseSavePending ? 'Guardando…' : 'Confirmar y guardar'}
              </button>
            </div>
          </div>
        </Modal>

        {activeView === 'ir_modulo_logistica' && <LogisticaKardexModule />}
        <CreateProductModal
          isOpen={showCreateModal}
          onClose={() => {
            setShowCreateModal(false);
            setCreateModalAfterReception(false);
          }}
          itemForm={itemForm}
          setItemForm={setItemForm}
          categoryOptionsForCreate={categoryOptionsForCreate}
          getCategoryIdByType={getCategoryIdByType}
          warehouses={warehouses}
          handleCreateItem={handleCreateItem}
        />
        <Modal
          isOpen={showReceptionAddModal}
          onClose={() => setShowReceptionAddModal(false)}
          title="Producto adicional (fuera del requerimiento)"
          size="md"
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Almacén de ingreso</label>
              <select
                className="input-field"
                value={receptionAddDraft.warehouse_id}
                onChange={(e) =>
                  setReceptionAddDraft((d) => ({
                    ...d,
                    warehouse_id: e.target.value,
                    pickValue: '',
                  }))
                }
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Producto o insumo</label>
              <select
                className="input-field"
                value={receptionAddDraft.pickValue}
                onChange={(e) => setReceptionAddDraft((d) => ({ ...d, pickValue: e.target.value }))}
              >
                <option value="">— Seleccionar —</option>
                {receptionPickProducts.length > 0 && (
                  <optgroup label="Productos de almacén (unidades)">
                    {receptionPickProducts.map((p) => (
                      <option key={`p-${p.id}`} value={`p:${p.id}`}>{p.name}</option>
                    ))}
                  </optgroup>
                )}
                {receptionPickInsumos.length > 0 && (
                  <optgroup label="Insumos kardex (kg/L, unidades)">
                    {receptionPickInsumos.map((ins) => (
                      <option key={`i-${ins.id}`} value={`i:${ins.id}`}>{ins.nombre}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              {receptionPickListEmpty && (
                <p className="text-xs text-amber-700 mt-1">
                  No quedan ítems disponibles (o ya están todos en el requerimiento). Use «Crear producto nuevo» para un artículo de almacén nuevo.
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Cantidad</label>
                <input
                  type="number"
                  min="0"
                  className="input-field"
                  value={receptionAddDraft.quantity}
                  onChange={(e) => setReceptionAddDraft((d) => ({ ...d, quantity: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Costo unitario</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="input-field"
                  value={receptionAddDraft.unit_cost}
                  onChange={(e) => setReceptionAddDraft((d) => ({ ...d, unit_cost: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <button
                type="button"
                className="btn-secondary text-sm"
                onClick={() => {
                  setShowReceptionAddModal(false);
                  setItemForm((prev) => ({
                    ...prev,
                    stock_warehouse: String(
                      receptionAddDraft.warehouse_id || principalWarehouse?.id || getDefaultCreateWarehouseId()
                    ),
                  }));
                  setCreateModalAfterReception(true);
                  setShowCreateModal(true);
                }}
              >
                Crear producto nuevo…
              </button>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" className="btn-secondary flex-1" onClick={() => setShowReceptionAddModal(false)}>
                Cancelar
              </button>
              <button type="button" className="btn-primary flex-1" onClick={confirmReceptionAddLine}>
                Añadir a la tabla
              </button>
            </div>
          </div>
        </Modal>
        <Modal
          isOpen={showRequirementModal}
          onClose={() => setShowRequirementModal(false)}
          title="Nuevo requerimiento · Stock bajo"
          size="lg"
        >
          <div className="space-y-4">
            <p className="text-sm text-[var(--ui-muted)]">
              Incluye productos de almacén bajo su stock mínimo e <strong>insumos kardex</strong> bajo el mínimo (en U o en kg/L,
              según se configuró al crear el insumo). Puedes desmarcar filas.
            </p>
            <div className="flex flex-wrap gap-2 items-center mb-2">
              <button
                type="button"
                className="btn-secondary text-sm"
                onClick={() => setSelectedRequirementIds(lowStockGlobal.map((p) => p.id))}
              >
                Seleccionar todo
              </button>
              <button
                type="button"
                className="btn-secondary text-sm"
                onClick={() => setSelectedRequirementIds([])}
              >
                Deseleccionar todo
              </button>
            </div>
            <div className="max-h-[340px] overflow-y-auto border border-slate-200 rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left p-2.5 font-medium">Incluir</th>
                    <th className="text-left p-2.5 font-medium">Producto</th>
                    <th className="text-left p-2.5 font-medium">Categoría</th>
                    <th className="text-left p-2.5 font-medium">Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {lowStockGlobal.map((p) => (
                    <tr key={p.id} className="border-b border-slate-100">
                      <td className="p-2.5">
                        <input
                          type="checkbox"
                          checked={selectedRequirementIds.includes(p.id)}
                          onChange={() => toggleRequirementItem(p.id)}
                        />
                      </td>
                      <td className="p-2.5 font-medium text-slate-700">
                        {p.name}
                        {p.isKardex && <span className="ml-1 text-xs text-amber-700">(Kardex)</span>}
                      </td>
                      <td className="p-2.5 ui-text-muted">
                        {p.isKardex ? 'Kardex insumos' : (p.category_name || 'Sin categoría')}
                      </td>
                      <td className="p-2.5 text-red-600 font-semibold">
                        {p.isKardex
                          ? (p.kardexPorU
                            ? `${p.stock} U (mín. ${p.minimo} U)`
                            : `${p.stock} ${p.umed} (mín. ${p.minimo} ${p.umed})`)
                          : p.stock}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowRequirementModal(false)}
                className="btn-secondary flex-1"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={downloadRequirementTemplate}
                className="btn-primary flex-1 flex items-center justify-center gap-2"
              >
                <MdDownload /> Descargar plantilla
              </button>
            </div>
          </div>
        </Modal>
      </div>
      </>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-bold text-[var(--ui-body-text)]">Almacenes e Inventario</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setWarehouseForm({ name: '', description: '', linkedInsumos: false });
              setShowWarehouseModal(true);
            }}
            className="btn-secondary flex items-center gap-2 text-sm"
          >
            <MdAdd /> Nuevo almacén
          </button>
          <button
            onClick={() => {
              if (selectedIsInsumosWarehouse) {
                setShowInsumoModal(true);
                return;
              }
              setItemForm(prev => ({
                ...prev,
                category_id: '',
                stock_warehouse: getDefaultCreateWarehouseId(),
                note_required: 0,
              }));
              setShowCreateModal(true);
            }}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            <MdAdd /> Nuevo producto
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        {warehouses.map(w => {
          const linkedProducts = isInsumosWarehouse(w)
            ? insumosActivos.length
            : (warehouseUsageMap[w.id] || 0);
          const canDelete = linkedProducts === 0;
          return (
            <div
              key={w.id}
              onClick={() => setSelectedWarehouseView(String(w.id))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelectedWarehouseView(String(w.id));
                }
              }}
              role="button"
              tabIndex={0}
              className={`bg-white rounded-xl border p-3 flex flex-col min-h-28 text-left transition-colors ${
                sameWarehouseId(selectedWarehouseView, w.id)
                  ? 'border-gold-500 ring-2 ring-gold-200'
                  : 'border-slate-200 hover:border-gold-300'
              }`}
            >
              <p className="font-semibold text-[var(--ui-body-text)]">{w.name}</p>
              {w.description && <p className="text-xs text-[var(--ui-body-text)] mt-1">{w.description}</p>}
              <p className="text-xs text-[var(--ui-body-text)] mt-2">
                {isInsumosWarehouse(w) ? 'Insumos vinculados: ' : 'Productos con stock: '}
                <strong>{linkedProducts}</strong>
              </p>
              <div className="mt-auto flex justify-end">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteWarehouse(w);
                  }}
                  disabled={!canDelete}
                  className={`text-xs px-3 py-1.5 rounded-lg ${
                    canDelete
                      ? 'bg-red-50 text-red-600 hover:bg-red-100'
                      : 'bg-slate-100 text-[var(--ui-muted)] cursor-not-allowed'
                  }`}
                >
                  Eliminar almacén
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-5">
        <div className="card"><p className="text-xs text-[var(--ui-body-text)]">Total Ítems</p><p className="text-xl font-bold text-[var(--ui-body-text)]">{selectedIsInsumosWarehouse ? insumosPorVista.length : productsForSelectedWarehouse.length}</p></div>
        <div className="card"><p className="text-xs text-[var(--ui-body-text)]">Valor del Inventario</p><p className="text-xl font-bold text-emerald-400">{formatCurrency(totalValue)}</p></div>
        <div className="card"><p className="text-xs text-[var(--ui-body-text)]">Inversión de inventario</p><p className="text-xl font-bold text-violet-400">{formatCurrency(totalInventoryInvestment)}</p></div>
        <div className="card"><p className="text-xs text-[var(--ui-body-text)]">Stock Bajo</p><p className="text-xl font-bold text-red-400">{selectedIsInsumosWarehouse ? insumosLowCount : lowStock.length}</p></div>
        <div className="card"><p className="text-xs text-[var(--ui-body-text)]">Unidades Totales</p><p className="text-xl font-bold text-[var(--ui-body-text)]">{selectedIsInsumosWarehouse ? insumosTotalUnits : productsForSelectedWarehouse.reduce((s, p) => s + p.stock, 0)}</p></div>
      </div>
      {lowStock.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-5">
          <p className="font-bold text-red-700 flex items-center gap-2 mb-2"><MdWarning /> Productos con stock bajo</p>
          <div className="flex flex-wrap gap-2">
            {lowStock.map(p => (
              <span key={p.id} className="px-3 py-1 bg-white rounded-full text-sm border border-red-200 text-red-700">{p.name}: <strong>{p.stock}</strong></span>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
        <div className="relative mb-4">
          <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ui-muted)]" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={selectedIsInsumosWarehouse ? 'Buscar insumo…' : 'Buscar producto…'}
            className="input-field pl-9"
          />
        </div>
        {selectedIsInsumosWarehouse && (
          <div className="flex flex-wrap gap-2 mb-4">
            <span className="text-xs ui-text-muted self-center">Ver:</span>
            {[
              { id: 'all', label: 'Todos' },
              { id: 'cocina', label: 'Solo cocina' },
              { id: 'bar', label: 'Solo bar' },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setInsumosVistaArea(opt.id)}
                className={`px-3 py-1 rounded-lg text-xs font-medium border ${
                  insumosVistaArea === opt.id
                    ? 'bg-sky-600 text-white border-sky-600'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-sky-300'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
        {selectedIsInsumosWarehouse ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-[color:var(--ui-border)]">
                <th className="pb-2 font-medium text-[var(--ui-body-text)]">Insumo</th>
                <th className="pb-2 font-medium text-[var(--ui-body-text)]">U.M.</th>
                <th className="pb-2 font-medium text-[var(--ui-body-text)]">Costo prom.</th>
                <th className="pb-2 font-medium text-right text-[var(--ui-body-text)]">Stock (kg/L)</th>
                <th className="pb-2 font-medium text-right text-[var(--ui-body-text)]">Stock (U)</th>
                <th className="pb-2 font-medium text-right text-[var(--ui-body-text)]">Valor</th>
                <th className="pb-2 font-medium text-[var(--ui-body-text)]">Estado</th>
                <th className="pb-2 font-medium text-right text-[var(--ui-body-text)] w-28"></th>
              </tr>
            </thead>
            <tbody>
              {insumosTablaFiltrados.map((i) => {
                const um = insumoUnidadMedidaDisplay(i);
                const sAct = Number(i.stock_actual || 0);
                const uAct = Number(i.stock_unidades ?? 0);
                const valor = sAct * Number(i.costo_promedio || 0);
                const est = insumoEstadoStock(i);
                const badgeClass =
                  est === 'normal'
                    ? UI_BADGE.emerald
                    : est === 'bajo'
                      ? UI_BADGE.amber
                      : UI_BADGE.red;
                const badgeLabel = est === 'normal' ? 'Normal' : est === 'bajo' ? 'Bajo' : 'Agotado';
                return (
                  <tr key={i.id} className="border-b border-slate-600/30">
                    <td className="py-3 font-medium text-[var(--ui-body-text)]">
                      <span
                        className={`mr-2 ${
                          String(i.insumo_area || 'cocina').toLowerCase() === 'bar'
                            ? UI_BADGE.indigo
                            : UI_BADGE.sky
                        } text-[10px] uppercase tracking-wide`}
                      >
                        {String(i.insumo_area || 'cocina').toLowerCase() === 'bar' ? 'Bar' : 'Cocina'}
                      </span>
                      {i.nombre}
                    </td>
                    <td className="py-3 text-[var(--ui-body-text)]">{um}</td>
                    <td className="py-3 text-[var(--ui-body-text)] tabular-nums">{formatCurrency(Number(i.costo_promedio || 0))}</td>
                    <td className="py-3 text-right text-[var(--ui-body-text)] tabular-nums">
                      {formatInsumoWithUnit(sAct, um)}
                    </td>
                    <td className="py-3 text-right text-[var(--ui-body-text)] tabular-nums">
                      {Number(i.kg_por_unidad || 0) > 1e-12 ? `${formatInsumoQty(uAct)} U` : '—'}
                    </td>
                    <td className="py-3 text-right text-[var(--ui-body-text)] tabular-nums">{formatCurrency(valor)}</td>
                    <td className="py-3">
                      <span className={badgeClass}>{badgeLabel}</span>
                    </td>
                    <td className="py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleDeleteInsumo(i)}
                        className="text-xs px-2.5 py-1.5 rounded-lg border border-red-500/40 text-red-300 hover:bg-red-500/15 inline-flex items-center gap-1"
                        title="Eliminar insumo"
                      >
                        <MdDeleteOutline className="text-base" />
                        Eliminar
                      </button>
                    </td>
                  </tr>
                );
              })}
              {insumosTablaFiltrados.length === 0 && (
                <tr>
                  <td colSpan="8" className="py-10 text-center text-[#9CA3AF]">
                    {insumosPorVista.length === 0 ? 'No hay insumos activos en esta vista' : 'Sin resultados'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left ui-text-muted border-b">
                <th className="pb-2 font-medium">Producto</th>
                <th className="pb-2 font-medium">Tipo</th>
                <th className="pb-2 font-medium">Precio venta</th>
                <th className="pb-2 font-medium">P. compra</th>
                <th className="pb-2 font-medium">Principal</th>
                <th className="pb-2 font-medium">Cocina</th>
                <th className="pb-2 font-medium">Stock Total</th>
                <th className="pb-2 font-medium">Valor</th>
                <th className="pb-2 font-medium">Estado</th>
                <th className="pb-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {productsForSelectedWarehouse.map(p => (
                <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-3 font-medium">{p.name}</td>
                  <td className="py-3 ui-text-muted">{p.category_name || '-'}</td>
                  <td className="py-3">{formatCurrency(p.price)}</td>
                  <td className="py-3 text-[var(--ui-muted)]">
                    {p.purchase_price != null && Number(p.purchase_price) > 0
                      ? formatCurrency(p.purchase_price)
                      : '—'}
                  </td>
                  <td className="py-3 font-bold">{p.stock_main || 0}</td>
                  <td className="py-3 font-bold">{p.stock_kitchen || 0}</td>
                  <td className="py-3 font-bold">{p.stock}</td>
                  <td className="py-3">{formatCurrency(p.price * p.stock)}</td>
                  <td className="py-3"><span className={
                    productStockStatus(p.stock, p.min_stock) === 'normal'
                      ? UI_BADGE.emerald
                      : productStockStatus(p.stock, p.min_stock) === 'low'
                        ? UI_BADGE.amber
                        : UI_BADGE.red
                  }>{productStockStatus(p.stock, p.min_stock) === 'normal' ? 'Normal' : productStockStatus(p.stock, p.min_stock) === 'low' ? 'Bajo' : 'Agotado'}</span></td>
                  <td className="py-3">
                    <button
                      type="button"
                      onClick={() => {
                        setStockModal(p);
                        setStockPurchasePrice(
                          p.purchase_price != null && Number(p.purchase_price) > 0
                            ? String(p.purchase_price)
                            : ''
                        );
                        setStockWarehouse(principalWarehouse?.id || '');
                        setShowDeleteFlow(false);
                        setDeleteReason('');
                      }}
                      className="text-xs px-3 py-1.5 bg-sky-50 text-sky-600 rounded-lg hover:bg-sky-100"
                    >
                      Ajustar
                    </button>
                  </td>
                </tr>
              ))}
              {productsForSelectedWarehouse.length === 0 && (
                <tr>
                  <td colSpan="10" className="py-10 text-center text-[var(--ui-muted)]">
                    {selectedWarehouseView
                      ? 'No hay productos en este almacén'
                      : 'Selecciona un almacén para ver sus productos'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <Modal isOpen={!!stockModal} onClose={closeStockModal} title={`Ajustar Stock - ${stockModal?.name}`} size="sm">
        <div className="space-y-4">
          <div className="text-sm ui-text-muted space-y-1">
            <p>Stock total: <strong>{stockModal?.stock}</strong> unidades</p>
            <p>Almacén principal: <strong>{stockModal?.stock_main || 0}</strong></p>
            <p>Almacén cocina: <strong>{stockModal?.stock_kitchen || 0}</strong></p>
          </div>
          <div><label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Cantidad</label><input type="number" min="1" value={stockChange} onChange={e => setStockChange(e.target.value)} className="input-field" placeholder="0" /></div>
          <div>
            <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Almacén</label>
            <select value={stockWarehouse} onChange={e => setStockWarehouse(e.target.value)} className="input-field">
              {warehouses.map(w => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
          <div><label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Motivo</label><input value={stockReason} onChange={e => setStockReason(e.target.value)} className="input-field" placeholder="Motivo del ajuste" /></div>
          <div className="border-t border-[color:var(--ui-border)] pt-4 space-y-2">
            <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Precio de compra (opcional)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={stockPurchasePrice}
              onChange={(e) => setStockPurchasePrice(e.target.value)}
              className="input-field"
              placeholder="Para inversión de inventario"
            />
            <p className="text-xs text-[var(--ui-muted)]">
              Inversión actual: {formatCurrency(productInventoryInvestment(stockModal || {}))}
            </p>
            <button type="button" onClick={() => void handleSavePurchasePrice()} className="btn-secondary w-full">
              Guardar precio de compra
            </button>
          </div>
          <div className="flex gap-3">
            <button onClick={() => handleStock('remove')} className="flex-1 btn-danger flex items-center justify-center gap-1"><MdRemove /> Descontar</button>
            <button onClick={() => handleStock('add')} className="flex-1 btn-success flex items-center justify-center gap-1"><MdAdd /> Agregar</button>
          </div>
          <button
            type="button"
            onClick={() => setShowDeleteFlow(true)}
            className="w-full px-4 py-2.5 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 transition-colors"
          >
            Eliminar producto
          </button>
          {showDeleteFlow && (
            <div className="space-y-3 border border-red-200 bg-red-50 rounded-lg p-3">
              <div>
                <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Motivo de eliminación</label>
                <input
                  value={deleteReason}
                  onChange={e => setDeleteReason(e.target.value)}
                  className="input-field"
                  placeholder="Escribe el motivo"
                />
              </div>
              <button
                type="button"
                onClick={handleDeleteProductFromAdjust}
                disabled={!deleteReason.trim()}
                className={`w-full px-4 py-2.5 rounded-lg font-medium transition-colors ${
                  deleteReason.trim()
                    ? 'bg-red-700 text-white hover:bg-red-800'
                    : 'bg-slate-200 ui-text-muted cursor-not-allowed'
                }`}
              >
                Eliminar
              </button>
            </div>
          )}
        </div>
      </Modal>

      <CreateProductModal
        isOpen={showCreateModal}
        onClose={() => {
          setShowCreateModal(false);
          setCreateModalAfterReception(false);
        }}
        itemForm={itemForm}
        setItemForm={setItemForm}
        categoryOptionsForCreate={categoryOptionsForCreate}
        getCategoryIdByType={getCategoryIdByType}
        warehouses={warehouses}
        handleCreateItem={handleCreateItem}
      />

      <Modal
        isOpen={showWarehouseModal}
        onClose={() => {
          setShowWarehouseModal(false);
          setWarehouseForm({ name: '', description: '', linkedInsumos: false });
        }}
        title="Nuevo almacén"
        size="sm"
      >
        <form onSubmit={handleCreateWarehouse} className="space-y-4 modal-sheet-body">
          <div className="space-y-2">
            <p className="text-sm font-medium text-[var(--ui-body-text)]">Tipo</p>
            <label className="flex items-center gap-2 text-sm text-[var(--ui-body-text)] cursor-pointer">
              <input
                type="radio"
                name="warehouseTipo"
                checked={!warehouseForm.linkedInsumos}
                onChange={() => setWarehouseForm((f) => ({ ...f, linkedInsumos: false }))}
              />
              Solo almacén
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--ui-body-text)] cursor-pointer">
              <input
                type="radio"
                name="warehouseTipo"
                checked={warehouseForm.linkedInsumos}
                onChange={() =>
                  setWarehouseForm((f) => ({
                    ...f,
                    linkedInsumos: true,
                    description: f.description.trim() || 'Almacén vinculado a Inventario y Kardex',
                  }))
                }
              />
              Vinculado a insumos (kardex)
            </label>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Nombre del almacén</label>
            <input
              value={warehouseForm.name}
              onChange={e => setWarehouseForm({ ...warehouseForm, name: e.target.value })}
              className="input-field"
              placeholder="Ej: Almacen Barra"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Descripción</label>
            <textarea
              value={warehouseForm.description}
              onChange={e => setWarehouseForm({ ...warehouseForm, description: e.target.value })}
              className="input-field"
              rows="2"
              placeholder={warehouseForm.linkedInsumos ? 'Almacén vinculado a Inventario y Kardex' : 'Descripción opcional'}
            />
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                setShowWarehouseModal(false);
                setWarehouseForm({ name: '', description: '', linkedInsumos: false });
              }}
              className="btn-secondary flex-1"
            >
              Cancelar
            </button>
            <button type="submit" className="btn-primary flex-1">Crear almacén</button>
          </div>
        </form>
      </Modal>

      <InsumoCreateModal
        isOpen={showInsumoModal}
        onClose={() => setShowInsumoModal(false)}
        onSaved={() => load()}
      />
    </div>
  );
}
