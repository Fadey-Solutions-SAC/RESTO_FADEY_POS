/**
 * Rellena el bloque de firmas en el texto del contrato (mismo criterio que el cliente).
 */

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

EL PROVEEDOR: FADEY SOLUTIONS SAC
RUC: 10600327327
GERENTE: ROMERO ROMERO DEYVI RENAN
${firmaLine(vendedor)}

EL CLIENTE: ${clienteNombre}
${firmaLine(comprador)}
Fecha: ${fecha}`;
}

function stripTrailingAcceptanceBlocks(texto) {
  let out = String(texto || '');
  const trail = /\n+ACEPTACIÓN DIGITAL\s*\n+EL PROVEEDOR:[\s\S]*$/i;
  let guard = 0;
  while (trail.test(out) && guard < 8) {
    out = out.replace(trail, '');
    guard += 1;
  }
  return out.replace(/\s+$/, '');
}

function applySignaturesIntoContractText(texto, contrato = {}) {
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

module.exports = {
  applySignaturesIntoContractText,
  buildAcceptanceFooter,
};
