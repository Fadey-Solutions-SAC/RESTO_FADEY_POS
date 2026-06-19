import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api, resolveMediaUrl } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../hooks/useSocket';
import { getOperationalNotificationQuickLinks } from '../utils/staffModuleAccess';
import StaffTeamChat from './StaffTeamChat';
import Modal from './Modal';
import { MdNotificationsNone, MdClose, MdChat, MdCampaign, MdDelete, MdSpeed } from 'react-icons/md';
import { PAGO_USO_SUBIR_COMPROBANTE_AVISO_TITLE } from '../constants/masterNotifications';

const DISMISSED_AVISOS_STORAGE_KEY = 'admin_avisos_descartados_v1';

function loadDismissedAvisoIds() {
  try {
    const raw = localStorage.getItem(DISMISSED_AVISOS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function saveDismissedAvisoIds(ids) {
  localStorage.setItem(DISMISSED_AVISOS_STORAGE_KEY, JSON.stringify([...new Set(ids.map(String))]));
}

/**
 * Campana de notificaciones: chat del equipo, avisos del maestro y pestaña Operación (alertas en vivo desde reportes).
 */
export default function NotificationCenter({ className = '' }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('chat');
  const [unreadChat, setUnreadChat] = useState(0);
  const [adminNotifications, setAdminNotifications] = useState([]);
  const [dismissedAvisoIds, setDismissedAvisoIds] = useState(loadDismissedAvisoIds);
  const [avisoToDismiss, setAvisoToDismiss] = useState(null);

  /** Avisos del maestro: visibles para todo el personal; el aviso de «pago por uso» solo admin / maestro. */
  const showAvisosTab = Boolean(user);
  const seesPagoUsoAviso = user?.role === 'admin' || user?.role === 'master_admin';
  const showOperacionTab = ['admin', 'cajero', 'mozo', 'master_admin', 'delivery'].includes(user?.role);

  const operacionQuickLinks = useMemo(() => getOperationalNotificationQuickLinks(user), [user]);

  const [operationalPayload, setOperationalPayload] = useState(undefined);

  const loadOperationalAlerts = useCallback(() => {
    if (!showOperacionTab) return;
    api
      .get('/reports/operational-alerts')
      .then((data) => setOperationalPayload(data && typeof data === 'object' ? data : {}))
      .catch(() =>
        setOperationalPayload({
          alerts: [],
          summary: {},
          insightToday: '',
          generated_at: null,
        })
      );
  }, [showOperacionTab]);

  useEffect(() => {
    if (!showOperacionTab) return undefined;
    loadOperationalAlerts();
    const interval = setInterval(loadOperationalAlerts, 20000);
    return () => clearInterval(interval);
  }, [showOperacionTab, loadOperationalAlerts]);

  useSocket('order-update', loadOperationalAlerts);
  useSocket('table-update', loadOperationalAlerts);
  useSocket('delivery-update', loadOperationalAlerts);
  useSocket('register-update', loadOperationalAlerts);
  useSocket('inventory-update', loadOperationalAlerts);
  useSocket('billing-document-update', loadOperationalAlerts);
  useSocket('staff-data-update', (p) => {
    const d = p?.domain;
    if (d === 'catalog' || d === 'app_config' || d === 'finance_ops' || d === 'reservations') loadOperationalAlerts();
  });
  useSocket('reservation-reminder', () => {
    loadOperationalAlerts();
  });

  const operationalWarnings = useMemo(() => {
    const list = Array.isArray(operationalPayload?.alerts) ? operationalPayload.alerts : [];
    return list.filter((a) => a?.severity === 'warning').length;
  }, [operationalPayload]);

  const visibleAdminNotifications = useMemo(() => {
    let list = adminNotifications.filter((n) => !dismissedAvisoIds.includes(String(n.id)));
    if (!seesPagoUsoAviso) {
      list = list.filter((n) => n.title !== PAGO_USO_SUBIR_COMPROBANTE_AVISO_TITLE);
    }
    return list;
  }, [adminNotifications, dismissedAvisoIds, seesPagoUsoAviso]);

  useEffect(() => {
    if (!showAvisosTab) setTab('chat');
  }, [showAvisosTab]);

  useEffect(() => {
    if (!showOperacionTab && tab === 'operacion') setTab('chat');
  }, [showOperacionTab, tab]);

  useEffect(() => {
    if (!showAvisosTab) return;
    const load = () => {
      api.get('/master-admin/admin-notifications')
        .then((data) => setAdminNotifications(Array.isArray(data) ? data : []))
        .catch(() => setAdminNotifications([]));
    };
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [showAvisosTab]);

  const onUnreadDelta = useCallback((n) => {
    setUnreadChat((u) => u + n);
  }, []);

  useEffect(() => {
    if (open && tab === 'chat') {
      setUnreadChat(0);
    }
  }, [open, tab]);

  const confirmDismissAviso = () => {
    if (!avisoToDismiss?.id) return;
    const id = String(avisoToDismiss.id);
    const next = [...new Set([...dismissedAvisoIds, id])];
    setDismissedAvisoIds(next);
    saveDismissedAvisoIds(next);
    setAvisoToDismiss(null);
  };

  const totalBadge =
    unreadChat +
    (showAvisosTab ? visibleAdminNotifications.length : 0) +
    (showOperacionTab ? operationalWarnings : 0);

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => {
          setOpen((p) => {
            const next = !p;
            if (next && showOperacionTab) loadOperationalAlerts();
            return next;
          });
          if (!open) setTab('chat');
        }}
        className="p-2 hover:bg-[var(--ui-sidebar-hover)] rounded-lg transition-colors relative"
        title="Mensajes y notificaciones"
        aria-expanded={open}
      >
        <MdNotificationsNone className="text-xl text-[var(--ui-body-text)]" />
        {totalBadge > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-bold bg-[#EF4444] text-white rounded-full">
            {totalBadge > 99 ? '99+' : totalBadge}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[55]" onClick={() => setOpen(false)} aria-hidden />
          <div
            className="fixed z-[60] top-14 right-3 sm:right-6 w-[min(100vw-1.5rem,420px)] h-[min(72vh,580px)] flex flex-col rounded-2xl border border-[color:var(--ui-border)] bg-[var(--ui-surface)] shadow-2xl overflow-hidden text-[var(--ui-body-text)]"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Centro de mensajes"
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-[color:var(--ui-border)] bg-[var(--ui-surface-2)]">
              {showAvisosTab ? (
                <div className="flex flex-wrap rounded-lg bg-[var(--ui-body-bg)] p-0.5 gap-0.5 border border-[color:var(--ui-border)] max-w-[min(100%,340px)]">
                  <button
                    type="button"
                    onClick={() => setTab('chat')}
                    className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-medium ${
                      tab === 'chat' ? 'bg-[var(--ui-accent)] text-white' : 'text-[var(--ui-muted)] hover:text-[var(--ui-body-text)]'
                    }`}
                  >
                    <MdChat className="text-base shrink-0" /> Mensajes
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab('avisos')}
                    className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-medium ${
                      tab === 'avisos' ? 'bg-[var(--ui-accent)] text-white' : 'text-[var(--ui-muted)] hover:text-[var(--ui-body-text)]'
                    }`}
                  >
                    <MdCampaign className="text-base shrink-0" /> Avisos
                    {visibleAdminNotifications.length > 0 && (
                      <span className="bg-red-500 text-white text-[10px] px-1.5 rounded-full">{visibleAdminNotifications.length}</span>
                    )}
                  </button>
                  {showOperacionTab ? (
                    <button
                      type="button"
                      onClick={() => setTab('operacion')}
                      className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-medium ${
                        tab === 'operacion' ? 'bg-[var(--ui-accent)] text-white' : 'text-[var(--ui-muted)] hover:text-[var(--ui-body-text)]'
                      }`}
                    >
                      <MdSpeed className="text-base shrink-0" /> Operación
                      {operationalPayload?.alerts?.length > 0 && (
                        <span
                          className={`text-[10px] px-1.5 rounded-full font-semibold ${
                            operationalWarnings > 0 ? 'bg-amber-500 text-white' : 'bg-[var(--ui-accent-muted)]/30 text-[var(--ui-body-text)]'
                          }`}
                        >
                          {operationalPayload.alerts.length}
                        </span>
                      )}
                    </button>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm font-semibold text-[var(--ui-body-text)] flex items-center gap-2">
                  <MdChat className="text-lg text-[var(--ui-accent)]" /> Mensajes del equipo
                </p>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg hover:bg-[var(--ui-sidebar-hover)] text-[var(--ui-muted)]"
                aria-label="Cerrar"
              >
                <MdClose className="text-lg" />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-hidden flex flex-col p-3">
              {tab === 'chat' && (
                <StaffTeamChat isActive={open && tab === 'chat'} onUnreadDelta={onUnreadDelta} />
              )}
              {tab === 'avisos' && showAvisosTab && (
                <div className="h-full overflow-y-auto space-y-2">
                  {visibleAdminNotifications.length === 0 ? (
                    <p className="text-sm text-[var(--ui-muted)] text-center py-8">Sin avisos del sistema.</p>
                  ) : (
                    visibleAdminNotifications.slice(0, 15).map((n) => (
                      <div key={n.id} className="rounded-xl border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] p-3 overflow-hidden">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-semibold text-[var(--ui-body-text)] pr-2 flex-1 min-w-0 select-none cursor-default">
                            {n.title}
                          </p>
                          <button
                            type="button"
                            onClick={() => setAvisoToDismiss(n)}
                            className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-red-950/60 hover:bg-red-900/70 text-red-200 border border-red-800/50"
                            aria-label="Quitar aviso de la lista"
                          >
                            <MdDelete className="text-sm" />
                            Quitar
                          </button>
                        </div>
                        <p className="text-[10px] text-[var(--ui-muted)] mt-1">{new Date(n.created_at).toLocaleString('es-PE')}</p>
                        {n.image_url ? (
                          <div className="mt-2 -mx-0.5 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-body-bg)] overflow-hidden">
                            <img
                              src={resolveMediaUrl(n.image_url)}
                              alt=""
                              className="w-full h-auto max-h-[min(42vh,320px)] object-contain object-center block"
                            />
                          </div>
                        ) : null}
                        <p className="text-xs text-[var(--ui-body-text)] mt-2 whitespace-pre-wrap select-text">{n.message}</p>
                      </div>
                    ))
                  )}
                </div>
              )}
              {tab === 'operacion' && showOperacionTab && (
                <div className="h-full overflow-y-auto space-y-3">
                  {operationalPayload === undefined ? (
                    <p className="text-sm text-[var(--ui-muted)] text-center py-8">Cargando estado operativo…</p>
                  ) : (
                    <>
                      {operationalPayload.summary && (
                        <div className="grid grid-cols-2 gap-2 text-[11px]">
                          <div className="rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] px-2 py-1.5">
                            <span className="text-[var(--ui-muted)]">Mesas activas</span>
                            <p className="font-semibold text-[var(--ui-body-text)] tabular-nums">
                              {operationalPayload.summary.tablesWithActiveOrders ?? '—'}
                            </p>
                          </div>
                          <div className="rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] px-2 py-1.5">
                            <span className="text-[var(--ui-muted)]">Delivery activo</span>
                            <p className="font-semibold text-[var(--ui-body-text)] tabular-nums">
                              {operationalPayload.summary.deliveryActiveCount ?? '—'}
                            </p>
                          </div>
                          <div className="rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] px-2 py-1.5">
                            <span className="text-[var(--ui-muted)]">En cocina</span>
                            <p className="font-semibold text-[var(--ui-body-text)] tabular-nums">
                              {operationalPayload.summary.inKitchenCount ?? '—'}
                            </p>
                          </div>
                          <div className="rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] px-2 py-1.5">
                            <span className="text-[var(--ui-muted)]">Pedidos activos</span>
                            <p className="font-semibold text-[var(--ui-body-text)] tabular-nums">
                              {operationalPayload.summary.activeOrders ?? '—'}
                            </p>
                          </div>
                        </div>
                      )}
                      {operationalPayload.insightToday ? (
                        <p className="text-xs text-[var(--ui-accent-muted)] border border-[color:var(--ui-border)] rounded-lg px-2 py-1.5 bg-[var(--ui-body-bg)]">
                          {operationalPayload.insightToday}
                        </p>
                      ) : null}
                      {Array.isArray(operationalPayload.alerts) && operationalPayload.alerts.length === 0 ? (
                        <p className="text-sm text-[var(--ui-muted)] text-center py-6">Sin alertas operativas en este momento.</p>
                      ) : (
                        <ul className="space-y-2">
                          {(operationalPayload.alerts || []).map((a) => (
                            <li
                              key={a.id}
                              className={`rounded-xl border px-3 py-2 text-xs ${
                                a.severity === 'warning'
                                  ? 'border-amber-300/80 bg-amber-500/10 text-[var(--ui-body-text)]'
                                  : 'border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] text-[var(--ui-body-text)]'
                              }`}
                            >
                              <p className="font-semibold leading-snug">{a.title}</p>
                              <p className="text-[var(--ui-muted)] mt-0.5 leading-snug">{a.message}</p>
                              {a.linkTo && a.linkLabel ? (
                                <Link
                                  to={a.linkTo}
                                  className="mt-1 inline-block text-[10px] font-semibold text-[var(--ui-accent)] hover:underline underline-offset-2"
                                >
                                  {a.linkLabel}
                                </Link>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}
                      {operacionQuickLinks.length > 0 ? (
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[var(--ui-muted)] pt-1 border-t border-[color:var(--ui-border)]">
                          {operacionQuickLinks.map((item) => (
                            <Link
                              key={`${item.to}-${item.label}`}
                              to={item.to}
                              className="hover:text-[var(--ui-accent)] underline-offset-2 hover:underline"
                            >
                              {item.label}
                            </Link>
                          ))}
                        </div>
                      ) : null}
                      {operationalPayload.generated_at ? (
                        <p className="text-[10px] text-[var(--ui-muted)] text-right">
                          Actualizado {new Date(operationalPayload.generated_at).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      ) : null}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <Modal
        isOpen={!!avisoToDismiss}
        onClose={() => setAvisoToDismiss(null)}
        title="Quitar aviso"
        size="sm"
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            <strong className="font-semibold">Aviso:</strong> asegúrese de haber comprendido el mensaje antes de quitarlo.{' '}
            <strong>No podrá recuperarlo</strong> en esta lista en este navegador (solo deja de mostrarse aquí; el historial completo lo gestiona el administrador maestro).
          </div>
          {avisoToDismiss ? (
            <p className="text-sm text-[var(--ui-body-text)]">
              ¿Quitar «<span className="font-semibold">{avisoToDismiss.title}</span>» de sus avisos?
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <button type="button" className="btn-secondary" onClick={() => setAvisoToDismiss(null)}>
              Cancelar
            </button>
            <button
              type="button"
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700"
              onClick={confirmDismissAviso}
            >
              <MdDelete className="text-lg" />
              Sí, quitar
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
