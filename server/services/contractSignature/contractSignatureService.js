const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { queryOne, queryAll, runSql, logAudit } = require('../../database');
const { emitStaffDataUpdate } = require('../../socketBroadcast');
const {
  SIGNATURE_STATUSES,
  readContrato,
  writeContrato,
  hashContractText,
  isFullySigned,
  emptyFirmaSlot,
  normalizeContrato,
} = require('../contratoStore');
const {
  getProviderMode,
  mockAllowed,
  createMockDniSignatureProvider,
  createRealDniSignatureProvider,
} = require('./dniSignatureProvider');
const {
  generateContractPdf,
  resolveContractPdfAbsolute,
  hashPdfFile,
} = require('./contractPdf');

const PARTIES = new Set(['comprador', 'vendedor']);

function partyFromRole(role) {
  if (role === 'master_admin') return 'vendedor';
  if (role === 'admin') return 'comprador';
  return '';
}

function ensureSignatureTables() {
  runSql(`
    CREATE TABLE IF NOT EXISTS contract_signature_request (
      id TEXT PRIMARY KEY,
      contract_version INTEGER NOT NULL,
      party TEXT NOT NULL,
      signer_id TEXT NOT NULL,
      signer_name TEXT DEFAULT '',
      document_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      temporary_token TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      started_at TEXT,
      completed_at TEXT,
      details TEXT DEFAULT '{}'
    )
  `);
  runSql(`
    CREATE TABLE IF NOT EXISTS contract_signature (
      id TEXT PRIMARY KEY,
      signature_request_id TEXT NOT NULL,
      contract_version INTEGER NOT NULL,
      party TEXT NOT NULL,
      signer_id TEXT NOT NULL,
      document_hash TEXT NOT NULL,
      signature_value TEXT NOT NULL,
      certificate_serial TEXT DEFAULT '',
      certificate_subject TEXT DEFAULT '',
      certificate_issuer TEXT DEFAULT '',
      signature_algorithm TEXT DEFAULT '',
      signed_at TEXT NOT NULL,
      validation_status TEXT DEFAULT 'VALID',
      mock INTEGER DEFAULT 0,
      details TEXT DEFAULT '{}'
    )
  `);
  runSql('CREATE INDEX IF NOT EXISTS idx_csr_token ON contract_signature_request(temporary_token)');
  runSql('CREATE INDEX IF NOT EXISTS idx_cs_party ON contract_signature(party, contract_version)');
}

function publicApiOrigin() {
  const raw = String(
    process.env.PUBLIC_API_BASE_URL
    || process.env.RENDER_EXTERNAL_URL
    || process.env.RENDER_PUBLIC_URL
    || process.env.NEXT_PUBLIC_API_URL
    || '',
  ).trim().replace(/\/$/, '');
  if (!raw) return '';
  return raw.replace(/\/api$/i, '');
}

function publicContratoView(contrato) {
  const source = normalizeContrato(contrato || readContrato());
  return {
    ...source,
    can_sign_again: !isFullySigned(source),
    text_locked: isFullySigned(source)
      || source.estado_firma === SIGNATURE_STATUSES.FIRMANDO
      || source.firma_comprador?.status === 'firmado'
      || source.firma_vendedor?.status === 'firmado',
  };
}

function assertPartyAllowed(user, party) {
  const expected = partyFromRole(user?.role);
  if (expected && expected !== party && user?.role !== 'master_admin') {
    const err = new Error('No puede firmar en nombre de la otra parte.');
    err.status = 403;
    throw err;
  }
  // Admin del negocio: solo comprador, una vez. Maestro: solo vendedor.
  if (user?.role === 'admin' && party !== 'comprador') {
    const err = new Error('El administrador del restaurante solo puede firmar como comprador (cliente), una sola vez.');
    err.status = 403;
    throw err;
  }
  if (user?.role === 'master_admin' && party !== 'vendedor') {
    const err = new Error('El administrador maestro firma como vendedor (proveedor).');
    err.status = 403;
    throw err;
  }
}

