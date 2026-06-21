import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ORDER_TYPES, formatTime, parseApiDate } from '../../utils/api';
import { getKitchenOrderNotesDisplay } from '../../utils/reservationKitchenNotes';
import { useSocket, useSocketEmit } from '../../hooks/useSocket';
import { useActiveInterval } from '../../hooks/useActiveInterval';
import { useAuth } from '../../context/AuthContext';
import { useAppLocaleBootstrap } from '../../hooks/useAppLocaleBootstrap';
import EndShiftModal from '../../components/EndShiftModal';
import { MdKitchen, MdLocalBar, MdLogout, MdRestaurant, MdDeliveryDining, MdTableBar, MdCheckCircle, MdAccessTime, MdPrint } from 'react-icons/md';
import toast from 'react-hot-toast';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  orderHasTakeoutNote,
  buildPedidoMesaTicketPlainText,
  normalizeThermalPaperWidthMm,
} from '../../utils/ticketPlainText';
import { isBarProductionItemForStation, isKitchenProductionItemForStation } from '../../utils/productionArea';
import { useShowDeliveryUi } from '../../hooks/useDeliveryEnabled';

/** Pedido auto-pedido con cuenta de cliente (sin mesa física). */
function isCuentaClienteSelfOrder(order) {
  return String(order?.table_number || '') === 'Cliente' && String(order?.customer_id || '').trim() !== '';
}

const normalizePaperWidthMm = normalizeThermalPaperWidthMm;

