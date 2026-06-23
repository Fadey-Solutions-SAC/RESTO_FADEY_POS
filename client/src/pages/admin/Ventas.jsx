import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { api, formatCurrency, formatDateTime, formatDate, formatTime, parseApiDate } from '../../utils/api';
import toast from 'react-hot-toast';
import { useSocket } from '../../hooks/useSocket';
import { MdSearch, MdVisibility, MdEdit, MdSave, MdPrint, MdTableChart, MdCancel, MdDownload } from 'react-icons/md';
import Modal from '../../components/Modal';
import i18n from '../../i18n';
import { buildSalesDisplayGroups, isCourtesyOrder, orderMatchesMesaSearch } from '../../utils/mesaOrderLines';
import { useShowDeliveryUi } from '../../hooks/useDeliveryEnabled';

const PAYMENT_STATUS_STYLES = {
  paid: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40',
  pending: 'bg-amber-500/20 text-amber-300 border border-amber-500/40',
  refunded: 'bg-orange-500/20 text-orange-300 border border-orange-500/40',
};

function getSaleStatusBadge(order, t) {
  if (order.status === 'cancelled') {
    return { label: 'Anulada', className: 'bg-red-500/20 text-red-300 border border-red-500/50' };
  }
  if (String(order.payment_method || '').trim().toLowerCase() === 'cortesia') {
    return { label: 'Cortesía', className: 'bg-violet-500/20 text-violet-300 border border-violet-500/40' };
  }
  const ps = String(order.payment_status || 'pending');
  const label = t(`status.${ps}`, { defaultValue: ps === 'paid' ? 'Pagado' : ps === 'pending' ? 'Pendiente' : ps });
  const className = PAYMENT_STATUS_STYLES[ps] || 'bg-slate-500/20 text-slate-300 border border-slate-500/30';
  return { label, className };
}

function getSalesGroupStatusBadge(group, t) {
  const orders = group?.orders || [];
  if (orders.length === 0) return getSaleStatusBadge({}, t);
  if (orders.every((o) => o.status === 'cancelled')) {
    return { label: 'Anulada', className: 'bg-red-500/20 text-red-300 border border-red-500/50' };
  }
  const salesOrders = orders.filter((o) => o.status !== 'cancelled' && !isCourtesyOrder(o));
  const courtesyOrders = orders.filter((o) => o.status !== 'cancelled' && isCourtesyOrder(o));
  if (salesOrders.length === 0 && courtesyOrders.length > 0) {
    return { label: 'Cortesía', className: 'bg-violet-500/20 text-violet-300 border border-violet-500/40' };
  }
  const paid = salesOrders.filter((o) => o.payment_status === 'paid').length;
  const pending = salesOrders.filter((o) => String(o.payment_status || 'pending') === 'pending').length;
  if (paid === salesOrders.length && salesOrders.length > 0) return getSaleStatusBadge({ payment_status: 'paid' }, t);
  if (pending === salesOrders.length && salesOrders.length > 0) return getSaleStatusBadge({ payment_status: 'pending' }, t);
  if (paid > 0 && pending > 0) {
    return { label: 'Parcial', className: 'bg-sky-500/20 text-sky-200 border border-sky-500/40' };
  }
  if (courtesyOrders.length > 0 && salesOrders.length > 0) {
    return { label: 'Mixto', className: 'bg-slate-500/20 text-slate-200 border border-slate-500/40' };
  }
  return getSaleStatusBadge(orders[0], t);
}

function getSaleStatusDetailLabel(order, t) {
  if (order.status === 'cancelled') return 'Anulada';
  return t(`status.${order.payment_status}`, { defaultValue: order.payment_status });
}

function payLabel(method) {
  if (!method) return '';
  const key = `paymentMethods.${method}`;
  const tr = i18n.t(key, { ns: 'sales', defaultValue: '' });
  return tr || method;
}

