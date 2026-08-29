import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { api, resolveMediaUrl, formatDateTime } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { getSocket } from '../hooks/useSocket';
import StaffTeamChat from './StaffTeamChat';
import toast from 'react-hot-toast';
import { MdClose, MdChat, MdCampaign, MdDelete, MdUpload } from 'react-icons/md';
import {
  PAGO_USO_SUBIR_COMPROBANTE_AVISO_TITLE,
  PAGO_PLAN_MODULE_PATH,
  isPagoPlanAvisoTitle,
} from '../constants/masterNotifications';

const DISMISSED_AVISOS_STORAGE_KEY = 'admin_avisos_descartados_v1';
const STAFF_CHAT_ROLES = new Set(['admin', 'cajero', 'mozo', 'cocina', 'bar', 'delivery', 'produccion']);
const MESSAGE_TOAST_MS = 5000;

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

function showIncomingMessageToast(msg) {
  const name = String(msg.sender_name || (msg.recipient_id ? 'Mensaje privado' : 'Equipo')).trim() || 'Mensaje';
  const body = String(msg.body || '').trim() || '(sin texto)';
  toast.custom(
    () => (
      <div
        className="max-w-sm w-[min(100vw-2rem,22rem)] rounded-xl border border-[color:var(--ui-border)] bg-[var(--ui-surface)] shadow-lg px-4 py-3 text-[var(--ui-body-text)]"
        role="status"
      >
        <p className="text-sm font-semibold flex items-center gap-1.5">
          <MdChat className="text-[var(--ui-accent)] shrink-0" />
          {name}
        </p>
        <p className="text-xs mt-1.5 text-[var(--ui-body-text)] whitespace-pre-wrap break-words line-clamp-4">
          {body}
        </p>
      </div>
    ),
    { duration: MESSAGE_TOAST_MS, id: `staff-chat-${msg.id || Date.now()}` },
  );
}

/**
 * Dos botones independientes: Avisos (sistema) y Mensajes (chat del equipo).
 * Al llegar un mensaje se muestra notificación con nombre y texto durante 5 s.
 */
