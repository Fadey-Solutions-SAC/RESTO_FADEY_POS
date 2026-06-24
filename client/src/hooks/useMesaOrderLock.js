import { useRef, useCallback } from 'react';

/**
 * Mesa activa para tomar pedido: se congela al abrir el panel y persiste
 * con refrescos de datos. Al elegir otra mesa, el lock se actualiza sin error.
 */
export function useMesaOrderLock() {
  const lockRef = useRef(null);

  const lockMesa = useCallback((table) => {
    if (!table?.id) {
      lockRef.current = null;
      return;
    }
    lockRef.current = {
      id: String(table.id),
      number: String(table.number ?? '').trim(),
      name: String(table.name ?? '').trim(),
    };
  }, []);

  const clearMesaLock = useCallback(() => {
    lockRef.current = null;
  }, []);

  const syncLockRenumber = useCallback((liveTable) => {
    const lock = lockRef.current;
    if (!lock || !liveTable?.id || String(liveTable.id) !== lock.id) return;
    const liveNumber = String(liveTable.number ?? '').trim();
    const liveName = String(liveTable.name ?? '').trim();
    if (liveNumber !== lock.number || (liveName && liveName !== lock.name)) {
      lockRef.current = {
        ...lock,
        number: liveNumber,
        name: liveName || lock.name,
      };
    }
  }, []);

  const resolveLockedTable = useCallback((tablesList, fallbackTable) => {
    const lock = lockRef.current;
    if (!lock) return fallbackTable || null;
    const fresh = (tablesList || []).find((t) => String(t.id) === lock.id);
    const base = fresh || (fallbackTable && String(fallbackTable.id) === lock.id ? fallbackTable : null);
    if (!base) return null;
    syncLockRenumber(base);
    return {
      ...base,
      id: lockRef.current.id,
      number: lockRef.current.number,
      name: lockRef.current.name,
    };
  }, [syncLockRenumber]);

  const validateMesaForSubmit = useCallback((tablesList, fallbackTable) => {
    const resolved = resolveLockedTable(tablesList, fallbackTable);
    if (!resolved?.id) return 'Selecciona una mesa';
    return null;
  }, [resolveLockedTable]);

  return {
    lockRef,
    lockMesa,
    clearMesaLock,
    syncLockRenumber,
    validateMesaForSubmit,
    resolveLockedTable,
    getMesaLock: () => lockRef.current,
  };
}
