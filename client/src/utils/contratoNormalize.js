import { DEFAULT_SERVICE_CONTRACT_TEXT } from '../data/defaultServiceContract';

const EMPTY_FIRMA = {
  status: 'pendiente',
  signer_name: '',
  document_number: '',
  signed_at: '',
  validation_status: '',
  mock: false,
  certificate_serial: '',
  method: '',
};

const EMPTY_CONTRATO = {
  texto_contrato: '',
  documento_word_url: '',
  documento_word_nombre: '',
  firma_comprador_url: '',
  firma_vendedor_url: '',
  version: 1,
  estado_firma: 'borrador',
  document_hash: '',
  pdf_original_url: '',
  pdf_firmado_url: '',
  firma_comprador: { ...EMPTY_FIRMA },
  firma_vendedor: { ...EMPTY_FIRMA },
  firmado_en: '',
  text_locked: false,
  can_sign_again: true,
};

function normalizeFirma(raw) {
  return { ...EMPTY_FIRMA, ...(raw && typeof raw === 'object' ? raw : {}) };
}

/** Normaliza el JSON `contrato` de app_settings / API para la UI. */
export function normalizeContratoFromApi(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      ...EMPTY_CONTRATO,
      texto_contrato: DEFAULT_SERVICE_CONTRACT_TEXT,
    };
  }
  const saved = String(raw.texto_contrato ?? raw.observations ?? '').trim();
  return {
    ...EMPTY_CONTRATO,
    ...raw,
    texto_contrato: saved || DEFAULT_SERVICE_CONTRACT_TEXT,
    documento_word_url: String(raw.documento_word_url || '').trim(),
    documento_word_nombre: String(raw.documento_word_nombre || '').trim(),
    firma_comprador_url: String(raw.firma_comprador_url || '').trim(),
    firma_vendedor_url: String(raw.firma_vendedor_url || '').trim(),
    version: Math.max(1, Number(raw.version) || 1),
    estado_firma: String(raw.estado_firma || 'borrador'),
    document_hash: String(raw.document_hash || ''),
    pdf_original_url: String(raw.pdf_original_url || '').trim(),
    pdf_firmado_url: String(raw.pdf_firmado_url || '').trim(),
    firma_comprador: normalizeFirma(raw.firma_comprador),
    firma_vendedor: normalizeFirma(raw.firma_vendedor),
    firmado_en: String(raw.firmado_en || ''),
    text_locked: Boolean(raw.text_locked),
    can_sign_again: raw.can_sign_again !== false,
  };
}
