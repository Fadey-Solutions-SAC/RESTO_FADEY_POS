import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { api, formatCurrency, formatDateTime, formatDate, parseApiDate, isDateKeyInInclusiveRange, resolveMediaUrl, toLocalDateKey } from '../../utils/api';
import { billingStatusLabel, billingFileIsOpenable } from '../../utils/billingSunatStatus';
import toast from 'react-hot-toast';
import { useSocket } from '../../hooks/useSocket';
import {
  MdSearch,
  MdSave,
  MdFilterList,
  MdClose,
  MdAttachMoney,
  MdPayments,
  MdSchedule,
  MdReceipt,
  MdTrendingUp,
  MdAccountBalanceWallet,
  MdHourglassEmpty,
  MdPointOfSale,
  MdCancel,
} from 'react-icons/md';
import Modal from '../../components/Modal';
import i18n from '../../i18n';
import { buildVentasDisplayGroups, getObservationRecordIds, groupItemsByProductNameForBill, isCourtesyOrder, orderMatchesMesaSearch, parseProductRemovalNotesFromOrder, summarizePaidSalesAccounts } from '../../utils/mesaOrderLines';
import { useNavigate, useSearchParams } from 'react-router-dom';
import SaleActionButtons, { SALE_ACTIONS } from '../../components/admin/SaleActionButtons';
import { useAuth } from '../../context/AuthContext';
import { useShowDeliveryUi } from '../../hooks/useDeliveryEnabled';
import DownloadExcelTxtButtons from '../../components/admin/DownloadExcelTxtButtons';
import { InlineDateField } from '../../components/DateFilterControls';
import VentasCuentasTable, { getOrderDocument, getAccountDocument, docLabel, getAccountAuditStatusBadge } from '../../components/admin/VentasCuentasTable';
import VentasAiPanel from '../../components/ventas/VentasAiPanel';
import { getFadeyAiAvatarSrc } from '../../constants/fadeyAiBranding';
import {
  mapAccountToDetalleVentaRow,
  buildDetalleVentasExcelHtml,
  buildDetalleVentasTxt,
  formatSaleNumero,
} from '../../utils/salesReportExport';
import { downloadBlobFile, downloadExcelFile } from '../../utils/inventoryCuadreExport';
import { formatOrderPaymentLabel, orderPaymentDetail } from '../../utils/paymentBreakdownDisplay';
import PaymentSummaryDisplay from '../../components/admin/PaymentSummaryDisplay';
import { restaurantLocalAddress } from '../../utils/restaurantLocalAddress';
import { printCajaTicket } from '../../utils/printCajaTicket';
import { withSunatQr } from '../../utils/sunatQr';
import { SUNAT_TICKET_WIDTH_MM } from '../../utils/billingDocumentActions';
import {
  buildBoletaFacturaPlainText,
  taxKindFromItems,
  buildNotaVentaPlainText,
  restaurantThermalBrandLine,
} from '../../utils/ticketPlainText';

function payLabel(method) {
  if (!method) return '';
  const key = `paymentMethods.${method}`;
  const tr = i18n.t(key, { ns: 'sales', defaultValue: '' });
  return tr || method;
}

