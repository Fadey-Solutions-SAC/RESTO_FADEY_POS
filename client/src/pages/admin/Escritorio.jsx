import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import toast from 'react-hot-toast';
import { api, formatCurrency, parseApiDate, PAYMENT_METHODS, formatInstantTime } from '../../utils/api';
import { useSocket } from '../../hooks/useSocket';
import { useActiveInterval } from '../../hooks/useActiveInterval';
import { useDeliverySettings } from '../../hooks/useDeliveryEnabled';
import { useNavigate, Link } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar } from 'recharts';
import { MdDateRange, MdKeyboardArrowDown, MdKitchen, MdLocalBar, MdDeliveryDining, MdPointOfSale, MdTableBar, MdBolt, MdWarning } from 'react-icons/md';

import { useChartTheme } from '../../theme/useChartTheme';
import {
  isActiveProductionQueueOrder,
  orderPendingForBarStation,
  orderPendingForKitchenStation,
} from '../../utils/productionArea';
import { isCourtesyOrder, isDiscountOrder, summarizePaidSalesAccounts } from '../../utils/mesaOrderLines';

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
const getCurrentWeekRange = () => {
  const now = new Date();
  const dow = now.getDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset);
  return {
    start: toInputDate(monday),
    end: toInputDate(now),
  };
};
const getTotalRange = () => ({
  start: '2020-01-01',
  end: toInputDate(new Date()),
});
const formatDateForLabel = (value) => {
  if (!value) return '-';
  const [y, m, d] = String(value).split('-');
  if (!y || !m || !d) return value;
  return `${d}/${m}/${y}`;
};

function isPaidSaleOrder(order) {
  if (!order || order.status === 'cancelled') return false;
  if (order.payment_status !== 'paid') return false;
  const method = String(order.payment_method || '').toLowerCase();
  return method !== 'cortesia' && method !== 'cuenta_cliente';
}

function getOrderPaidAtIso(order) {
  return order?.paid_at || order?.updated_at || order?.created_at || '';
}

function orderMatchesRegisterWindow(order, registerId, openedAt, closedAt) {
  if (!isPaidSaleOrder(order)) return false;
  const paidAt = getOrderPaidAtIso(order);
  if (!paidAt || !openedAt) return false;
  const end = closedAt || new Date().toISOString();
  const regId = String(registerId || '').trim();
  const orderRegId = String(order.cash_register_id || '').trim();
  if (regId) {
    if (orderRegId === regId) return true;
    if (!orderRegId) return paidAt >= openedAt && paidAt <= end;
    return false;
  }
  return paidAt >= openedAt && paidAt <= end;
}

const WEEKDAY_CHART_META = [
  { dow: 1, name: 'Lun', label: 'Lunes' },
  { dow: 2, name: 'Mar', label: 'Martes' },
  { dow: 3, name: 'Mié', label: 'Miércoles' },
  { dow: 4, name: 'Jue', label: 'Jueves' },
  { dow: 5, name: 'Vie', label: 'Viernes' },
  { dow: 6, name: 'Sáb', label: 'Sábado' },
  { dow: 0, name: 'Dom', label: 'Domingo' },
];

function getChartYAxisMax(values) {
  const max = Math.max(0, ...values.map((v) => Number(v) || 0));
  if (max <= 0) return 0;
  const padded = max * 1.05;
  if (padded <= 1000) return Math.ceil(padded);
  if (padded <= 10000) return Math.ceil(padded / 100) * 100;
  return Math.ceil(padded / 1000) * 1000;
}

function getChartYAxisTicks(max) {
  const ceiling = Number(max) || 0;
  if (ceiling <= 0) return [];
  const segments = 4;
  const step = Math.max(1, Math.ceil(ceiling / segments));
  return Array.from({ length: segments + 1 }, (_, index) => {
    if (index === segments) return ceiling;
    return Math.min(ceiling, index * step);
  });
}

function formatChartYAxisTick(value) {
  const n = Number(value) || 0;
  if (n >= 1000) return `S/ ${Math.round(n / 100) / 10}k`;
  return formatCurrency(n).replace(/\.00$/, '');
}

