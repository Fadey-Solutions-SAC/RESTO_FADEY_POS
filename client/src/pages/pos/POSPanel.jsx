import { useState, useEffect, useRef, useMemo, useCallback } from 'react';

/** Redondeo a céntimos en soles; evita errores de coma flotante en arqueo vs esperado. */
function roundMoneySoles(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function emptyMultiPaymentAmounts() {
  return { efectivo: '', yape: '', plin: '', tarjeta: '', online: '' };
}

function dominantPaymentFromBreakdown(obj) {
  let best = 'efectivo';
  let bestAmt = -1;
  for (const [k, v] of Object.entries(obj || {})) {
    const a = roundMoneySoles(Number(v) || 0);
    if (a > bestAmt) {
      bestAmt = a;
      best = k;
    }
  }
  return bestAmt > 0 ? best : 'efectivo';
}
import { useSearchParams, useLocation, useNavigate } from 'react-router-dom';
import {
  api,
  checkPrintingHealth,
  electronPrinting,
  formatCurrency,
  formatPeDateTimeLine,
  formatPeDateTimeParts,
  getPaymentMethodOptions,
  orderMultiPaymentOptions,
  hasElectronPrinting,
  normalizeUsbPrinterList,
  PAYMENT_METHODS,
  printingUnreachableMessage,
  resolveMediaUrl,
} from '../../utils/api';
import {
  KITCHEN_TAKEOUT_NOTE,
  orderHasTakeoutNote,
  buildPrecuentaPlainText,
  buildNotaVentaPlainText,
  buildBoletaFacturaPlainText,
  getThermalPrintRevision,
  restaurantThermalBrandLine,
} from '../../utils/ticketPlainText';
import PrinterModulePanel from '../../components/printing/PrinterModulePanel';
import {
  DEFAULT_PRINTING_CONFIG,
  fetchPrintingConfig,
  normalizePaperWidthMm,
} from '../../utils/printingConfig';
import { showStockInOrderingUI } from '../../utils/productStockDisplay';
import {
  mergeOrderingCatalog,
  filterVisibleOrderingProducts,
  buildOrderItemsPayload,
  filterOrderingProducts,
} from '../../utils/orderingCatalog';
import {
  billLineDisplayName,
  billLineKey,
  groupItemsByProductNameForBill,
  getOrderChargeTotal,
  sumOrderItemsChargeSubtotal,
} from '../../utils/mesaOrderLines';

function collectAllOrderItemIds(orders) {
  const ids = [];
  for (const o of orders || []) {
    for (const it of o.items || []) {
      if (it?.id) ids.push(it.id);
    }
  }
  return ids;
}

/** Base imponible para total / descuento en modo dividir por línea (ítems marcados + delivery si el pedido queda entero). */
function computeTableSplitSelectionBase(orders, selectedItemIds) {
  const set = selectedItemIds instanceof Set ? selectedItemIds : new Set(selectedItemIds);
  let lineSum = 0;
  for (const o of orders || []) {
    for (const it of o.items || []) {
      if (set.has(it.id)) lineSum += sumOrderItemsChargeSubtotal([it]);
    }
  }
  let deliveryExtra = 0;
  for (const o of orders || []) {
    const ids = (o.items || []).map((x) => x.id).filter(Boolean);
    if (ids.length && ids.every((id) => set.has(id))) {
      deliveryExtra += Number(o.delivery_fee || 0);
    }
  }
  return lineSum + deliveryExtra;
}

function getOrderItemSubtotalFromOrders(orders, itemId) {
  const sid = String(itemId || '').trim();
  if (!sid) return 0;
  for (const o of orders || []) {
    const it = (o.items || []).find((x) => String(x.id) === sid);
    if (it) return sumOrderItemsChargeSubtotal([it]);
  }
  return 0;
}

function resolveAppliedDiscountBase(orders, selectedOrderItemIds, splitMode, discountConfig, fallbackTotal) {
  if (!discountConfig?.applied) return fallbackTotal;
  if (discountConfig.target !== 'line' || !String(discountConfig.targetOrderItemId || '').trim() || !splitMode) {
    return fallbackTotal;
  }
  const sid = String(discountConfig.targetOrderItemId).trim();
  if (!selectedOrderItemIds.includes(sid)) return fallbackTotal;
  const lineSub = getOrderItemSubtotalFromOrders(orders, sid);
  return lineSub > 0 ? lineSub : fallbackTotal;
}

const EMPTY_DISCOUNT_CONFIG = {
  active: false,
  applied: false,
  type: 'amount',
  value: '',
  reason: '',
  target: 'whole',
  targetOrderItemId: '',
};
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../hooks/useSocket';
import { useActiveInterval } from '../../hooks/useActiveInterval';
import { useStaffOrderCart } from '../../hooks/useStaffOrderCart';
import { useShowDeliveryUi } from '../../hooks/useDeliveryEnabled';
import toast from 'react-hot-toast';
import Modal from '../../components/Modal';
import StaffDineInOrderUI from '../../components/StaffDineInOrderUI';
import StaffMesaPedidoTabs from '../../components/StaffMesaPedidoTabs';
import StaffModifierPromptModal from '../../components/StaffModifierPromptModal';
import PosCustomerPickerModal from '../../components/PosCustomerPickerModal';
import { buildTablesBySalon } from '../../utils/salonesUtils';
import {
  MdPointOfSale, MdTableRestaurant, MdReceipt,
  MdCheckCircle, MdAttachMoney, MdPeople, MdClose,
  MdAccountBalanceWallet, MdTrendingUp, MdTrendingDown,
  MdRestaurantMenu,
  MdAccessTime, MdPersonAdd, MdSearch,
  MdDeliveryDining,
  MdEdit, MdDelete, MdPrint, MdSave,
  MdSwapHoriz, MdMerge,
} from 'react-icons/md';

/** Mesa sintética al cobrar cuenta desde Clientes (no existe fila en `tables`). */
const POS_ADMIN_REGISTER_KEY = 'posAdminRegisterId';

const CLIENT_CHECKOUT_TABLE_PREFIX = 'client-checkout:';
function isClientCheckoutTable(table) {
  return Boolean(table && String(table.id || '').startsWith(CLIENT_CHECKOUT_TABLE_PREFIX));
}

/** Recuadro sintético en caja: un slot por pedido delivery pendiente de cobro (misma UX que mesa). */
const POS_DELIVERY_SLOT_PREFIX = 'pos-delivery-slot:';
function isDeliveryCheckoutTable(table) {
  return Boolean(table && String(table.id || '').startsWith(POS_DELIVERY_SLOT_PREFIX));
}
function deliveryOrderIdFromSlotTable(table) {
  return String(table?.id || '').slice(POS_DELIVERY_SLOT_PREFIX.length);
}
const CAJA_OPTIONS_CAJERO_IDS = new Set([
  'cobrar',
  'ingresos',
  'egresos',
  'notas_credito',
  'notas_debito',
  'consulta_precios',
  'impresora',
]);
const CAJA_OPTIONS = [
  { id: 'cobrar', label: 'Cobrar' },
  { id: 'reservas', label: 'Reservas' },
  { id: 'apertura_cierre', label: 'Apertura y cierre' },
  { id: 'cierres_caja', label: 'Cierres de caja' },
  { id: 'ingresos', label: 'Ingresos' },
  { id: 'egresos', label: 'Egresos' },
  { id: 'notas_credito', label: 'Notas de credito' },
  { id: 'notas_debito', label: 'Notas de debito' },
  { id: 'consulta_precios', label: 'Consulta de precios' },
  { id: 'impresora', label: 'Impresora' },
];

async function printCajaTicket(payload) {
  try {
    if (hasElectronPrinting()) {
      await electronPrinting.printModule('caja', payload);
    } else {
      await api.printing.post('/printing/print/caja', payload);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || 'No se pudo imprimir' };
  }
}

const WAREHOUSE_CATEGORY_NAMES = new Set(['PRODUCTOS ALMACEN', 'INSUMOS']);
const DEFAULT_BILLING_FORM = {
  enabled: false,
  doc_type: 'nota_venta',
  customer_doc_type: '0',
  customer_doc_number: '',
  customer_name: '',
  customer_address: '',
  customer_phone: '',
  /** Comprobante: cada ítem del pedido vs una sola línea por consumo */
  invoice_lines_mode: 'detallado',
};
const EMPTY_CUSTOMER_FORM = {
  doc_type: '1',
  doc_number: '',
  name: '',
  phone: '',
  address: '',
  email: '',
};

const normalizeCustomerEmail = (value) => {
  const raw = String(value || '').trim();
  if (!raw || raw.toLowerCase() === '@gmail.com') return '';
  if (raw.includes('@')) return raw;
  return `${raw}@gmail.com`;
};

/** Reconstruye nota y modificador desde `order_items.notes` (mismo formato que al crear el pedido). */
function parseOrderItemNotes(notesStr, product) {
  const s = String(notesStr || '').trim();
  const modId = String(product?.modifier_id || '').trim();
  if (!s) return { itemNote: '', modifierId: modId, modifierOption: '' };
  const parts = s.split(' | ').map((x) => x.trim()).filter(Boolean);
  if (parts.length === 1) {
    const m = parts[0].match(/^([^:]+):\s*(.+)$/);
    if (m && modId) {
      return { itemNote: '', modifierId: modId, modifierOption: m[2].trim() };
    }
    return { itemNote: parts[0], modifierId: modId, modifierOption: '' };
  }
  const itemNote = parts[0];
  const last = parts[parts.length - 1];
  const m = last.match(/^([^:]+):\s*(.+)$/);
  if (m && modId) {
    return { itemNote, modifierId: modId, modifierOption: m[2].trim() };
  }
  return { itemNote: s, modifierId: modId, modifierOption: '' };
}

function canEditOrderLines(order) {
  return (
    order &&
    ['pending', 'preparing', 'ready'].includes(String(order.status || '')) &&
    String(order.payment_status || 'pending') === 'pending'
  );
}

function isPosAdminUser(user) {
  const role = String(user?.role || '').toLowerCase();
  return role === 'admin' || role === 'master_admin';
}

function cartRemovalSignature(cart) {
  const rows = (cart || []).map((i) => ({
    k: [
      String(i.source_order_id || ''),
      String(i.product_id || ''),
      String(i.modifier_id || ''),
      String(i.modifier_option || ''),
      String(i.notes || '').trim(),
    ].join('\0'),
    q: Number(i.quantity || 0),
  }));
  rows.sort((a, b) => a.k.localeCompare(b.k));
  return rows;
}

function cartHasProductRemovals(initialCart, currentCart) {
  const sumRows = (rows) => {
    const m = new Map();
    for (const r of rows) m.set(r.k, (m.get(r.k) || 0) + r.q);
    return m;
  };
  const before = sumRows(cartRemovalSignature(initialCart));
  const after = sumRows(cartRemovalSignature(currentCart));
  for (const [key, qty] of before) {
    if ((after.get(key) || 0) < qty) return true;
  }
  return false;
}

function formatMesaRemovalReason(prefix, reason) {
  const text = String(reason || '').trim();
  if (!text) return prefix;
  const prefixRe = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:?\\s*`, 'i');
  return prefixRe.test(text) ? text : `${prefix}: ${text}`;
}

/** Todos los productos de la mesa agrupados por línea de producto (misma lógica que precuenta/cobro). */
function mergedProductsOnTable(table) {
  const allItems = (table?.orders || []).flatMap((o) => o.items || []);
  return groupItemsByProductNameForBill(allItems);
}

/** Al editar comanda: una fila por línea de producto — ítems iguales (producto/variante/notas/P.unit.) suman cantidad. */
function orderItemsToCart(order, productsById) {
  const m = new Map();
  for (const it of order.items || []) {
    const product = productsById.get(it.product_id);
    const parsed = parseOrderItemNotes(it.notes, product);
    const modId = parsed.modifierId || String(it.modifier_id || '').trim();
    const modOpt = parsed.modifierOption || String(it.modifier_option || '').trim();
    const k = billLineKey(it);
    const qty = Number(it.quantity || 0);
    if (!m.has(k)) {
      m.set(k, {
        line_key: `mg:${order.id}:${k}`,
        source_order_id: order.id,
        product_id: it.product_id,
        name: billLineDisplayName(it),
        price: Number(product?.price ?? it.unit_price ?? 0),
        quantity: 0,
        modifier_id: modId,
        modifier_name: '',
        modifier_option: modOpt,
        note_required: product ? Number(product.note_required || 0) : 0,
        notes: parsed.itemNote,
      });
    }
    const row = m.get(k);
    row.quantity += qty;
  }
  return [...m.values()];
}

function filterUnpaidDeliveryOrdersForCaja(orders) {
  return (orders || [])
    .filter(
      (o) =>
        o.type === 'delivery' &&
        String(o.payment_status || '') !== 'paid' &&
        ['pending', 'preparing', 'ready'].includes(String(o.status || ''))
    )
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
}
function buildDeliveryCajaSlots(orders) {
  return filterUnpaidDeliveryOrdersForCaja(orders).map((o, idx) => ({
    id: `${POS_DELIVERY_SLOT_PREFIX}${o.id}`,
    number: o.order_number,
    name: `DELIVERY ${idx + 1}`,
    zone: 'delivery',
    orders: [o],
    status: 'occupied',
    order_total: getOrderChargeTotal(o),
    order_count: 1,
  }));
}

export default function POSPanel() {
  const showDeliveryUi = useShowDeliveryUi();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const clientCheckoutOpenedKeyRef = useRef('');
  const [tables, setTables] = useState([]);
  const [salonesConfig, setSalonesConfig] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [allOrders, setAllOrders] = useState([]);
  const [register, setRegister] = useState(null);
  const [registerStatus, setRegisterStatus] = useState({ is_open: false, register: null });
  const [dailySales, setDailySales] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedTable, setSelectedTable] = useState(null);
  const [tableDetail, setTableDetail] = useState(null);
  /** Detalle de mesa (productos + acciones) en ventana superpuesta. */
  const [mesaDetailModalOpen, setMesaDetailModalOpen] = useState(false);
  /** Modal mover/unir mesas (misma API que Admin → Mesas). */
  const [mesaTableAction, setMesaTableAction] = useState(null);
  /** Zona/salón activo en mapa de mesas (pestañas tipo categoría). */
  const [selectedPosSalon, setSelectedPosSalon] = useState('');
  const [showBill, setShowBill] = useState(false);
  const [splitMode, setSplitMode] = useState(false);
  /** En dividir cuenta: ids de `order_items` incluidos en este cobro. */
  const [selectedOrderItemIds, setSelectedOrderItemIds] = useState([]);
  const [discountConfig, setDiscountConfig] = useState({
    active: false,
    applied: false,
    type: 'amount',
    value: '',
    reason: '',
    target: 'whole',
    targetOrderItemId: '',
  });
  const [showMenu, setShowMenu] = useState(false);
  const [viewOrdersModal, setViewOrdersModal] = useState(null);
  const [quickSaleMode, setQuickSaleMode] = useState(false);
  const [products, setProducts] = useState([]);
  const [modifiers, setModifiers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedCat, setSelectedCat] = useState('all');
  const [paymentMethod, setPaymentMethod] = useState('efectivo');
  const [paymentOptions, setPaymentOptions] = useState(getPaymentMethodOptions(null, { includeOnline: false }));
  const [multiPayEnabled, setMultiPayEnabled] = useState(false);
  const [multiPayAmounts, setMultiPayAmounts] = useState(() => emptyMultiPaymentAmounts());
  const [tipPayEnabled, setTipPayEnabled] = useState(false);
  const [checkoutTipAmount, setCheckoutTipAmount] = useState('');
  const [amountReceived, setAmountReceived] = useState('');
  const [billingForm, setBillingForm] = useState(DEFAULT_BILLING_FORM);
  const [billingResult, setBillingResult] = useState(null);
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
    setCart,
  } = useStaffOrderCart(modifiers);
  const [editingOrderId, setEditingOrderId] = useState('');
  /** Comanda “principal” (nuevas líneas sin `source_order_id` y nota para llevar). */
  const [editingSessionOrderIds, setEditingSessionOrderIds] = useState([]);
  const editSessionInitialCartRef = useRef([]);
  const mesaRemovalConfirmRef = useRef(null);
  const [mesaRemovalModal, setMesaRemovalModal] = useState(null);
  const [mesaRemovalReason, setMesaRemovalReason] = useState('');
  const [mesaRemovalSubmitting, setMesaRemovalSubmitting] = useState(false);
  /** Comanda cocina/bar: «PARA LLEVAR» en mayúsculas (orders.notes). Solo mesa/salón, no venta rápida. */
  const [paraLlevarMesa, setParaLlevarMesa] = useState(false);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [customerForm, setCustomerForm] = useState(EMPTY_CUSTOMER_FORM);
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [matchedCustomer, setMatchedCustomer] = useState(null);
  const [selectedBillingCustomerId, setSelectedBillingCustomerId] = useState('');
  const [showCustomerPickerModal, setShowCustomerPickerModal] = useState(false);
  const [addToAccountEnabled, setAddToAccountEnabled] = useState(false);
  const [searchingCustomer, setSearchingCustomer] = useState(false);
  const [consultaPadronLoading, setConsultaPadronLoading] = useState(false);
  /** Tras una consulta exitosa con cupo, el /auth/me no se refresca al instante. */
  const [padronUsedBump, setPadronUsedBump] = useState(0);
  const [openingAmount, setOpeningAmount] = useState('');
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [activeCajaOption, setActiveCajaOption] = useState(searchParams.get('view') || 'cobrar');
  const [printingConfig, setPrintingConfig] = useState(DEFAULT_PRINTING_CONFIG);
  const cajaPaperWidthMm = useMemo(() => {
    return normalizePaperWidthMm(printingConfig?.caja?.anchoPapel ?? printingConfig?.caja?.paperWidth ?? 80);
  }, [printingConfig?.caja?.anchoPapel, printingConfig?.caja?.paperWidth]);
  const [closingData, setClosingData] = useState(null);
  /** Momento fijo al abrir el cierre (misma referencia que “Cierre” en el arqueo). */
  const [closingAtPreview, setClosingAtPreview] = useState(null);
  const [closingAmount, setClosingAmount] = useState('');
  const [closingNotes, setClosingNotes] = useState('');
  const [denominations, setDenominations] = useState({
    b200: '',
    b100: '',
    b50: '',
    b20: '',
    b10: '',
    m5: '',
    m2: '',
    m1: '',
    c50: '',
    c20: '',
    c10: '',
  });
  const [registerHistory, setRegisterHistory] = useState([]);
  const [billingStatus, setBillingStatus] = useState({
    billing_enabled: 0,
    offline_mode: 1,
    auto_retry_enabled: 1,
    provider_reachable: false,
    pending_documents: 0,
    checked_at: '',
  });
  const [incomes, setIncomes] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [creditNotes, setCreditNotes] = useState([]);
  const [debitNotes, setDebitNotes] = useState([]);
  const [movementForm, setMovementForm] = useState({ amount: '', concept: '' });
  const [noteForm, setNoteForm] = useState({ amount: '', reason: '' });
  const [priceQuery, setPriceQuery] = useState('');
  const [priceResults, setPriceResults] = useState([]);
  const printRef = useRef(null);
  const [printRestaurantInfo, setPrintRestaurantInfo] = useState({
    name: '',
    logo: '',
    legal_name: '',
    billing_nombre_comercial: '',
    billing_emisor_direccion: '',
    address: '',
    phone: '',
    email: '',
    company_ruc: '',
  });
  const { user } = useAuth();
  const posAdmin = isPosAdminUser(user);
  const cajaOptionsForRole = useMemo(() => {
    if (String(user?.role || '').toLowerCase() === 'cajero') {
      return CAJA_OPTIONS.filter((o) => CAJA_OPTIONS_CAJERO_IDS.has(o.id));
    }
    return CAJA_OPTIONS;
  }, [user?.role]);
  useEffect(() => {
    setPadronUsedBump(0);
  }, [user?.padron_quota?.month, user?.id]);
  const padronQuotaUi = useMemo(() => {
    const pq = user?.padron_quota;
    const limit = pq?.limit != null && pq.limit !== '' ? Number(pq.limit) : null;
    if (limit == null || !Number.isFinite(limit) || limit < 1) {
      return { exhausted: false, label: '' };
    }
    const used = (Number(pq?.used) || 0) + padronUsedBump;
    return {
      exhausted: used >= limit,
      label: `Consultas padrón: ${used}/${limit} este mes`,
    };
  }, [user?.padron_quota, padronUsedBump]);
  const [cajaStations, setCajaStations] = useState([]);
  const [adminRegisterId, setAdminRegisterId] = useState(() => {
    try {
      return String(sessionStorage.getItem(POS_ADMIN_REGISTER_KEY) || '').trim();
    } catch {
      return '';
    }
  });

  const appendPosRegisterId = useCallback(
    (path) => {
      const rid = String(adminRegisterId || '').trim();
      if (String(user?.role || '').toLowerCase() !== 'admin' || !rid) return path;
      const sep = path.includes('?') ? '&' : '?';
      return `${path}${sep}register_id=${encodeURIComponent(rid)}`;
    },
    [user?.role, adminRegisterId]
  );

  const posRegisterBody = useCallback(() => {
    const rid = String(adminRegisterId || '').trim();
    if (String(user?.role || '').toLowerCase() !== 'admin' || !rid) return {};
    return { register_id: rid };
  }, [user?.role, adminRegisterId]);
  const openCajaView = useCallback(
    (view) => {
      const allowed = cajaOptionsForRole.some((o) => o.id === view);
      const v = allowed ? view : 'cobrar';
      setActiveCajaOption(v);
      setSearchParams({ view: v }, { replace: true });
    },
    [cajaOptionsForRole, setSearchParams]
  );

  const loadData = async (opts = {}) => {
    try {
      const adminRid =
        opts.adminRegisterOverride !== undefined
          ? String(opts.adminRegisterOverride || '').trim()
          : String(adminRegisterId || '').trim();
      const currentRegPath =
        String(user?.role || '').toLowerCase() === 'admin' && adminRid
          ? `/pos/current-register?register_id=${encodeURIComponent(adminRid)}`
          : '/pos/current-register';
      const [tablesData, salonesRes, reg, status, stationsRes, prods, cats, modifiersData, combosData, cfg, paymentMethodsRes, daily, reservationsData, ordersData, restaurantRes] = await Promise.all([
        api.get('/tables'),
        api.get('/tables/salones').catch(() => ({ salones: [] })),
        api.get(currentRegPath),
        api.get('/pos/register-status'),
        api.get('/pos/caja-stations').catch(() => ({ stations: [] })),
        api.get('/products?active_only=true&available_now=true'),
        api.get('/categories/active'),
        api.get('/admin-modules/modifiers').catch(() => []),
        api.get('/admin-modules/combos').catch(() => []),
        api.get('/admin-modules/config/app').catch(() => null),
        api.get('/pos/payment-methods').catch(() => null),
        api.get('/reports/daily').catch(() => null),
        api.get('/admin-modules/reservations').catch(() => []),
        api.get('/orders?limit=600').catch(() => []),
        api.get('/restaurant').catch(() => null),
      ]);
      setCajaStations(Array.isArray(stationsRes?.stations) ? stationsRes.stations : []);
      if (String(user?.role || '').toLowerCase() === 'admin' && adminRid && !reg) {
        try {
          sessionStorage.removeItem(POS_ADMIN_REGISTER_KEY);
        } catch (_) {
          /* noop */
        }
        setAdminRegisterId('');
      }
      setPrintRestaurantInfo({
        name: String(restaurantRes?.name || '').trim(),
        logo: resolveMediaUrl(restaurantRes?.logo || ''),
        legal_name: String(restaurantRes?.legal_name || '').trim(),
        billing_nombre_comercial: String(restaurantRes?.billing_nombre_comercial || '').trim(),
        billing_emisor_direccion: String(restaurantRes?.billing_emisor_direccion || '').trim(),
        address: String(restaurantRes?.address || '').trim(),
        phone: String(restaurantRes?.phone || '').trim(),
        email: String(restaurantRes?.email || '').trim(),
        company_ruc: String(restaurantRes?.company_ruc || '').trim(),
        profile:
          restaurantRes?.profile && typeof restaurantRes.profile === 'object'
            ? restaurantRes.profile
            : undefined,
      });
      const visibleCategories = cats.filter(c => !WAREHOUSE_CATEGORY_NAMES.has((c.name || '').toUpperCase()));
      const mergedCatalog = mergeOrderingCatalog(prods, visibleCategories, combosData || []);
      const visibleCategoryIds = new Set(mergedCatalog.categories.map(c => c.id));
      const visibleProducts = filterVisibleOrderingProducts(mergedCatalog.products, visibleCategoryIds);
      setTables(tablesData);
      setSalonesConfig(Array.isArray(salonesRes?.salones) ? salonesRes.salones : []);
      setReservations(reservationsData || []);
      setAllOrders(ordersData || []);
      setRegister(reg);
      setRegisterStatus(status);
      setProducts(visibleProducts);
      setModifiers(Array.isArray(modifiersData) ? modifiersData : []);
      setCategories(mergedCatalog.categories);
      setPaymentOptions(
        Array.isArray(paymentMethodsRes?.options) && paymentMethodsRes.options.length
          ? paymentMethodsRes.options
          : getPaymentMethodOptions(cfg, { includeOnline: false }),
      );
      setDailySales(
        daily?.sales?.total_sales === undefined || daily?.sales?.total_sales === null
          ? null
          : Number(daily.sales.total_sales || 0)
      );
      if (selectedTable) {
        if (isClientCheckoutTable(selectedTable)) {
          const cid = String(selectedTable.id).slice(CLIENT_CHECKOUT_TABLE_PREFIX.length);
          const fresh = (ordersData || []).filter(
            (o) =>
              String(o.customer_id || '') === cid &&
              String(o.payment_status || '') !== 'paid' &&
              String(o.status || '') !== 'cancelled'
          );
          setSelectedTable((prev) =>
            prev && isClientCheckoutTable(prev) ? { ...prev, orders: fresh } : prev
          );
        } else if (isDeliveryCheckoutTable(selectedTable)) {
          const slots = buildDeliveryCajaSlots(ordersData);
          const next = slots.find((s) => s.id === selectedTable.id);
          if (next) setSelectedTable(next);
          else {
            setSelectedTable(null);
            setShowBill(false);
            setSplitMode(false);
            setSelectedOrderItemIds([]);
          }
        } else {
          const updated = tablesData.find((t) => t.id === selectedTable.id);
          if (updated) setSelectedTable(updated);
        }
      }
      if (tableDetail) {
        if (isDeliveryCheckoutTable(tableDetail)) {
          const slots = buildDeliveryCajaSlots(ordersData);
          const next = slots.find((s) => s.id === tableDetail.id);
          if (next) setTableDetail(next);
          else setTableDetail(null);
        } else {
          const updatedDetail = tablesData.find(t => t.id === tableDetail.id);
          if (updatedDetail) setTableDetail(updatedDetail);
        }
      }
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const reservationAlertToastIdsRef = useRef(new Set());

  const syncReservationAlertToasts = useCallback(async () => {
    try {
      const data = await api.get('/reports/reservation-caja-alerts');
      const alerts = (data?.alerts || []).filter((a) => String(a?.id || '').startsWith('reserva_caja_'));
      const nextIds = new Set(alerts.map((a) => a.id));
      for (const id of reservationAlertToastIdsRef.current) {
        if (!nextIds.has(id)) toast.dismiss(id);
      }
      for (const alert of alerts) {
        toast(`${alert.title}: ${alert.message}`, {
          id: alert.id,
          duration: Infinity,
          icon: '📅',
        });
      }
      reservationAlertToastIdsRef.current = nextIds;
    } catch (_) {
      /* noop */
    }
  }, []);

  const loadPrinterConfig = async () => {
    try {
      const cfg = await fetchPrintingConfig();
      setPrintingConfig(cfg);
    } catch (err) {
      console.warn('[printing] fallback POS config por error de carga:', err?.message || err);
      setPrintingConfig(DEFAULT_PRINTING_CONFIG);
    }
  };

  useEffect(() => {
    loadData();
    loadPrinterConfig();
  }, []);
  useActiveInterval(loadData, 10000);
  useSocket('order-update', () => {
    void loadData();
    void syncReservationAlertToasts();
  });
  useSocket('table-update', loadData);
  useSocket('salones-update', loadData);
  useSocket('inventory-update', loadData);
  useSocket('staff-data-update', (payload) => {
    const d = payload?.domain;
    if (['modifiers', 'reservations', 'customers', 'app_config', 'catalog', 'combos'].includes(d)) void loadData();
    if (d === 'reservations') void syncReservationAlertToasts();
  });
  useSocket('reservation-reminder', () => {
    void loadData();
    void syncReservationAlertToasts();
  });

  useEffect(() => {
    void syncReservationAlertToasts();
    const interval = setInterval(() => void syncReservationAlertToasts(), 20000);
    return () => clearInterval(interval);
  }, [syncReservationAlertToasts]);

  useEffect(() => {
    if (!paymentOptions.some(opt => opt.value === paymentMethod)) {
      setPaymentMethod(paymentOptions[0]?.value || 'efectivo');
    }
  }, [paymentOptions, paymentMethod]);

  const multiPaymentOptions = useMemo(
    () => orderMultiPaymentOptions(paymentOptions),
    [paymentOptions]
  );

  useEffect(() => {
    if (!showBill) return;
    setMultiPayEnabled(false);
    setMultiPayAmounts(emptyMultiPaymentAmounts());
    setTipPayEnabled(false);
    setCheckoutTipAmount('');
  }, [showBill, selectedTable?.id]);

  useEffect(() => {
    if (!showMenu) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [showMenu]);

  useEffect(() => {
    const requestedView = searchParams.get('view');
    const isValidView = cajaOptionsForRole.some((option) => option.id === requestedView);
    if (isValidView && requestedView !== activeCajaOption) {
      setActiveCajaOption(requestedView);
      return;
    }
    if (!isValidView && requestedView) {
      setActiveCajaOption('cobrar');
      setSearchParams({ view: 'cobrar' }, { replace: true });
      return;
    }
    if (!isValidView && !requestedView) {
      setSearchParams({ view: 'cobrar' }, { replace: true });
    }
  }, [activeCajaOption, searchParams, setSearchParams, cajaOptionsForRole]);

  useEffect(() => {
    if (activeCajaOption !== 'cobrar') setMesaDetailModalOpen(false);
  }, [activeCajaOption]);

  const loadCajaExtras = async () => {
    try {
      const history = await api.get('/pos/history');
      setRegisterHistory(history);
    } catch {
      setRegisterHistory([]);
    }
    if (!register) return;
    try {
      const [incomeData, expenseData, creditData, debitData] = await Promise.all([
        api.get(appendPosRegisterId('/pos/movements?type=income')),
        api.get(appendPosRegisterId('/pos/movements?type=expense')),
        api.get(appendPosRegisterId('/pos/notes?note_type=credit')),
        api.get(appendPosRegisterId('/pos/notes?note_type=debit')),
      ]);
      setIncomes(incomeData);
      setExpenses(expenseData);
      setCreditNotes(creditData);
      setDebitNotes(debitData);
    } catch {
      setIncomes([]);
      setExpenses([]);
      setCreditNotes([]);
      setDebitNotes([]);
    }
  };

  useEffect(() => { loadCajaExtras(); }, [register?.id, appendPosRegisterId]);

  const loadBillingStatus = async () => {
    try {
      const status = await api.get('/billing/provider-status');
      setBillingStatus(status || {});
    } catch (_) {
      setBillingStatus(prev => ({ ...prev, provider_reachable: false, checked_at: new Date().toISOString() }));
    }
  };

  useSocket('billing-document-update', loadBillingStatus);

  useEffect(() => {
    loadBillingStatus();
    const timer = setInterval(loadBillingStatus, 15000);
    const handleOnline = () => loadBillingStatus();
    const handleOffline = () => setBillingStatus(prev => ({ ...prev, provider_reachable: false }));
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (billingForm.doc_type === 'factura' && billingForm.customer_doc_type !== '6') {
      setBillingForm(prev => ({ ...prev, customer_doc_type: '6' }));
    }
    if (billingForm.doc_type === 'nota_venta' && billingForm.customer_doc_type !== '0') {
      setBillingForm(prev => ({ ...prev, customer_doc_type: '0' }));
    }
    if (billingForm.doc_type === 'nota_venta' && billingForm.invoice_lines_mode !== 'detallado') {
      setBillingForm(prev => ({ ...prev, invoice_lines_mode: 'detallado' }));
    }
  }, [billingForm.doc_type, billingForm.customer_doc_type, billingForm.invoice_lines_mode]);

  useEffect(() => {
    if (!billingForm.enabled) {
      setMatchedCustomer(null);
      setSearchingCustomer(false);
      return;
    }
    const docNumber = normalizeDocNumber(billingForm.customer_doc_number);
    const docType = getActiveDocType();
    const requiredLength = docType === '6' ? 11 : docType === '1' ? 8 : 0;
    if (!docNumber || (requiredLength && docNumber.length !== requiredLength)) {
      setMatchedCustomer(null);
      setSearchingCustomer(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        setSearchingCustomer(true);
        const found = await api.get(`/admin-modules/customers/by-document?doc_number=${encodeURIComponent(docNumber)}`);
        if (cancelled) return;
        setMatchedCustomer(found || null);
        if (found) {
          applyCustomerToBilling(found);
        }
      } catch (_) {
        if (!cancelled) setMatchedCustomer(null);
      } finally {
        if (!cancelled) setSearchingCustomer(false);
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [billingForm.enabled, billingForm.customer_doc_number, billingForm.customer_doc_type, billingForm.doc_type]);

  const denomDefs = [
    { key: 'b200', label: 'Billete S/200', value: 200 },
    { key: 'b100', label: 'Billete S/100', value: 100 },
    { key: 'b50', label: 'Billete S/50', value: 50 },
    { key: 'b20', label: 'Billete S/20', value: 20 },
    { key: 'b10', label: 'Billete S/10', value: 10 },
    { key: 'm5', label: 'Moneda S/5', value: 5 },
    { key: 'm2', label: 'Moneda S/2', value: 2 },
    { key: 'm1', label: 'Moneda S/1', value: 1 },
    { key: 'c50', label: 'Moneda S/0.50', value: 0.5 },
    { key: 'c20', label: 'Moneda S/0.20', value: 0.2 },
    { key: 'c10', label: 'Moneda S/0.10', value: 0.1 },
  ];

  const openRegisterForCajero = async () => {
    if (openingAmount === '') return toast.error('Ingresa el monto inicial de caja');
    const amount = parseFloat(openingAmount);
    if (Number.isNaN(amount) || amount < 0) return toast.error('El monto inicial no es válido');
    try {
      const reg = await api.post('/pos/open-register', { opening_amount: amount });
      setRegister(reg);
      setRegisterStatus({ is_open: true, register: { user_id: user?.id, cajero_name: user?.full_name, opened_at: reg.opened_at } });
      setOpeningAmount('');
      toast.success(`Caja abierta con ${formatCurrency(amount)}`);
      await loadData();
    } catch (err) { toast.error(err.message); }
  };

  const openStationRegisterForAdmin = async (stationId) => {
    if (openingAmount === '') return toast.error('Ingresa el monto inicial de caja');
    const amount = parseFloat(openingAmount);
    if (Number.isNaN(amount) || amount < 0) return toast.error('El monto inicial no es válido');
    const sid = String(stationId || '').trim();
    if (!sid) return toast.error('Caja no válida');
    try {
      const reg = await api.post('/pos/open-register', { opening_amount: amount, caja_station_id: sid });
      try {
        sessionStorage.setItem(POS_ADMIN_REGISTER_KEY, reg.id);
      } catch (_) {
        /* noop */
      }
      setAdminRegisterId(reg.id);
      setRegister(reg);
      setRegisterStatus({ is_open: true, register: { user_id: user?.id, cajero_name: user?.full_name, opened_at: reg.opened_at } });
      setOpeningAmount('');
      toast.success(`Caja abierta con ${formatCurrency(amount)}`);
      await loadData({ adminRegisterOverride: reg.id });
    } catch (err) { toast.error(err.message); }
  };

  const attachAdminToRegister = async (registerId) => {
    const rid = String(registerId || '').trim();
    if (!rid) return;
    try {
      sessionStorage.setItem(POS_ADMIN_REGISTER_KEY, rid);
    } catch (_) {
      /* noop */
    }
    setAdminRegisterId(rid);
    await loadData({ adminRegisterOverride: rid });
  };

  const clearAdminRegisterContext = async () => {
    try {
      sessionStorage.removeItem(POS_ADMIN_REGISTER_KEY);
    } catch (_) {
      /* noop */
    }
    setAdminRegisterId('');
    await loadData({ adminRegisterOverride: '' });
  };

  const prepareClose = () => {
    setClosingAtPreview(new Date());
    setClosingData(register);
    setClosingAmount('');
    setClosingNotes('');
    setDenominations({
      b200: '',
      b100: '',
      b50: '',
      b20: '',
      b10: '',
      m5: '',
      m2: '',
      m1: '',
      c50: '',
      c20: '',
      c10: '',
    });
    setShowCloseModal(true);
  };

  const calculateDenominationTotal = () => {
    const raw = denomDefs.reduce((sum, d) => sum + (parseFloat(denominations[d.key]) || 0) * d.value, 0);
    return roundMoneySoles(raw);
  };

  const updateDenomination = (key, value) => {
    const safeValue = value === '' ? '' : Math.max(0, parseFloat(value) || 0);
    const updated = { ...denominations, [key]: safeValue };
    setDenominations(updated);
    const total = roundMoneySoles(
      denomDefs.reduce((sum, d) => sum + (parseFloat(updated[d.key]) || 0) * d.value, 0)
    );
    setClosingAmount(total.toFixed(2));
  };

  const closeRegister = async () => {
    if (closingAmount === '') return toast.error('Ingresa el efectivo contado para cerrar caja');
    const amount = roundMoneySoles(parseFloat(closingAmount));
    if (Number.isNaN(amount) || amount < 0) return toast.error('El efectivo contado no es válido');
    try {
      await api.post('/pos/close-register', {
        closing_amount: amount,
        notes: closingNotes,
        arqueo: {
          expected_cash: expectedRounded,
          counted_cash: amount,
          difference,
          denominations,
          observations: closingNotes,
        },
        ...posRegisterBody(),
      });
      toast.success('Caja cerrada — Informe guardado');
      setShowCloseModal(false);
      setClosingAtPreview(null);
      setRegister(null);
      if (String(user?.role || '').toLowerCase() === 'admin') {
        try {
          sessionStorage.removeItem(POS_ADMIN_REGISTER_KEY);
        } catch (_) {
          /* noop */
        }
        setAdminRegisterId('');
      }
    } catch (err) { toast.error(err.message); }
  };
  /** Impresión clásica (diálogo del navegador / impresora USB), no tiketera térmica. */
  const printCloseRegisterManual = () => {
    const content = printRef.current;
    if (!content) {
      toast.error('No hay contenido para imprimir');
      return;
    }

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.visibility = 'hidden';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc || !iframe.contentWindow) {
      toast.error('No se pudo preparar la impresión');
      document.body.removeChild(iframe);
      return;
    }

    const restaurantName =
      String(printRestaurantInfo.billing_nombre_comercial || printRestaurantInfo.name || '').trim() || 'Restaurante';

    doc.open();
    doc.write(`<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <title>Arqueo de caja</title>
    <style>
      @page { margin: 12mm; }
      body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #111827; padding: 0; margin: 0; }
      .brand { font-size: 11px; color: #4b5563; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.04em; }
      h2 { font-size: 16px; margin: 0 0 4px; text-transform: uppercase; color: #111827; }
      h3 { font-size: 13px; font-weight: 500; margin: 0 0 12px; color: #374151; }
      .row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 2px 0; color: #111827; }
      .row span:last-child { text-align: right; }
      .row.bold { font-weight: 700; }
      .total-row { font-weight: 700; }
      .sep { border-top: 1px dashed #9ca3af; margin: 8px 0; }
      .diff-pos { color: #047857; font-weight: 700; }
      .diff-neg { color: #b91c1c; font-weight: 700; }
      .products-table { width: 100%; border-collapse: collapse; margin: 6px 0 10px; font-size: 11px; }
      .products-table th, .products-table td { padding: 3px 4px; border-bottom: 1px solid #e5e7eb; text-align: left; color: #111827; }
      .products-table th.num, .products-table td.num { text-align: right; white-space: nowrap; }
      .products-table thead th { font-size: 10px; text-transform: uppercase; color: #6b7280; }
      .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; margin: 8px 0 4px; color: #374151; }
    </style>
  </head>
  <body>
    <p class="brand">${restaurantName}</p>
    ${content.innerHTML}
  </body>
</html>`);
    doc.close();

    setTimeout(() => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      setTimeout(() => {
        if (document.body.contains(iframe)) document.body.removeChild(iframe);
      }, 700);
    }, 200);
  };

  const resetBillingForm = () => {
    setBillingForm(DEFAULT_BILLING_FORM);
    setBillingResult(null);
    setMatchedCustomer(null);
    setSelectedBillingCustomerId('');
    setAddToAccountEnabled(false);
    setSearchingCustomer(false);
  };

  const resolveBillingCustomerId = () =>
    String(selectedBillingCustomerId || matchedCustomer?.id || '').trim();

  const handleCustomerPicked = (customer) => {
    if (!customer) return;
    applyCustomerToBilling(customer);
    setMatchedCustomer(customer);
    setSelectedBillingCustomerId(String(customer.id || ''));
    toast.success(`Cliente cargado: ${customer.name}`);
  };

  const normalizeDocNumber = (value) => String(value || '').replace(/\D/g, '');

  const getActiveDocType = () => (billingForm.doc_type === 'factura' ? '6' : billingForm.customer_doc_type);

  const handleConsultaPadron = useCallback(async () => {
    const docType = billingForm.doc_type === 'factura' ? '6' : billingForm.customer_doc_type;
    if (docType !== '1' && docType !== '6') {
      toast.error('Seleccione DNI o RUC');
      return;
    }
    const num = normalizeDocNumber(billingForm.customer_doc_number);
    const okLen = docType === '6' ? num.length === 11 : num.length === 8;
    if (!okLen) {
      toast.error(docType === '6' ? 'Ingrese RUC de 11 dígitos' : 'Ingrese DNI de 8 dígitos');
      return;
    }
    const pq = user?.padron_quota;
    const lim = pq?.limit != null && pq.limit !== '' ? Number(pq.limit) : null;
    if (lim != null && Number.isFinite(lim) && lim > 0) {
      const used = (Number(pq?.used) || 0) + padronUsedBump;
      if (used >= lim) {
        toast.error(`Límite mensual de consultas DNI/RUC alcanzado (${lim}).`);
        return;
      }
    }
    try {
      setConsultaPadronLoading(true);
      const data = await api.get(
        `/admin-modules/consulta-padron?doc_type=${encodeURIComponent(docType)}&numero=${encodeURIComponent(num)}`
      );
      const nombre = String(data?.nombre || '').trim();
      if (!nombre) {
        toast.error('No se recibió el nombre del padrón');
        return;
      }
      setBillingForm((prev) => ({
        ...prev,
        customer_name: nombre,
        customer_address:
          data?.direccion != null && String(data.direccion).trim()
            ? String(data.direccion).trim()
            : prev.customer_address,
      }));
      setMatchedCustomer(null);
      if (lim != null && Number.isFinite(lim) && lim > 0) {
        setPadronUsedBump((b) => b + 1);
      }
      toast.success(docType === '6' ? 'Razón social obtenida del padrón' : 'Nombre obtenido del padrón');
    } catch (err) {
      const msg = err?.message || 'No se pudo consultar el padrón';
      if (String(msg).toLowerCase().includes('límite mensual') || String(msg).includes('429')) {
        toast.error(msg);
      } else {
        toast.error(msg);
      }
    } finally {
      setConsultaPadronLoading(false);
    }
  }, [
    billingForm.customer_doc_number,
    billingForm.doc_type,
    billingForm.customer_doc_type,
    user?.padron_quota,
    padronUsedBump,
  ]);

  const applyCustomerToBilling = (customer) => {
    if (!customer) return;
    if (customer.id) setSelectedBillingCustomerId(String(customer.id));
    setBillingForm(prev => ({
      ...prev,
      customer_doc_type: String(customer.doc_type || prev.customer_doc_type || '1'),
      customer_doc_number: String(customer.doc_number || prev.customer_doc_number || ''),
      customer_name: String(customer.name || prev.customer_name || ''),
      customer_address: String(customer.address || prev.customer_address || ''),
      customer_phone: String(customer.phone || prev.customer_phone || ''),
    }));
  };

  /** Desde Clientes: abrir modal de cobro con pedidos del cliente (misma API que mesa). */
  useEffect(() => {
    const payload = location.state?.clientCheckout;
    if (!payload?.customerId || !Array.isArray(payload.orderIds) || !payload.orderIds.length) return;

    const byId = new Map((allOrders || []).map((o) => [o.id, o]));
    const missing = payload.orderIds.some((id) => !byId.has(id));
    if (missing) return;

    const orders = payload.orderIds
      .map((id) => byId.get(id))
      .filter((o) => String(o.payment_status || '') !== 'paid' && String(o.status || '') !== 'cancelled');

    const navKey = `${payload.customerId}:${payload.orderIds.slice().sort().join(',')}`;

    if (!orders.length) {
      clientCheckoutOpenedKeyRef.current = '';
      toast.error('Esos pedidos ya no están pendientes de cobro.');
      navigate('/admin/caja?view=cobrar', { replace: true, state: {} });
      return;
    }

    if (clientCheckoutOpenedKeyRef.current === navKey) return;
    clientCheckoutOpenedKeyRef.current = navKey;

    setActiveCajaOption('cobrar');
    setSearchParams({ view: 'cobrar' }, { replace: true });
    setTableDetail(null);
    setSelectedTable({
      id: `${CLIENT_CHECKOUT_TABLE_PREFIX}${payload.customerId}`,
      name: String(payload.customerName || 'Cliente').trim() || 'Cliente',
      number: '',
      orders,
    });
    setShowBill(true);
    setPaymentMethod('efectivo');
    setAmountReceived('');
    setSplitMode(false);
    setSelectedOrderItemIds(collectAllOrderItemIds(orders));
    setDiscountConfig({ ...EMPTY_DISCOUNT_CONFIG });
    resetBillingForm();
    if (payload.customerForBilling) {
      applyCustomerToBilling(payload.customerForBilling);
    }
    toast.success(`Caja: cobrar cuenta de ${payload.customerName || 'cliente'}`);
    navigate('/admin/caja?view=cobrar', { replace: true, state: {} });
  }, [location.state, allOrders, navigate, setSearchParams]);

  const billingSuccessSummary = (doc) => {
    const num = String(doc?.full_number || '').trim();
    const st = String(doc?.provider_status || '').toLowerCase();
    const sunat = String(doc?.sunat_description || '').trim();
    if (st === 'accepted') {
      return sunat ? `${num} — ${sunat}` : `${num} — aceptado por SUNAT`;
    }
    if (st === 'pending') {
      return `${num || 'Comprobante'} — guardado; pendiente de sincronizar con SUNAT`;
    }
    if (st === 'local') {
      return num ? `${num} — nota de venta (registro local)` : 'Nota de venta (registro local)';
    }
    return num || 'Comprobante registrado';
  };

  const validateBillingData = () => {
    if (!billingForm.enabled) return null;
    if (billingForm.doc_type === 'nota_venta') return null;
    const docNumber = String(billingForm.customer_doc_number || '').trim();
    const customerName = String(billingForm.customer_name || '').trim();
    if (billingForm.doc_type === 'factura') {
      if (!/^\d{11}$/.test(docNumber)) return 'Para factura debes ingresar RUC válido (11 dígitos)';
      if (!customerName) return 'Para factura debes ingresar razón social';
    }
    if (billingForm.customer_doc_type === '1' && docNumber && !/^\d{8}$/.test(docNumber)) {
      return 'DNI inválido (8 dígitos)';
    }
    if (billingForm.customer_doc_type === '6' && docNumber && !/^\d{11}$/.test(docNumber)) {
      return 'RUC inválido (11 dígitos)';
    }
    return null;
  };

  const issueElectronicDocument = async (orderId) => {
    const doc = await api.post('/billing/issue', {
      order_id: orderId,
      doc_type: billingForm.doc_type,
      invoice_lines_mode: billingForm.doc_type === 'nota_venta' ? 'detallado' : billingForm.invoice_lines_mode,
      customer: {
        doc_type: billingForm.customer_doc_type,
        doc_number: billingForm.customer_doc_number,
        name: billingForm.customer_name,
        address: billingForm.customer_address,
        phone: billingForm.customer_phone,
      },
    });
    setBillingResult(doc);
    return doc;
  };

  const openCustomerModal = () => {
    const initialDocType = getActiveDocType();
    setCustomerForm({
      ...EMPTY_CUSTOMER_FORM,
      doc_type: initialDocType === '0' ? '1' : initialDocType,
      doc_number: normalizeDocNumber(billingForm.customer_doc_number),
      name: String(billingForm.customer_name || ''),
      phone: String(billingForm.customer_phone || ''),
      address: String(billingForm.customer_address || ''),
    });
    setShowCustomerModal(true);
  };

  const saveCustomerFromBilling = async () => {
    const docType = String(customerForm.doc_type || '1');
    const docNumber = normalizeDocNumber(customerForm.doc_number);
    const name = String(customerForm.name || '').trim();
    if (!name) return toast.error('Ingresa el nombre del cliente');
    if (docType === '1' && docNumber && !/^\d{8}$/.test(docNumber)) {
      return toast.error('DNI inválido (8 dígitos)');
    }
    if (docType === '6' && docNumber && !/^\d{11}$/.test(docNumber)) {
      return toast.error('RUC inválido (11 dígitos)');
    }
    try {
      setSavingCustomer(true);
      const created = await api.post('/admin-modules/customers', {
        name,
        doc_type: docType,
        doc_number: docNumber,
        phone: String(customerForm.phone || '').trim(),
        address: String(customerForm.address || '').trim(),
        email: normalizeCustomerEmail(customerForm.email),
      });
      applyCustomerToBilling(created);
      setBillingForm((prev) => ({
        ...prev,
        customer_phone: String(customerForm.phone || created?.phone || prev.customer_phone || ''),
      }));
      setMatchedCustomer(created);
      setShowCustomerModal(false);
      setCustomerForm(EMPTY_CUSTOMER_FORM);
      toast.success('Cliente guardado y cargado en el comprobante');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingCustomer(false);
    }
  };

  const cobrarMesa = async () => {
    if (!selectedTable) return;
    const tableOrders = selectedTable.orders || [];
    const useLineSplit = splitMode;
    const chargeToAccount = addToAccountEnabled;
    const billingCustomerId = resolveBillingCustomerId();

    if (useLineSplit && selectedOrderItemIds.length === 0) {
      return toast.error('Selecciona al menos una línea de producto para cobrar');
    }

    if (chargeToAccount) {
      if (!billingCustomerId) {
        return toast.error('Seleccione un cliente de Mi Clientes (botón «Mis clientes»)');
      }
      if (billingForm.enabled) {
        return toast.error('Desactive «Emitir comprobante» al agregar a cuenta del cliente');
      }
    }

    const payableOrders = tableOrders;

    let checkoutPaymentMethod = paymentMethod;
    let checkoutPaymentBreakdown = null;
    if (!chargeToAccount) {
      if (multiPayEnabled) {
        const o = {};
        for (const opt of multiPaymentOptions) {
          const raw = multiPayAmounts[opt.value];
          if (raw === undefined || raw === '' || String(raw).trim() === '') continue;
          const v = roundMoneySoles(parseFloat(raw));
          if (v > 0) o[opt.value] = v;
        }
        if (Object.keys(o).length < 2) {
          return toast.error('En multimétodo indica al menos dos métodos con monto mayor a cero.');
        }
        const sum = roundMoneySoles(Object.values(o).reduce((s, x) => s + x, 0));
        if (Math.abs(sum - payableTotal) > 0.05) {
          return toast.error(`La suma (${formatCurrency(sum)}) debe coincidir con el total (${formatCurrency(payableTotal)})`);
        }
        checkoutPaymentBreakdown = o;
        checkoutPaymentMethod = dominantPaymentFromBreakdown(o);
      } else if (paymentMethod === 'efectivo' && receivedAmount < payableTotal) {
        return toast.error(`Monto insuficiente. Falta ${formatCurrency(payableTotal - receivedAmount)}`);
      }
      const billingError = validateBillingData();
      if (billingError) return toast.error(billingError);
    }
    if (discountConfig.applied) {
      const discountReasonText = String(discountConfig.reason || '').trim();
      if (!discountReasonText) {
        return toast.error('Ingresa el motivo del descuento o cortesía');
      }
      if (discountReasonText.length < 3) {
        return toast.error('El motivo del descuento o cortesía debe tener al menos 3 caracteres');
      }
    }
    try {
      if (discountConfig.applied && splitMode && discountConfig.target === 'line' && discountConfig.targetOrderItemId) {
        if (!selectedOrderItemIds.includes(discountConfig.targetOrderItemId)) {
          return toast.error('El producto con descuento debe estar incluido en el cobro.');
        }
      }

      const discountValue = Math.max(0, parseFloat(discountConfig.value) || 0);
      const wholeBaseForDiscount = useLineSplit
        ? computeTableSplitSelectionBase(tableOrders, selectedOrderItemIds)
        : tableOrders.reduce((sum, o) => sum + getOrderChargeTotal(o), 0);

      const lineBaseForDiscount =
        splitMode &&
        discountConfig.applied &&
        discountConfig.target === 'line' &&
        String(discountConfig.targetOrderItemId || '').trim() &&
        selectedOrderItemIds.includes(String(discountConfig.targetOrderItemId).trim())
          ? getOrderItemSubtotalFromOrders(tableOrders, discountConfig.targetOrderItemId)
          : null;

      const baseForDiscount =
        discountConfig.applied && lineBaseForDiscount != null && lineBaseForDiscount > 0
          ? lineBaseForDiscount
          : wholeBaseForDiscount;

      const totalDiscountToApply = !discountConfig.applied
        ? 0
        : (discountConfig.type === 'percent'
          ? Math.min(baseForDiscount, baseForDiscount * (discountValue / 100))
          : Math.min(baseForDiscount, discountValue));

      let remainingAmountDiscount = totalDiscountToApply;
      const discountsByOrder = {};
      if (!useLineSplit && totalDiscountToApply > 0) {
        const totalOrdersAmount = wholeBaseForDiscount;
        for (let idx = 0; idx < payableOrders.length; idx += 1) {
          const order = payableOrders[idx];
          const orderTotal = getOrderChargeTotal(order);
          let extraDiscount = 0;
          if (discountConfig.type === 'percent') {
            extraDiscount = Math.min(orderTotal, orderTotal * (discountValue / 100));
          } else if (idx === payableOrders.length - 1) {
            extraDiscount = Math.min(orderTotal, remainingAmountDiscount);
          } else {
            extraDiscount = Math.min(orderTotal, (totalDiscountToApply * orderTotal) / (totalOrdersAmount || 1));
          }
          remainingAmountDiscount = Math.max(0, remainingAmountDiscount - extraDiscount);
          discountsByOrder[order.id] = extraDiscount;
        }
      }

      const issuedDocs = [];
      if (!chargeToAccount && billingForm.enabled && !useLineSplit) {
        for (const order of payableOrders) {
          const doc = await issueElectronicDocument(order.id);
          issuedDocs.push(doc);
        }
      }

      const checkoutBody = {
        ...posRegisterBody(),
        payment_method: checkoutPaymentMethod,
        discount_reason: discountConfig.reason,
      };
      if (chargeToAccount) {
        checkoutBody.charge_to_customer_account = true;
        checkoutBody.customer_id = billingCustomerId;
      } else if (checkoutPaymentBreakdown) {
        checkoutBody.payment_breakdown = checkoutPaymentBreakdown;
      }
      if (!chargeToAccount && tipPayEnabled) {
        const tipVal = roundMoneySoles(parseFloat(String(checkoutTipAmount).replace(',', '.')) || 0);
        if (tipVal > 0) checkoutBody.tip_amount = tipVal;
      }

      if (useLineSplit) {
        checkoutBody.order_item_ids = selectedOrderItemIds;
        checkoutBody.checkout_discount_total = totalDiscountToApply;
        if (
          totalDiscountToApply > 0 &&
          discountConfig.target === 'line' &&
          String(discountConfig.targetOrderItemId || '').trim()
        ) {
          checkoutBody.checkout_discount_anchor_order_item_id = String(discountConfig.targetOrderItemId).trim();
        }
      } else {
        checkoutBody.order_ids = payableOrders.map((o) => o.id);
        checkoutBody.discounts_by_order = discountsByOrder;
      }

      const checkoutRes = await api.post('/pos/checkout-table', checkoutBody);
      const postPaidOrders = Array.isArray(checkoutRes?.orders) ? checkoutRes.orders : [];
      const printDiscountsByOrder = useLineSplit
        ? (checkoutRes?.discounts_applied_by_order || {})
        : discountsByOrder;

      if (!chargeToAccount && billingForm.enabled && useLineSplit) {
        for (const order of postPaidOrders) {
          const doc = await issueElectronicDocument(order.id);
          issuedDocs.push(doc);
        }
      }

      if (!isClientCheckoutTable(selectedTable) && !isDeliveryCheckoutTable(selectedTable)) {
        const updatedTable = await api.get(`/tables/${selectedTable.id}`);
        if (!updatedTable.orders || updatedTable.orders.length === 0) {
          await api.patch(`/tables/${selectedTable.id}/status`, { status: 'available' });
        }
      }

      const ordersForPrint = postPaidOrders.length > 0 ? postPaidOrders : payableOrders;
      const chargedCount = postPaidOrders.length || payableOrders.length;

      if (issuedDocs.length > 0) {
        const detail = issuedDocs.map(billingSuccessSummary).join(' · ');
        toast.success(`${chargedCount} pedido(s) cobrados. ${detail}`);
        const pdf = issuedDocs.find((d) => d?.pdf_url)?.pdf_url;
        /** Sin resolveMediaUrl, `/uploads/...` se abre en el host del front (p. ej. Vercel) y la SPA puede redirigir a /admin en lugar del PDF en la API. */
        if (pdf && billingForm.doc_type !== 'nota_venta') {
          window.open(resolveMediaUrl(pdf), '_blank', 'noopener,noreferrer');
        }
        const logoUrl = String(printRestaurantInfo.logo || '').trim() || undefined;
        const pw = cajaPaperWidthMm;
        if (billingForm.doc_type === 'nota_venta') {
          await printNotaVenta({
            tableName: selectedTable?.name || '',
            orders: ordersForPrint,
            docs: issuedDocs,
            paymentMethod: checkoutPaymentMethod,
            discountTotal: totalDiscountToApply,
            customer: {
              doc_number: billingForm.customer_doc_number,
              name: billingForm.customer_name,
              address: billingForm.customer_address,
              phone: billingForm.customer_phone,
            },
          });
        } else if (billingForm.doc_type === 'boleta' || billingForm.doc_type === 'factura') {
          for (let i = 0; i < issuedDocs.length; i += 1) {
            const doc = issuedDocs[i];
            const ord = ordersForPrint[i];
            if (!doc || !ord) continue;
            const grouped = groupItemsByProductNameForBill(ord.items || []);
            const ordDisc = Number(printDiscountsByOrder[ord.id] || 0);
            const plain = buildBoletaFacturaPlainText({
              restaurant: printRestaurantInfo,
              doc,
              groupedRows: grouped,
              formatCurrencyFn: formatCurrency,
              subtotal: Number(ord.subtotal || 0),
              tax: Number(ord.tax || 0),
              total: getOrderChargeTotal(ord),
              discount: ordDisc,
              customer: {
                name: billingForm.customer_name,
                doc_number: billingForm.customer_doc_number,
              },
              widthMm: pw,
              printedAt: new Date(),
              paymentMethod: checkoutPaymentMethod,
            });
            const r = await printCajaTicket({
              text: plain,
              preformatted: true,
              logoUrl,
              restaurantBrand: restaurantThermalBrandLine(printRestaurantInfo) || undefined,
              paperWidth: pw,
            });
            if (!r.ok) toast.error(r.error || 'No se pudo imprimir comprobante SUNAT');
          }
        }
      } else if (chargeToAccount) {
        const clientName = billingForm.customer_name || matchedCustomer?.name || 'cliente';
        toast.success(`${chargedCount} pedido(s) agregados a la cuenta de ${clientName}. Cobre después en Mi Clientes.`);
      } else {
        toast.success(`${chargedCount} pedido(s) cobrados en ${selectedTable.name}`);
      }
      setShowBill(false);
      setSplitMode(false);
      setSelectedOrderItemIds([]);
      setDiscountConfig({ ...EMPTY_DISCOUNT_CONFIG });
      clientCheckoutOpenedKeyRef.current = '';
      setSelectedTable(null);
      setAmountReceived('');
      setMultiPayEnabled(false);
      setMultiPayAmounts(emptyMultiPaymentAmounts());
      setTipPayEnabled(false);
      setCheckoutTipAmount('');
      resetBillingForm();
      loadData();
    } catch (err) { toast.error(err.message); }
  };

  const toggleOrderItemSelection = (itemId) => {
    setSelectedOrderItemIds((prev) =>
      prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId]
    );
  };

  const togglePartialSelection = () => {
    const allItemIds = collectAllOrderItemIds(selectedTable?.orders);
    if (splitMode) {
      setSplitMode(false);
      setSelectedOrderItemIds(allItemIds);
    } else {
      setSplitMode(true);
      setSelectedOrderItemIds(allItemIds);
    }
  };

  const handleDiscountButton = () => {
    if (discountConfig.applied) {
      setDiscountConfig({ ...EMPTY_DISCOUNT_CONFIG });
      toast.success('Descuento anulado');
      return;
    }

    if (!discountConfig.active) {
      setDiscountConfig({ ...EMPTY_DISCOUNT_CONFIG, active: true });
      return;
    }

    const value = parseFloat(discountConfig.value);
    if (Number.isNaN(value) || value <= 0) return toast.error('Ingresa un descuento válido');
    const discountReasonText = String(discountConfig.reason || '').trim();
    if (!discountReasonText) return toast.error('Ingresa el motivo del descuento');
    if (discountReasonText.length < 3) {
      return toast.error('El motivo del descuento debe tener al menos 3 caracteres');
    }

    if (splitMode && discountConfig.target === 'line' && discountConfig.targetOrderItemId) {
      if (!selectedOrderItemIds.includes(discountConfig.targetOrderItemId)) {
        return toast.error('El producto con descuento debe estar incluido en el cobro (marca su casilla).');
      }
    }

    setDiscountConfig((prev) => ({ ...prev, active: false, applied: true }));
    toast.success(
      splitMode && discountConfig.target === 'line' && discountConfig.targetOrderItemId
        ? 'Descuento aplicado al producto'
        : 'Descuento aplicado a la cuenta'
    );
  };

  const applyCourtesyDiscount = () => {
    if (!discountConfig.active || discountConfig.applied) return;
    const motive = String(discountConfig.reason || '').trim();
    if (!motive) {
      toast.error('Ingresa el motivo de la cortesía');
      return;
    }
    if (motive.length < 3) {
      toast.error('El motivo de la cortesía debe tener al menos 3 caracteres');
      return;
    }
    const orders = selectedTable?.orders || [];
    let base = selectionBaseTotal;
    if (splitMode && discountConfig.target === 'line' && discountConfig.targetOrderItemId) {
      const sid = discountConfig.targetOrderItemId;
      if (!selectedOrderItemIds.includes(sid)) {
        toast.error('Marca la línea en el cobro o elige ese producto para cortesía.');
        return;
      }
      base = getOrderItemSubtotalFromOrders(orders, sid);
    }
    if (!(base > 0)) {
      toast.error('Sin monto para cortesía');
      return;
    }
    const courtesyReason = /^cortes[ií]a\s*:/i.test(motive) ? motive : `Cortesía: ${motive}`;
    setDiscountConfig({
      ...EMPTY_DISCOUNT_CONFIG,
      applied: true,
      type: 'amount',
      value: String(roundMoneySoles(base)),
      reason: courtesyReason,
      target: discountConfig.target,
      targetOrderItemId: discountConfig.targetOrderItemId,
    });
    toast.success('Cortesía aplicada');
  };

  const selectDiscountTargetLine = (itemId) => {
    if (!discountConfig.active || discountConfig.applied) return;
    if (!splitMode) return;
    setDiscountConfig((prev) => ({ ...prev, target: 'line', targetOrderItemId: itemId }));
  };

  const selectDiscountTargetWhole = () => {
    if (!discountConfig.active || discountConfig.applied) return;
    setDiscountConfig((prev) => ({ ...prev, target: 'whole', targetOrderItemId: '' }));
  };

  const openMesaTableAction = (type) => {
    if (!tableDetail || isDeliveryCheckoutTable(tableDetail)) return;
    setMesaDetailModalOpen(false);
    setMesaTableAction({ type, sourceId: tableDetail.id, targetId: '' });
  };

  const executeMesaTableAction = async () => {
    if (!mesaTableAction?.type) return;
    const { type, sourceId, targetId } = mesaTableAction;
    const src = tables.find((t) => t.id === sourceId);
    try {
      if (type === 'move') {
        if (!sourceId) return toast.error('Selecciona mesa origen');
        if (!src?.id) return toast.error('La mesa origen ya no está disponible');
        if (!targetId) return toast.error('Selecciona mesa destino');
        if (sourceId === targetId) return toast.error('Origen y destino deben ser diferentes');
        await api.post('/tables/move-orders', { source_table_id: sourceId, target_table_id: targetId });
        toast.success('Pedidos movidos correctamente');
      } else if (type === 'merge') {
        if (!sourceId) return toast.error('Selecciona mesa origen');
        if (!targetId) return toast.error('Selecciona mesa destino');
        if (sourceId === targetId) return toast.error('Origen y destino deben ser diferentes');
        await api.post('/tables/merge', { target_table_id: targetId, source_table_ids: [sourceId] });
        toast.success('Mesas unidas correctamente');
      }
      setMesaTableAction(null);
      await loadData();
    } catch (err) {
      toast.error(err.message || 'No se pudo completar la acción');
    }
  };

  const openMenuForTable = (table) => {
    if (isDeliveryCheckoutTable(table)) return;
    setMesaDetailModalOpen(false);
    setQuickSaleMode(false);
    setEditingOrderId('');
    setEditingSessionOrderIds([]);
    setParaLlevarMesa(false);
    setSelectedTable(table);
    setShowMenu(true);
    resetCart();
    setSearch('');
    setSelectedCat('all');
    setAmountReceived('');
    resetBillingForm();
  };

  /** @returns {boolean} si se abrió el editor */
  const openEditOrderFromToolbar = () => {
    if (!posAdmin) {
      toast.error('Solo un administrador puede modificar o quitar productos de la mesa.');
      return false;
    }
    const list = tableDetail?.orders || [];
    const editable = list.filter((o) => canEditOrderLines(o));
    if (editable.length === 0) {
      if (list.length === 0) {
        toast.error('No hay pedidos para modificar.');
      } else {
        toast.error('Ninguna comanda se puede modificar desde aquí (estado o cobro).');
      }
      return false;
    }
    const sorted = [...editable].sort((a, b) => {
      const na = Number(a.order_number);
      const nb = Number(b.order_number);
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return nb - na;
      return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });
    const primary = sorted[0];
    const initialCart = editable.flatMap((o) => orderItemsToCart(o, productsById));
    editSessionInitialCartRef.current = initialCart.map((row) => ({ ...row }));
    setMesaDetailModalOpen(false);
    setQuickSaleMode(false);
    setEditingSessionOrderIds(editable.map((o) => o.id));
    setEditingOrderId(primary.id);
    setParaLlevarMesa(editable.some((o) => orderHasTakeoutNote(o)));
    setSelectedTable(tableDetail);
    setSearch('');
    setSelectedCat('all');
    setCart(initialCart);
    setShowMenu(true);
    setAmountReceived('');
    resetBillingForm();
    return true;
  };

  const promptMesaRemovalReason = (mode) =>
    new Promise((resolve, reject) => {
      mesaRemovalConfirmRef.current = { resolve, reject, mode };
      setMesaRemovalReason('');
      setMesaRemovalModal({ mode });
    });

  const closeMesaRemovalModal = () => {
    mesaRemovalConfirmRef.current?.reject?.(new Error('cancelled'));
    mesaRemovalConfirmRef.current = null;
    setMesaRemovalModal(null);
    setMesaRemovalReason('');
    setMesaRemovalSubmitting(false);
  };

  const confirmMesaRemovalModal = async () => {
    const reason = String(mesaRemovalReason || '').trim();
    if (reason.length < 3) {
      toast.error('El motivo debe tener al menos 3 caracteres.');
      return;
    }
    setMesaRemovalSubmitting(true);
    try {
      mesaRemovalConfirmRef.current?.resolve?.(reason);
      mesaRemovalConfirmRef.current = null;
      setMesaRemovalModal(null);
      setMesaRemovalReason('');
    } finally {
      setMesaRemovalSubmitting(false);
    }
  };

  const executeMesaOrderCancellations = async (orderIds, reason, tid) => {
    const formatted = formatMesaRemovalReason('Liberar mesa', reason);
    for (const oid of orderIds) {
      await api.put(`/orders/${oid}/status`, {
        status: 'cancelled',
        cancellation_reason: formatted,
      });
    }
    if (
      selectedTable &&
      !isClientCheckoutTable(selectedTable) &&
      !isDeliveryCheckoutTable(selectedTable) &&
      selectedTable.id
    ) {
      const updatedTable = await api.get(`/tables/${selectedTable.id}`);
      const remaining = (updatedTable.orders || []).filter((o) =>
        ['pending', 'preparing', 'ready'].includes(String(o.status || ''))
      );
      if (remaining.length === 0) {
        await api.patch(`/tables/${selectedTable.id}/status`, { status: 'available' });
      }
    }
    toast.success(
      orderIds.length > 1
        ? 'Pedidos anulados. Mesa liberada si no había otros pedidos activos.'
        : 'Pedido anulado. Mesa liberada si no había otros pedidos activos.',
      { id: tid }
    );
    setShowMenu(false);
    setEditingOrderId('');
    setEditingSessionOrderIds([]);
    editSessionInitialCartRef.current = [];
    resetCart();
    loadData();
  };

  const confirmCancelOrder = async (order) => {
    if (!order?.id) return false;
    const ok = window.confirm(`¿Anular el pedido #${order.order_number}? Se devolverá stock si aplica.`);
    if (!ok) return false;
    const tid = toast.loading('Anulando pedido…');
    try {
      await api.put(`/orders/${order.id}/status`, {
        status: 'cancelled',
        cancellation_reason: 'Anulado desde caja',
      });
      toast.success('Pedido anulado', { id: tid });
      await loadData();
      return true;
    } catch (err) {
      toast.error(err.message || 'No se pudo anular', { id: tid });
      return false;
    }
  };

  /** Modificar pedido: carrito vacío → anular pedido y liberar mesa si no quedan pedidos activos. */
  const liberarMesaDesdeEdicionPedidoVacio = async () => {
    if (!editingOrderId || !selectedTable) return;
    if (!posAdmin) {
      toast.error('Solo un administrador puede liberar la mesa.');
      return;
    }
    const idsToCancel =
      editingSessionOrderIds.length > 0 ? editingSessionOrderIds : [editingOrderId];
    let reason = '';
    try {
      reason = await promptMesaRemovalReason('liberar');
    } catch {
      return;
    }
    const tid = toast.loading('Liberando mesa…');
    try {
      await executeMesaOrderCancellations(idsToCancel, reason, tid);
    } catch (err) {
      toast.error(err.message || 'No se pudo completar', { id: tid });
    }
  };

  const guardedUpdateQty = (lineKey, qty) => {
    if (editingOrderId && !posAdmin) {
      toast.error('Solo un administrador puede modificar productos de la mesa.');
      return;
    }
    if (editingOrderId) {
      const line = cart.find((c) => c.line_key === lineKey);
      if (line && qty < Number(line.quantity || 0) && !posAdmin) {
        toast.error('Solo un administrador puede quitar productos de la mesa.');
        return;
      }
    }
    updateQty(lineKey, qty);
  };

  const guardedRemoveFromCart = (lineKey) => {
    if (editingOrderId && !posAdmin) {
      toast.error('Solo un administrador puede quitar productos de la mesa.');
      return;
    }
    removeFromCart(lineKey);
  };

  const openQuickSaleMenu = () => {
    setQuickSaleMode(true);
    setEditingOrderId('');
    setEditingSessionOrderIds([]);
    setParaLlevarMesa(false);
    setSelectedTable(null);
    setPaymentMethod('efectivo');
    setMultiPayEnabled(false);
    setMultiPayAmounts(emptyMultiPaymentAmounts());
    setTipPayEnabled(false);
    setCheckoutTipAmount('');
    setShowMenu(true);
    resetCart();
    setSearch('');
    setSelectedCat('all');
    setAmountReceived('');
    resetBillingForm();
  };

  const receivedAmount = Math.max(0, parseFloat(amountReceived) || 0);
  const quickSaleChange = Math.max(0, receivedAmount - cartTotal);
  const quickSaleMissing = Math.max(0, cartTotal - receivedAmount);

  const showParaLlevarToggle =
    !quickSaleMode &&
    selectedTable &&
    !isClientCheckoutTable(selectedTable) &&
    !isDeliveryCheckoutTable(selectedTable);

  const paraLlevarToggleButton = showParaLlevarToggle ? (
    <button
      type="button"
      onClick={() => setParaLlevarMesa((v) => !v)}
      className={`w-1/2 mx-auto rounded-lg border py-1 px-2 text-xs font-semibold uppercase tracking-wide transition-colors flex items-center justify-center ${
        paraLlevarMesa
          ? 'bg-[var(--ui-accent)] text-white border-transparent shadow-sm'
          : 'border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] text-[#E5E7EB] hover:bg-[var(--ui-sidebar-hover)]'
      }`}
    >
      PARA LLEVAR
    </button>
  ) : null;

  const submitOrder = async () => {
    if (cart.length === 0) {
      if (editingOrderId) {
        if (!posAdmin) {
          return toast.error('Solo un administrador puede liberar la mesa.');
        }
        return void liberarMesaDesdeEdicionPedidoVacio();
      }
      return toast.error('Agrega productos al pedido');
    }
    const missingRequiredNote = cart.find(i => Number(i.note_required || 0) === 1 && !String(i.notes || '').trim());
    if (missingRequiredNote) {
      setNoteEditorLineKey(missingRequiredNote.line_key);
      return toast.error(`"${missingRequiredNote.name}" requiere una nota obligatoria`);
    }
    let quickPayMethod = paymentMethod;
    let quickPayBreakdown = null;
    if (quickSaleMode) {
      if (multiPayEnabled) {
        const o = {};
        for (const opt of multiPaymentOptions) {
          const raw = multiPayAmounts[opt.value];
          if (raw === undefined || raw === '' || String(raw).trim() === '') continue;
          const v = roundMoneySoles(parseFloat(raw));
          if (v > 0) o[opt.value] = v;
        }
        if (Object.keys(o).length < 2) {
          return toast.error('En multimétodo indica al menos dos métodos con monto mayor a cero.');
        }
        const sum = roundMoneySoles(Object.values(o).reduce((s, x) => s + x, 0));
        if (Math.abs(sum - cartTotal) > 0.05) {
          return toast.error(`La suma (${formatCurrency(sum)}) debe coincidir con el total (${formatCurrency(cartTotal)})`);
        }
        quickPayBreakdown = o;
        quickPayMethod = dominantPaymentFromBreakdown(o);
      } else if (paymentMethod === 'efectivo' && receivedAmount < cartTotal) {
        return toast.error(`Monto insuficiente. Falta ${formatCurrency(cartTotal - receivedAmount)}`);
      }
    }
    if (quickSaleMode) {
      const billingError = validateBillingData();
      if (billingError) return toast.error(billingError);
    }
    const tid = toast.loading(
      editingOrderId ? 'Guardando cambios…' : quickSaleMode ? 'Registrando venta…' : 'Enviando pedido…'
    );
    try {
      if (editingOrderId) {
        const noteOrder = paraLlevarMesa ? KITCHEN_TAKEOUT_NOTE : '';
        const sessionIds =
          editingSessionOrderIds.length > 0 ? editingSessionOrderIds : [editingOrderId];
        const byOrder = new Map();
        for (const i of cart) {
          const oid = String(i.source_order_id || editingOrderId);
          if (!byOrder.has(oid)) byOrder.set(oid, []);
          byOrder.get(oid).push(i);
        }
        const willCancelOrders = sessionIds.some((oid) => (byOrder.get(oid) || []).length === 0);
        const hasRemovals = cartHasProductRemovals(editSessionInitialCartRef.current, cart);
        let removalReason = '';
        if (hasRemovals || willCancelOrders) {
          if (!posAdmin) {
            return toast.error('Solo un administrador puede quitar productos o liberar la mesa.');
          }
          try {
            removalReason = await promptMesaRemovalReason(willCancelOrders ? 'liberar' : 'save');
          } catch {
            return;
          }
        }
        const linesPayload = (lines) =>
          lines.map((x) => ({
            product_id: x.product_id,
            quantity: x.quantity,
            modifier_id: x.modifier_id || '',
            modifier_option: x.modifier_option || '',
            notes: String(x.notes || '').trim(),
          }));
        const cancelReason = formatMesaRemovalReason(
          willCancelOrders ? 'Liberar mesa' : 'Productos retirados',
          removalReason
        );
        const updatedOrderIds = [];
        for (const oid of sessionIds) {
          const lines = byOrder.get(oid) || [];
          if (lines.length === 0) {
            await api.put(`/orders/${oid}/status`, {
              status: 'cancelled',
              cancellation_reason: cancelReason,
            });
          } else {
            const body = {
              items: linesPayload(lines),
              notes: noteOrder,
            };
            if (hasRemovals) body.removal_reason = cancelReason;
            await api.put(`/orders/${oid}/lines`, body);
            updatedOrderIds.push(oid);
          }
        }
        toast.success(sessionIds.length > 1 ? 'Pedidos actualizados' : 'Pedido actualizado', { id: tid });
        setShowMenu(false);
        setEditingOrderId('');
        setEditingSessionOrderIds([]);
        editSessionInitialCartRef.current = [];
        resetCart();
        loadData();
        return;
      }
      const createdOrder = await api.post('/orders', {
        items: buildOrderItemsPayload(cart),
        type: quickSaleMode ? 'pickup' : 'dine_in',
        table_number: quickSaleMode ? '' : String(selectedTable.number),
        customer_name: quickSaleMode ? 'VENTA RAPIDA' : `Mesa ${selectedTable.number}`,
        payment_method: quickSaleMode ? quickPayMethod : paymentMethod,
        notes: !quickSaleMode && paraLlevarMesa ? KITCHEN_TAKEOUT_NOTE : '',
      });
      if (quickSaleMode) {
        let doc = null;
        if (billingForm.enabled) {
          doc = await issueElectronicDocument(createdOrder.id);
        }
        const payBody = { payment_method: quickPayMethod, payment_status: 'paid' };
        if (quickPayBreakdown) payBody.payment_breakdown = quickPayBreakdown;
        if (tipPayEnabled) {
          const tipVal = roundMoneySoles(parseFloat(String(checkoutTipAmount).replace(',', '.')) || 0);
          if (tipVal > 0) payBody.tip_amount = tipVal;
        }
        await api.put(`/orders/${createdOrder.id}/payment`, payBody);
        await api.put(`/orders/${createdOrder.id}/status`, { status: 'delivered' });
        if (billingForm.enabled && doc) {
          toast.success(`Venta rápida cobrada · ${billingSuccessSummary(doc)}`, { id: tid });
          if (doc?.pdf_url) window.open(resolveMediaUrl(doc.pdf_url), '_blank', 'noopener,noreferrer');
        } else {
          toast.success('Venta rápida cobrada', { id: tid });
        }
      } else {
        if (createdOrder.merged_into_existing) {
          toast.success(
            `Productos agregados a comanda #${createdOrder.order_number ?? ''}`.trim(),
            { id: tid },
          );
        } else {
          toast.success(`Pedido agregado a ${selectedTable.name}`, { id: tid });
        }
      }
      setShowMenu(false);
      setQuickSaleMode(false);
      resetCart();
      setAmountReceived('');
      setTipPayEnabled(false);
      setCheckoutTipAmount('');
      resetBillingForm();
      loadData();
    } catch (err) {
      const msg = String(err?.message || '').trim();
      toast.error(
        msg && !/^internal server error$/i.test(msg)
          ? msg
          : editingOrderId
            ? 'No se pudo actualizar el pedido. Intente nuevamente.'
            : 'No se pudo enviar el pedido a cocina/bar. Intente nuevamente.',
        { id: tid },
      );
    }
  };

  const registerMovement = async (type) => {
    const amount = parseFloat(movementForm.amount);
    if (Number.isNaN(amount) || amount <= 0) return toast.error('Monto inválido');
    try {
      await api.post('/pos/movements', { type, amount, concept: movementForm.concept, ...posRegisterBody() });
      toast.success(type === 'income' ? 'Ingreso registrado' : 'Egreso registrado');
      setMovementForm({ amount: '', concept: '' });
      await Promise.all([loadData(), loadCajaExtras()]);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const registerNote = async (noteType) => {
    const amount = parseFloat(noteForm.amount);
    if (Number.isNaN(amount) || amount <= 0) return toast.error('Monto inválido');
    try {
      await api.post('/pos/notes', { note_type: noteType, amount, reason: noteForm.reason, ...posRegisterBody() });
      toast.success(noteType === 'credit' ? 'Nota de crédito registrada' : 'Nota de débito registrada');
      setNoteForm({ amount: '', reason: '' });
      loadCajaExtras();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const searchPrices = async () => {
    try {
      const q = priceQuery.trim();
      const result = await api.get(`/pos/price-lookup${q ? `?q=${encodeURIComponent(q)}` : ''}`);
      setPriceResults(result);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const mesaPhysicalTables = useMemo(
    () => (tables || []).filter((t) => !isDeliveryCheckoutTable(t) && !isClientCheckoutTable(t)),
    [tables]
  );
  const occupiedTables = useMemo(
    () => mesaPhysicalTables.filter((t) => t.orders && t.orders.length > 0),
    [mesaPhysicalTables]
  );
  const reservationQueue = useMemo(() => {
    const normalize = (value) => String(value || '').trim().toLowerCase();
    const pendingReservations = (reservations || []).filter((r) => {
      const st = normalize(r.status);
      return !['cancelled', 'completed', 'cancelada', 'completada'].includes(st);
    });
    const isOrderPendingPayment = (o) =>
      String(o.payment_status || '') !== 'paid' &&
      String(o.status || '') !== 'cancelled';

    return pendingReservations.map((reservation) => {
      const marker = `RESERVA_ID:${reservation.id}`;
      const reservationName = normalize(reservation.client_name);
      const reservationDate = String(reservation.date || '');
      const reservationTime = String(reservation.time || '').slice(0, 5);
      const legacyStamp = `Reserva: ${reservationDate}${reservationTime ? ` ${reservationTime}` : ''}`;
      const linkedOrders = (allOrders || []).filter((o) => {
        if (!isOrderPendingPayment(o)) return false;
        const notes = String(o.notes || '');

        // Vinculación exacta (nueva): siempre prioritaria e independiente.
        if (notes.includes(marker)) return true;

        // Compatibilidad con reservas antiguas (antes de RESERVA_ID)
        // Reglas estrictas para no mezclar reservas entre sí:
        // 1) Debe incluir sello completo "Reserva: fecha hora".
        // 2) Debe coincidir cliente (o customer_id si existiera en ambos).
        if (!notes.includes(legacyStamp)) return false;
        const byCustomerId =
          reservation.customer_id &&
          o.customer_id &&
          String(reservation.customer_id).trim() === String(o.customer_id).trim();
        if (byCustomerId) return true;
        const sameCustomer = normalize(o.customer_name) === reservationName;
        return sameCustomer;
      });
      const total = linkedOrders.reduce((sum, o) => sum + getOrderChargeTotal(o), 0);
      return { reservation, linkedOrders, total };
    }).filter((entry) => entry.linkedOrders.length > 0);
  }, [reservations, allOrders]);
  const tablesBySalon = useMemo(
    () => buildTablesBySalon(salonesConfig, mesaPhysicalTables),
    [salonesConfig, mesaPhysicalTables]
  );
  useEffect(() => {
    if (!tablesBySalon.length) {
      setSelectedPosSalon('');
      return;
    }
    setSelectedPosSalon((prev) => {
      const ids = tablesBySalon.map((s) => s.zone);
      return ids.includes(prev) ? prev : ids[0];
    });
  }, [tablesBySalon]);
  const selectedSalonTables = useMemo(() => {
    const entry = tablesBySalon.find((s) => s.zone === selectedPosSalon);
    return entry?.tables || [];
  }, [tablesBySalon, selectedPosSalon]);
  const showReservasStatCard = cajaOptionsForRole.some((o) => o.id === 'reservas');
  const cajaStatGridCols = showReservasStatCard
    ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6'
    : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5';
  const deliveryCajaSlots = useMemo(() => buildDeliveryCajaSlots(allOrders), [allOrders]);
  const filteredProducts = filterOrderingProducts(products, { search, selectedCat });
  const productsById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const registerSales = Number(register?.total_sales || 0);
  const todaySales = registerSales;
  const openingAmt = register?.opening_amount || 0;

  const totalCash = register?.total_cash || 0;
  const totalYape = register?.total_yape || 0;
  const totalPlin = register?.total_plin || 0;
  const totalCard = register?.total_card || 0;
  const totalIncome = register?.total_income || 0;
  const totalExpense = register?.total_expense || 0;
  const expectedCash = register?.expected_cash ?? (openingAmt + totalCash + totalIncome - totalExpense);
  const expectedRounded = roundMoneySoles(expectedCash);

  const closingAmt =
    closingAmount === '' ? 0 : roundMoneySoles(parseFloat(closingAmount) || 0);
  const difference =
    closingAmount === '' ? 0 : roundMoneySoles(closingAmt - expectedRounded);
  const denomTotalRounded = calculateDenominationTotal();
  const denominationMismatch =
    closingAmount !== '' &&
    denomTotalRounded > 0 &&
    Math.abs(denomTotalRounded - closingAmt) >= 0.02;

  /**
   * Totales por método (API) alineados con gestión: mismos ids que pedidos pagados del turno.
   * Incluye filas configuradas en Ajustes y, si hubo ventas «online» sin estar en la lista, una fila extra.
   */
  const registerPaymentRows = useMemo(() => {
    const by = {
      efectivo: Number(register?.total_cash || 0),
      yape: Number(register?.total_yape || 0),
      plin: Number(register?.total_plin || 0),
      tarjeta: Number(register?.total_card || 0),
      online: Number(register?.total_online || 0),
    };
    const opts = paymentOptions || [];
    const rows = opts.map((opt) => ({
      value: opt.value,
      label: opt.label,
      amount: by[opt.value] ?? 0,
    }));
    const hasOnlineRow = rows.some((r) => r.value === 'online');
    if (!hasOnlineRow && by.online > 0) {
      rows.push({
        value: 'online',
        label: PAYMENT_METHODS.online || 'Online',
        amount: by.online,
      });
    }
    return rows;
  }, [register, paymentOptions]);

  const paymentRowAmountClass = (value) => {
    switch (value) {
      case 'efectivo':
        return 'text-emerald-400';
      case 'yape':
        return 'text-fuchsia-400';
      case 'plin':
        return 'text-sky-400';
      case 'tarjeta':
        return 'text-amber-300';
      case 'online':
        return 'text-violet-400';
      default:
        return 'text-[#f9fafb]';
    }
  };

  const arqueoOpeningParts = useMemo(
    () => (closingData?.opened_at ? formatPeDateTimeParts(closingData.opened_at) : { date: '—', time: '—' }),
    [closingData?.opened_at]
  );
  const { arqueoClosingParts, arqueoHeaderDayLabel } = useMemo(() => {
    const inst = closingAtPreview || new Date();
    return {
      arqueoClosingParts: formatPeDateTimeParts(inst),
      arqueoHeaderDayLabel: inst.toLocaleDateString('es-PE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    };
  }, [closingAtPreview]);

  const registerSoldProducts = useMemo(() => {
    const openedAt = closingData?.opened_at || register?.opened_at;
    if (!openedAt) return [];
    const endAt = closingAtPreview || new Date();
    const parseTs = (v) => new Date(String(v || '').includes('T') ? v : `${v}Z`).getTime();
    const openedMs = parseTs(openedAt);
    const endMs = endAt.getTime();
    const map = new Map();
    for (const order of allOrders || []) {
      if (String(order.status || '') === 'cancelled') continue;
      if (String(order.payment_status || '') !== 'paid') continue;
      const eventMs = parseTs(order.updated_at || order.created_at);
      if (eventMs < openedMs || eventMs > endMs) continue;
      for (const item of order.items || []) {
        const key = `${item.product_id}|${item.product_name}`;
        const prev = map.get(key) || {
          product_id: item.product_id,
          product_name: item.product_name || 'Producto',
          total_qty: 0,
          total_amount: 0,
        };
        prev.total_qty += Number(item.quantity) || 0;
        prev.total_amount += Number(item.subtotal) || 0;
        map.set(key, prev);
      }
    }
    return [...map.values()]
      .map((row) => ({
        ...row,
        unit_price: row.total_qty > 0 ? row.total_amount / row.total_qty : 0,
      }))
      .sort((a, b) => String(a.product_name).localeCompare(String(b.product_name), 'es'));
  }, [allOrders, closingData?.opened_at, register?.opened_at, closingAtPreview]);

  const selectionBaseTotal = useMemo(() => {
    if (!selectedTable) return 0;
    const orders = selectedTable.orders || [];
    if (!splitMode) {
      return orders.reduce((sum, o) => sum + getOrderChargeTotal(o), 0);
    }
    return computeTableSplitSelectionBase(orders, selectedOrderItemIds);
  }, [selectedTable, splitMode, selectedOrderItemIds]);

  const splitBillLines = useMemo(() => {
    if (!selectedTable || !splitMode) return [];
    const rows = [];
    for (const o of selectedTable.orders || []) {
      for (const it of o.items || []) {
        const qty = Number(it.quantity || 0);
        const unit = Number(it.unit_price ?? 0);
        const sub = Number(it.subtotal != null ? it.subtotal : unit * qty);
        rows.push({
          id: it.id,
          orderNumber: o.order_number,
          name: billLineDisplayName(it),
          qty,
          unit,
          sub,
        });
      }
    }
    return rows;
  }, [selectedTable, splitMode]);

  const discountTargetLabel = useMemo(() => {
    if (!discountConfig.active && !discountConfig.applied) return '';
    if (
      discountConfig.target !== 'line' ||
      !String(discountConfig.targetOrderItemId || '').trim() ||
      !splitMode
    ) {
      return 'Cuenta completa';
    }
    const line = splitBillLines.find((l) => l.id === discountConfig.targetOrderItemId);
    return line ? line.name : 'Producto seleccionado';
  }, [
    discountConfig.active,
    discountConfig.applied,
    discountConfig.target,
    discountConfig.targetOrderItemId,
    splitMode,
    splitBillLines,
  ]);

  const discountAmountBase = useMemo(
    () =>
      resolveAppliedDiscountBase(
        selectedTable?.orders || [],
        selectedOrderItemIds,
        splitMode,
        discountConfig,
        selectionBaseTotal
      ),
    [
      selectedTable,
      selectedOrderItemIds,
      splitMode,
      discountConfig.applied,
      discountConfig.target,
      discountConfig.targetOrderItemId,
      selectionBaseTotal,
    ]
  );

  const discountValue = Math.max(0, parseFloat(discountConfig.value) || 0);
  const discountPreview = !discountConfig.applied
    ? 0
    : (discountConfig.type === 'percent'
      ? Math.min(discountAmountBase, discountAmountBase * (discountValue / 100))
      : Math.min(discountAmountBase, discountValue));
  const payableTotal = Math.max(0, selectionBaseTotal - discountPreview);
  const multiPaySumProof = useMemo(
    () =>
      roundMoneySoles(
        multiPaymentOptions.reduce((s, o) => {
          const v = parseFloat(multiPayAmounts[o.value] || '0');
          return s + (Number.isFinite(v) && v > 0 ? v : 0);
        }, 0)
      ),
    [multiPaymentOptions, multiPayAmounts]
  );
  const billLineItemsGrouped = useMemo(() => {
    if (!selectedTable) return [];
    const orders = selectedTable.orders || [];
    if (splitMode) {
      const set = new Set(selectedOrderItemIds);
      const picked = [];
      for (const o of orders) {
        for (const it of o.items || []) {
          if (set.has(it.id)) picked.push(it);
        }
      }
      return groupItemsByProductNameForBill(picked);
    }
    return groupItemsByProductNameForBill(orders.flatMap((o) => o.items || []));
  }, [selectedTable, splitMode, selectedOrderItemIds]);
  const occupiedHours = (() => {
    const timestamps = (selectedTable?.orders || [])
      .map(o => o.created_at)
      .filter(Boolean)
      .map(v => new Date(`${v}Z`).getTime())
      .filter(Boolean);
    if (timestamps.length === 0) return 0;
    const first = Math.min(...timestamps);
    return Math.max(0, Math.round((Date.now() - first) / (1000 * 60 * 60)));
  })();
  const printPrecuenta = async (tableOverride = null) => {
    const table = tableOverride || selectedTable;
    if (!table) return;
    const useSplit = !tableOverride && splitMode;
    let payableOrders;
    let groupedPrecuenta;
    if (useSplit) {
      const set = new Set(selectedOrderItemIds);
      const itemsFlat = [];
      payableOrders = [];
      for (const o of table.orders || []) {
        const picks = (o.items || []).filter((it) => set.has(it.id));
        if (picks.length) {
          itemsFlat.push(...picks);
          payableOrders.push(o);
        }
      }
      if (!itemsFlat.length) return toast.error('Selecciona al menos una línea para la precuenta');
      groupedPrecuenta = groupItemsByProductNameForBill(itemsFlat);
    } else {
      payableOrders = table.orders || [];
      if (payableOrders.length === 0) return toast.error('No hay pedidos para precuenta');
      groupedPrecuenta = groupItemsByProductNameForBill(payableOrders.flatMap((o) => o.items || []));
    }
    const mozoName =
      [...new Set(payableOrders.map((o) => String(o.created_by_user_name || '').trim()).filter(Boolean))].join(', ')
      || String(user?.full_name || '').trim()
      || '—';
    const customerLines = [
      billingForm.customer_name && `Cliente: ${billingForm.customer_name}`,
      billingForm.customer_doc_number && `Doc: ${billingForm.customer_doc_number}`,
      billingForm.customer_phone && `Tel: ${billingForm.customer_phone}`,
      billingForm.customer_address && `Dir: ${billingForm.customer_address}`,
    ].filter(Boolean);
    const ordersSubtotal = useSplit
      ? computeTableSplitSelectionBase(table.orders, selectedOrderItemIds)
      : payableOrders.reduce((sum, o) => sum + getOrderChargeTotal(o), 0);
    const discBase = resolveAppliedDiscountBase(
      table.orders || [],
      useSplit ? selectedOrderItemIds : [],
      useSplit,
      discountConfig,
      ordersSubtotal
    );
    const discountForPrecuenta = !discountConfig.applied
      ? 0
      : (discountConfig.type === 'percent'
        ? Math.min(discBase, discBase * (discountValue / 100))
        : Math.min(discBase, discountValue));
    const payableForPrecuenta = Math.max(0, ordersSubtotal - discountForPrecuenta);
    const widthMm = cajaPaperWidthMm;
    const plain = buildPrecuentaPlainText({
      restaurant: printRestaurantInfo,
      tableName: table.name,
      mozoName,
      customerLines,
      groupedRows: groupedPrecuenta,
      formatCurrencyFn: formatCurrency,
      subtotal: ordersSubtotal,
      discount: discountForPrecuenta,
      payableTotal: payableForPrecuenta,
      widthMm,
      printedAt: new Date(),
    });
    const r = await printCajaTicket({
      text: plain,
      preformatted: true,
      logoUrl: String(printRestaurantInfo.logo || '').trim() || undefined,
      restaurantBrand: restaurantThermalBrandLine(printRestaurantInfo) || undefined,
      paperWidth: widthMm,
    });
    if (r.ok) {
      toast.success(`Precuenta impresa · ${getThermalPrintRevision()}`);
    } else toast.error(r.error || 'No se pudo imprimir precuenta');
  };

  const printNotaVenta = async ({
    tableName,
    orders,
    docs,
    customer,
    paymentMethod: paymentMethodArg,
    discountTotal = 0,
  }) => {
    const docText = (docs || []).map((d) => String(d?.full_number || '').trim()).filter(Boolean).join(' · ');
    const groupedNota = groupItemsByProductNameForBill((orders || []).flatMap((o) => o.items || []));
    const total = (orders || []).reduce((sum, o) => sum + getOrderChargeTotal(o), 0);
    const subtotalLines = groupedNota.reduce((s, g) => s + Number(g.subtotal != null ? g.subtotal : 0), 0);
    const customerLines = [
      customer?.name && `Nombre: ${customer.name}`,
      customer?.doc_number && `DNI / RUC: ${customer.doc_number}`,
      customer?.phone && `Tel: ${customer.phone}`,
      customer?.address && `Dir: ${customer.address}`,
    ].filter(Boolean);
    const widthMm = cajaPaperWidthMm;
    const plain = buildNotaVentaPlainText({
      restaurant: printRestaurantInfo,
      docLine: docText,
      tableName: tableName || '',
      customerLines,
      groupedRows: groupedNota,
      formatCurrencyFn: formatCurrency,
      subtotal: subtotalLines,
      total,
      discount: discountTotal,
      widthMm,
      printedAt: new Date(),
      paymentMethod: paymentMethodArg || paymentMethod || 'efectivo',
    });
    const r = await printCajaTicket({
      text: plain,
      preformatted: true,
      logoUrl: String(printRestaurantInfo.logo || '').trim() || undefined,
      restaurantBrand: restaurantThermalBrandLine(printRestaurantInfo) || undefined,
      paperWidth: widthMm,
    });
    if (r.ok) {
      toast.success('Nota de venta impresa');
    } else {
      toast.error(r.error || 'No se pudo imprimir nota de venta');
    }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin w-8 h-8 border-4 border-gold-500 border-t-transparent rounded-full" /></div>;

  const printTableOrder = async (table) => {
    if (!table) return;
    const groupedTable = mergedProductsOnTable(table);
    if (!groupedTable.length) return toast.error('La mesa no tiene pedidos para precuenta');
    const tableTotal = (table.orders || []).reduce((sum, o) => sum + getOrderChargeTotal(o), 0);
    const mozoNameTbl =
      [...new Set((table.orders || []).map((o) => String(o.created_by_user_name || '').trim()).filter(Boolean))].join(', ')
      || String(user?.full_name || '').trim()
      || '—';
    const customerLines = [
      billingForm.customer_name && `Cliente: ${billingForm.customer_name}`,
      billingForm.customer_doc_number && `Doc: ${billingForm.customer_doc_number}`,
      billingForm.customer_phone && `Tel: ${billingForm.customer_phone}`,
      billingForm.customer_address && `Dir: ${billingForm.customer_address}`,
    ].filter(Boolean);
    const widthMm = cajaPaperWidthMm;
    const plain = buildPrecuentaPlainText({
      restaurant: printRestaurantInfo,
      tableName: table.name,
      mozoName: mozoNameTbl,
      customerLines,
      groupedRows: groupedTable,
      formatCurrencyFn: formatCurrency,
      subtotal: tableTotal,
      discount: 0,
      payableTotal: tableTotal,
      widthMm,
      printedAt: new Date(),
    });
    const r = await printCajaTicket({
      text: plain,
      preformatted: true,
      logoUrl: String(printRestaurantInfo.logo || '').trim() || undefined,
      restaurantBrand: restaurantThermalBrandLine(printRestaurantInfo) || undefined,
      paperWidth: widthMm,
    });
    if (r.ok) toast.success('Acción completada');
    else toast.error(r.error || 'No se pudo imprimir');
  };
  const chargeReservation = async (entry) => {
    const orders = entry?.linkedOrders || [];
    if (!orders.length) return toast.error('Esta reserva no tiene pedidos pendientes para cobrar');
    try {
      await api.post('/pos/checkout-table', {
        ...posRegisterBody(),
        order_ids: orders.map(o => o.id),
        payment_method: paymentMethod || 'efectivo',
      });
      await api.put(`/admin-modules/reservations/${entry.reservation.id}`, { status: 'completed' }).catch(() => {});
      toast.success(`Reserva de ${entry.reservation.client_name} cobrada correctamente`);
      loadData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  /** Botones de acciones del detalle de mesa (tema app, sin fondos fijos claros). */
  const mesaMapActionBtnClass =
    'flex-1 min-w-0 basis-0 min-h-[44px] shrink-0 px-1 sm:px-2 py-2 rounded-lg text-[11px] sm:text-sm font-semibold border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] shadow-sm hover:bg-[var(--ui-sidebar-hover)] transition-colors inline-flex items-center justify-center gap-1 text-center leading-tight disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[var(--ui-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ui-surface)]';
  /** Cobrar: acento del tema activo (misma idea que .btn-primary). */
  const mesaMapCobrarBtnClass =
    'flex-1 min-w-0 basis-0 min-h-[44px] shrink-0 px-1 sm:px-2 py-2 rounded-xl text-[11px] sm:text-sm font-bold border border-[color:color-mix(in_srgb,var(--ui-accent-muted)_45%,transparent)] uppercase tracking-wide text-white bg-[var(--ui-accent)] shadow-md hover:bg-[var(--ui-accent-hover)] inline-flex items-center justify-center gap-1 text-center leading-tight disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[var(--ui-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ui-surface)]';

  const cajaRequiresRegisterNotice = (
    <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-4">
      Abra un turno de caja para registrar operaciones en este submodulo.
    </p>
  );

  const renderOpenRegisterScreen = () => {
    const isAdmin = String(user?.role || '').toLowerCase() === 'admin';
    if (isAdmin) {
      return (
        <div className="flex items-center justify-center py-12 px-4">
          <div className="card max-w-3xl w-full">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
              <div>
                <MdPointOfSale className="text-5xl text-gold-500 mb-2" />
                <h2 className="text-xl font-bold text-[var(--ui-body-text)]">Cajas del local</h2>
                <p className="text-sm ui-text-muted">
                  AGREGUE EL MONTO DE APERTURA PARA ABRIR UN TURNO DE CAJA O SELECCIONE UN TURNO YA ABIERTO PARA INSPECCIONAR.
                </p>
              </div>
              {String(adminRegisterId || '').trim() ? (
                <button
                  type="button"
                  onClick={() => void clearAdminRegisterContext()}
                  className="btn-secondary text-sm shrink-0"
                >
                  Quitar selección
                </button>
              ) : null}
            </div>

            <div className="mb-6 text-left">
              <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Monto de apertura (nuevos turnos)</label>
              <div className="relative max-w-xs">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ui-muted)] font-medium">S/</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={openingAmount}
                  onChange={(e) => setOpeningAmount(e.target.value)}
                  placeholder="0.00"
                  className="input-field pl-10 text-lg font-bold text-center"
                />
              </div>
              <p className="text-xs text-[var(--ui-muted)] mt-1">Se usa al pulsar «Abrir turno» en una caja sin sesión activa.</p>
            </div>

            {!cajaStations.length ? (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                No hay cajas activas en configuración. Defínalas en <strong>Configuración → Cajas</strong>.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {cajaStations.map((st) => {
                  const op = st.open_register;
                  return (
                    <div
                      key={st.id}
                      className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-left flex flex-col gap-3"
                    >
                      <div>
                        <p className="font-semibold rf-section-title">{st.name}</p>
                        {op ? (
                          <p className="text-xs ui-text-muted mt-1">
                            Turno abierto · {op.cajero_name || 'Usuario'}{' '}
                            {op.opened_at ? `· ${formatPeDateTimeLine(op.opened_at)}` : ''}
                          </p>
                        ) : (
                          <p className="text-xs ui-text-muted mt-1">Sin turno abierto</p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2 mt-auto">
                        {op ? (
                          <button
                            type="button"
                            onClick={() => void attachAdminToRegister(op.id)}
                            className="btn-primary text-sm flex items-center gap-1"
                          >
                            <MdPointOfSale /> Operar esta caja
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void openStationRegisterForAdmin(st.id)}
                            disabled={openingAmount === ''}
                            className="btn-primary text-sm flex items-center gap-1 disabled:opacity-50"
                          >
                            <MdPointOfSale /> Abrir turno
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="flex items-center justify-center py-20">
        <div className="card text-center max-w-md">
          <MdPointOfSale className="text-6xl text-gold-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">Abrir Caja</h2>
          {cajaStations[0]?.name ? (
            <p className="text-sm text-[var(--ui-muted)] mb-2">
              Caja asignada: <span className="font-semibold rf-section-title">{cajaStations[0].name}</span>
            </p>
          ) : null}
          <p className="ui-text-muted mb-6">Ingresa el monto inicial y abre la caja para comenzar a operar</p>

          <div className="mb-4 text-left">
            <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Monto de apertura</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ui-muted)] font-medium">S/</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={openingAmount}
                onChange={(e) => setOpeningAmount(e.target.value)}
                placeholder="0.00"
                className="input-field pl-10 text-lg font-bold text-center"
                autoFocus
              />
            </div>
            <p className="text-xs text-[var(--ui-muted)] mt-1">Dinero en efectivo al iniciar el turno</p>
          </div>

          <button
            type="button"
            onClick={() => void openRegisterForCajero()}
            disabled={openingAmount === ''}
            className="btn-primary w-full py-3 text-lg flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <MdPointOfSale /> Abrir Caja
          </button>
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="mb-4 -mt-4">
      {activeCajaOption === 'cobrar' && (
        register ? (
        <>
      <div className="flex flex-wrap items-center justify-between mb-3 gap-2">
        <div
          className={`inline-flex items-center justify-center w-9 h-9 rounded-full border ${
            billingStatus.provider_reachable
              ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
              : 'bg-red-50 border-red-200 text-red-600'
          }`}
          title={billingStatus.provider_reachable ? 'En línea' : 'Sin conexión'}
        >
          {billingStatus.provider_reachable ? <MdCheckCircle className="text-xl" /> : <MdClose className="text-xl" />}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {showDeliveryUi ? (
            <button
              type="button"
              onClick={() => {
                const el = document.getElementById('pos-delivery-caja');
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                if (!deliveryCajaSlots.length) {
                  toast.error('No hay pedidos delivery pendientes de cobro');
                }
              }}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-colors border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 inline-flex items-center justify-center gap-1.5"
            >
              <MdDeliveryDining className="text-base shrink-0" />
              Delivery
            </button>
          ) : null}
          <button
            type="button"
            onClick={openQuickSaleMenu}
            className="px-4 py-2 rounded-lg bg-[#2563EB] text-white hover:bg-[#1D4ED8] font-medium text-sm inline-flex items-center gap-2"
          >
            <MdPointOfSale className="text-base" /> Venta rápida
          </button>
        </div>
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-700 flex items-center gap-2 text-base sm:text-lg">
          <MdTableRestaurant /> Mapa de mesas
        </h2>
      </div>

      {tablesBySalon.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {tablesBySalon.map(({ zone, label, tables: salonTables }) => {
            const active = selectedPosSalon === zone;
            return (
              <button
                key={zone}
                type="button"
                onClick={() => setSelectedPosSalon(zone)}
                className={`rounded-lg px-3 py-2 text-xs sm:text-sm font-medium border transition-colors ${
                  active
                    ? 'border-[color:var(--ui-border)] bg-[var(--ui-accent)] text-white shadow-sm'
                    : 'border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]'
                }`}
              >
                {label}
                <span className={`ml-1.5 tabular-nums ${active ? 'text-white/90' : 'text-[var(--ui-muted)]'}`}>
                  ({salonTables.length})
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="min-w-0 space-y-6 mb-4">
        {selectedSalonTables.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
            {selectedSalonTables.map((table) => {
              const isOccupied = Boolean(table.orders && table.orders.length > 0);
              const isSelected = tableDetail?.id === table.id;
              return (
                <button
                  key={table.id}
                  type="button"
                  onClick={() => {
                    setTableDetail(table);
                    setMesaDetailModalOpen(true);
                  }}
                  className={`card text-left transition-all border-l-4 hover:shadow-lg h-full min-h-[7.25rem] ${
                    isOccupied ? 'border-l-red-500' : 'border-l-lime-500'
                  } ${isSelected ? 'ring-2 ring-gold-400' : ''}`}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                        isOccupied ? 'bg-red-100' : 'bg-emerald-100'
                      }`}
                    >
                      <MdTableRestaurant className={`${isOccupied ? 'text-red-600' : 'text-emerald-600'} text-xl`} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold rf-section-title truncate">{table.name}</p>
                      <p className="text-xs ui-text-muted">
                        {isOccupied ? `${table.orders.length} pedido(s)` : 'Sin pedidos activos'}
                      </p>
                    </div>
                  </div>
                  <p className={`text-xs font-semibold ${isOccupied ? 'text-red-700' : 'text-emerald-700'}`}>
                    {isOccupied ? 'Ocupada' : 'Libre'}
                  </p>
                </button>
              );
            })}
          </div>
        ) : tablesBySalon.length === 0 ? (
          <p className="text-sm text-center text-[var(--ui-muted)] py-8">No hay mesas configuradas</p>
        ) : (
          <p className="text-sm text-center text-[var(--ui-muted)] py-8">No hay mesas en esta zona</p>
        )}

        {showDeliveryUi && deliveryCajaSlots.length > 0 && (
          <>
            <h2
              id="pos-delivery-caja"
              className="font-semibold text-slate-700 mb-2 flex items-center gap-2 scroll-mt-4"
            >
              <MdDeliveryDining /> Delivery en caja
            </h2>
            <p className="text-sm ui-text-muted mb-3">
              Un recuadro por pedido delivery pendiente de cobro. Al cobrar, desaparece de esta lista.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
              {deliveryCajaSlots.map((slot) => {
                const isSelected = tableDetail?.id === slot.id;
                return (
                  <button
                    key={slot.id}
                    type="button"
                    onClick={() => {
                      setTableDetail(slot);
                      setMesaDetailModalOpen(true);
                    }}
                    className={`card text-left transition-all border-l-4 border-l-sky-500 hover:shadow-lg bg-slate-50/80 ${
                      isSelected ? 'ring-2 ring-gold-400' : ''
                    }`}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-sky-100">
                        <MdDeliveryDining className="text-sky-700 text-xl" />
                      </div>
                      <div>
                        <p className="font-bold rf-section-title">{slot.name}</p>
                        <p className="text-xs ui-text-muted">Pedido #{slot.orders?.[0]?.order_number ?? '—'}</p>
                      </div>
                    </div>
                    <p className="text-xs font-semibold text-sky-800">
                      Por cobrar · {formatCurrency((slot.orders || []).reduce((s, o) => s + getOrderChargeTotal(o), 0))}
                    </p>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {mesaDetailModalOpen && tableDetail && (
        <div className="fixed top-14 left-0 right-0 bottom-0 z-[200] flex min-h-0">
          <button
            type="button"
            className="min-h-0 min-w-0 flex-1 cursor-default border-0 bg-black/40 p-0"
            aria-label="Cerrar panel"
            onClick={() => setMesaDetailModalOpen(false)}
          />
          <div
            className="flex h-full min-h-0 w-full min-w-0 shrink-0 flex-col border-l border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-body-text)] shadow-2xl md:w-1/2 md:max-w-[920px]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pos-mesa-detail-title"
          >
          <div className="flex items-center justify-between gap-3 shrink-0 border-b border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] px-3 py-2.5 sm:px-4">
            <h2 id="pos-mesa-detail-title" className="font-semibold flex items-center gap-2 text-base sm:text-lg min-w-0 truncate text-[var(--ui-body-text)]">
              <MdTableRestaurant className="shrink-0 text-[var(--ui-accent-muted)]" />
              <span className="truncate">{tableDetail.name}</span>
            </h2>
            <button
              type="button"
              onClick={() => setMesaDetailModalOpen(false)}
              className="shrink-0 rounded-lg p-2 text-[var(--ui-muted)] hover:bg-[var(--ui-sidebar-hover)] hover:text-[var(--ui-body-text)] transition-colors"
              aria-label="Cerrar"
            >
              <MdClose className="text-2xl" />
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3 sm:p-4 lg:p-5">
            <div className="flex w-full max-w-full flex-col gap-3">
              <div className="flex items-start justify-between gap-3 border-b border-[color:var(--ui-border)] pb-3">
                <div className="min-w-0">
                  <p className="text-xs text-[var(--ui-muted)]">
                    {isDeliveryCheckoutTable(tableDetail)
                      ? (() => {
                          const o = tableDetail.orders?.[0];
                          if (!o) return 'Sin pedido';
                          return [o.customer_name, o.delivery_address].filter(Boolean).join(' · ') || 'Delivery';
                        })()
                      : tableDetail.orders?.length
                        ? `${tableDetail.orders.length} pedido(s) activo(s)`
                        : 'Sin pedidos activos'}
                  </p>
                </div>
                <p className="text-xl font-bold text-[var(--ui-accent-muted)] shrink-0 tabular-nums">
                  {formatCurrency((tableDetail.orders || []).reduce((sum, o) => sum + getOrderChargeTotal(o), 0))}
                </p>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] p-3 text-[var(--ui-body-text)]">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ui-muted)] mb-2">Productos en la mesa</p>
                {(() => {
                  const lines = mergedProductsOnTable(tableDetail);
                  const totalMesa = (tableDetail.orders || []).reduce((s, o) => s + getOrderChargeTotal(o), 0);
                  if (!lines.length) {
                    return <p className="text-center text-[var(--ui-muted)] py-6 text-sm">No hay productos para mostrar.</p>;
                  }
                  return (
                    <>
                      <ul className="space-y-1.5 text-sm">
                        {lines.map((row) => (
                          <li
                            key={row.key}
                            className="flex justify-between gap-2 border-b border-[color:var(--ui-border)] pb-1.5 last:border-0 last:pb-0"
                          >
                            <span className="min-w-0">
                              <span className="font-medium text-[var(--ui-body-text)]">{row.name}</span>
                              <span className="text-[var(--ui-muted)]"> × {row.qty}</span>
                            </span>
                            <span className="shrink-0 tabular-nums font-medium text-[var(--ui-accent-muted)]">
                              {formatCurrency(row.subtotal)}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <div className="flex justify-between border-t border-[color:var(--ui-border)] pt-3 mt-3 text-base font-bold text-[var(--ui-body-text)]">
                        <span>Total</span>
                        <span className="text-[var(--ui-accent-muted)]">{formatCurrency(totalMesa)}</span>
                      </div>
                    </>
                  );
                })()}
              </div>

              <div className="flex flex-nowrap gap-2 shrink-0 min-h-[48px] overflow-x-auto pb-1 pt-1">
                {!isDeliveryCheckoutTable(tableDetail) && (
                  <button
                    type="button"
                    onClick={() => openMenuForTable(tableDetail)}
                    className={mesaMapActionBtnClass}
                  >
                    <MdRestaurantMenu className="shrink-0 text-lg" />
                    <span className="truncate">Tomar pedido</span>
                  </button>
                )}
                <button
                  type="button"
                  title={posAdmin ? 'Modificar pedido' : 'Solo administrador'}
                  onClick={openEditOrderFromToolbar}
                  disabled={
                    !posAdmin ||
                    !tableDetail.orders?.length ||
                    isClientCheckoutTable(tableDetail) ||
                    !(tableDetail.orders || []).some((o) => canEditOrderLines(o))
                  }
                  className={mesaMapActionBtnClass}
                >
                  <MdEdit className="shrink-0 text-lg" />
                  <span className="truncate">Modificar pedido</span>
                </button>
                {!isDeliveryCheckoutTable(tableDetail) && (
                  <button
                    type="button"
                    onClick={() => openMesaTableAction('move')}
                    className={mesaMapActionBtnClass}
                  >
                    <MdSwapHoriz className="shrink-0 text-lg" />
                    <span className="truncate">Mover</span>
                  </button>
                )}
                {!isDeliveryCheckoutTable(tableDetail) && (
                  <button
                    type="button"
                    onClick={() => openMesaTableAction('merge')}
                    className={mesaMapActionBtnClass}
                  >
                    <MdMerge className="shrink-0 text-lg" />
                    <span className="truncate">Unir</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTable(tableDetail);
                    void printPrecuenta(tableDetail);
                  }}
                  disabled={!tableDetail.orders?.length}
                  className={mesaMapActionBtnClass}
                >
                  <MdPrint className="shrink-0 text-lg" />
                  <span className="truncate">Pre cuenta</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMesaDetailModalOpen(false);
                    setSelectedTable(tableDetail);
                    setShowBill(true);
                    setPaymentMethod('efectivo');
                    setAmountReceived('');
                    setSplitMode(false);
                    setSelectedOrderItemIds(collectAllOrderItemIds(tableDetail.orders));
                    setDiscountConfig({ ...EMPTY_DISCOUNT_CONFIG });
                  }}
                  disabled={!tableDetail.orders?.length}
                  className={mesaMapCobrarBtnClass}
                >
                  <MdAttachMoney className="shrink-0 text-lg" />
                  <span className="truncate">{isDeliveryCheckoutTable(tableDetail) ? 'Cobrar delivery' : 'Cobrar'}</span>
                </button>
              </div>
            </div>
          </div>
          </div>
        </div>
      )}

      <div className={`grid ${cajaStatGridCols} gap-3 w-full`}>
        {showReservasStatCard && (
        <button
          type="button"
          onClick={() => openCajaView('reservas')}
          className="card flex flex-col items-center justify-center text-center gap-2 p-4 min-h-[5.5rem] hover:border-indigo-300"
        >
          <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
            <MdReceipt className="text-indigo-600 text-xl" />
          </div>
          <div>
            <p className="text-xs ui-text-muted">Reservas</p>
            <p className="text-xl font-bold text-indigo-700">{reservationQueue.length}</p>
          </div>
        </button>
        )}
        <div className="card flex flex-col items-center justify-center text-center gap-2 p-4 min-h-[5.5rem]">
          <div className="w-10 h-10 bg-sky-100 rounded-xl flex items-center justify-center">
            <MdTableRestaurant className="text-sky-600 text-xl" />
          </div>
          <div>
            <p className="text-xs ui-text-muted">Total Mesas</p>
            <p className="text-xl font-bold">{mesaPhysicalTables.length}</p>
          </div>
        </div>
        <div className="card flex flex-col items-center justify-center text-center gap-2 p-4 min-h-[5.5rem]">
          <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center">
            <MdPeople className="text-red-600 text-xl" />
          </div>
          <div>
            <p className="text-xs ui-text-muted">Ocupadas</p>
            <p className="text-xl font-bold text-red-600">{occupiedTables.length}</p>
          </div>
        </div>
        <div className="card flex flex-col items-center justify-center text-center gap-2 p-4 min-h-[5.5rem]">
          <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
            <MdCheckCircle className="text-emerald-600 text-xl" />
          </div>
          <div>
            <p className="text-xs ui-text-muted">Disponibles</p>
            <p className="text-xl font-bold text-emerald-600">{mesaPhysicalTables.length - occupiedTables.length}</p>
          </div>
        </div>
        <div className="card flex flex-col items-center justify-center text-center gap-2 p-4 min-h-[5.5rem]">
          <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
            <MdAttachMoney className="text-emerald-600 text-xl" />
          </div>
          <div>
            <p className="text-xs text-emerald-600">Ventas del día</p>
            <p className="text-xl font-bold text-emerald-700">{formatCurrency(todaySales)}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={prepareClose}
          disabled={!register}
          className="card flex flex-col items-center justify-center text-center gap-2 p-4 min-h-[5.5rem] hover:border-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center">
            <MdClose className="text-red-600 text-xl" />
          </div>
          <p className="text-base sm:text-xl font-bold text-red-700 leading-tight">Cerrar Caja</p>
        </button>
      </div>
        </>
        ) : (
          renderOpenRegisterScreen()
        )
      )}

      {activeCajaOption === 'reservas' && (
        <div className="card">
          {!register ? cajaRequiresRegisterNotice : null}
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold rf-section-title">Reservas para cobro</h3>
            <span className="text-xs ui-text-muted">Total: {reservationQueue.length}</span>
          </div>
          {reservationQueue.length === 0 ? (
            <p className="ui-text-muted">No hay reservas pendientes.</p>
          ) : (
            <div className="space-y-3">
              {reservationQueue.map((entry) => (
                <div key={entry.reservation.id} className="border border-slate-200 rounded-lg p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold rf-section-title">{entry.reservation.client_name}</p>
                      <p className="text-xs ui-text-muted">{entry.reservation.date} · {entry.reservation.time} · {entry.reservation.guests} comensales</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs ui-text-muted">Total pedido</p>
                      <p className="font-bold text-emerald-700">{formatCurrency(entry.total)}</p>
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-[var(--ui-muted)]">
                    {entry.reservation.notes || 'Sin nota adicional'}
                  </div>
                  <div className="mt-3 flex justify-end">
                    <button
                      onClick={() => chargeReservation(entry)}
                      disabled={!register || !entry.linkedOrders.length}
                      className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {entry.linkedOrders.length ? 'Cobrar reserva' : 'Sin pedido para cobrar'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeCajaOption === 'apertura_cierre' && (
        register ? (
          <div className="card">
            <h3 className="font-bold rf-section-title mb-4">Apertura y cierre</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
              <div className="rf-surface-light rounded-lg p-3"><p className="text-xs ui-text-muted">Apertura</p><p className="font-bold">{formatCurrency(openingAmt)}</p></div>
              <div className="rf-surface-light rounded-lg p-3"><p className="text-xs ui-text-muted">Efectivo esperado</p><p className="font-bold">{formatCurrency(expectedRounded)}</p></div>
              <div className="rf-surface-light rounded-lg p-3"><p className="text-xs ui-text-muted">Ventas del turno</p><p className="font-bold">{formatCurrency(registerSales)}</p></div>
            </div>
            <button onClick={prepareClose} className="btn-primary">Ir al cierre de caja</button>
          </div>
        ) : (
          renderOpenRegisterScreen()
        )
      )}

      {activeCajaOption === 'cierres_caja' && (
        <div className="card">
          <h3 className="font-bold rf-section-title mb-4">Historial de cierres de caja</h3>
          {!registerHistory.length ? (
            <p className="ui-text-muted">No hay cierres registrados.</p>
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b"><th className="text-left py-2">Cajero</th><th className="text-left py-2">Apertura</th><th className="text-left py-2">Cierre</th><th className="text-right py-2">Ventas</th></tr></thead>
              <tbody>
                {registerHistory.map(r => (
                  <tr key={r.id} className="border-b border-slate-50">
                    <td className="py-2">{r.user_name}</td>
                    <td className="py-2">{r.opened_at ? formatPeDateTimeLine(r.opened_at) : '-'}</td>
                    <td className="py-2">{r.closed_at ? formatPeDateTimeLine(r.closed_at) : 'Abierta'}</td>
                    <td className="py-2 text-right font-semibold">{formatCurrency(r.total_sales || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </div>
      )}

      {activeCajaOption === 'ingresos' && (
        <div className="card">
          <h3 className="font-bold rf-section-title mb-4">Ingresos</h3>
          {!register ? cajaRequiresRegisterNotice : null}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <input className="input-field" type="number" min="0" step="0.01" placeholder="Monto" value={movementForm.amount} onChange={e => setMovementForm({ ...movementForm, amount: e.target.value })} disabled={!register} />
            <input className="input-field md:col-span-2" placeholder="Concepto" value={movementForm.concept} onChange={e => setMovementForm({ ...movementForm, concept: e.target.value })} disabled={!register} />
          </div>
          <button onClick={() => registerMovement('income')} disabled={!register} className="btn-primary mb-4 disabled:opacity-50 disabled:cursor-not-allowed">Registrar ingreso</button>
          <div className="space-y-2">
            {incomes.map(m => <div key={m.id} className="text-sm flex justify-between border-b border-slate-100 pb-1"><span>{m.concept || 'Sin concepto'}</span><strong>{formatCurrency(m.amount)}</strong></div>)}
          </div>
        </div>
      )}

      {activeCajaOption === 'egresos' && (
        <div className="card">
          <h3 className="font-bold rf-section-title mb-4">Egresos</h3>
          {!register ? cajaRequiresRegisterNotice : null}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <input className="input-field" type="number" min="0" step="0.01" placeholder="Monto" value={movementForm.amount} onChange={e => setMovementForm({ ...movementForm, amount: e.target.value })} disabled={!register} />
            <input className="input-field md:col-span-2" placeholder="Concepto" value={movementForm.concept} onChange={e => setMovementForm({ ...movementForm, concept: e.target.value })} disabled={!register} />
          </div>
          <button onClick={() => registerMovement('expense')} disabled={!register} className="btn-primary mb-4 disabled:opacity-50 disabled:cursor-not-allowed">Registrar egreso</button>
          <div className="space-y-2">
            {expenses.map(m => <div key={m.id} className="text-sm flex justify-between border-b border-slate-100 pb-1"><span>{m.concept || 'Sin concepto'}</span><strong>{formatCurrency(m.amount)}</strong></div>)}
          </div>
        </div>
      )}

      {activeCajaOption === 'notas_credito' && (
        <div className="card">
          <h3 className="font-bold rf-section-title mb-4">Notas de credito</h3>
          {!register ? cajaRequiresRegisterNotice : null}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <input className="input-field" type="number" min="0" step="0.01" placeholder="Monto" value={noteForm.amount} onChange={e => setNoteForm({ ...noteForm, amount: e.target.value })} disabled={!register} />
            <input className="input-field md:col-span-2" placeholder="Motivo" value={noteForm.reason} onChange={e => setNoteForm({ ...noteForm, reason: e.target.value })} disabled={!register} />
          </div>
          <button onClick={() => registerNote('credit')} disabled={!register} className="btn-primary mb-4 disabled:opacity-50 disabled:cursor-not-allowed">Registrar nota de crédito</button>
          <div className="space-y-2">
            {creditNotes.map(n => <div key={n.id} className="text-sm flex justify-between border-b border-slate-100 pb-1"><span>{n.reason || 'Sin motivo'}</span><strong>{formatCurrency(n.amount)}</strong></div>)}
          </div>
        </div>
      )}

      {activeCajaOption === 'notas_debito' && (
        <div className="card">
          <h3 className="font-bold rf-section-title mb-4">Notas de debito</h3>
          {!register ? cajaRequiresRegisterNotice : null}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <input className="input-field" type="number" min="0" step="0.01" placeholder="Monto" value={noteForm.amount} onChange={e => setNoteForm({ ...noteForm, amount: e.target.value })} disabled={!register} />
            <input className="input-field md:col-span-2" placeholder="Motivo" value={noteForm.reason} onChange={e => setNoteForm({ ...noteForm, reason: e.target.value })} disabled={!register} />
          </div>
          <button onClick={() => registerNote('debit')} disabled={!register} className="btn-primary mb-4 disabled:opacity-50 disabled:cursor-not-allowed">Registrar nota de débito</button>
          <div className="space-y-2">
            {debitNotes.map(n => <div key={n.id} className="text-sm flex justify-between border-b border-slate-100 pb-1"><span>{n.reason || 'Sin motivo'}</span><strong>{formatCurrency(n.amount)}</strong></div>)}
          </div>
        </div>
      )}

      {activeCajaOption === 'consulta_precios' && (
        <div className="card">
          <h3 className="font-bold rf-section-title mb-4">Consulta de precios</h3>
          <div className="flex gap-2 mb-3">
            <input className="input-field" placeholder="Buscar por producto o categoría..." value={priceQuery} onChange={e => setPriceQuery(e.target.value)} />
            <button onClick={searchPrices} className="btn-primary">Buscar</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b"><th className="text-left py-2">Producto</th><th className="text-left py-2">Categoría</th><th className="text-right py-2">Precio</th><th className="text-right py-2">Stock</th></tr></thead>
              <tbody>
                {priceResults.map(p => (
                  <tr key={p.id} className="border-b border-slate-50">
                    <td className="py-2">{p.name}</td>
                    <td className="py-2 ui-text-muted">{p.category_name || '-'}</td>
                    <td className="py-2 text-right font-semibold">{formatCurrency(p.price)}</td>
                    <td className="py-2 text-right">{showStockInOrderingUI(p) ? p.stock : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {activeCajaOption === 'impresora' && (
        <div className="card max-w-3xl">
          <h3 className="font-bold rf-section-title mb-4 flex items-center gap-2"><MdPrint /> Configuración de Impresora (Caja)</h3>
          <PrinterModulePanel
            moduleKey="caja"
            showLinkSection
            onConfigLoaded={(cfg) => setPrintingConfig(cfg)}
          />
        </div>
      )}
      </div>

      {/* Modal tomar pedido / venta rápida */}
      <Modal
        isOpen={showMenu}
        onClose={() => {
          setShowMenu(false);
          setQuickSaleMode(false);
          setEditingOrderId('');
          setEditingSessionOrderIds([]);
          setParaLlevarMesa(false);
          setAmountReceived('');
          setMultiPayEnabled(false);
          setMultiPayAmounts(emptyMultiPaymentAmounts());
          setTipPayEnabled(false);
          setCheckoutTipAmount('');
          resetBillingForm();
          resetCart();
        }}
        title={(() => {
          if (quickSaleMode) return 'Venta rápida';
          if (editingOrderId && selectedTable) {
            if (editingSessionOrderIds.length > 1) {
              const nums = (selectedTable.orders || [])
                .filter((x) => editingSessionOrderIds.includes(x.id))
                .map((x) => x.order_number)
                .filter((n) => n != null);
              const suffix = nums.length ? ` · #${nums.join(', #')}` : '';
              return `Modificar pedidos — ${selectedTable.name || ''}${suffix}`;
            }
            const o = (selectedTable.orders || []).find((x) => x.id === editingOrderId);
            return o
              ? `Modificar pedido #${o.order_number} — ${selectedTable.name || ''}`
              : `Modificar pedido — ${selectedTable.name || ''}`;
          }
          return `Agregar Pedido — ${selectedTable?.name || ''}`;
        })()}
        size="xl"
        maxHeightClass="max-h-[min(92vh,920px)]"
        bodyClassName="!overflow-hidden flex min-h-0 flex-1 flex-col !p-4 sm:!p-6"
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {quickSaleMode ? (
        <StaffDineInOrderUI
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
          sidebarTop={(
              <div className="space-y-2">
                <div>
                  <label className="flex items-center gap-2 text-xs font-medium text-[#E5E7EB] mb-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={multiPayEnabled}
                      onChange={(e) => setMultiPayEnabled(e.target.checked)}
                      className="rounded border-[color:var(--ui-accent)]"
                    />
                    Pago multimétodo
                  </label>
                  {!multiPayEnabled ? (
                  <select className="input-field" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                    {paymentOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  ) : (
                    <div className="space-y-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)]/40 p-2">
                      {multiPaymentOptions.map((opt) => (
                        <div key={opt.value} className="flex items-center gap-2">
                          <span className="text-xs text-[#E5E7EB] w-[80px] shrink-0">{opt.label}</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="input-field flex-1 text-sm"
                            placeholder="0.00"
                            value={multiPayAmounts[opt.value] ?? ''}
                            onChange={(e) =>
                              setMultiPayAmounts((prev) => ({ ...prev, [opt.value]: e.target.value }))
                            }
                          />
                        </div>
                      ))}
                      <p className={`text-xs ${Math.abs(multiPaySumProof - cartTotal) <= 0.05 ? 'text-emerald-400' : 'text-amber-300'}`}>
                        Suma: {formatCurrency(multiPaySumProof)} · Total {formatCurrency(cartTotal)}
                      </p>
                    </div>
                  )}
                </div>
                <div>
                  <label className="flex items-center gap-2 text-xs font-medium text-[#E5E7EB] mb-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={tipPayEnabled}
                      onChange={(e) => {
                        const on = e.target.checked;
                        setTipPayEnabled(on);
                        if (!on) setCheckoutTipAmount('');
                      }}
                      className="rounded border-[color:var(--ui-accent)]"
                    />
                    Propina (opcional)
                  </label>
                  {tipPayEnabled && (
                    <div className="rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)]/40 p-2">
                      <label className="block text-xs font-medium text-[#E5E7EB] mb-1">Monto propina</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="input-field w-full text-sm"
                        placeholder="0.00"
                        value={checkoutTipAmount}
                        onChange={(e) => setCheckoutTipAmount(e.target.value)}
                      />
                    </div>
                  )}
                </div>
                {!multiPayEnabled && paymentMethod === 'efectivo' && (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-[#E5E7EB] mb-1">Paga con</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="input-field"
                        value={amountReceived}
                        onChange={(e) => setAmountReceived(e.target.value)}
                        placeholder="0.00"
                      />
                    </div>
                    <div className="rounded-lg border border-emerald-500/40 bg-emerald-950/35 p-2 text-sm">
                      <p className="text-[#9CA3AF]">
                        Vuelto: <span className="font-bold text-emerald-300">{formatCurrency(quickSaleChange)}</span>
                      </p>
                      {quickSaleMissing > 0 && (
                        <p className="text-xs text-red-400 mt-1">Falta: {formatCurrency(quickSaleMissing)}</p>
                      )}
                    </div>
                  </>
                )}
                <div className="rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] p-2 space-y-2">
                  {!billingForm.enabled && (
                    <p className="text-[11px] text-[#9CA3AF]">Activa «Emitir comprobante» debajo del total para completar boleta o factura.</p>
                  )}
                  {billingForm.enabled && (
                    <div className="space-y-2">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={openCustomerModal}
                          className="px-2 py-1 rounded-lg border border-[color:var(--ui-accent)] text-[#BFDBFE] text-xs font-medium hover:bg-[#2563EB]/20 flex items-center gap-1"
                        >
                          <MdPersonAdd className="text-sm" />
                          Agregar cliente
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          className="input-field"
                          value={billingForm.doc_type}
                          onChange={(e) => setBillingForm((prev) => ({ ...prev, doc_type: e.target.value }))}
                        >
                          <option value="boleta">Boleta</option>
                          <option value="factura">Factura</option>
                          <option value="nota_venta">Nota de venta</option>
                        </select>
                        <select
                          className="input-field"
                          value={billingForm.customer_doc_type}
                          onChange={(e) => setBillingForm((prev) => ({ ...prev, customer_doc_type: e.target.value }))}
                          disabled={billingForm.doc_type === 'factura' || billingForm.doc_type === 'nota_venta'}
                        >
                          <option value="1">DNI</option>
                          <option value="6">RUC</option>
                          <option value="0">Sin documento</option>
                        </select>
                      </div>
                      <div className="rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)]/60 p-2 space-y-1.5">
                        <p className="text-[11px] font-medium text-[#E5E7EB]">Detalle en el comprobante</p>
                        <div className="flex flex-wrap gap-3 text-xs text-[#D1D5DB]">
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="radio"
                              name="invoice_lines_quick"
                              checked={billingForm.invoice_lines_mode === 'detallado'}
                              onChange={() => setBillingForm((prev) => ({ ...prev, invoice_lines_mode: 'detallado' }))}
                              className="border-[color:var(--ui-accent)]"
                              disabled={billingForm.doc_type === 'nota_venta'}
                            />
                            Detallado (cada producto)
                          </label>
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="radio"
                              name="invoice_lines_quick"
                              checked={billingForm.invoice_lines_mode === 'consumo'}
                              onChange={() => setBillingForm((prev) => ({ ...prev, invoice_lines_mode: 'consumo' }))}
                              className="border-[color:var(--ui-accent)]"
                              disabled={billingForm.doc_type === 'nota_venta'}
                            />
                            Por consumo (una línea)
                          </label>
                        </div>
                      </div>
                      <div className="flex gap-2 items-stretch">
                        <input
                          className="input-field flex-1 min-w-0"
                          placeholder="N° documento"
                          value={billingForm.customer_doc_number}
                          onChange={(e) =>
                            setBillingForm((prev) => ({ ...prev, customer_doc_number: normalizeDocNumber(e.target.value) }))
                          }
                        />
                        {(billingForm.doc_type !== 'nota_venta' && (billingForm.customer_doc_type === '1' || billingForm.customer_doc_type === '6')) && (
                          <button
                            type="button"
                            title={`Consultar nombre o razón social en padrón (requiere PERU_CONSULTAS_TOKEN en el servidor). ${padronQuotaUi.label || ''}`.trim()}
                            onClick={() => void handleConsultaPadron()}
                            disabled={consultaPadronLoading || padronQuotaUi.exhausted}
                            className="shrink-0 px-2.5 py-2 rounded-lg border border-[color:var(--ui-accent)] text-[#BFDBFE] text-xs font-medium hover:bg-[#2563EB]/20 flex items-center justify-center gap-1 disabled:opacity-50"
                          >
                            <MdSearch className="text-lg shrink-0" />
                            <span className="hidden sm:inline">Padrón</span>
                          </button>
                        )}
                      </div>
                      <input
                        className="input-field"
                        placeholder={billingForm.doc_type === 'factura' ? 'Razón social' : 'Nombre cliente'}
                        value={billingForm.customer_name}
                        onChange={(e) => setBillingForm((prev) => ({ ...prev, customer_name: e.target.value }))}
                      />
                      <input
                        className="input-field"
                        placeholder="Dirección (opcional)"
                        value={billingForm.customer_address}
                        onChange={(e) => setBillingForm((prev) => ({ ...prev, customer_address: e.target.value }))}
                      />
                      <input
                        className="input-field"
                        placeholder=""
                        value={billingForm.customer_phone}
                        onChange={(e) => setBillingForm((prev) => ({ ...prev, customer_phone: e.target.value }))}
                      />
                      {searchingCustomer && <p className="text-[11px] text-[#9CA3AF]">Buscando cliente en el registro local...</p>}
                      {matchedCustomer && (
                        <p className="text-[11px] text-emerald-400">Cliente encontrado: {matchedCustomer.name}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
          )}
          footer={
            cart.length > 0 ? (
              <>
                <div className="flex justify-between font-bold text-lg text-white">
                  <span>Total</span>
                  <span className="text-[#BFDBFE]">{formatCurrency(cartTotal)}</span>
                </div>
                {quickSaleMode && (
                  <label className="flex items-center gap-2 text-xs font-medium text-[#F9FAFB] mb-1">
                    <input
                      type="checkbox"
                      checked={billingForm.enabled}
                      onChange={(e) => setBillingForm((prev) => (e.target.checked
                        ? {
                          ...prev,
                          enabled: true,
                          doc_type: 'nota_venta',
                          customer_doc_type: '0',
                          invoice_lines_mode: 'detallado',
                        }
                        : { ...prev, enabled: false }))}
                      className="rounded border-[color:var(--ui-accent)]"
                    />
                    Emitir Comprobante
                  </label>
                )}
                <button type="button" onClick={submitOrder} className="btn-primary w-full py-3 flex items-center justify-center gap-2 text-base">
                  <MdReceipt /> {quickSaleMode ? 'Cobrar venta rápida' : editingOrderId ? 'Guardar cambios' : 'Enviar Pedido'}
                </button>
              </>
            ) : null
          }
        />
        ) : selectedTable ? (
          <StaffMesaPedidoTabs
            orders={selectedTable.orders || []}
            formatCurrency={formatCurrency}
            resetKey={selectedTable.id}
            className="min-h-0 flex-1 overflow-hidden"
          >
            <StaffDineInOrderUI
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
              updateQty={editingOrderId ? guardedUpdateQty : updateQty}
              removeFromCart={editingOrderId ? guardedRemoveFromCart : removeFromCart}
              updateItemNote={updateItemNote}
              cartTotal={cartTotal}
              formatCurrency={formatCurrency}
              className="min-h-0 flex-1"
              showLineDeleteLabel={Boolean(editingOrderId)}
              footer={
                editingOrderId ? (
                  cart.length > 0 ? (
                    <div className="space-y-2">
                      <div className="flex justify-between font-bold text-lg text-white">
                        <span>Total</span>
                        <span className="text-[#BFDBFE]">{formatCurrency(cartTotal)}</span>
                      </div>
                      {paraLlevarToggleButton}
                      <button
                        type="button"
                        onClick={submitOrder}
                        className="btn-primary flex w-full items-center justify-center gap-2 py-3 text-base"
                      >
                        <MdReceipt /> Guardar cambios
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void liberarMesaDesdeEdicionPedidoVacio()}
                      className="flex w-full items-center justify-center gap-2 rounded-lg border border-amber-400/60 bg-amber-950/50 py-3 text-base font-semibold text-amber-100 hover:bg-amber-900/60"
                    >
                      <MdTableRestaurant /> Liberar mesa
                    </button>
                  )
                ) : cart.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex justify-between font-bold text-lg text-white">
                      <span>Total</span>
                      <span className="text-[#BFDBFE]">{formatCurrency(cartTotal)}</span>
                    </div>
                    {paraLlevarToggleButton}
                    <button type="button" onClick={submitOrder} className="btn-primary w-full py-3 flex items-center justify-center gap-2 text-base">
                      <MdReceipt /> Enviar Pedido
                    </button>
                  </div>
                ) : null
              }
            />
          </StaffMesaPedidoTabs>
        ) : (
          <StaffDineInOrderUI
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
            footer={
              cart.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex justify-between font-bold text-lg text-white">
                    <span>Total</span>
                    <span className="text-[#BFDBFE]">{formatCurrency(cartTotal)}</span>
                  </div>
                  {paraLlevarToggleButton}
                  <button type="button" onClick={submitOrder} className="btn-primary w-full py-3 flex items-center justify-center gap-2 text-base">
                    <MdReceipt /> Enviar Pedido
                  </button>
                </div>
              ) : null
            }
          />
        )}
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(mesaTableAction?.type)}
        onClose={() => setMesaTableAction(null)}
        title={mesaTableAction?.type === 'merge' ? 'Unir mesas' : 'Mover pedidos'}
        size="md"
      >
        <div className="space-y-3">
          {mesaTableAction?.type && (mesaTableAction.type === 'move' || mesaTableAction.type === 'merge') && (
            <div>
              <label className="block text-sm text-[var(--ui-body-text)] mb-1">
                {mesaTableAction.type === 'merge' ? 'Primera mesa' : 'Mesa origen'}
              </label>
              <select
                value={mesaTableAction.sourceId || ''}
                onChange={(e) => {
                  const nextSource = e.target.value;
                  setMesaTableAction((prev) => {
                    if (!prev) return prev;
                    let { targetId } = prev;
                    if (targetId === nextSource) targetId = '';
                    return { ...prev, sourceId: nextSource, targetId };
                  });
                }}
                className="input-field"
              >
                <option value="">Seleccionar...</option>
                {mesaPhysicalTables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {mesaTableAction?.type && (mesaTableAction.type === 'merge' || mesaTableAction.type === 'move') && (
            <div>
              <label className="block text-sm text-[var(--ui-body-text)] mb-1">
                {mesaTableAction.type === 'merge' ? 'Segunda mesa' : 'Mesa destino'}
              </label>
              <select
                value={mesaTableAction.targetId || ''}
                onChange={(e) => setMesaTableAction((prev) => (prev ? { ...prev, targetId: e.target.value } : prev))}
                className="input-field"
              >
                <option value="">Seleccionar...</option>
                {mesaPhysicalTables
                  .filter((t) => t.id !== mesaTableAction.sourceId)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={() => setMesaTableAction(null)} className="btn-secondary flex-1">
              Cancelar
            </button>
            <button type="button" onClick={() => void executeMesaTableAction()} className="btn-primary flex-1">
              Ejecutar
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(viewOrdersModal?.table)}
        onClose={() => setViewOrdersModal(null)}
        title={(() => {
          const t = viewOrdersModal?.table;
          if (!t) return 'Pedidos';
          const name = String(t.name || '').trim();
          return name || 'Pedidos';
        })()}
        size="md"
      >
        {viewOrdersModal?.table ? (() => {
          const tbl = viewOrdersModal.table;
          const lines = mergedProductsOnTable(tbl);
          const totalMesa = (tbl.orders || []).reduce((s, o) => s + getOrderChargeTotal(o), 0);
          return (
            <div className="max-h-[min(70vh,480px)] overflow-y-auto space-y-3 pr-1 text-[#E5E7EB]">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#9CA3AF]">Productos en la mesa</p>
              {lines.length === 0 ? (
                <p className="text-center text-[#9CA3AF] py-6">No hay productos para mostrar.</p>
              ) : (
                <ul className="space-y-1.5 text-sm text-[#D1D5DB]">
                  {lines.map((row) => (
                    <li
                      key={row.key}
                      className="flex justify-between gap-2 border-b border-[#374151]/80 pb-1.5 last:border-0 last:pb-0"
                    >
                      <span className="min-w-0">
                        <span className="font-medium text-white">{row.name}</span>
                        <span className="text-[#9CA3AF]"> × {row.qty}</span>
                      </span>
                      <span className="shrink-0 tabular-nums font-medium text-[#BFDBFE]">{formatCurrency(row.subtotal)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {lines.length > 0 && (
                <div className="flex justify-between border-t border-[color:var(--ui-border)] pt-3 text-base font-bold text-white">
                  <span>Total</span>
                  <span className="text-[#BFDBFE]">{formatCurrency(totalMesa)}</span>
                </div>
              )}
            </div>
          );
        })() : null}
      </Modal>

      <StaffModifierPromptModal
        open={modifierPrompt.open}
        onClose={() => setModifierPrompt({ open: false, product: null, modifier: null, selectedOption: '' })}
        modifierPrompt={modifierPrompt}
        setModifierPrompt={setModifierPrompt}
        onConfirm={confirmModifierForCart}
        onSkipOptional={addProductWithoutOptionalModifier}
      />

      {/* Modal cobro mesa: pedidos o boleta/factura (izq) | cuenta | cobro (mesa arriba del total) */}
      <Modal
        isOpen={showBill}
        onClose={() => {
          clientCheckoutOpenedKeyRef.current = '';
          setShowBill(false);
          setAmountReceived('');
          setSplitMode(false);
          setSelectedOrderItemIds([]);
          setAddToAccountEnabled(false);
          setShowCustomerPickerModal(false);
          resetBillingForm();
        }}
        title={
          selectedTable && isClientCheckoutTable(selectedTable)
            ? 'COBRAR CUENTA CLIENTE'
            : selectedTable && isDeliveryCheckoutTable(selectedTable)
              ? 'COBRAR DELIVERY'
              : 'COBRAR MESA'
        }
        size="xl"
        headerClassName="bg-[var(--ui-surface-2)] border-b border-[color:var(--ui-border)]"
        titleClassName="text-[#F9FAFB] font-extrabold tracking-wide uppercase"
        closeButtonClassName="hover:bg-[#1E3A8A]/50"
        closeIconClassName="text-[#BFDBFE]"
      >
        {selectedTable && (
          <div className="flex flex-col -m-1 min-h-0 max-h-[min(78vh,560px)]">
            <div className="flex-1 overflow-y-auto min-h-0 pb-2">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 lg:gap-4 items-start">
                {/* Pedidos o formulario de facturación (reemplazo al activar emitir comprobante) */}
                <div className="flex flex-col gap-2 min-h-0">
                  <div className="rounded-xl border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)]/70 backdrop-blur-md shadow-lg shadow-black/20 p-3 sm:p-4 flex flex-col min-h-0 overflow-hidden">
                    <div className="flex flex-col flex-1 min-h-0 gap-2">
                      {!billingForm.enabled ? (
                        <>
                          <h3 className="text-base font-bold text-[#F9FAFB] shrink-0">Productos</h3>
                          {splitMode ? (
                            <>
                              <div className="rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)]/50 px-2 py-1.5 shrink-0">
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">
                                  Incluir en cobro (cada línea de producto)
                                </p>
                              </div>
                              <div className="grid grid-cols-[1.75rem_2rem_minmax(0,1fr)_2.5rem_3.75rem_3.75rem] gap-1.5 text-[10px] sm:text-xs font-semibold text-[#9CA3AF] border-b border-[color:var(--ui-border)] pb-2 shrink-0 items-center">
                                <span className="sr-only">Incluir</span>
                                <span className="text-center">Ped.</span>
                                <span>Producto</span>
                                <span className="text-center tabular-nums">Cant.</span>
                                <span className="text-right tabular-nums">P. unit.</span>
                                <span className="text-right tabular-nums">Total</span>
                              </div>
                              <div className="overflow-y-auto flex-1 space-y-0.5 max-h-[min(28vh,220px)] pr-1">
                                {splitBillLines.length === 0 ? (
                                  <p className="text-sm text-[#9CA3AF] text-center py-6">Sin ítems</p>
                                ) : (
                                  splitBillLines.map((line) => {
                                    const sel = selectedOrderItemIds.includes(line.id);
                                    const discountRowFocus =
                                      discountConfig.active &&
                                      !discountConfig.applied &&
                                      discountConfig.target === 'line' &&
                                      discountConfig.targetOrderItemId === line.id;
                                    return (
                                      <div
                                        key={line.id}
                                        role="presentation"
                                        onClick={() => {
                                          if (discountConfig.active && !discountConfig.applied) {
                                            selectDiscountTargetLine(line.id);
                                          }
                                        }}
                                        className={`grid grid-cols-[1.75rem_2rem_minmax(0,1fr)_2.5rem_3.75rem_3.75rem] gap-1.5 items-center rounded-md border px-1 py-1.5 text-sm transition-colors ${
                                          discountRowFocus
                                            ? 'border-amber-400/70 bg-amber-950/35 ring-1 ring-amber-400/50'
                                            : sel
                                              ? 'border-[color:var(--ui-accent)]/80 bg-[var(--ui-sidebar-active-bg)]/25 text-[#E5E7EB]'
                                              : 'border-transparent text-[#9CA3AF]'
                                        } ${discountConfig.active && !discountConfig.applied ? 'cursor-pointer' : ''}`}
                                      >
                                        <div onClick={(e) => e.stopPropagation()} className="flex justify-center">
                                          <input
                                            type="checkbox"
                                            checked={sel}
                                            onChange={() => toggleOrderItemSelection(line.id)}
                                            className="rounded border-[color:var(--ui-accent)]"
                                          />
                                        </div>
                                        <span className="text-center text-[10px] font-bold text-[#BFDBFE] tabular-nums">
                                          #{line.orderNumber}
                                        </span>
                                        <span className="min-w-0 break-words leading-snug">{line.name}</span>
                                        <span className="text-center tabular-nums text-[#F9FAFB]">{line.qty}</span>
                                        <span className="text-right tabular-nums text-[#D1D5DB]">{formatCurrency(line.unit)}</span>
                                        <span className="text-right tabular-nums font-medium text-[#F9FAFB]">{formatCurrency(line.sub)}</span>
                                      </div>
                                    );
                                  })
                                )}
                              </div>
                              <p className="text-[11px] text-[#9CA3AF] shrink-0">
                                Desmarca las líneas que no vas a cobrar en esta operación.
                              </p>
                              {discountConfig.applied && (
                                <p className="text-[11px] text-amber-200/90 shrink-0">
                                  <span className="font-semibold">Descuento aplicado a:</span> {discountTargetLabel}
                                </p>
                              )}
                            </>
                          ) : (
                            <>
                              <div className="grid grid-cols-[minmax(0,1fr)_2.75rem_4.25rem_4.25rem] gap-2 text-[10px] sm:text-xs font-semibold text-[#9CA3AF] border-b border-[color:var(--ui-border)] pb-2 shrink-0">
                                <span>Producto</span>
                                <span className="text-center tabular-nums">Cant.</span>
                                <span className="text-right tabular-nums">P. unit.</span>
                                <span className="text-right tabular-nums">Total</span>
                              </div>
                              <div className="overflow-y-auto flex-1 space-y-2 max-h-[min(28vh,220px)] pr-1">
                                {billLineItemsGrouped.length === 0 ? (
                                  <p className="text-sm text-[#9CA3AF] text-center py-6">Sin ítems</p>
                                ) : (
                                  billLineItemsGrouped.map((row) => (
                                    <div
                                      key={row.key}
                                      className="grid grid-cols-[minmax(0,1fr)_2.75rem_4.25rem_4.25rem] gap-2 text-sm text-[#D1D5DB] py-1.5 border-b border-[#3B82F6]/10 last:border-0"
                                    >
                                      <span className="min-w-0 break-words leading-snug">{row.name}</span>
                                      <span className="text-center tabular-nums text-[#F9FAFB]">{row.qty}</span>
                                      <span className="text-right tabular-nums text-[#D1D5DB]">{formatCurrency(row.unitPrice)}</span>
                                      <span className="text-right tabular-nums font-medium text-[#F9FAFB]">{formatCurrency(row.subtotal)}</span>
                                    </div>
                                  ))
                                )}
                              </div>
                              {discountConfig.applied && (
                                <p className="text-[11px] text-amber-200/90 shrink-0 pt-1">
                                  <span className="font-semibold">Descuento aplicado a:</span> {discountTargetLabel}
                                </p>
                              )}
                            </>
                          )}
                        </>
                      ) : (
                        <div className="flex flex-col gap-3 overflow-y-auto max-h-[min(50vh,400px)] pr-1">
                          <h3 className="text-base font-bold text-[#F9FAFB] shrink-0">Datos del comprobante</h3>
                          <div className="flex items-center justify-end gap-2 shrink-0 flex-wrap">
                            <button
                              type="button"
                              onClick={() => setShowCustomerPickerModal(true)}
                              className="px-2 py-1 rounded-lg border border-[color:var(--ui-accent)] text-[#BFDBFE] text-xs font-medium hover:bg-[#2563EB]/20 flex items-center gap-1 shrink-0"
                            >
                              <MdPeople className="text-sm" />
                              Mis clientes
                            </button>
                            <button
                              type="button"
                              onClick={openCustomerModal}
                              className="px-2 py-1 rounded-lg border border-[color:var(--ui-accent)] text-[#BFDBFE] text-xs font-medium hover:bg-[#2563EB]/20 flex items-center gap-1 shrink-0"
                            >
                              <MdPersonAdd className="text-sm" />
                              Agregar cliente
                            </button>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <select
                              className="input-field text-sm"
                              value={billingForm.doc_type}
                              onChange={(e) => setBillingForm((prev) => ({ ...prev, doc_type: e.target.value }))}
                            >
                              <option value="boleta">Boleta</option>
                              <option value="factura">Factura</option>
                              <option value="nota_venta">Nota de venta</option>
                            </select>
                            <select
                              className="input-field text-sm"
                              value={billingForm.customer_doc_type}
                              onChange={(e) => setBillingForm((prev) => ({ ...prev, customer_doc_type: e.target.value }))}
                              disabled={billingForm.doc_type === 'factura' || billingForm.doc_type === 'nota_venta'}
                            >
                              <option value="1">DNI</option>
                              <option value="6">RUC</option>
                              <option value="0">Sin documento</option>
                            </select>
                            <div className="sm:col-span-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)]/60 p-2 space-y-1.5">
                              <p className="text-xs font-medium text-[#E5E7EB]">Detalle en el comprobante</p>
                              <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:gap-4 text-xs text-[#D1D5DB]">
                                <label className="flex items-center gap-1.5 cursor-pointer">
                                  <input
                                    type="radio"
                                    name="invoice_lines_mesa"
                                    checked={billingForm.invoice_lines_mode === 'detallado'}
                                    onChange={() => setBillingForm((prev) => ({ ...prev, invoice_lines_mode: 'detallado' }))}
                                    className="border-[color:var(--ui-accent)]"
                                    disabled={billingForm.doc_type === 'nota_venta'}
                                  />
                                  Detallado (cada producto)
                                </label>
                                <label className="flex items-center gap-1.5 cursor-pointer">
                                  <input
                                    type="radio"
                                    name="invoice_lines_mesa"
                                    checked={billingForm.invoice_lines_mode === 'consumo'}
                                    onChange={() => setBillingForm((prev) => ({ ...prev, invoice_lines_mode: 'consumo' }))}
                                    className="border-[color:var(--ui-accent)]"
                                    disabled={billingForm.doc_type === 'nota_venta'}
                                  />
                                  Por consumo (una línea)
                                </label>
                              </div>
                            </div>
                            <div className="sm:col-span-2 flex gap-2 items-stretch">
                              <input
                                className="input-field text-sm flex-1 min-w-0"
                                placeholder="N° documento"
                                value={billingForm.customer_doc_number}
                                onChange={(e) =>
                                  setBillingForm((prev) => ({ ...prev, customer_doc_number: normalizeDocNumber(e.target.value) }))
                                }
                              />
                              {(billingForm.doc_type !== 'nota_venta' && (billingForm.customer_doc_type === '1' || billingForm.customer_doc_type === '6')) && (
                                <button
                                  type="button"
                                  title={`Consultar nombre o razón social en padrón (requiere PERU_CONSULTAS_TOKEN en el servidor). ${padronQuotaUi.label || ''}`.trim()}
                                  onClick={() => void handleConsultaPadron()}
                                  disabled={consultaPadronLoading || padronQuotaUi.exhausted}
                                  className="shrink-0 px-2.5 py-2 rounded-lg border border-[color:var(--ui-accent)] text-[#BFDBFE] text-xs font-medium hover:bg-[#2563EB]/20 flex items-center justify-center gap-1 disabled:opacity-50"
                                >
                                  <MdSearch className="text-lg shrink-0" />
                                  <span className="hidden sm:inline">Padrón</span>
                                </button>
                              )}
                            </div>
                            <div className="sm:col-span-2 space-y-1">
                              <input
                                className="input-field text-sm w-full"
                                placeholder={billingForm.doc_type === 'factura' ? 'Razón social' : 'Nombre cliente'}
                                value={billingForm.customer_name}
                                onChange={(e) => {
                                  setBillingForm((prev) => ({ ...prev, customer_name: e.target.value }));
                                  setSelectedBillingCustomerId('');
                                  setMatchedCustomer(null);
                                }}
                              />
                              {selectedBillingCustomerId ? (
                                <p className="text-[11px] text-emerald-400">
                                  Cliente vinculado a Mi Clientes
                                  {billingForm.customer_name ? `: ${billingForm.customer_name}` : ''}
                                </p>
                              ) : null}
                            </div>
                            <input
                              className="input-field text-sm sm:col-span-2"
                              placeholder="Dirección (opcional)"
                              value={billingForm.customer_address}
                              onChange={(e) => setBillingForm((prev) => ({ ...prev, customer_address: e.target.value }))}
                            />
                            <div className="sm:col-span-2">
                              <label className="block text-xs font-medium text-[#E5E7EB] mb-1">Celular del cliente</label>
                              <input
                                className="input-field text-sm w-full"
                                placeholder=""
                                value={billingForm.customer_phone}
                                onChange={(e) => setBillingForm((prev) => ({ ...prev, customer_phone: e.target.value }))}
                              />
                            </div>
                            <div className="sm:col-span-2">
                              {searchingCustomer && <p className="text-xs text-[#9CA3AF]">Buscando cliente en el registro local...</p>}
                              {matchedCustomer && (
                                <p className="text-xs text-emerald-400">Cliente encontrado: {matchedCustomer.name}</p>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                      {discountConfig.active && !discountConfig.applied && (
                        <div className="p-2.5 rounded-lg border border-amber-500/35 bg-amber-950/20 space-y-2 shrink-0">
                          <p className="text-xs font-medium text-amber-200/90">Definir descuento</p>
                          <select
                            className="input-field text-sm"
                            value={discountConfig.type}
                            onChange={(e) => setDiscountConfig((prev) => ({ ...prev, type: e.target.value }))}
                          >
                            <option value="amount">Monto fijo (S/)</option>
                            <option value="percent">Porcentaje (%)</option>
                          </select>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="input-field text-sm"
                            placeholder={discountConfig.type === 'percent' ? 'Ej. 10' : 'Ej. 5.00'}
                            value={discountConfig.value}
                            onChange={(e) => setDiscountConfig((prev) => ({ ...prev, value: e.target.value }))}
                          />
                          <input
                            className="input-field text-sm"
                            placeholder="Motivo (obligatorio)"
                            value={discountConfig.reason}
                            onChange={(e) => setDiscountConfig((prev) => ({ ...prev, reason: e.target.value }))}
                          />
                          <div className="rounded-md border border-amber-500/25 bg-black/20 px-2 py-1.5 space-y-1">
                            <p className="text-[11px] text-amber-100/90">
                              <span className="font-semibold text-amber-200">Aplicando a: </span>
                              {discountTargetLabel}
                            </p>
                            {splitMode ? (
                              <p className="text-[10px] text-[#9CA3AF] leading-snug">
                                Pulsa una línea de la lista de productos para descontar solo ese ítem. Por defecto: cuenta
                                completa.
                              </p>
                            ) : (
                              <p className="text-[10px] text-[#9CA3AF] leading-snug">
                                El descuento afecta a toda la cuenta. Activa «Dividir cuentas» para elegir un solo
                                producto.
                              </p>
                            )}
                            {splitMode && (
                              <button
                                type="button"
                                onClick={selectDiscountTargetWhole}
                                className="text-[11px] font-medium text-sky-300 hover:text-sky-200 underline-offset-2 hover:underline"
                              >
                                Volver a cuenta completa
                              </button>
                            )}
                          </div>
                          <div className="flex flex-col sm:flex-row gap-2">
                            <button
                              type="button"
                              onClick={handleDiscountButton}
                              className="flex-1 py-2 rounded-lg bg-amber-600/90 text-white text-xs font-semibold hover:bg-amber-600"
                            >
                              Aplicar descuento
                            </button>
                            <button
                              type="button"
                              onClick={applyCourtesyDiscount}
                              className="flex-1 py-2 rounded-lg border border-amber-400/60 text-amber-100 text-xs font-semibold hover:bg-amber-500/15"
                            >
                              Cortesía (requiere motivo)
                            </button>
                            <button
                              type="button"
                              onClick={() => setDiscountConfig({ ...EMPTY_DISCOUNT_CONFIG })}
                              className="px-3 py-2 rounded-lg border border-[color:var(--ui-border)] text-[#BFDBFE] text-xs shrink-0"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Cobro */}
                <div className="lg:border-l lg:border-[color:var(--ui-border)] lg:pl-4">
                  <div className="rounded-xl border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)]/70 backdrop-blur-md p-3 sm:p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-base font-bold text-[#F9FAFB] shrink-0">Cobro</h3>
                      <p className="text-base sm:text-lg font-extrabold text-[#F9FAFB] tracking-wide text-right leading-tight">
                        {selectedTable?.name?.trim()
                          || (selectedTable?.number != null && selectedTable?.number !== ''
                            ? `Mesa ${selectedTable.number}`
                            : '—')}
                      </p>
                    </div>
                    <div className="text-right border-b border-[color:var(--ui-border)] pb-3">
                      <p className="text-2xl sm:text-3xl font-bold text-[#BFDBFE] tabular-nums">{formatCurrency(payableTotal)}</p>
                      <p className="text-xs text-[#9CA3AF] mt-0.5">Total a pagar</p>
                    </div>
                    <div className={addToAccountEnabled ? 'opacity-50 pointer-events-none' : ''}>
                      <label className="flex items-center gap-2 text-xs font-medium text-[#E5E7EB] mb-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={multiPayEnabled}
                          onChange={(e) => setMultiPayEnabled(e.target.checked)}
                          disabled={addToAccountEnabled}
                          className="rounded border-[color:var(--ui-accent)]"
                        />
                        Pago multimétodo
                      </label>
                      {!multiPayEnabled ? (
                      <select
                        className="input-field w-full"
                        value={paymentMethod}
                        onChange={(e) => setPaymentMethod(e.target.value)}
                      >
                        {paymentOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      ) : (
                        <div className="space-y-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)]/40 p-2">
                          {multiPaymentOptions.map((opt) => (
                            <div key={opt.value} className="flex items-center gap-2">
                              <span className="text-xs text-[#E5E7EB] w-[88px] shrink-0">{opt.label}</span>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                className="input-field flex-1 text-sm"
                                placeholder="0.00"
                                value={multiPayAmounts[opt.value] ?? ''}
                                onChange={(e) =>
                                  setMultiPayAmounts((prev) => ({ ...prev, [opt.value]: e.target.value }))
                                }
                              />
                            </div>
                          ))}
                          <p className={`text-xs ${Math.abs(multiPaySumProof - payableTotal) <= 0.05 ? 'text-emerald-400' : 'text-amber-300'}`}>
                            Suma: {formatCurrency(multiPaySumProof)} · Debe ser {formatCurrency(payableTotal)}
                          </p>
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className={`flex items-center gap-2 text-xs font-medium text-[#E5E7EB] mb-2 ${addToAccountEnabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                          <input
                            type="checkbox"
                            checked={tipPayEnabled}
                            onChange={(e) => {
                              const on = e.target.checked;
                              setTipPayEnabled(on);
                              if (!on) setCheckoutTipAmount('');
                            }}
                            disabled={addToAccountEnabled}
                            className="rounded border-[color:var(--ui-accent)]"
                          />
                          Propina (opcional)
                        </label>
                        {tipPayEnabled && !addToAccountEnabled && (
                          <div className="rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)]/40 p-2">
                            <label className="block text-xs font-medium text-[#E5E7EB] mb-1">Monto propina</label>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              className="input-field w-full text-sm"
                              placeholder="0.00"
                              value={checkoutTipAmount}
                              onChange={(e) => setCheckoutTipAmount(e.target.value)}
                            />
                          </div>
                        )}
                      </div>
                      <div>
                        <label className="flex items-center gap-2 text-xs font-medium text-[#E5E7EB] mb-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={addToAccountEnabled}
                            onChange={(e) => {
                              const on = e.target.checked;
                              setAddToAccountEnabled(on);
                              if (on) {
                                setTipPayEnabled(false);
                                setCheckoutTipAmount('');
                                setBillingForm((prev) => ({ ...prev, enabled: false }));
                              } else {
                                setSelectedBillingCustomerId('');
                                setMatchedCustomer(null);
                                setBillingForm((prev) => ({ ...prev, customer_name: '' }));
                              }
                            }}
                            className="rounded border-[color:var(--ui-accent)]"
                          />
                          Agregar a cuenta
                        </label>
                      </div>
                    </div>
                    {addToAccountEnabled && (
                      <div className="rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)]/40 p-2 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-medium text-[#E5E7EB]">Cliente</p>
                          <button
                            type="button"
                            onClick={() => setShowCustomerPickerModal(true)}
                            className="px-2 py-1 rounded-lg border border-[color:var(--ui-accent)] text-[#BFDBFE] text-xs font-medium hover:bg-[#2563EB]/20 flex items-center gap-1 shrink-0"
                          >
                            <MdPeople className="text-sm" />
                            Mis clientes
                          </button>
                        </div>
                        <input
                          className="input-field text-sm w-full"
                          placeholder="Nombre del cliente"
                          value={billingForm.customer_name}
                          onChange={(e) => {
                            setBillingForm((prev) => ({ ...prev, customer_name: e.target.value }));
                            setSelectedBillingCustomerId('');
                            setMatchedCustomer(null);
                          }}
                        />
                        {selectedBillingCustomerId ? (
                          <p className="text-[11px] text-emerald-400">Vinculado a Mi Clientes</p>
                        ) : null}
                        <p className="text-[11px] text-sky-300/90 leading-snug rounded-lg border border-sky-500/30 bg-sky-950/25 px-2 py-1.5">
                          {resolveBillingCustomerId()
                            ? `Se cargará a la cuenta de ${billingForm.customer_name || 'el cliente'}. Cobre después en Mi Clientes.`
                            : 'Seleccione un cliente con «Mis clientes» para agregar el consumo a su cuenta.'}
                        </p>
                      </div>
                    )}
                    <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${addToAccountEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
                      <div>
                        <label className="block text-xs font-medium text-[#E5E7EB] mb-1">Paga con</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className="input-field w-full"
                          value={amountReceived}
                          onChange={(e) => setAmountReceived(e.target.value)}
                          placeholder="0.00"
                          disabled={multiPayEnabled || paymentMethod !== 'efectivo'}
                        />
                      </div>
                      <div className="rounded-lg border border-emerald-500/40 bg-emerald-950/35 px-3 py-2 flex flex-col justify-center">
                        <p className="text-xs text-[#9CA3AF]">Vuelto</p>
                        <p className="text-lg font-bold text-emerald-300 tabular-nums">
                          {!multiPayEnabled && paymentMethod === 'efectivo'
                            ? formatCurrency(Math.max(0, receivedAmount - payableTotal))
                            : formatCurrency(0)}
                        </p>
                        {!multiPayEnabled && paymentMethod === 'efectivo' && receivedAmount < payableTotal && (
                          <p className="text-xs text-red-400">Falta: {formatCurrency(payableTotal - receivedAmount)}</p>
                        )}
                      </div>
                    </div>

                    {billingResult && (
                      <div className="text-xs rounded-lg border border-emerald-500/40 bg-emerald-950/40 px-2 py-2 text-emerald-200 flex flex-wrap items-center justify-between gap-2">
                        <span>
                          {billingResult.full_number} · {billingResult.provider_status}
                        </span>
                        {billingResult.pdf_url && (
                          <button
                            type="button"
                            className="px-2 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500"
                            onClick={() => window.open(resolveMediaUrl(billingResult.pdf_url), '_blank', 'noopener,noreferrer')}
                          >
                            Ver PDF
                          </button>
                        )}
                      </div>
                    )}

                    <label className={`flex items-start gap-2 text-sm font-medium text-[#F9FAFB] pt-1 border-t border-[color:var(--ui-border)] ${addToAccountEnabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                      <input
                        type="checkbox"
                        checked={billingForm.enabled}
                        onChange={(e) => setBillingForm((prev) => (e.target.checked
                          ? {
                            ...prev,
                            enabled: true,
                            doc_type: 'nota_venta',
                            customer_doc_type: '0',
                            invoice_lines_mode: 'detallado',
                          }
                          : { ...prev, enabled: false }))}
                        disabled={addToAccountEnabled}
                        className="rounded border-[color:var(--ui-accent)] mt-0.5"
                      />
                      <span>Emitir Comprobante</span>
                    </label>

                    <button
                      type="button"
                      onClick={cobrarMesa}
                      className={`w-full py-3 rounded-xl text-white font-bold text-lg sm:text-xl shadow-lg uppercase tracking-wide ${
                        addToAccountEnabled
                          ? 'bg-gradient-to-r from-sky-600 to-sky-700 hover:from-sky-500 hover:to-sky-600 shadow-sky-700/25'
                          : 'bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] hover:from-[#1D4ED8] hover:to-[#1E40AF] shadow-[#1D4ED8]/25'
                      }`}
                    >
                      {addToAccountEnabled ? 'AGREGAR A CUENTA' : 'COBRAR MESA'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Barra fija inferior: solo dividir / descuento (la mesa va arriba del total a pagar) */}
            <div className="shrink-0 flex flex-wrap items-center gap-3 py-3 px-1 mt-1 border-t border-[color:var(--ui-border)] bg-[var(--ui-surface-2)]/95 backdrop-blur-md rounded-b-lg">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={togglePartialSelection}
                  className="px-4 py-2.5 rounded-lg bg-[#1E3A8A] hover:bg-[#1D4ED8] text-white text-sm font-semibold border border-[color:var(--ui-border)] shadow-md shadow-black/20"
                >
                  {splitMode ? 'Cerrar dividir cuentas' : 'Dividir cuentas'}
                </button>
                <button
                  type="button"
                  onClick={handleDiscountButton}
                  className="px-4 py-2.5 rounded-lg bg-[#1E3A8A] hover:bg-[#1D4ED8] text-white text-sm font-semibold border border-[color:var(--ui-border)] shadow-md shadow-black/20"
                >
                  {discountConfig.applied
                    ? 'Anular descuento'
                    : discountConfig.active
                      ? 'Aplicar descuento'
                      : 'Agregar descuento'}
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <PosCustomerPickerModal
        isOpen={showCustomerPickerModal}
        onClose={() => setShowCustomerPickerModal(false)}
        onSelect={handleCustomerPicked}
      />

      <Modal
        isOpen={showCustomerModal}
        onClose={() => {
          if (savingCustomer) return;
          setShowCustomerModal(false);
        }}
        title="Agregar cliente"
        size="md"
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-[var(--ui-muted)] mb-1">Tipo documento</label>
              <select
                className="input-field"
                value={customerForm.doc_type}
                onChange={(e) => setCustomerForm(prev => ({ ...prev, doc_type: e.target.value }))}
              >
                <option value="1">DNI</option>
                <option value="6">RUC</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--ui-muted)] mb-1">N° documento</label>
              <input
                className="input-field"
                value={customerForm.doc_number}
                onChange={(e) => setCustomerForm(prev => ({ ...prev, doc_number: normalizeDocNumber(e.target.value) }))}
                placeholder={customerForm.doc_type === '6' ? '11 dígitos' : '8 dígitos'}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--ui-muted)] mb-1">Nombre / Razón social</label>
            <input
              className="input-field"
              value={customerForm.name}
              onChange={(e) => setCustomerForm(prev => ({ ...prev, name: e.target.value }))}
              placeholder={customerForm.doc_type === '6' ? 'Razón social' : 'Nombre completo'}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-[var(--ui-muted)] mb-1">Teléfono (opcional)</label>
              <input
                className="input-field"
                value={customerForm.phone}
                onChange={(e) => setCustomerForm(prev => ({ ...prev, phone: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--ui-muted)] mb-1">Email (opcional)</label>
              <input
                className="input-field"
                type="text"
                name="pos-customer-email"
                autoComplete="off"
                value={customerForm.email}
                onChange={(e) => setCustomerForm(prev => ({ ...prev, email: e.target.value }))}
                onBlur={(e) => setCustomerForm(prev => ({ ...prev, email: normalizeCustomerEmail(e.target.value) }))}
                placeholder="@gmail.com"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--ui-muted)] mb-1">Dirección (opcional)</label>
            <input
              className="input-field"
              value={customerForm.address}
              onChange={(e) => setCustomerForm(prev => ({ ...prev, address: e.target.value }))}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowCustomerModal(false)}
              className="btn-secondary flex-1"
              disabled={savingCustomer}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={saveCustomerFromBilling}
              className="btn-primary flex-1"
              disabled={savingCustomer}
            >
              {savingCustomer ? 'Guardando...' : 'Guardar cliente'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal Cerrar Caja / Arqueo */}
      <Modal isOpen={showCloseModal} onClose={() => { setShowCloseModal(false); setClosingAtPreview(null); }} title="Arqueo y Cierre de Caja" size="wide">
        {closingData && (
          <div className="text-[#e2e8f0]">
            <div ref={printRef} className="cash-close-print space-y-0.5">
              <h2>ARQUEO DE CAJA</h2>
              <h3>{user?.full_name} — {arqueoHeaderDayLabel}</h3>
              <div className="sep"></div>
              <div className="row">
                <span>Apertura: </span>
                <span className="flex flex-wrap items-baseline justify-end gap-x-3 gap-y-0.5 text-right">
                  <span className="text-[#f8fafc]">{arqueoOpeningParts.date}</span>
                  <span className="tabular-nums text-[#cbd5e1]">{arqueoOpeningParts.time}</span>
                </span>
              </div>
              <div className="row">
                <span>Cierre: </span>
                <span className="flex flex-wrap items-baseline justify-end gap-x-3 gap-y-0.5 text-right">
                  <span className="text-[#f8fafc]">{arqueoClosingParts.date}</span>
                  <span className="tabular-nums text-[#cbd5e1]">{arqueoClosingParts.time}</span>
                </span>
              </div>
              <div className="sep"></div>
              <div className="row bold"><span>MONTO APERTURA</span><span>{formatCurrency(openingAmt)}</span></div>
              <div className="sep"></div>
              {registerPaymentRows.map((row) => (
                <div key={row.value} className="row">
                  <span>Ventas ({row.label})</span>
                  <span>{formatCurrency(row.amount)}</span>
                </div>
              ))}
              <div className="sep"></div>
              <div className="row total-row"><span>TOTAL VENTAS</span><span>{formatCurrency(registerSales)}</span></div>
              <div className="row bold"><span>N° de operaciones</span><span>{closingData.order_count || 0}</span></div>
              {registerSoldProducts.length > 0 && (
                <>
                  <div className="sep"></div>
                  <p className="section-title">Productos vendidos</p>
                  <table className="products-table">
                    <thead>
                      <tr>
                        <th>Producto</th>
                        <th className="num">Cant.</th>
                        <th className="num">P. unit.</th>
                        <th className="num">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {registerSoldProducts.map((item) => (
                        <tr key={`${item.product_id}-${item.product_name}`}>
                          <td>{item.product_name}</td>
                          <td className="num">{item.total_qty}</td>
                          <td className="num">{formatCurrency(item.unit_price)}</td>
                          <td className="num">{formatCurrency(item.total_amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
              <div className="sep"></div>
              <div className="row bold"><span>EFECTIVO ESPERADO</span><span>{formatCurrency(expectedRounded)}</span></div>
              <div className="row"><span style={{ fontSize: '10px', color: '#94a3b8' }}>(Apertura + ventas en efectivo del turno)</span></div>
              <div className="sep"></div>
              <div className="row bold"><span>DETALLE ARQUEO</span><span></span></div>
              {denomDefs
                .filter(d => (parseFloat(denominations[d.key]) || 0) > 0)
                .map(d => (
                  <div key={d.key} className="row">
                    <span>{d.label} x {parseFloat(denominations[d.key]) || 0}</span>
                    <span>{formatCurrency((parseFloat(denominations[d.key]) || 0) * d.value)}</span>
                  </div>
                ))}
              <div className="row bold"><span>EFECTIVO CONTADO</span><span>{formatCurrency(closingAmt)}</span></div>
              <div className={`row bold ${difference >= 0 ? 'diff-pos' : 'diff-neg'}`}><span>DIFERENCIA</span><span>{difference > 0 ? '+' : ''}{formatCurrency(difference)}</span></div>
              {closingNotes && <div className="row"><span>OBS:</span><span>{closingNotes}</span></div>}
            </div>

            <div className="mt-4 space-y-4">
              <div className="rounded-xl p-4 border border-[color:var(--ui-border)] bg-[var(--ui-surface)]">
                <h3 className="font-semibold text-[#f8fafc] mb-3 flex items-center gap-2"><MdAccountBalanceWallet className="text-[#93c5fd]" /> Resumen de ventas (métodos activos)</h3>
                <div className={`grid gap-3 ${registerPaymentRows.length <= 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2 lg:grid-cols-4'}`}>
                  {registerPaymentRows.map((row) => (
                    <div key={row.value} className="rounded-lg p-3 border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)]">
                      <p className="text-xs text-[#94a3b8]">{row.label}</p>
                      <p className={`font-bold text-lg ${paymentRowAmountClass(row.value)}`}>{formatCurrency(row.amount)}</p>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between items-center mt-3 pt-3 border-t border-[color:var(--ui-border)]">
                  <span className="font-bold text-[#f1f5f9]">Total ventas</span>
                  <span className="font-bold text-xl text-emerald-400">{formatCurrency(registerSales)}</span>
                </div>
              </div>

              <div className="rounded-xl p-4 border border-[color:var(--ui-border)] bg-[var(--ui-surface)]">
                <h3 className="font-semibold text-[#f8fafc] mb-1">Conteo de efectivo</h3>
                <div className="mb-3">
                  <p className="text-xs font-semibold text-[#cbd5e1] mb-2">Arqueo por denominación (soles)</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                    {denomDefs.map(d => (
                      <div key={d.key} className="rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] p-2">
                        <label className="block text-xs text-[#cbd5e1] mb-1">{d.label}</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={denominations[d.key]}
                            onChange={e => updateDenomination(d.key, e.target.value)}
                            className="input-field py-1.5 text-sm"
                            placeholder="0"
                          />
                          <span className="text-xs font-semibold text-[#e2e8f0] min-w-16 text-right tabular-nums">
                            {formatCurrency((parseFloat(denominations[d.key]) || 0) * d.value)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between items-center mt-2 p-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)]">
                    <span className="text-xs font-medium text-[#cbd5e1]">Total por arqueo</span>
                    <span className="font-bold text-amber-300 tabular-nums">{formatCurrency(calculateDenominationTotal())}</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-xs font-medium text-[#cbd5e1] mb-1">Efectivo esperado en caja</label>
                    <div className="rounded-lg p-3 border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)]">
                      <p className="font-bold text-lg text-[#f9fafb] tabular-nums">{formatCurrency(expectedRounded)}</p>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#cbd5e1] mb-1">Efectivo contado real</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8] font-medium text-sm">S/</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={closingAmount}
                        onChange={e => setClosingAmount(e.target.value)}
                        placeholder="0.00"
                        className="input-field pl-9 text-lg font-bold"
                      />
                    </div>
                  </div>
                </div>

                {denominationMismatch && (
                  <p className="text-sm text-amber-300 mb-3 px-1 rounded-lg border border-amber-600/40 bg-amber-950/30 py-2">
                    El total por denominación ({formatCurrency(denomTotalRounded)}) no coincide con el efectivo contado ingresado ({formatCurrency(closingAmt)}). La diferencia se calcula respecto al esperado usando el importe contado que escribió.
                  </p>
                )}

                {closingAmount !== '' && (
                  <div className={`flex items-center justify-between p-3 rounded-lg border ${
                    difference === 0 ? 'bg-emerald-950/50 border-emerald-600/60' :
                    difference > 0 ? 'bg-sky-950/40 border-sky-600/50' :
                    'bg-red-950/40 border-red-600/50'
                  }`}>
                    <div className="flex items-center gap-2 text-[#e2e8f0]">
                      {difference === 0 ? <MdCheckCircle className="text-emerald-400 text-xl" /> :
                       difference > 0 ? <MdTrendingUp className="text-sky-400 text-xl" /> :
                       <MdTrendingDown className="text-red-400 text-xl" />}
                      <span className="font-medium text-sm">
                        {difference === 0 ? 'Caja cuadrada' :
                         difference > 0 ? 'Sobrante' : 'Faltante'}
                      </span>
                    </div>
                    <span className={`font-bold text-lg tabular-nums ${
                      difference === 0 ? 'text-emerald-300' :
                      difference > 0 ? 'text-sky-300' : 'text-red-300'
                    }`}>
                      {difference > 0 ? '+' : ''}{formatCurrency(difference)}
                    </span>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-[#cbd5e1] mb-1">Observaciones</label>
                <textarea
                  value={closingNotes}
                  onChange={e => setClosingNotes(e.target.value)}
                  className="input-field"
                  rows="2"
                  placeholder="Notas sobre el turno, incidencias, etc."
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-3 pt-4 mt-4 border-t border-[color:var(--ui-border)]">
              <button onClick={() => setShowCloseModal(false)} className="btn-secondary flex-1 min-w-[120px]">Cancelar</button>
              <button
                type="button"
                onClick={printCloseRegisterManual}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm btn-secondary min-w-[180px]"
              >
                <MdPrint /> Imprimir cierre de caja
              </button>
              <button onClick={closeRegister} className="btn-primary flex-1 flex items-center justify-center gap-2">
                <MdCheckCircle /> Cerrar Caja
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={Boolean(mesaRemovalModal)}
        onClose={() => {
          if (!mesaRemovalSubmitting) closeMesaRemovalModal();
        }}
        title={
          mesaRemovalModal?.mode === 'liberar'
            ? 'Liberar mesa — motivo obligatorio'
            : 'Quitar productos — motivo obligatorio'
        }
        size="md"
      >
        <div className="space-y-4">
          <p className="text-sm text-[var(--ui-muted)]">
            {mesaRemovalModal?.mode === 'liberar'
              ? 'Solo un administrador puede anular el pedido y liberar la mesa. Indique el motivo (obligatorio).'
              : 'Solo un administrador puede retirar productos de la mesa. Indique el motivo (obligatorio).'}
          </p>
          <div>
            <label htmlFor="mesa-removal-reason" className="block text-xs font-medium text-[var(--ui-body-text)] mb-1">
              Motivo
            </label>
            <textarea
              id="mesa-removal-reason"
              value={mesaRemovalReason}
              onChange={(e) => setMesaRemovalReason(e.target.value)}
              rows={4}
              className="input-field w-full text-sm resize-y min-h-[100px]"
              placeholder="Ej.: Cliente se retiró, error en el pedido, cambio de mesa…"
              disabled={mesaRemovalSubmitting}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="btn-secondary text-sm"
              disabled={mesaRemovalSubmitting}
              onClick={closeMesaRemovalModal}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 disabled:opacity-50"
              disabled={mesaRemovalSubmitting}
              onClick={() => void confirmMesaRemovalModal()}
            >
              {mesaRemovalSubmitting ? 'Guardando…' : 'Confirmar'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