function toExcelHtmlTable(rows) {
  const body = rows.map((r) => {
    const cells = r.map((cell) => {
      const value = String(cell ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `<td>${value}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  return `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
      <head>
        <meta charset="UTF-8" />
        <style>
          table { border-collapse: collapse; width: 100%; }
          td, th { border: 1px solid #000; padding: 6px; font-size: 12px; }
          .title { font-weight: 700; background: #d9ead3; }
          .section { font-weight: 700; background: #f3f3f3; }
          .blank td { border: none; height: 10px; }
        </style>
      </head>
      <body>
        <table>${body}</table>
      </body>
    </html>
  `;
}

function formatTemplateDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}Z`);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function formatTemplateDateTime(dateStr) {
  if (!dateStr) return '';
  return new Date(`${dateStr}Z`).toLocaleString('es-PE');
}

function getShiftLabel(dateStr) {
  const d = new Date(`${dateStr}Z`);
  const hour = d.getHours();
  return hour >= 7 && hour < 19 ? 'Turno Dia' : 'Turno Noche';
}

function getSalesChannel(order) {
  if (order.type === 'delivery') return 'Delivery';
  if (order.type === 'pickup') return 'Mostrador';
  return 'Salon';
}

function toTemplateRow(order, localName = '-') {
  const doc = getOrderDocument(order);
  const parts = String(doc.full_number || '').split('-');
  const serie = parts[0] || '001';
  const numero = parts[1] || String(order.order_number || '').padStart(8, '0');
  const isCancelled = order.status === 'cancelled';
  const isPaid = order.payment_status === 'paid';
  const paymentLabel = formatOrderPaymentLabel(order, payLabel);
  const mesa = order.type === 'dine_in' ? `M${String(order.table_number || '0').padStart(2, '0')}` : '-';
  const requester = order.created_by_user_name || '-';
  return [
    formatTemplateDate(order.created_at),
    formatTemplateDateTime(order.created_at),
    mesa,
    requester,
    localName || '-',
    'Caja 01',
    getShiftLabel(order.created_at),
    order.customer_name || 'PUBLICO GENERAL',
    '00000000',
    `${docLabel(doc.doc_type)}`,
    serie,
    numero,
    paymentLabel,
    isPaid ? Number(order.total || 0).toFixed(2) : '0.00',
    '0',
    '0',
    Number(order.subtotal || 0).toFixed(2),
    Number(order.tax || 0).toFixed(2),
    '0',
    Number(order.tax || 0).toFixed(2),
    Number(order.total || 0).toFixed(2),
    Number(order.discount || 0).toFixed(2),
    isPaid ? 'Contado' : 'Credito',
    isCancelled ? 'Anulada' : 'Activa',
    '-',
    '-',
    isCancelled ? (order.cancellation_reason || '-') : '-',
    getSalesChannel(order),
    order.type === 'delivery' ? 'Delivery' : '-',
    requester,
    '0',
    Number(order.discount || 0) > 0 ? 'Monto' : '',
    Number(order.discount || 0) > 0 ? 'Descuento aplicado' : '',
    '0',
    order.type === 'delivery' ? 'DELIVERY-LOCAL' : '-',
    order.notes || '',
    '-',
  ];
}

function downloadExcel(order) {
  const header = [
    'Fecha', 'Hora', 'Mesa', 'Mesero', 'Local', 'Caja', 'Turno', 'Cliente', 'DNI/RUC', 'Tipo Doc.',
    'Serie Doc.', 'Num Doc.', 'Forma de pago', 'Monto pagado', 'Retencion', 'Propina', 'Subtotal',
    'IGV 18%', 'ICBPER', 'Impuestos', 'Total', 'Descuento', 'Tipo', 'Estado', 'Anulado por',
    'Aprobado por', 'Motivo', 'Canal de venta', 'Canal de delivery', 'Usuario solicitante',
    'Descuento redondeo', 'Tipo de descuento', 'Motivo descuento', 'Porcentaje de descuento',
    'Codigo integracion delivery', 'Observacion', 'Codigo vendedor',
  ];
  const items = order.items || [];
  const rows = [
    header,
    toTemplateRow(order, order.local_name || '-'),
    [''],
    ['SECCION DETALLE PRODUCTOS', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['Cantidad', 'Producto', 'Variante', 'Precio Unitario', 'Subtotal', 'Notas Item', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ...items.map(i => [
      String(i.quantity || 0),
      i.product_name || '',
      i.variant_name || '',
      Number(i.unit_price || 0).toFixed(2),
      Number(i.subtotal || 0).toFixed(2),
      i.notes || '',
      '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
    ]),
  ];
  const html = toExcelHtmlTable(rows);
  const bom = '\uFEFF';
  const blob = new Blob([bom + html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = `venta-${order.order_number}.xls`;
  link.click();
  URL.revokeObjectURL(url);
}

const PAYMENT_METHOD_KEYS = ['efectivo', 'yape', 'plin', 'tarjeta', 'online'];
const DOC_TYPE_KEYS = ['nota_venta', 'boleta', 'factura'];

function mesaSortValue(group) {
  const table = String(group?.primary?.table_number || '').trim();
  const n = parseInt(table.replace(/\D/g, ''), 10);
  if (Number.isFinite(n) && n > 0) return n;
  return 99999;
}

function monthLabelEs(monthKey) {
  const [y, m] = String(monthKey || '').split('-').map(Number);
  if (!y || !m) return String(monthKey || '');
  const name = new Date(y, m - 1, 1).toLocaleDateString('es-PE', { month: 'long' });
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`;
}

function normalizeVentasSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Coincide por # de venta, cliente, mesa o nombre de producto (sin tildes, en cualquier parte del texto). */
function orderMatchesVentasSearch(order, queryRaw) {
  const raw = String(queryRaw || '').trim();
  const q = normalizeVentasSearchText(raw);
  if (!q) return true;
  if (String(order?.order_number || '').includes(raw)) return true;
  if (String(order?.sale_number || '').includes(raw)) return true;
  if (normalizeVentasSearchText(order?.customer_name).includes(q)) return true;
  if (orderMatchesMesaSearch(order, raw)) return true;
  const words = q.split(' ');
  return (order?.items || []).some((it) => {
    const text = normalizeVentasSearchText(
      `${it.product_name || it.name || ''} ${it.variant_name || it.modifier_option || ''}`,
    );
    return words.every((w) => text.includes(w));
  });
}

function sortVentasGroups(groups, sortKey, sortDir) {
  const dir = sortDir === 'asc' ? 1 : -1;
  return [...groups].sort((a, b) => {
    if (sortKey === 'mesa') {
      const na = mesaSortValue(a);
      const nb = mesaSortValue(b);
      if (na !== nb) return (na - nb) * dir;
      return String(a.mesaLabel || '').localeCompare(String(b.mesaLabel || ''), 'es') * dir;
    }
    if (sortKey === 'venta') {
      return (Number(a.total || 0) - Number(b.total || 0)) * dir;
    }
    const ta = parseApiDate(a.latestAt)?.getTime() || 0;
    const tb = parseApiDate(b.latestAt)?.getTime() || 0;
    return (ta - tb) * dir;
  });
}

export default function Ventas() {
  const { t } = useTranslation('sales');
  const { user } = useAuth();
  const reportUsuario = user?.full_name || user?.username || 'Administrador';
  const showDeliveryUi = useShowDeliveryUi();
  const [orders, setOrders] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [waiterFilter, setWaiterFilter] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersPanelRef = useRef(null);
  /** activas | anuladas | ia */
  const [saleTab, setSaleTab] = useState('activas');
  const [voidModalOrder, setVoidModalOrder] = useState(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidSubmitting, setVoidSubmitting] = useState(false);
  const [selected, setSelected] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editPaymentMethod, setEditPaymentMethod] = useState('efectivo');
  const [editDocType, setEditDocType] = useState('nota_venta');
  const [editPaymentNote, setEditPaymentNote] = useState('');
  const [editCustomerDocType, setEditCustomerDocType] = useState('1');
  const [editCustomerDocNumber, setEditCustomerDocNumber] = useState('');
  const [editCustomerName, setEditCustomerName] = useState('');
  const [editCustomerAddress, setEditCustomerAddress] = useState('');
  const [editCustomerPhone, setEditCustomerPhone] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [issuingDoc, setIssuingDoc] = useState(false);
  const [consultaPadronLoading, setConsultaPadronLoading] = useState(false);
  /** Modal de emisión (mismo flujo que Caja) al elegir boleta/factura en Editar. */
  const [emitModalOpen, setEmitModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [restaurantName, setRestaurantName] = useState('-');
  const [restaurantInfo, setRestaurantInfo] = useState({ name: '', logo: '' });
  const [adjustmentRows, setAdjustmentRows] = useState([]);
  const [sortKey, setSortKey] = useState('fecha');
  const [sortDir, setSortDir] = useState('desc');
  const navigate = useNavigate();

  const load = async () => {
    try {
      const [ordersData, docsData] = await Promise.all([
        api.get('/orders'),
        api.get('/billing/documents?limit=200'),
      ]);
      const restaurant = await api.get('/restaurant');
      const docsByOrder = new Map((docsData || []).map(d => [d.order_id, d]));
      const local = restaurant?.name || '-';
      setRestaurantName(local);
      setRestaurantInfo({
        ...restaurant,
        logo: resolveMediaUrl(restaurant?.logo || ''),
      });
      const merged = (ordersData || [])
        .filter((o) => !isCourtesyOrder(o))
        .map(o => ({ ...o, document: docsByOrder.get(o.id) || null, local_name: local }));
      setOrders(merged);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadRef = useRef(load);
  loadRef.current = load;

  const loadAdjustments = useCallback(async () => {
    try {
      const res = await api.get('/reports/sales-adjustments?limit=2000');
      setAdjustmentRows(Array.isArray(res?.orders) ? res.orders : []);
    } catch {
      setAdjustmentRows([]);
    }
  }, []);

  useSocket('billing-document-update', useCallback(() => { loadRef.current(); }, []));
  useSocket('order-update', useCallback(() => {
    loadRef.current();
    void loadAdjustments();
  }, [loadAdjustments]));

  useEffect(() => { load(); }, []);
  useEffect(() => { void loadAdjustments(); }, [loadAdjustments]);

  const searchQuery = search.trim();

  /** Filtros sin búsqueda: la búsqueda se aplica por cuenta completa (ver `displayGroups`). */
  const baseFiltered = useMemo(() => {
    let f = orders;
    if (statusFilter !== 'all') f = f.filter(o => o.payment_status === statusFilter);
    if (typeFilter !== 'all') f = f.filter(o => o.type === typeFilter);
    if (waiterFilter !== 'all') {
      f = f.filter(o => (o.created_by_user_name || o.customer_name || '-').toLowerCase() === waiterFilter.toLowerCase());
    }
    if (fromDate || toDate) {
      f = f.filter((o) => isDateKeyInInclusiveRange(o.updated_at || o.created_at, fromDate, toDate));
    }
    if (saleTab === 'activas') f = f.filter((o) => o.status !== 'cancelled');
    else if (saleTab === 'anuladas') f = f.filter((o) => o.status === 'cancelled');
    return f;
  }, [statusFilter, typeFilter, waiterFilter, fromDate, toDate, saleTab, orders]);

  useEffect(() => {
    if (!showDeliveryUi && typeFilter === 'delivery') setTypeFilter('all');
  }, [showDeliveryUi, typeFilter]);

  const isVoidedTab = saleTab === 'anuladas';
  const isAiTab = saleTab === 'ia';

  /** Para la pestaña IA usamos ventas no anuladas (o el filtro de fechas/mesero aplicado). */
  const aiOrdersSource = useMemo(() => {
    let f = orders.filter((o) => !isCourtesyOrder(o) && o.status !== 'cancelled');
    if (searchQuery) f = f.filter((o) => orderMatchesVentasSearch(o, searchQuery));
    if (statusFilter !== 'all') f = f.filter((o) => o.payment_status === statusFilter);
    if (typeFilter !== 'all') f = f.filter((o) => o.type === typeFilter);
    if (waiterFilter !== 'all') {
      f = f.filter((o) => (o.created_by_user_name || o.customer_name || '-').toLowerCase() === waiterFilter.toLowerCase());
    }
    if (fromDate || toDate) {
      f = f.filter((o) => isDateKeyInInclusiveRange(o.updated_at || o.created_at, fromDate, toDate));
    }
    return f;
  }, [orders, searchQuery, statusFilter, typeFilter, waiterFilter, fromDate, toDate]);

  const aiTotals = useMemo(() => {
    const paidAccounts = summarizePaidSalesAccounts(
      aiOrdersSource.filter((o) => o.payment_status === 'paid' && !isCourtesyOrder(o)),
    );
    return {
      total: aiOrdersSource.reduce((s, o) => s + (o.total || 0), 0),
      paid: aiOrdersSource.filter((o) => o.payment_status === 'paid').reduce((s, o) => s + (o.total || 0), 0),
      pending: aiOrdersSource.filter((o) => o.payment_status === 'pending').reduce((s, o) => s + (o.total || 0), 0),
      count: paidAccounts.length,
    };
  }, [aiOrdersSource]);

  const toggleSort = useCallback((key) => {
    if (sortKey === key) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir(key === 'fecha' ? 'desc' : 'asc');
  }, [sortKey]);

  const displayGroups = useMemo(() => {
    let groups = buildVentasDisplayGroups(baseFiltered, adjustmentRows, { voidedTab: isVoidedTab });
    if (searchQuery) {
      groups = groups.filter((g) => {
        const groupOrders = g.orders?.length ? g.orders : [g.primary].filter(Boolean);
        return groupOrders.some((o) => orderMatchesVentasSearch(o, searchQuery));
      });
    }
    return sortVentasGroups(groups, sortKey, sortDir);
  }, [baseFiltered, adjustmentRows, isVoidedTab, searchQuery, sortKey, sortDir]);

  const filtered = useMemo(() => {
    if (!searchQuery) return baseFiltered;
    const ids = new Set();
    displayGroups.forEach((g) => {
      const groupOrders = g.orders?.length ? g.orders : [g.primary].filter(Boolean);
      groupOrders.forEach((o) => ids.add(o.id));
    });
    return baseFiltered.filter((o) => ids.has(o.id));
  }, [baseFiltered, displayGroups, searchQuery]);

  /** Mes en curso venta por venta; meses cerrados comprimidos en un recuadro. */
  const { currentMonthGroups, pastMonths } = useMemo(() => {
    const currentKey = String(toLocalDateKey(new Date()) || '').slice(0, 7);
    const current = [];
    const byMonth = new Map();
    displayGroups.forEach((g) => {
      const monthKey = String(toLocalDateKey(g.latestAt) || '').slice(0, 7);
      if (!monthKey || monthKey >= currentKey) {
        current.push(g);
        return;
      }
      if (!byMonth.has(monthKey)) byMonth.set(monthKey, []);
      byMonth.get(monthKey).push(g);
    });
    const months = [...byMonth.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([key, groups]) => ({ key, label: monthLabelEs(key), groups }));
    return { currentMonthGroups: current, pastMonths: months };
  }, [displayGroups]);
  const [openMonthKeys, setOpenMonthKeys] = useState(() => new Set());
  const pastMonthKeysSig = pastMonths.map((m) => m.key).join('|');
  useEffect(() => {
    setOpenMonthKeys(searchQuery && pastMonthKeysSig ? new Set(pastMonthKeysSig.split('|')) : new Set());
  }, [searchQuery, pastMonthKeysSig]);
  const toggleMonthOpen = useCallback((key) => {
    setOpenMonthKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const paidSalesAccounts = useMemo(
    () => summarizePaidSalesAccounts(filtered.filter((o) => o.payment_status === 'paid' && !isCourtesyOrder(o))),
    [filtered],
  );

  const waiterOptions = Array.from(
    new Set(orders.map(o => (o.created_by_user_name || o.customer_name || '-')).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, 'es'));

  const hasActiveFilters = useMemo(
    () =>
      (!isVoidedTab && statusFilter !== 'all')
      || typeFilter !== 'all'
      || waiterFilter !== 'all'
      || Boolean(fromDate)
      || Boolean(toDate),
    [isVoidedTab, statusFilter, typeFilter, waiterFilter, fromDate, toDate],
  );

  const clearAllFilters = useCallback(() => {
    setStatusFilter('all');
    setTypeFilter('all');
    setWaiterFilter('all');
    setFromDate('');
    setToDate('');
  }, []);

  useEffect(() => {
    if (!filtersOpen) return undefined;
    const onDown = (e) => {
      if (filtersPanelRef.current?.contains(e.target)) return;
      setFiltersOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setFiltersOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [filtersOpen]);

  const totals = {
    total: filtered.filter((o) => !isCourtesyOrder(o)).reduce((s, o) => s + (o.total || 0), 0),
    paid: filtered.filter((o) => o.payment_status === 'paid' && !isCourtesyOrder(o)).reduce((s, o) => s + (o.total || 0), 0),
    pending: filtered.filter((o) => o.payment_status === 'pending').reduce((s, o) => s + (o.total || 0), 0),
    count: paidSalesAccounts.length,
  };

  const lifetimeSales = useMemo(() => {
    const nums = orders
      .filter((o) => o.payment_status === 'paid' && !isCourtesyOrder(o))
      .map((o) => Number(o.sale_number || 0))
      .filter((n) => n > 0);
    return nums.length ? Math.max(...nums) : 0;
  }, [orders]);

  const downloadDetalleVentas = (format = 'excel') => {
    const groups = displayGroups.filter((g) => g.isSalesAccount || (g.primary && g.primary.payment_status === 'paid'));
    const source = groups.length ? groups : paidSalesAccounts;
    const rows = source.map((account) => mapAccountToDetalleVentaRow(account, { formatDate }));
    if (!rows.length) {
      toast.error('No hay ventas para descargar en el filtro actual');
      return;
    }
    const periodLabel = fromDate || toDate
      ? `${fromDate ? formatDate(fromDate) : '…'} - ${toDate ? formatDate(toDate) : '…'}`
      : 'Todo';
    const fromKey = fromDate || 'todo';
    const toKey = toDate || fromDate || 'todo';
    const baseName = `detalle-ventas-${fromKey}_${toKey}`;
    if (format === 'txt') {
      downloadBlobFile(`${baseName}.txt`, buildDetalleVentasTxt({ periodLabel, usuario: reportUsuario, rows }));
      toast.success('Detalle de ventas descargado (TXT)');
      return;
    }
    downloadExcelFile(baseName, buildDetalleVentasExcelHtml({ periodLabel, usuario: reportUsuario, rows }));
    toast.success('Detalle de ventas descargado (Excel)');
  };

  const handleSaleTabChange = (tabId) => {
    setSaleTab(tabId);
    if (tabId === 'anuladas') setStatusFilter('all');
  };

  const goToDescuentosHighlight = useCallback((group) => {
    const recordIds = getObservationRecordIds(group?.observations);
    if (!recordIds.length) return;
    const dateKey = toLocalDateKey(group?.latestAt || group?.primary?.paid_at);
    const params = new URLSearchParams();
    params.set('seccion', 'descuentos');
    params.set('resaltar', recordIds.join(','));
    if (dateKey) {
      params.set('desde', dateKey);
      params.set('hasta', dateKey);
    }
    navigate(`/admin/informes?${params.toString()}`);
  }, [navigate]);

  const openGroupDetail = (group) => {
    setSelectedGroup(group);
    setSelected(group.primary);
    setEditing(null);
  };

  const closeDetail = () => {
    setSelected(null);
    setSelectedGroup(null);
    setEditing(null);
    setEmitModalOpen(false);
  };

  const startEdit = (group) => {
    const order = group.primary;
    const doc = getAccountDocument(group);
    const groupOrders = (group.orders?.length ? group.orders : [order]).filter(Boolean);
    const payableOrders = groupOrders.filter(
      (o) => o.status !== 'cancelled' && String(o.payment_method || '') !== 'cortesia',
    );
    const editTargets = payableOrders.length ? payableOrders : (order ? [order] : []);
    const initialNote = String(
      editTargets.find((o) => String(o.payment_note || '').trim())?.payment_note || '',
    ).trim();
    setEditing({
      id: order.id,
      orderIds: editTargets.map((o) => o.id),
      docType: doc.doc_type || 'nota_venta',
      paymentNote: initialNote,
      // Una sola comanda (o cuenta sin lista de órdenes) → permite emitir boleta/factura con cliente.
      singleComanda: groupOrders.length <= 1,
    });
    setEditPaymentMethod(editTargets[0]?.payment_method || order.payment_method || 'efectivo');
    setEditDocType(doc.doc_type || 'nota_venta');
    setEditPaymentNote(initialNote);
    const existingDocType = String(doc.customer_doc_type || '').trim();
    setEditCustomerDocType(
      existingDocType === '6' || doc.doc_type === 'factura' ? '6' : (existingDocType === '0' ? '0' : '1'),
    );
    setEditCustomerDocNumber(String(doc.customer_doc_number || '').replace(/\D/g, ''));
    setEditCustomerName(String(doc.customer_name || '').trim());
    setEditCustomerAddress(
      String(doc.customer_address || '').trim() || restaurantLocalAddress(restaurantInfo),
    );
    setEditCustomerPhone(String(doc.customer_phone || '').trim());
    setSelected(order);
    setSelectedGroup(group);
  };

  const consultarPadronEdit = async () => {
    const docType = editDocType === 'factura' ? '6' : editCustomerDocType;
    if (docType !== '1' && docType !== '6') {
      toast.error('Seleccione DNI o RUC');
      return;
    }
    const num = String(editCustomerDocNumber || '').replace(/\D/g, '');
    const okLen = docType === '6' ? num.length === 11 : num.length === 8;
    if (!okLen) {
      toast.error(docType === '6' ? 'Ingrese un RUC de 11 dígitos' : 'Ingrese un DNI de 8 dígitos');
      return;
    }
    const limit = Number(user?.padron_quota?.limit);
    const used = Number(user?.padron_quota?.used) || 0;
    if (Number.isFinite(limit) && limit > 0 && used >= limit) {
      toast.error(`Límite mensual de consultas DNI/RUC alcanzado (${limit}).`);
      return;
    }
    try {
      setConsultaPadronLoading(true);
      const data = await api.get(
        `/admin-modules/consulta-padron?doc_type=${encodeURIComponent(docType)}&numero=${encodeURIComponent(num)}`,
      );
      const nombre = String(data?.nombre || '').trim();
      if (!nombre) {
        toast.error('No se recibió el nombre del padrón');
        return;
      }
      setEditCustomerName(nombre);
      const direccion = String(data?.direccion || '').trim();
      if (direccion) setEditCustomerAddress(direccion);
      toast.success(docType === '6' ? 'Razón social obtenida del padrón' : 'Nombre obtenido del padrón');
    } catch (err) {
      toast.error(err?.message || 'No se pudo consultar el padrón');
    } finally {
      setConsultaPadronLoading(false);
    }
  };

  const issueComprobanteFromEdit = async () => {
    if (!editing?.id) return;
    if (!editing.singleComanda) {
      toast.error('Emita el comprobante desde una venta de una sola comanda');
      return;
    }
    if (editDocType === 'factura') {
      const ruc = editCustomerDocNumber.replace(/\D/g, '');
      if (!/^\d{11}$/.test(ruc)) return toast.error('Para factura indique RUC del cliente (11 dígitos)');
      if (!editCustomerName.trim()) return toast.error('Para factura indique razón social del cliente');
    }
    if (editDocType === 'boleta' && editCustomerDocType === '1') {
      const dni = editCustomerDocNumber.replace(/\D/g, '');
      if (dni && !/^\d{8}$/.test(dni)) return toast.error('DNI inválido (8 dígitos)');
    }
    const localAddr = restaurantLocalAddress(restaurantInfo);
    const customerAddress = editCustomerAddress.trim() || localAddr;
    setIssuingDoc(true);
    try {
      for (const orderId of editing.orderIds) {
        await api.put(`/orders/${orderId}/payment`, {
          payment_method: editPaymentMethod,
          ...(editPaymentNote.trim() !== editing.paymentNote ? { payment_note: editPaymentNote.trim() } : {}),
        });
      }
      const doc = await api.post('/billing/issue', {
        order_id: editing.id,
        doc_type: editDocType,
        replace_existing: true,
        customer: {
          doc_type: editDocType === 'factura' ? '6' : editCustomerDocType,
          doc_number: editCustomerDocNumber.replace(/\D/g, ''),
          name: editCustomerName.trim() || 'CLIENTE VARIOS',
          address: customerAddress,
          phone: editCustomerPhone.trim(),
        },
      });
      const st = String(doc?.provider_status || '').toLowerCase();
      const label = billingStatusLabel(st);
      const xmlOk = billingFileIsOpenable(doc?.xml_url) || Boolean(String(doc?.xml_url || '').trim());
      toast.success(
        doc?.full_number
          ? `${doc.full_number} — ${label}${xmlOk ? ' · XML guardado' : ''}`
          : `Comprobante registrado (${label})`,
      );

      if (editDocType === 'boleta' || editDocType === 'factura') {
        const order = selected || selectedGroup?.primary;
        const items = (selectedGroup?.orders || [order]).flatMap((o) => o?.items || []);
        const grouped = groupItemsByProductNameForBill(items);
        const pw = SUNAT_TICKET_WIDTH_MM;
        const plain = buildBoletaFacturaPlainText({
          restaurant: restaurantInfo,
          doc,
          groupedRows: grouped,
          formatCurrencyFn: formatCurrency,
          subtotal: Number(order?.subtotal || selectedGroup?.total || 0),
          tax: Number(order?.tax || 0),
          total: Number(selectedGroup?.total || order?.total || 0),
          discount: 0,
          customer: {
            name: editCustomerName.trim() || doc.customer_name || 'CLIENTE VARIOS',
            doc_number: editCustomerDocNumber.replace(/\D/g, '') || doc.customer_doc_number || '',
            address: customerAddress || doc.customer_address || localAddr,
          },
          widthMm: pw,
          taxKind: taxKindFromItems(items),
          printedAt: new Date(),
          paymentMethod: editPaymentMethod,
        });
        const printRes = await printCajaTicket(await withSunatQr({
          text: plain,
          preformatted: true,
          logoUrl: String(restaurantInfo?.logo || '').trim() || undefined,
          restaurantBrand: restaurantThermalBrandLine(restaurantInfo) || undefined,
          paperWidth: pw,
        }, {
          restaurant: restaurantInfo,
          doc,
          tax: Number(order?.tax || 0),
          total: Number(selectedGroup?.total || order?.total || 0),
        }));
        if (!printRes.ok) toast.error(printRes.error || 'No se pudo imprimir en la térmica de 80 mm');
        else toast.success('Comprobante enviado a la térmica de 80 mm');
      }

      setEmitModalOpen(false);
      setEditing(null);
      closeDetail();
      await load();
    } catch (err) {
      toast.error(err.message || 'No se pudo emitir el comprobante');
    } finally {
      setIssuingDoc(false);
    }
  };

  const saveChanges = async () => {
    if (!editing) return;
    setSavingEdit(true);
    try {
      const nextNote = editPaymentNote.trim();
      for (const orderId of editing.orderIds) {
        await api.put(`/orders/${orderId}/payment`, {
          payment_method: editPaymentMethod,
          ...(nextNote !== editing.paymentNote ? { payment_note: nextNote } : {}),
        });
      }
      if (editing.singleComanda && editDocType !== editing.docType) {
        await api.put(`/billing/order/${editing.id}/document`, { doc_type: editDocType });
      }
      toast.success('Registro actualizado');
      setEditing(null);
      closeDetail();
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingEdit(false);
    }
  };

  /** Impresión directa térmica en impresora de caja (sin diálogo del navegador ni página A4). */
  const printDirectAccountTicket = async (group, orderFallback = null) => {
    const primary = group?.primary || orderFallback;
    if (!primary) {
      toast.error('No hay venta para imprimir');
      return;
    }
    const orders = (group?.orders?.length ? group.orders : [primary]).filter(Boolean);
    const accountDocument = group ? getAccountDocument(group) : getOrderDocument(primary);
    const billedOrder = orders.find((o) => o?.document) || primary;
    const fullDoc = billedOrder?.document || {};
    const docType = String(accountDocument.doc_type || fullDoc.doc_type || 'nota_venta').toLowerCase();
    const fullNumber = String(accountDocument.full_number || fullDoc.full_number || primary.sale_document_number || '').trim();
    const widthMm = Number(restaurantInfo?.profile?.ticket?.paper_width_mm) === 58 ? 58 : 80;
    const grouped = groupItemsByProductNameForBill(orders.flatMap((o) => o.items || []));
    const subtotal = grouped.reduce((s, g) => s + Number(g.subtotal || 0), 0);
    const total = Number(group?.total != null ? group.total : primary.total) || 0;
    const discount = Math.max(0, subtotal - total);
    const paymentMethod = String(primary.payment_method || orders[0]?.payment_method || 'efectivo');
    const localAddr = restaurantLocalAddress(restaurantInfo);
    const customerName = String(
      fullDoc.customer_name || primary.customer_name || '',
    ).trim();
    const customerDoc = String(fullDoc.customer_doc_number || '').replace(/\D/g, '');
    const customerAddress = String(fullDoc.customer_address || '').trim() || localAddr;
    const logoUrl = String(restaurantInfo?.logo || '').trim() || undefined;
    const brand = restaurantThermalBrandLine(restaurantInfo) || undefined;

    let plain = '';
    if (docType === 'boleta' || docType === 'factura') {
      plain = buildBoletaFacturaPlainText({
        restaurant: restaurantInfo,
        doc: {
          ...fullDoc,
          doc_type: docType,
          full_number: fullNumber,
          customer_name: customerName || fullDoc.customer_name,
          customer_doc_number: customerDoc || fullDoc.customer_doc_number,
          customer_address: customerAddress,
        },
        groupedRows: grouped,
        formatCurrencyFn: formatCurrency,
        subtotal: Number(primary.subtotal != null ? primary.subtotal : subtotal),
        tax: Number(primary.tax || 0),
        total,
        discount,
        customer: {
          name: customerName || 'CLIENTE VARIOS',
          doc_number: customerDoc,
          address: customerAddress,
        },
        widthMm,
        taxKind: taxKindFromItems(orders.flatMap((o) => o.items || [])),
        printedAt: new Date(),
        paymentMethod,
      });
    } else {
      const customerLines = [
        customerName && `Nombre: ${customerName}`,
        customerDoc && `DNI / RUC: ${customerDoc}`,
        customerAddress && `Dir: ${customerAddress}`,
      ].filter(Boolean);
      plain = buildNotaVentaPlainText({
        restaurant: restaurantInfo,
        docLine: fullNumber,
        tableName: group?.mesaLabel || primary.table_number || '',
        customerLines,
        groupedRows: grouped,
        formatCurrencyFn: formatCurrency,
        subtotal,
        total,
        discount,
        widthMm,
        printedAt: new Date(),
        paymentMethod,
      });
    }

    const r = await printCajaTicket({
      text: plain,
      preformatted: true,
      logoUrl,
      restaurantBrand: brand,
      paperWidth: widthMm,
    });
    if (r.ok) {
      const kind = docType === 'factura' ? 'Factura' : docType === 'boleta' ? 'Boleta' : 'Nota de venta';
      toast.success(`${kind} enviada a impresora de caja`);
    } else {
      toast.error(r.error || 'No se pudo imprimir en impresora de caja');
    }
  };

  const openGroupReceipt = (group) => {
    void printDirectAccountTicket(group);
  };

  const openReceipt = (order, group = null) => {
    if (group) {
      void printDirectAccountTicket(group, order);
      return;
    }
    void printDirectAccountTicket({ primary: order, orders: [order], total: order?.total }, order);
  };

  const openVoidModal = (order) => {
    if (order.status === 'cancelled') return;
    setVoidModalOrder(order);
    setVoidReason('');
  };

  const confirmAnularVenta = async () => {
    const order = voidModalOrder;
    if (!order || order.status === 'cancelled') return;
    const reason = voidReason.trim();
    if (reason.length < 3) {
      toast.error('Escriba el motivo de anulación (mínimo 3 caracteres).');
      return;
    }
    setVoidSubmitting(true);
    try {
      await api.put(`/orders/${order.id}/status`, { status: 'cancelled', cancellation_reason: reason });
      await api.put(`/orders/${order.id}/payment`, { payment_status: 'refunded' });
      toast.success('Venta anulada');
      setVoidModalOrder(null);
      setVoidReason('');
      if (selected?.id === order.id) closeDetail();
      setSaleTab('anuladas');
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setVoidSubmitting(false);
    }
  };

  const runSaleAction = (action, group) => {
    const o = group.primary || {};
    if (action === 'ver') openGroupDetail(group);
    else if (action === 'imprimir') openReceipt(o, group);
    else if (action === 'excel') {
      if (group.comprobanteCount === 1) downloadExcel({ ...o, local_name: restaurantName });
      else group.orders.forEach((ord) => downloadExcel({ ...ord, local_name: restaurantName }));
    } else if (action === 'editar') {
      startEdit(group);
    } else if (action === 'anular') {
      if (group.comprobanteCount === 1) openVoidModal(o);
      else openGroupDetail(group);
    }
  };

  const renderSaleActions = (group) => (
    <SaleActionButtons group={group} onAction={runSaleAction} isVoided={isVoidedTab} />
  );

  /** Informes abre Ventas con `?abrir=<pedido>&accion=<acción>` para reutilizar estas acciones. */
  const [searchParams, setSearchParams] = useSearchParams();
  const pendingUrlAction = useRef(null);
  useEffect(() => {
    const orderId = searchParams.get('abrir');
    const action = searchParams.get('accion');
    if (!orderId) return;
    pendingUrlAction.current = { orderId, action: SALE_ACTIONS.includes(action) ? action : 'ver' };
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('abrir');
      next.delete('accion');
      return next;
    }, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const pending = pendingUrlAction.current;
    if (!pending || loading) return;
    const group = displayGroups.find((g) => (g.orders || []).some((ord) => String(ord.id) === String(pending.orderId)));
    pendingUrlAction.current = null;
    if (!group) {
      toast.error('No se encontró la venta en el listado');
      return;
    }
    runSaleAction(pending.action, group);
  });

  if (loading) return <div className="flex justify-center py-16"><div className="animate-spin w-8 h-8 border-4 border-gold-500 border-t-transparent rounded-full" /></div>;

  return (
    <div className="-mt-1 sm:-mt-3">
      {!isAiTab ? (
      <>
      <div className={`grid gap-2 sm:gap-4 mb-3 ${isVoidedTab ? 'grid-cols-2 lg:grid-cols-2' : 'grid-cols-2 lg:grid-cols-4'}`}>
        {(isVoidedTab
          ? [
              {
                key: 'voided-count',
                title: t('totals.voidedCount'),
                value: displayGroups.length,
                hint: 'ventas anuladas en el filtro',
                Icon: MdCancel,
                Deco: MdReceipt,
                wrap: 'from-sky-50 to-white border-sky-200/80',
                bubble: 'from-sky-400 to-blue-600 shadow-blue-500/30',
                deco: 'text-sky-300/80',
              },
              {
                key: 'voided-total',
                title: t('totals.voidedReferenceTotal'),
                value: formatCurrency(totals.total),
                hint: 'monto de referencia',
                Icon: MdAttachMoney,
                Deco: MdTrendingUp,
                wrap: 'from-slate-50 to-white border-slate-200/80',
                bubble: 'from-slate-400 to-slate-600 shadow-slate-500/30',
                deco: 'text-slate-300/80',
              },
            ]
          : [
              {
                key: 'total',
                title: 'Total Ventas',
                value: formatCurrency(totals.total),
                hint: 'suma del filtro actual',
                Icon: MdAttachMoney,
                Deco: MdTrendingUp,
                wrap: 'from-emerald-50 to-white border-emerald-200/80',
                bubble: 'from-emerald-400 to-emerald-600 shadow-emerald-500/30',
                deco: 'text-emerald-400/70',
              },
              {
                key: 'paid',
                title: 'Cobrado',
                value: formatCurrency(totals.paid),
                hint: 'pagos confirmados',
                Icon: MdPayments,
                Deco: MdAccountBalanceWallet,
                wrap: 'from-sky-50 to-white border-sky-200/80',
                bubble: 'from-sky-400 to-blue-600 shadow-blue-500/30',
                deco: 'text-sky-300/80',
              },
              {
                key: 'pending',
                title: 'Pendiente',
                value: formatCurrency(totals.pending),
                hint: 'por cobrar',
                Icon: MdSchedule,
                Deco: MdHourglassEmpty,
                wrap: 'from-amber-50 to-white border-amber-200/80',
                bubble: 'from-amber-400 to-orange-500 shadow-amber-500/30',
                deco: 'text-amber-300/80',
              },
              {
                key: 'count',
                title: 'Cuentas cobradas',
                value: totals.count,
                hint: lifetimeSales > 0 ? `Interno ${formatSaleNumero(lifetimeSales)}` : 'cuentas pagadas',
                Icon: MdReceipt,
                Deco: MdPointOfSale,
                wrap: 'from-violet-50 to-white border-violet-200/80',
                bubble: 'from-violet-400 to-purple-600 shadow-purple-500/30',
                deco: 'text-violet-300/80',
              },
            ]
        ).map((k) => (
          <div
            key={k.key}
            className={`relative overflow-hidden rounded-xl sm:rounded-2xl border bg-gradient-to-br ${k.wrap} p-3 sm:p-5 shadow-sm`}
          >
            <k.Deco className={`pointer-events-none absolute right-2 top-2 sm:right-4 sm:top-4 text-3xl sm:text-5xl ${k.deco}`} />
            <div className="pointer-events-none absolute -bottom-10 -right-6 h-28 w-48 rounded-full bg-white/50" />
            <div className="relative flex items-start gap-2 sm:gap-4">
              <span className={`grid h-9 w-9 sm:h-14 sm:w-14 shrink-0 place-items-center rounded-full bg-gradient-to-br text-white shadow-lg ${k.bubble}`}>
                <k.Icon className="text-lg sm:text-2xl" />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] sm:text-sm font-semibold text-slate-800 truncate" title={k.title}>{k.title}</p>
                <p className="mt-0.5 sm:mt-1 text-xl sm:text-4xl font-bold leading-none text-slate-900 tabular-nums truncate" title={String(k.value)}>{k.value}</p>
                <p className="mt-1 sm:mt-2 text-[10px] sm:text-xs text-slate-500 line-clamp-2">{k.hint}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-nowrap items-center gap-1.5 sm:gap-2 mb-3">
        {[
          { id: 'activas', label: t('tabs.active') },
          { id: 'anuladas', label: t('tabs.voided') },
          { id: 'ia', label: t('tabs.ai'), icon: true },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => handleSaleTabChange(tab.id)}
            className={`rf-tab-btn inline-flex items-center gap-1 sm:gap-1.5 shrink-0 text-sm ${
              saleTab === tab.id ? 'rf-tab-btn--active' : ''
            }`}
          >
            {tab.icon ? (
              <img
                src={getFadeyAiAvatarSrc('saludo')}
                alt=""
                className="w-5 h-5 rounded-full object-cover object-top shrink-0"
                draggable={false}
              />
            ) : null}
            {tab.label}
          </button>
        ))}
      </div>
      </>
      ) : (
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2 min-w-0">
        <p className="text-sm font-semibold text-[var(--ui-body-text)] inline-flex items-center gap-2">
          <img
            src={getFadeyAiAvatarSrc('saludo')}
            alt=""
            className="w-6 h-6 rounded-full object-cover object-top"
            draggable={false}
          />
          IA · Ventas
        </p>
        <div className="flex items-center gap-1.5 shrink-0">
          {[
            { id: 'activas', label: t('tabs.active') },
            { id: 'anuladas', label: t('tabs.voided') },
            { id: 'ia', label: t('tabs.ai'), icon: true },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleSaleTabChange(tab.id)}
              className={`min-h-[2.5rem] px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors border inline-flex items-center gap-1.5 ${
                saleTab === tab.id
                  ? 'bg-[var(--ui-accent)] text-white border-[color:var(--ui-accent)] shadow-md'
                  : 'bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] border-[color:var(--ui-border)] hover:bg-[var(--ui-sidebar-hover)]'
              }`}
            >
              {tab.icon ? (
                <img
                  src={getFadeyAiAvatarSrc('saludo')}
                  alt=""
                  className="w-5 h-5 rounded-full object-cover object-top shrink-0"
                  draggable={false}
                />
              ) : null}
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      )}

      {isAiTab ? (
        <VentasAiPanel
          orders={orders}
          filtered={aiOrdersSource}
          totals={aiTotals}
          fromDate={fromDate}
          toDate={toDate}
          onExport={() => downloadDetalleVentas('excel')}
        />
      ) : (
      <div className="rounded-xl shadow-sm border border-[color:var(--ui-border)] bg-[var(--ui-surface)] p-3">
        <div className="mb-3 space-y-2">
          <div className="relative w-full">
            <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ui-muted)]" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por producto, #, mesa (ej. 20 o M20) o cliente..." className="input-field pl-9" />
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="relative" ref={filtersPanelRef}>
              <button
                type="button"
                onClick={() => setFiltersOpen((v) => !v)}
                className={`h-9 px-3 rounded-lg text-sm border inline-flex items-center gap-1.5 ${
                  hasActiveFilters || filtersOpen
                    ? 'border-[color:var(--ui-accent)] bg-[var(--ui-accent)]/10 text-[var(--ui-body-text)]'
                    : 'border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]'
                }`}
                aria-expanded={filtersOpen}
              >
                <MdFilterList className="text-base shrink-0" />
                Filtros
                {hasActiveFilters ? (
                  <span className="ml-0.5 min-w-[1.1rem] h-4 px-1 rounded-full bg-[var(--ui-accent)] text-white text-[10px] leading-4 text-center">
                    !
                  </span>
                ) : null}
              </button>
              {filtersOpen ? (
                <div className="absolute left-0 top-full z-30 mt-1 w-[min(100vw-2rem,20rem)] rounded-xl border border-[color:var(--ui-border)] bg-[var(--ui-surface)] shadow-lg p-3 space-y-2.5">
                  {!isVoidedTab ? (
                    <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input-field w-full cursor-pointer">
                      <option value="all">Todos los pagos</option><option value="paid">Pagado</option><option value="pending">Pendiente</option><option value="refunded">Reembolsado</option>
                    </select>
                  ) : null}
                  <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="input-field w-full cursor-pointer">
                    <option value="all">Todos los tipos</option><option value="dine_in">Mesa</option>{showDeliveryUi ? <option value="delivery">Delivery</option> : null}<option value="pickup">Para llevar</option>
                  </select>
                  <select value={waiterFilter} onChange={e => setWaiterFilter(e.target.value)} className="input-field w-full cursor-pointer">
                    <option value="all">Todos los meseros</option>
                    {waiterOptions.map(name => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                  <InlineDateField
                    label="Desde"
                    value={fromDate}
                    onChange={setFromDate}
                    roundedNone={false}
                    className="!rounded-lg w-full"
                  />
                  <InlineDateField
                    label="Hasta"
                    value={toDate}
                    onChange={setToDate}
                    roundedNone={false}
                    className="!rounded-lg w-full"
                  />
                  {!isVoidedTab ? (
                    <div className="pt-1 border-t border-[color:var(--ui-border)]">
                      <DownloadExcelTxtButtons
                        onExcel={() => downloadDetalleVentas('excel')}
                        onTxt={() => downloadDetalleVentas('txt')}
                        excelTitle="Descargar detalle de ventas (Excel)"
                        txtTitle="Descargar detalle de ventas (TXT)"
                        disabled={!filtered.length}
                        className="w-full justify-stretch sm:justify-start"
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={clearAllFilters}
              disabled={!hasActiveFilters}
              className="h-9 px-3 rounded-lg text-sm border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)] inline-flex items-center gap-1.5 disabled:opacity-40 disabled:pointer-events-none"
            >
              <MdClose className="text-base shrink-0" />
              Limpiar filtro
            </button>
          </div>
        </div>

        <VentasCuentasTable
          groups={currentMonthGroups}
          isVoidedTab={isVoidedTab}
          emptyMessage={
            pastMonths.length
              ? 'Sin ventas este mes'
              : (isVoidedTab ? 'Sin ventas anuladas' : 'Sin ventas encontradas')
          }
          onStatusClick={goToDescuentosHighlight}
          onAccountPurged={() => void load()}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={toggleSort}
          showActions
          renderActions={renderSaleActions}
        />

        {pastMonths.length ? (
          <div className="mt-4 space-y-3">
            {pastMonths.map((month) => {
              const open = openMonthKeys.has(month.key);
              return (
                <div
                  key={month.key}
                  className="rounded-xl border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)]"
                >
                  <div className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ui-muted)]">
                        Ventas del mes
                      </p>
                      <p className="text-base font-bold text-[var(--ui-body-text)]">{month.label}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleMonthOpen(month.key)}
                      className={open ? 'btn-secondary text-sm px-4 py-2' : 'btn-primary text-sm px-4 py-2'}
                    >
                      {open ? 'Ocultar' : 'Inspeccionar'}
                    </button>
                  </div>
                  {open ? (
                    <div className="border-t border-[color:var(--ui-border)] bg-[var(--ui-surface)] p-2 rounded-b-xl">
                      <VentasCuentasTable
                        groups={month.groups}
                        isVoidedTab={isVoidedTab}
                        emptyMessage="Sin ventas en este mes"
                        onStatusClick={goToDescuentosHighlight}
                        onAccountPurged={() => void load()}
                        sortKey={sortKey}
                        sortDir={sortDir}
                        onSort={toggleSort}
                        showActions
                        renderActions={renderSaleActions}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
      )}

      <Modal
        isOpen={!!selected}
        onClose={closeDetail}
        title={
          selectedGroup?.isSalesAccount && selectedGroup?.isMesa
            ? `Cuenta Mesa ${selectedGroup.primary.table_number}${selectedGroup.isPendingAccount ? ' (pendiente)' : ''}`
            : selectedGroup?.isMesa && selectedGroup.comprobanteCount > 1
            ? `Cuenta Mesa ${selectedGroup.primary.table_number}`
            : `Venta #${selected?.order_number}`
        }
        size="md"
      >
        {selected && selectedGroup && (
          <div className="space-y-4">
            {editing?.id === selected.id && (
              <div className="bg-[var(--ui-surface-2)] border border-[color:var(--ui-border)] rounded-lg p-3 space-y-3">
                <p className="text-sm font-semibold text-[var(--ui-body-text)]">Editar registro</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-[var(--ui-muted)] mb-1">Metodo de pago</label>
                    <select className="input-field text-sm" value={editPaymentMethod} onChange={e => setEditPaymentMethod(e.target.value)}>
                      {PAYMENT_METHOD_KEYS.map((value) => (
                        <option key={value} value={value}>{payLabel(value)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--ui-muted)] mb-1">Comprobante</label>
                    <select
                      className="input-field text-sm disabled:opacity-60"
                      value={editDocType}
                      onChange={(e) => {
                        const next = e.target.value;
                        setEditDocType(next);
                        if (next === 'factura') setEditCustomerDocType('6');
                        if ((next === 'boleta' || next === 'factura') && !String(editCustomerAddress || '').trim()) {
                          setEditCustomerAddress(restaurantLocalAddress(restaurantInfo));
                        }
                        // Igual que Caja: al elegir boleta/factura abre el modal de emisión.
                        if (next === 'boleta' || next === 'factura') {
                          if (!editing.singleComanda) {
                            toast.error('Emita desde Caja o abra una venta de una sola comanda');
                            return;
                          }
                          setEmitModalOpen(true);
                        } else {
                          setEmitModalOpen(false);
                        }
                      }}
                      disabled={!editing.singleComanda}
                    >
                      {DOC_TYPE_KEYS.map((value) => (
                        <option key={value} value={value}>{docLabel(value)}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label htmlFor="edit-payment-note" className="block text-xs text-[var(--ui-muted)] mb-1">Nota del pago</label>
                  <textarea
                    id="edit-payment-note"
                    rows={2}
                    maxLength={300}
                    className="input-field w-full text-sm resize-y"
                    placeholder="Ej.: Cliente pagó con Yape, no en efectivo"
                    value={editPaymentNote}
                    onChange={(e) => setEditPaymentNote(e.target.value)}
                  />
                </div>
                {editing.orderIds.length > 1 ? (
                  <p className="text-xs text-[var(--ui-muted)]">
                    El método se aplica a las {editing.orderIds.length} comandas de la cuenta; la propina se mantiene y pasa al nuevo método en el cierre de caja.
                  </p>
                ) : null}
                {(editDocType === 'boleta' || editDocType === 'factura') && editing.singleComanda ? (
                  <p className="text-[11px] text-sky-800 bg-sky-50 border border-sky-200 rounded px-2 py-1.5">
                    Se abrió el modal de emisión (igual que en Caja). Si lo cerró, pulse de nuevo «Emitir comprobante».
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <button onClick={saveChanges} disabled={savingEdit || issuingDoc} className="btn-primary text-sm flex items-center gap-2 disabled:opacity-50">
                    <MdSave /> {savingEdit ? 'Guardando...' : 'Guardar cambios'}
                  </button>
                  {editing.singleComanda && (editDocType === 'boleta' || editDocType === 'factura') ? (
                    <button
                      type="button"
                      onClick={() => setEmitModalOpen(true)}
                      disabled={savingEdit || issuingDoc}
                      className="btn-secondary text-sm inline-flex items-center gap-2 disabled:opacity-50 border-sky-300 text-sky-800 bg-sky-50 hover:bg-sky-100"
                      title="Abrir modal de emisión (mismo flujo que Caja)"
                    >
                      <MdReceipt />
                      Emitir comprobante
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      setEmitModalOpen(false);
                      setEditing(null);
                    }}
                    disabled={savingEdit || issuingDoc}
                    className="btn-secondary text-sm"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
            {editing?.id !== selected.id
              && !selectedGroup.isPendingAccount
              && !isVoidedTab
              && (selectedGroup.orders || []).some((o) => o.status !== 'cancelled' && o.payment_status === 'paid') ? (
                <div className="flex justify-end">
                  <button type="button" onClick={() => startEdit(selectedGroup)} className="btn-secondary text-sm">
                    Editar método de pago
                  </button>
                </div>
              ) : null}

            {selected.status === 'cancelled' && String(selected.cancellation_reason || '').trim() ? (
              <div className="rounded-lg border border-red-500/50 bg-[var(--ui-surface-2)] px-3 py-2.5 text-sm text-[var(--ui-body-text)] shadow-inner">
                <span className="font-semibold text-[var(--ui-body-text)]">Motivo de anulación: </span>
                <span>{selected.cancellation_reason}</span>
              </div>
            ) : null}
            {selected.status !== 'cancelled' && parseProductRemovalNotesFromOrder(selected.notes) ? (
              <div className="rounded-lg border border-amber-500/40 bg-[var(--ui-surface-2)] px-3 py-2.5 text-sm text-[var(--ui-body-text)] shadow-inner">
                <span className="font-semibold text-[var(--ui-body-text)]">Productos retirados: </span>
                <span>{parseProductRemovalNotesFromOrder(selected.notes)}</span>
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="ui-text-muted">Fecha</p>
                <p className="font-medium">
                  {selectedGroup.isPendingAccount
                    ? 'Sin cobrar'
                    : formatDateTime(selectedGroup.latestAt)}
                </p>
              </div>
              <div>
                <p className="ui-text-muted">Tipo</p>
                <p className="font-medium">
                  {selectedGroup.isMesa
                    ? `Mesa ${selectedGroup.primary.table_number}`
                    : selected.type}
                </p>
              </div>
              <div><p className="ui-text-muted">Total mesa</p><p className="font-medium">{formatCurrency(selectedGroup.total)}</p></div>
              <div><p className="ui-text-muted">Estado</p><p className="font-medium">{getAccountAuditStatusBadge(selectedGroup).label}</p></div>
            </div>
            <div className="border-t border-[color:var(--ui-border)] pt-3">
              <p className="font-medium mb-2 text-[var(--ui-body-text)]">
                Productos {selectedGroup.isMesa ? `(cuenta — ${selectedGroup.mesaLabel})` : ''}:
              </p>
              {selectedGroup.groupedProducts.map((it) => (
                <div key={it.key} className="flex justify-between text-sm py-1 border-b border-[color:var(--ui-border)] text-[var(--ui-body-text)]">
                  <span>{it.qty}x {it.name}</span>
                  <span className="font-medium">{formatCurrency(it.subtotal)}</span>
                </div>
              ))}
            </div>
            {selectedGroup.comprobanteCount > 1 && selectedGroup.isMesa && !selectedGroup.isPendingAccount ? (
              <p className="text-xs text-[var(--ui-muted)]">
                {selectedGroup.comprobanteCount} comandas de producción · un comprobante de venta
              </p>
            ) : null}
            <div className="grid grid-cols-2 gap-3 text-sm border-t border-[color:var(--ui-border)] pt-3">
              <div>
                <p className="ui-text-muted">Metodo de Pago</p>
                <div className="font-medium break-words">
                  {selectedGroup.paymentSummary && selectedGroup.paymentSummary !== '—' ? (
                    <PaymentSummaryDisplay detail={selectedGroup.paymentDetail} fallback={selectedGroup.paymentSummary} />
                  ) : (
                    <PaymentSummaryDisplay
                      detail={orderPaymentDetail(selected)}
                      fallback={formatOrderPaymentLabel(selected, payLabel)}
                    />
                  )}
                </div>
              </div>
              <div>
                <p className="ui-text-muted">Comprobante</p>
                <p className="font-medium">{(() => { const doc = getAccountDocument(selectedGroup); return `${docLabel(doc.doc_type)} - ${doc.full_number}`; })()}</p>
              </div>
              {selectedGroup.paymentNote ? (
                <div className="col-span-2">
                  <p className="ui-text-muted">Nota del pago</p>
                  <p className="font-medium whitespace-pre-wrap break-words">{selectedGroup.paymentNote}</p>
                </div>
              ) : null}
            </div>
            {selectedGroup.observations?.observed && selectedGroup.observations.items?.length ? (
              <div className="rounded-lg border border-amber-500/40 bg-[var(--ui-surface-2)] px-3 py-2.5 text-sm text-[var(--ui-body-text)]">
                <p className="font-semibold mb-1">Motivo de «Observado»:</p>
                <ul className="list-disc pl-5 space-y-0.5">
                  {selectedGroup.observations.items.map((item, idx) => (
                    <li key={`${item.kind}-${item.recordId || idx}`}>
                      <span className="font-medium">{item.label}:</span> {item.detail}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="border-t border-[color:var(--ui-border)] pt-3 space-y-1 text-[var(--ui-body-text)]">
              <div className="flex justify-between font-bold text-lg">
                <span>Total venta</span><span>{formatCurrency(selectedGroup.total)}</span>
              </div>
              {Number(selectedGroup.tipTotal || 0) > 0 ? (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="ui-text-muted">Propina</span>
                    <span className="font-medium">+{formatCurrency(selectedGroup.tipTotal)}</span>
                  </div>
                  <div className="flex justify-between font-bold">
                    <span>Total cobrado</span><span>{formatCurrency(selectedGroup.collectedTotal)}</span>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={!!voidModalOrder}
        onClose={() => { if (!voidSubmitting) { setVoidModalOrder(null); setVoidReason(''); } }}
        title={voidModalOrder ? `Anular venta #${voidModalOrder.order_number}` : 'Anular venta'}
      >
        {voidModalOrder && (
          <div className="space-y-4">
            <p className="text-sm text-[var(--ui-muted)]">
              Esta acción marcará la venta como anulada y el pago como reembolsado. Indique el motivo (obligatorio).
            </p>
            <div>
              <label htmlFor="void-reason" className="block text-xs font-medium text-[var(--ui-body-text)] mb-1">Motivo de anulación</label>
              <textarea
                id="void-reason"
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                rows={4}
                className="input-field w-full text-sm resize-y min-h-[100px]"
                placeholder="Ej.: Error en cobro, devolución del cliente, duplicado…"
                disabled={voidSubmitting}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                className="btn-secondary text-sm"
                disabled={voidSubmitting}
                onClick={() => { setVoidModalOrder(null); setVoidReason(''); }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50 border border-red-500/50"
                disabled={voidSubmitting}
                onClick={() => { confirmAnularVenta(); }}
              >
                {voidSubmitting ? 'Anulando…' : 'Confirmar anulación'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={emitModalOpen && !!editing}
        onClose={() => !issuingDoc && setEmitModalOpen(false)}
        title={editDocType === 'factura' ? 'Emitir factura' : 'Emitir boleta'}
        size="md"
      >
        <div className="space-y-3">
          <p className="text-sm text-[var(--ui-muted)]">
            Mismo flujo que al cobrar en Caja: indique el cliente y pulse Emitir.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {editDocType === 'boleta' ? (
              <div>
                <label className="block text-xs text-[var(--ui-muted)] mb-1">Doc. cliente</label>
                <select
                  className="input-field text-sm"
                  value={editCustomerDocType}
                  onChange={(e) => setEditCustomerDocType(e.target.value)}
                >
                  <option value="1">DNI</option>
                  <option value="6">RUC</option>
                  <option value="0">Sin documento</option>
                </select>
              </div>
            ) : (
              <div>
                <label className="block text-xs text-[var(--ui-muted)] mb-1">Doc. cliente</label>
                <input className="input-field text-sm" value="RUC" disabled />
              </div>
            )}
            <div>
              <label className="block text-xs text-[var(--ui-muted)] mb-1">
                {editDocType === 'factura' || editCustomerDocType === '6' ? 'RUC' : 'Número'}
              </label>
              <div className="flex gap-2">
                <input
                  className="input-field text-sm min-w-0 flex-1"
                  value={editCustomerDocNumber}
                  onChange={(e) => setEditCustomerDocNumber(e.target.value.replace(/\D/g, '').slice(0, 11))}
                  placeholder={editDocType === 'factura' || editCustomerDocType === '6' ? '11 dígitos' : '8 dígitos'}
                />
                {(editDocType === 'factura' || editCustomerDocType === '1' || editCustomerDocType === '6') && (
                  <button
                    type="button"
                    title="Consultar nombre o razón social en el padrón"
                    onClick={() => void consultarPadronEdit()}
                    disabled={consultaPadronLoading}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[color:var(--ui-accent)] px-2.5 text-xs font-medium text-[var(--ui-accent-muted)] hover:bg-[#2563EB]/10 disabled:opacity-50"
                  >
                    <MdSearch className="text-lg" />
                    Padrón
                  </button>
                )}
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-[var(--ui-muted)] mb-1">
                {editDocType === 'factura' ? 'Razón social' : 'Nombre / Cliente'}
              </label>
              <input
                className="input-field text-sm"
                value={editCustomerName}
                onChange={(e) => setEditCustomerName(e.target.value)}
                placeholder={editDocType === 'factura' ? 'Razón social' : 'Nombre de quien recibe la boleta'}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-[var(--ui-muted)] mb-1">Dirección</label>
              <input
                className="input-field text-sm"
                value={editCustomerAddress}
                onChange={(e) => setEditCustomerAddress(e.target.value)}
                placeholder={restaurantLocalAddress(restaurantInfo) || 'Dirección del local'}
              />
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <button
              type="button"
              className="btn-secondary text-sm"
              disabled={issuingDoc}
              onClick={() => setEmitModalOpen(false)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn-primary text-sm inline-flex items-center gap-2 disabled:opacity-50"
              disabled={issuingDoc}
              onClick={() => void issueComprobanteFromEdit()}
            >
              <MdReceipt />
              {issuingDoc ? 'Emitiendo…' : (editDocType === 'factura' ? 'Emitir factura' : 'Emitir boleta')}
            </button>
          </div>
        </div>
      </Modal>

    </div>
  );
}