function orderBelongsToRegisterSession(order, registerId, openedAt, closedAt) {
  if (!order || order.status === 'cancelled') return false;
  const eventAt = order.payment_status === 'paid'
    ? getOrderPaidAtIso(order)
    : (order.updated_at || order.created_at || '');
  if (!eventAt || !openedAt) return false;
  const end = closedAt || new Date().toISOString();
  const regId = String(registerId || '').trim();
  const orderRegId = String(order.cash_register_id || '').trim();
  if (regId && orderRegId === regId) return true;
  if (regId && orderRegId && orderRegId !== regId) return false;
  return eventAt >= openedAt && eventAt <= end;
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
  const [cajaStations, setCajaStations] = useState([]);
  const [selectedCajaStationId, setSelectedCajaStationId] = useState('');
  const [registerPeriodReport, setRegisterPeriodReport] = useState(null);
  const [registerReportLoading, setRegisterReportLoading] = useState(true);
  const startDateInputRef = useRef(null);
  const endDateInputRef = useRef(null);
  const navigate = useNavigate();

  const deliveryModuleActive = useMemo(() => {
    if (deliverySettingsLoaded) return deliveryEnabled;
    if (liveDash?.deliveryEnabled != null) return Boolean(liveDash.deliveryEnabled);
    return true;
  }, [deliverySettingsLoaded, deliveryEnabled, liveDash?.deliveryEnabled]);

  const monitoreoSyncLabel = useMemo(() => {
    const parts = ['Caja', 'Cocina', 'Bar', 'Mesas'];
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

  const loadRegisterPeriodReport = useCallback(async () => {
    const from = String(startDate || '').trim();
    const to = String(endDate || '').trim();
    if (!from || !to) {
      setRegisterPeriodReport(null);
      setRegisterReportLoading(false);
      return;
    }
    setRegisterReportLoading(true);
    try {
      const report = await api.get(`/reports/product-sales?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      setRegisterPeriodReport(report);
    } catch (err) {
      console.error(err);
      setRegisterPeriodReport(null);
    } finally {
      setRegisterReportLoading(false);
    }
  }, [startDate, endDate]);

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
    void loadRegisterPeriodReport();
  }, [loadRegisterPeriodReport]);

  useEffect(() => {
    api.get('/pos/caja-stations')
      .then((res) => setCajaStations(Array.isArray(res?.stations) ? res.stations : []))
      .catch(() => setCajaStations([]));
  }, []);

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
    void loadRegisterPeriodReport();
  });
  useSocket('table-update', loadLiveDash);
  useSocket('delivery-update', loadLiveDash);
  useSocket('register-update', () => {
    loadData();
    void loadLiveDash();
    void loadRegisterPeriodReport();
  });
  useSocket('inventory-update', loadLiveDash);
  useSocket('billing-document-update', () => {
    void loadLiveDash();
  });
  useEffect(() => {
    if (datePreset === 'month') {
      const monthRange = getCurrentMonthRange();
      setStartDate(monthRange.start);
      setEndDate(monthRange.end);
      return;
    }
    if (datePreset === 'week') {
      const weekRange = getCurrentWeekRange();
      setStartDate(weekRange.start);
      setEndDate(weekRange.end);
      return;
    }
    if (datePreset === 'total') {
      const totalRange = getTotalRange();
      setStartDate(totalRange.start);
      setEndDate(totalRange.end);
    }
  }, [datePreset]);
  useEffect(() => {
    api
      .get('/restaurant')
      .then((cfg) => {
        setRestaurantInfo(cfg || { name: 'Resto-FADEY', address: '', phone: '' });
      })
      .catch(() => {});
  }, []);

  const activeRegisterBlocks = useMemo(() => {
    const blocks = Array.isArray(registerPeriodReport?.by_register) ? registerPeriodReport.by_register : [];
    if (!selectedCajaStationId) return blocks;
    return blocks.filter((block) => String(block.caja_station_id || '') === selectedCajaStationId);
  }, [registerPeriodReport, selectedCajaStationId]);

  const selectedCajaLabel = useMemo(() => {
    if (!selectedCajaStationId) return 'Todas';
    const match = cajaStations.find((s) => s.id === selectedCajaStationId);
    return match?.name || registerPeriodReport?.by_register?.find((b) => b.caja_station_id === selectedCajaStationId)?.station_name || 'Caja';
  }, [selectedCajaStationId, cajaStations, registerPeriodReport]);

  const scopedOrdersAll = useMemo(() => {
    if (registerReportLoading || !registerPeriodReport) return [];
    if (!activeRegisterBlocks.length) return [];
    return orders.filter((order) =>
      activeRegisterBlocks.some((block) =>
        orderMatchesRegisterWindow(order, block.register_id, block.opened_at, block.closed_at)
      )
    );
  }, [orders, activeRegisterBlocks, registerPeriodReport, registerReportLoading]);
  const scopedOrders = useMemo(
    () => scopedOrdersAll.filter(o => o.status !== 'cancelled'),
    [scopedOrdersAll]
  );
  const paidOrders = useMemo(
    () => scopedOrders.filter((o) => o.payment_status === 'paid' && String(o.payment_method || '').toLowerCase() !== 'cortesia'),
    [scopedOrders]
  );

  const parseHourToMinutes = (raw) => {
    const [h = '0', m = '0'] = String(raw || '').split(':');
    return (Number(h) * 60) + Number(m);
  };
  const isSaleInConfiguredSchedule = (order) => {
    const schedule = restaurantInfo?.schedule;
    if (!schedule || typeof schedule !== 'object') return true;
    const date = parseApiDate(order?.paid_at || order?.updated_at || order?.created_at);
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

  const paidSalesAccounts = useMemo(() => summarizePaidSalesAccounts(paidOrders), [paidOrders]);
  const paidSalesAccountsInSchedule = useMemo(
    () => paidSalesAccounts.filter((account) => isSaleInConfiguredSchedule({
      paid_at: account.paidAt,
      updated_at: account.paidAt,
      created_at: account.paidAt,
    })),
    [paidSalesAccounts, restaurantInfo]
  );

  const hourlySales = useMemo(() => {
    const byHour = {};
    for (let h = 0; h < 24; h += 1) byHour[String(h).padStart(2, '0')] = 0;
    paidSalesAccounts.forEach((account) => {
      const parsed = parseApiDate(account.paidAt);
      if (!parsed) return;
      if (!isSaleInConfiguredSchedule({ paid_at: account.paidAt, updated_at: account.paidAt, created_at: account.paidAt })) return;
      const hour = parsed.getHours();
      byHour[String(hour).padStart(2, '0')] += Number(account.total || 0);
    });
    return Object.entries(byHour).map(([hour, total]) => ({
      hour: `${hour}:00`,
      sales: Number(total.toFixed(2)),
    }));
  }, [paidSalesAccounts, restaurantInfo]);

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

  const paidAccountsCount = paidSalesAccounts.length;
  const averageSaleAmount = paidAccountsCount > 0 ? totalSales / paidAccountsCount : 0;
  const productsSoldCount = useMemo(() => {
    let total = 0;
    paidOrders.forEach((order) => {
      (order.items || []).forEach((item) => {
        total += Number(item.quantity || 0);
      });
    });
    return total;
  }, [paidOrders]);
  const courtesyCount = useMemo(() => {
    if (registerReportLoading || !activeRegisterBlocks.length) return 0;
    return orders.reduce((count, order) => {
      if (order.status === 'cancelled' || order.payment_status !== 'paid' || !isCourtesyOrder(order)) return count;
      const inSession = activeRegisterBlocks.some((block) =>
        orderBelongsToRegisterSession(order, block.register_id, block.opened_at, block.closed_at)
      );
      return inSession ? count + 1 : count;
    }, 0);
  }, [orders, activeRegisterBlocks, registerReportLoading]);

  const totalDiscounts = useMemo(() => {
    if (registerReportLoading || !activeRegisterBlocks.length) return 0;
    return orders.reduce((sum, order) => {
      if (order.status === 'cancelled' || !isDiscountOrder(order)) return sum;
      const inSession = activeRegisterBlocks.some((block) =>
        orderBelongsToRegisterSession(order, block.register_id, block.opened_at, block.closed_at)
      );
      if (!inSession) return sum;
      return sum + Number(order.discount || 0);
    }, 0);
  }, [orders, activeRegisterBlocks, registerReportLoading]);
  const totalCashExpenses = useMemo(
    () => activeRegisterBlocks.reduce((sum, block) => sum + Number(block.cash_expenses || 0), 0),
    [activeRegisterBlocks]
  );
  const totalDebitIncome = useMemo(
    () => activeRegisterBlocks.reduce((sum, block) => sum + Number(block.notes_debit || 0), 0),
    [activeRegisterBlocks]
  );
  const totalCredit = paidOrders
    .filter(o => o.payment_method === 'online')
    .reduce((sum, o) => sum + Number(o.total || 0), 0);

  const topDiasData = useMemo(() => {
    const dailyTotals = new Map();
    const from = String(startDate || '').trim();
    const to = String(endDate || '').trim();

    paidSalesAccountsInSchedule.forEach((account) => {
      const parsed = parseApiDate(account.paidAt);
      if (!parsed) return;
      const dateKey = toInputDate(parsed);
      if (from && dateKey < from) return;
      if (to && dateKey > to) return;
      dailyTotals.set(dateKey, (dailyTotals.get(dateKey) || 0) + Number(account.total || 0));
    });

    const weekdayTotals = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    dailyTotals.forEach((total, dateKey) => {
      const parsed = new Date(`${dateKey}T12:00:00`);
      if (Number.isNaN(parsed.getTime())) return;
      weekdayTotals[parsed.getDay()] += total;
    });

    return WEEKDAY_CHART_META.map(({ dow, name, label }) => ({
      dow,
      name,
      label,
      value: weekdayTotals[dow] || 0,
    }));
  }, [paidSalesAccountsInSchedule, startDate, endDate, selectedCajaStationId, datePreset]);

  const topMesasData = useMemo(() => {
    const grouped = {};
    const from = String(startDate || '').trim();
    const to = String(endDate || '').trim();

    paidSalesAccountsInSchedule.forEach((account) => {
      const table = String(account.table || '').trim();
      if (!table) return;
      const parsed = parseApiDate(account.paidAt);
      if (!parsed) return;
      const dateKey = toInputDate(parsed);
      if (from && dateKey < from) return;
      if (to && dateKey > to) return;
      if (!grouped[table]) {
        grouped[table] = {
          table,
          name: `M${table}`,
          label: `Mesa ${table}`,
          value: 0,
        };
      }
      grouped[table].value += Number(account.total || 0);
    });

    return Object.values(grouped)
      .sort((a, b) => Number(b.value || 0) - Number(a.value || 0))
      .slice(0, 7);
  }, [paidSalesAccountsInSchedule, startDate, endDate, selectedCajaStationId, datePreset]);

  const topDiasHasSales = topDiasData.some((d) => Number(d.value || 0) > 0);
  const topMesasHasSales = topMesasData.some((m) => Number(m.value || 0) > 0);
  const topDiasYMax = useMemo(
    () => (topDiasHasSales ? getChartYAxisMax(topDiasData.map((d) => d.value)) : 0),
    [topDiasData, topDiasHasSales]
  );
  const topMesasYMax = useMemo(
    () => (topMesasHasSales ? getChartYAxisMax(topMesasData.map((m) => m.value)) : 0),
    [topMesasData, topMesasHasSales]
  );
  const topDiasYTicks = useMemo(() => getChartYAxisTicks(topDiasYMax), [topDiasYMax]);
  const topMesasYTicks = useMemo(() => getChartYAxisTicks(topMesasYMax), [topMesasYMax]);

  const kitchenQueue = useMemo(
    () => orders.filter((o) => isActiveProductionQueueOrder(o) && orderPendingForKitchenStation(o)).length,
    [orders]
  );
  const barQueue = useMemo(
    () => orders.filter((o) => isActiveProductionQueueOrder(o) && orderPendingForBarStation(o)).length,
    [orders]
  );
  const productionQueueTotal = kitchenQueue + barQueue;
  const visibleOperationalAlerts = useMemo(() => {
    const list = Array.isArray(liveDash?.operationalAlerts) ? liveDash.operationalAlerts : [];
    if (productionQueueTotal > 0) return list;
    return list.filter((a) => !['kitchen_prep_demora', 'ready_demora', 'kitchen_load'].includes(String(a?.id || '')));
  }, [liveDash?.operationalAlerts, productionQueueTotal]);
  const deliveryReady = useMemo(
    () => orders.filter(o => o.type === 'delivery' && o.status === 'ready').length,
    [orders]
  );
  const salonActive = useMemo(
    () => orders.filter(o => o.type === 'dine_in' && ['pending', 'preparing', 'ready'].includes(o.status)).length,
    [orders]
  );
  const getQueueLevel = (value) => {
    if (value >= 10) return { label: 'Crítico', pill: 'bg-red-100 text-red-700', card: 'border-red-300 bg-red-50 ring-1 ring-red-300' };
    if (value >= 5) return { label: 'Alto', pill: 'bg-amber-100 text-amber-700', card: 'border-amber-300 bg-amber-50' };
    return { label: 'Normal', pill: 'bg-emerald-100 text-emerald-700', card: 'border-emerald-200 bg-emerald-50' };
  };

  const dateRangeLabel = datePreset === 'total'
    ? 'Total · todos los cierres de caja'
    : `Del ${formatDateForLabel(startDate)} hasta ${formatDateForLabel(endDate)}`;
  const dateRangeDisplay = datePreset === 'total'
    ? 'Desde inicio – Hoy'
    : `${formatDateForLabel(startDate)} – ${formatDateForLabel(endDate)}`;
  const applyMonthRange = () => {
    const monthRange = getCurrentMonthRange();
    setDatePreset('month');
    setStartDate(monthRange.start);
    setEndDate(monthRange.end);
  };
  const applyWeekRange = () => {
    const weekRange = getCurrentWeekRange();
    setDatePreset('week');
    setStartDate(weekRange.start);
    setEndDate(weekRange.end);
  };
  const applyTotalRange = () => {
    const totalRange = getTotalRange();
    setDatePreset('total');
    setStartDate(totalRange.start);
    setEndDate(totalRange.end);
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
      <div id="monitoreo-vivo" className="card p-4 scroll-mt-4">
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
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2 mb-3">
            <button
              type="button"
              onClick={() => navigate('/admin/caja')}
              className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-left hover:bg-sky-100 transition-colors"
            >
              <div className="flex items-center gap-1.5 text-sky-700 font-semibold text-xs">
                <MdPointOfSale className="shrink-0" />
                <span className="truncate">{liveDash.liveSales?.label || 'Caja'}</span>
              </div>
              <p className="text-lg font-bold text-sky-800 tabular-nums mt-1">
                {formatCurrency(Number(liveDash.liveSales?.total ?? liveDash.today?.total ?? 0))}
              </p>
              <p className="text-[11px] text-sky-700">
                {Number(liveDash.liveSales?.count ?? liveDash.today?.count ?? 0)} cobradas
                {liveDash.liveSales?.subtitle ? ` · ${liveDash.liveSales.subtitle}` : ''}
                {liveDash.registerOpen && liveDash.registerOpenSummary?.user_name
                  ? ` · ${liveDash.registerOpenSummary.user_name}`
                  : ''}
              </p>
              {liveDash.registerOpen &&
              liveDash.liveSales?.day_total != null &&
              Number(liveDash.liveSales.day_total) !== Number(liveDash.liveSales.total) ? (
                <p className="text-[10px] text-sky-600 mt-0.5">
                  Día: {formatCurrency(liveDash.liveSales.day_total)} ({liveDash.liveSales.day_count ?? 0})
                </p>
              ) : null}
              {liveDash.liveSales?.mode === 'register_closed' && !liveDash.registerOpen ? (
                <p className="text-[10px] text-amber-600 mt-0.5">Sin turno activo</p>
              ) : null}
              {liveDash.liveSales?.mode === 'venue_closed' && !liveDash.registerOpen ? (
                <p className="text-[10px] text-sky-600 mt-0.5">Local fuera de horario</p>
              ) : null}
              <p className="text-[11px] font-medium text-sky-700 mt-0.5">Ir a Caja</p>
            </button>
            <button
              type="button"
              onClick={() => navigate('/admin/cocina')}
              className={`rounded-lg border px-3 py-2 text-left transition-colors hover:opacity-95 ${getQueueLevel(kitchenQueue).card}`}
            >
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1.5 text-amber-700 font-semibold text-xs">
                  <MdKitchen className="shrink-0" />
                  Cocina
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${getQueueLevel(kitchenQueue).pill}`}>
                  {getQueueLevel(kitchenQueue).label}
                </span>
              </div>
              <p className="text-lg font-bold text-amber-800 tabular-nums mt-1">{kitchenQueue}</p>
              <p className="text-[11px] text-amber-700">Pedidos en cola</p>
              <p className="text-[11px] font-medium ui-live-link-amber mt-0.5">Ir a Cocina</p>
            </button>
            <button
              type="button"
              onClick={() => navigate('/admin/bar')}
              className={`rounded-lg border px-3 py-2 text-left transition-colors hover:opacity-95 ${getQueueLevel(barQueue).card}`}
            >
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1.5 text-indigo-700 font-semibold text-xs">
                  <MdLocalBar className="shrink-0" />
                  Bar
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${getQueueLevel(barQueue).pill}`}>
                  {getQueueLevel(barQueue).label}
                </span>
              </div>
              <p className="text-lg font-bold text-indigo-800 tabular-nums mt-1">{barQueue}</p>
              <p className="text-[11px] text-indigo-700">Pedidos en cola</p>
              <p className="text-[11px] font-medium text-indigo-700 mt-0.5">Ir a Bar</p>
            </button>
            {deliveryModuleActive ? (
            <button
              type="button"
              onClick={() => navigate('/admin/delivery')}
              className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-left hover:bg-emerald-100 transition-colors"
            >
              <div className="flex items-center gap-1.5 text-emerald-700 font-semibold text-xs">
                <MdDeliveryDining className="shrink-0" />
                Delivery
              </div>
              <p className="text-lg font-bold text-emerald-800 tabular-nums mt-1">
                {Number(liveDash.deliveryActiveCount || 0)}
              </p>
              <p className="text-[11px] text-emerald-700">
                En curso · {deliveryReady} listos para repartir
              </p>
              <p className="text-[11px] font-medium ui-live-link-emerald mt-0.5">Ir a Delivery</p>
            </button>
            ) : null}
            <button
              type="button"
              onClick={() => navigate('/admin/mesas')}
              className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-left hover:bg-rose-100 transition-colors"
            >
              <div className="flex items-center gap-1.5 text-rose-700 font-semibold text-xs">
                <MdTableBar className="shrink-0" />
                Mesas
              </div>
              <p className="text-lg font-bold text-rose-800 tabular-nums mt-1">
                {Number(liveDash.tablesWithActiveOrders || 0)}
              </p>
              <p className="text-[11px] text-rose-700">
                Con cuenta · {salonActive} pedidos en salón
              </p>
              <p className="text-[11px] font-medium ui-live-link-rose mt-0.5">Ir a Mesas</p>
            </button>
            <button
              type="button"
              onClick={() => navigate('/admin/almacen')}
              className="rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] px-3 py-2 text-left hover:bg-[var(--ui-sidebar-hover)] transition-colors"
            >
              <p className="text-[10px] uppercase tracking-wide text-[var(--ui-muted)]">Stock ≤ 10</p>
              <p className="text-lg font-bold text-[var(--ui-body-text)] tabular-nums mt-1">{liveDash.lowStock?.length ?? 0}</p>
              <p className="text-[11px] text-[var(--ui-muted)]">Inventario</p>
              <p className="text-[11px] font-medium text-[var(--ui-accent-muted)] mt-0.5">Ir a Almacén</p>
            </button>
          </div>
          {liveDash.operationalSummary &&
          (liveDash.operationalSummary.pendingCount != null ||
            liveDash.operationalSummary.readyCount != null ||
            liveDash.operationalSummary.staleReadyCount != null ||
            liveDash.activeOrders != null) ? (
            <div className="flex flex-wrap gap-2 mb-3 text-[11px] text-[var(--ui-body-text)]">
              <span className="rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-body-bg)] px-2 py-1 tabular-nums">
                Activos: <strong>{Number(liveDash.activeOrders ?? 0)}</strong>
              </span>
              <span className="rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-body-bg)] px-2 py-1 tabular-nums">
                Pendientes: <strong>{Number(liveDash.operationalSummary.pendingCount ?? 0)}</strong>
              </span>
              <span className="rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-body-bg)] px-2 py-1 tabular-nums">
                Listos: <strong>{Number(liveDash.operationalSummary.readyCount ?? 0)}</strong>
              </span>
              {productionQueueTotal > 0 && Number(liveDash.operationalSummary.staleReadyCount ?? 0) > 0 ? (
              <span
                className="rounded-md border px-2 py-1 tabular-nums ui-live-pill-stale"
              >
                Listos {'>'}25 min: <strong>{Number(liveDash.operationalSummary.staleReadyCount ?? 0)}</strong>
              </span>
              ) : null}
            </div>
          ) : null}
          {liveDash.insightToday ? (
            <p className="text-xs text-[var(--ui-accent-muted)] mb-2">{liveDash.insightToday}</p>
          ) : null}
          {visibleOperationalAlerts.length > 0 ? (
            <ul className="space-y-1.5 border-t border-[color:var(--ui-border)] pt-3">
              {visibleOperationalAlerts.map((a) => (
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div className="rounded-lg border border-[color:var(--ui-card-border)] bg-[var(--ui-surface)] px-3 py-2">
          <label htmlFor="escritorio-caja-filter" className="flex items-center gap-2 text-xs text-[var(--ui-muted)] mb-1">
            <MdPointOfSale className="shrink-0 text-[var(--ui-accent-muted)]" />
            Caja
          </label>
          <div className="relative">
            <select
              id="escritorio-caja-filter"
              value={selectedCajaStationId}
              onChange={(e) => setSelectedCajaStationId(e.target.value)}
              className="w-full appearance-none rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] px-3 py-2 pr-8 text-sm font-medium text-[var(--ui-body-text)] focus:outline-none focus:border-[var(--ui-accent-muted)]"
            >
              <option value="">Todas</option>
              {cajaStations.map((station) => (
                <option key={station.id} value={station.id}>
                  {station.name}
                </option>
              ))}
            </select>
            <MdKeyboardArrowDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--ui-accent-muted)]" />
          </div>
          <p className="text-[11px] text-[var(--ui-muted)] mt-1.5">
            Ventas según cierres de caja · {selectedCajaLabel}
            {activeRegisterBlocks.length > 0 ? (
              <span> · {activeRegisterBlocks.length} turno{activeRegisterBlocks.length === 1 ? '' : 's'}</span>
            ) : null}
          </p>
        </div>

        <div className="rounded-lg border border-[color:var(--ui-card-border)] bg-[var(--ui-surface)] px-3 py-2 text-left text-sm flex flex-col gap-2">
          <div className="grid grid-cols-12 gap-2">
            <button
              type="button"
              onClick={startRangeSelection}
              className="col-span-6 rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] px-2 py-1.5 text-left hover:border-[var(--ui-accent-muted)] transition-colors min-w-0"
            >
              <div className="flex items-center gap-2 text-[var(--ui-muted)] text-xs">
                <MdDateRange className="shrink-0 text-[var(--ui-accent-muted)]" />
                <span className="truncate">{datePickStep === 'end' ? 'Selecciona FIN' : 'Selecciona INICIO'}</span>
                <MdKeyboardArrowDown className="ml-auto shrink-0 text-[var(--ui-accent-muted)]" />
              </div>
              <p className="mt-0.5 text-[13px] font-medium text-[var(--ui-body-text)] whitespace-nowrap truncate tabular-nums">
                {dateRangeDisplay}
              </p>
            </button>
            <button
              type="button"
              onClick={() => {
                applyWeekRange();
                setDatePickStep('idle');
              }}
              className={`col-span-2 rounded-md border px-2 py-1.5 text-xs font-semibold transition-colors ${
                datePreset === 'week'
                  ? 'bg-[var(--ui-accent)] border-[var(--ui-accent)] text-white'
                  : 'bg-[var(--ui-surface-2)] border-[color:var(--ui-border)] text-[var(--ui-body-text)] hover:border-[var(--ui-accent-muted)]'
              }`}
            >
              Semana
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
                applyTotalRange();
                setDatePickStep('idle');
              }}
              className={`col-span-2 rounded-md border px-2 py-1.5 text-xs font-semibold transition-colors ${
                datePreset === 'total'
                  ? 'bg-[var(--ui-accent)] border-[var(--ui-accent)] text-white'
                  : 'bg-[var(--ui-surface-2)] border-[color:var(--ui-border)] text-[var(--ui-body-text)] hover:border-[var(--ui-accent-muted)]'
              }`}
            >
              Todos
            </button>
            <input
              ref={startDateInputRef}
              type="date"
              value={startDate}
              max={endDate || undefined}
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
              min={startDate || undefined}
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
          <p className="text-[11px] text-[var(--ui-muted)]">
            {dateRangeLabel}
            {registerReportLoading ? ' · actualizando…' : null}
          </p>
        </div>
      </div>

      {registerReportLoading ? (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-[var(--ui-muted)]">
          <div className="animate-spin w-5 h-5 border-2 border-[var(--ui-accent)] border-t-transparent rounded-full" />
          Cargando ventas por cierres de caja…
        </div>
      ) : null}

      <div className={registerReportLoading ? 'space-y-4 opacity-60 pointer-events-none' : 'space-y-4'}>
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
        <div className="xl:col-span-8 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {[
            { label: 'Ventas en efectivo', amount: salesByPayment.efectivo, currency: true },
            { label: 'Ventas con tarjeta', amount: salesByPayment.tarjeta, currency: true },
            { label: 'Ventas por Yape/Plin', amount: (salesByPayment.yape || 0) + (salesByPayment.plin || 0), currency: true },
            { label: 'Total de ventas', amount: totalSales, currency: true },
            { label: 'Egresos de caja', amount: totalCashExpenses, currency: true },
            { label: 'Total de descuentos', amount: totalDiscounts, currency: true },
            { label: 'Ventas al crédito', amount: totalCredit, currency: true },
            { label: 'Cobro de débito', amount: totalDebitIncome, currency: true },
            { label: 'Clientes', amount: paidAccountsCount, currency: false },
            { label: 'Promedio de venta', amount: averageSaleAmount, currency: true },
            { label: 'Productos vendidos', amount: productsSoldCount, currency: false },
            { label: 'Cortesías', amount: courtesyCount, currency: false },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-xl border border-[color:var(--ui-card-border)] bg-[color-mix(in_srgb,var(--ui-accent-muted)_10%,var(--ui-surface))] shadow-sm overflow-hidden"
            >
              <p className="text-xs sm:text-sm font-medium text-[var(--ui-body-text)] px-3 py-2 bg-[color-mix(in_srgb,var(--ui-accent-muted)_18%,var(--ui-surface))] border-b border-[color:var(--ui-card-border)]">
                {item.label}
              </p>
              <div className="px-3 py-2.5">
                {item.currency ? (
                  <p className="text-xl sm:text-2xl font-light tabular-nums text-[var(--ui-body-text)] flex items-baseline gap-1 whitespace-nowrap leading-none">
                    <span className="text-sm sm:text-base font-normal text-[var(--ui-accent-muted)]">S/</span>
                    <span>{Number(item.amount || 0).toFixed(2)}</span>
                  </p>
                ) : (
                  <p className="text-xl sm:text-2xl font-light tabular-nums text-[var(--ui-body-text)] leading-none">
                    {Number(item.amount || 0)}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="xl:col-span-4 space-y-4">
        <div className="card p-4">
          <div className="inline-flex w-full rounded-lg border border-[color:var(--ui-border)] overflow-hidden mb-3">
            <button
              type="button"
              onClick={() => setRankingMode('dias')}
              className={`flex-1 px-3 py-2 text-sm font-semibold transition-colors ${
                rankingMode === 'dias' ? 'bg-[var(--ui-accent)] text-white' : 'bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]'
              }`}
            >
              Top días
            </button>
            <button
              type="button"
              onClick={() => setRankingMode('mesas')}
              className={`flex-1 px-3 py-2 text-sm font-semibold transition-colors border-l border-[color:var(--ui-border)] ${
                rankingMode === 'mesas' ? 'bg-[var(--ui-accent)] text-white' : 'bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]'
              }`}
            >
              Top mesas
            </button>
          </div>
          {rankingMode === 'dias' ? (
            <div className="relative h-[220px]">
              {topDiasHasSales ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={topDiasData} margin={{ top: 8, right: 8, left: 4, bottom: 0 }} barCategoryGap="18%">
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--ui-border)" strokeOpacity={0.55} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--ui-muted)' }} interval={0} />
                    <YAxis
                      domain={[0, topDiasYMax]}
                      ticks={topDiasYTicks}
                      allowDecimals={false}
                      tick={{ fontSize: 10, fill: 'var(--ui-muted)' }}
                      width={52}
                      tickFormatter={formatChartYAxisTick}
                    />
                    <Tooltip
                      cursor={{ fill: 'color-mix(in srgb, var(--ui-accent-muted) 12%, transparent)' }}
                      formatter={(v) => [formatCurrency(v), 'Total vendido']}
                      labelFormatter={(_label, payload) => payload?.[0]?.payload?.label || _label}
                      contentStyle={{
                        background: 'var(--ui-surface-2)',
                        border: '1px solid var(--ui-border)',
                        borderRadius: '8px',
                        color: 'var(--ui-body-text)',
                      }}
                    />
                    <Bar dataKey="value" fill="#f59e0b" radius={[6, 6, 0, 0]} maxBarSize={48} name="Ventas" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="absolute inset-0 flex items-center justify-center text-xs text-[var(--ui-muted)] px-4 text-center">
                  Sin ventas en el periodo por día de la semana.
                </p>
              )}
            </div>
          ) : (
            <div className="relative h-[220px]">
              {topMesasHasSales ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={topMesasData} margin={{ top: 8, right: 8, left: 4, bottom: 0 }} barCategoryGap="18%">
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--ui-border)" strokeOpacity={0.55} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--ui-muted)' }} interval={0} />
                    <YAxis
                      domain={[0, topMesasYMax]}
                      ticks={topMesasYTicks}
                      allowDecimals={false}
                      tick={{ fontSize: 10, fill: 'var(--ui-muted)' }}
                      width={52}
                      tickFormatter={formatChartYAxisTick}
                    />
                    <Tooltip
                      cursor={{ fill: 'color-mix(in srgb, var(--ui-accent-muted) 12%, transparent)' }}
                      formatter={(v) => [formatCurrency(v), 'Total vendido']}
                      labelFormatter={(_label, payload) => payload?.[0]?.payload?.label || _label}
                      contentStyle={{
                        background: 'var(--ui-surface-2)',
                        border: '1px solid var(--ui-border)',
                        borderRadius: '8px',
                        color: 'var(--ui-body-text)',
                      }}
                    />
                    <Bar dataKey="value" fill="var(--ui-accent-muted)" radius={[6, 6, 0, 0]} maxBarSize={48} name="Ventas" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="absolute inset-0 flex items-center justify-center text-xs text-[var(--ui-muted)] px-4 text-center">
                  Sin ventas por mesa en el periodo seleccionado.
                </p>
              )}
            </div>
          )}
        </div>
        <div className="card p-4">
          <p className="text-sm font-semibold text-[var(--ui-body-text)] mb-3">Métodos de pago</p>
          <div className="relative h-[220px]">
            {paymentPieData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                  <Pie
                    data={paymentPieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius="52%"
                    outerRadius="78%"
                    paddingAngle={2}
                    label={false}
                  >
                    {paymentPieData.map((row, i) => (
                      <Cell key={row.key} fill={PAYMENT_COLORS[i % PAYMENT_COLORS.length]} stroke="var(--ui-border)" />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v, name) => [formatCurrency(v), name]}
                    contentStyle={{
                      background: 'var(--ui-surface-2)',
                      border: '1px solid var(--ui-border)',
                      borderRadius: '8px',
                      color: 'var(--ui-body-text)',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : null}
          </div>
        </div>
        </div>
      </div>
      </div>
    </div>
  );
}
