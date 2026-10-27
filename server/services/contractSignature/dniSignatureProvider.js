/**
 * Abstracción DNIe.
 * - mock: firma de prueba en servidor (solo desarrollo / ALLOW_MOCK_DNIE).
 * - real: la firma criptográfica ocurre en el teléfono (NFC + PIN local).
 *   El servidor solo acepta el resultado del dispositivo; NUNCA recibe el PIN.
 *   APDU oficiales: REQUIERE VALIDACIÓN TÉCNICA — no inventados aquí.
 */

const { validateDeviceSignaturePayload } = require('./deviceSignatureValidator');
const { getReniecVerifyStatus, isStrictRealMode } = require('./reniecCmsVerify');

function createMockDniSignatureProvider() {
  return {
    name: 'mock',
    mode: 'mock',
    async sign({ documentHash, party, signer }) {
      const serial = `MOCK-${String(party || 'x').toUpperCase()}-${Date.now().toString(36)}`;
      return {
        ok: true,
        mock: true,
        method: 'mock_dnie',
        signature_algorithm: 'MOCK-SHA256-RSA',
        signature_value: `MOCK_SIG_${String(documentHash || '').slice(0, 16)}_${serial}`,
        certificate_serial: serial,
        certificate_subject: `CN=${signer?.name || 'Firmante MOCK'}, SERIALNUMBER=${signer?.document_number || '00000000'}`,
        certificate_issuer: 'CN=MOCK DNIe CA (SOLO DESARROLLO)',
        certificate_valid_from: new Date().toISOString(),
        certificate_valid_to: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
        document_number: String(signer?.document_number || '00000000'),
        validation_status: 'VALID',
      };
    },
  };
}

/**
 * Proveedor real: no firma en el servidor.
 * La app Android / WebView envía el blob vía POST /api/contrato/sign/mobile/:token.
 */
function createRealDniSignatureProvider() {
  return {
    name: 'real',
    mode: 'device',
    async sign() {
      const err = new Error(
        'La firma DNIe real se realiza en el teléfono (NFC + PIN local). '
        + 'Use el canal móvil o espere a que la app envíe el resultado. '
        + 'REQUIERE VALIDACIÓN TÉCNICA de APDU oficiales del DNIe peruano.',
      );
      err.status = 501;
      err.code = 'DNIE_DEVICE_REQUIRED';
      throw err;
    },
    acceptDeviceResult(devicePayload, { documentHash } = {}) {
      const checked = validateDeviceSignaturePayload(devicePayload, { documentHash });
      // VALID solo si el validador criptográfico lo otorgó (o MOCK en desarrollo).
      let status = checked.validation_status;
      if (!checked.mock && status === 'VALID' && checked.level !== 'cryptographic') {
        status = 'PENDING_TECHNICAL_VALIDATION';
      }
      return {
        ok: true,
        mock: Boolean(checked.mock),
        method: checked.method,
        signature_algorithm: checked.signature_algorithm,
        signature_value: checked.signature_value,
        certificate_serial: checked.certificate_serial,
        certificate_subject: checked.certificate_subject,
        certificate_issuer: checked.certificate_issuer,
        certificate_valid_from: checked.certificate_valid_from,
        certificate_valid_to: checked.certificate_valid_to,
        document_number: checked.document_number,
        validation_status: checked.mock ? 'VALID' : status,
        technical_note: checked.notes.join(' | '),
        verification_level: checked.level,
      };
    },
  };
}

function getProviderMode() {
  return String(process.env.CONTRACT_DNIE_PROVIDER || 'mock').toLowerCase();
}

function mockAllowed() {
  const mode = getProviderMode();
  if (mode !== 'mock' && mode !== 'auto') return false;
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_MOCK_DNIE !== '1') return false;
  return true;
}

function getDniSignatureProvider() {
  const mode = getProviderMode();
  if (mode === 'real') return createRealDniSignatureProvider();
  if (mode === 'auto') {
    return createRealDniSignatureProvider();
  }
  if (process.env.NODE_ENV === 'production' && mode === 'mock' && process.env.ALLOW_MOCK_DNIE !== '1') {
    throw new Error(
      'Mock DNIe deshabilitado en producción. Configure ALLOW_MOCK_DNIE=1 solo para pruebas controladas, '
      + 'o CONTRACT_DNIE_PROVIDER=real para canal móvil NFC.',
    );
  }
  return createMockDniSignatureProvider();
}

function requiresNativeBridge() {
  return isStrictRealMode();
}

function apduReadyFromEnv() {
  return String(process.env.DNIE_APDU_READY || '') === '1';
}

module.exports = {
  createMockDniSignatureProvider,
  createRealDniSignatureProvider,
  getDniSignatureProvider,
  getProviderMode,
  mockAllowed,
  requiresNativeBridge,
  apduReadyFromEnv,
  getReniecVerifyStatus,
};
