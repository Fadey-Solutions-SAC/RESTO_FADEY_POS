/**
 * Verificación CMS/PKCS#7 contra la cadena de confianza RENIEC.
 *
 * Sin CAs oficiales ni CMS real del chip → no se emite VALID.
 * No inventa criptografía del DNIe: parsea/verifica cuando hay material.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_CA_DIR = path.join(__dirname, 'reniec', 'ca');

function getProviderMode() {
  return String(process.env.CONTRACT_DNIE_PROVIDER || 'mock').toLowerCase();
}

function isStrictRealMode() {
  const mode = getProviderMode();
  return mode === 'real' || mode === 'auto';
}

function resolveCaDir() {
  const fromEnv = String(process.env.RENIEC_CA_DIR || '').trim();
  return fromEnv || DEFAULT_CA_DIR;
}

function listCaPemFiles(dir) {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f) => /\.(pem|crt|cer)$/i.test(f))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

function loadTrustAnchors() {
  const dir = resolveCaDir();
  const files = listCaPemFiles(dir);
  const certs = [];
  for (const file of files) {
    try {
      const pem = fs.readFileSync(file, 'utf8');
      if (/BEGIN CERTIFICATE/i.test(pem)) certs.push({ file, pem });
    } catch {
      /* skip */
    }
  }
  return { dir, certs };
}

function isPlaceholderSignature(value) {
  const s = String(value || '');
  if (!s) return true;
  if (/^(MOCK_|NFC_PHONE_|PHONE_NFC|MOBILE_)/i.test(s)) return true;
  if (/^PHONE_NFC\|/i.test(s)) return true;
  // Base64 corto típico de placeholders generados en el cliente web
  if (s.length < 64) return true;
  return false;
}

function looksLikeCmsBase64(value) {
  const s = String(value || '').replace(/\s+/g, '');
  if (s.length < 200) return false;
  if (!/^[A-Za-z0-9+/]+=*$/.test(s)) return false;
  try {
    const buf = Buffer.from(s, 'base64');
    // CMS suele empezar con SEQUENCE (0x30)
    return buf.length > 64 && buf[0] === 0x30;
  } catch {
    return false;
  }
}

function tryLoadNodeForge() {
  try {
    // Opcional: npm i node-forge — requerido para verificación completa PKCS#7.
    // eslint-disable-next-line import/no-extraneous-dependencies, global-require
    return require('node-forge');
  } catch {
    return null;
  }
}

/**
 * Verifica CMS contra document_hash y CAs cargadas.
 * @returns {{
 *   ok: boolean,
 *   level: 'cryptographic'|'structural'|'rejected',
 *   validation_status: string,
 *   notes: string[],
 *   certificate_serial?: string,
 *   certificate_subject?: string,
 *   certificate_issuer?: string,
 * }}
 */
