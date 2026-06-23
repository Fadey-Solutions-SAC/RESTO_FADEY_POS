import { useEffect } from 'react';
import { api } from '../utils/api';

const HEARTBEAT_MS = 2 * 60 * 1000;

/**
 * Registra actividad en el servidor mientras el personal tiene la app abierta.
 * Evita cierre por inactividad (36 h) en caja u otras pantallas con pocos clics.
 */
export function useStaffSessionHeartbeat(user) {
  useEffect(() => {
    if (!user || user.type === 'customer' || user.role === 'master_admin') return undefined;

    const ping = () => {
      if (document.visibilityState === 'hidden') return;
      api.post('/auth/heartbeat', {}).catch(() => {});
    };

    ping();
    const id = setInterval(ping, HEARTBEAT_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') ping();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user?.id, user?.role, user?.type]);
}

export default useStaffSessionHeartbeat;
