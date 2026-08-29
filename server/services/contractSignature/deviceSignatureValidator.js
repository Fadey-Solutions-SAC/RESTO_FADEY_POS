/**
 * Validación estructural del resultado DNIe enviado por el dispositivo.
 * NO implementa APDU ni verifica CMS con CA RENIEC: REQUIERE VALIDACIÓN TÉCNICA.
 */
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
 * @returns {{ ok: true, level: string, notes: string[] } | never}
 */
function validateDeviceSignaturePayload(payload, { documentHash } = {}) {
  rejectPinFields(payload);
  const p = payload && typeof payload === 'object' ? payload : {};
  const notes = [];
  const signatureValue = String(p.signature_value || p.cms || p.pkcs7 || '').trim();
  if (!signatureValue) {
    const err = new Error('Falta signature_value (CMS/PKCS#7 o blob de firma del DNIe).');
    err.status = 400;
    throw err;
  }
  if (signatureValue.length < 32 && !p.mock) {
    const err = new Error('signature_value demasiado corto para una firma DNIe real.');
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
  if (method.includes('mock')) {
    notes.push('Payload marcado como mock desde dispositivo');
  }

  // Heurística suave: CMS en Base64 suele ser largo; no fallar si no lo es (apps pueden enviar hex).
  if (/^[A-Za-z0-9+/=]+$/.test(signatureValue) && signatureValue.length > 200) {
    notes.push('Parece CMS/Base64');
  } else {
    notes.push('Formato de firma no verificado criptográficamente');
  }

  notes.push('REQUIERE VALIDACIÓN TÉCNICA: verificar firma y certificado con biblioteca oficial DNIe Perú');

  return {
    ok: true,
    level: 'structural_only',
    notes,
    signature_value: signatureValue,
    method: String(p.method || 'dnie_nfc'),
    signature_algorithm: String(p.signature_algorithm || p.algorithm || 'SHA256withRSA'),
    certificate_serial: String(p.certificate_serial || ''),
    certificate_subject: String(p.certificate_subject || ''),
    certificate_issuer: String(p.certificate_issuer || ''),
    certificate_valid_from: String(p.certificate_valid_from || ''),
    certificate_valid_to: String(p.certificate_valid_to || ''),
    document_number: String(p.document_number || ''),
    validation_status: String(p.validation_status || 'PENDING_TECHNICAL_VALIDATION'),
    mock: Boolean(p.mock),
  };
}

module.exports = {
  rejectPinFields,
  validateDeviceSignaturePayload,
};