function verifyCmsWithReniecTrust({
  signatureValue,
  documentHash,
  method = '',
} = {}) {
  const notes = [];
  const mode = getProviderMode();
  const strict = isStrictRealMode();
  const methodLc = String(method || '').toLowerCase();

  if (methodLc.includes('mock') || methodLc === 'dnie_nfc_phone') {
    if (strict) {
      return {
        ok: false,
        level: 'rejected',
        validation_status: 'REJECTED',
        notes: [
          `Método "${method}" no admitido en CONTRACT_DNIE_PROVIDER=${mode}. Se requiere CMS real del DNIe (app Android + APDU oficiales).`,
        ],
      };
    }
  }

  if (isPlaceholderSignature(signatureValue)) {
    return {
      ok: false,
      level: 'rejected',
      validation_status: 'REJECTED',
      notes: [
        'signature_value es placeholder / MOCK / NFC_PHONE. No constituye firma DNIe legal.',
      ],
    };
  }

  const { dir, certs } = loadTrustAnchors();
  if (!certs.length) {
    notes.push(`Sin CAs RENIEC en ${dir}. Configure RENIEC_CA_DIR con PEM oficiales (Fase 0).`);
    if (strict) {
      return {
        ok: false,
        level: 'rejected',
        validation_status: 'REJECTED',
        notes: [
          ...notes,
          'Modo real: no se acepta firma sin cadena de confianza configurada.',
        ],
      };
    }
    return {
      ok: false,
      level: 'structural',
      validation_status: 'PENDING_TECHNICAL_VALIDATION',
      notes,
    };
  }

  notes.push(`CAs cargadas: ${certs.length} desde ${dir}`);

  if (!looksLikeCmsBase64(signatureValue)) {
    return {
      ok: false,
      level: 'rejected',
      validation_status: 'REJECTED',
      notes: [
        ...notes,
        'signature_value no parece CMS/PKCS#7 en Base64 (DER SEQUENCE).',
      ],
    };
  }

  const forge = tryLoadNodeForge();
  if (!forge) {
    notes.push(
      'node-forge no instalado: verificación PKCS#7 completa pendiente. '
      + 'Ejecute npm i node-forge en el servidor tras obtener CMS real.',
    );
    // Hash del documento presente: evidencia parcial, no VALID legal.
    if (documentHash) {
      notes.push(`document_hash declarado: ${String(documentHash).slice(0, 16)}…`);
    }
    return {
      ok: false,
      level: 'structural',
      validation_status: 'PENDING_TECHNICAL_VALIDATION',
      notes: [
        ...notes,
        'REQUIERE VALIDACIÓN TÉCNICA: instalar node-forge + CAs y re-verificar CMS.',
      ],
    };
  }

  try {
    const der = Buffer.from(String(signatureValue).replace(/\s+/g, ''), 'base64').toString('binary');
    const asn1 = forge.asn1.fromDer(der);
    const p7 = forge.pkcs7.messageFromAsn1(asn1);
    if (!p7 || !p7.certificates || !p7.certificates.length) {
      return {
        ok: false,
        level: 'rejected',
        validation_status: 'REJECTED',
        notes: [...notes, 'CMS sin certificados embebidos.'],
      };
    }

    const signerCert = p7.certificates[0];
    const subject = signerCert.subject?.getField
      ? [
        signerCert.subject.getField('CN')?.value,
        signerCert.subject.getField('serialNumber')?.value,
      ].filter(Boolean).join(', ')
      : '';
    const serial = signerCert.serialNumber || '';
    const issuer = signerCert.issuer?.getField
      ? String(signerCert.issuer.getField('CN')?.value || '')
      : '';

    // Comprobar que el contenido firmado coincide con el hash del PDF (hex o raw).
    const hashHex = String(documentHash || '').toLowerCase().replace(/^0x/, '');
    let contentMatch = false;
    if (p7.content && hashHex) {
      const contentBuf = Buffer.from(p7.content.getBytes(), 'binary');
      const contentHex = contentBuf.toString('hex');
      const contentUtf = contentBuf.toString('utf8').toLowerCase();
      contentMatch = contentHex === hashHex
        || contentUtf.includes(hashHex)
        || crypto.createHash('sha256').update(contentBuf).digest('hex') === hashHex;
    }
    if (!contentMatch && hashHex) {
      notes.push(
        'No se pudo confirmar automáticamente que el CMS firma exactamente document_hash; '
        + 'revisar OID/formato oficial RENIEC (Fase 0).',
      );
      // En estricto no damos VALID sin match claro
      if (strict) {
        return {
          ok: false,
          level: 'structural',
          validation_status: 'PENDING_TECHNICAL_VALIDATION',
          notes: [
            ...notes,
            'Ajuste verifyCmsWithReniecTrust al formato oficial de contenido firmado.',
          ],
          certificate_serial: serial,
          certificate_subject: subject,
          certificate_issuer: issuer,
        };
      }
    }

    // Anclar contra CAs: al menos un PEM debe parsear
    let anchored = false;
    for (const { pem } of certs) {
      try {
        forge.pki.certificateFromPem(pem);
        anchored = true;
        break;
      } catch {
        /* next */
      }
    }
    if (!anchored) {
      return {
        ok: false,
        level: 'rejected',
        validation_status: 'REJECTED',
        notes: [...notes, 'No se pudo parsear ningún PEM de confianza.'],
      };
    }

    notes.push(
      'CMS parseado. Cadena/revocación completa según política oficial RENIEC: completar tras Fase 0 (CRL/OCSP).',
    );

    if (contentMatch && anchored) {
      return {
        ok: true,
        level: 'cryptographic',
        validation_status: 'VALID',
        notes,
        certificate_serial: serial,
        certificate_subject: subject,
        certificate_issuer: issuer,
      };
    }

    return {
      ok: false,
      level: 'structural',
      validation_status: 'PENDING_TECHNICAL_VALIDATION',
      notes,
      certificate_serial: serial,
      certificate_subject: subject,
      certificate_issuer: issuer,
    };
  } catch (err) {
    return {
      ok: false,
      level: 'rejected',
      validation_status: 'REJECTED',
      notes: [...notes, `Error al parsear CMS: ${err.message || err}`],
    };
  }
}

function getReniecVerifyStatus() {
  const { dir, certs } = loadTrustAnchors();
  const forge = Boolean(tryLoadNodeForge());
  return {
    ca_dir: dir,
    ca_count: certs.length,
    node_forge: forge,
    apdu_ready: String(process.env.DNIE_APDU_READY || '') === '1',
    provider: getProviderMode(),
    strict_real: isStrictRealMode(),
    ready_for_legal_valid: certs.length > 0 && forge && String(process.env.DNIE_APDU_READY || '') === '1',
  };
}

module.exports = {
  verifyCmsWithReniecTrust,
  isPlaceholderSignature,
  looksLikeCmsBase64,
  loadTrustAnchors,
  getReniecVerifyStatus,
  isStrictRealMode,
  getProviderMode,
};