function docLabel(docType) {
  if (!docType) return '';
  const key = `docTypes.${docType}`;
  const tr = i18n.t(key, { ns: 'sales', defaultValue: '' });
  return tr || docType;
}

function getOrderDocument(order) {
  const docType = order.sale_document_type || order.document?.doc_type || 'nota_venta';
  const noteNumber = `001-${String(order.order_number || 0).padStart(8, '0')}`;
  const fullNumber = order.sale_document_number || order.document?.full_number || noteNumber;
  return { doc_type: docType, full_number: fullNumber };
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
        <p><strong>Pago:</strong> ${payLabel(order.payment_method)}</p>
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
  const paymentLabel = payLabel(order.payment_method);
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
    isCancelled ? (order.cancellation_reason || order.notes || '-') : '-',
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

function downloadAllSalesExcel(orders) {
  const header = [
    'Fecha', 'Hora', 'Mesa', 'Mesero', 'Local', 'Caja', 'Turno', 'Cliente', 'DNI/RUC', 'Tipo Doc.',
    'Serie Doc.', 'Num Doc.', 'Forma de pago', 'Monto pagado', 'Retencion', 'Propina', 'Subtotal',
    'IGV 18%', 'ICBPER', 'Impuestos', 'Total', 'Descuento', 'Tipo', 'Estado', 'Anulado por',
    'Aprobado por', 'Motivo', 'Canal de venta', 'Canal de delivery', 'Usuario solicitante',
    'Descuento redondeo', 'Tipo de descuento', 'Motivo descuento', 'Porcentaje de descuento',
    'Codigo integracion delivery', 'Observacion', 'Codigo vendedor',
  ];
  const rows = [header, ...orders.map((o) => toTemplateRow(o, o.local_name || '-'))];
  const html = toExcelHtmlTable(rows);
  const bom = '\uFEFF';
  const blob = new Blob([bom + html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = `ventas-${new Date().toISOString().slice(0, 10)}.xls`;
  link.click();
  URL.revokeObjectURL(url);
}

const PAYMENT_METHOD_KEYS = ['efectivo', 'yape', 'plin', 'tarjeta', 'online'];
const DOC_TYPE_KEYS = ['nota_venta', 'boleta', 'factura'];

export default function Ventas() {
  const { t } = useTranslation('sales');
  const showDeliveryUi = useShowDeliveryUi();
  const [orders, setOrders] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [waiterFilter, setWaiterFilter] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  /** activas | anuladas | todas */
  const [saleTab, setSaleTab] = useState('activas');
  const [voidModalOrder, setVoidModalOrder] = useState(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidSubmitting, setVoidSubmitting] = useState(false);
  const [selected, setSelected] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editPaymentMethod, setEditPaymentMethod] = useState('efectivo');
  const [editDocType, setEditDocType] = useState('nota_venta');
  const [savingEdit, setSavingEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [restaurantName, setRestaurantName] = useState('-');

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
      setFiltered(merged);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadRef = useRef(load);
  loadRef.current = load;
  useSocket('billing-document-update', useCallback(() => { loadRef.current(); }, []));
  useSocket('order-update', useCallback(() => { loadRef.current(); }, []));

  useEffect(() => { load(); }, []);

  useEffect(() => {
    let f = orders;
    if (search) {
      const q = search.trim();
      const qLower = q.toLowerCase();
      f = f.filter(
        (o) =>
          String(o.order_number || '').includes(q) ||
          (o.customer_name || '').toLowerCase().includes(qLower) ||
          orderMatchesMesaSearch(o, q),
      );
    }
    if (statusFilter !== 'all') f = f.filter(o => o.payment_status === statusFilter);
    if (typeFilter !== 'all') f = f.filter(o => o.type === typeFilter);
    if (waiterFilter !== 'all') {
      f = f.filter(o => (o.created_by_user_name || o.customer_name || '-').toLowerCase() === waiterFilter.toLowerCase());
    }
    if (fromDate) {
      const from = new Date(`${fromDate}T00:00:00`);
      f = f.filter(o => new Date(`${o.created_at}Z`) >= from);
    }
    if (toDate) {
      const to = new Date(`${toDate}T23:59:59`);
      f = f.filter(o => new Date(`${o.created_at}Z`) <= to);
    }
    if (saleTab === 'activas') f = f.filter((o) => o.status !== 'cancelled');
    else f = f.filter((o) => o.status === 'cancelled');
    setFiltered(f);
  }, [search, statusFilter, typeFilter, waiterFilter, fromDate, toDate, saleTab, orders]);

  useEffect(() => {
    if (!showDeliveryUi && typeFilter === 'delivery') setTypeFilter('all');
  }, [showDeliveryUi, typeFilter]);

  const displayGroups = useMemo(() => buildSalesDisplayGroups(filtered), [filtered]);

  const waiterOptions = Array.from(
    new Set(orders.map(o => (o.created_by_user_name || o.customer_name || '-')).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, 'es'));

  const totals = {
    total: filtered.filter((o) => !isCourtesyOrder(o)).reduce((s, o) => s + (o.total || 0), 0),
    paid: filtered.filter((o) => o.payment_status === 'paid' && !isCourtesyOrder(o)).reduce((s, o) => s + (o.total || 0), 0),
    pending: filtered.filter((o) => o.payment_status === 'pending').reduce((s, o) => s + (o.total || 0), 0),
    count: displayGroups.length,
    transactions: filtered.length,
  };

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

  const startEdit = (order) => {
    const doc = getOrderDocument(order);
    setEditing(order);
    setEditPaymentMethod(order.payment_method || 'efectivo');
    setEditDocType(doc.doc_type || 'nota_venta');
    setSelected(order);
    const group = displayGroups.find((g) => g.orders.some((o) => o.id === order.id));
    if (group) setSelectedGroup(group);
  };

  const saveChanges = async () => {
    if (!editing) return;
    setSavingEdit(true);
    try {
      await api.put(`/orders/${editing.id}/payment`, { payment_method: editPaymentMethod });
      await api.put(`/billing/order/${editing.id}/document`, { doc_type: editDocType });
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

  if (loading) return <div className="flex justify-center py-16"><div className="animate-spin w-8 h-8 border-4 border-gold-500 border-t-transparent rounded-full" /></div>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-[var(--ui-body-text)] mb-3">{t('title')}</h1>

      <div className="flex flex-wrap gap-2 mb-5">
        {[
          { id: 'activas', label: t('tabs.active') },
          { id: 'anuladas', label: t('tabs.voided') },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSaleTab(tab.id)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors border ${
              saleTab === tab.id
                ? 'bg-[var(--ui-accent)] text-white border-[color:var(--ui-accent)] shadow-md'
                : 'bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] border-[color:var(--ui-border)] hover:bg-[var(--ui-sidebar-hover)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-5">
        <div className="card border-l-4 border-l-slate-400"><p className="text-xs ui-text-muted">Total Ventas</p><p className="text-xl font-bold text-[var(--ui-body-text)]">{formatCurrency(totals.total)}</p></div>
        <div className="card border-l-4 border-l-emerald-500"><p className="text-xs text-emerald-600">Cobrado</p><p className="text-xl font-bold text-emerald-400">{formatCurrency(totals.paid)}</p></div>
        <div className="card border-l-4 border-l-amber-500"><p className="text-xs text-amber-600">Pendiente</p><p className="text-xl font-bold text-amber-300">{formatCurrency(totals.pending)}</p></div>
        <div className="card border-l-4 border-l-sky-500"><p className="text-xs text-sky-600">Registros</p><p className="text-xl font-bold text-[var(--ui-body-text)]">{totals.count}</p><p className="text-[10px] text-[var(--ui-muted)]">{totals.transactions} comprobante(s)</p></div>
      </div>

      <div className="rounded-xl shadow-sm border border-[color:var(--ui-border)] bg-[var(--ui-surface)] p-5">
        <div className="flex flex-wrap gap-3 mb-4">
          <div className="relative flex-1 min-w-[220px]">
            <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ui-muted)]" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por #, mesa (ej. 20 o M20) o cliente..." className="input-field pl-9" />
          </div>
          <button
            onClick={() => downloadAllSalesExcel(filtered.map(o => ({ ...o, local_name: restaurantName })))}
            className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 flex items-center gap-2"
            title="Descargar todas las ventas en Excel"
          >
            <MdDownload /> Descargar todas
          </button>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input-field w-auto min-w-[160px] cursor-pointer">
            <option value="all">Todos los pagos</option><option value="paid">Pagado</option><option value="pending">Pendiente</option><option value="refunded">Reembolsado</option>
          </select>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="input-field w-auto min-w-[140px] cursor-pointer">
            <option value="all">Todos los tipos</option><option value="dine_in">Mesa</option>{showDeliveryUi ? <option value="delivery">Delivery</option> : null}<option value="pickup">Para llevar</option>
          </select>
          <select value={waiterFilter} onChange={e => setWaiterFilter(e.target.value)} className="input-field w-auto min-w-[160px] cursor-pointer">
            <option value="all">Todos los meseros</option>
            {waiterOptions.map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <input
            type="date"
            value={fromDate}
            onChange={e => setFromDate(e.target.value)}
            className="input-field w-auto"
            title="Desde"
          />
          <input
            type="date"
            value={toDate}
            onChange={e => setToDate(e.target.value)}
            className="input-field w-auto"
            title="Hasta"
          />
          <button
            type="button"
            onClick={() => { setFromDate(''); setToDate(''); }}
            className="px-3 py-2 rounded-lg text-sm border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]"
          >
            Limpiar fechas
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[var(--ui-muted)] border-b border-[color:var(--ui-border)]">
              <th className="pb-2 font-medium">Fecha</th><th className="pb-2 font-medium">Mesa</th><th className="pb-2 font-medium">Caja</th><th className="pb-2 font-medium">Mesero</th><th className="pb-2 font-medium">Cliente</th><th className="pb-2 font-medium">Documento</th><th className="pb-2 font-medium">Pagos</th><th className="pb-2 font-medium">Venta</th><th className="pb-2 font-medium">Estado</th><th className="pb-2 font-medium">Opciones</th>
            </tr></thead>
            <tbody>
              {displayGroups.map((group) => {
                const o = group.primary;
                const doc = getOrderDocument(o);
                const mesero = o.created_by_user_name || o.customer_name || '-';
                const statusBadge = getSalesGroupStatusBadge(group, t);
                const latest = parseApiDate(group.latestAt);
                const earliest = parseApiDate(group.earliestAt);
                const sameDay = group.comprobanteCount === 1
                  || (latest && earliest && formatDate(group.latestAt) === formatDate(group.earliestAt));
                return (
                  <tr key={group.key} className="border-b border-[color:var(--ui-border)] hover:bg-[var(--ui-sidebar-hover)]">
                    <td className="py-2.5">
                      <p className="font-medium text-[var(--ui-body-text)]">{formatDate(group.latestAt)}</p>
                      <p className="text-xs text-[var(--ui-muted)]">
                        {group.comprobanteCount > 1 && !sameDay
                          ? `${formatTime(group.earliestAt)} – ${formatTime(group.latestAt)}`
                          : formatTime(group.latestAt)}
                        {group.comprobanteCount > 1 ? ` · ${group.comprobanteCount} pagos` : ''}
                      </p>
                    </td>
                    <td className="py-2.5 text-[var(--ui-body-text)] font-semibold">{group.mesaLabel}</td>
                    <td className="py-2.5 text-[var(--ui-muted)]">Caja 01</td>
                    <td className="py-2.5 text-[var(--ui-body-text)]">{mesero}</td>
                    <td className="py-2.5 text-[var(--ui-body-text)]">
                      {group.isMesa ? `Mesa ${o.table_number}` : (o.customer_name || 'PUBLICO GENERAL')}
                    </td>
                    <td className="py-2.5">
                      {group.comprobanteCount > 1 ? (
                        <>
                          <p className="font-medium text-[var(--ui-body-text)]">{group.comprobanteCount} comprobantes</p>
                          <p className="text-xs text-[var(--ui-muted)]">{docLabel(doc.doc_type)} · {doc.full_number}…</p>
                        </>
                      ) : (
                        <>
                          <p className="font-medium text-[var(--ui-body-text)]">{docLabel(doc.doc_type)}</p>
                          <p className="text-xs text-[var(--ui-muted)]">{doc.full_number}</p>
                        </>
                      )}
                    </td>
                    <td className="py-2.5 font-medium text-[var(--ui-body-text)] text-xs leading-relaxed">
                      {group.paymentSummary || '-'}
                    </td>
                    <td className="py-2.5 font-bold text-[var(--ui-body-text)]">{formatCurrency(group.total)}</td>
                    <td className="py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wide ${statusBadge.className}`}>
                        {statusBadge.label}
                      </span>
                    </td>
                    <td className="py-2.5">
                      <div className="flex items-center gap-1 relative">
                        <button onClick={() => openGroupDetail(group)} className="px-2 py-1 rounded bg-slate-600 text-white text-xs hover:bg-slate-700" title="Ver"><MdVisibility /></button>
                        <button onClick={() => openReceipt(o, group)} className="px-2 py-1 rounded bg-cyan-600 text-white text-xs hover:bg-cyan-700" title="Imprimir"><MdPrint /></button>
                        <button
                          onClick={() => {
                            if (group.comprobanteCount === 1) downloadExcel({ ...o, local_name: restaurantName });
                            else group.orders.forEach((ord) => downloadExcel({ ...ord, local_name: restaurantName }));
                          }}
                          className="px-2 py-1 rounded bg-emerald-600 text-white text-xs hover:bg-emerald-700"
                          title="Excel"
                        >
                          <MdTableChart />
                        </button>
                        <button
                          onClick={() => {
                            if (group.comprobanteCount === 1) startEdit(o);
                            else openGroupDetail(group);
                          }}
                          className="px-2 py-1 rounded bg-amber-500 text-white text-xs hover:bg-amber-600"
                          title="Editar"
                        >
                          <MdEdit />
                        </button>
                        <button
                          onClick={() => {
                            if (group.comprobanteCount === 1) openVoidModal(o);
                            else openGroupDetail(group);
                          }}
                          disabled={group.orders.every((ord) => ord.status === 'cancelled')}
                          className="px-2 py-1 rounded bg-red-600 text-white text-xs hover:bg-red-700 disabled:opacity-50"
                          title="Anular venta"
                        >
                          <MdCancel />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {displayGroups.length === 0 && <tr><td colSpan="10" className="py-8 text-center text-[var(--ui-muted)]">Sin ventas encontradas</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        isOpen={!!selected}
        onClose={closeDetail}
        title={
          selectedGroup?.isMesa && selectedGroup.comprobanteCount > 1
            ? `Mesa ${selectedGroup.primary.table_number} — ${selectedGroup.comprobanteCount} comprobantes`
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
                    <select className="input-field text-sm" value={editDocType} onChange={e => setEditDocType(e.target.value)}>
                      {DOC_TYPE_KEYS.map((value) => (
                        <option key={value} value={value}>{docLabel(value)}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <button onClick={saveChanges} disabled={savingEdit} className="btn-primary text-sm flex items-center gap-2 disabled:opacity-50">
                  <MdSave /> {savingEdit ? 'Guardando...' : 'Guardar cambios'}
                </button>
              </div>
            )}

            {selected.status === 'cancelled' && (selected.cancellation_reason || selected.notes) ? (
              <div className="rounded-lg border border-red-500/50 bg-[var(--ui-surface-2)] px-3 py-2.5 text-sm text-[var(--ui-body-text)] shadow-inner">
                <span className="font-semibold text-[var(--ui-body-text)]">Motivo de anulación: </span>
                <span>{selected.cancellation_reason || selected.notes}</span>
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="ui-text-muted">Fecha</p><p className="font-medium">{formatDateTime(selectedGroup.latestAt)}</p></div>
              <div>
                <p className="ui-text-muted">Tipo</p>
                <p className="font-medium">
                  {selectedGroup.isMesa
                    ? `Mesa ${selectedGroup.primary.table_number}`
                    : selected.type}
                </p>
              </div>
              <div><p className="ui-text-muted">Total mesa</p><p className="font-medium">{formatCurrency(selectedGroup.total)}</p></div>
              <div><p className="ui-text-muted">Estado</p><p className="font-medium">{getSalesGroupStatusBadge(selectedGroup, t).label}</p></div>
            </div>
            <div className="border-t border-[color:var(--ui-border)] pt-3">
              <p className="font-medium mb-2 text-[var(--ui-body-text)]">
                Productos {selectedGroup.isMesa ? `(agrupados — ${selectedGroup.mesaLabel})` : ''}:
              </p>
              {selectedGroup.groupedProducts.map((it) => (
                <div key={it.key} className="flex justify-between text-sm py-1 border-b border-[color:var(--ui-border)] text-[var(--ui-body-text)]">
                  <span>{it.qty}x {it.name}</span>
                  <span className="font-medium">{formatCurrency(it.subtotal)}</span>
                </div>
              ))}
            </div>
            {selectedGroup.comprobanteCount > 1 && (
              <div className="border-t border-[color:var(--ui-border)] pt-3 space-y-2">
                <p className="font-medium text-[var(--ui-body-text)]">Comprobantes por pago</p>
                {selectedGroup.orders.map((ord) => {
                  const doc = getOrderDocument(ord);
                  const badge = getSaleStatusBadge(ord, t);
                  return (
                    <div
                      key={ord.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] px-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-[var(--ui-body-text)]">
                          #{ord.order_number} · {docLabel(doc.doc_type)} {doc.full_number}
                        </p>
                        <p className="text-xs text-[var(--ui-muted)]">
                          {formatDateTime(ord.created_at)} · {payLabel(ord.payment_method)} · {formatCurrency(ord.total)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${badge.className}`}>{badge.label}</span>
                        <button type="button" onClick={() => startEdit(ord)} className="px-2 py-1 rounded bg-amber-500 text-white text-xs hover:bg-amber-600" title="Editar"><MdEdit /></button>
                        <button
                          type="button"
                          onClick={() => openVoidModal(ord)}
                          disabled={ord.status === 'cancelled'}
                          className="px-2 py-1 rounded bg-red-600 text-white text-xs hover:bg-red-700 disabled:opacity-50"
                          title="Anular"
                        >
                          <MdCancel />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {selectedGroup.comprobanteCount === 1 && (
              <div className="grid grid-cols-2 gap-3 text-sm border-t border-[color:var(--ui-border)] pt-3">
                <div><p className="ui-text-muted">Metodo de Pago</p><p className="font-medium">{payLabel(selected.payment_method)}</p></div>
                <div>
                  <p className="ui-text-muted">Comprobante</p>
                  <p className="font-medium">{(() => { const doc = getOrderDocument(selected); return `${docLabel(doc.doc_type)} - ${doc.full_number}`; })()}</p>
                </div>
              </div>
            )}
            <div className="border-t border-[color:var(--ui-border)] pt-3 flex justify-between font-bold text-lg text-[var(--ui-body-text)]">
              <span>Total</span><span>{formatCurrency(selectedGroup.total)}</span>
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
