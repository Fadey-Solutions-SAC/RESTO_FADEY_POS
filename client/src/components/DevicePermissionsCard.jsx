import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { MdNotificationsActive, MdVolumeUp, MdPhotoCamera, MdVerifiedUser, MdCampaign } from 'react-icons/md';
import {
  DEVICE_PERMISSIONS_EVENT,
  getDevicePermissionsStatus,
  requestAllDevicePermissions,
  sendTestNotification,
} from '../utils/devicePermissions';
import { isSplashSoundEnabled, previewSplashSound, setSplashSoundEnabled } from '../utils/splashSound';

const STATUS_UI = {
  granted: { label: 'Permitido', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  denied: { label: 'Bloqueado', cls: 'bg-red-50 text-red-700 border-red-200' },
  default: { label: 'Sin activar', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  prompt: { label: 'Sin activar', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  unknown: { label: 'Se pedirá al usar', cls: 'bg-slate-50 text-slate-600 border-slate-200' },
  unsupported: { label: 'No disponible', cls: 'bg-slate-50 text-slate-500 border-slate-200' },
  insecure: { label: 'Requiere https', cls: 'bg-slate-50 text-slate-500 border-slate-200' },
};

function StatusPill({ status }) {
  const ui = STATUS_UI[status] || STATUS_UI.unknown;
  return <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${ui.cls}`}>{ui.label}</span>;
}

function Row({ icon: Icon, title, help, status }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <Icon className="text-xl text-blue-600 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800">{title}</p>
        <p className="text-xs text-slate-500">{help}</p>
      </div>
      <StatusPill status={status} />
    </div>
  );
}

/** Mi perfil → permisos del navegador: notificaciones, sonido y cámara, con un solo botón. */
export default function DevicePermissionsCard() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [splashSound, setSplashSound] = useState(() => isSplashSoundEnabled());

  const refresh = useCallback(async () => {
    setStatus(await getDevicePermissionsStatus());
  }, []);

  useEffect(() => {
    void refresh();
    const onChange = () => void refresh();
    window.addEventListener(DEVICE_PERMISSIONS_EVENT, onChange);
    window.addEventListener('focus', onChange);
    return () => {
      window.removeEventListener(DEVICE_PERMISSIONS_EVENT, onChange);
      window.removeEventListener('focus', onChange);
    };
  }, [refresh]);

  const grantAll = async () => {
    setBusy(true);
    try {
      const res = await requestAllDevicePermissions({ camera: true });
      const blocked = [
        res.notifications === 'denied' && 'notificaciones',
        res.camera === 'denied' && 'cámara',
      ].filter(Boolean);
      if (blocked.length) {
        toast.error(`Quedó bloqueado: ${blocked.join(' y ')}. Sigue los pasos de abajo para habilitarlo.`, { duration: 7000 });
      } else {
        toast.success('Permisos activados');
        if (res.notifications === 'granted') sendTestNotification();
      }
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const test = () => {
    const shown = sendTestNotification();
    if (!shown) toast('Sonó el aviso. La notificación de Windows necesita el permiso de notificaciones.', { icon: '🔔' });
    else toast.success('Aviso de prueba enviado');
  };

  if (!status) return null;
  const notif = status.notifications;
  const anyBlocked = notif === 'denied' || status.camera === 'denied';
  const allOk = notif === 'granted' && status.sound && (status.camera === 'granted' || status.camera === 'unknown');

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <MdVerifiedUser className="text-blue-600" /> Permisos del dispositivo
        </p>
        {allOk ? <StatusPill status="granted" /> : null}
      </div>

      <div className="divide-y divide-slate-100">
        <Row
          icon={MdNotificationsActive}
          title="Notificaciones"
          help="Aviso «Pedido Mesa X está listo» aunque el sistema esté minimizado."
          status={notif}
        />
        <Row
          icon={MdVolumeUp}
          title="Sonido de avisos"
          help="El navegador lo pide de nuevo cada vez que abres el sistema; se activa con este botón o tocando la pantalla."
          status={status.sound ? 'granted' : 'default'}
        />
        <Row
          icon={MdPhotoCamera}
          title="Cámara"
          help="Para marcar asistencia con QR y la foto de jornada."
          status={status.camera}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void grantAll()}
          disabled={busy}
          className="flex-1 min-w-[12rem] flex items-center justify-center gap-2 h-11 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-60"
        >
          <MdVerifiedUser className="text-lg" /> {busy ? 'Solicitando…' : 'Dar todos los permisos'}
        </button>
        <button
          type="button"
          onClick={test}
          className="flex items-center justify-center gap-2 h-11 px-4 rounded-xl border border-slate-200 text-slate-700 font-medium hover:bg-slate-50"
        >
          <MdCampaign className="text-lg" /> Probar aviso
        </button>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
        <label className="flex items-center gap-2.5 cursor-pointer select-none min-w-0">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300"
            checked={splashSound}
            onChange={(e) => {
              setSplashSoundEnabled(e.target.checked);
              setSplashSound(e.target.checked);
            }}
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-slate-800">Sonido de apertura</span>
            <span className="block text-xs text-slate-500">Suena con la animación al abrir el sistema en este equipo.</span>
          </span>
        </label>
        <button
          type="button"
          onClick={() => previewSplashSound()}
          className="shrink-0 text-xs font-medium px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
        >
          Escuchar
        </button>
      </div>

      {anyBlocked ? (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 space-y-1">
          <p className="font-semibold">Si algo quedó bloqueado, el navegador ya no deja volver a preguntarlo desde el sistema:</p>
          <p>1. Toca el candado 🔒 a la izquierda de la dirección de la página.</p>
          <p>2. En «Notificaciones» y «Cámara» elige <b>Permitir</b>.</p>
          <p>3. Recarga la página (F5).</p>
        </div>
      ) : null}
      {!status.secure ? (
        <p className="text-xs text-slate-500">
          Estás entrando sin https (por ejemplo por la IP de la red). El navegador solo permite notificaciones y cámara en
          {' '}<b>localhost</b> o con <b>https</b>; el aviso con sonido dentro del sistema sí funciona.
        </p>
      ) : null}
    </div>
  );
}
