import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { MdGetApp } from 'react-icons/md';
import { isDesktopEmbeddedRuntime, isElectronRuntime } from '../utils/api';
import { needsIosHomeScreenInstall } from '../utils/webPush';
import {
  isPwaInstalledHere,
  startPwaInstall,
  subscribePwaInstall,
} from '../utils/pwaInstall';

/** Botón al final del perfil. Abre el cuadro de Chrome, o avisa si ya está instalado. */
export default function PwaInstallProfileButton() {
  const [, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [already, setAlready] = useState(false);

  useEffect(() => subscribePwaInstall(() => setTick((n) => n + 1)), []);

  if (isElectronRuntime() || isDesktopEmbeddedRuntime()) return null;
  if (isPwaInstalledHere() || already) {
    return (
      <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold text-slate-800">El sistema ya está instalado en este Chrome.</p>
        <p className="mt-1 text-xs text-slate-500 leading-snug">
          Ábrelo con el icono Resto-FADEY del escritorio o del menú Inicio.
        </p>
      </section>
    );
  }

  const install = () => {
    if (needsIosHomeScreenInstall()) {
      toast('En iPhone: Compartir y luego Agregar a inicio.');
      return;
    }
    const pending = startPwaInstall();
    setBusy(true);
    void pending.then((outcome) => {
      setBusy(false);
      if (outcome === 'accepted') {
        toast.success('El sistema se está instalando.');
        return;
      }
      if (outcome !== 'unavailable') return;
      if (typeof window !== 'undefined' && !window.isSecureContext) {
        toast.error('Abre el sistema con su enlace https para instalarlo.');
        return;
      }
      if (typeof performance !== 'undefined' && performance.now() > 8000) setAlready(true);
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
