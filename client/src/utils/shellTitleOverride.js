import { useEffect, useSyncExternalStore } from 'react';

/** Título que un módulo publica en la franja superior del Layout (p. ej. «Panel de Cocina»). */
let current = '';
const listeners = new Set();

function setShellTitleOverride(title) {
  const next = String(title || '');
  if (next === current) return;
  current = next;
  listeners.forEach((fn) => fn());
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useShellTitleOverride() {
  return useSyncExternalStore(subscribe, () => current, () => '');
}

/** Publica `title` mientras el componente esté montado y `enabled` sea verdadero. */
export function usePublishShellTitle(title, enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;
    setShellTitleOverride(title);
    return () => setShellTitleOverride('');
  }, [title, enabled]);
}
