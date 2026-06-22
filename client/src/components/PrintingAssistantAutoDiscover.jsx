import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { bootstrapPrintingOnLogin } from '../utils/printingConfig';

/**
 * Tras iniciar sesión (personal), detecta el asistente Electron, carga la config de impresoras
 * y la persiste en caché para que caja/cocina/bar mantengan la vinculación.
 */
export default function PrintingAssistantAutoDiscover() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user || user.type !== 'staff') return undefined;

    let cancelled = false;
    const run = async () => {
      await bootstrapPrintingOnLogin();
      if (cancelled) return;
      await new Promise((r) => setTimeout(r, 2200));
      if (cancelled) return;
      await bootstrapPrintingOnLogin();
    };

    const t = window.setTimeout(() => {
      void run();
    }, 400);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [user?.id, user?.type]);

  return null;
}
