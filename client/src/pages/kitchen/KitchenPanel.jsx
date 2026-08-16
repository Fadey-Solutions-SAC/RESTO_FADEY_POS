import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ORDER_TYPES, formatTime, parseApiDate } from '../../utils/api';
import { getKitchenOrderNotesDisplay } from '../../utils/reservationKitchenNotes';
import { useSocket, useSocketEmit } from '../../hooks/useSocket';
import { useActiveInterval } from '../../hooks/useActiveInterval';
import { useAuth } from '../../context/AuthContext';
import { useAppLocaleBootstrap } from '../../hooks/useAppLocaleBootstrap';
import useStaffSessionHeartbeat from '../../hooks/useStaffSessionHeartbeat';
import EndShiftModal from '../../components/EndShiftModal';
import { MdLogout, MdRestaurant, MdDeliveryDining, MdTableBar, MdCheckCircle, MdAccessTime, MdPrint, MdSettings, MdHistory } from 'react-icons/md';
import { getProductionAreaIcon } from '../../utils/productionAreaUi';
import toast from 'react-hot-toast';
import Modal from '../../components/Modal';
import PrinterModuleModal from '../../components/printing/PrinterModuleModal';
import { usePrintingModule } from '../../hooks/usePrintingModule';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  orderHasTakeoutNote,
  buildPedidoMesaTicketPlainText,
  normalizeThermalPaperWidthMm,
} from '../../utils/ticketPlainText';
import { isBarProductionItemForStation } from '../../utils/productionArea';
import { useShowDeliveryUi } from '../../hooks/useDeliveryEnabled';
import { canAjusteBarAutoDismiss } from '../../utils/posPermissions';
import { playNotificationSound, preloadNotificationSound } from '../../utils/playNotificationSound';

/** Pedido auto-pedido con cuenta de cliente (sin mesa física). */
function isCuentaClienteSelfOrder(order) {
  return String(order?.table_number || '') === 'Cliente' && String(order?.customer_id || '').trim() !== '';
}

const KITCHEN_ITEM_HIGHLIGHT_MS = 10 * 60 * 1000;
const KITCHEN_ARRIVAL_OVERDUE_MS = 30 * 60 * 1000;
const KITCHEN_PREP_OVERDUE_MS = 30 * 60 * 1000;
const normalizePaperWidthMm = normalizeThermalPaperWidthMm;

function kitchenHighlightKey(orderId, itemId) {
  return `${String(orderId || '').trim()}:${String(itemId || '').trim()}`;
}

function itemHighlightActive(item, highlightIds, orderId) {
  if (!item?.id || !orderId) return false;
  const key = kitchenHighlightKey(orderId, item.id);
  if (highlightIds?.has?.(key)) return true;
  const at = item?.kitchen_highlight_at;
  if (!String(at || '').trim()) return false;
  const d = parseApiDate(at);
  if (!d) return false;
  return Date.now() - d.getTime() < KITCHEN_ITEM_HIGHLIGHT_MS;
}

const BAR_AUTO_DISMISS_MINUTE_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120];

