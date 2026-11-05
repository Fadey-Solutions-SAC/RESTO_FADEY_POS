import { api, formatCurrency, resolveMediaUrl } from './api';
import { groupItemsByProductNameForBill } from './mesaOrderLines';
import { buildBoletaFacturaPlainText } from './ticketPlainText';
import { printCajaTicket } from './printCajaTicket';
import { withSunatQr } from './sunatQr';

/** Ancho de la impresora de caja. La boleta y la factura salen en térmica de 80 mm. */
export const SUNAT_TICKET_WIDTH_MM = 80;

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
