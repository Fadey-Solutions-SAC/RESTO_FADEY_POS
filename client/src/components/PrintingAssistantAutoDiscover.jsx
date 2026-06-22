import { useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { maintainPrintingAssistantLink, PRINTING_LINK_STATUS_EVENT } from '../utils/printingConfig';
import { useActiveInterval } from '../hooks/useActiveInterval';

/**
 * Con sesión de personal: descubre el bridge Resto FADEY sin spamear restofadey://wake.
 */
export default function PrintingAssistantAutoDiscover() {
  const { user } = useAuth();
  const isStaff = Boolean(user && user.type === 'staff');
  const linkedRef = useRef(false);
  const initialBurstDoneRef = useRef(false);

  useEffect(() => {
    if (!isStaff) {
      linkedRef.current = false;
      initialBurstDoneRef.current = false;
      return undefined;
    }

    if (initialBurstDoneRef.current) return undefined;
    initialBurstDoneRef.current = true;

    let cancelled = false;

    const attemptLink = async (tryWake) => {
      const result = await maintainPrintingAssistantLink({ tryWake });
      if (result?.connected) linkedRef.current = true;
      return result;
    };

    const runInitialBurst = async () => {
      await attemptLink(true);
      if (cancelled || linkedRef.current) return;

      for (let i = 0; i < 3 && !cancelled && !linkedRef.current; i += 1) {
        await new Promise((r) => setTimeout(r, 2500));
        if (cancelled) return;
        await attemptLink(false);
      }
    };

    void runInitialBurst();

    return () => {
      cancelled = true;
    };
  }, [isStaff, user?.id]);

  useActiveInterval(() => {
    if (!isStaff) return;
    void maintainPrintingAssistantLink({ tryWake: false });
  }, 60_000);

  useEffect(() => {
    if (!isStaff) return undefined;
    const onVisible = () => {
      if (typeof document !== 'undefined' && !document.hidden && !linkedRef.current) {
        void maintainPrintingAssistantLink({ tryWake: false });
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