function localDateInputValue(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function readOrderStationField(order, areaId, field) {
  const st = String(areaId || '').trim() || 'cocina';
  const map = order?.order_stations || order?.station_states;
  if (map && typeof map === 'object') {
    const row = map[st] || (Array.isArray(map) ? map.find((r) => String(r?.area_id) === st) : null);
    if (row && String(row[field] || '').trim()) return row[field];
  }
  if (order?.order_station && String(order.order_station.area_id || '') === st) {
    return order.order_station[field];
  }
  return null;
}

function getStationPreparingAt(order, areaId) {
  const st = String(areaId || '').trim() || 'cocina';
  if (st === 'bar') return order?.station_bar_preparing_at;
  if (st === 'cocina') return order?.station_cocina_preparing_at;
  return (
    order?.station_preparing_at ||
    readOrderStationField(order, st, 'preparing_at') ||
    null
  );
}

function getStationReadyAt(order, areaId) {
  const st = String(areaId || '').trim() || 'cocina';
  if (st === 'bar') return order?.station_bar_ready_at;
  if (st === 'cocina') return order?.station_cocina_ready_at;
  return (
    order?.station_ready_at ||
    order?.station_dispatched_at ||
    readOrderStationField(order, st, 'ready_at') ||
    null
  );
}

function formatDispatchedClock(order, areaId) {
  const st = String(areaId || '').trim() || 'cocina';
  const raw =
    order?.station_dispatched_at ||
    (st === 'bar'
      ? order?.station_bar_ready_at
      : st === 'cocina'
        ? order?.station_cocina_ready_at
        : getStationReadyAt(order, st));
  const parsed = parseApiDate(raw);
  return parsed ? formatTime(parsed) : '—';
}

export default function KitchenPanel({ station, areaId: areaIdProp }) {
  const { t } = useTranslation('kitchen');
  const params = useParams();
  const areaId = String(params?.areaId || areaIdProp || station || 'cocina').trim() || 'cocina';
  const [orders, setOrders] = useState([]);
  const [filter, setFilter] = useState('all');
  const showDeliveryUi = useShowDeliveryUi();
  const { user } = useAuth();
  useStaffSessionHeartbeat(user);
  useAppLocaleBootstrap();
  const [endShiftOpen, setEndShiftOpen] = useState(false);
  const [statusBusy, setStatusBusy] = useState({});
  const [highlightItemIds, setHighlightItemIds] = useState(() => new Set());
  const [clockTick, setClockTick] = useState(0);
  const overdueNotifiedRef = useRef(new Set());
  const navigate = useNavigate();
  const location = useLocation();
  const emit = useSocketEmit();
  const isBar = areaId === 'bar';
  const isCocina = areaId === 'cocina';
  const usesItemLevelReady = isCocina;
  const printerModuleKey = areaId;
  const { loadConfig: reloadPrinterConfig } = usePrintingModule(printerModuleKey);
  const [printerModalOpen, setPrinterModalOpen] = useState(false);
  const [barSettingsOpen, setBarSettingsOpen] = useState(false);
  const [barAutoDismiss, setBarAutoDismiss] = useState(false);
  const [barAutoDismissMinutes, setBarAutoDismissMinutes] = useState(30);
  const [barSettingsLoaded, setBarSettingsLoaded] = useState(false);
  const [barSettingsSaving, setBarSettingsSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyDate, setHistoryDate] = useState(() => localDateInputValue());
  const [historyOrders, setHistoryOrders] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [areaDisplayName, setAreaDisplayName] = useState('');
  const StationIcon = getProductionAreaIcon({ id: areaId, name: areaDisplayName || areaId });
  const panelTitle = isBar
    ? t('panel.barTitle')
    : isCocina
      ? t('panel.kitchenTitle')
      : (areaDisplayName || areaId);
  const stationLabel = isBar
    ? t('panel.stationBar')
    : isCocina
      ? t('panel.stationKitchen')
      : (areaDisplayName || areaId);
  const canReturnToAdmin = user?.role === 'admin' && !location.pathname.startsWith('/admin');
  const canEditBarSettings =
    isBar &&
    (['admin', 'bar', 'master_admin'].includes(String(user?.role || '').toLowerCase()) ||
      canAjusteBarAutoDismiss(user));

  useEffect(() => {
    let cancelled = false;
    if (isBar || isCocina) {
      setAreaDisplayName('');
      return undefined;
    }
    api
      .get('/production-areas')
      .then((list) => {
        if (cancelled) return;
        const match = (Array.isArray(list) ? list : []).find((a) => String(a?.id) === areaId);
        setAreaDisplayName(String(match?.name || '').trim() || areaId);
      })
      .catch(() => {
        if (!cancelled) setAreaDisplayName(areaId);
      });
    return () => {
      cancelled = true;
    };
  }, [areaId, isBar, isCocina]);

  const playStationAlert = () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = isBar ? 880 : 660;
      gainNode.gain.setValueAtTime(0.001, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.38);
      oscillator.onended = () => {
        if (ctx.state !== 'closed') ctx.close().catch(() => {});
      };
    } catch (_) {
      // noop: if browser blocks autoplay or audio context
    }
  };

  useEffect(() => {
    preloadNotificationSound(isBar ? 'bar' : 'kitchen');
  }, [isBar]);

  useEffect(() => {
    if (!showDeliveryUi && filter === 'delivery') setFilter('all');
  }, [showDeliveryUi, filter]);

  const getStationItems = useCallback((items = []) => {
    const list = Array.isArray(items) ? items : [];
    return list.filter((it) => isBarProductionItemForStation(it, areaId));
  }, [areaId]);

  const loadOrders = async () => {
    try {
      const qs = new URLSearchParams();
      if (filter !== 'all') qs.set('type', filter);
      qs.set('station', areaId);
      const data = await api.get(`/orders/kitchen?${qs.toString()}`);
      setOrders(Array.isArray(data) ? data : []);
      if (usesItemLevelReady) {
        const ids = new Set();
        (data || []).forEach((order) => {
          getStationItems(order?.items).forEach((item) => {
            if (itemHighlightActive(item, null, order.id)) ids.add(kitchenHighlightKey(order.id, item.id));
          });
        });
        setHighlightItemIds(ids);
      }
    } catch (err) {
      console.error(err);
      if (String(err?.message || '').includes('403') || String(err?.message || '').toLowerCase().includes('permiso')) {
        toast.error('Sin permiso para ver este panel. Cierre sesión y vuelva a entrar si le acaban de dar acceso.');
      }
    }
  };

  useEffect(() => {
    loadOrders();
    emit(isBar ? 'join-bar' : 'join-kitchen');
  }, [filter, areaId]);
  useActiveInterval(loadOrders, 10000);
  useActiveInterval(() => setClockTick((n) => n + 1), 30000);

  const loadDispatchedHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set('station', areaId);
      if (filter !== 'all') qs.set('type', filter);
      if (historyDate) qs.set('date', historyDate);
      const data = await api.get(`/orders/kitchen/dispatched?${qs.toString()}`);
      setHistoryOrders(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      toast.error(t('history.loadFailed'));
      setHistoryOrders([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [areaId, filter, historyDate, t]);

  useEffect(() => {
    if (!historyOpen) return;
    void loadDispatchedHistory();
  }, [historyOpen, loadDispatchedHistory]);

  const isKitchenItemHighlighted = useCallback(
    (item, orderId) => usesItemLevelReady && itemHighlightActive(item, highlightItemIds, orderId),
    [usesItemLevelReady, highlightItemIds],
  );

  const isKitchenItemReady = useCallback((item) => {
    return Boolean(String(item?.station_cocina_ready_at || '').trim());
  }, []);

  const getPendingStationItems = useCallback((items = []) => {
    const stationItems = getStationItems(items);
    if (!usesItemLevelReady) return stationItems;
    return stationItems.filter((item) => !isKitchenItemReady(item));
  }, [usesItemLevelReady, getStationItems, isKitchenItemReady]);

  const isComandaDoneForStation = useCallback((order) => {
    if (!usesItemLevelReady) {
      return Boolean(String(getStationReadyAt(order, areaId) || '').trim());
    }
    if (Boolean(String(order?.station_cocina_ready_at || '').trim())) return true;
    const kitchenItems = getStationItems(order?.items);
    if (!kitchenItems.length) return true;
    return kitchenItems.every(isKitchenItemReady);
  }, [usesItemLevelReady, areaId, getStationItems, isKitchenItemReady]);

  const isComandaPreparingForStation = useCallback((order) => {
    return Boolean(String(getStationPreparingAt(order, areaId) || '').trim());
  }, [areaId]);

  const visibleOrders = orders.filter((order) => {
    if (isComandaDoneForStation(order)) return false;
    return getPendingStationItems(order.items).length > 0;
  });

  const printOrderForStation = async (order, { silent = false } = {}) => {
    try {
      const moduleKey = printerModuleKey;
      let payloadOrder = order || {};
      let items = getPendingStationItems(payloadOrder?.items || []);
      if (!items.length && payloadOrder?.id) {
        const full = await api.get(`/orders/${payloadOrder.id}`);
        payloadOrder = full || payloadOrder;
        items = getPendingStationItems(payloadOrder?.items || []);
      }
      if (!items.length) {
        if (!silent) toast.error(t('toast.noItems', { station: stationLabel }));
        return false;
      }
      const cfg = await api.printing.get('/printing/config');
      const paper = normalizePaperWidthMm(
        cfg?.[moduleKey]?.anchoPapel ?? cfg?.[moduleKey]?.paperWidth ?? 80,
      );
      const takeout = orderHasTakeoutNote(payloadOrder);
      const waiter = String(payloadOrder?.created_by_user_name || '').trim();
      const tableLbl =
        payloadOrder?.type === 'dine_in' && payloadOrder?.table_number
          ? `Mesa ${String(payloadOrder.table_number).trim()}`
          : String(payloadOrder?.table_number || '').trim();
      const ticketItems = items.map((it) => ({
        product_name: String(it.product_name || '').trim() || '—',
        variant_name: String(it.variant_name || '').trim(),
        quantity: Number(it.quantity || 1),
        notes: String(it.notes || '').trim(),
        modifier_option: String(it.modifier_option || '').trim(),
      }));
      const text = buildPedidoMesaTicketPlainText({
        tableLabel: tableLbl,
        orderNumber: payloadOrder?.order_number,
        takeout,
        waiterName: waiter,
        items: ticketItems,
        widthMm: paper,
        printedAt: new Date(),
        orderType: payloadOrder?.type || 'dine_in',
      });
      await api.printing.post(`/printing/print/${moduleKey}`, {
        text,
        preformatted: true,
        paperWidth: paper,
        anchoPapel: paper,
      });
      if (!silent) toast.success(t('toast.sentToStation', { station: stationLabel }));
      return true;
    } catch (err) {
      if (!silent) toast.error(err?.message || t('toast.printFailed'));
      return false;
    }
  };

  const orderRelevantToStation = useCallback(
    (order) => getStationItems(order?.items || []).length > 0,
    [getStationItems],
  );

  const filterNewIdsForStation = useCallback(
    (order, ids) => {
      if (!Array.isArray(ids) || !ids.length) return [];
      const items = Array.isArray(order?.items) ? order.items : [];
      return ids.filter((id) => {
        const item = items.find((i) => i.id === id);
        if (!item) return false;
        return isBarProductionItemForStation(item, areaId);
      });
    },
    [areaId],
  );

  const handleKitchenIncomingOrder = (order, toastLabel) => {
    if (!orderRelevantToStation(order)) return;
    loadOrders();
    playNotificationSound(isBar ? 'bar' : 'kitchen', order?.id);
    const num = order?.order_number;
    toast.success(
      num != null
        ? t('toast.newOrderNumber', { number: num, station: stationLabel })
        : toastLabel,
      { icon: '🔔', duration: 5000 }
    );
  };

  const handleKitchenLinesUpdated = (payload) => {
    const order = payload?.order || payload;
    const orderId = order?.id;
    const allNewIds = Array.isArray(payload?.new_item_ids) ? payload.new_item_ids : [];
    const stationNewIds = filterNewIdsForStation(order, allNewIds);
    if (usesItemLevelReady && orderId && stationNewIds.length) {
      setHighlightItemIds((prev) => {
        const next = new Set(prev);
        stationNewIds.forEach((itemId) => next.add(kitchenHighlightKey(orderId, itemId)));
        return next;
      });
    }
    loadOrders();
    if (payload?.merged && stationNewIds.length) {
      playNotificationSound(isBar ? 'bar' : 'kitchen', orderId);
      const num = order?.order_number;
      toast.success(
        num != null
          ? t('toast.itemsAddedToComanda', { number: num })
          : t('toast.itemsAddedToComandaShort'),
        { icon: '➕', duration: 6000 },
      );
    } else if (!payload?.merged && orderRelevantToStation(order)) {
      handleKitchenIncomingOrder(order, t('toast.orderUpdated'));
    }
  };

  useEffect(() => {
    if (!isBar) return undefined;
    let cancelled = false;
    api
      .get('/orders/bar-station-settings')
      .then((data) => {
        if (cancelled) return;
        setBarAutoDismiss(Boolean(data?.autoDismissPendingAfter30Min));
        if (data?.autoDismissMinutes != null) {
          setBarAutoDismissMinutes(Number(data.autoDismissMinutes));
        }
        setBarSettingsLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setBarSettingsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isBar]);

  const saveBarSettings = async ({ enabled, minutes } = {}) => {
    setBarSettingsSaving(true);
    try {
      const payload = {};
      if (enabled !== undefined) payload.autoDismissPendingAfter30Min = Boolean(enabled);
      if (minutes !== undefined) payload.autoDismissMinutes = Number(minutes);
      const saved = await api.put('/orders/bar-station-settings', payload);
      setBarAutoDismiss(Boolean(saved?.autoDismissPendingAfter30Min));
      if (saved?.autoDismissMinutes != null) {
        setBarAutoDismissMinutes(Number(saved.autoDismissMinutes));
      }
      if (enabled !== undefined) {
        toast.success(
          saved?.autoDismissPendingAfter30Min
            ? t('barSettings.enabledToast', { minutes: saved.autoDismissMinutes })
            : t('barSettings.disabledToast'),
        );
      } else if (minutes !== undefined) {
        toast.success(t('barSettings.minutesSaved', { minutes: saved.autoDismissMinutes }));
      }
      void loadOrders();
    } catch (err) {
      toast.error(err?.message || t('barSettings.saveFailed'));
    } finally {
      setBarSettingsSaving(false);
    }
  };

  useSocket('bar-station-settings-update', (payload) => {
    if (!isBar || !payload) return;
    setBarAutoDismiss(Boolean(payload.autoDismissPendingAfter30Min));
    if (payload.autoDismissMinutes != null) {
      setBarAutoDismissMinutes(Number(payload.autoDismissMinutes));
    }
  });

  useSocket('bar-auto-dismiss', (payload) => {
    if (!isBar) return;
    const order = payload?.order || payload;
    const table = order?.table_number;
    const num = order?.order_number;
    const minutes = payload?.minutes ?? barAutoDismissMinutes;
    const label = table
      ? t('barSettings.autoDismissTable', { table, minutes })
      : num != null
        ? t('barSettings.autoDismissOrder', { number: num, minutes })
        : t('barSettings.autoDismissGeneric', { minutes });
    toast(label, { duration: 7000, icon: 'ℹ️' });
    void loadOrders();
    if (historyOpen) void loadDispatchedHistory();
  });

  useSocket('new-order', (order) => handleKitchenIncomingOrder(order, t('toast.newOrder')));
  /** Mesa/salón: ítems nuevos van por PUT /orders/:id/lines — antes no había evento para imprimir en cocina. */
  useSocket('order-lines-updated', handleKitchenLinesUpdated);

  useSocket('order-update', () => loadOrders());

  const canShowPrepareAction = useCallback(
    (order) => !isComandaDoneForStation(order) && !isComandaPreparingForStation(order),
    [isComandaDoneForStation, isComandaPreparingForStation],
  );
  const canShowReadyAction = useCallback(
    (order) => !usesItemLevelReady && !isComandaDoneForStation(order) && isComandaPreparingForStation(order),
    [usesItemLevelReady, isComandaDoneForStation, isComandaPreparingForStation],
  );

  const updateStatus = async (orderId, status, orderItemId = null) => {
    const busyKey = orderItemId ? `${orderId}:${orderItemId}` : orderId;
    if (statusBusy[busyKey]) return;
    const current = orders.find((o) => o.id === orderId);
    if (status === 'preparing' && !canShowPrepareAction(current)) {
      void loadOrders();
      return;
    }
    if (status === 'ready' && !usesItemLevelReady && !canShowReadyAction(current)) {
      void loadOrders();
      return;
    }
    if (status === 'ready' && usesItemLevelReady) {
      if (!isComandaPreparingForStation(current)) {
        void loadOrders();
        return;
      }
      const item = getStationItems(current?.items).find((i) => i.id === orderItemId);
      if (!item || isKitchenItemReady(item)) {
        void loadOrders();
        return;
      }
    }
    setStatusBusy((prev) => ({ ...prev, [busyKey]: true }));
    try {
      const qs = new URLSearchParams({ station: areaId });
      const body = { status, station: areaId };
      if (usesItemLevelReady && orderItemId) body.order_item_id = orderItemId;
      await api.put(`/orders/${orderId}/status?${qs.toString()}`, body);
      if (status === 'ready' && !usesItemLevelReady) {
        setOrders((prev) => prev.filter((o) => o.id !== orderId));
      } else if (status === 'ready' && usesItemLevelReady && orderItemId) {
        const nowIso = new Date().toISOString();
        setOrders((prev) =>
          prev
            .map((o) => {
              if (o.id !== orderId) return o;
              const items = (o.items || []).map((it) =>
                it.id === orderItemId ? { ...it, station_cocina_ready_at: nowIso } : it,
              );
              const kitchenItems = getStationItems(items);
              const allReady = kitchenItems.length > 0 && kitchenItems.every(isKitchenItemReady);
              return {
                ...o,
                items,
                ...(allReady ? { station_cocina_ready_at: nowIso, station_cocina_preparing_at: null } : {}),
              };
            })
            .filter((o) => !isComandaDoneForStation(o)),
        );
      } else {
        const nowIso = new Date().toISOString();
        setOrders((prev) =>
          prev.map((o) => {
            if (o.id !== orderId) return o;
            const next = {
              ...o,
              status: o.status === 'pending' ? 'preparing' : o.status,
            };
            if (areaId === 'bar') {
              next.station_bar_preparing_at = nowIso;
              next.station_bar_ready_at = null;
            } else if (areaId === 'cocina') {
              next.station_cocina_preparing_at = nowIso;
              next.station_cocina_ready_at = null;
              next.items = (o.items || []).map((it) => ({ ...it, station_cocina_ready_at: null }));
            } else {
              next.station_preparing_at = nowIso;
              next.station_ready_at = null;
            }
            return next;
          }),
        );
      }
      toast.success(status === 'preparing' ? t('toast.preparing') : t('toast.markedReady'));
      void loadOrders();
      if (historyOpen && status === 'ready') void loadDispatchedHistory();
    } catch (err) {
      toast.error(err.message);
      void loadOrders();
    } finally {
      setStatusBusy((prev) => {
        const next = { ...prev };
        delete next[busyKey];
        return next;
      });
    }
  };

  const ARRIVAL_OVERDUE_MS = KITCHEN_ARRIVAL_OVERDUE_MS;
  const PREP_OVERDUE_MS = KITCHEN_PREP_OVERDUE_MS;

  const getOrderTimerAnchor = (order) => {
    return order?.created_at || getStationPreparingAt(order, areaId);
  };

  const getTimeDiff = (order) => {
    const created = getOrderTimerAnchor(order);
    const d = parseApiDate(created);
    if (!d) return '';
    const diff = Math.floor((Date.now() - d.getTime()) / 60000);
    if (diff < 1) return t('panel.timeNow');
    if (diff < 60) return t('panel.timeMinutes', { count: diff });
    return t('panel.timeHours', { hours: Math.floor(diff / 60), minutes: diff % 60 });
  };

  const isKitchenOrderOverdue = (order) => {
    if (!order || isComandaDoneForStation(order)) return false;
    const anchor = getOrderTimerAnchor(order);
    const d = parseApiDate(anchor);
    if (!d) return false;
    const elapsed = Date.now() - d.getTime();
    if (!isComandaPreparingForStation(order)) return elapsed >= ARRIVAL_OVERDUE_MS;
    return elapsed >= PREP_OVERDUE_MS;
  };

  const getOverdueToastLabel = useCallback((order) => {
    if (order?.table_number && order?.type === 'dine_in') {
      return t('toast.overdueTable', { table: order.table_number });
    }
    if (order?.type === 'delivery') {
      return t('toast.overdueDelivery', { number: order.order_number });
    }
    return t('toast.overdueOrder', { number: order.order_number });
  }, [t]);

  useEffect(() => {
    const activeOrders = orders.filter((order) => {
      if (isComandaDoneForStation(order)) return false;
      return getPendingStationItems(order.items).length > 0;
    });
    const visibleIds = new Set();
    activeOrders.forEach((order) => {
      visibleIds.add(order.id);
      if (!isKitchenOrderOverdue(order)) return;
      if (overdueNotifiedRef.current.has(order.id)) return;
      overdueNotifiedRef.current.add(order.id);
      toast.error(getOverdueToastLabel(order), { duration: 9000, icon: '⏱️' });
      playStationAlert();
    });
    overdueNotifiedRef.current.forEach((id) => {
      if (!visibleIds.has(id)) overdueNotifiedRef.current.delete(id);
    });
  }, [orders, clockTick, getOverdueToastLabel, isComandaDoneForStation, getPendingStationItems]);

  const typeIcons = { dine_in: MdTableBar, delivery: MdDeliveryDining, pickup: MdRestaurant };

  return (
    <div className="min-h-screen bg-[var(--ui-body-bg)] text-[var(--ui-body-text)]">
      <header className="bg-[var(--ui-surface)] backdrop-blur-xl border-b border-[color:var(--ui-border)] px-6 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <StationIcon className="text-3xl text-[var(--ui-body-text)]" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">{panelTitle}</h1>
              {canEditBarSettings && (
                <button
                  type="button"
                  onClick={() => setBarSettingsOpen(true)}
                  className="p-1.5 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] hover:bg-[var(--ui-sidebar-hover)] text-[var(--ui-body-text)]"
                  title={t('barSettings.gearTitle')}
                  aria-label={t('barSettings.gearTitle')}
                >
                  <MdSettings className="text-lg" />
                </button>
              )}
            </div>
            <p className="text-[var(--ui-muted)] text-sm">
              {t('panel.activeOrders', { count: visibleOrders.length })}
              {isBar && barAutoDismiss ? (
                <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-400/90">
                  · {t('barSettings.badgeActive', { minutes: barAutoDismissMinutes })}
                </span>
              ) : null}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="px-3 py-2 rounded-lg text-sm font-medium inline-flex items-center gap-2 bg-[var(--ui-surface-2)] hover:bg-[var(--ui-sidebar-hover)] text-[var(--ui-body-text)] border border-[color:var(--ui-border)]"
            title={t('history.button')}
          >
            <MdHistory className="text-lg" />
            {t('history.button')}
          </button>
          <div className="flex flex-wrap items-center gap-2">
            {[
              { v: 'all', l: t('panel.filterAll') },
              { v: 'dine_in', l: t('panel.filterTables') },
              ...(showDeliveryUi ? [{ v: 'delivery', l: t('panel.filterDelivery') }] : []),
            ].map(f => (
              <button
                key={f.v}
                type="button"
                onClick={() => setFilter(f.v)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors inline-flex items-center justify-center gap-1.5 ${filter === f.v ? 'bg-[var(--ui-accent)] text-white' : 'bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)] border border-[color:var(--ui-border)]'}`}
              >
                {f.v === 'delivery' ? <MdDeliveryDining className="text-base shrink-0" /> : null}
                {f.l}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setPrinterModalOpen(true)}
            className="px-3 py-2 rounded-lg text-sm font-medium inline-flex items-center gap-2 bg-[var(--ui-surface-2)] hover:bg-[var(--ui-sidebar-hover)] text-[var(--ui-body-text)] border border-[color:var(--ui-border)]"
            title={t('panel.printerSettings')}
            aria-label={t('panel.printerSettings')}
          >
            <MdSettings className="text-lg" />
            {t('panel.printer')}
          </button>
          {canReturnToAdmin && (
            <button onClick={() => navigate('/admin')} className="px-3 py-2 bg-[var(--ui-accent)] hover:bg-[var(--ui-accent-hover)] rounded-lg text-white border border-[color:var(--ui-border)] text-sm font-medium">
              {t('panel.backToOps')}
            </button>
          )}
          <button type="button" onClick={() => setEndShiftOpen(true)} className="px-3 py-2 hover:bg-[var(--ui-sidebar-hover)] rounded-lg text-[var(--ui-muted)] hover:text-[var(--ui-body-text)] border border-[color:var(--ui-border)] text-sm font-medium inline-flex items-center gap-2">
            <MdLogout className="text-lg" /> {t('common:layout.endShift')}
          </button>
        </div>
      </header>
      <EndShiftModal isOpen={endShiftOpen} onClose={() => setEndShiftOpen(false)} />
      <PrinterModuleModal
        isOpen={printerModalOpen}
        onClose={() => {
          setPrinterModalOpen(false);
          void reloadPrinterConfig();
        }}
        moduleKey={printerModuleKey}
        moduleLabel={stationLabel}
      />
      <Modal
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title={t('history.modalTitle', { station: stationLabel })}
        size="xl"
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="block text-xs font-medium text-[var(--ui-muted)] mb-1">{t('history.dateLabel')}</span>
              <input
                type="date"
                value={historyDate}
                onChange={(e) => setHistoryDate(e.target.value)}
                className="input-field w-auto"
              />
            </label>
            <button
              type="button"
              onClick={() => void loadDispatchedHistory()}
              disabled={historyLoading}
              className="px-3 py-2 rounded-lg text-sm font-medium bg-[var(--ui-accent)] text-white hover:bg-[var(--ui-accent-hover)] disabled:opacity-50"
            >
              {historyLoading ? t('history.loading') : t('history.refresh')}
            </button>
            <p className="text-xs text-[var(--ui-muted)] ml-auto">
              {t('history.count', { count: historyOrders.length })}
            </p>
          </div>
          {historyLoading ? (
            <p className="text-sm text-[var(--ui-muted)] py-8 text-center">{t('history.loading')}</p>
          ) : historyOrders.length === 0 ? (
            <div className="py-12 text-center">
              <MdHistory className="text-5xl text-[var(--ui-muted)] mx-auto mb-3" />
              <p className="text-[var(--ui-body-text)] font-medium">{t('history.emptyTitle')}</p>
              <p className="text-sm text-[var(--ui-muted)] mt-1">{t('history.emptyHint')}</p>
            </div>
          ) : (
            <div className="max-h-[min(70vh,560px)] overflow-y-auto space-y-3 pr-1">
              {historyOrders.map((order) => {
                const TypeIcon = typeIcons[order.type] || MdRestaurant;
                const cuentaCliente = isCuentaClienteSelfOrder(order);
                const stationItems = getStationItems(order.items || []);
                return (
                  <div
                    key={order.id}
                    className="rounded-xl border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] overflow-hidden"
                  >
                    <div className="px-4 py-3 flex items-center justify-between gap-3 border-b border-[color:var(--ui-border)]">
                      <div className="flex items-center gap-2 min-w-0">
                        {cuentaCliente ? (
                          <span className="font-semibold truncate">{order.customer_name || t('panel.customer')}</span>
                        ) : order.type === 'delivery' ? (
                          <span className="font-semibold">{t('panel.delivery')} #{order.order_number}</span>
                        ) : (
                          <span className="font-semibold">#{order.order_number}</span>
                        )}
                        <TypeIcon className="text-lg shrink-0 text-[var(--ui-muted)]" />
                        {order.table_number ? (
                          <span className="text-xs px-2 py-0.5 rounded border border-[color:var(--ui-border)]">
                            {t('panel.table', { number: order.table_number })}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1 text-sm text-[var(--ui-muted)] shrink-0">
                        <MdAccessTime />
                        <span>{formatDispatchedClock(order, areaId)}</span>
                      </div>
                    </div>
                    <ul className="px-4 py-3 space-y-1.5">
                      {stationItems.map((item) => (
                        <li key={item.id} className="flex items-start gap-2 text-sm">
                          <span className="w-6 h-6 rounded bg-[var(--ui-surface)] border border-[color:var(--ui-border)] flex items-center justify-center text-xs font-bold shrink-0">
                            {item.quantity}
                          </span>
                          <span className="text-[var(--ui-body-text)]">{item.product_name}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Modal>
      {isBar && (
        <Modal
          isOpen={barSettingsOpen}
          onClose={() => setBarSettingsOpen(false)}
          title={t('barSettings.modalTitle')}
        >
          <div className="space-y-4">
            <p className="text-sm text-[var(--ui-muted)]">{t('barSettings.modalHint')}</p>
            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-[color:var(--ui-border)]"
                checked={barAutoDismiss}
                disabled={barSettingsSaving || !barSettingsLoaded || !canEditBarSettings}
                onChange={(e) => void saveBarSettings({ enabled: e.target.checked })}
              />
              <span>
                <span className="block text-sm font-medium text-[var(--ui-body-text)]">
                  {t('barSettings.toggleLabel')}
                </span>
                <span className="block text-xs text-[var(--ui-muted)] mt-1">
                  {t('barSettings.toggleHelp')}
                </span>
              </span>
            </label>
            {barAutoDismiss ? (
              <label className="block">
                <span className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">
                  {t('barSettings.minutesLabel')}
                </span>
                <select
                  className="w-full rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] px-3 py-2 text-sm text-[var(--ui-body-text)]"
                  value={barAutoDismissMinutes}
                  disabled={barSettingsSaving || !barSettingsLoaded || !canEditBarSettings}
                  onChange={(e) => void saveBarSettings({ minutes: Number(e.target.value) })}
                >
                  {BAR_AUTO_DISMISS_MINUTE_OPTIONS.map((mins) => (
                    <option key={mins} value={mins}>
                      {t('barSettings.minutesOption', { count: mins })}
                    </option>
                  ))}
                </select>
                <span className="block text-xs text-[var(--ui-muted)] mt-1">
                  {t('barSettings.minutesHelp')}
                </span>
              </label>
            ) : null}
            {barSettingsSaving ? (
              <p className="text-xs text-[var(--ui-muted)]">{t('barSettings.saving')}</p>
            ) : null}
          </div>
        </Modal>
      )}
      <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {visibleOrders.map(order => {
          const TypeIcon = typeIcons[order.type] || MdRestaurant;
          const isOverdue = isKitchenOrderOverdue(order);

          const cuentaCliente = isCuentaClienteSelfOrder(order);
          const stationPending = !isComandaPreparingForStation(order);
          const cardBorder = isOverdue
            ? 'border-[3px] border-[#DC2626] shadow-[0_0_36px_rgba(220,38,38,0.72)]'
            : stationPending
              ? 'border-2 border-[color:color-mix(in_srgb,var(--ui-accent-muted)_55%,transparent)]'
              : 'border border-[color:var(--ui-border)]';
          const cardBg = 'bg-[var(--ui-surface)]';
          const headerBg = isOverdue
            ? stationPending
              ? 'bg-red-950/70'
              : 'bg-red-950/55'
            : stationPending
              ? 'bg-[var(--ui-sidebar-active-bg)]'
              : 'bg-[var(--ui-surface-2)]';
          const tableBadgeClass = isOverdue
            ? 'rounded border-[3px] border-[#DC2626] bg-red-600/30 px-2 py-0.5 text-sm font-bold text-red-50 shadow-[0_0_14px_rgba(220,38,38,0.75)]'
            : 'rounded border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] px-2 py-0.5 text-sm text-[var(--ui-body-text)]';

          return (
            <div key={order.id} className={`rounded-xl overflow-hidden backdrop-blur-xl ${cardBg} ${cardBorder} ${isOverdue ? 'ring-4 ring-[#DC2626]/80' : ''}`}>
              <div className={`px-4 py-3 ${headerBg}`}>
                {cuentaCliente ? (
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-lg font-bold leading-tight text-[var(--ui-body-text)]" title={order.customer_name}>
                        {order.customer_name || t('panel.customer')}
                      </p>
                      <p className="mt-1 text-xs text-[var(--ui-muted)]">{t('panel.orderNumber', { number: order.order_number })}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 text-sm">
                      <MdAccessTime className={isOverdue ? 'text-red-500' : 'text-[var(--ui-muted)]'} />
                      <span className={isOverdue ? 'font-bold text-red-400' : 'text-[var(--ui-muted)]'}>{getTimeDiff(order)}</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      {order.type === 'delivery' ? (
                        <span className="text-lg font-bold tracking-tight text-[var(--ui-body-text)]">{t('panel.delivery')}</span>
                      ) : (
                        <span className="text-lg font-bold text-[var(--ui-body-text)]">#{order.order_number}</span>
                      )}
                      <TypeIcon className="text-xl shrink-0 text-[var(--ui-body-text)]" />
                      {order.table_number ? (
                        <span className={tableBadgeClass}>{t('panel.table', { number: order.table_number })}</span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1 text-sm">
                      <MdAccessTime className={isOverdue ? 'text-red-500' : 'text-[var(--ui-muted)]'} />
                      <span className={isOverdue ? 'font-bold text-red-400' : 'text-[var(--ui-muted)]'}>{getTimeDiff(order)}</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2 px-4 py-3">
                {getPendingStationItems(order.items).map((item) => {
                  const itemHighlighted = usesItemLevelReady && isKitchenItemHighlighted(item, order.id);
                  const itemBusyKey = `${order.id}:${item.id}`;
                  return (
                  <div
                    key={item.id}
                    className={`flex items-start gap-2 rounded-lg p-1.5 -mx-1.5 ${
                      itemHighlighted
                        ? 'border-2 border-emerald-500 bg-emerald-500/10 shadow-[0_0_0_1px_rgba(16,185,129,0.25)]'
                        : ''
                    }`}
                  >
                    <span className="bg-[var(--ui-surface-2)] border border-[color:var(--ui-border)] text-[var(--ui-body-text)] w-6 h-6 rounded flex items-center justify-center text-sm font-bold flex-shrink-0">{item.quantity}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-[var(--ui-body-text)]">{item.product_name}</p>
                      {item.variant_name && <p className="text-xs text-[var(--ui-muted)]">{item.variant_name}</p>}
                      {item.notes && <p className="text-xs text-[var(--ui-muted)] italic">{item.notes}</p>}
                    </div>
                    {usesItemLevelReady && isComandaPreparingForStation(order) ? (
                      <button
                        type="button"
                        disabled={Boolean(statusBusy[itemBusyKey])}
                        onClick={() => void updateStatus(order.id, 'ready', item.id)}
                        className="shrink-0 px-2.5 py-1.5 min-h-[2rem] bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-50 rounded-lg font-bold text-[11px] text-white transition-colors inline-flex items-center gap-1"
                      >
                        <MdCheckCircle className="text-sm" /> {t('panel.ready')}
                      </button>
                    ) : null}
                  </div>
                  );
                })}
                {(() => {
                  const noteBlock = getKitchenOrderNotesDisplay(order);
                  if (!noteBlock) return null;
                  return (
                    <div className="bg-[var(--ui-surface-2)] border border-[color:var(--ui-border)] rounded-lg p-2 mt-2">
                      <p className="text-xs text-[var(--ui-body-text)] whitespace-pre-line leading-relaxed">{noteBlock}</p>
                    </div>
                  );
                })()}
              </div>

              <div className="px-4 py-3 border-t border-[color:var(--ui-border)]">
                <div className="flex gap-2 items-stretch">
                  <button
                      type="button"
                      title={t('panel.printTicket')}
                      aria-label={t('panel.printTicket')}
                      onClick={() => void printOrderForStation(order)}
                      className="shrink-0 w-10 h-10 min-w-[2.5rem] rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] hover:bg-[var(--ui-sidebar-hover)] text-[var(--ui-body-text)] transition-colors inline-flex items-center justify-center"
                    >
                      <MdPrint className="text-xl" />
                    </button>
                  {canShowPrepareAction(order) ? (
                    <button
                      type="button"
                      disabled={Boolean(statusBusy[order.id])}
                      onClick={() => void updateStatus(order.id, 'preparing')}
                      className="flex-1 min-h-[2.5rem] py-2.5 bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] hover:from-[#1D4ED8] hover:to-[#1E40AF] disabled:opacity-50 disabled:pointer-events-none rounded-lg font-bold text-sm transition-all flex items-center justify-center gap-2"
                    >
                      <StationIcon /> {t('panel.prepare')}
                    </button>
                  ) : canShowReadyAction(order) ? (
                    <button
                      type="button"
                      disabled={Boolean(statusBusy[order.id])}
                      onClick={() => void updateStatus(order.id, 'ready')}
                      className="flex-1 min-h-[2.5rem] py-2.5 bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-50 disabled:pointer-events-none rounded-lg font-bold text-sm transition-colors flex items-center justify-center gap-2"
                    >
                      <MdCheckCircle /> {t('panel.ready')}
                    </button>
                  ) : usesItemLevelReady && isComandaPreparingForStation(order) ? (
                    <div className="flex-1 min-h-[2.5rem] py-2.5 px-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] text-[var(--ui-muted)] text-xs font-medium flex items-center justify-center text-center">
                      {t('panel.readyEachItem')}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}

        {visibleOrders.length === 0 && (
          <div className="col-span-full text-center py-20">
            <StationIcon className="text-6xl text-[var(--ui-muted)] mx-auto mb-4" />
            <p className="text-xl text-[var(--ui-body-text)]">{t('panel.emptyTitle', { station: stationLabel })}</p>
            <p className="text-[var(--ui-muted)] mt-2">{t('panel.emptyHint')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
