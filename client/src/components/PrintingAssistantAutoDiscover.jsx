import { useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { maintainPrintingAssistantLink, PRINTING_LINK_STATUS_EVENT } from '../utils/printingConfig';
import { useActiveInterval } from '../hooks/useActiveInterval';

/**
 * Con cualquier sesión de personal activa: despierta Resto FADEY, descubre el bridge
 * y mantiene el vínculo mientras alguien usa el sistema (sin desvincular al recargar).
 */
export default function PrintingAssistantAutoDiscover() {
  const { user } = useAuth();
  const isStaff = Boolean(user && user.type === 'staff');
  const linkedRef = useRef(false);

  useEffect(() => {
    if (!isStaff) {
      linkedRef.current = false;
      return undefined;
    }

    let cancelled = false;

    const attemptLink = async (tryWake) => {
      const result = await maintainPrintingAssistantLink({ tryWake });
      if (result?.connected) linkedRef.current = true;
      return result;
    };

    const runInitialBurst = async () => {
      await attemptLink(true);
      if (cancelled || linkedRef.current) return;

      for (let i = 0; i < 18 && !cancelled && !linkedRef.current; i += 1) {
        await new Promise((r) => setTimeout(r, i < 6 ? 1200 : 2500));
        if (cancelled) return;
        await attemptLink(i === 0 || i % 3 === 0);
      }
    };

    void runInitialBurst();

    return () => {
      cancelled = true;
    };
  }, [isStaff, user?.id]);

  useActiveInterval(() => {
    if (!isStaff) return;
    void maintainPrintingAssistantLink({ tryWake: !linkedRef.current });
  }, 12_000);

  useEffect(() => {
    if (!isStaff) return undefined;
    const onVisible = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        void maintainPrintingAssistantLink({ tryWake: !linkedRef.current });
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [isStaff]);

  useEffect(() => {
    if (!isStaff) return undefined;
    const onLink = (event) => {
      if (event?.detail?.connected) linkedRef.current = true;
    };
    window.addEventListener(PRINTING_LINK_STATUS_EVENT, onLink);
    return () => window.removeEventListener(PRINTING_LINK_STATUS_EVENT, onLink);
  }, [isStaff]);

  return null;
}
