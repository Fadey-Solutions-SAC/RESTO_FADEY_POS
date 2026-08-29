/**
 * Bridge WebView ↔ app Android nativa.
 * La app inyecta window.RestoFadeyDnie y llama onReady; la página web llama sign(session).
 * El PIN solo se pide en nativo. Nunca debe aparecer en JS ni en red.
 */

export function getNativeDnieBridge() {
  if (typeof window === 'undefined') return null;
  const b = window.RestoFadeyDnie;
  if (!b || typeof b !== 'object') return null;
  return b;
}

export function hasNativeDnieBridge() {
  const b = getNativeDnieBridge();
  return Boolean(b && (typeof b.sign === 'function' || typeof b.signAsync === 'function'));
}

/**
 * @param {{ document_hash: string, request_id?: string, party?: string, pdf_url?: string }} session
 * @returns {Promise<object>} payload para POST /sign/mobile/:token (sin PIN)
 */
export async function requestNativeDnieSign(session) {
  const b = getNativeDnieBridge();
  if (!b) {
    const err = new Error('App Android de firma no detectada. Instale RESTO FADEY Firma DNIe.');
    err.code = 'NO_NATIVE_BRIDGE';
    throw err;
  }

  const payload = {
    document_hash: session.document_hash,
    request_id: session.request_id,
    party: session.party,
    pdf_url: session.pdf_url || session.pdf_path || '',
  };

  if (typeof b.signAsync === 'function') {
    return b.signAsync(payload);
  }
  if (typeof b.sign === 'function') {
    return Promise.resolve(b.sign(payload));
  }
  const err = new Error('El bridge nativo no expone sign/signAsync.');
  err.code = 'BRIDGE_INCOMPLETE';
  throw err;
}

/** Contrato documentado para el equipo Android. */
export const DNIE_BRIDGE_CONTRACT = {
  global: 'window.RestoFadeyDnie',
  methods: {
    signAsync: 'async ({ document_hash, request_id, party, pdf_url }) => DeviceSignaturePayload',
    getCapabilities: '() => ({ nfc: true, dnie: true, version: string })',
  },
  devicePayload: {
    signature_value: 'CMS/PKCS7 o blob (obligatorio)',
    document_hash: 'debe coincidir',
    certificate_serial: 'opcional',
    certificate_subject: 'opcional',
    certificate_issuer: 'opcional',
    signature_algorithm: 'ej. SHA256withRSA',
    document_number: 'DNI',
    method: 'dnie_nfc',
    mock: false,
  },
  forbidden: ['pin', 'password', 'clave', 'puk'],
  technical: 'APDU DNIe Perú REQUIERE VALIDACIÓN TÉCNICA — no inventar comandos.',
};
