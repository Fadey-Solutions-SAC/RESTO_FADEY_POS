import { getApiBase } from './api';

let timer = null;
let ticking = false;

async function sendHeartbeat() {
  if (ticking) return;
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  if (!token) return;
  ticking = true;
  try {
    await fetch(`${String(getApiBase()).replace(/\/$/, '')}/assistant/pos-heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      body: '{}',
      cache: 'no-store',
    });
  } catch (_) {
    /* sin red: el APK usará openRegisters del servidor */
  } finally {
    ticking = false;
  }
}

/** Mientras haya caja/sesión de trabajo, avisa al servidor para que el APK se reactive. */
export function startAssistantPosHeartbeat(enabled) {
  stopAssistantPosHeartbeat();
  if (!enabled) return;
  void sendHeartbeat();
  timer = setInterval(() => {
    void sendHeartbeat();
  }, 30_000);
}

export function stopAssistantPosHeartbeat() {
  if (timer) clearInterval(timer);
  timer = null;
}
