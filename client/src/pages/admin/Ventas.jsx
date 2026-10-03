import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { api, formatCurrency, formatDateTime, formatDate, parseApiDate, isDateKeyInInclusiveRange, toLocalDateKey } from '../../utils/api';
import toast from 'react-hot-toast';
import { useSocket } from '../../hooks/useSocket';
import { MdSearch, MdSave } from 'react-icons/md';
import Modal from '../../components/Modal';
import i18n from '../../i18n';
import { buildVentasDisplayGroups, isCourtesyOrder, orderMatchesMesaSearch, parseProductRemovalNotesFromOrder, summarizePaidSalesAccounts, getObservationRecordIds } from '../../utils/mesaOrderLines';
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

function payLabel(method) {
  if (!method) return '';
  const key = `paymentMethods.${method}`;
  const tr = i18n.t(key, { ns: 'sales', defaultValue: '' });
  return tr || method;
}

function orderReceiptHtml(order, groupedProducts = null) {
  const doc = getOrderDocument(order);
  const lines = groupedProducts || (order.items || []).map((i) => ({
    name: i.product_name,
    qty: i.quantity,
    subtotal: i.subtotal,
  }));
  const itemsHtml = lines
    .map((i) => `<tr><td>${i.qty}x ${i.name}</td><td style="text-align:right">${Number(i.subtotal || 0).toFixed(2)}</td></tr>`)
    .join('');
  const titleExtra = groupedProducts && groupedProducts.length ? ` · Mesa ${order.table_number || ''}` : '';
  return `
    <html>
      <head>
        <title>Venta ${order.order_number}</title>
        <style>
          body { font-family: Arial, sans-serif; font-size: 12px; padding: 18px; }
          h2 { margin: 0 0 6px 0; }
          .muted { color: #64748b; margin: 0 0 8px 0; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          td { padding: 4px 0; border-bottom: 1px solid #e2e8f0; }
          .total { margin-top: 12px; font-size: 16px; font-weight: 700; text-align: right; }
        </style>
      </head>
      <body>
        <h2>${docLabel(doc.doc_type)} ${doc.full_number}${titleExtra}</h2>
        <p class="muted">Venta #${order.order_number} · ${new Date(`${order.created_at}Z`).toLocaleString('es-PE')}</p>
        <p><strong>Cliente:</strong> ${order.customer_name || 'PUBLICO GENERAL'}</p>
        <p><strong>Pago:</strong> ${formatOrderPaymentLabel(order, payLabel)}</p>
        <table><tbody>${itemsHtml}</tbody></table>
        <p class="total">Total: S/ ${Number(order.total || 0).toFixed(2)}</p>
      </body>
    </html>
  `;
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
  const [savingEdit, setSavingEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [restaurantName, setRestaurantName] = useState('-');
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
  };

  const startEdit = (group) => {
    const order = group.primary;
    const doc = getAccountDocument(group);
    const payableOrders = (group.orders || []).filter(
      (o) => o.status !== 'cancelled' && String(o.payment_method || '') !== 'cortesia',
    );
    const initialNote = String(
      payableOrders.find((o) => String(o.payment_note || '').trim())?.payment_note || '',
    ).trim();
    setEditing({
      id: order.id,
      orderIds: payableOrders.map((o) => o.id),
      docType: doc.doc_type || 'nota_venta',
      paymentNote: initialNote,
      singleComanda: (group.orders || []).length === 1,
    });
    setEditPaymentMethod(payableOrders[0]?.payment_method || order.payment_method || 'efectivo');
    setEditDocType(doc.doc_type || 'nota_venta');
    setEditPaymentNote(initialNote);
    setSelected(order);
    setSelectedGroup(group);
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

  const openReceiptHtml = (html) => {
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
      toast.error('No se pudo preparar la impresion');
      document.body.removeChild(iframe);
      return;
    }

    doc.open();
    doc.write(html);
    doc.close();

    setTimeout(() => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      setTimeout(() => {
        if (document.body.contains(iframe)) document.body.removeChild(iframe);
      }, 700);
    }, 200);
  };

  const openGroupReceipt = (group) => {
    const primary = group.primary;
    const lines = group.groupedProducts.map((p) => ({
      name: p.name,
      qty: p.qty,
      subtotal: p.subtotal,
    }));
    openReceiptHtml(orderReceiptHtml(
      { ...primary, total: group.total },
      group.isMesa && group.comprobanteCount > 1 ? lines : null,
    ));
  };

  const openReceipt = (order, group = null) => {
    if (group?.isMesa && group.comprobanteCount > 1) {
      openGroupReceipt(group);
      return;
    }
    openReceiptHtml(orderReceiptHtml(order));
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
      <div className="flex flex-wrap items-stretch gap-2 mb-2 min-w-0">
        {isVoidedTab ? (
          <>
            <div className="card !py-2 !px-3 border-l-4 border-l-sky-500 flex-1 min-w-[8rem]">
              <p className="text-[10px] leading-tight text-sky-600">{t('totals.voidedCount')}</p>
              <p className="text-lg font-bold text-[var(--ui-body-text)] leading-tight">{displayGroups.length}</p>
            </div>
            <div className="card !py-2 !px-3 border-l-4 border-l-slate-400 flex-1 min-w-[8rem]">
              <p className="text-[10px] leading-tight ui-text-muted">{t('totals.voidedReferenceTotal')}</p>
              <p className="text-lg font-bold text-[var(--ui-body-text)] leading-tight">{formatCurrency(totals.total)}</p>
            </div>
          </>
        ) : (
          <>
            <div className="card !py-2 !px-3 border-l-4 border-l-slate-400 flex-1 min-w-[8rem]">
              <p className="text-[10px] leading-tight ui-text-muted">Total Ventas</p>
              <p className="text-lg font-bold text-[var(--ui-body-text)] leading-tight">{formatCurrency(totals.total)}</p>
            </div>
            <div className="card !py-2 !px-3 border-l-4 border-l-emerald-500 flex-1 min-w-[8rem]">
              <p className="text-[10px] leading-tight text-emerald-600">Cobrado</p>
              <p className="text-lg font-bold text-emerald-400 leading-tight">{formatCurrency(totals.paid)}</p>
            </div>
            <div className="card !py-2 !px-3 border-l-4 border-l-amber-500 flex-1 min-w-[8rem]">
              <p className="text-[10px] leading-tight text-amber-600">Pendiente</p>
              <p className="text-lg font-bold text-amber-300 leading-tight">{formatCurrency(totals.pending)}</p>
            </div>
            <div className="card !py-2 !px-3 border-l-4 border-l-sky-500 flex-1 min-w-[8rem]">
              <p className="text-[10px] leading-tight text-sky-600">Cuentas cobradas</p>
              <p className="text-lg font-bold text-[var(--ui-body-text)] leading-tight">{totals.count}</p>
              {lifetimeSales > 0 ? (
                <p className="text-[10px] text-[var(--ui-muted)] leading-tight">Interno {formatSaleNumero(lifetimeSales)}</p>
              ) : null}
            </div>
          </>
        )}
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
              className={`h-full min-h-[2.5rem] px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors border inline-flex items-center gap-1.5 ${
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
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="relative flex-1 min-w-[220px]">
            <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ui-muted)]" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por producto, #, mesa (ej. 20 o M20) o cliente..." className="input-field pl-9" />
          </div>
          {!isVoidedTab ? (
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input-field w-auto min-w-[160px] cursor-pointer">
            <option value="all">Todos los pagos</option><option value="paid">Pagado</option><option value="pending">Pendiente</option><option value="refunded">Reembolsado</option>
          </select>
          ) : null}
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="input-field w-auto min-w-[140px] cursor-pointer">
            <option value="all">Todos los tipos</option><option value="dine_in">Mesa</option>{showDeliveryUi ? <option value="delivery">Delivery</option> : null}<option value="pickup">Para llevar</option>
          </select>
          <select value={waiterFilter} onChange={e => setWaiterFilter(e.target.value)} className="input-field w-auto min-w-[160px] cursor-pointer">
            <option value="all">Todos los meseros</option>
            {waiterOptions.map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          {!isVoidedTab ? (
            <DownloadExcelTxtButtons
              onExcel={() => downloadDetalleVentas('excel')}
              onTxt={() => downloadDetalleVentas('txt')}
              excelTitle="Descargar detalle de ventas (Excel)"
              txtTitle="Descargar detalle de ventas (TXT)"
              disabled={!filtered.length}
              className="shrink-0"
            />
          ) : null}
          <InlineDateField
            label="Desde"
            value={fromDate}
            onChange={setFromDate}
            roundedNone={false}
            className="!rounded-lg"
          />
          <InlineDateField
            label="Hasta"
            value={toDate}
            onChange={setToDate}
            roundedNone={false}
            className="!rounded-lg"
          />
          <button
            type="button"
            onClick={() => { setFromDate(''); setToDate(''); }}
            className="h-9 px-3 rounded-lg text-sm border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)] inline-flex items-center"
          >
            Limpiar fechas
          </button>
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
                      onChange={e => setEditDocType(e.target.value)}
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
                <div className="flex flex-wrap gap-2">
                  <button onClick={saveChanges} disabled={savingEdit} className="btn-primary text-sm flex items-center gap-2 disabled:opacity-50">
                    <MdSave /> {savingEdit ? 'Guardando...' : 'Guardar cambios'}
                  </button>
                  <button type="button" onClick={() => setEditing(null)} disabled={savingEdit} className="btn-secondary text-sm">
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

    </div>
  );
}
