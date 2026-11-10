import { api, formatCurrency, resolveMediaUrl } from './api';
import { groupItemsByProductNameForBill } from './mesaOrderLines';
import { buildBoletaFacturaPlainText, taxKindFromItems } from './ticketPlainText';
import { printCajaTicket } from './printCajaTicket';
import { withSunatQr } from './sunatQr';

/** Ancho de la impresora de caja. La boleta y la factura salen en térmica de 80 mm. */
export const SUNAT_TICKET_WIDTH_MM = 80;

/** Celular Perú → 519XXXXXXXX. Vacío si no alcanza para abrir el chat. */
export function whatsappPhonePe(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 9 && d.startsWith('9')) return `51${d}`;
  if (d.length >= 11 && d.startsWith('51')) return d.slice(0, 11);
  return '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureBillingPdf(doc) {
  let current = doc;
  for (let i = 0; i < 10; i += 1) {
    if (String(current?.pdf_url || '').trim()) return current;
    if (!current?.id) break;
    await sleep(1500);
    current = await api.get(`/billing/${encodeURIComponent(current.id)}`);
  }
  return current;
}

/**
 * Abre el chat de WhatsApp de ese celular con el PDF del comprobante.
 * Si el navegador permite compartir archivos, el PDF va adjunto.
 * Si no, lo copia al portapapeles (Ctrl+V en el chat) o lo descarga.
 */
export async function sendComprobanteViaWhatsapp(doc, phoneRaw) {
  const phone = whatsappPhonePe(phoneRaw);
  if (!phone) throw new Error('Ingrese un celular de 9 dígitos para WhatsApp');
  const popup = window.open('about:blank', '_blank');
  const ready = await ensureBillingPdf(doc);
  const href = resolveMediaUrl(ready?.pdf_url);
  if (!href) {
    popup?.close();
    throw new Error('El PDF todavía no está listo. Espere unos segundos y vuelva a intentar.');
  }
  const res = await fetch(href);
  if (!res.ok) {
    popup?.close();
    throw new Error('No se pudo obtener el PDF del comprobante');
  }
  const blob = await res.blob();
  const safeName = `${String(ready.full_number || 'comprobante').replace(/[^\w.-]+/g, '_')}.pdf`;
  const file = new File([blob], safeName, { type: blob.type || 'application/pdf' });
  const caption = `Comprobante ${String(ready.full_number || '').trim()}`.trim();
  const chatUrl = `https://wa.me/${phone}?text=${encodeURIComponent(caption)}`;

  const goToChat = () => {
    if (popup && !popup.closed) popup.location.href = chatUrl;
    else window.open(chatUrl, '_blank', 'noopener,noreferrer');
  };

  let copied = false;
  try {
    if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
      const pdfBlob = file.type === 'application/pdf' ? file : new Blob([blob], { type: 'application/pdf' });
      await navigator.clipboard.write([new ClipboardItem({ 'application/pdf': pdfBlob })]);
      copied = true;
    }
  } catch (_) {
    copied = false;
  }

  if (copied) {
    goToChat();
    return { mode: 'clipboard', phone };
  }

  if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
    try {
      popup?.close();
      await navigator.share({ files: [file], title: safeName, text: caption });
      window.open(chatUrl, '_blank', 'noopener,noreferrer');
      return { mode: 'share', phone };
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
    }
  }

  goToChat();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = safeName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return { mode: 'download', phone };
}

export async function downloadBillingPdf(doc) {
  const href = resolveMediaUrl(doc?.pdf_url);
  if (!href) throw new Error('Este comprobante no tiene PDF para descargar');
  const safeName = String(doc?.full_number || 'comprobante').replace(/[^\w.-]+/g, '_');
  const res = await fetch(href);
  if (!res.ok) throw new Error('No se pudo descargar el PDF');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeName}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Imprime boleta o factura en la térmica de caja (80 mm), sin el cuadro de impresión del navegador. */
export async function printBillingOnThermal(doc) {
  let full = doc;
  if (doc?.id && (doc.subtotal == null || doc.customer_name == null)) {
    full = await api.get(`/billing/${encodeURIComponent(doc.id)}`);
  }
  const kind = String(full?.doc_type || '').toLowerCase();
  if (kind !== 'boleta' && kind !== 'factura') {
    throw new Error('Solo la boleta y la factura se imprimen en la térmica');
  }
  const restaurant = await api.get('/restaurant');
  let items = [];
  if (full?.order_id) {
    const order = await api.get(`/orders/${encodeURIComponent(full.order_id)}`).catch(() => null);
    items = Array.isArray(order?.items) ? order.items : [];
  }
  const grouped = items.length
    ? groupItemsByProductNameForBill(items)
    : [{
      name: 'CONSUMO',
      qty: 1,
      unitPrice: Number(full?.total || 0),
      subtotal: Number(full?.total || 0),
    }];
  const plain = buildBoletaFacturaPlainText({
    restaurant,
    doc: full,
    groupedRows: grouped,
    formatCurrencyFn: formatCurrency,
    subtotal: Number(full?.subtotal || 0),
    tax: Number(full?.tax || 0),
    total: Number(full?.total || 0),
    customer: {
      name: full?.customer_name,
      doc_number: full?.customer_doc_number,
      address: full?.customer_address,
    },
    widthMm: SUNAT_TICKET_WIDTH_MM,
    taxKind: taxKindFromItems(items),
    paymentMethod: full?.payment_method || 'efectivo',
  });
  const logoUrl = resolveMediaUrl(restaurant?.logo || '') || undefined;
  const result = await printCajaTicket(await withSunatQr({
    text: plain,
    preformatted: true,
    logoUrl,
    paperWidth: SUNAT_TICKET_WIDTH_MM,
    restaurantBrand: String(restaurant?.billing_nombre_comercial || restaurant?.name || '').trim() || undefined,
  }, {
    restaurant,
    doc: full,
    tax: Number(full?.tax || 0),
    total: Number(full?.total || 0),
  }));
  if (!result?.ok) throw new Error(result?.error || 'No se pudo imprimir en la térmica de 80 mm');
}