function partyAlreadySignedMessage(party) {
  if (party === 'comprador') {
    return 'El administrador del negocio ya firmó este contrato. Solo puede consultarlo.';
  }
  return `La firma de ${party} ya está registrada en este contrato.`;
}

function publicWebOrigin() {
  const raw = String(
    process.env.PUBLIC_WEB_URL
    || process.env.FRONTEND_URL
    || process.env.CLIENT_ORIGIN
    || '',
  ).trim();
  if (raw) {
    return raw.split(',')[0].trim().replace(/\/$/, '');
  }
  const cors = String(process.env.CORS_ORIGIN || '').trim();
  if (cors && cors !== '*') {
    return cors.split(',')[0].trim().replace(/\/$/, '');
  }
  return publicApiOrigin();
}

function buildMobileLinks(temporaryToken) {
  const apiOrigin = publicApiOrigin();
  const webOrigin = publicWebOrigin();
  const sessionPath = `/api/contrato/sign/mobile/${temporaryToken}`;
  const sessionUrl = apiOrigin ? `${apiOrigin}${sessionPath}` : sessionPath;
  const webPath = `/firmar-contrato?token=${encodeURIComponent(temporaryToken)}`;
  const webSignUrl = webOrigin ? `${webOrigin}${webPath}` : webPath;
  const deepLink = `restofadey://contract-sign?token=${encodeURIComponent(temporaryToken)}`;
  return {
    session_url: sessionUrl,
    deep_link: deepLink,
    session_path: sessionPath,
    web_sign_url: webSignUrl,
    web_sign_path: webPath,
  };
}

async function ensureDefinitivePdf(contrato) {
  const version = contrato.version;
  const texto = String(contrato.texto_contrato || '').trim();
  const existingAbs = resolveContractPdfAbsolute(contrato.pdf_original_url);
  if (existingAbs && contrato.document_hash) {
    const fileHash = hashPdfFile(existingAbs);
    if (fileHash && fileHash === contrato.document_hash) {
      return {
        publicUrl: contrato.pdf_original_url,
        documentHash: contrato.document_hash,
        absolutePath: existingAbs,
      };
    }
  }
  const pdf = await generateContractPdf({
    texto,
    version,
    title: 'Contrato digital de servicio — RESTO FADEY.POS',
  });
  contrato.pdf_original_url = pdf.publicUrl;
  contrato.document_hash = pdf.documentHash;
  return {
    publicUrl: pdf.publicUrl,
    documentHash: pdf.documentHash,
    absolutePath: pdf.absolutePath,
  };
}

