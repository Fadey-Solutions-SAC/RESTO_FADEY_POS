import { useState, useEffect, useCallback } from 'react';
import { MdGetApp, MdClose } from 'react-icons/md';

const SNOOZE_KEY = 'resto_fadey_pwa_install_snooze_until';
const DONE_KEY = 'resto_fadey_pwa_install_done';

function isStandalone() {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
  } catch {
    /* */
  }
  return window.navigator.standalone === true;
}

function isSnoozed() {
  try {
    const t = localStorage.getItem(SNOOZE_KEY);
    if (!t) return false;
    return Date.now() < Number(t);
  } catch {
    return false;
  }
}

/**
 * Muestra el botón nativo «Instalar» cuando el navegador emite beforeinstallprompt (Chrome/Edge, HTTPS).
 * La primera vez que la app puede instalarse, aparece la barra inferior automáticamente.
 */
export default function PwaInstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  const [showBar, setShowBar] = useState(false);

  const refreshBar = useCallback((event) => {
    if (isStandalone()) {
      setShowBar(false);
      return;
    }
    if (isSnoozed()) {
      setShowBar(false);
      return;
    }
    try {
      if (localStorage.getItem(DONE_KEY) === '1') {
        setShowBar(false);
        return;
      }
    } catch {
      /* */
    }
    setShowBar(!!event);
  }, []);

  useEffect(() => {
    if (isStandalone()) return;

    const onBeforeInstall = (e) => {
      e.preventDefault();
      setDeferred(e);
      refreshBar(e);
    };

    const onInstalled = () => {
      try {
        localStorage.setItem(DONE_KEY, '1');
        localStorage.removeItem(SNOOZE_KEY);
      } catch {
        /* */
      }
      setDeferred(null);
      setShowBar(false);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [refreshBar]);

  const snooze = () => {
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now() + 7 * 24 * 60 * 60 * 1000));
    } catch {
      /* */
    }
    setShowBar(false);
  };

  const install = async () => {
    if (!deferred) return;
    try {
      deferred.prompt();
      await deferred.userChoice;
    } catch {
      /* */
    }
    setDeferred(null);
    setShowBar(false);
  };

  if (!showBar || !deferred || isStandalone()) return null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[100] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-[color:var(--ui-border)] bg-[var(--ui-surface)] shadow-[0_-4px_24px_rgba(0,0,0,0.12)]"
      role="region"
      aria-label="Instalar aplicación"
    >
      <div className="flex items-start gap-3 min-w-0">
        <div className="shrink-0 w-10 h-10 rounded-xl overflow-hidden bg-[#00050d] ring-1 ring-[color:var(--ui-border)]">
          <img
            src="/branding/resto-fadey-logo.png"
            alt=""
            className="w-full h-full object-contain"
            width={40}
            height={40}
          />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--ui-body-text)]">Instalar Resto-FADEY</p>
          <p className="text-xs text-[var(--ui-muted)] leading-snug mt-0.5">
            Abra la app como programa en su equipo: acceso rápido, mejor impresión USB y uso sin pestañas del navegador.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0 sm:pl-4">
        <button
          type="button"
          onClick={snooze}
          className="px-3 py-2 rounded-lg text-xs font-medium border border-[color:var(--ui-border)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]"
        >
          Más tarde
        </button>
        <button
          type="button"
          onClick={() => void install()}
          className="px-4 py-2 rounded-lg text-xs font-semibold bg-[var(--ui-accent)] text-white hover:opacity-95 inline-flex items-center gap-1.5"
        >
          <MdGetApp className="text-base" /> Instalar aplicación
        </button>
        <button
          type="button"
          onClick={snooze}
          className="p-2 rounded-lg text-[var(--ui-muted)] hover:bg-[var(--ui-sidebar-hover)] sm:hidden"
          aria-label="Cerrar"
        >
          <MdClose className="text-lg" />
        </button>
      </div>
    </div>
  );
}
