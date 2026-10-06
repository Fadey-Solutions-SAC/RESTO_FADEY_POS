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
import NotificationCenter from '../../components/NotificationCenter';
import ProductionPrepBanner, { ProductionPrepButton, useProductionPrep } from '../../components/kitchen/ProductionPrepBanner';
import { usePublishShellTitle } from '../../utils/shellTitleOverride';
import { MdLogout, MdRestaurant, MdDeliveryDining, MdTableBar, MdCheckCircle, MdAccessTime, MdPrint, MdSettings, MdHistory, MdPerson } from 'react-icons/md';
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
import ProductionAreaSettingsSection from '../../components/kitchen/ProductionAreaSettingsSection';
import { useProductionAreaSettings } from '../../hooks/useProductionAreaSettings';
import { playNotificationSound, preloadNotificationSound, unlockNotificationAudio, onNotificationAudioUnlockChange } from '../../utils/playNotificationSound';

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

function localDateInputValue(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const HISTORY_DAYS = 15;

function historyDateRange() {
  const today = new Date();
  const oldest = new Date(today.getFullYear(), today.getMonth(), today.getDate() - HISTORY_DAYS);
  return { min: localDateInputValue(oldest), max: localDateInputValue(today) };
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

/** Comandas en orden de llegada (la más antigua primero), sin importar si es mesa, llevar o delivery. */
function sortByArrival(list) {
  const ts = (o) => parseApiDate(o?.created_at)?.getTime() ?? 0;
  return [...list].sort((a, b) => ts(a) - ts(b) || Number(a?.order_number || 0) - Number(b?.order_number || 0));
}

/** Misma altura para contadores y botones de la barra del área. */
const HEADER_BOX = 'h-[3.25rem] rounded-lg border border-[color:var(--ui-border)]';
const HEADER_BTN = 'shrink-0 px-3 inline-flex items-center gap-2 text-sm font-medium bg-[var(--ui-surface-2)] hover:bg-[var(--ui-sidebar-hover)] text-[var(--ui-body-text)]';

export default function KitchenPanel({ station, areaId: areaIdProp }) {
  const { t } = useTranslation('kitchen');
  const params = useParams();
  const areaId = String(params?.areaId || areaIdProp || station || 'cocina').trim() || 'cocina';
  const [orders, setOrders] = useState([]);
  const { user } = useAuth();
  useStaffSessionHeartbeat(user);
  useAppLocaleBootstrap();
  const [endShiftOpen, setEndShiftOpen] = useState(false);
  const [statusBusy, setStatusBusy] = useState({});
  const [highlightItemIds, setHighlightItemIds] = useState(() => new Set());
  const [clockTick, setClockTick] = useState(0);
  const overdueAlertedAtRef = useRef(new Map());
  const navigate = useNavigate();
  const location = useLocation();
  const emit = useSocketEmit();
  const isBar = areaId === 'bar';
  const isCocina = areaId === 'cocina';
  const usesItemLevelReady = isCocina;
  const printerModuleKey = areaId;
  const { loadConfig: reloadPrinterConfig } = usePrintingModule(printerModuleKey);
  const [printerModalOpen, setPrinterModalOpen] = useState(false);
  const {
    settings: areaSettings,
    loaded: areaSettingsLoaded,
    saving: areaSettingsSaving,
    save: saveAreaSettings,
    settingsRef: areaSettingsRef,
  } = useProductionAreaSettings(areaId, user, { onAutoDismissSaved: () => void loadOrders() });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyDate, setHistoryDate] = useState(() => localDateInputValue());
  const [historyOrders, setHistoryOrders] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [areaDisplayName, setAreaDisplayName] = useState('');
  const [soundReady, setSoundReady] = useState(false);
  const orderTableLabel = useCallback(
    (order) =>
      String(order?.table_display_label || '').trim() || t('panel.table', { number: order?.table_number }),
    [t],
  );
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

  const playAreaSound = (key, opts = {}) => {
    const s = areaSettingsRef.current;
    if (!s.notifyEnabled && !opts.force) return;
    playNotificationSound(isBar ? 'bar' : 'kitchen', key, { ...opts, volume: (s.notifyVolume ?? 100) / 100 });
  };

  const playDelayAlarm = (key) => {
    const s = areaSettingsRef.current;
    if (s.delayAlertEnabled === false) return;
    playNotificationSound('alert', key, { force: true, volume: (s.notifyVolume ?? 100) / 100 });
  };

  useEffect(() => {
    preloadNotificationSound(isBar ? 'bar' : 'kitchen');
  }, [isBar]);

  useEffect(() => {
    const unsub = onNotificationAudioUnlockChange((ready) => setSoundReady(Boolean(ready)));
    // Sonido activo al entrar a cocina/bar (Electron: autoplay libre; navegador: intenta ya).
    void unlockNotificationAudio();
    const unlock = () => {
      void unlockNotificationAudio();
    };
    window.addEventListener('pointerdown', unlock, { once: true, capture: true });
    window.addEventListener('keydown', unlock, { once: true, capture: true });
    window.addEventListener('touchstart', unlock, { once: true, capture: true });
    return () => {
      unsub();
      window.removeEventListener('pointerdown', unlock, { capture: true });
      window.removeEventListener('keydown', unlock, { capture: true });
      window.removeEventListener('touchstart', unlock, { capture: true });
    };
  }, []);

  const getStationItems = useCallback((items = []) => {
    const list = Array.isArray(items) ? items : [];
    return list.filter((it) => isBarProductionItemForStation(it, areaId));
  }, [areaId]);

  const loadOrders = async () => {
    try {
      const qs = new URLSearchParams();
      qs.set('station', areaId);
      const data = await api.get(`/orders/kitchen?${qs.toString()}`);
      setOrders(sortByArrival(Array.isArray(data) ? data : []));
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
  }, [areaId]);
  useActiveInterval(loadOrders, 10000);
  useEffect(() => {
    const id = setInterval(() => setClockTick((n) => n + 1), 15000);
    return () => clearInterval(id);
  }, []);

  const loadDispatchedHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set('station', areaId);
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
  }, [areaId, historyDate, t]);

  useEffect(() => {
    if (!historyOpen) return;
    void loadDispatchedHistory();
  }, [historyOpen, loadDispatchedHistory]);

  const openHistory = useCallback(() => {
    setHistoryDate(localDateInputValue());
    setHistoryOpen(true);
  }, []);
  const historyRange = historyOpen ? historyDateRange() : null;

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
  const preparingCount = visibleOrders.filter((order) => isComandaPreparingForStation(order)).length;

  const [dispatchedTodayCount, setDispatchedTodayCount] = useState(0);
  const loadDispatchedTodayCount = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ station: areaId, limit: '200' });
      const data = await api.get(`/orders/kitchen/dispatched?${qs.toString()}`);
      setDispatchedTodayCount(Array.isArray(data) ? data.length : 0);
    } catch (_) {
      /* el contador no bloquea el panel */
    }
  }, [areaId]);
  useEffect(() => {
    void loadDispatchedTodayCount();
  }, [loadDispatchedTodayCount]);
  useActiveInterval(loadDispatchedTodayCount, 30000);

  const prep = useProductionPrep(areaId);
  const titleInShell = location.pathname.startsWith('/admin');
  usePublishShellTitle(panelTitle, titleInShell);

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
          ? String(payloadOrder.table_display_label || order?.table_display_label || '').trim()
            || `Mesa ${String(payloadOrder.table_number).trim()}`
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
    playAreaSound(order?.id);
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
      playAreaSound(orderId);
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

  useSocket('station-auto-dismiss', (payload) => {
    if (String(payload?.areaId) !== String(areaId)) return;
    const order = payload?.order || payload;
    const table = order?.table_number;
    const num = order?.order_number;
    const minutes = payload?.minutes ?? areaSettings.autoDismissMinutes;
    const label = table
      ? t('barSettings.autoDismissTable', { table: orderTableLabel(order), minutes, station: stationLabel })
      : num != null
        ? t('barSettings.autoDismissOrder', { number: num, minutes, station: stationLabel })
        : t('barSettings.autoDismissGeneric', { minutes, station: stationLabel });
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
      if (status === 'ready') void loadDispatchedTodayCount();
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

  const delayMinutes = Number(areaSettings.delayAlertMinutes) || 0;
  const ARRIVAL_OVERDUE_MS = delayMinutes > 0 ? delayMinutes * 60000 : KITCHEN_ARRIVAL_OVERDUE_MS;
  const PREP_OVERDUE_MS = delayMinutes > 0 ? delayMinutes * 60000 : KITCHEN_PREP_OVERDUE_MS;

  const getOrderTimerAnchor = (order) => {
    return order?.kitchen_last_send_at || order?.created_at || getStationPreparingAt(order, areaId);
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

  const overdueMinutesLabel = Math.round(ARRIVAL_OVERDUE_MS / 60000);
  const getOverdueToastLabel = useCallback((order) => {
    const minutes = overdueMinutesLabel;
    if (order?.table_number && order?.type === 'dine_in') {
      return t('toast.overdueTable', { table: orderTableLabel(order), minutes });
    }
    if (order?.type === 'delivery') {
      return t('toast.overdueDelivery', { number: order.order_number, minutes });
    }
    return t('toast.overdueOrder', { number: order.order_number, minutes });
  }, [t, orderTableLabel, overdueMinutesLabel]);

  useEffect(() => {
    const activeOrders = orders.filter((order) => {
      if (isComandaDoneForStation(order)) return false;
      return getPendingStationItems(order.items).length > 0;
    });
    const overdueIds = new Set();
    const repeatMs = Math.max(0, Number(areaSettings.delayAlertRepeatMinutes) || 0) * 60000;
    const now = Date.now();
    const due = [];
    activeOrders.forEach((order) => {
      if (!isKitchenOrderOverdue(order)) return;
      overdueIds.add(order.id);
      const last = overdueAlertedAtRef.current.get(order.id);
      if (last == null) {
        due.push(order);
        overdueAlertedAtRef.current.set(order.id, now);
        toast.error(getOverdueToastLabel(order), { duration: 9000, icon: '⏱️', id: `overdue-${order.id}` });
      } else if (repeatMs > 0 && now - last >= repeatMs) {
        due.push(order);
        overdueAlertedAtRef.current.set(order.id, now);
      }
    });
    overdueAlertedAtRef.current.forEach((_, id) => {
      if (!overdueIds.has(id)) overdueAlertedAtRef.current.delete(id);
    });
    if (due.length) playDelayAlarm(`overdue-${due.map((o) => o.id).join(',')}-${now}`);
  }, [orders, clockTick, getOverdueToastLabel, isComandaDoneForStation, getPendingStationItems, areaSettings.delayAlertRepeatMinutes, areaSettings.delayAlertMinutes]);

  const typeIcons = { dine_in: MdTableBar, delivery: MdDeliveryDining, pickup: MdRestaurant };

  return (
    <div className="min-h-screen bg-[var(--ui-body-bg)] text-[var(--ui-body-text)]">
      {!soundReady && areaSettings.notifyEnabled ? (
        <button
          type="button"
          onClick={() => void unlockNotificationAudio()}
          className="w-full px-3 py-2 text-left text-sm font-medium bg-amber-500/15 text-amber-900 dark:text-amber-100 border-b border-amber-500/30 hover:bg-amber-500/25"
        >
          Toca aquí para activar el sonido de pedidos nuevos
        </button>
      ) : null}
      <header className="bg-[var(--ui-surface)] backdrop-blur-xl border-b border-[color:var(--ui-border)] px-3 py-2 sm:px-4 sm:py-3 lg:px-6 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
        <div className="grid grid-cols-3 gap-2 w-full min-w-0 lg:flex lg:w-auto lg:items-center lg:gap-3">
          {!titleInShell ? (
            <div className="col-span-3 flex items-center gap-2 min-w-0 lg:mr-1">
              <StationIcon className="text-2xl sm:text-3xl text-[var(--ui-body-text)] shrink-0" />
              <h1 className="text-base sm:text-xl font-bold truncate">{panelTitle}</h1>
            </div>
          ) : null}
          {[
            { key: 'active', label: t('panel.statActive'), value: visibleOrders.length, onClick: null },
            { key: 'preparing', label: t('panel.statPreparing'), value: preparingCount, onClick: null },
            { key: 'dispatched', label: t('panel.statDispatched'), value: dispatchedTodayCount, onClick: openHistory },
          ].map((s) => {
            const Tag = s.onClick ? 'button' : 'div';
            return (
              <Tag
                key={s.key}
                {...(s.onClick ? { type: 'button', onClick: s.onClick, title: t('history.button') } : {})}
                className={`${HEADER_BOX} w-full min-w-0 lg:w-auto lg:min-w-[6.5rem] px-3 flex flex-col justify-center bg-[var(--ui-surface-2)] text-left ${s.onClick ? 'hover:bg-[var(--ui-sidebar-hover)]' : ''}`}
              >
                <p className="text-[10px] sm:text-[11px] uppercase tracking-wide text-[var(--ui-muted)] leading-tight truncate">{s.label}</p>
                <p className="text-lg sm:text-xl font-bold tabular-nums text-[var(--ui-body-text)] leading-tight">{s.value}</p>
              </Tag>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 w-full min-w-0 lg:w-auto lg:flex-nowrap lg:gap-3">
          <ProductionPrepButton prep={prep} className={`${HEADER_BOX} flex-1 justify-center lg:flex-none`} />
          {areaSettings.autoDismissEnabled ? (
            <span className="text-[10px] uppercase tracking-wide text-[var(--ui-muted)]">
              {t('barSettings.badgeActive', { minutes: areaSettings.autoDismissMinutes })}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setPrinterModalOpen(true)}
            className={`${HEADER_BOX} ${HEADER_BTN}`}
            title={t('panel.printerSettings')}
            aria-label={t('panel.printerSettings')}
          >
            <MdSettings className="text-lg" />
            <span>{t('panel.printer')}</span>
          </button>
          {canReturnToAdmin && (
            <button
              type="button"
              onClick={() => navigate('/admin')}
              className={`${HEADER_BOX} shrink-0 px-3 inline-flex items-center gap-2 text-sm font-medium bg-[var(--ui-accent)] hover:bg-[var(--ui-accent-hover)] text-white`}
            >
              {t('panel.backToOps')}
            </button>
          )}
          {!titleInShell ? <NotificationCenter className="shrink-0" /> : null}
          {!titleInShell ? (
            <button
              type="button"
              onClick={() => navigate('/admin/perfil')}
              className={`${HEADER_BOX} ${HEADER_BTN}`}
              title="Mi perfil"
            >
              <MdPerson className="text-lg" />
              <span className="hidden sm:inline">Mi perfil</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setEndShiftOpen(true)}
            className={`${HEADER_BOX} ${HEADER_BTN}`}
          >
            <MdLogout className="text-lg" />
            <span className="whitespace-nowrap">{t('common:layout.endShift')}</span>
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
        printerTitle={t('barSettings.printerTitle')}
      >
        <ProductionAreaSettingsSection
          settings={areaSettings}
          loaded={areaSettingsLoaded}
          saving={areaSettingsSaving}
          onSave={saveAreaSettings}
          stationLabel={stationLabel}
          soundType={isBar ? 'bar' : 'kitchen'}
        />
      </PrinterModuleModal>
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
                min={historyRange?.min}
                max={historyRange?.max}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v || !historyRange) return;
                  if (v < historyRange.min) setHistoryDate(historyRange.min);
                  else if (v > historyRange.max) setHistoryDate(historyRange.max);
                  else setHistoryDate(v);
                }}
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
          <p className="text-xs text-[var(--ui-muted)]">{t('history.retentionHint', { days: HISTORY_DAYS })}</p>
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
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                        {cuentaCliente ? (
                          <span className="font-semibold truncate">{order.customer_name || t('panel.customer')}</span>
                        ) : order.type === 'delivery' ? (
                          <span className="font-semibold">{t('panel.delivery')} #{order.order_number}</span>
                        ) : (
                          <span className="font-semibold">#{order.order_number}</span>
                        )}
                        <TypeIcon className="text-lg shrink-0 text-[var(--ui-muted)]" />
                        {order.table_number ? (
                          <span className="text-xs px-2 py-0.5 rounded border border-[color:var(--ui-border)] max-w-full break-words">
                            {orderTableLabel(order)}
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
      <ProductionPrepBanner prep={prep} />
      <div className="p-3 sm:p-4 lg:p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 lg:gap-4">
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
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                      {order.type === 'delivery' ? (
                        <span className="text-lg font-bold tracking-tight text-[var(--ui-body-text)]">{t('panel.delivery')}</span>
                      ) : (
                        <span className="text-lg font-bold text-[var(--ui-body-text)]">#{order.order_number}</span>
                      )}
                      <TypeIcon className="text-xl shrink-0 text-[var(--ui-body-text)]" />
                      {order.table_number ? (
                        <span className={`${tableBadgeClass} max-w-full break-words font-semibold leading-tight`}>
                          {orderTableLabel(order)}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1 pt-1 text-sm">
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
                      className="flex-1 min-h-[2.5rem] py-2.5 bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] hover:from-[#1D4ED8] hover:to-[#1E40AF] disabled:opacity-50 disabled:pointer-events-none rounded-lg font-bold text-sm text-white transition-all flex items-center justify-center gap-2"
                    >
                      <StationIcon /> {t('panel.prepare')}
                    </button>
                  ) : canShowReadyAction(order) ? (
                    <button
                      type="button"
                      disabled={Boolean(statusBusy[order.id])}
                      onClick={() => void updateStatus(order.id, 'ready')}
                      className="flex-1 min-h-[2.5rem] py-2.5 bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-50 disabled:pointer-events-none rounded-lg font-bold text-sm text-white transition-colors flex items-center justify-center gap-2"
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
