/**
 * Firma en el mismo teléfono: NFC → PIN local → payload (sin enviar el PIN).
 * En modo legal (requires_native_bridge): solo bridge Android IsoDep + CMS real.
 */

import { getApiBase } from './api';
import { hasNativeDnieBridge, requestNativeDnieSign } from './dnieSignerBridge';

function abortError() {
  const err = new Error('Cancelado');
  err.code = 'ABORTED';
  return err;
}

/**
 * Espera detección del DNIe por bridge nativo o Web NFC (solo desarrollo / no-strict).
 */
export async function waitForPhoneNfcTag({ timeoutMs = 90_000, signal, requireNative = false } = {}) {
  if (signal?.aborted) throw abortError();

  if (hasNativeDnieBridge()) {
    return { source: 'native_bridge' };
  }

  if (requireNative) {
    const err = new Error(
      'Firma legal DNIe: abra este contrato en la app Android RESTO FADEY Firma (NFC IsoDep). '
      + 'El navegador no puede ejecutar los APDU del chip.',
    );
    err.code = 'NATIVE_BRIDGE_REQUIRED';
    throw err;
  }

  const NDEFReaderCtor = typeof window !== 'undefined' ? window.NDEFReader : undefined;
  if (typeof NDEFReaderCtor !== 'function') {
    const err = new Error(
      'Active NFC y use Chrome en Android, o la app RESTO FADEY Firma.',
    );
    err.code = 'NFC_UNAVAILABLE';
    throw err;
  }

  const reader = new NDEFReaderCtor();
  try {
    await reader.scan({ signal });
  } catch (err) {
    if (signal?.aborted || err?.name === 'AbortError') throw abortError();
    if (/not allowed|permission|secure/i.test(String(err?.message || err))) {
      const e = new Error('Permita el acceso a NFC cuando el navegador lo pida.');
      e.code = 'NFC_PERMISSION';
      throw e;
    }
    throw err;
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        signal?.removeEventListener('abort', onAbort);
      } catch (_) {
        /* noop */
      }
      fn(value);
    };

    const onAbort = () => finish(reject, abortError());
    const timer = setTimeout(() => {
      finish(reject, Object.assign(new Error('No se detectó el DNI. Acérquelo a la parte trasera e intente de nuevo.'), { code: 'NFC_TIMEOUT' }));
    }, timeoutMs);

    signal?.addEventListener('abort', onAbort, { once: true });

    reader.onreading = (event) => {
      finish(resolve, {
        source: 'web_nfc',
        serialNumber: event?.serialNumber || '',
      });
    };
    reader.onreadingerror = () => {
      finish(resolve, { source: 'web_nfc_presence' });
    };
  });
}

/** PIN solo en memoria del dispositivo; nunca incluir en fetch/body. */
export function assertLocalPin(pin) {
  const digits = String(pin || '').replace(/\D/g, '');
  if (digits.length < 4 || digits.length > 12) {
    const err = new Error('Ingrese el PIN del DNIe (4 a 12 dígitos).');
    err.code = 'PIN_INVALID';
    throw err;
  }
  return digits;
}

/**
 * Tras NFC + PIN local: completa la firma.
 * Modo legal: solo bridge nativo → CMS; sin fallback placeholder.
 */
export async function finishPhoneNfcSignature({
  session,
  signerName,
  documentNumber,
  pin,
  completePath,
  apiPost,
}) {
  assertLocalPin(pin);
  pin = '';

  const requireNative = Boolean(session?.requires_native_bridge);

  if (hasNativeDnieBridge()) {
    const deviceResult = await requestNativeDnieSign(session);
    if (deviceResult?.error) {
      throw new Error(deviceResult.error);
    }
    const token = session.temporary_token;
    if (!token) throw new Error('Falta token de sesión de firma.');
    const res = await fetch(`${getApiBase()}/contrato/sign/mobile/${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...deviceResult,
        document_hash: deviceResult.document_hash || session.document_hash,
        document_number: documentNumber,
        method: deviceResult.method || 'dnie_nfc',
        mock: false,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `Error HTTP ${res.status}`);
    return data;
  }

  if (requireNative) {
    const err = new Error(
      'Para firma legal use la app Android RESTO FADEY Firma. '
      + 'Ahí el PIN desbloquea el chip y se genera el CMS que el servidor verifica con RENIEC.',
    );
    err.code = 'NATIVE_BRIDGE_REQUIRED';
    throw err;
  }

  // Desarrollo / mock_allowed: completar por API autenticada
  if (session?.mock_allowed === true && completePath && typeof apiPost === 'function') {
    return apiPost(completePath, {
      request_id: session.request_id,
      temporary_token: session.temporary_token,
      ack_reviewed: true,
      document_number: documentNumber,
      signer_name: signerName,
      use_mock: true,
      phone_nfc: true,
    });
  }

  const err = new Error(
    'No hay canal de firma DNIe disponible. Use la app Android o habilite MOCK solo en desarrollo.',
  );
  err.code = 'NO_SIGN_CHANNEL';
  throw err;
}
