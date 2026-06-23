import { useState, useEffect, useMemo, useCallback } from 'react';
import { api, formatCurrency, formatDate, labelDeliveryPaymentModality } from '../../utils/api';
import { useSocket } from '../../hooks/useSocket';
import { useActiveInterval } from '../../hooks/useActiveInterval';
import { useAuth } from '../../context/AuthContext';
import { useAppLocaleBootstrap } from '../../hooks/useAppLocaleBootstrap';
import useStaffSessionHeartbeat from '../../hooks/useStaffSessionHeartbeat';
import EndShiftModal from '../../components/EndShiftModal';
import NotificationCenter from '../../components/NotificationCenter';
import Modal from '../../components/Modal';
import toast from 'react-hot-toast';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  MdDeliveryDining,
  MdLogout,
  MdPhone,
  MdLocationOn,
  MdAccessTime,
  MdMap,
} from 'react-icons/md';
import { buildGoogleMapsSearchUrl } from '../../utils/googleMaps';

function parseApiDateLike(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const withZ = /Z$|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}Z`;
  const d = new Date(withZ);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isSameLocalCalendarDay(dateValue, ref = new Date()) {
  const d = parseApiDateLike(dateValue);
  if (!d) return false;
  return (
    d.getFullYear() === ref.getFullYear() &&
    d.getMonth() === ref.getMonth() &&
    d.getDate() === ref.getDate()
  );
}

function getTimeDiffShort(created) {
  const d = parseApiDateLike(created);
  if (!d) return '—';
  const diff = Math.floor((Date.now() - d.getTime()) / 60000);
  if (!Number.isFinite(diff) || diff < 1) return 'Ahora';
  if (diff < 60) return `${diff} min`;
  return `${Math.floor(diff / 60)}h ${diff % 60}m`;
}

function todayLocalYyyyMmDd() {
  const t = new Date();
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, '0');
  const d = String(t.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const TAB_KEYS = { activos: 'activos', proceso: 'proceso', completados: 'completados' };

export default function DeliveryPanel() {
  const [orders, setOrders] = useState([]);
  const [tab, setTab] = useState(TAB_KEYS.activos);
  const { user } = useAuth();
  useStaffSessionHeartbeat(user);
  useAppLocaleBootstrap();
  const [endShiftOpen, setEndShiftOpen] = useState(false);
  const [reportGateOpen, setReportGateOpen] = useState(false);
  const [restaurantAddress, setRestaurantAddress] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const canReturnToAdmin = user?.role === 'admin' && !location.pathname.startsWith('/admin');

  const loadData = useCallback(async () => {
    try {
      const data = await api.get('/orders?limit=500');
      setOrders(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);
  useEffect(() => {
    api.get('/restaurant').then((r) => setRestaurantAddress(String(r?.address || '').trim())).catch(() => {});
  }, []);
  useActiveInterval(loadData, 10000);

  useSocket('new-order', loadData);
  useSocket('order-update', loadData);
  useSocket('delivery-update', loadData);

  const uid = String(user?.id || '');

  const { activos, enProceso, completadosHoy } = useMemo(() => {
    const list = orders || [];
    const a = [];
    const p = [];
    const c = [];
    for (const o of list) {
      const started = String(o.delivery_driver_started_at || '').trim();
      const completed = String(o.delivery_driver_completed_at || '').trim();
      const routeDriver = String(o.delivery_route_driver_id || '');
      const unpaid = String(o.payment_status || '') !== 'paid';

      if (completed && routeDriver === uid && isSameLocalCalendarDay(completed)) {
        c.push(o);
        continue;
      }
      if (started && !completed && routeDriver === uid) {
        p.push(o);
        continue;
      }
      if (unpaid && !completed && (!started || routeDriver === uid)) {
        if (!started) {
          a.push(o);
        }
      }
    }
    const sortCreatedDesc = (x, y) => String(y.created_at || '').localeCompare(String(x.created_at || ''));
    const sortCompletedDesc = (x, y) =>
      String(y.delivery_driver_completed_at || '').localeCompare(String(x.delivery_driver_completed_at || ''));
    a.sort(sortCreatedDesc);
    p.sort(sortCreatedDesc);
    c.sort(sortCompletedDesc);
    return { activos: a, enProceso: p, completadosHoy: c };
  }, [orders, uid]);

  const driverAction = async (orderId, action) => {
    try {
      await api.post(`/orders/${orderId}/delivery-driver-action`, { action });
      toast.success(action === 'start' ? 'Pedido en proceso' : 'Pedido completado');
      loadData();
    } catch (err) {
      toast.error(err.message || 'No se pudo actualizar');
    }
  };

  const openEndShiftFlow = () => {
    setReportGateOpen(true);
  };

  const continueToLogoutModal = () => {
    setReportGateOpen(false);
    setEndShiftOpen(true);
  };

  const renderCard = (o, { showIniciar, showListo }) => {
    const mapsUrl = buildGoogleMapsSearchUrl(o.delivery_address, { restaurantAddress });
    return (
    <div
      key={o.id}
      className="rounded-2xl overflow-hidden bg-[var(--ui-surface)] border border-[color:var(--ui-border)] shadow-md min-h-0 w-full"
    >
      <div className="px-3.5 py-3 sm:px-4 sm:py-3.5 flex items-center justify-between gap-2 border-b border-[color:var(--ui-border)] bg-[var(--ui-surface-2)]">
        <span className="font-bold text-[var(--ui-body-text)] text-base sm:text-lg tabular-nums">#{o.order_number}</span>
        <div className="flex items-center gap-1 text-sm text-[var(--ui-muted)] shrink-0">
          <MdAccessTime className="text-lg" />
          <span>{getTimeDiffShort(o.created_at)}</span>
        </div>
      </div>
      <div className="px-3.5 py-3 sm:px-4 sm:py-4 space-y-2.5 text-base">
        <div className="flex items-start gap-2">
          <MdLocationOn className="text-[var(--ui-accent-muted)] mt-0.5 shrink-0 text-xl" />
          <div className="min-w-0 flex-1">
            <p className="text-[var(--ui-body-text)] leading-snug text-[15px] sm:text-base break-words">
              {o.delivery_address || 'Sin dirección'}
            </p>
            {mapsUrl ? (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center justify-center gap-1.5 w-full min-h-[44px] px-3 py-2 rounded-xl text-sm font-semibold bg-[var(--ui-sidebar-active-bg)] text-[var(--ui-accent-hover)] border border-[color:var(--ui-border)] hover:bg-[var(--ui-sidebar-hover)] active:opacity-90 touch-manipulation"
              >
                <MdMap className="text-lg shrink-0" />
                Abrir en Google Maps
              </a>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <MdPhone className="text-[var(--ui-accent-muted)] shrink-0 text-xl" />
          <p className="text-[var(--ui-body-text)] font-semibold">{o.customer_name || 'Cliente'}</p>
        </div>
        <p className="text-[var(--ui-accent-muted)] font-bold text-lg">{formatCurrency(o.total)}</p>
        <p className="text-sm text-[var(--ui-body-text)]">
          <span className="text-[var(--ui-muted)]">Modalidad de pago:</span>{' '}
          <span className="font-semibold text-[var(--ui-accent-hover)]">{labelDeliveryPaymentModality(o.delivery_payment_modality) || '—'}</span>
        </p>
        {o.notes ? (
          <p className="text-sm text-[var(--ui-muted)] bg-[var(--ui-surface-2)] rounded-xl px-3 py-2 border border-[color:var(--ui-border)]">
            {o.notes}
          </p>
        ) : null}
        {o.items && o.items.length > 0 ? (
          <div className="pt-2 border-t border-[color:var(--ui-border)]">
            <p className="text-xs uppercase tracking-wide text-[var(--ui-muted)] mb-1.5 font-semibold">Productos</p>
            {o.items.map((it) => (
              <p key={it.id} className="text-sm text-[var(--ui-body-text)] leading-relaxed">
                {it.quantity}× {it.product_name}
              </p>
            ))}
          </div>
        ) : null}
      </div>
      {(showIniciar || showListo) && (
        <div className="px-3.5 py-3 sm:px-4 border-t border-[color:var(--ui-border)]">
          {showIniciar && (
            <button
              type="button"
              onClick={() => driverAction(o.id, 'start')}
              className="w-full min-h-[48px] py-3 rounded-xl font-bold text-base bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] text-white active:opacity-90 touch-manipulation"
            >
              INICIAR
            </button>
          )}
          {showListo && (
            <button
              type="button"
              onClick={() => driverAction(o.id, 'complete')}
              className="w-full min-h-[48px] py-3 rounded-xl font-bold text-base bg-emerald-600 hover:bg-emerald-500 text-white active:opacity-90 touch-manipulation"
            >
              LISTO
            </button>
          )}
        </div>
      )}
    </div>
    );
  };

  const displayedOrders =
    tab === TAB_KEYS.activos ? activos : tab === TAB_KEYS.proceso ? enProceso : completadosHoy;

  const tabCount = (k) =>
    k === TAB_KEYS.activos ? activos.length : k === TAB_KEYS.proceso ? enProceso.length : completadosHoy.length;

  const tabButton = (key, label, position) => {
    const selected = tab === key;
    const rounded =
      position === 'left' ? 'rounded-l-2xl' : position === 'right' ? 'rounded-r-2xl' : '';
    return (
      <button
        type="button"
        onClick={() => setTab(key)}
        className={`flex-1 min-h-[56px] sm:min-h-[60px] px-1 sm:px-2 py-2 text-center font-bold text-[11px] sm:text-sm leading-snug touch-manipulation transition-colors ${rounded} ${
          selected
            ? 'bg-[var(--ui-accent)] text-white shadow-inner z-10'
            : 'bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]'
        }`}
      >
        <span className="block hyphens-auto">{label}</span>
        <span className={`block text-[10px] sm:text-xs font-semibold mt-1 ${selected ? 'text-white/90' : 'text-[var(--ui-muted)]'}`}>
          ({tabCount(key)})
        </span>
      </button>
    );
  };

  return (
    <div className="min-h-screen min-h-[100dvh] bg-[var(--ui-body-bg)] text-[var(--ui-body-text)] pb-safe pb-28">
      <header className="sticky top-0 z-30 bg-[var(--ui-surface)] backdrop-blur-md border-b border-[color:var(--ui-border)] px-3 sm:px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <div className="flex flex-col gap-3 max-w-lg mx-auto w-full">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <MdDeliveryDining className="text-3xl sm:text-4xl text-[var(--ui-accent-muted)] shrink-0" />
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold leading-tight truncate">Panel de Delivery</h1>
                <p className="text-sm text-[var(--ui-muted)] truncate mt-0.5">
                  {user?.username || user?.full_name} · {activos.length + enProceso.length} en bandeja
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0 pt-0.5">
              <NotificationCenter />
            </div>
          </div>

          <div className="flex w-full shadow-lg rounded-2xl overflow-hidden ring-1 ring-[color:var(--ui-border)] divide-x divide-[color:var(--ui-border)]">
            {tabButton(TAB_KEYS.activos, 'Activos', 'left')}
            {tabButton(TAB_KEYS.proceso, 'En ruta', 'middle')}
            {tabButton(TAB_KEYS.completados, 'Hoy', 'right')}
          </div>
          <p className="text-[11px] sm:text-xs text-center text-[var(--ui-muted)] -mt-1 px-1">
            Lista ordenada: los más recientes arriba; los más antiguos abajo en la cuadrícula.
          </p>

          <div className="flex flex-wrap gap-2">
            {canReturnToAdmin && (
              <button
                type="button"
                onClick={() => navigate('/admin')}
                className="flex-1 min-w-[10rem] min-h-[44px] px-3 py-2.5 bg-[var(--ui-accent)] rounded-xl text-white text-sm font-semibold border border-[color:var(--ui-border)] touch-manipulation"
              >
                Centro operativo
              </button>
            )}
            <button
              type="button"
              onClick={openEndShiftFlow}
              className="flex-1 min-w-[10rem] min-h-[44px] px-3 py-2.5 rounded-xl text-[var(--ui-body-text)] text-sm font-semibold border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] hover:bg-[var(--ui-sidebar-hover)] inline-flex items-center justify-center gap-2 touch-manipulation"
            >
              <MdLogout className="text-xl shrink-0" /> Finalizar jornada
            </button>
          </div>
        </div>
      </header>

      <main className="px-3 sm:px-4 pt-4 pb-6 max-w-lg mx-auto w-full">
        <p className="text-center text-base text-[var(--ui-muted)] mb-4">
          Fecha del día:{' '}
          <span className="text-[var(--ui-body-text)] font-bold">{formatDate(todayLocalYyyyMmDd())}</span>
        </p>

        {displayedOrders.length === 0 ? (
          <p className="text-base text-[var(--ui-muted)] py-12 text-center border-2 border-dashed border-[color:var(--ui-border)] rounded-2xl">
            {tab === TAB_KEYS.activos && 'No hay pedidos activos'}
            {tab === TAB_KEYS.proceso && 'No hay pedidos en proceso'}
            {tab === TAB_KEYS.completados && 'No hay pedidos completados hoy'}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {displayedOrders.map((o) =>
              renderCard(o, {
                showIniciar: tab === TAB_KEYS.activos,
                showListo: tab === TAB_KEYS.proceso,
              })
            )}
          </div>
        )}
      </main>

      <Modal
        isOpen={reportGateOpen}
        onClose={() => setReportGateOpen(false)}
        title="Antes de finalizar la jornada"
        size="md"
        headerClassName="bg-[var(--ui-surface)] border-b border-[color:var(--ui-border)]"
        titleClassName="text-[var(--ui-body-text)] font-bold"
      >
        <p className="text-sm text-[var(--ui-muted)] mb-3">
          Revise sus pedidos completados de hoy en ruta (cliente, pedido y costo). El cobro en caja es independiente de este registro.
        </p>
        <p className="text-xs text-[var(--ui-muted)] mb-2">
          Completados hoy: <span className="text-[var(--ui-body-text)] font-semibold">{completadosHoy.length}</span>
        </p>
        <div className="flex flex-col-reverse sm:flex-row gap-2 justify-end">
          <button
            type="button"
            onClick={() => setReportGateOpen(false)}
            className="px-4 py-2 rounded-lg border border-[color:var(--ui-border)] text-sm text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={continueToLogoutModal}
            className="px-4 py-2 rounded-lg bg-[var(--ui-accent)] text-white text-sm font-medium hover:bg-[var(--ui-accent-hover)]"
          >
            Continuar al cierre de sesión
          </button>
        </div>
      </Modal>

      <EndShiftModal isOpen={endShiftOpen} onClose={() => setEndShiftOpen(false)} />
    </div>
  );
}