export default function KitchenPanel({ station = 'cocina' }) {
  const { t } = useTranslation('kitchen');
  const [orders, setOrders] = useState([]);
  const [filter, setFilter] = useState('all');
  const showDeliveryUi = useShowDeliveryUi();
  const { user } = useAuth();
  useAppLocaleBootstrap();
  const [endShiftOpen, setEndShiftOpen] = useState(false);
  const [statusBusy, setStatusBusy] = useState({});
  const navigate = useNavigate();
  const location = useLocation();
  const emit = useSocketEmit();
  const isBar = station === 'bar';
  const StationIcon = isBar ? MdLocalBar : MdKitchen;
  const panelTitle = isBar ? t('panel.barTitle') : t('panel.kitchenTitle');
  const stationLabel = isBar ? t('panel.stationBar') : t('panel.stationKitchen');
  const canReturnToAdmin = user?.role === 'admin' && !location.pathname.startsWith('/admin');

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
    if (!showDeliveryUi && filter === 'delivery') setFilter('all');
  }, [showDeliveryUi, filter]);

  const loadOrders = async () => {
    try {
      const qs = new URLSearchParams();
      if (filter !== 'all') qs.set('type', filter);
      qs.set('station', station);
      setOrders(await api.get(`/orders/kitchen?${qs.toString()}`));
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
  }, [filter, station]);
  useActiveInterval(loadOrders, 10000);

  const getStationItems = (items = []) => {
    const list = Array.isArray(items) ? items : [];
    return isBar
      ? list.filter(isBarProductionItemForStation)
      : list.filter(isKitchenProductionItemForStation);
  };

  const isComandaDoneForStation = useCallback((order) => {
    const at = isBar ? order?.station_bar_ready_at : order?.station_cocina_ready_at;
    return Boolean(String(at || '').trim());
  }, [isBar]);

  const isComandaPreparingForStation = useCallback((order) => {
    const at = isBar ? order?.station_bar_preparing_at : order?.station_cocina_preparing_at;
    return Boolean(String(at || '').trim());
  }, [isBar]);

  const visibleOrders = orders.filter((order) => {
    if (isComandaDoneForStation(order)) return false;
    return getStationItems(order.items).length > 0;
  });

  const printOrderForStation = async (order, { silent = false } = {}) => {
    try {
      const moduleKey = isBar ? 'bar' : 'cocina';
      let payloadOrder = order || {};
      let items = getStationItems(payloadOrder?.items || []);
      if (!items.length && payloadOrder?.id) {
        const full = await api.get(`/orders/${payloadOrder.id}`);
        payloadOrder = full || payloadOrder;
        items = getStationItems(payloadOrder?.items || []);
      }
      if (!items.length) {
        if (!silent) toast.error(t('toast.noItems', { station: stationLabel }));
        return false;
      }
      const cfg = await api.printing.get('/printing/config');
      const paper = normalizePaperWidthMm(
        isBar ? cfg?.bar?.anchoPapel ?? cfg?.bar?.paperWidth : cfg?.cocina?.anchoPapel ?? cfg?.cocina?.paperWidth,
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

  const handleKitchenIncomingOrder = (order, toastLabel) => {
    loadOrders();
    playStationAlert();
    const num = order?.order_number;
    toast.success(
      num != null
        ? t('toast.newOrderNumber', { number: num, station: stationLabel })
        : toastLabel,
      { icon: '🔔', duration: 5000 }
    );
  };

  useSocket('new-order', (order) => handleKitchenIncomingOrder(order, t('toast.newOrder')));
  /** Mesa/salón: ítems nuevos van por PUT /orders/:id/lines — antes no había evento para imprimir en cocina. */
  useSocket('order-lines-updated', (order) => handleKitchenIncomingOrder(order, t('toast.orderUpdated')));

  useSocket('order-update', () => loadOrders());

  const canShowPrepareAction = useCallback(
    (order) => !isComandaDoneForStation(order) && !isComandaPreparingForStation(order),
    [isComandaDoneForStation, isComandaPreparingForStation],
  );
  const canShowReadyAction = useCallback(
    (order) => !isComandaDoneForStation(order) && isComandaPreparingForStation(order),
    [isComandaDoneForStation, isComandaPreparingForStation],
  );

  const updateStatus = async (orderId, status) => {
    if (statusBusy[orderId]) return;
    const current = orders.find((o) => o.id === orderId);
    if (status === 'preparing' && !canShowPrepareAction(current)) {
      void loadOrders();
      return;
    }
    if (status === 'ready' && !canShowReadyAction(current)) {
      void loadOrders();
      return;
    }
    setStatusBusy((prev) => ({ ...prev, [orderId]: true }));
    try {
      const qs = new URLSearchParams({ station });
      await api.put(`/orders/${orderId}/status?${qs.toString()}`, { status, station });
      if (status === 'ready') {
        setOrders((prev) => prev.filter((o) => o.id !== orderId));
      } else {
        const prepField = isBar ? 'station_bar_preparing_at' : 'station_cocina_preparing_at';
        const readyField = isBar ? 'station_bar_ready_at' : 'station_cocina_ready_at';
        const nowIso = new Date().toISOString();
        setOrders((prev) =>
          prev.map((o) =>
            o.id === orderId
              ? {
                  ...o,
                  status: o.status === 'pending' ? 'preparing' : o.status,
                  [prepField]: nowIso,
                  [readyField]: null,
                }
              : o,
          ),
        );
      }
      toast.success(status === 'preparing' ? t('toast.preparing') : t('toast.markedReady'));
      void loadOrders();
    } catch (err) {
      toast.error(err.message);
      void loadOrders();
    } finally {
      setStatusBusy((prev) => {
        const next = { ...prev };
        delete next[orderId];
        return next;
      });
    }
  };

  const ARRIVAL_OVERDUE_MS = 15 * 60 * 1000;
  const PREP_OVERDUE_MS = 25 * 60 * 1000;

  const getOrderTimerAnchor = (order) => {
    const stationPrep = isBar ? order?.station_bar_preparing_at : order?.station_cocina_preparing_at;
    if (String(stationPrep || '').trim()) return stationPrep;
    return order?.created_at;
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

  const typeIcons = { dine_in: MdTableBar, delivery: MdDeliveryDining, pickup: MdRestaurant };

  return (
    <div className="min-h-screen bg-[var(--ui-body-bg)] text-[var(--ui-body-text)]">
      <header className="bg-[var(--ui-surface)] backdrop-blur-xl border-b border-[color:var(--ui-border)] px-6 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <StationIcon className="text-3xl text-[var(--ui-body-text)]" />
          <div>
            <h1 className="text-xl font-bold">{panelTitle}</h1>
            <p className="text-[var(--ui-muted)] text-sm">
              {t('panel.activeOrders', { count: visibleOrders.length })}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
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
      <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {visibleOrders.map(order => {
          const TypeIcon = typeIcons[order.type] || MdRestaurant;
          const isOverdue = isKitchenOrderOverdue(order);

          const cuentaCliente = isCuentaClienteSelfOrder(order);
          const stationPending = !isComandaPreparingForStation(order);
          const cardBorder = isOverdue
            ? stationPending
              ? 'border-2 border-red-500 shadow-[0_0_24px_rgba(239,68,68,0.22)]'
              : 'border-2 border-red-500/75'
            : stationPending
              ? 'border-2 border-[color:color-mix(in_srgb,var(--ui-accent-muted)_55%,transparent)]'
              : 'border border-[color:var(--ui-border)]';
          const cardBg = 'bg-[var(--ui-surface)]';
          const headerBg = isOverdue
            ? stationPending
              ? 'bg-red-950/55'
              : 'bg-red-950/40'
            : stationPending
              ? 'bg-[var(--ui-sidebar-active-bg)]'
              : 'bg-[var(--ui-surface-2)]';

          return (
            <div key={order.id} className={`rounded-xl overflow-hidden backdrop-blur-xl ${cardBg} ${cardBorder} ${isOverdue ? 'ring-2 ring-red-500/45' : ''}`}>
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
                      <MdAccessTime className={isOverdue ? 'text-red-400' : 'text-[var(--ui-muted)]'} />
                      <span className={isOverdue ? 'font-bold text-red-300' : 'text-[var(--ui-muted)]'}>{getTimeDiff(order)}</span>
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
                        <span className="rounded border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] px-2 py-0.5 text-sm text-[var(--ui-body-text)]">{t('panel.table', { number: order.table_number })}</span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1 text-sm">
                      <MdAccessTime className={isOverdue ? 'text-red-400' : 'text-[var(--ui-muted)]'} />
                      <span className={isOverdue ? 'font-bold text-red-300' : 'text-[var(--ui-muted)]'}>{getTimeDiff(order)}</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2 px-4 py-3">
                {getStationItems(order.items).map(item => (
                  <div key={item.id} className="flex items-start gap-2">
                    <span className="bg-[var(--ui-surface-2)] border border-[color:var(--ui-border)] text-[var(--ui-body-text)] w-6 h-6 rounded flex items-center justify-center text-sm font-bold flex-shrink-0">{item.quantity}</span>
                    <div className="flex-1">
                      <p className="font-medium text-sm text-[var(--ui-body-text)]">{item.product_name}</p>
                      {item.variant_name && <p className="text-xs text-[var(--ui-muted)]">{item.variant_name}</p>}
                      {item.notes && <p className="text-xs text-[var(--ui-muted)] italic">{item.notes}</p>}
                    </div>
                  </div>
                ))}
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
