import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { MdGetApp } from 'react-icons/md';
import { isDesktopEmbeddedRuntime, isElectronRuntime } from '../utils/api';
import { needsIosHomeScreenInstall } from '../utils/webPush';
import {
  canPromptPwaInstall,
  isPwaInstalledHere,
  startPwaInstall,
  subscribePwaInstall,
} from '../utils/pwaInstall';

/** Botón al final del perfil: abre el cuadro de instalación de Chrome. */
export default function PwaInstallProfileButton() {
  const [, setTick] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribePwaInstall(() => setTick((n) => n + 1)), []);

  if (isElectronRuntime() || isDesktopEmbeddedRuntime()) return null;
  if (isPwaInstalledHere()) {
    return (
      <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold text-slate-800">El sistema ya está instalado en este equipo.</p>
      </section>
    );
  }

  const install = () => {
    if (needsIosHomeScreenInstall() && !canPromptPwaInstall() && typeof navigator.install !== 'function') {
      toast('En iPhone: Compartir y luego Agregar a inicio.');
      return;
    }
    const pending = startPwaInstall();
    setBusy(true);
    void pending.then((outcome) => {
      setBusy(false);
      if (outcome === 'accepted') toast.success('El sistema se está instalando.');
      else if (outcome === 'error' || outcome === 'unavailable') {
        toast.error('Chrome no abrió la instalación. Vuelve a cargar la página e inténtalo otra vez.');
      }
    });
  };

  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <p className="text-sm font-semibold text-slate-800">Instalar el sistema</p>
      <p className="mt-1 text-xs text-slate-500 leading-snug">
        Ábrelo como aplicación en este equipo.
      </p>
      <button
        type="button"
        onClick={install}
        disabled={busy}
        className="mt-3 w-full sm:w-auto inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-60"
      >
        <MdGetApp className="text-lg" />
        {busy ? 'Abriendo…' : 'Instalar el sistema'}
      </button>
    </section>
  );
}
