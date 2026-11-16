import { useEffect, useState } from 'react';
import { MdGetApp } from 'react-icons/md';
import { isDesktopEmbeddedRuntime, isElectronRuntime } from '../utils/api';
import { needsIosHomeScreenInstall } from '../utils/webPush';
import {
  canPromptPwaInstall,
  isPwaInstalledHere,
  promptPwaInstall,
  subscribePwaInstall,
} from '../utils/pwaInstall';

function manualInstallHint() {
  if (needsIosHomeScreenInstall()) {
    return 'En iPhone o iPad: pulsa Compartir y luego Agregar a inicio.';
  }
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  if (/Android/i.test(ua)) {
    return 'Si Chrome no muestra Instalar, abre el menú ⋮ y elige Instalar aplicación o Agregar a pantalla de inicio.';
  }
  return 'Si Chrome no muestra el icono de instalar, abre el menú ⋮ → Transmitir, guardar e instalar → Instalar Resto-FADEY.';
}

/** Botón fijo del perfil: instala aunque el aviso de Chrome no haya salido. */
export default function PwaInstallProfileButton() {
  const [ready, setReady] = useState(() => canPromptPwaInstall());
  const [hint, setHint] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribePwaInstall(() => setReady(canPromptPwaInstall())), []);

  if (isElectronRuntime() || isDesktopEmbeddedRuntime()) return null;
  if (isPwaInstalledHere()) {
    return (
      <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold text-slate-800">El sistema ya está instalado en este equipo.</p>
      </section>
    );
  }

  const install = async () => {
    setHint('');
    if (!canPromptPwaInstall()) {
      setHint(manualInstallHint());
      return;
    }
    setBusy(true);
    const outcome = await promptPwaInstall();
    setBusy(false);
    if (outcome === 'unavailable') setHint(manualInstallHint());
  };

  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <p className="text-sm font-semibold text-slate-800">Instalar el sistema</p>
      <p className="mt-1 text-xs text-slate-500 leading-snug">
        Ábrelo como aplicación, sin depender del aviso de Chrome.
      </p>
      <button
        type="button"
        onClick={() => { void install(); }}
        disabled={busy}
        className="mt-3 w-full sm:w-auto inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-60"
      >
        <MdGetApp className="text-lg" />
        {busy ? 'Abriendo…' : 'Instalar el sistema'}
      </button>
      {hint ? <p className="mt-2 text-xs text-amber-800 leading-snug">{hint}</p> : null}
      {!ready && !hint ? (
        <p className="mt-2 text-xs text-slate-400 leading-snug">
          Si el cuadro de Chrome no abre, el botón te indica el menú del navegador.
        </p>
      ) : null}
    </section>
  );
}
