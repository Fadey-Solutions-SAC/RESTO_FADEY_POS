const crypto = require('crypto');
const { queryOne, runSql } = require('../database');

const CONTRATO_KEY = 'contrato';

const SIGNATURE_STATUSES = Object.freeze({
  BORRADOR: 'borrador',
  PENDIENTE_FIRMA: 'pendiente_firma',
  FIRMANDO: 'firmando',
  FIRMADO: 'firmado',
  FIRMA_RECHAZADA: 'firma_rechazada',
  FIRMA_INVALIDA: 'firma_invalida',
});

function emptyFirmaSlot() {
  return {
    status: 'pendiente',
    method: '',
    signer_id: '',
    signer_name: '',
    document_type: 'DNIe',
    document_number: '',
    document_hash: '',
    signature_algorithm: '',
    certificate_serial: '',
    certificate_subject: '',
    certificate_issuer: '',
    signature_value: '',
    signed_at: '',
    validation_status: '',
    mock: false,
  };
}

function defaultContratoShape() {
  return {
    texto_contrato: '',
    documento_word_url: '',
    documento_word_nombre: '',
    firma_comprador_url: '',
    firma_vendedor_url: '',
    version: 1,
    estado_firma: SIGNATURE_STATUSES.BORRADOR,
    document_hash: '',
    pdf_original_url: '',
    pdf_firmado_url: '',
    firma_comprador: emptyFirmaSlot(),
    firma_vendedor: emptyFirmaSlot(),
    firmado_en: '',
  };
}

function normalizeFirmaSlot(raw) {
  const base = emptyFirmaSlot();
  if (!raw || typeof raw !== 'object') return base;
  return {
    ...base,
    status: String(raw.status || base.status),
    method: String(raw.method || ''),
    signer_id: String(raw.signer_id || ''),
    signer_name: String(raw.signer_name || ''),
    document_type: String(raw.document_type || 'DNIe'),
    document_number: String(raw.document_number || ''),
    document_hash: String(raw.document_hash || ''),
    signature_algorithm: String(raw.signature_algorithm || ''),
    certificate_serial: String(raw.certificate_serial || ''),
    certificate_subject: String(raw.certificate_subject || ''),
    certificate_issuer: String(raw.certificate_issuer || ''),
    signature_value: String(raw.signature_value || ''),
    signed_at: String(raw.signed_at || ''),
    validation_status: String(raw.validation_status || ''),
    mock: Boolean(raw.mock),
  };
}

function normalizeContrato(raw) {
  const base = defaultContratoShape();
  if (!raw || typeof raw !== 'object') return { ...base };
  const version = Math.max(1, Number(raw.version) || 1);
  return {
    ...base,
    texto_contrato: String(raw.texto_contrato ?? raw.observations ?? ''),
    documento_word_url: String(raw.documento_word_url || ''),
    documento_word_nombre: String(raw.documento_word_nombre || ''),
    firma_comprador_url: String(raw.firma_comprador_url || ''),
    firma_vendedor_url: String(raw.firma_vendedor_url || ''),
    version,
    estado_firma: String(raw.estado_firma || SIGNATURE_STATUSES.BORRADOR),
    document_hash: String(raw.document_hash || ''),
    pdf_original_url: String(raw.pdf_original_url || ''),
    pdf_firmado_url: String(raw.pdf_firmado_url || ''),
    firma_comprador: normalizeFirmaSlot(raw.firma_comprador),
    firma_vendedor: normalizeFirmaSlot(raw.firma_vendedor),
    firmado_en: String(raw.firmado_en || ''),
  };
}

function readContrato() {
  const row = queryOne('SELECT value FROM app_settings WHERE key = ?', [CONTRATO_KEY]);
  let parsed = {};
  try {
    parsed = row?.value ? JSON.parse(row.value) : {};
  } catch {
    parsed = {};
  }
  const next = normalizeContrato(parsed);
  if (!String(next.texto_contrato || '').trim()) {
    try {
      const { DEFAULT_SERVICE_CONTRACT_TEXT } = require('../data/defaultServiceContract');
      next.texto_contrato = DEFAULT_SERVICE_CONTRACT_TEXT;
    } catch (_) {
      /* sin texto base */
    }
  }
  return next;
}

function writeContrato(contrato) {
  const next = normalizeContrato(contrato);
  runSql(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [CONTRATO_KEY, JSON.stringify(next)],
  );
  return next;
}

function hashContractText(texto, version) {
  const payload = `v${Number(version) || 1}\n${String(texto || '')}`;
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

function isFullySigned(contrato) {
  const c = normalizeContrato(contrato);
  return (
    c.estado_firma === SIGNATURE_STATUSES.FIRMADO
    || (c.firma_comprador?.status === 'firmado' && c.firma_vendedor?.status === 'firmado')
  );
}

function isTextLocked(contrato) {
  const c = normalizeContrato(contrato);
  if (isFullySigned(c)) return true;
  if (c.estado_firma === SIGNATURE_STATUSES.FIRMANDO) return true;
  if (c.firma_comprador?.status === 'firmado' || c.firma_vendedor?.status === 'firmado') return true;
  return false;
}

/**
 * Merge seguro al editar texto desde config: no borra firmas ni estados.
 * Si el contrato ya está bloqueado, ignora cambios de texto.
 */
function mergeContratoForConfigPut(previous, incoming) {
  const prev = normalizeContrato(previous);
  const inc = incoming && typeof incoming === 'object' ? incoming : {};
  const locked = isTextLocked(prev);

  const next = {
    ...prev,
    documento_word_url: inc.documento_word_url !== undefined
      ? String(inc.documento_word_url || '').trim()
      : prev.documento_word_url,
    documento_word_nombre: inc.documento_word_nombre !== undefined
      ? String(inc.documento_word_nombre || '').trim()
      : prev.documento_word_nombre,
  };

  if (!locked && inc.texto_contrato !== undefined) {
    const newText = String(inc.texto_contrato || '');
    if (newText !== prev.texto_contrato) {
      next.texto_contrato = newText;
      next.version = prev.version + 1;
      next.document_hash = '';
      next.estado_firma = SIGNATURE_STATUSES.BORRADOR;
    }
  }

  // Firmas y estado solo vía ContractSignatureService
  next.firma_comprador = prev.firma_comprador;
  next.firma_vendedor = prev.firma_vendedor;
  next.estado_firma = prev.estado_firma;
  next.document_hash = locked ? prev.document_hash : next.document_hash;
  next.firmado_en = prev.firmado_en;
  next.pdf_original_url = prev.pdf_original_url;
  next.pdf_firmado_url = prev.pdf_firmado_url;
  next.firma_comprador_url = prev.firma_comprador_url;
  next.firma_vendedor_url = prev.firma_vendedor_url;
  if (locked) next.version = prev.version;

  return normalizeContrato(next);
}

module.exports = {
  CONTRATO_KEY,
  SIGNATURE_STATUSES,
  emptyFirmaSlot,
  defaultContratoShape,
  normalizeContrato,
  normalizeFirmaSlot,
  readContrato,
  writeContrato,
  hashContractText,
  isFullySigned,
  isTextLocked,
  mergeContratoForConfigPut,
};