async function prepareSignature({ user, party: partyIn, documentNumber = '', signerName: signerNameIn = '' }) {
  ensureSignatureTables();
  const contrato = readContrato();
  if (isFullySigned(contrato)) {
    const err = new Error('Este contrato ya está firmado. Solo se puede firmar una vez por despliegue.');
    err.status = 409;
    throw err;
  }

  const party = String(partyIn || partyFromRole(user?.role) || '').toLowerCase();
  if (!PARTIES.has(party)) {
    const err = new Error('Indique la parte a firmar: comprador (cliente) o vendedor (proveedor).');
    err.status = 400;
    throw err;
  }
  assertPartyAllowed(user, party);

  const slot = party === 'comprador' ? contrato.firma_comprador : contrato.firma_vendedor;
  if (slot?.status === 'firmado') {
    const err = new Error(partyAlreadySignedMessage(party));
    err.status = 409;
    throw err;
  }

  let texto = String(contrato.texto_contrato || '').trim();
  if (!texto) {
    try {
      const { DEFAULT_SERVICE_CONTRACT_TEXT } = require('../../data/defaultServiceContract');
      texto = String(DEFAULT_SERVICE_CONTRACT_TEXT || '').trim();
      contrato.texto_contrato = texto;
    } catch (_) {
      /* ignore */
    }
  }
  if (!texto) {
    const err = new Error('El contrato no tiene texto. El maestro debe guardar el contenido antes de firmar.');
    err.status = 400;
    throw err;
  }

  // Si ya hay PDF/hash de una firma en curso, el texto no puede haber cambiado.
  if (contrato.document_hash && contrato.pdf_original_url) {
    const abs = resolveContractPdfAbsolute(contrato.pdf_original_url);
    const fileHash = abs ? hashPdfFile(abs) : '';
    if (fileHash && fileHash !== contrato.document_hash) {
      const err = new Error('El PDF del contrato no coincide con el hash. Reinicie el proceso de firma.');
      err.status = 409;
      throw err;
    }
  }

  const pdfInfo = await ensureDefinitivePdf(contrato);
  const version = contrato.version;
  const documentHash = pdfInfo.documentHash;
  contrato.document_hash = documentHash;
  contrato.pdf_original_url = pdfInfo.publicUrl;
  contrato.estado_firma = SIGNATURE_STATUSES.FIRMANDO;
  writeContrato(contrato);

  const id = uuidv4();
  const temporaryToken = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const signerName = String(signerNameIn || user?.full_name || user?.username || '').trim();
  const signerId = String(user?.id || '');
  const providerMode = getProviderMode();
  const links = buildMobileLinks(temporaryToken);

  runSql(
    `INSERT INTO contract_signature_request
      (id, contract_version, party, signer_id, signer_name, document_hash, status, temporary_token, expires_at, started_at, details)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, datetime('now'), ?)`,
    [
      id,
      version,
      party,
      signerId,
      signerName,
      documentHash,
      temporaryToken,
      expiresAt,
      JSON.stringify({
        document_number: String(documentNumber || '').trim(),
        signer_name: signerName,
        pdf_original_url: pdfInfo.publicUrl,
        provider_mode: providerMode,
      }),
    ],
  );

  logAudit({
    actorUserId: signerId,
    actorName: signerName,
    action: 'CONTRACT_SIGNATURE_STARTED',
    resourceType: 'contrato',
    resourceId: 'contrato',
    details: {
      party,
      request_id: id,
      contract_version: version,
      document_hash: documentHash,
      pdf_original_url: pdfInfo.publicUrl,
    },
  });
  emitStaffDataUpdate({ domain: 'app_config' });

  return {
    request_id: id,
    temporary_token: temporaryToken,
    expires_at: expiresAt,
    party,
    contract_version: version,
    document_hash: documentHash,
    pdf_original_url: pdfInfo.publicUrl,
    provider: providerMode,
    mock_allowed: mockAllowed(),
    mobile: {
      ...links,
      poll_path: `/api/contrato/sign/status/${id}`,
    },
    instructions: {
      title: 'Firma digital DNIe',
      steps: [
        'Se generó el PDF definitivo y su hash SHA-256.',
        'Abra la app Android de firma o escanee el código / enlace.',
        'Acerque el DNIe al NFC del teléfono e ingrese el PIN solo en el dispositivo.',
        'El PIN nunca se envía a Resto Fadey.',
      ],
      pin_never_sent_to_server: true,
      requires_technical_validation: providerMode === 'real' || providerMode === 'auto',
    },
    contrato: publicContratoView(contrato),
  };
}

