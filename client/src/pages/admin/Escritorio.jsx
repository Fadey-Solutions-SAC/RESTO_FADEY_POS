import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import toast from 'react-hot-toast';
import { api, formatCurrency, parseApiDate, toLocalDateKey, PAYMENT_METHODS, formatInstantTime } from '../../utils/api';
import { useSocket } from '../../hooks/useSocket';
import { useActiveInterval } from '../../hooks/useActiveInterval';
import { useDeliverySettings } from '../../hooks/useDeliveryEnabled';
import { useNavigate, Link } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { MdDateRange, MdKeyboardArrowDown, MdKitchen, MdLocalBar, MdDeliveryDining, MdPointOfSale, MdTableBar, MdBolt, MdWarning } from 'react-icons/md';

import { useChartTheme } from '../../theme/useChartTheme';
import {
  isActiveProductionQueueOrder,
  orderPendingForBarStation,
  orderPendingForKitchenStation,
} from '../../utils/productionArea';
import { isDiscountOrder } from '../../utils/mesaOrderLines';

const PAYMENT_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#06b6d4', '#a855f7'];
const toInputDate = (date) => {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
const getCurrentMonthRange = () => {
  const now = new Date();
  return {
    start: toInputDate(new Date(now.getFullYear(), now.getMonth(), 1)),
    end: toInputDate(now),
  };
};
const formatDateForLabel = (value) => {
  if (!value) return '-';
  const [y, m, d] = String(value).split('-');
  if (!y || !m || !d) return value;
  return `${d}/${m}/${y}`;
};

/** 1 venta = 1 mesa (mismo table_number) o, sin mesa, 1 pedido (delivery / mostrador). */
function ventaMesaKey(order) {
  if (!order) return '';
  const t = String(order.table_number || '').trim();
  if (t) return `mesa:${t}`;
  return `pedido:${order.id || ''}`;
}

export default function Escritorio() {
  const CHART_COLORS = useChartTheme();
  const { enabled: deliveryEnabled, loaded: deliverySettingsLoaded } = useDeliverySettings();
  const [orders, setOrders] = useState([]);
  const [liveDash, setLiveDash] = useState(null);
  const [liveDashLoading, setLiveDashLoading] = useState(true);
  const [liveDashError, setLiveDashError] = useState('');
  const [loading, setLoading] = useState(true);
  const [restaurantInfo, setRestaurantInfo] = useState({ name: 'Resto-FADEY', address: '', phone: '' });
  const [datePreset, setDatePreset] = useState('month');
  const [startDate, setStartDate] = useState(getCurrentMonthRange().start);
  const [endDate, setEndDate] = useState(getCurrentMonthRange().end);
  const [datePickStep, setDatePickStep] = useState('idle');
  const [rankingMode, setRankingMode] = useState('dias');
  const startDateInputRef = useRef(null);
  const endDateInputRef = useRef(null);
  const navigate = useNavigate();

  const deliveryModuleActive = useMemo(() => {
    if (deliverySettingsLoaded) return deliveryEnabled;
    if (liveDash?.deliveryEnabled != null) return Boolean(liveDash.deliveryEnabled);
    return true;
  }, [deliverySettingsLoaded, deliveryEnabled, liveDash?.deliveryEnabled]);

  const monitoreoSyncLabel = useMemo(() => {
    const parts = ['Caja', 'Mesas'];
    if (deliveryModuleActive) parts.push('Delivery');
    parts.push('inventario');
    return parts.join(', ');
  }, [deliveryModuleActive]);

  const loadLiveDash = useCallback(async () => {
    setLiveDashLoading(true);
    try {
      const d = await api.get('/reports/dashboard');
      setLiveDash(d);
      setLiveDashError('');
    } catch (err) {
      const msg = String(err?.message || '').trim() || 'No se pudo cargar el monitoreo en vivo';
      try {
        const op = await api.get('/reports/operational-alerts');
        setLiveDash({
          operationalSummary: op.summary,
          operationalAlerts: op.alerts,
          insightToday: op.insightToday,
          generated_at: op.generated_at,
          activeOrders: op.summary?.activeOrders ?? 0,
          tablesWithActiveOrders: op.summary?.tablesWithActiveOrders ?? 0,
          deliveryActiveCount: op.summary?.deliveryActiveCount ?? 0,
          inKitchenCount: op.summary?.inKitchenCount ?? 0,
          registerOpen: op.summary?.registerOpen ?? false,
          deliveryEnabled: op.deliveryEnabled,
          openRegisters: [],
          registerOpenSummary: null,
          lowStock: [],
          liveSales: null,
          today: null,
        });
        setLiveDashError('');
      } catch {
        setLiveDash(null);
        setLiveDashError(msg);
      }
    } finally {
      setLiveDashLoading(false);
    }
  }, []);

  const loadData = async () => {
    try {
      const allOrders = await api.get('/orders');
      setOrders(allOrders);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);
  useActiveInterval(loadData, 10000);

  useEffect(() => {
    loadLiveDash();
  }, [loadLiveDash]);
  useEffect(() => {
    if (typeof window === 'undefined' || window.location.hash !== '#monitoreo-vivo') return;
    const el = document.getElementById('monitoreo-vivo');
    if (!el) return;
    const t = window.setTimeout(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
    return () => window.clearTimeout(t);
  }, [loading, liveDashLoading]);
  useActiveInterval(loadLiveDash, 15000);
  useSocket('order-update', () => {
    loadData();
    void loadLiveDash();
  });
  useSocket('table-update', loadLiveDash);
  useSocket('delivery-update', loadLiveDash);
  useSocket('register-update', loadLiveDash);
  useSocket('inventory-update', loadLiveDash);
  useSocket('billing-document-update', () => {
    void loadLiveDash();
  });
  useEffect(() => {
    if (datePreset !== 'month') return;
    const monthRange = getCurrentMonthRange();
    setStartDate(monthRange.start);
    setEndDate(monthRange.end);
  }, [datePreset]);
  useEffect(() => {
    api
      .get('/restaurant')
      .then((cfg) => {
        setRestaurantInfo(cfg || { name: 'Resto-FADEY', address: '', phone: '' });
      })
      .catch(() => {});
  }, []);

  const scopedOrdersAll = useMemo(() => {
    const valid = [...orders];
    if (datePreset === 'total') return valid;
    const from = String(startDate || '');
    const to = String(endDate || '');
    if (!from || !to) return valid;
    return valid.filter((o) => {
      const dateKey = toLocalDateKey(o.updated_at || o.created_at);
      return dateKey >= from && dateKey <= to;
    });
  }, [orders, datePreset, startDate, endDate]);
  const scopedOrders = useMemo(
    () => scopedOrdersAll.filter(o => o.status !== 'cancelled'),
    [scopedOrdersAll]
  );
  const paidOrders = useMemo(
    () => scopedOrders.filter((o) => o.payment_status === 'paid' && String(o.payment_method || '').toLowerCase() !== 'cortesia'),
    [scopedOrders]
  );
  const todayDateKey = useMemo(() => toInputDate(new Date()), []);
  const paidOrdersToday = useMemo(
    () => orders.filter((o) => {
      if (o.status === 'cancelled' || o.payment_status !== 'paid') return false;
      if (String(o.payment_method || '').toLowerCase() === 'cortesia') return false;
      return toLocalDateKey(o.updated_at || o.created_at) === todayDateKey;
    }),
    [orders, todayDateKey],
  );
  const paidOrdersTodayTotal = useMemo(
    () => paidOrdersToday.reduce((sum, o) => sum + Number(o.total || 0), 0),
    [paidOrdersToday],
  );
  const paidOrdersCount = useMemo(
    () => scopedOrdersAll.filter((o) => o.status !== 'cancelled' && o.payment_status === 'paid' && String(o.payment_method || '').toLowerCase() !== 'cortesia').length,
    [scopedOrdersAll]
  );
  const pendingPaymentCount = useMemo(
    () => scopedOrdersAll.filter(o => o.status !== 'cancelled' && o.payment_status !== 'paid').length,
    [scopedOrdersAll]
  );
  const cancelledOrdersCount = useMemo(
    () => scopedOrdersAll.filter(o => o.status === 'cancelled').length,
    [scopedOrdersAll]
  );

  const hourlySales = useMemo(() => {
    const byHour = {};
    for (let h = 0; h < 24; h += 1) byHour[String(h).padStart(2, '0')] = 0;
    paidOrders.forEach((o) => {
      const parsed = parseApiDate(o.updated_at || o.created_at);
      if (!parsed) return;
      const hour = parsed.getHours();
      byHour[String(hour).padStart(2, '0')] += Number(o.total || 0);
    });
    return Object.entries(byHour).map(([hour, total]) => ({
      hour: `${hour}:00`,
      sales: Number(total.toFixed(2)),
    }));
  }, [paidOrders]);

  const peakHour = hourlySales.reduce((best, item) => item.sales > best.sales ? item : best, { hour: '--:--', sales: -1 });
  const lowHour = hourlySales.reduce((best, item) => item.sales < best.sales ? item : best, { hour: '--:--', sales: Number.MAX_VALUE });

  const salesByPayment = useMemo(() => {
    const map = { efectivo: 0, tarjeta: 0, yape: 0, plin: 0, online: 0 };
    paidOrders.forEach((o) => {
      const m = o.payment_method || 'efectivo';
      map[m] = (map[m] || 0) + Number(o.total || 0);
    });
    return map;
  }, [paidOrders]);

  const paymentPieData = useMemo(() => {
    const rows = [
      { name: PAYMENT_METHODS.efectivo, value: salesByPayment.efectivo || 0, key: 'efectivo' },
      { name: PAYMENT_METHODS.tarjeta, value: salesByPayment.tarjeta || 0, key: 'tarjeta' },
      { name: PAYMENT_METHODS.yape, value: salesByPayment.yape || 0, key: 'yape' },
      { name: PAYMENT_METHODS.plin, value: salesByPayment.plin || 0, key: 'plin' },
      { name: PAYMENT_METHODS.online, value: salesByPayment.online || 0, key: 'online' },
    ].filter((r) => r.value > 0);
    return rows;
  }, [salesByPayment]);

  const totalSales = paidOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);

  const pagoMasUsado = useMemo(() => {
    if (!paidOrders.length) return null;
    const countBy = {};
    paidOrders.forEach((o) => {
      const m = o.payment_method || 'efectivo';
      countBy[m] = (countBy[m] || 0) + 1;
    });
    let bestKey = null;
    let bestN = -1;
    Object.entries(countBy).forEach(([k, n]) => {
      if (n > bestN) {
        bestN = n;
        bestKey = k;
      }
    });
    if (!bestKey) return null;
    const monto = salesByPayment[bestKey] || 0;
    const share = totalSales > 0 ? (monto / totalSales) * 100 : 0;
    return {
      label: PAYMENT_METHODS[bestKey] || bestKey,
      operaciones: bestN,
      porcentajeMonto: share,
    };
  }, [paidOrders, salesByPayment, totalSales]);

  const totalVentasMesas = useMemo(
    () => new Set(scopedOrdersAll.filter((o) => o.status !== 'cancelled').map(ventaMesaKey)).size,
    [scopedOrdersAll]
  );
  /** Solo pedidos con mesa: una mesa = una venta en el periodo (sin delivery / mostrador). */
  const totalVentasPorMesa = useMemo(() => {
    const keys = new Set();
    scopedOrdersAll
      .filter((o) => o.status !== 'cancelled' && String(o.table_number || '').trim())
      .forEach((o) => {
        keys.add(ventaMesaKey(o));
      });
    return keys.size;
  }, [scopedOrdersAll]);
  /** Productos distintos con al menos una línea en pedidos cobrados del periodo. */
  const totalVentasPorProducto = useMemo(() => {
    const ids = new Set();
    paidOrders.forEach((o) => {
      (o.items || []).forEach((it) => {
        const key = String(it.product_id || it.product_name || '').trim();
        if (key) ids.add(key);
      });
    });
    return ids.size;
  }, [paidOrders]);
  const totalDiscounts = scopedOrders
    .filter((o) => o.payment_status === 'paid' && isDiscountOrder(o))
    .reduce((sum, o) => sum + Number(o.discount || 0), 0);
  const totalCredit = paidOrders
    .filter(o => o.payment_method === 'online')
    .reduce((sum, o) => sum + Number(o.total || 0), 0);
  const parseHourToMinutes = (raw) => {
    const [h = '0', m = '0'] = String(raw || '').split(':');
    return (Number(h) * 60) + Number(m);
  };
  const isSaleInConfiguredSchedule = (order) => {
    const schedule = restaurantInfo?.schedule;
    if (!schedule || typeof schedule !== 'object') return true;
    const date = parseApiDate(order?.updated_at || order?.created_at);
    if (!date) return true;
    const dayMap = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayKey = dayMap[date.getDay()];
    const aliases = {
      sunday: ['sunday', 'domingo', 'dom'],
      monday: ['monday', 'lunes', 'lun'],
      tuesday: ['tuesday', 'martes', 'mar'],
      wednesday: ['wednesday', 'miercoles', 'miércoles', 'mie', 'mié'],
      thursday: ['thursday', 'jueves', 'jue'],
      friday: ['friday', 'viernes', 'vie'],
      saturday: ['saturday', 'sabado', 'sábado', 'sab', 'sáb'],
    };
    const cfg = (aliases[dayKey] || [])
      .map(k => schedule[k])
      .find(Boolean);
    if (!cfg) return true;
    if (cfg.enabled === false || Number(cfg.enabled) === 0) return false;
    const openMinutes = parseHourToMinutes(cfg.open || '00:00');
    const closeMinutes = parseHourToMinutes(cfg.close || '23:59');
    const currentMinutes = (date.getHours() * 60) + date.getMinutes();
    if (closeMinutes >= openMinutes) {
      return currentMinutes >= openMinutes && currentMinutes <= closeMinutes;
    }
    return currentMinutes >= openMinutes || currentMinutes <= closeMinutes;
  };
  const paidOrdersInSchedule = useMemo(
    () => paidOrders.filter(isSaleInConfiguredSchedule),
    [paidOrders, restaurantInfo]
  );
  const topSalesData = useMemo(() => {
    const grouped = {};
    if (rankingMode === 'mesas') {
      paidOrdersInSchedule.forEach((o) => {
        const table = String(o.table_number || '').trim();
        if (!table) return;
        const key = `Mesa ${table}`;
        if (!grouped[key]) grouped[key] = { name: key, value: 0, orders: 0 };
        grouped[key].value += Number(o.total || 0);
        grouped[key].orders += 1;
      });
    } else {
      paidOrdersInSchedule.forEach((o) => {
        const date = parseApiDate(o.updated_at || o.created_at);
        if (!date) return;
        const label = date.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit' });
        if (!grouped[label]) grouped[label] = { name: label, value: 0, orders: 0 };
        grouped[label].value += Number(o.total || 0);
        grouped[label].orders += 1;
      });
    }
    return Object.values(grouped)
      .sort((a, b) => Number(b.value || 0) - Number(a.value || 0))
      .slice(0, 6);
  }, [rankingMode, paidOrdersInSchedule]);

  const kitchenQueue = useMemo(
    () => orders.filter((o) => isActiveProductionQueueOrder(o) && orderPendingForKitchenStation(o)).length,
    [orders]
  );
  const barQueue = useMemo(
    () => orders.filter((o) => isActiveProductionQueueOrder(o) && orderPendingForBarStation(o)).length,
    [orders]
  );
  const deliveryReady = useMemo(
    () => orders.filter(o => o.type === 'delivery' && o.status === 'ready').length,
    [orders]
  );
  const salonActive = useMemo(
    () => orders.filter(o => o.type === 'dine_in' && ['pending', 'preparing', 'ready'].includes(o.status)).length,
    [orders]
  );
  const activeKitchenOrders = useMemo(
    () => orders.filter((o) => isActiveProductionQueueOrder(o) && orderPendingForKitchenStation(o)),
    [orders]
  );
  const activeBarOrders = useMemo(
    () => orders.filter((o) => isActiveProductionQueueOrder(o) && orderPendingForBarStation(o)),
    [orders]
  );
  const getQueueLevel = (value) => {
    if (value >= 10) return { label: 'Crítico', pill: 'bg-red-100 text-red-700', card: 'border-red-300 bg-red-50 ring-1 ring-red-300' };
    if (value >= 5) return { label: 'Alto', pill: 'bg-amber-100 text-amber-700', card: 'border-amber-300 bg-amber-50' };
    return { label: 'Normal', pill: 'bg-emerald-100 text-emerald-700', card: 'border-emerald-200 bg-emerald-50' };
  };

  const dateRangeLabel = datePreset === 'total'
    ? 'Total (desde inicio hasta hoy)'
    : `Del ${formatDateForLabel(startDate)} hasta ${formatDateForLabel(endDate)}`;
  const applyMonthRange = () => {
    const monthRange = getCurrentMonthRange();
    setDatePreset('month');
    setStartDate(monthRange.start);
    setEndDate(monthRange.end);
  };
  const openNativeDatePicker = (inputRef) => {
    const input = inputRef?.current;
    if (!input) return;
    if (typeof input.showPicker === 'function') {
      input.showPicker();
      return;
    }
    input.click();
  };
  const startRangeSelection = () => {
    setDatePickStep('start');
    setTimeout(() => openNativeDatePicker(startDateInputRef), 0);
  };
  const continueRangeSelection = () => {
    setDatePickStep('end');
    setTimeout(() => openNativeDatePicker(endDateInputRef), 0);
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin w-8 h-8 border-4 border-gold-500 border-t-transparent rounded-full" /></div>;
  }

  return (
    <div className="space-y-4">
      <div id="monitoreo-vivo" className="card p-4 border border-[color:var(--ui-border)] bg-[var(--ui-surface)] scroll-mt-4">
        <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <MdBolt className="text-xl text-[var(--ui-accent-muted)] shrink-0" />
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-[var(--ui-body-text)]">Monitoreo en vivo</h3>
              <p className="text-xs text-[var(--ui-muted)]">
                Sincronizado con {monitoreoSyncLabel}
                {liveDash?.generated_at ? (
                  <span className="ml-1">
                    · actualizado {formatInstantTime(liveDash.generated_at, { withSeconds: true })}
                  </span>
                ) : null}
              </p>
            </div>
          </div>
          {liveDash ? (
            <span
              className={`text-xs font-medium px-2 py-1 rounded-lg border ${
                liveDash.registerOpen ? 'ui-live-badge-open' : 'ui-live-badge-closed'
              }`}
            >
              {liveDash.registerOpen
                ? (liveDash.openRegisters?.length || 0) > 1
                  ? `${liveDash.openRegisters.length} cajas abiertas`
                  : liveDash.registerOpenSummary?.station_name
                    ? `Caja abierta · ${liveDash.registerOpenSummary.station_name}`
                    : 'Caja abierta'
                : 'Sin caja abierta'}
            </span>
          ) : null}
        </div>

        {liveDashLoading && !liveDash ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-[var(--ui-muted)]">
            <div className="animate-spin w-5 h-5 border-2 border-[var(--ui-accent)] border-t-transparent rounded-full" />
            Cargando monitoreo en vivo…
          </div>
        ) : null}

        {liveDashError && !liveDash ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            <p className="font-medium">No se pudo conectar con el panel en vivo</p>
            <p className="text-xs mt-1 text-amber-900/90">{liveDashError}</p>
            <button type="button" onClick={() => void loadLiveDash()} className="btn-secondary text-xs mt-3">
              Reintentar
            </button>
          </div>
        ) : null}

        {liveDash ? (
          <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-3">
            <div className="rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-[var(--ui-muted)]">
                {liveDash.liveSales?.label || 'Ventas hoy'}
              </p>
              <p className="text-lg font-bold text-[var(--ui-body-text)] tabular-nums">
                {formatCurrency(Number(liveDash.liveSales?.total ?? liveDash.today?.total ?? 0))}
              </p>
              <p className="text-[11px] text-[var(--ui-muted)]">
                {Number(liveDash.liveSales?.count ?? liveDash.today?.count ?? 0)} cobradas
                {liveDash.liveSales?.subtitle ? ` · ${liveDash.liveSales.subtitle}` : ''}
                {liveDash.registerOpen && liveDash.registerOpenSummary?.user_name
                  ? ` · ${liveDash.registerOpenSummary.user_name}`
                  : ''}
              </p>
              {liveDash.registerOpen &&
              liveDash.liveSales?.day_total != null &&
              Number(liveDash.liveSales.day_total) !== Number(liveDash.liveSales.total) ? (
                <p className="text-[10px] text-[var(--ui-muted)] mt-0.5">
                  Total del día: {formatCurrency(liveDash.liveSales.day_total)} ({liveDash.liveSales.day_count ?? 0} cobradas)
                </p>
              ) : null}
              {liveDash.liveSales?.mode === 'register_closed' && !liveDash.registerOpen ? (
                <p className="text-[10px] text-amber-600 mt-0.5">
                  No hay turno activo ahora · cifra del último cierre de caja
                </p>
              ) : null}
              {liveDash.liveSales?.mode === 'venue_closed' && !liveDash.registerOpen ? (
                <p className="text-[10px] text-[var(--ui-muted)] mt-0.5">
                  Local fuera de horario · total cobrado hoy
                </p>
              ) : null}
            </div>
            <div className="rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-[var(--ui-muted)]">Pedidos activos</p>
              <p className="text-lg font-bold text-[var(--ui-body-text)] tabular-nums">{Number(liveDash.activeOrders || 0)}</p>
              <p className="text-[11px] text-[var(--ui-muted)]">Pendiente / prep. / listo</p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/admin/mesas')}
              className="rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] px-3 py-2 text-left hover:bg-[var(--ui-sidebar-hover)] transition-colors"
            >
              <p className="text-[10px] uppercase tracking-wide text-[var(--ui-muted)]">Mesas con cuenta</p>
              <p className="text-lg font-bold text-[var(--ui-body-text)] tabular-nums">{Number(liveDash.tablesWithActiveOrders || 0)}</p>
              <p className="text-[11px] font-medium ui-live-link-rose">Ir a Mesas</p>
            </button>
            {deliveryModuleActive ? (
            <button
              type="button"
              onClick={() => navigate('/admin/delivery')}
              className="rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] px-3 py-2 text-left hover:bg-[var(--ui-sidebar-hover)] transition-colors"
            >
              <p className="text-[10px] uppercase tracking-wide text-[var(--ui-muted)]">Delivery activo</p>
              <p className="text-lg font-bold text-[var(--ui-body-text)] tabular-nums">{Number(liveDash.deliveryActiveCount || 0)}</p>
              <p className="text-[11px] font-medium ui-live-link-emerald">Ir a Delivery</p>
            </button>
            ) : deliverySettingsLoaded ? (
            <div className="rounded-lg border border-dashed border-[color:var(--ui-border)] bg-[var(--ui-body-bg)] px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-[var(--ui-muted)]">Delivery</p>
              <p className="text-sm font-semibold text-[var(--ui-muted)]">Desactivado</p>
              <button
                type="button"
                onClick={() => navigate('/admin/mi-restaurant')}
                className="text-[11px] font-medium text-[var(--ui-accent-muted)] hover:underline underline-offset-2 mt-0.5"
              >
                Activar en Mi Restaurante
              </button>
            </div>
            ) : null}
            <button
              type="button"
              onClick={() => navigate('/admin/cocina')}
              className="rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] px-3 py-2 text-left hover:bg-[var(--ui-sidebar-hover)] transition-colors"
            >
              <p className="text-[10px] uppercase tracking-wide text-[var(--ui-muted)]">En preparación</p>
              <p className="text-lg font-bold text-[var(--ui-body-text)] tabular-nums">{Number(liveDash.inKitchenCount || 0)}</p>
              <p className="text-[11px] font-medium ui-live-link-amber">Ir a Cocina</p>
            </button>
            <button
              type="button"
              onClick={() => navigate('/admin/almacen')}
              className="rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] px-3 py-2 text-left hover:bg-[var(--ui-sidebar-hover)] transition-colors"
            >
              <p className="text-[10px] uppercase tracking-wide text-[var(--ui-muted)]">Stock ≤ 10</p>
              <p className="text-lg font-bold text-[var(--ui-body-text)] tabular-nums">{liveDash.lowStock?.length ?? 0}</p>
              <p className="text-[11px] text-[var(--ui-muted)]">Inventario</p>
            </button>
          </div>
          {liveDash.operationalSummary &&
          (liveDash.operationalSummary.pendingCount != null ||
            liveDash.operationalSummary.readyCount != null ||
            liveDash.operationalSummary.staleReadyCount != null) ? (
            <div className="flex flex-wrap gap-2 mb-3 text-[11px] text-[var(--ui-body-text)]">
              <span className="rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-body-bg)] px-2 py-1 tabular-nums">
                Pendientes: <strong>{Number(liveDash.operationalSummary.pendingCount ?? 0)}</strong>
              </span>
              <span className="rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-body-bg)] px-2 py-1 tabular-nums">
                Listos: <strong>{Number(liveDash.operationalSummary.readyCount ?? 0)}</strong>
              </span>
              <span
                className={`rounded-md border px-2 py-1 tabular-nums ${
                  Number(liveDash.operationalSummary.staleReadyCount ?? 0) > 0
                    ? 'ui-live-pill-stale'
                    : 'border-[color:var(--ui-border)] bg-[var(--ui-body-bg)] text-[var(--ui-body-text)]'
                }`}
              >
                Listos {'>'}25 min: <strong>{Number(liveDash.operationalSummary.staleReadyCount ?? 0)}</strong>
              </span>
            </div>
          ) : null}
          {liveDash.insightToday ? (
            <p className="text-xs text-[var(--ui-accent-muted)] mb-2">{liveDash.insightToday}</p>
          ) : null}
          {Array.isArray(liveDash.operationalAlerts) && liveDash.operationalAlerts.length > 0 ? (
            <ul className="space-y-1.5 border-t border-[color:var(--ui-border)] pt-3">
              {liveDash.operationalAlerts.map((a) => (
                <li
                  key={a.id}
                  className={`flex items-start gap-2 text-sm rounded-lg px-2 py-1.5 ${
                    a.severity === 'warning' ? 'ui-live-alert-warning' : 'ui-live-alert-info'
                  }`}
                >
                  <MdWarning className="shrink-0 text-lg ui-live-alert-icon mt-0.5" />
                  <span>
                    <span className="font-semibold">{a.title}: </span>
                    {a.message}
                    {a.linkTo && a.linkLabel ? (
                      <span className="block mt-1">
                        <Link
                          to={a.linkTo}
                          className="text-xs font-semibold ui-live-alert-link hover:underline underline-offset-2"
                        >
                          {a.linkLabel}
                        </Link>
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-[var(--ui-muted)] border-t border-[color:var(--ui-border)] pt-3">Sin alertas operativas en este momento.</p>
          )}
          </>
        ) : null}
      </div>

      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-[var(--ui-body-text)]">Centro Operativo</h3>
          <p className="text-xs text-[var(--ui-muted)]">Acceso rápido a módulos críticos</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
          <div
            role="button"
            tabIndex={0}
            onClick={() => navigate('/admin/cocina')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate('/admin/cocina'); }}
            className={`text-left p-3 rounded-xl border transition-colors cursor-pointer ${getQueueLevel(kitchenQueue).card}`}
          >
            <div className="flex items-center gap-2 text-amber-700 font-semibold"><MdKitchen /> Cocina</div>
            <span className={`inline-block mt-1 text-[10px] px-2 py-0.5 rounded-full ${getQueueLevel(kitchenQueue).pill}`}>{getQueueLevel(kitchenQueue).label}</span>
            <p className="text-2xl font-bold text-amber-800 mt-1">{kitchenQueue}</p>
            <p className="text-xs text-amber-700">Pedidos en cola</p>
          </div>
          <div
            role="button"
            tabIndex={0}
            onClick={() => navigate('/admin/bar')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate('/admin/bar'); }}
            className={`text-left p-3 rounded-xl border transition-colors cursor-pointer ${getQueueLevel(barQueue).card}`}
          >
            <div className="flex items-center gap-2 text-indigo-700 font-semibold"><MdLocalBar /> Bar</div>
            <span className={`inline-block mt-1 text-[10px] px-2 py-0.5 rounded-full ${getQueueLevel(barQueue).pill}`}>{getQueueLevel(barQueue).label}</span>
            <p className="text-2xl font-bold text-indigo-800 mt-1">{barQueue}</p>
            <p className="text-xs text-indigo-700">Pedidos en cola</p>
          </div>
          {deliveryModuleActive ? (
          <button onClick={() => navigate('/admin/delivery')} className="text-left p-3 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 transition-colors">
            <div className="flex items-center gap-2 text-emerald-700 font-semibold"><MdDeliveryDining /> Delivery</div>
            <p className="text-2xl font-bold text-emerald-800 mt-1">{deliveryReady}</p>
            <p className="text-xs text-emerald-700">Pedidos listos para repartir</p>
          </button>
          ) : deliverySettingsLoaded ? (
          <div className="text-left p-3 rounded-xl border border-dashed border-slate-200 bg-slate-50">
            <div className="flex items-center gap-2 text-slate-600 font-semibold"><MdDeliveryDining /> Delivery</div>
            <p className="text-sm font-bold text-slate-500 mt-1">Desactivado</p>
            <p className="text-xs text-slate-500">Actívelo en Mi Restaurante</p>
          </div>
          ) : null}
          <button onClick={() => navigate('/admin/mesas')} className="text-left p-3 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 transition-colors">
            <div className="flex items-center gap-2 text-rose-700 font-semibold"><MdTableBar /> Mesas</div>
            <p className="text-2xl font-bold text-rose-800 mt-1">{salonActive}</p>
            <p className="text-xs text-rose-700">Pedidos activos en salón</p>
          </button>
          <button onClick={() => navigate('/admin/caja')} className="text-left p-3 rounded-xl border border-sky-200 bg-sky-50 hover:bg-sky-100 transition-colors">
            <div className="flex items-center gap-2 text-sky-700 font-semibold"><MdPointOfSale /> Caja</div>
            <p className="text-2xl font-bold text-sky-800 mt-1">
              {liveDash?.liveSales?.register_open
                ? Number(liveDash.liveSales.count ?? 0)
                : paidOrdersToday.length}
            </p>
            <p className="text-xs text-sky-700">
              {liveDash?.liveSales?.register_open
                ? `Turno abierto · ${formatCurrency(Number(liveDash.liveSales.total ?? 0))}`
                : `Cobradas hoy · ${formatCurrency(paidOrdersTodayTotal)}`}
            </p>
            {datePreset !== 'total' && paidOrders.length !== paidOrdersToday.length ? (
              <p className="text-[10px] text-sky-600 mt-0.5">
                En el período: {paidOrders.length} · {formatCurrency(totalSales)}
              </p>
            ) : null}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
        <button
          type="button"
          className="w-full rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] px-3 py-2 text-left flex items-center justify-between text-sm text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]"
        >
          Cantidad de ventas <MdKeyboardArrowDown className="text-[var(--ui-accent-muted)] shrink-0" />
        </button>
        <button
          type="button"
          className="w-full rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] px-3 py-2 text-left flex items-center justify-between text-sm text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]"
        >
          Caja: Caja 01 <MdKeyboardArrowDown className="text-[var(--ui-accent-muted)] shrink-0" />
        </button>
        <div className="rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] px-3 py-2 text-left text-sm flex flex-col gap-2">
          <div className="grid grid-cols-12 gap-2">
            <button
              type="button"
              onClick={startRangeSelection}
              className="col-span-7 rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] px-2 py-1.5 text-left hover:border-[var(--ui-accent-muted)] transition-colors"
            >
              <div className="flex items-center gap-2 text-[var(--ui-muted)] text-xs">
                <MdDateRange className="shrink-0 text-[var(--ui-accent-muted)]" />
                <span>{datePickStep === 'end' ? 'Selecciona FIN' : 'Selecciona INICIO'}</span>
                <MdKeyboardArrowDown className="ml-auto shrink-0 text-[var(--ui-accent-muted)]" />
              </div>
              <div className="mt-0.5 leading-snug text-[13px] font-medium text-[var(--ui-body-text)]">
                <div>{formatDateForLabel(startDate)}</div>
                <div>{datePreset === 'total' ? 'Hoy' : formatDateForLabel(endDate)}</div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => {
                applyMonthRange();
                setDatePickStep('idle');
              }}
              className={`col-span-2 rounded-md border px-2 py-1.5 text-xs font-semibold transition-colors ${
                datePreset === 'month'
                  ? 'bg-[var(--ui-accent)] border-[var(--ui-accent)] text-white'
                  : 'bg-[var(--ui-surface-2)] border-[color:var(--ui-border)] text-[var(--ui-body-text)] hover:border-[var(--ui-accent-muted)]'
              }`}
            >
              Mes
            </button>
            <button
              type="button"
              onClick={() => {
                setDatePreset('total');
                setDatePickStep('idle');
              }}
              className={`col-span-3 rounded-md border px-2 py-1.5 text-xs font-semibold transition-colors ${
                datePreset === 'total'
                  ? 'bg-[var(--ui-accent)] border-[var(--ui-accent)] text-white'
                  : 'bg-[var(--ui-surface-2)] border-[color:var(--ui-border)] text-[var(--ui-body-text)] hover:border-[var(--ui-accent-muted)]'
              }`}
            >
              Todo
            </button>
            <input
              ref={startDateInputRef}
              type="date"
              value={startDate}
              onChange={(e) => {
                setDatePreset('custom');
                setStartDate(e.target.value);
                continueRangeSelection();
              }}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
            />
            <input
              ref={endDateInputRef}
              type="date"
              value={endDate}
              onChange={(e) => {
                setDatePreset('custom');
                setEndDate(e.target.value);
                setDatePickStep('idle');
              }}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
            />
          </div>
        </div>
        <button
          type="button"
          className="w-full rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] px-3 py-2 text-left flex items-center justify-between text-sm text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]"
        >
          Local: Principal <MdKeyboardArrowDown className="text-[var(--ui-accent-muted)] shrink-0" />
        </button>
      </div>

      <div className="card p-4">
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          <div className="xl:col-span-2 min-w-0 self-start overflow-visible">
            <p className="text-xs text-[var(--ui-muted)]">Hora punta</p>
            <p className="text-3xl font-light text-[var(--ui-body-text)] leading-normal tabular-nums py-1 min-h-[2.5rem] flex items-center">
              {peakHour.hour}
            </p>
            <p className="text-xs text-[var(--ui-muted)] mt-3">Hora más libre</p>
            <p className="text-3xl font-light text-[var(--ui-body-text)] leading-normal tabular-nums py-1 min-h-[2.5rem] flex items-center">
              {lowHour.hour}
            </p>
          </div>

          <div className="xl:col-span-10">
            <h3 className="text-center text-[var(--ui-body-text)] mb-2 font-medium">
              Gráfico por cantidad de ventas / Dinero por ventas
            </h3>
            <ResponsiveContainer width="100%" height={170}>
              <LineChart data={hourlySales}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--ui-border)" strokeOpacity={0.55} />
                <XAxis dataKey="hour" tick={{ fontSize: 11, fill: 'var(--ui-muted)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--ui-muted)' }} />
                <Tooltip
                  formatter={(v) => formatCurrency(v)}
                  contentStyle={{
                    background: 'var(--ui-surface-2)',
                    border: '1px solid var(--ui-border)',
                    borderRadius: '8px',
                    color: 'var(--ui-body-text)',
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="sales"
                  stroke="#f59e0b"
                  strokeWidth={3}
                  fill="#fcd34d"
                  dot={{ r: 2 }}
                  activeDot={{ r: 4 }}
                  name="Cantidad de ventas"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-8 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <div>
            <p className="text-sm text-[var(--ui-muted)]">Ventas en efectivo (periodo)</p>
            <p className="text-4xl font-light text-[var(--ui-body-text)]">{formatCurrency(salesByPayment.efectivo)}</p>
          </div>
          <div>
            <p className="text-sm text-[var(--ui-muted)]">Ventas con tarjeta (periodo)</p>
            <p className="text-4xl font-light text-[var(--ui-body-text)]">{formatCurrency(salesByPayment.tarjeta)}</p>
          </div>
          <div>
            <p className="text-sm text-[var(--ui-muted)]">Ventas por Yape/Plin (periodo)</p>
            <p className="text-4xl font-light text-[var(--ui-body-text)]">{formatCurrency((salesByPayment.yape || 0) + (salesByPayment.plin || 0))}</p>
          </div>
          <div>
            <p className="text-sm text-[var(--ui-muted)]">Total de Ventas (periodo)</p>
            <p className="text-4xl font-light text-[var(--ui-body-text)]">{formatCurrency(totalSales)}</p>
          </div>

          <div>
            <p className="text-sm text-[var(--ui-muted)]">Ventas al crédito</p>
            <p className="text-4xl font-light text-[var(--ui-body-text)]">{formatCurrency(totalCredit)}</p>
          </div>
          <div>
            <p className="text-sm text-[var(--ui-muted)]">Total de egresos de caja</p>
            <p className="text-4xl font-light text-[var(--ui-body-text)]">S/ 0.00</p>
          </div>
          <div>
            <p className="text-sm text-[var(--ui-muted)]">Total de descuentos</p>
            <p className="text-4xl font-light text-[var(--ui-body-text)]">{formatCurrency(totalDiscounts)}</p>
          </div>
          <div>
            <p className="text-sm text-[var(--ui-muted)]">Total de Ingreso Débito</p>
            <p className="text-4xl font-light text-[var(--ui-body-text)]">S/ 0.00</p>
          </div>
        </div>

        <div className="xl:col-span-4 card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xl font-light text-[var(--ui-body-text)]">
              {rankingMode === 'dias' ? 'Top días con más ventas' : 'Top mesas que más venden'}
            </h3>
            <div className="inline-flex rounded-lg border border-[color:var(--ui-border)] overflow-hidden">
              <button
                type="button"
                onClick={() => setRankingMode('dias')}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                  rankingMode === 'dias' ? 'bg-[var(--ui-accent)] text-white' : 'bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]'
                }`}
              >
                Días
              </button>
              <button
                type="button"
                onClick={() => setRankingMode('mesas')}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                  rankingMode === 'mesas' ? 'bg-[var(--ui-accent)] text-white' : 'bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]'
                }`}
              >
                Mesas
              </button>
            </div>
          </div>
          {topSalesData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={topSalesData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={78}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  >
                    {topSalesData.map((_, idx) => <Cell key={`rank-${idx}`} fill={CHART_COLORS[idx % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip
                    formatter={(v) => formatCurrency(v)}
                    contentStyle={{
                      background: 'var(--ui-surface-2)',
                      border: '1px solid var(--ui-border)',
                      borderRadius: '8px',
                      color: 'var(--ui-body-text)',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="grid grid-cols-1 gap-1 mt-2">
                {topSalesData.map((item, idx) => (
                  <div key={`${item.name}-${idx}`} className="flex items-center justify-between text-xs border-b border-[color:var(--ui-border)] py-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }} />
                      <span className="text-[var(--ui-body-text)] truncate">{item.name}</span>
                    </div>
                    <span className="font-semibold text-[var(--ui-body-text)]">{formatCurrency(item.value)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-sm text-[var(--ui-muted)]">
              Sin ventas en el rango y horario seleccionado.
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <div className="card p-4">
          <div className="border-b border-[color:var(--ui-border)] pb-3 mb-3">
            <p className="text-sm text-[var(--ui-muted)]">Total de ventas por mesa</p>
            <p className="text-2xl font-light text-[var(--ui-body-text)]">{totalVentasPorMesa}</p>
            <p className="text-xs text-[var(--ui-muted)] mt-1">
              Una mesa con pedidos en el periodo = 1 venta (solo cuentan pedidos con mesa asignada).
            </p>
          </div>
          <div>
            <p className="text-sm text-[var(--ui-muted)]">Total de ventas por producto</p>
            <p className="text-2xl font-light text-[var(--ui-body-text)]">{totalVentasPorProducto}</p>
            <p className="text-xs text-[var(--ui-muted)] mt-1">
              Productos distintos con al menos una línea en pedidos <strong className="text-[var(--ui-body-text)]">cobrados</strong> en el
              periodo.
            </p>
          </div>
          <p className="text-xs text-[var(--ui-muted)] mt-3 pt-3 border-t border-[color:var(--ui-border)]">
            Pedidos — Cobradas: <strong className="text-[var(--ui-body-text)]">{paidOrdersCount}</strong> · Pendientes:{' '}
            <strong className="text-[var(--ui-body-text)]">{pendingPaymentCount}</strong> · Canceladas:{' '}
            <strong className="text-[var(--ui-body-text)]">{cancelledOrdersCount}</strong>
          </p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-[var(--ui-muted)]">Promedio de consumo por venta (mesa)</p>
          <p className="text-2xl font-light text-[var(--ui-body-text)]">
            {formatCurrency(totalVentasMesas ? totalSales / totalVentasMesas : 0)}
          </p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-[var(--ui-muted)]">Clientes</p>
          <p className="text-2xl font-light text-[var(--ui-body-text)]">{scopedOrders.length}</p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-[var(--ui-muted)]">Por tipo de pago (monto)</p>
          {pagoMasUsado && (
            <p className="text-xs text-amber-700 mb-2 text-center">
              Más usado: <span className="font-semibold">{pagoMasUsado.label}</span> ({pagoMasUsado.operaciones}{' '}
              {pagoMasUsado.operaciones === 1 ? 'cobro' : 'cobros'} · {pagoMasUsado.porcentajeMonto.toFixed(0)}% del
              monto)
            </p>
          )}
          {paymentPieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={168}>
              <PieChart>
                <Pie
                  data={paymentPieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={28}
                  outerRadius={52}
                  paddingAngle={2}
                  label={({ name, percent }) => (percent > 0.06 ? `${name} ${(percent * 100).toFixed(0)}%` : '')}
                >
                  {paymentPieData.map((row, i) => (
                    <Cell key={row.key} fill={PAYMENT_COLORS[i % PAYMENT_COLORS.length]} stroke="var(--ui-border)" />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v) => formatCurrency(v)}
                  contentStyle={{
                    background: 'var(--ui-surface-2)',
                    border: '1px solid var(--ui-border)',
                    borderRadius: '8px',
                    color: 'var(--ui-body-text)',
                  }}
                />
                <Legend
                  layout="vertical"
                  align="right"
                  verticalAlign="middle"
                  wrapperStyle={{ color: 'var(--ui-body-text)' }}
                  formatter={(value, entry) => {
                    const v = entry?.payload?.value;
                    return `${value}: ${formatCurrency(v)}`;
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-xs text-[var(--ui-muted)] text-center py-6">Sin cobros en el periodo</p>
          )}
        </div>
      </div>
    </div>
  );
}