export default function NotificationCenter({ className = '' }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const showAvisosBtn = Boolean(user);
  const canUseStaffChat = Boolean(user?.id)
    && user?.role !== 'master_admin'
    && user?.type !== 'customer'
    && (!user?.role || STAFF_CHAT_ROLES.has(String(user.role).toLowerCase()));

  const seesPagoUsoAviso = user?.role === 'admin' || user?.role === 'master_admin';

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState(showAvisosBtn ? 'avisos' : 'chat');
  const [unreadChat, setUnreadChat] = useState(0);
  const [adminNotifications, setAdminNotifications] = useState([]);
  const [dismissedAvisoIds, setDismissedAvisoIds] = useState(loadDismissedAvisoIds);
  const [avisoToDismiss, setAvisoToDismiss] = useState(null);

  const rootRef = useRef(null);
  const panelRef = useRef(null);
  const chatActiveRef = useRef(false);

  const visibleAdminNotifications = useMemo(() => {
    let list = adminNotifications.filter((n) => !dismissedAvisoIds.includes(String(n.id)));
    if (!seesPagoUsoAviso) {
      list = list.filter((n) => n.title !== PAGO_USO_SUBIR_COMPROBANTE_AVISO_TITLE);
    }
    return list;
  }, [adminNotifications, dismissedAvisoIds, seesPagoUsoAviso]);

  const isChatActive = open && tab === 'chat';
  chatActiveRef.current = isChatActive;

  useEffect(() => {
    if (!showAvisosBtn && tab === 'avisos') setTab('chat');
  }, [showAvisosBtn, tab]);

  useEffect(() => {
    if (!showAvisosBtn) return;
    const load = () => {
      api.get('/master-admin/admin-notifications')
        .then((data) => setAdminNotifications(Array.isArray(data) ? data : []))
        .catch(() => setAdminNotifications([]));
    };
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [showAvisosBtn]);

  const onUnreadDelta = useCallback((n) => {
    setUnreadChat((u) => u + n);
  }, []);

  useEffect(() => {
    if (!canUseStaffChat) return undefined;
    const s = getSocket();
    const join = () => {
      try {
        const token = localStorage.getItem('token');
        if (token) s.emit('join-staff', { token });
      } catch (_) {
        /* noop */
      }
    };
    join();
    s.on('connect', join);

    const onMsg = (msg) => {
      if (!msg?.id) return;
      const me = String(user.id);
      const sender = String(msg.sender_id || '');
      if (!sender || sender === me) return;
      if (msg.recipient_id != null && String(msg.recipient_id) !== '' && String(msg.recipient_id) !== me) {
        return;
      }
      if (chatActiveRef.current) return;
      setUnreadChat((u) => u + 1);
      showIncomingMessageToast(msg);
    };

    s.on('staff-chat-message', onMsg);
    return () => {
      s.off('connect', join);
      s.off('staff-chat-message', onMsg);
    };
  }, [canUseStaffChat, user?.id]);

  useEffect(() => {
    if (isChatActive) setUnreadChat(0);
  }, [isChatActive]);

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
      if (event.key !== 'Escape') return;
      if (avisoToDismiss) setAvisoToDismiss(null);
      else setOpen(false);
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

  const openWithTab = (nextTab) => {
    setOpen((prev) => {
      if (prev && tab === nextTab) return false;
      setTab(nextTab);
      return true;
    });
  };

  const panelTitle = tab === 'avisos' ? 'Avisos' : 'Mensajes';

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
              className="fixed z-[60] top-14 right-3 sm:right-6 w-[min(100vw-1.5rem,420px)] h-[min(72vh,580px)] flex flex-col rounded-2xl border border-[color:var(--ui-border)] bg-[var(--ui-surface)] shadow-2xl overflow-hidden text-[var(--ui-body-text)] relative"
              role="dialog"
              aria-label={panelTitle}
            >
              <div className="flex items-center justify-between px-3 py-2.5 border-b border-[color:var(--ui-border)] bg-[var(--ui-surface-2)]">
                <p className="text-sm font-semibold text-[var(--ui-body-text)] flex items-center gap-2">
                  {tab === 'avisos' ? (
                    <MdCampaign className="text-lg text-[var(--ui-accent)]" />
                  ) : (
                    <MdChat className="text-lg text-[var(--ui-accent)]" />
                  )}
                  {panelTitle}
                </p>
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
                {tab === 'avisos' && showAvisosBtn && (
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
                          {seesPagoUsoAviso && isPagoPlanAvisoTitle(n.title) ? (
                            <button
                              type="button"
                              className="mt-3 w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-[var(--ui-accent)] px-3 py-2.5 text-sm font-semibold text-[#fff] hover:opacity-95"
                              onClick={() => {
                                setOpen(false);
                                navigate(PAGO_PLAN_MODULE_PATH);
                              }}
                            >
                              <MdUpload className="text-lg" />
                              Cargar Comprobante
                            </button>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                )}
                {canUseStaffChat ? (
                  <div className={tab === 'chat' ? 'h-full min-h-0 flex flex-col' : 'hidden'}>
                    <StaffTeamChat
                      isActive={isChatActive}
                      onUnreadDelta={onUnreadDelta}
                      suppressExternalNotify
                    />
                  </div>
                ) : tab === 'chat' ? (
                  <p className="text-sm text-[var(--ui-muted)] text-center py-8">
                    El chat interno es solo para personal del restaurante.
                  </p>
                ) : null}
              </div>

              {avisoToDismiss ? (
                <div
                  className="absolute inset-0 z-30 flex items-center justify-center p-4 bg-black/35"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Confirmar borrar aviso"
                >
                  <div
                    className="w-full max-w-[260px] rounded-xl border border-[color:var(--ui-border)] bg-[var(--ui-surface)] shadow-lg p-4"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <p className="text-sm text-center text-[var(--ui-body-text)] leading-snug">
                      Al borrar se perderá para siempre, ¿seguro?
                    </p>
                    <div className="mt-4 flex gap-2">
                      <button
                        type="button"
                        className="btn-secondary flex-1 text-sm py-2"
                        onClick={() => setAvisoToDismiss(null)}
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        className="flex-1 text-sm py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700"
                        onClick={confirmDismissAviso}
                      >
                        Borrar
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </>,
          document.body,
        )
      : null;

  const btnClass = (active) =>
    `p-2 rounded-lg transition-colors relative ${
      active ? 'bg-[var(--ui-sidebar-hover)]' : 'hover:bg-[var(--ui-sidebar-hover)]'
    }`;

  return (
    <div ref={rootRef} className={`relative flex items-center gap-0.5 ${className}`}>
      {showAvisosBtn ? (
        <button
          type="button"
          onClick={() => openWithTab('avisos')}
          className={btnClass(open && tab === 'avisos')}
          title="Avisos"
          aria-expanded={open && tab === 'avisos'}
          aria-label="Avisos"
        >
          <MdCampaign className="text-xl text-[var(--ui-body-text)]" />
          {visibleAdminNotifications.length > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-bold bg-[#EF4444] text-white rounded-full">
              {visibleAdminNotifications.length > 99 ? '99+' : visibleAdminNotifications.length}
            </span>
          ) : null}
        </button>
      ) : null}

      {canUseStaffChat ? (
        <button
          type="button"
          onClick={() => openWithTab('chat')}
          className={btnClass(open && tab === 'chat')}
          title="Mensajes"
          aria-expanded={open && tab === 'chat'}
          aria-label="Mensajes"
        >
          <MdChat className="text-xl text-[var(--ui-body-text)]" />
          {unreadChat > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-bold bg-[#EF4444] text-white rounded-full">
              {unreadChat > 99 ? '99+' : unreadChat}
            </span>
          ) : null}
        </button>
      ) : null}

      {panel}
    </div>
  );
}
