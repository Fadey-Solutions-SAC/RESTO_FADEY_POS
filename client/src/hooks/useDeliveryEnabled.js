import { useState, useEffect } from 'react';
import { api } from '../utils/api';

const listeners = new Set();
let cachedEnabled = null;
let inflight = null;

export function isDeliveryEnabledValue(raw) {
  return Number(raw) === 1;
}

export function notifyDeliveryEnabledChanged(enabled) {
  cachedEnabled = Boolean(enabled);
  listeners.forEach((fn) => fn(cachedEnabled));
}

async function fetchDeliveryEnabledOnce() {
  if (cachedEnabled !== null) return cachedEnabled;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const r = await api.get('/restaurant');
      cachedEnabled = isDeliveryEnabledValue(r?.delivery_enabled);
    } catch {
      cachedEnabled = false;
    }
    return cachedEnabled;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Estado confirmado desde Mi Restaurante (enabled + loaded). */
export function useDeliverySettings() {
  const [enabled, setEnabled] = useState(cachedEnabled ?? false);
  const [loaded, setLoaded] = useState(cachedEnabled !== null);

  useEffect(() => {
    let alive = true;
    const apply = (value) => {
      if (!alive) return;
      setEnabled(Boolean(value));
      setLoaded(true);
    };
    fetchDeliveryEnabledOnce().then(apply);
    const onChange = (value) => apply(value);
    listeners.add(onChange);
    return () => {
      alive = false;
      listeners.delete(onChange);
    };
  }, []);

  return { enabled, loaded };
}

/**
 * Para ocultar UI de delivery: solo oculta cuando ya se confirmó que está desactivado.
 * Evita parpadeos al cargar la app con delivery activo.
 */
export function useShowDeliveryUi() {
  const { enabled, loaded } = useDeliverySettings();
  return !loaded || enabled;
}

/** @deprecated Prefer useShowDeliveryUi o useDeliverySettings */
export function useDeliveryEnabled() {
  return useShowDeliveryUi();
}