function loadPendingRequest({ requestId, temporaryToken, requireSignerId }) {
  const reqRow = queryOne('SELECT * FROM contract_signature_request WHERE id = ?', [String(requestId || '')]);
  if (!reqRow) {
    const err = new Error('Solicitud de firma no encontrada.');
    err.status = 404;
    throw err;
  }
  if (temporaryToken != null && String(reqRow.temporary_token) !== String(temporaryToken || '')) {
    const err = new Error('Token de firma inválido.');
    err.status = 403;
    throw err;
  }
  if (reqRow.status === 'completed') {
    return { reqRow, alreadyDone: true };
  }
  if (reqRow.status !== 'pending') {
    const err = new Error('Esta solicitud de firma ya fue utilizada o cancelada.');
    err.status = 409;
    throw err;
  }
  if (new Date(reqRow.expires_at).getTime() < Date.now()) {
    runSql(`UPDATE contract_signature_request SET status = 'expired' WHERE id = ?`, [reqRow.id]);
    const err = new Error('La solicitud de firma expiró. Inicie de nuevo.');
    err.status = 410;
    throw err;
  }
  if (requireSignerId != null && String(reqRow.signer_id) !== String(requireSignerId || '')) {
    const err = new Error('La solicitud de firma pertenece a otro usuario.');
    err.status = 403;
    throw err;
  }
  return { reqRow, alreadyDone: false };
}

