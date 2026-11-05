/**
 * Envía el comprobante al bot e-fact de esta PC (puerto 8765).
 * El API de internet no puede usar 127.0.0.1 de la caja.
 */

function relayTargets() {
  const list = [
    'http://127.0.0.1:8765/emitir',
    'http://localhost:8765/emitir',
  ];
  if (typeof window !== 'undefined') {
    try {
      const saved = String(window.localStorage?.getItem('resto_local_printing_api') || '').trim().replace(/\/$/, '');
      if (saved) list.push(`${saved}/api/efact/emitir`);
    } catch (_) {
      /* sin localStorage */
    }
  }
  list.push('http://127.0.0.1:3002/api/efact/emitir');
  return [...new Set(list)];
}

async function postJson(url, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 70000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let parsed = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch (_) {
      parsed = { ok: false, error: text.slice(0, 300) || `Respuesta inválida de ${url}` };
    }
    if (!res.ok && parsed.ok !== false) {
      parsed.ok = false;
      if (!parsed.error) parsed.error = `El bot respondió HTTP ${res.status}`;
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

export async function postSaleToLocalBot(sale) {
  let lastMessage = 'No se pudo contactar el bot de facturación en esta PC (puerto 8765).';
  for (const url of relayTargets()) {
    try {
      return await postJson(url, sale);
    } catch (err) {
      const msg = String(err?.message || err || '');
      if (err?.name === 'AbortError') {
        lastMessage = 'El bot de facturación tardó demasiado en responder.';
      } else if (msg) {
        lastMessage = msg;
      }
    }
  }
  throw new Error(
    `${lastMessage} Deje abierto Resto FADEY junto al reloj en esta computadora y pulse Reintentar.`,
  );
}

export async function localEfactReachable() {
  const checks = ['http://127.0.0.1:8765/health', 'http://127.0.0.1:3002/api/health'];
  for (const url of checks) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 800);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (res.ok) return true;
    } catch (_) {
      /* esta PC no tiene el bot */
    } finally {
      clearTimeout(timer);
    }
  }
  return false;
}
