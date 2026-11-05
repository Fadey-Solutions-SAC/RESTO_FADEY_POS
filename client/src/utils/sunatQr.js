import QRCode from 'qrcode';

function readProvider(doc) {
  let response = doc?.provider_response;
  if (typeof response === 'string') {
    try {
      response = JSON.parse(response);
    } catch (_) {
      response = {};
    }
  }
  return response && typeof response === 'object' ? response : {};
}

/** Texto del QR de representación impresa: RUC|tipo|serie|número|IGV|total|fecha|tipo doc|número|hash. */
export function buildSunatQrText({ restaurant = {}, doc = {}, tax = 0, total = 0 } = {}) {
  const stored = String(readProvider(doc).codigo_qr || '').trim();
  if (stored) return stored;
  const ruc = String(restaurant?.company_ruc || restaurant?.ruc || '').replace(/\D/g, '');
  const full = String(doc?.full_number || '').trim();
  const dash = full.indexOf('-');
  const serie = dash > 0 ? full.slice(0, dash) : '';
  const numero = dash > 0 ? String(parseInt(full.slice(dash + 1), 10) || '') : '';
  if (!ruc || !serie || !numero) return '';
  const tipo = String(doc?.doc_type || '').toLowerCase() === 'factura' ? '01' : '03';
  const fecha = String(doc?.created_at || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
  const hash = String(doc?.hash_code || '').trim();
  const resumen = hash.length >= 20 ? hash : '';
  return [
    ruc,
    tipo,
    serie,
    numero,
    Number(tax || 0).toFixed(2),
    Number(total || doc?.total || 0).toFixed(2),
    fecha,
    String(doc?.customer_doc_type || ''),
    String(doc?.customer_doc_number || '').replace(/\D/g, ''),
    resumen,
  ].join('|');
}

export async function withSunatQr(payload, ctx) {
  const value = String(buildSunatQrText(ctx) || '').trim();
  if (!value) return payload;
  const margin = 4;
  const scale = 6;
  let dots = 0;
  try {
    const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
    dots = (qr.modules.size + margin * 2) * scale;
    const footerImageUrl = await QRCode.toDataURL(value, { margin, scale, errorCorrectionLevel: 'M' });
    if (!footerImageUrl || dots <= 0) return payload;
    return { ...payload, footerImageUrl, footerImageMaxDots: dots };
  } catch (_) {
    return payload;
  }
}