async function persistSignatureResult({ reqRow, user, signed, documentNumber = '', signerName = '' }) {
  const contrato = readContrato();
  if (isFullySigned(contrato)) {
    const err = new Error('Este contrato ya está firmado.');
    err.status = 409;
    throw err;
  }

  const abs = resolveContractPdfAbsolute(contrato.pdf_original_url);
  const currentHash = abs
    ? hashPdfFile(abs)
    : hashContractText(contrato.texto_contrato, contrato.version);
  if (!currentHash || currentHash !== reqRow.document_hash || currentHash !== contrato.document_hash) {
    runSql(`UPDATE contract_signature_request SET status = 'rejected' WHERE id = ?`, [reqRow.id]);
    logAudit({
      actorUserId: user?.id || reqRow.signer_id,
      actorName: user?.full_name || user?.username || reqRow.signer_name || '',
      action: 'SIGNATURE_FAILED',
      resourceType: 'contrato',
      resourceId: 'contrato',
      details: { reason: 'hash_mismatch', request_id: reqRow.id },
    });
    const err = new Error('El documento fue modificado durante el proceso. Firma rechazada.');
    err.status = 409;
    throw err;
  }

  let details = {};
  try {
    details = JSON.parse(reqRow.details || '{}');
  } catch {
    details = {};
  }
  const docNum = String(documentNumber || details.document_number || signed.document_number || '').trim();
  const resolvedSignerName = String(
    signerName
    || details.signer_name
    || user?.full_name
    || user?.username
    || reqRow.signer_name
    || '',
  ).trim();
  const signatureId = uuidv4();
  const signedAt = new Date().toISOString();
  const validationStatus = String(signed.validation_status || (signed.mock ? 'VALID' : 'PENDING_TECHNICAL_VALIDATION'));

  runSql(
    `INSERT INTO contract_signature
      (id, signature_request_id, contract_version, party, signer_id, document_hash, signature_value,
       certificate_serial, certificate_subject, certificate_issuer, signature_algorithm, signed_at, validation_status, mock, details)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      signatureId,
      reqRow.id,
      reqRow.contract_version,
      reqRow.party,
      user?.id || reqRow.signer_id,
      reqRow.document_hash,
      signed.signature_value,
      signed.certificate_serial || '',
      signed.certificate_subject || '',
      signed.certificate_issuer || '',
      signed.signature_algorithm || '',
      signedAt,
      validationStatus,
      signed.mock ? 1 : 0,
      JSON.stringify({
        method: signed.method,
        technical_note: signed.technical_note || '',
        signer_name: resolvedSignerName,
      }),
    ],
  );
  runSql(
    `UPDATE contract_signature_request SET status = 'completed', completed_at = datetime('now') WHERE id = ?`,
    [reqRow.id],
  );

  const slot = {
    ...emptyFirmaSlot(),
    status: 'firmado',
    method: signed.method || (signed.mock ? 'mock_dnie' : 'dnie_nfc'),
    signer_id: String(user?.id || reqRow.signer_id || ''),
    signer_name: resolvedSignerName,
    document_type: 'DNIe',
    document_number: docNum,
    document_hash: reqRow.document_hash,
    signature_algorithm: signed.signature_algorithm || '',
    certificate_serial: signed.certificate_serial || '',
    certificate_subject: signed.certificate_subject || '',
    certificate_issuer: signed.certificate_issuer || '',
    signature_value: signed.signature_value || '',
    signed_at: signedAt,
    validation_status: validationStatus,
    mock: Boolean(signed.mock),
  };

  const party = reqRow.party;
  if (party === 'comprador') contrato.firma_comprador = slot;
  else contrato.firma_vendedor = slot;

  const both = contrato.firma_comprador.status === 'firmado' && contrato.firma_vendedor.status === 'firmado';
  if (both) {
    contrato.estado_firma = SIGNATURE_STATUSES.FIRMADO;
    contrato.firmado_en = signedAt;
  } else {
    contrato.estado_firma = SIGNATURE_STATUSES.FIRMANDO;
  }

  // PDF visual con firmas dentro del bloque ACEPTACIÓN DIGITAL (no cambia el hash del PDF original).
  try {
    const { applySignaturesIntoContractText } = require('./contractTextSignatures');
    const filled = applySignaturesIntoContractText(contrato.texto_contrato, contrato);
    const visual = await generateContractPdf({
      texto: filled,
      version: contrato.version,
      title: both
        ? 'Contrato firmado — RESTO FADEY.POS'
        : 'Contrato (firma parcial) — RESTO FADEY.POS',
    });
    if (visual.publicUrl) contrato.pdf_firmado_url = visual.publicUrl;
  } catch (_) {
    /* evidencia visual opcional */
  }

  writeContrato(contrato);

  logAudit({
    actorUserId: user?.id || reqRow.signer_id,
    actorName: user?.full_name || user?.username || reqRow.signer_name || '',
    action: both ? 'CONTRACT_SIGNED' : 'SIGNATURE_CREATED',
    resourceType: 'contrato',
    resourceId: 'contrato',
    details: {
      party,
      signature_id: signatureId,
      request_id: reqRow.id,
      mock: Boolean(signed.mock),
      fully_signed: both,
      method: signed.method,
    },
  });
  emitStaffDataUpdate({ domain: 'app_config' });

  return {
    ok: true,
    party,
    fully_signed: both,
    mock: Boolean(signed.mock),
    signature_id: signatureId,
    contrato: publicContratoView(contrato),
  };
}

async function completeSignature({
  user,
  requestId,
  temporaryToken,
  ackReviewed,
  documentNumber = '',
  signerName = '',
  useMock = false,
}) {
  ensureSignatureTables();
  if (!ackReviewed) {
    const err = new Error('Debe confirmar que revisó el contrato y desea firmarlo.');
    err.status = 400;
    throw err;
  }

  const { reqRow, alreadyDone } = loadPendingRequest({
    requestId,
    temporaryToken,
    requireSignerId: user?.id,
  });
  if (alreadyDone) {
    return {
      ok: true,
      already_completed: true,
      party: reqRow.party,
      fully_signed: isFullySigned(readContrato()),
      contrato: publicContratoView(),
    };
  }

  const wantMock = useMock || getProviderMode() === 'mock';
  if (wantMock) {
    if (!mockAllowed()) {
      const err = new Error('Firma MOCK no permitida. Use el canal NFC del teléfono.');
      err.status = 403;
      throw err;
    }
    const provider = createMockDniSignatureProvider();
    const signed = await provider.sign({
      documentHash: reqRow.document_hash,
      party: reqRow.party,
      signer: {
        id: user?.id,
        name: signerName || user?.full_name || user?.username || '',
        document_number: documentNumber,
      },
    });
    return persistSignatureResult({ reqRow, user, signed, documentNumber, signerName });
  }

  // Canal real: no completar aquí; la app móvil debe POST al token.
  const err = new Error(
    'Espere la firma desde el teléfono (NFC + DNIe). El PIN solo se ingresa en el dispositivo.',
  );
  err.status = 202;
  err.code = 'AWAITING_MOBILE_NFC';
  throw err;
}

function getMobileSession(token) {
  ensureSignatureTables();
  const reqRow = queryOne(
    'SELECT * FROM contract_signature_request WHERE temporary_token = ?',
    [String(token || '')],
  );
  if (!reqRow) {
    const err = new Error('Sesión de firma no encontrada.');
    err.status = 404;
    throw err;
  }
  if (reqRow.status === 'completed') {
    return {
      status: 'completed',
      party: reqRow.party,
      contract_version: reqRow.contract_version,
      document_hash: reqRow.document_hash,
      message: 'Esta firma ya fue completada.',
    };
  }
  if (reqRow.status !== 'pending') {
    const err = new Error(`Sesión en estado ${reqRow.status}`);
    err.status = 409;
    throw err;
  }
  if (new Date(reqRow.expires_at).getTime() < Date.now()) {
    runSql(`UPDATE contract_signature_request SET status = 'expired' WHERE id = ?`, [reqRow.id]);
    const err = new Error('Sesión expirada.');
    err.status = 410;
    throw err;
  }

  let details = {};
  try {
    details = JSON.parse(reqRow.details || '{}');
  } catch {
    details = {};
  }
  const contrato = readContrato();
  const origin = publicApiOrigin();
  const pdfPath = details.pdf_original_url || contrato.pdf_original_url || '';
  const pdfUrl = pdfPath
    ? (origin && pdfPath.startsWith('/') ? `${origin}${pdfPath}` : pdfPath)
    : '';

  return {
    status: 'pending',
    request_id: reqRow.id,
    party: reqRow.party,
    signer_name: reqRow.signer_name,
    contract_version: reqRow.contract_version,
    document_hash: reqRow.document_hash,
    pdf_url: pdfUrl,
    pdf_path: pdfPath,
    expires_at: reqRow.expires_at,
    pin_never_sent_to_server: true,
    mock_allowed: mockAllowed(),
    provider: getProviderMode(),
    bridge: {
      global: 'window.RestoFadeyDnie',
      page_hook: 'window.RestoFadeyDniePage',
    },
    instructions: [
      'Abra /firmar-contrato?token=… o la app Android.',
      'Acerque el DNIe al NFC e ingrese el PIN solo en el teléfono.',
      'POST el resultado (signature_value, certificado) a /api/contrato/sign/mobile/:token. Sin PIN.',
    ],
    technical_note: 'REQUIERE VALIDACIÓN TÉCNICA: APDU DNIe Perú no implementados en este servidor.',
  };
}

async function submitMobileSignature(token, body = {}) {
  ensureSignatureTables();
  const reqRow = queryOne(
    'SELECT * FROM contract_signature_request WHERE temporary_token = ?',
    [String(token || '')],
  );
  if (!reqRow) {
    const err = new Error('Sesión de firma no encontrada.');
    err.status = 404;
    throw err;
  }
  const loaded = loadPendingRequest({
    requestId: reqRow.id,
    temporaryToken: token,
    requireSignerId: null,
  });
  if (loaded.alreadyDone) {
    return {
      ok: true,
      already_completed: true,
      contrato: publicContratoView(),
    };
  }

  // Rechazar cualquier campo que parezca PIN
  for (const key of Object.keys(body || {})) {
    if (/pin|password|clave|puk/i.test(key) && body[key] != null && String(body[key]).trim() !== '') {
      const err = new Error('El PIN del DNIe no debe enviarse al servidor. Elimine ese campo.');
      err.status = 400;
      throw err;
    }
  }

  const real = createRealDniSignatureProvider();
  const signed = real.acceptDeviceResult(body, { documentHash: loaded.reqRow.document_hash });
  // Si el dispositivo envía mock y está permitido, marcar VALID
  if (signed.mock && !mockAllowed()) {
    const err = new Error('Firma MOCK móvil no permitida en este despliegue.');
    err.status = 403;
    throw err;
  }
  const user = {
    id: reqRow.signer_id,
    full_name: reqRow.signer_name,
    username: reqRow.signer_name,
  };
  return persistSignatureResult({
    reqRow: loaded.reqRow,
    user,
    signed,
    documentNumber: body.document_number,
  });
}

function getRequestPollStatus(requestId, user) {
  ensureSignatureTables();
  const reqRow = queryOne('SELECT * FROM contract_signature_request WHERE id = ?', [String(requestId || '')]);
  if (!reqRow) {
    const err = new Error('Solicitud no encontrada.');
    err.status = 404;
    throw err;
  }
  if (user?.id && String(reqRow.signer_id) !== String(user.id) && user.role !== 'master_admin') {
    const err = new Error('No autorizado.');
    err.status = 403;
    throw err;
  }
  const contrato = publicContratoView();
  const mySlot = reqRow.party === 'vendedor' ? contrato.firma_vendedor : contrato.firma_comprador;
  return {
    request_id: reqRow.id,
    status: reqRow.status,
    party: reqRow.party,
    expires_at: reqRow.expires_at,
    completed: reqRow.status === 'completed',
    party_signed: mySlot?.status === 'firmado',
    fully_signed: isFullySigned(contrato),
    contrato,
  };
}

function getSignatureStatus() {
  ensureSignatureTables();
  const contrato = publicContratoView();
  const signatures = queryAll(
    `SELECT id, party, signer_id, document_hash, certificate_serial, certificate_subject,
            signature_algorithm, signed_at, validation_status, mock, contract_version
     FROM contract_signature
     ORDER BY datetime(signed_at) ASC`,
  );
  return {
    contrato,
    signatures: signatures || [],
    provider: getProviderMode(),
    mock_allowed: mockAllowed(),
  };
}

function validateContractSignature() {
  ensureSignatureTables();
  const contrato = readContrato();
  if (!contrato.document_hash) {
    return { valid: false, reason: 'Sin hash de documento', contrato: publicContratoView(contrato) };
  }
  const abs = resolveContractPdfAbsolute(contrato.pdf_original_url);
  const expected = abs
    ? hashPdfFile(abs)
    : hashContractText(contrato.texto_contrato, contrato.version);
  if (!expected || expected !== contrato.document_hash) {
    return { valid: false, reason: 'El documento no coincide con el hash firmado', contrato: publicContratoView(contrato) };
  }
  const both = isFullySigned(contrato);
  if (!both) {
    return { valid: false, reason: 'Faltan firmas', contrato: publicContratoView(contrato) };
  }
  for (const party of ['comprador', 'vendedor']) {
    const slot = party === 'comprador' ? contrato.firma_comprador : contrato.firma_vendedor;
    if (slot.document_hash !== contrato.document_hash) {
      return { valid: false, reason: `Hash de firma ${party} no coincide`, contrato: publicContratoView(contrato) };
    }
    if (!slot.validation_status || slot.validation_status === 'INVALID') {
      return { valid: false, reason: `Firma ${party} no válida`, contrato: publicContratoView(contrato) };
    }
  }
  return { valid: true, reason: 'OK', contrato: publicContratoView(contrato) };
}

module.exports = {
  ensureSignatureTables,
  partyFromRole,
  publicContratoView,
  prepareSignature,
  completeSignature,
  getSignatureStatus,
  validateContractSignature,
  getMobileSession,
  submitMobileSignature,
  getRequestPollStatus,
  mockAllowed,
  getProviderMode,
};
