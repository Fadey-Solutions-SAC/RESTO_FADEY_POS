import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { api, resolveMediaUrl, formatDateTime } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import StaffTeamChat from './StaffTeamChat';
import Modal from './Modal';
import { MdNotificationsNone, MdClose, MdChat, MdCampaign, MdDelete } from 'react-icons/md';
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

function defaultTabForUser(hasAvisosTab) {
  return hasAvisosTab ? 'avisos' : 'chat';
}

/**
 * Campana de notificaciones: avisos del maestro y chat del equipo.
 * Las alertas operativas viven solo en Escritorio → Monitoreo en vivo.
 */
export default function NotificationCenter({ className = '' }) {
  const { user } = useAuth();
  const showAvisosTab = Boolean(user);

  const seesPagoUsoAviso = user?.role === 'admin' || user?.role === 'master_admin';

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState(() => defaultTabForUser(showAvisosTab));
  const [unreadChat, setUnreadChat] = useState(0);
  const [adminNotifications, setAdminNotifications] = useState([]);
  const [dismissedAvisoIds, setDismissedAvisoIds] = useState(loadDismissedAvisoIds);
  const [avisoToDismiss, setAvisoToDismiss] = useState(null);

  const rootRef = useRef(null);
  const panelRef = useRef(null);

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

  /** Cerrar al clic fuera del panel y de la campana (cubre toda la página). */
  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event) => {
      if (avisoToDismiss) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !avisoToDismiss) setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, avisoToDismiss]);

  const confirmDismissAviso = () => {
    if (!avisoToDismiss?.id) return;
    const id = String(avisoToDismiss.id);
    const next = [...new Set([...dismissedAvisoIds, id])];
    setDismissedAvisoIds(next);
    saveDismissedAvisoIds(next);
    setAvisoToDismiss(null);
  };

  const totalBadge = unreadChat + (showAvisosTab ? visibleAdminNotifications.length : 0);

  const openPanel = () => {
    setOpen((prev) => {
      if (!prev) setTab(defaultTabForUser(showAvisosTab));
      return !prev;
    });
  };

  const panel =
    open && typeof document !== 'undefined'
      ? createPortal(
          <>
            <div
              className="fixed inset-0 z-[55] bg-black/20"
              onClick={() => setOpen(false)}
              aria-hidden
            />
            <div
              ref={panelRef}
              className="fixed z-[60] top-14 right-3 sm:right-6 w-[min(100vw-1.5rem,420px)] h-[min(72vh,580px)] flex flex-col rounded-2xl border border-[color:var(--ui-border)] bg-[var(--ui-surface)] shadow-2xl overflow-hidden text-[var(--ui-body-text)]"
              role="dialog"
              aria-label="Centro de mensajes"
            >
              <div className="flex items-center justify-between px-3 py-2 border-b border-[color:var(--ui-border)] bg-[var(--ui-surface-2)]">
                {showAvisosTab ? (
                  <div className="flex flex-wrap rounded-lg bg-[var(--ui-body-bg)] p-0.5 gap-0.5 border border-[color:var(--ui-border)] max-w-[min(100%,340px)]">
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
                    <button
                      type="button"
                      onClick={() => setTab('chat')}
                      className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-medium ${
                        tab === 'chat' ? 'bg-[var(--ui-accent)] text-white' : 'text-[var(--ui-muted)] hover:text-[var(--ui-body-text)]'
                      }`}
                    >
                      <MdChat className="text-base shrink-0" /> Mensajes
                      {unreadChat > 0 && (
                        <span className="bg-red-500 text-white text-[10px] px-1.5 rounded-full">{unreadChat > 99 ? '99+' : unreadChat}</span>
                      )}
                    </button>
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
                          <p className="text-[10px] text-[var(--ui-muted)] mt-1">{formatDateTime(n.created_at)}</p>
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
                {tab === 'chat' && (
                  <StaffTeamChat isActive={open && tab === 'chat'} onUnreadDelta={onUnreadDelta} />
                )}
              </div>
            </div>
          </>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={openPanel}
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

      {panel}

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
