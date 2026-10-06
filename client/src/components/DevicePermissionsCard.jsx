import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { MdNotificationsActive, MdVolumeUp, MdPhotoCamera, MdVerifiedUser, MdCampaign, MdTune, MdPhonelinkRing } from 'react-icons/md';
import { getPushSubscription, isPushSupported, needsIosHomeScreenInstall, syncPushSubscription } from '../utils/webPush';
import {
  DEVICE_PERMISSIONS_EVENT,
  getDevicePermissionsStatus,
  requestAllDevicePermissions,
  requestCameraPermissionOnly,
  requestNotificationPermissionOnly,
  requestSoundPermission,
  sendTestNotification,
} from '../utils/devicePermissions';
import { isSplashSoundEnabled, previewSplashSound, setSplashSoundEnabled } from '../utils/splashSound';
import { playNotificationSound, unlockNotificationAudio } from '../utils/playNotificationSound';
import { SOUND_CATEGORIES, SOUND_PREFS_EVENT, getSoundPrefs, setSoundPref } from '../utils/soundPrefs';

const STATUS_UI = {
  granted: { label: 'Permitido', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  denied: { label: 'Bloqueado', cls: 'bg-red-50 text-red-700 border-red-200' },
  default: { label: 'Sin activar', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  prompt: { label: 'Sin activar', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  unknown: { label: 'Se pedirá al usar', cls: 'bg-slate-50 text-slate-600 border-slate-200' },
  unsupported: { label: 'No disponible', cls: 'bg-slate-50 text-slate-500 border-slate-200' },
  insecure: { label: 'Requiere https', cls: 'bg-slate-50 text-slate-500 border-slate-200' },
  off: { label: 'Desactivado', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  ios_install: { label: 'Instalar en inicio', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
};

/** Sonido que se escucha al probar cada tipo de aviso. */
function getNotificationPermissionState() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

const PREVIEW_SOUND = {
  message: 'message',
  system: 'system',
  ai: 'ai',
  ready: 'ready',
  arrival: 'kitchen',
  delay: 'alert',
};

function StatusPill({ status }) {
  const ui = STATUS_UI[status] || STATUS_UI.unknown;
  return <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${ui.cls}`}>{ui.label}</span>;
}

function Switch({ checked, onChange, disabled = false, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-40 ${
        checked ? 'bg-blue-600' : 'bg-slate-300'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`}
      />
    </button>
  );
}

function SmallButton({ onClick, children, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function Row({ icon: Icon, title, help, status, children }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <Icon className="text-xl text-blue-600 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800">{title}</p>
        <p className="text-xs text-slate-500">{help}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <StatusPill status={status} />
        {children}
      </div>
    </div>
  );
}

/** Mi perfil → permisos del navegador y avisos de este equipo; cada uno se activa o desactiva por separado. */
export default function DevicePermissionsCard() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [prefs, setPrefs] = useState(() => getSoundPrefs());
  const [splashSound, setSplashSound] = useState(() => isSplashSoundEnabled());

  const refresh = useCallback(async () => {
    const base = await getDevicePermissionsStatus();
    let push = 'unsupported';
    if (needsIosHomeScreenInstall()) push = 'ios_install';
    else if (isPushSupported()) push = (await getPushSubscription()) ? 'granted' : 'default';
    setStatus({ ...base, push });
  }, []);

  useEffect(() => {
    void refresh();
    const onChange = () => void refresh();
    const onPrefs = () => setPrefs(getSoundPrefs());
    window.addEventListener(DEVICE_PERMISSIONS_EVENT, onChange);
    window.addEventListener(SOUND_PREFS_EVENT, onPrefs);
    window.addEventListener('focus', onChange);
    return () => {
      window.removeEventListener(DEVICE_PERMISSIONS_EVENT, onChange);
      window.removeEventListener(SOUND_PREFS_EVENT, onPrefs);
      window.removeEventListener('focus', onChange);
    };
  }, [refresh]);

  const togglePref = (key, enabled) => {
    setSoundPref(key, enabled);
    setPrefs(getSoundPrefs());
  };

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
      await syncPushSubscription();
      setBusy(false);
      await refresh();
    }
  };

  const askNotifications = async () => {
    const res = await requestNotificationPermissionOnly();
    if (res === 'granted') {
      togglePref('windows', true);
      toast.success('Notificaciones permitidas');
    } else if (res === 'denied') {
      toast.error('El navegador bloqueó las notificaciones. Sigue los pasos de abajo.', { duration: 7000 });
    }
    await syncPushSubscription();
    await refresh();
  };

  const askSound = async () => {
    const ok = await requestSoundPermission();
    if (ok) {
      togglePref('master', true);
      playNotificationSound('system', `sound-unlock-${Date.now()}`, { force: true, preview: true });
      toast.success('Sonido activado');
    }
    await refresh();
  };

  const togglePush = async (enabled) => {
    togglePref('push', enabled);
    if (enabled && getNotificationPermissionState() === 'default') await requestNotificationPermissionOnly();
    const res = await syncPushSubscription();
    if (enabled) {
      if (res === 'subscribed') toast.success('Este equipo recibirá «Pedido listo» con la pantalla apagada');
      else if (res === 'no-permission') toast.error('Primero permite las notificaciones en este equipo.');
      else if (res === 'unsupported') toast.error('Este navegador no admite avisos con la pantalla apagada.');
      else if (res === 'error') toast.error('No se pudo activar. Revisa la conexión e inténtalo de nuevo.');
    }
    await refresh();
  };

  const askCamera = async () => {
    const res = await requestCameraPermissionOnly();
    if (res === 'granted') toast.success('Cámara permitida');
    else if (res === 'denied') toast.error('El navegador bloqueó la cámara. Sigue los pasos de abajo.', { duration: 7000 });
    await refresh();
  };

  const preview = async (catId) => {
    await unlockNotificationAudio();
    playNotificationSound(PREVIEW_SOUND[catId], `preview-${catId}-${Date.now()}`, { force: true, preview: true });
    void refresh();
  };

  const test = () => {
    const shown = sendTestNotification();
    if (!shown) toast('Sonó el aviso. La notificación de Windows necesita el permiso y estar activada.', { icon: '🔔' });
    else toast.success('Aviso de prueba enviado');
  };

  if (!status) return null;
  const notif = status.notifications;
  const notifCanAsk = notif === 'default';
  const notifGranted = notif === 'granted';
  const notifPill = notifGranted && !prefs.windows ? 'off' : notif;
  const soundPill = !prefs.master ? 'off' : status.sound ? 'granted' : 'default';
  const cameraCanAsk = status.camera === 'prompt' || status.camera === 'unknown';
  const anyBlocked = notif === 'denied' || status.camera === 'denied';
  const allOk = notifGranted && prefs.windows && status.sound && prefs.master
    && (status.camera === 'granted' || status.camera === 'unknown');

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
          status={notifPill}
        >
          {notifCanAsk ? <SmallButton onClick={() => void askNotifications()}>Activar</SmallButton> : null}
          {notifGranted ? (
            <Switch
              checked={prefs.windows}
              onChange={(v) => togglePref('windows', v)}
              label="Notificaciones de Windows"
            />
          ) : null}
        </Row>
        <Row
          icon={MdPhonelinkRing}
          title="Aviso con pantalla apagada"
          help={status.push === 'ios_install'
            ? 'En iPhone/iPad: Compartir → «Agregar a inicio», abre el sistema desde ese ícono y activa aquí.'
            : 'Te llega «Pedido listo» con sonido y vibración del teléfono aunque la pantalla esté apagada o el sistema cerrado.'}
          status={!prefs.push && status.push !== 'unsupported' && status.push !== 'ios_install' ? 'off' : status.push}
        >
          {status.push !== 'unsupported' && status.push !== 'ios_install' ? (
            <Switch
              checked={prefs.push && prefs.windows}
              disabled={!prefs.windows || notif === 'denied' || notif === 'insecure'}
              onChange={(v) => void togglePush(v)}
              label="Aviso con pantalla apagada"
            />
          ) : null}
        </Row>
        <Row
          icon={MdVolumeUp}
          title="Sonido de avisos"
          help="El navegador lo pide de nuevo cada vez que abres el sistema; se activa con «Activar» o tocando la pantalla."
          status={soundPill}
        >
          {prefs.master && !status.sound ? <SmallButton onClick={() => void askSound()}>Activar</SmallButton> : null}
          <Switch
            checked={prefs.master}
            onChange={(v) => {
              togglePref('master', v);
              if (v) void askSound();
            }}
            label="Sonido de avisos"
          />
        </Row>
        <Row
          icon={MdPhotoCamera}
          title="Cámara"
          help="Para marcar asistencia con QR y la foto de jornada."
          status={status.camera}
        >
          {cameraCanAsk ? <SmallButton onClick={() => void askCamera()}>Activar</SmallButton> : null}
        </Row>
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

      <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
        <p className="text-sm font-semibold text-slate-700 flex items-center gap-2 py-1.5">
          <MdTune className="text-blue-600" /> Sonidos por tipo de aviso
        </p>
        <p className="text-xs text-slate-500 pb-1.5">
          Cada aviso tiene su propio sonido, al máximo volumen. Actívalos o desactívalos por separado en este equipo.
          Se guardan solo aquí: por ejemplo, en la laptop de caja puedes apagar «Llegada de pedidos» y «Alerta de demora»
          y seguirán sonando en la tablet de cocina.
        </p>
        <div className="divide-y divide-slate-200/70">
          {SOUND_CATEGORIES.map((cat) => (
            <div key={cat.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-800">{cat.label}</span>
                <span className="block text-xs text-slate-500">{cat.help}</span>
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <SmallButton onClick={() => void preview(cat.id)}>Escuchar</SmallButton>
                <Switch
                  checked={prefs[cat.id] !== false}
                  disabled={!prefs.master}
                  onChange={(v) => togglePref(cat.id, v)}
                  label={cat.label}
                />
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 py-2">
            <span className="min-w-0">
              <span className="block text-sm font-medium text-slate-800">Sonido de apertura</span>
              <span className="block text-xs text-slate-500">Suena con la animación al abrir el sistema en este equipo.</span>
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <SmallButton onClick={() => previewSplashSound()}>Escuchar</SmallButton>
              <Switch
                checked={splashSound}
                onChange={(v) => {
                  setSplashSoundEnabled(v);
                  setSplashSound(v);
                }}
                label="Sonido de apertura"
              />
            </div>
          </div>
        </div>
        {!prefs.master ? (
          <p className="text-xs text-amber-700 pb-1.5">El sonido de avisos está desactivado: no sonará ningún tipo hasta volver a activarlo.</p>
        ) : null}
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
