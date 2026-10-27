/**
 * Validación del resultado DNIe enviado por el dispositivo.
 * En modo real: exige CMS verificable (reniecCmsVerify). Nunca acepta PIN.
 */

const {
  verifyCmsWithReniecTrust,
  isStrictRealMode,
  isPlaceholderSignature,
} = require('./reniecCmsVerify');

function rejectPinFields(body) {
  for (const key of Object.keys(body || {})) {
    if (/pin|password|clave|puk/i.test(key) && body[key] != null && String(body[key]).trim() !== '') {
      const err = new Error('El PIN del DNIe no debe enviarse al servidor. Elimine ese campo.');
      err.status = 400;
      err.code = 'PIN_FORBIDDEN';
      throw err;
    }
  }
}

/**
 * @returns {object} payload normalizado o lanza Error
 */
function validateDeviceSignaturePayload(payload, { documentHash } = {}) {
  rejectPinFields(payload);
  const p = payload && typeof payload === 'object' ? payload : {};
  const notes = [];
  const signatureValue = String(p.signature_value || p.cms || p.pkcs7 || '').trim();
  if (!signatureValue) {
    const err = new Error('Falta signature_value (CMS/PKCS#7 del DNIe).');
    err.status = 400;
    throw err;
  }

  const claimedHash = String(p.document_hash || '').trim();
  if (claimedHash && documentHash && claimedHash !== documentHash) {
    const err = new Error('El document_hash del dispositivo no coincide con el PDF del contrato.');
    err.status = 409;
    throw err;
  }

  const method = String(p.method || 'dnie_nfc').toLowerCase();
  const mock = Boolean(p.mock) || method.includes('mock');

  if (mock && isStrictRealMode()) {
    const err = new Error(
      'Firma MOCK no permitida con CONTRACT_DNIE_PROVIDER=real|auto. Use la app Android con APDU oficiales.',
    );
    err.status = 403;
    err.code = 'MOCK_FORBIDDEN';
    throw err;
  }

  if (!mock && isPlaceholderSignature(signatureValue) && isStrictRealMode()) {
    const err = new Error(
      'Firma incompleta: falta CMS real del DNIe. Abra la firma en la app Android RESTO FADEY Firma '
      + '(NFC IsoDep + APDU oficiales). El navegador solo no produce firma legal.',
    );
    err.status = 422;
    err.code = 'DNIE_CMS_REQUIRED';
    throw err;
  }

  if (mock) {
    notes.push('Payload MOCK (solo desarrollo)');
    return {
      ok: true,
      level: 'mock',
      notes,
      signature_value: signatureValue,
      method: method || 'mock_dnie',
      signature_algorithm: String(p.signature_algorithm || p.algorithm || 'MOCK-SHA256-RSA'),
      certificate_serial: String(p.certificate_serial || ''),
      certificate_subject: String(p.certificate_subject || ''),
      certificate_issuer: String(p.certificate_issuer || ''),
      certificate_valid_from: String(p.certificate_valid_from || ''),
      certificate_valid_to: String(p.certificate_valid_to || ''),
      document_number: String(p.document_number || ''),
      validation_status: 'VALID',
      mock: true,
    };
  }

  const cryptoResult = verifyCmsWithReniecTrust({
    signatureValue,
    documentHash: documentHash || claimedHash,
    method,
  });
  notes.push(...(cryptoResult.notes || []));

  if (!cryptoResult.ok && isStrictRealMode() && cryptoResult.validation_status === 'REJECTED') {
    const err = new Error(notes.join(' ') || 'Firma DNIe rechazada por verificación RENIEC/PKI.');
    err.status = 422;
    err.code = 'DNIE_CMS_REJECTED';
    throw err;
  }

  const validationStatus = cryptoResult.validation_status
    || String(p.validation_status || 'PENDING_TECHNICAL_VALIDATION');

  // Nunca promover a VALID sin verificación criptográfica ok
  const finalStatus = cryptoResult.ok && cryptoResult.level === 'cryptographic'
    ? 'VALID'
    : (validationStatus === 'VALID' ? 'PENDING_TECHNICAL_VALIDATION' : validationStatus);

  return {
    ok: true,
    level: cryptoResult.level || 'structural_only',
    notes,
    signature_value: signatureValue,
    method: method || 'dnie_nfc',
    signature_algorithm: String(p.signature_algorithm || p.algorithm || 'SHA256withRSA'),
    certificate_serial: String(cryptoResult.certificate_serial || p.certificate_serial || ''),
    certificate_subject: String(cryptoResult.certificate_subject || p.certificate_subject || ''),
    certificate_issuer: String(cryptoResult.certificate_issuer || p.certificate_issuer || ''),
    certificate_valid_from: String(p.certificate_valid_from || ''),
    certificate_valid_to: String(p.certificate_valid_to || ''),
    document_number: String(p.document_number || ''),
    validation_status: finalStatus,
    mock: false,
  };
}

module.exports = {
  rejectPinFields,
  validateDeviceSignaturePayload,
};
