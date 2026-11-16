import { useState, useEffect } from 'react';
import { api } from '../utils/api';

const listeners = new Set();
let cachedEnabled = null;
let inflight = null;
let cacheRevision = 0;

export function isHotelEnabledValue(raw) {
  return Number(raw) === 1;
}

export function notifyHotelEnabledChanged(enabled) {
  cacheRevision += 1;
  cachedEnabled = Boolean(enabled);
  listeners.forEach((fn) => fn(cachedEnabled));
}

async function fetchHotelEnabledOnce() {
  if (cachedEnabled !== null) return cachedEnabled;
  if (inflight) return inflight;
  const revisionAtStart = cacheRevision;
  inflight = (async () => {
    try {
      const r = await api.get('/restaurant');
      if (revisionAtStart !== cacheRevision) return cachedEnabled;
      cachedEnabled = isHotelEnabledValue(r?.hotel_enabled);
    } catch {
      if (revisionAtStart !== cacheRevision) return cachedEnabled;
      cachedEnabled = false;
    }
    return cachedEnabled;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Estado confirmado desde Mi Restaurante (enabled + loaded). */
export function useHotelSettings() {
  const [enabled, setEnabled] = useState(cachedEnabled ?? false);
  const [loaded, setLoaded] = useState(cachedEnabled !== null);

  useEffect(() => {
    let alive = true;
    const apply = (value) => {
      if (!alive) return;
      setEnabled(Boolean(value));
      setLoaded(true);
    };
    fetchHotelEnabledOnce().then(apply);
    const onChange = (value) => apply(value);
    listeners.add(onChange);
    return () => {
      alive = false;
      listeners.delete(onChange);
    };
  }, []);

  return { enabled, loaded };
}

/** Oculta Hotelería solo cuando ya se confirmó que está desactivada. */
export function useShowHotelUi() {
  const { enabled, loaded } = useHotelSettings();
  return !loaded || enabled;
}
