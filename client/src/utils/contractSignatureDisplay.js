/**
 * Rellena el bloque de firmas del texto del contrato (ACEPTACIÓN DIGITAL).
 * No altera el hash firmado: solo presentación en pantalla / PDF visual.
 */

/** Datos del proveedor en el pie de aceptación (debe coincidir con el texto del contrato). */
export const CONTRACT_PROVIDER = {
  company: 'FADEY SOLUTIONS SAC',
  ruc: '10600327327',
  gerente: 'ROMERO ROMERO DEYVI RENAN',
  documento: '60032732',
};

function formatPeDateTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('es-PE');
  } catch {
    return String(iso);
  }
}

function firmaLine(slot, blank = '________________________') {
  if (!slot || slot.status !== 'firmado') return `Firma: ${blank}`;
  const name = String(slot.signer_name || 'Firmado digitalmente').trim();
  const doc = slot.document_number ? ` · Doc. ${slot.document_number}` : '';
  const when = slot.signed_at ? ` · ${formatPeDateTime(slot.signed_at)}` : '';
  const mock = slot.mock ? ' · MOCK' : '';
  return `Firma: ${name}${doc}${when}${mock}`;
}

function buildAcceptanceFooter({ comprador, vendedor, firmadoEn }) {
  const clienteNombre = comprador?.status === 'firmado'
    ? String(comprador.signer_name || '________________________').trim()
    : '________________________';
  const fechaIso = firmadoEn
    || (comprador?.status === 'firmado' && comprador.signed_at)
    || (vendedor?.status === 'firmado' && vendedor.signed_at)
    || '';
  const fecha = fechaIso ? formatPeDateTime(fechaIso) : '____/____/________';

  return `ACEPTACIÓN DIGITAL

EL PROVEEDOR: ${CONTRACT_PROVIDER.company}
RUC: ${CONTRACT_PROVIDER.ruc}
GERENTE: ${CONTRACT_PROVIDER.gerente}
${firmaLine(vendedor)}

EL CLIENTE: ${clienteNombre}
${firmaLine(comprador)}
Fecha: ${fecha}`;
}

/** Quita uno o más pies de aceptación al final (evita duplicados). No toca «DÉCIMA QUINTA: ACEPTACIÓN DIGITAL». */
function stripTrailingAcceptanceBlocks(texto) {
  let out = String(texto || '');
  const trail = /\n+ACEPTACIÓN DIGITAL\s*\n+EL PROVEEDOR:[\s\S]*$/i;
  let guard = 0;
  while (trail.test(out) && guard < 8) {
    out = out.replace(trail, '');
    guard += 1;
  }
  if (/^ACEPTACIÓN DIGITAL\s*\n+EL PROVEEDOR:/i.test(out.trimStart()) && !/DÉCIMA/i.test(out.slice(0, 80))) {
    out = '';
  }
  return out.replace(/\s+$/, '');
}

/**
 * @param {string} texto
 * @param {{ firma_comprador?: object, firma_vendedor?: object, firmado_en?: string }} contrato
 */
export function applySignaturesIntoContractText(texto, contrato = {}) {
  let t = String(texto || '');
  const comprador = contrato.firma_comprador || {};
  const vendedor = contrato.firma_vendedor || {};
  const anySigned = comprador.status === 'firmado' || vendedor.status === 'firmado';

  if (anySigned) {
    t = t.replace(/☐\s*Firma electrónica/g, '☑ Firma electrónica');
  }

  const footer = buildAcceptanceFooter({
    comprador,
    vendedor,
    firmadoEn: contrato.firmado_en,
  });

  const body = stripTrailingAcceptanceBlocks(t);
  if (!body) return footer;
  return `${body}\n\n${footer}`;
}
