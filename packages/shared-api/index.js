const {
  readClientIdentity,
  isCentralSyncConfigured,
} = require('../shared-config');
const { SYNC_EVENT_TYPES } = require('../shared-types');

function serviceHeaders(identity, extraHeaders = {}) {
  return {
    Authorization: `Bearer ${identity.apiSecretKey}`,
    'X-Client-Id': identity.clientId,
    'X-WebService-Id': identity.webServiceId || identity.clientId,
    'X-License-Key': identity.licenseKey || identity.clientId,
    ...extraHeaders,
  };
}

/**
 * Cliente de sincronización hacia la plataforma central.
 * Fire-and-forget: no bloquea el POS si la central está caída.
 */
function createCentralSyncClient(options = {}) {
  const identity = options.identity || readClientIdentity(options.env);
  const fetchImpl = options.fetch || global.fetch;
  const log = options.log || console;

  async function getJson(path, extraHeaders = {}) {
    if (!isCentralSyncConfigured(identity)) {
      return { skipped: true, reason: 'central_not_configured' };
    }
    const url = `${identity.centralPlatformUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const headers = serviceHeaders(identity, extraHeaders);
    try {
      const res = await fetchImpl(url, { method: 'GET', headers });
      const text = await res.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch (_) {
        data = { raw: text };
      }
      if (!res.ok) {
        log.warn('[central-sync] HTTP', res.status, path, data?.error || text?.slice(0, 200));
        return { ok: false, status: res.status, data };
      }
      return { ok: true, status: res.status, data };
    } catch (err) {
      log.warn('[central-sync] error', path, err.message || err);
      return { ok: false, error: err.message || String(err) };
    }
  }

  async function postJson(path, body, extraHeaders = {}) {
    if (!isCentralSyncConfigured(identity)) {
      return { skipped: true, reason: 'central_not_configured' };
    }
    const url = `${identity.centralPlatformUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const headers = {
      'Content-Type': 'application/json',
      ...serviceHeaders(identity, extraHeaders),
    };
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch (_) {
        data = { raw: text };
      }
      if (!res.ok) {
        log.warn('[central-sync] HTTP', res.status, path, data?.error || text?.slice(0, 200));
        return { ok: false, status: res.status, data };
      }
      return { ok: true, status: res.status, data };
    } catch (err) {
      log.warn('[central-sync] error', path, err.message || err);
      return { ok: false, error: err.message || String(err) };
    }
  }

  function basePayload() {
    return {
      clientId: identity.clientId,
      restaurantId: identity.restaurantId || identity.clientId,
      webServiceId: identity.webServiceId || identity.clientId,
      licenseKey: identity.licenseKey || identity.clientId,
      sourceWebServiceUrl: identity.publicApiUrl || null,
      syncedAt: new Date().toISOString(),
    };
  }

  return {
    identity,
    isConfigured: () => isCentralSyncConfigured(identity),
    async syncEvent(eventType, payload) {
      return postJson('/api/sync/events', {
        ...basePayload(),
        eventType,
        payload,
      });
    },
    /** Payload mínimo acordado con el panel SaaS (sin datos operativos). */
    async syncMinimalPayment(payment) {
      return postJson('/api/payments', payment);
    },
    /** Perfil del POS hacia el panel (plan, URL Render, contacto). */
    async syncClientProfile(profile) {
      return postJson('/api/clients/profile', profile);
    },
    async syncPayment(payment) {
      return postJson('/api/payments', {
        ...basePayload(),
        ...payment,
      });
    },
    async fetchPaymentStatus({ referencia } = {}) {
      const qs = new URLSearchParams({ clientId: identity.clientId });
      if (referencia) qs.set('referencia', String(referencia));
      return getJson(`/api/payments/status?${qs.toString()}`);
    },
    async fetchLicenseStatus(clientId) {
      const id = String(clientId || identity.clientId || '').trim();
      if (!id) return { ok: false, error: 'clientId requerido' };
      return getJson(`/api/license-status/${encodeURIComponent(id)}`);
    },
    async syncUser(user) {
      return postJson('/api/sync/users', {
        ...basePayload(),
        user,
      });
    },
    SYNC_EVENT_TYPES,
  };
}

module.exports = {
  createCentralSyncClient,
};
