import { useEffect } from 'react';
import { api, getApiBase } from './api';
import { localEfactReachable, postSaleToLocalBot } from './efactLocalRelay';

let timer = null;
let ticking = false;

async function relayPendingOnThisPc() {
  if (ticking) return;
  if (!(await localEfactReachable())) return;
  ticking = true;
  try {
    const token = typeof window !== 'undefined' ? window.localStorage.getItem('token') || '' : '';
    if (token) {
      fetch('http://127.0.0.1:3002/api/efact/cloud-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiBase: getApiBase(), token }),
      }).catch(() => {});
    }
    const list = await api.get('/billing/pending-local', { skipOffline: true });
    const docs = Array.isArray(list?.documents) ? list.documents : [];
    for (const row of docs) {
      if (!row?.id) continue;
      let sentToBot = false;
      try {
        const claimed = await api.post(`/billing/${encodeURIComponent(row.id)}/claim-local`, {}, { skipOffline: true });
        const bot = await postSaleToLocalBot(claimed?.sale);
        sentToBot = true;
        await api.post(`/billing/${encodeURIComponent(row.id)}/local-result`, { bot }, { skipOffline: true });
      } catch (err) {
        if (!sentToBot && err?.status !== 409) {
          await api.post(`/billing/${encodeURIComponent(row.id)}/release-local`, {}, { skipOffline: true }).catch(() => {});
        }
      }
    }
  } catch (_) {
    /* sin sesión o sin pendientes */
  } finally {
    ticking = false;
  }
}

/** La caja abierta en esta PC envía la factura que el cajero pidió desde el teléfono. */
export function startEfactPcRelay(user) {
  stopEfactPcRelay();
  if (!user || user.type === 'customer') return;
  if (!['admin', 'cajero'].includes(String(user.role || ''))) return;
  relayPendingOnThisPc();
  timer = setInterval(relayPendingOnThisPc, 5000);
}

export function stopEfactPcRelay() {
  if (timer) clearInterval(timer);
  timer = null;
}

export function useEfactPcRelay(user) {
  useEffect(() => {
    startEfactPcRelay(user);
    return () => stopEfactPcRelay();
  }, [user]);
}
