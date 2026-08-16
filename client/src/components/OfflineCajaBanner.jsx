import { useEffect, useState } from 'react';
import { getOfflinePosStatus, subscribeOfflinePos } from '../utils/offlinePos';
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

  return (
    <div
      className={`px-3 py-2 text-xs sm:text-sm font-medium border-b ${
        st.online
          ? 'bg-amber-50 text-amber-900 border-amber-200'
          : 'bg-sky-50 text-sky-900 border-sky-200'
      }`}
      role="status"
    >
      <div className="flex items-center justify-between gap-2">
        <p>{label}</p>
        {st.online && st.pending > 0 && !st.syncing ? (
          <button
            type="button"
            className="shrink-0 underline"
            onClick={() => api.flushOfflineQueue().catch(() => {})}
          >
            Sincronizar ahora
          </button>
        ) : null}
      </div>
      {st.lastError ? <p className="mt-1 opacity-80">{st.lastError}</p> : null}
    </div>
  );
}
