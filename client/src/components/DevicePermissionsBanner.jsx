import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { MdNotificationsActive, MdClose } from 'react-icons/md';
import {
  DEVICE_PERMISSIONS_EVENT,
  ORDER_READY_ROLES,
  dismissPermissionsBanner,
  getNotificationPermission,
  isPermissionsBannerDismissed,
  requestAllDevicePermissions,
  sendTestNotification,
} from '../utils/devicePermissions';

/**
 * Aviso visible para activar notificaciones de «pedido listo».
 * Si lo cierran, se puede activar después desde Mi perfil → Permisos del dispositivo.
 */
export default function DevicePermissionsBanner({ role }) {
  const navigate = useNavigate();
  const roleLc = String(role || '').toLowerCase();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    setVisible(
      ORDER_READY_ROLES.has(roleLc)
      && getNotificationPermission() === 'default'
      && !isPermissionsBannerDismissed(),
    );
  }, [roleLc]);

  useEffect(() => {
    refresh();
    window.addEventListener(DEVICE_PERMISSIONS_EVENT, refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener(DEVICE_PERMISSIONS_EVENT, refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);

  const activate = async () => {
    setBusy(true);
    try {
      const res = await requestAllDevicePermissions({ camera: false });
      if (res.notifications === 'granted') {
        sendTestNotification();
        toast.success('Avisos activados: te llegará «Pedido Mesa X está listo».');
      } else if (res.notifications === 'denied') {
        toast.error('Bloqueaste las notificaciones. Puedes activarlas en Mi perfil → Permisos del dispositivo.', { duration: 7000 });
      }
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const later = () => {
    dismissPermissionsBanner();
    setVisible(false);
    toast('Puedes activarlos cuando quieras en Mi perfil → Permisos del dispositivo.', { duration: 6000, icon: 'ℹ️' });
  };

  if (!visible || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed z-[120] left-1/2 -translate-x-1/2 bottom-4 w-[min(100vw-1.5rem,30rem)]" role="dialog" aria-label="Activar avisos de pedidos">
      <div className="rounded-2xl border-2 border-emerald-500 bg-[var(--ui-surface)] text-[var(--ui-body-text)] shadow-2xl p-4">
        <div className="flex items-start gap-3">
          <MdNotificationsActive className="text-3xl text-emerald-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold">Activa los avisos de tus pedidos</p>
            <p className="text-xs mt-1 text-[var(--ui-muted)]">
              Te avisaremos con sonido y notificación cuando cocina o bar marquen tu pedido como listo, aunque tengas el sistema minimizado.
            </p>
          </div>
          <button type="button" onClick={later} className="p-1 rounded-lg hover:bg-[var(--ui-sidebar-hover)] text-[var(--ui-muted)]" aria-label="Cerrar">
            <MdClose />
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 justify-end">
          <button type="button" onClick={() => navigate('/admin/perfil')} className="btn-secondary text-xs px-3 py-2">
            Ver en Mi perfil
          </button>
          <button type="button" onClick={later} className="btn-secondary text-xs px-3 py-2">
            Ahora no
          </button>
          <button
            type="button"
            onClick={() => void activate()}
            disabled={busy}
            className="text-xs font-semibold px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {busy ? 'Activando…' : 'Activar avisos'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
