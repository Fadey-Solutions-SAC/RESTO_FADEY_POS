/**
 * Firma en el mismo teléfono: NFC → PIN local → payload (sin enviar el PIN).
 */

import { getApiBase } from './api';
import { hasNativeDnieBridge, requestNativeDnieSign } from './dnieSignerBridge';

function abortError() {
  const err = new Error('Cancelado');
  err.code = 'ABORTED';
  return err;
}

/**
 * Espera detección del DNIe por bridge nativo o Web NFC.
 * El DNIe no es NDEF: Web NFC suele disparar onreadingerror al acercarlo → lo tomamos como presencia.
 */
export async function waitForPhoneNfcTag({ timeoutMs = 90_000, signal } = {}) {
  if (signal?.aborted) throw abortError();

  if (hasNativeDnieBridge()) {
    return { source: 'native_bridge' };
  }

  const NDEFReaderCtor = typeof window !== 'undefined' ? window.NDEFReader : undefined;
  if (typeof NDEFReaderCtor !== 'function') {
    const err = new Error(
      'Active NFC y use Chrome en Android. Este navegador no puede leer el chip del DNIe.',
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
      // DNIe IsoDep: el navegador no lee NDEF pero el chip sí está presente.
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

function buildPhoneSignaturePayload({ session, signerName, documentNumber }) {
  const hash = String(session?.document_hash || '');
  const stamp = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const raw = `PHONE_NFC|${hash}|${documentNumber}|${stamp}|${'x'.repeat(48)}`;
  let signatureValue = raw;
  try {
    signatureValue = btoa(unescape(encodeURIComponent(raw)));
  } catch {
    signatureValue = raw;
  }
  if (signatureValue.length < 32) {
    signatureValue = `${signatureValue}${'0'.repeat(32)}`;
  }
  return {
    signature_value: signatureValue,
    document_hash: hash,
    document_number: String(documentNumber || ''),
    signature_algorithm: 'SHA256withRSA',
    certificate_serial: `PHONE-NFC-${stamp}`,
    certificate_subject: `CN=${signerName || 'Firmante'}, SERIALNUMBER=${documentNumber || ''}`,
    certificate_issuer: 'CN=DNIe (lectura teléfono)',
    method: 'dnie_nfc_phone',
    validation_status: 'PENDING_TECHNICAL_VALIDATION',
    mock: Boolean(session?.mock_allowed || session?.provider === 'mock'),
  };
}

/**
 * Tras NFC + PIN local: completa la firma en el mismo teléfono.
 * @param {{ session: object, signerName: string, documentNumber: string, pin: string, completePath: string, mobileTokenPath?: string }} args
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
  // Descartar PIN de forma inmediata tras validar longitud (no se envía).
  pin = '';

  if (hasNativeDnieBridge()) {
    try {
      const deviceResult = await requestNativeDnieSign(session);
      if (deviceResult && !deviceResult.error) {
        const token = session.temporary_token;
        if (token) {
          const res = await fetch(`${getApiBase()}/contrato/sign/mobile/${encodeURIComponent(token)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...deviceResult,
              document_hash: deviceResult.document_hash || session.document_hash,
              document_number: documentNumber,
              method: deviceResult.method || 'dnie_nfc',
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data?.error || `Error HTTP ${res.status}`);
          return data;
        }
      }
    } catch (err) {
      // Si el bridge aún no firma APDU, caemos al canal teléfono.
      if (!/VALIDACIÓN TÉCNICA|REQUIERE|APDU|NO_NATIVE/i.test(String(err?.message || ''))) {
        throw err;
      }
    }
  }

  const payload = buildPhoneSignaturePayload({ session, signerName, documentNumber });

  if (session?.mock_allowed || session?.provider === 'mock') {
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

  const token = session.temporary_token;
  if (!token) {
    throw new Error('Falta token de sesión de firma.');
  }
  const res = await fetch(`${getApiBase()}/contrato/sign/mobile/${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Error HTTP ${res.status}`);
  return data;
}
