import { useEffect, useState } from 'react';
import { discardStaleCheckoutJobs, getOfflinePosStatus, subscribeOfflinePos } from '../utils/offlinePos';
import { api } from '../utils/api';

export default function OfflineCajaBanner() {
  const [st, setSt] = useState(getOfflinePosStatus);
  useEffect(() => subscribeOfflinePos(setSt), []);

  if (st.online && !st.pending && !st.syncing) return null;

  const label = !st.online
    ? 'Sin internet: caja y mesas siguen en este equipo. Al reconectar se actualiza el servidor.'
    : st.syncing
      ? `Sincronizando ${st.pending} cambio(s) con el servidor…`
      : `${st.pending} cambio(s) pendiente(s) de enviar al servidor`;

  const staleBlock = /l[ií]neas de pedido no existen|no coinciden|omitió|omitieron/i.test(String(st.lastError || ''));

  return (
    <div
      className={`px-3 py-2 text-xs sm:text-sm font-medium border-b ${
        st.online
          ? 'bg-amber-50 text-amber-900 border-amber-200'
          : 'bg-sky-50 text-sky-900 border-sky-200'
      }`}
      role="status"
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p>{label}</p>
        <div className="flex items-center gap-3 shrink-0">
          {st.online && st.pending > 0 && !st.syncing ? (
            <button
              type="button"
              className="underline"
              onClick={() => api.flushOfflineQueue().catch(() => {})}
            >
              Sincronizar ahora
            </button>
          ) : null}
          {st.online && staleBlock && st.pending > 0 && !st.syncing ? (
            <button
              type="button"
              className="underline"
              onClick={() => {
                discardStaleCheckoutJobs();
                api.flushOfflineQueue().catch(() => {});
              }}
            >
              Omitir cobros bloqueados
            </button>
          ) : null}
        </div>
      </div>
      {st.lastError ? <p className="mt-1 opacity-80">{st.lastError}</p> : null}
    </div>
  );
}
