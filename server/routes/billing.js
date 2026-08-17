const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, runSql } = require('../database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { buildEfactSaleJson, sendEfactSale } = require('../efactBridge');
const {
  effectiveEfactApiUrl,
  effectiveEfactHttpSecret,
  billingEfactUrlFromEnv,
  billingEfactSecretFromEnv,
  isAcceptableEfactApiUrlForStorage,
} = require('../efactConnection');
const { getControlConfig } = require('../masterAdminService');
const { scheduleWhatsappPdfSend } = require('../whatsappLaptopNotify');
const { exportBillingPdfToUploads, exportBillingFileToUploads, isHttpUrl: isHttpPdfUrl } = require('../billingPdfStorage');
const { saveLocalFallbackReceiptPdf, ensureLocalFallbackPdfForDocumentRow } = require('../billingLocalReceiptPdf');
const { getOrderWithItems } = require('../orderCreateService');
const { getSocketIo, emitBillingDocumentUpdate } = require('../socketBroadcast');

const router = express.Router();

function emitOrderUpdateForBilling(io, orderId) {
  if (!io || !orderId) return;
  const full = getOrderWithItems(orderId);
  if (full) io.emit('order-update', full);
}

function slimBillingDocumentRow(row) {
  if (!row || !row.id) return null;
  return {
    id: row.id,
    order_id: row.order_id,
    order_number: row.order_number,
    doc_type: row.doc_type,
    full_number: row.full_number,
    provider_status: row.provider_status,
    provider_message: row.provider_message,
    sunat_description: row.sunat_description,
    pdf_url: row.pdf_url,
    xml_url: row.xml_url,
    cdr_url: row.cdr_url,
    updated_at: row.updated_at,
    print_caja: String(row.provider_status || '').toLowerCase() === 'accepted',
  };
}

function broadcastBillingDocumentRow(row) {
  const slim = slimBillingDocumentRow(row);
  if (slim) emitBillingDocumentUpdate(slim);
}

const DOCS = {
  boleta: { sunatCode: '03', nubefactCode: '2', fallbackSeries: 'B001' },
  factura: { sunatCode: '01', nubefactCode: '1', fallbackSeries: 'F001' },
};

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round2(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

/** Líneas del comprobante: detallado = ítems del pedido; consumo = una sola línea con totales del pedido */
function normalizeInvoiceLinesMode(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'consumo' || v === 'por_consumo') return 'consumo';
  return 'detallado';
}

function normalizeSeries(value, fallback) {
  const clean = String(value || '').trim().toUpperCase();
  return clean || fallback;
}

function formatIssueDate(date = new Date()) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function normalizeCustomerForDoc(docType, customer = {}) {
  const rawDocType = String(customer.doc_type || '').trim();
  const rawDocNumber = String(customer.doc_number || '').trim();
  const rawName = String(customer.name || '').trim();
  const rawAddress = String(customer.address || '').trim();

  const customerDocType = rawDocType || (docType === 'factura' ? '6' : '1');
  const customerDocNumber = rawDocNumber;
  const customerName = rawName || 'CLIENTE VARIOS';
  const customerAddress = rawAddress || 'LIMA';

  if (docType === 'factura') {
    if (customerDocType !== '6') {
      throw new Error('Para factura el tipo de documento del cliente debe ser RUC');
    }
    if (!/^\d{11}$/.test(customerDocNumber)) {
      throw new Error('Para factura debes ingresar un RUC válido de 11 dígitos');
    }
    if (!rawName) {
      throw new Error('Para factura debes ingresar razón social del cliente');
    }
  }

  if (customerDocType === '1' && customerDocNumber && !/^\d{8}$/.test(customerDocNumber)) {
    throw new Error('DNI inválido, debe tener 8 dígitos');
  }
  if (customerDocType === '6' && customerDocNumber && !/^\d{11}$/.test(customerDocNumber)) {
    throw new Error('RUC inválido, debe tener 11 dígitos');
  }

  return { customerDocType, customerDocNumber, customerName, customerAddress };
}

function parseBillingPanelJsonForCorrelative(restaurant) {
  try {
    const raw = restaurant?.billing_panel_json;
    const o = raw ? JSON.parse(raw) : {};
    return o && typeof o === 'object' ? o : {};
  } catch (_) {
    return {};
  }
}

/** Primer número por serie cuando aún no hay comprobantes emitidos en esa serie. */
function getNextCorrelative(docType, series, restaurant) {
  const row = queryOne(
    'SELECT COALESCE(MAX(correlative), 0) as max_number FROM electronic_documents WHERE doc_type = ? AND series = ?',
    [docType, series]
  );
  const maxNum = Number(row?.max_number || 0);
  const panel = parseBillingPanelJsonForCorrelative(restaurant);
  const key = docType === 'factura' ? 'correlativo_inicial_factura' : 'correlativo_inicial_boleta';
  const initial = Math.max(1, Math.floor(Number(panel[key]) || 1));
  if (maxNum === 0) return initial;
  return maxNum + 1;
}

function canSendToNubefact(restaurant) {
  return String(restaurant.billing_provider || '').toLowerCase() === 'nubefact'
    && Boolean(String(restaurant.billing_api_url || '').trim())
    && Boolean(String(restaurant.billing_api_token || '').trim());
}

function canSendToEfact(restaurant) {
  return String(restaurant.billing_provider || '').toLowerCase() === 'restaurant_efact'
    && Boolean(effectiveEfactApiUrl(restaurant));
}

function canSendToProvider(restaurant) {
  return Number(restaurant.billing_enabled || 0) === 1
    && (canSendToNubefact(restaurant) || canSendToEfact(restaurant));
}

/** Validación antes de armar el payload (mensajes claros para el panel / POS). */
function assertRestaurantReadyForBillingIssue(restaurant, useEfact, docType) {
  if (!Number(restaurant.billing_enabled ?? 0)) {
    throw new Error('La facturación electrónica no está habilitada en el restaurante.');
  }
  const ruc = String(restaurant.company_ruc || '').trim();
  const razon = String(restaurant.legal_name || '').trim();
  if (!ruc) {
    throw new Error('Falta el RUC del emisor (Mi Restaurante → Mi empresa o Bot facturación SUNAT).');
  }
  if (!/^\d{11}$/.test(ruc)) {
    throw new Error('El RUC del emisor debe tener 11 dígitos.');
  }
  if (!razon) {
    throw new Error('Falta la razón social del emisor.');
  }
  if (useEfact) {
    if (!canSendToEfact(restaurant)) {
      throw new Error(
        'Configure la URL del bot en el panel o defina EFACT_API_URL en el servidor (p. ej. http://127.0.0.1:8765 con Docker). El servicio Python debe estar en ejecución (p. ej. python server/efact/api_server.py desde la raíz del repo, o entrypoint Docker).'
      );
    }
    const serie = docType === 'factura'
      ? String(restaurant.billing_series_factura || '').trim()
      : String(restaurant.billing_series_boleta || '').trim();
    if (!serie) {
      throw new Error(docType === 'factura'
        ? 'Configure la serie de factura (p. ej. F001) en datos del emisor.'
        : 'Configure la serie de boleta (p. ej. B001) en datos del emisor.');
    }
  } else if (!canSendToNubefact(restaurant)) {
    throw new Error('Configure la URL y el token del proveedor de facturación (NubeFacT u otro).');
  }
}

function assertSunatOutcomeAcceptedOrOfflinePending(restaurant, useEfact, result) {
  const offline = isOfflineModeEnabled(restaurant);
  const { providerStatus, providerMessage, sunatDescription } = result;
  if (providerStatus === 'error') {
    throw new Error(
      String(sunatDescription || providerMessage || 'Emisión electrónica rechazada').trim() || 'Emisión electrónica rechazada'
    );
  }
  if (!useEfact) return;
  if (providerStatus === 'accepted') return;
  if (providerStatus === 'pending' && offline) return;
  throw new Error(
    String(sunatDescription || providerMessage || '').trim()
      || 'El comprobante no fue aceptado por SUNAT. Revise certificado .pfx, usuario SOL, ambiente (beta) y series autorizadas.'
  );
}

async function checkProviderReachability(restaurant) {
  const prov = String(restaurant?.billing_provider || '').toLowerCase();
  const url = prov === 'restaurant_efact'
    ? effectiveEfactApiUrl(restaurant)
    : String(restaurant?.billing_api_url || '').trim();
  if (!url) return false;
  const healthUrl = prov === 'restaurant_efact' ? url.replace(/\/$/, '') + '/health' : url;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    const response = await fetch(healthUrl, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return Boolean(response);
  } catch (_) {
    return false;
  }
}

function isOfflineModeEnabled(restaurant) {
  return Number(restaurant?.billing_offline_mode ?? 1) === 1;
}

function parseProviderPayload(rawPayload) {
  try {
    const payload = JSON.parse(rawPayload || '{}');
    return payload && typeof payload === 'object' ? payload : {};
  } catch (_) {
    return {};
  }
}

async function refreshDocWithLocalPdfIfNeeded(docId, restaurant) {
  let row = queryOne('SELECT * FROM electronic_documents WHERE id = ?', [docId]);
  if (!row) return null;
  const local = await ensureLocalFallbackPdfForDocumentRow(row, restaurant);
  if (local && !String(row.pdf_url || '').trim()) {
    runSql('UPDATE electronic_documents SET pdf_url = ? WHERE id = ?', [local, docId]);
    row = queryOne('SELECT * FROM electronic_documents WHERE id = ?', [docId]);
  }
  return row;
}

function persistBillingArtifacts(docId, { pdfUrl, xmlUrl, cdrUrl }) {
  const pdfStored =
    exportBillingPdfToUploads(docId, pdfUrl) || (isHttpPdfUrl(pdfUrl) ? String(pdfUrl || '').trim() : '');
  const xmlStored =
    exportBillingFileToUploads(docId, xmlUrl, 'xml') || (isHttpPdfUrl(xmlUrl) ? String(xmlUrl || '').trim() : '');
  const cdrStored =
    exportBillingFileToUploads(docId, cdrUrl, 'cdr') || (isHttpPdfUrl(cdrUrl) ? String(cdrUrl || '').trim() : '');
  return { pdfStored, xmlStored, cdrStored };
}

function applyProviderResultToDocument(docId, result) {
  const pr = result.providerResponse;
  const fromPaths = pr && typeof pr === 'object' ? String(pr.paths?.pdf || '').trim() : '';
  const rawPdf = String(result.pdfUrl || '').trim() || fromPaths;
  const rawXml = String(result.xmlUrl || '').trim();
  const rawCdr = String(result.cdrUrl || '').trim();
  const { pdfStored, xmlStored, cdrStored } = persistBillingArtifacts(docId, {
    pdfUrl: rawPdf,
    xmlUrl: rawXml,
    cdrUrl: rawCdr,
  });
  runSql(
    `UPDATE electronic_documents
     SET provider_status = ?, provider_message = ?, hash_code = ?, sunat_description = ?,
         xml_url = ?, cdr_url = ?, pdf_url = ?, provider_response = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [
      result.providerStatus,
      String(result.providerMessage || ''),
      String(result.hashCode || ''),
      String(result.sunatDescription || ''),
      String(xmlStored || rawXml || ''),
      String(cdrStored || rawCdr || ''),
      String(pdfStored || ''),
      JSON.stringify(result.providerResponse || {}),
      docId,
    ]
  );
}

const pendingLocalResult = () => ({
  providerStatus: 'pending',
  providerMessage: 'Comprobante generado localmente (pendiente de envío)',
  hashCode: '',
  sunatDescription: '',
  xmlUrl: '',
  cdrUrl: '',
  pdfUrl: '',
  providerResponse: {},
});

async function sendToNubefactProvider(restaurant, providerPayload) {
  const initial = pendingLocalResult();

  if (!canSendToNubefact(restaurant)) {
    return initial;
  }

  try {
    const response = await fetch(String(restaurant.billing_api_url).trim(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Token token=${String(restaurant.billing_api_token).trim()}`,
      },
      body: JSON.stringify(providerPayload),
    });

    const rawText = await response.text();
    let parsed = {};
    try {
      parsed = rawText ? JSON.parse(rawText) : {};
    } catch (_) {
      parsed = { raw: rawText };
    }

    if (!response.ok) {
      return {
        ...initial,
        providerStatus: 'error',
        providerMessage: parsed?.errors || parsed?.error || `Error HTTP ${response.status}`,
        providerResponse: parsed,
      };
    }

    const hashCode = parsed?.cadena_para_codigo_qr || parsed?.hash || '';
    const sunatDescription = parsed?.sunat_description || parsed?.mensaje || '';
    const xmlUrl = parsed?.enlace_del_xml || '';
    const cdrUrl = parsed?.enlace_del_cdr || '';
    const pdfUrl = parsed?.enlace_del_pdf || parsed?.pdf || '';
    const providerMessage = parsed?.mensaje || parsed?.sunat_description || 'Comprobante enviado al proveedor';
    const accepted = String(parsed?.sunat_description || '').toUpperCase().includes('ACEPTADA')
      || String(parsed?.aceptada || '').toLowerCase() === 'true'
      || String(parsed?.aceptada || '') === '1';

    return {
      providerStatus: accepted ? 'accepted' : 'sent',
      providerMessage,
      hashCode,
      sunatDescription,
      xmlUrl,
      cdrUrl,
      pdfUrl,
      providerResponse: parsed,
    };
  } catch (providerErr) {
    if (isOfflineModeEnabled(restaurant)) {
      return {
        ...initial,
        providerStatus: 'pending',
        providerMessage: 'Sin conexión: comprobante guardado en modo offline para sincronizar',
        providerResponse: { offline: true, error: providerErr.message || 'Sin conexión' },
      };
    }
    return {
      ...initial,
      providerStatus: 'error',
      providerMessage: providerErr.message || 'No se pudo conectar con el proveedor',
      providerResponse: { error: providerErr.message || 'No se pudo conectar con el proveedor' },
    };
  }
}

async function sendToEfactProvider(restaurant, saleJson) {
  const initial = pendingLocalResult();

  if (!canSendToEfact(restaurant)) {
    return initial;
  }

  try {
    const { response, providerResult } = await sendEfactSale(restaurant, saleJson);
    if (!response.ok) {
      return providerResult;
    }
    return providerResult;
  } catch (providerErr) {
    if (isOfflineModeEnabled(restaurant)) {
      return {
        ...initial,
        providerStatus: 'pending',
        providerMessage: 'Sin conexión: comprobante guardado en modo offline para sincronizar',
        providerResponse: { offline: true, error: providerErr.message || 'Sin conexión' },
      };
    }
    return {
      ...initial,
      providerStatus: 'error',
      providerMessage: providerErr.message || 'No se pudo conectar con el bot de facturación',
      providerResponse: { error: providerErr.message || 'No se pudo conectar con el bot de facturación' },
    };
  }
}

async function sendToProvider(restaurant, providerPayload) {
  const prov = String(restaurant.billing_provider || '').toLowerCase();
  if (prov === 'restaurant_efact') {
    return sendToEfactProvider(restaurant, providerPayload);
  }
  return sendToNubefactProvider(restaurant, providerPayload);
}

function buildNubefactPayload({ restaurant, order, items, customer, docType, series, correlative, invoiceLinesMode = 'detallado' }) {
  const taxRate = toNumber(restaurant.tax_rate, 18);
  const subtotal = round2(order.subtotal);
  const tax = round2(order.tax);
  const total = round2(order.total);

  let mappedItems;
  if (invoiceLinesMode === 'consumo') {
    const lineSubtotal = subtotal;
    const lineTax = tax;
    const lineTotal = total;
    const valorUnitario = lineSubtotal;
    const precioUnitario = lineTotal;
    mappedItems = [
      {
        unidad_de_medida: 'NIU',
        codigo: '',
        descripcion: 'VENTA POR CONSUMO',
        cantidad: 1,
        valor_unitario: valorUnitario,
        precio_unitario: precioUnitario,
        descuento: '',
        subtotal: lineSubtotal,
        tipo_de_igv: 1,
        igv: lineTax,
        total: lineTotal,
        anticipo_regularizacion: false,
      },
    ];
  } else {
    mappedItems = items.map((item) => {
      const quantity = toNumber(item.quantity, 0);
      const valorUnitario = round2(item.unit_price);
      const precioUnitario = round2(valorUnitario * (1 + taxRate / 100));
      const lineSubtotal = round2(item.subtotal);
      const lineTax = round2(lineSubtotal * (taxRate / 100));
      const lineTotal = round2(lineSubtotal + lineTax);

      return {
        unidad_de_medida: 'NIU',
        codigo: item.product_id || '',
        descripcion: item.product_name || 'Producto',
        cantidad: quantity,
        valor_unitario: valorUnitario,
        precio_unitario: precioUnitario,
        descuento: '',
        subtotal: lineSubtotal,
        tipo_de_igv: 1,
        igv: lineTax,
        total: lineTotal,
        anticipo_regularizacion: false,
      };
    });
  }

  return {
    operacion: 'generar_comprobante',
    tipo_de_comprobante: DOCS[docType].nubefactCode,
    serie,
    numero: correlative,
    sunat_transaction: 1,
    cliente_tipo_de_documento: customer.customerDocType || '0',
    cliente_numero_de_documento: customer.customerDocNumber || '',
    cliente_denominacion: customer.customerName,
    cliente_direccion: customer.customerAddress || 'LIMA',
    fecha_de_emision: formatIssueDate(),
    moneda: (restaurant.currency || 'PEN') === 'USD' ? '2' : '1',
    porcentaje_de_igv: taxRate,
    total_gravada: subtotal,
    total_igv: tax,
    total: total,
    enviar_automaticamente_a_la_sunat: true,
    enviar_automaticamente_al_cliente: false,
    codigo_unico: String(order.id || ''),
    condiciones_de_pago: '',
    medio_de_pago: order.payment_method || 'efectivo',
    placa_vehiculo: '',
    orden_compra_servicio: '',
    tabla_personalizada_codigo: '',
    formato_de_pdf: '',
    observaciones: order.notes || '',
    items: mappedItems,
  };
}

router.get('/config', authenticateToken, requireRole('admin', 'master_admin'), (req, res) => {
  const restaurant = queryOne('SELECT * FROM restaurants LIMIT 1');
  if (!restaurant) return res.status(404).json({ error: 'Restaurante no encontrado' });
  const effUrl = effectiveEfactApiUrl(restaurant);
  const effSecret = effectiveEfactHttpSecret(restaurant);
  const urlLocked = billingEfactUrlFromEnv();
  const secretLocked = billingEfactSecretFromEnv();
  res.json({
    company_ruc: restaurant.company_ruc || '',
    legal_name: restaurant.legal_name || '',
    billing_enabled: Number(restaurant.billing_enabled ?? 1),
    billing_provider: restaurant.billing_provider || 'restaurant_efact',
    billing_api_url: effUrl,
    billing_api_url_from_env: urlLocked,
    billing_api_token: '',
    has_billing_api_token: Boolean(effSecret),
    billing_api_secret_from_env: secretLocked,
    billing_series_boleta: restaurant.billing_series_boleta || '',
    billing_series_factura: restaurant.billing_series_factura || '',
    billing_offline_mode: Number(restaurant.billing_offline_mode ?? 1),
    billing_auto_retry_enabled: Number(restaurant.billing_auto_retry_enabled ?? 1),
    billing_auto_retry_interval_sec: Number(restaurant.billing_auto_retry_interval_sec || 120),
    billing_nombre_comercial: restaurant.billing_nombre_comercial || '',
    billing_emisor_ubigeo: restaurant.billing_emisor_ubigeo || '',
    billing_emisor_direccion: restaurant.billing_emisor_direccion || '',
    billing_emisor_provincia: restaurant.billing_emisor_provincia || '',
    billing_emisor_departamento: restaurant.billing_emisor_departamento || '',
    billing_emisor_distrito: restaurant.billing_emisor_distrito || '',
    allow_restaurant_admin_billing_bot:
      Number(getControlConfig().allow_restaurant_admin_billing_bot ?? 0) === 1,
  });
});

router.put('/config', authenticateToken, requireRole('admin', 'master_admin'), (req, res) => {
  try {
    const isMaster = req.user?.role === 'master_admin';
    if (
      !isMaster
      && Number(getControlConfig().allow_restaurant_admin_billing_bot ?? 0) !== 1
    ) {
      return res.status(403).json({
        error:
          'Solo el administrador maestro puede guardar el bot de facturación. Pídale al maestro que active «Permitir que el admin del restaurante edite el bot SUNAT» en Administrador maestro.',
      });
    }
    const current = queryOne('SELECT * FROM restaurants LIMIT 1');
    if (!current) return res.status(404).json({ error: 'Restaurante no encontrado' });

    const body = req.body || {};
    const {
      billing_offline_mode,
      billing_auto_retry_enabled,
      billing_auto_retry_interval_sec,
    } = body;
    const urlInBody = Object.prototype.hasOwnProperty.call(body, 'billing_api_url');
    const tokenInBody = Object.prototype.hasOwnProperty.call(body, 'billing_api_token');
    const billing_api_url = body.billing_api_url;
    const billing_api_token = body.billing_api_token;

    const urlLocked = billingEfactUrlFromEnv();
    const secretLocked = billingEfactSecretFromEnv();

    let nextUrl;
    if (urlLocked) {
      nextUrl = effectiveEfactApiUrl(current);
    } else if (urlInBody) {
      nextUrl = String(billing_api_url || '').trim();
    } else {
      nextUrl = String(current.billing_api_url || '').trim();
    }
    if (!urlLocked && nextUrl && !isAcceptableEfactApiUrlForStorage(nextUrl)) {
      return res.status(400).json({
        error:
          'La URL del bot debe ser una dirección http:// o https:// (p. ej. http://127.0.0.1:8765). No uses el usuario ni la contraseña de administrador en este campo.',
      });
    }

    let nextToken;
    if (secretLocked) {
      nextToken = String(current.billing_api_token || '').trim();
    } else if (tokenInBody) {
      const incoming = String(billing_api_token || '').trim();
      nextToken = incoming || String(current.billing_api_token || '').trim();
    } else {
      nextToken = String(current.billing_api_token || '').trim();
    }

    runSql(
      `UPDATE restaurants SET
        billing_enabled = 1,
        billing_provider = 'restaurant_efact',
        billing_api_url = ?,
        billing_api_token = ?,
        billing_offline_mode = ?,
        billing_auto_retry_enabled = ?,
        billing_auto_retry_interval_sec = ?,
        updated_at = datetime('now')
      WHERE id = ?`,
      [
        nextUrl,
        nextToken,
        Number(billing_offline_mode ? 1 : 0),
        Number(billing_auto_retry_enabled ? 1 : 0),
        Math.max(30, Math.min(3600, Number(billing_auto_retry_interval_sec || 120))),
        current.id,
      ]
    );

    const updated = queryOne('SELECT * FROM restaurants WHERE id = ?', [current.id]);
    const effUrl = effectiveEfactApiUrl(updated);
    const effSecret = effectiveEfactHttpSecret(updated);
    res.json({
      company_ruc: updated.company_ruc || '',
      legal_name: updated.legal_name || '',
      billing_enabled: Number(updated.billing_enabled ?? 1),
      billing_provider: updated.billing_provider || 'restaurant_efact',
      billing_api_url: effUrl,
      billing_api_url_from_env: urlLocked,
      billing_api_token: '',
      has_billing_api_token: Boolean(effSecret),
      billing_api_secret_from_env: secretLocked,
      billing_series_boleta: updated.billing_series_boleta || '',
      billing_series_factura: updated.billing_series_factura || '',
      billing_offline_mode: Number(updated.billing_offline_mode ?? 1),
      billing_auto_retry_enabled: Number(updated.billing_auto_retry_enabled ?? 1),
      billing_auto_retry_interval_sec: Number(updated.billing_auto_retry_interval_sec || 120),
      billing_nombre_comercial: updated.billing_nombre_comercial || '',
      billing_emisor_ubigeo: updated.billing_emisor_ubigeo || '',
      billing_emisor_direccion: updated.billing_emisor_direccion || '',
      billing_emisor_provincia: updated.billing_emisor_provincia || '',
      billing_emisor_departamento: updated.billing_emisor_departamento || '',
      billing_emisor_distrito: updated.billing_emisor_distrito || '',
      allow_restaurant_admin_billing_bot:
        Number(getControlConfig().allow_restaurant_admin_billing_bot ?? 0) === 1,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudo guardar la configuración de facturación' });
  }
});

router.get('/documents', authenticateToken, requireRole('admin', 'cajero'), async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50)));
    const status = String(req.query.status || '').trim();
    const docType = String(req.query.doc_type || '').trim();
    const search = String(req.query.search || '').trim();

    let sql = `SELECT d.*, o.table_number
      FROM electronic_documents d
      LEFT JOIN orders o ON o.id = d.order_id
      WHERE 1=1`;
    const params = [];

    if (status && status !== 'all') {
      sql += ' AND d.provider_status = ?';
      params.push(status);
    }
    if (docType && docType !== 'all') {
      sql += ' AND d.doc_type = ?';
      params.push(docType);
    }
    if (search) {
      sql += ` AND (
        d.full_number LIKE ?
        OR d.customer_name LIKE ?
        OR d.customer_doc_number LIKE ?
        OR IFNULL(d.customer_phone, '') LIKE ?
      )`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    sql += ' ORDER BY d.created_at DESC LIMIT ?';
    params.push(limit);
    let rows = queryAll(sql, params);
    const restaurant = queryOne('SELECT * FROM restaurants LIMIT 1');
    if (restaurant && rows.length) {
      rows = await Promise.all(
        rows.map(async (row) => {
          const pdfIsLocal = String(row.pdf_url || '') && !String(row.pdf_url || '').startsWith('/uploads') && !isHttpPdfUrl(row.pdf_url);
          const xmlIsLocal = String(row.xml_url || '') && !String(row.xml_url || '').startsWith('/uploads') && !isHttpPdfUrl(row.xml_url);
          const cdrIsLocal = String(row.cdr_url || '') && !String(row.cdr_url || '').startsWith('/uploads') && !isHttpPdfUrl(row.cdr_url);
          if (pdfIsLocal || xmlIsLocal || cdrIsLocal) {
            const arts = persistBillingArtifacts(row.id, {
              pdfUrl: row.pdf_url,
              xmlUrl: row.xml_url,
              cdrUrl: row.cdr_url,
            });
            if (arts.pdfStored || arts.xmlStored || arts.cdrStored) {
              runSql(
                `UPDATE electronic_documents SET pdf_url = ?, xml_url = ?, cdr_url = ?, updated_at = datetime('now') WHERE id = ?`,
                [
                  arts.pdfStored || row.pdf_url || '',
                  arts.xmlStored || row.xml_url || '',
                  arts.cdrStored || row.cdr_url || '',
                  row.id,
                ]
              );
              row = queryOne('SELECT * FROM electronic_documents WHERE id = ?', [row.id]) || row;
            }
          }
          if (String(row.doc_type) === 'nota_venta' && !String(row.pdf_url || '').trim()) {
            const r = await refreshDocWithLocalPdfIfNeeded(row.id, restaurant);
            return r || row;
          }
          return row;
        })
      );
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudo listar comprobantes' });
  }
});

router.get('/provider-status', authenticateToken, requireRole('admin', 'cajero', 'mozo'), async (req, res) => {
  try {
    const restaurant = queryOne('SELECT * FROM restaurants LIMIT 1');
    if (!restaurant) return res.status(404).json({ error: 'Restaurante no encontrado' });
    const pendingCount = queryOne(
      "SELECT COUNT(*) as c FROM electronic_documents WHERE provider_status IN ('pending', 'error')"
    )?.c || 0;
    const reachable = await checkProviderReachability(restaurant);

    res.json({
      billing_enabled: Number(restaurant.billing_enabled || 0),
      offline_mode: Number(restaurant.billing_offline_mode ?? 1),
      auto_retry_enabled: Number(restaurant.billing_auto_retry_enabled ?? 1),
      auto_retry_interval_sec: Number(restaurant.billing_auto_retry_interval_sec || 120),
      provider_reachable: reachable,
      pending_documents: Number(pendingCount || 0),
      checked_at: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudo consultar estado del proveedor' });
  }
});

async function issueDocumentForOrder({ orderId, docType, customer = {}, replaceExisting = false, invoiceLinesMode: invoiceLinesModeRaw }) {
  if (!orderId) throw new Error('Debes enviar order_id');
  if (!DOCS[docType] && docType !== 'nota_venta') throw new Error('Tipo de comprobante inválido');

  const existingDoc = queryOne('SELECT * FROM electronic_documents WHERE order_id = ?', [orderId]);
  if (existingDoc && !replaceExisting) return existingDoc;

  const order = queryOne('SELECT * FROM orders WHERE id = ?', [orderId]);
  if (!order) throw new Error('Pedido no encontrado');
  if (docType === 'nota_venta') {
    const restaurant = queryOne('SELECT * FROM restaurants LIMIT 1');
    if (!restaurant) throw new Error('No hay restaurante configurado');

    const noteNumber =
      String(order.sale_document_number || '').trim() ||
      `001-${String(order.order_number || 0).padStart(8, '0')}`;

    const sourceCustomer = {
      doc_type: customer?.doc_type || existingDoc?.customer_doc_type || '',
      doc_number: customer?.doc_number || existingDoc?.customer_doc_number || '',
      name: customer?.name || existingDoc?.customer_name || order.customer_name || 'CLIENTE VARIOS',
      address: customer?.address || existingDoc?.customer_address || 'LIMA',
    };
    const customerPhone = String(customer?.phone ?? existingDoc?.customer_phone ?? '').trim();
    const normalizedCustomer = normalizeCustomerForDoc('boleta', sourceCustomer);

    runSql(
      `UPDATE orders SET
        sale_document_type = 'nota_venta',
        sale_document_number = ?,
        customer_name = ?,
        updated_at = datetime('now')
      WHERE id = ?`,
      [noteNumber, normalizedCustomer.customerName, orderId]
    );

    runSql('DELETE FROM electronic_documents WHERE order_id = ?', [orderId]);

    const items = queryAll('SELECT * FROM order_items WHERE order_id = ?', [orderId]);
    if (items.length === 0) throw new Error('El pedido no tiene items');

    const dash = noteNumber.indexOf('-');
    const series = dash >= 0 ? noteNumber.slice(0, dash).trim() || '001' : '001';
    let correlative = 0;
    if (dash >= 0) {
      const tail = noteNumber.slice(dash + 1).replace(/\D/g, '');
      correlative = parseInt(tail, 10) || 0;
    }
    if (!correlative) correlative = Number(order.order_number) || 0;

    const docId = uuidv4();
    runSql(
      `INSERT INTO electronic_documents (
        id, order_id, order_number, doc_type, series, correlative, full_number,
        customer_doc_type, customer_doc_number, customer_name, customer_address, customer_phone,
        subtotal, tax, total, currency, payment_method,
        provider, provider_status, provider_message, hash_code, sunat_description,
        xml_url, cdr_url, pdf_url, provider_payload, provider_response,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        docId,
        order.id,
        order.order_number || null,
        'nota_venta',
        series,
        correlative,
        noteNumber,
        normalizedCustomer.customerDocType,
        normalizedCustomer.customerDocNumber,
        normalizedCustomer.customerName,
        normalizedCustomer.customerAddress,
        customerPhone,
        round2(order.subtotal),
        round2(order.tax),
        round2(order.total),
        restaurant.currency || 'PEN',
        order.payment_method || '',
        'local',
        'local',
        'Nota de venta local',
        '',
        '',
        '',
        '',
        '',
        '{}',
        '{}',
      ]
    );

    const finalDoc = await refreshDocWithLocalPdfIfNeeded(docId, restaurant);
    scheduleWhatsappPdfSend(finalDoc, restaurant);
    return finalDoc;
  }
  const items = queryAll('SELECT * FROM order_items WHERE order_id = ?', [orderId]);
  if (items.length === 0) throw new Error('El pedido no tiene items');
  const invoiceLinesMode = normalizeInvoiceLinesMode(invoiceLinesModeRaw);

  const restaurant = queryOne('SELECT * FROM restaurants LIMIT 1');
  if (!restaurant) throw new Error('No hay restaurante configurado');

  const useEfact = String(restaurant.billing_provider || '').toLowerCase() === 'restaurant_efact';
  assertRestaurantReadyForBillingIssue(restaurant, useEfact, docType);

  const sourceCustomer = {
    doc_type: customer?.doc_type || existingDoc?.customer_doc_type || '',
    doc_number: customer?.doc_number || existingDoc?.customer_doc_number || '',
    name: customer?.name || existingDoc?.customer_name || order.customer_name || 'CLIENTE VARIOS',
    address: customer?.address || existingDoc?.customer_address || 'LIMA',
  };
  const customerPhone = String(customer?.phone ?? existingDoc?.customer_phone ?? '').trim();
  const normalizedCustomer = normalizeCustomerForDoc(docType, sourceCustomer);
  const series = normalizeSeries(
    docType === 'factura' ? restaurant.billing_series_factura : restaurant.billing_series_boleta,
    DOCS[docType].fallbackSeries
  );
  const correlative = getNextCorrelative(docType, series, restaurant);
  const fullNumber = `${series}-${String(correlative).padStart(8, '0')}`;

  const providerPayload = useEfact
    ? buildEfactSaleJson({
      restaurant,
      order,
      items,
      customer: normalizedCustomer,
      docType,
      series,
      correlative,
      invoiceLinesMode,
    })
    : buildNubefactPayload({
      restaurant,
      order,
      items,
      customer: normalizedCustomer,
      docType,
      series,
      correlative,
      invoiceLinesMode,
    });

  const {
    providerStatus,
    providerMessage,
    hashCode,
    sunatDescription,
    xmlUrl,
    cdrUrl,
    pdfUrl,
    providerResponse,
  } = await sendToProvider(restaurant, providerPayload);
  const pdfFromPaths = String(providerResponse?.paths?.pdf || '').trim();

  if (replaceExisting && existingDoc) {
    runSql('DELETE FROM electronic_documents WHERE order_id = ?', [orderId]);
  }

  const docId = uuidv4();
  const rawPdfInsert = String(pdfUrl || '').trim() || pdfFromPaths;
  const { pdfStored, xmlStored, cdrStored } = persistBillingArtifacts(docId, {
    pdfUrl: rawPdfInsert,
    xmlUrl,
    cdrUrl,
  });
  let pdfFinal = pdfStored;
  if (!pdfFinal) {
    try {
      pdfFinal = await saveLocalFallbackReceiptPdf(docId, {
        restaurant,
        fullNumber,
        docType,
        order,
        items,
        customerName: normalizedCustomer.customerName,
        customerDocType: normalizedCustomer.customerDocType,
        customerDocNumber: normalizedCustomer.customerDocNumber,
        customerPhone,
        customerAddress: normalizedCustomer.customerAddress,
      });
    } catch (e) {
      console.warn('[billing-local-pdf]', e.message || e);
    }
  }
  runSql(
    `INSERT INTO electronic_documents (
      id, order_id, order_number, doc_type, series, correlative, full_number,
      customer_doc_type, customer_doc_number, customer_name, customer_address, customer_phone,
      subtotal, tax, total, currency, payment_method,
      provider, provider_status, provider_message, hash_code, sunat_description,
      xml_url, cdr_url, pdf_url, provider_payload, provider_response,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      docId,
      order.id,
      order.order_number || null,
      docType,
      series,
      correlative,
      fullNumber,
      normalizedCustomer.customerDocType,
      normalizedCustomer.customerDocNumber,
      normalizedCustomer.customerName,
      normalizedCustomer.customerAddress,
      customerPhone,
      round2(order.subtotal),
      round2(order.tax),
      round2(order.total),
      restaurant.currency || 'PEN',
      order.payment_method || '',
      restaurant.billing_provider || 'nubefact',
      providerStatus,
      String(providerMessage || ''),
      String(hashCode || ''),
      String(sunatDescription || ''),
      String(xmlStored || xmlUrl || ''),
      String(cdrStored || cdrUrl || ''),
      String(pdfFinal || ''),
      JSON.stringify(providerPayload),
      JSON.stringify(providerResponse || {}),
    ]
  );

  runSql(
    `UPDATE orders
     SET sale_document_type = ?,
         sale_document_number = ?,
         customer_name = ?,
         updated_at = datetime('now')
     WHERE id = ?`,
    [docType, fullNumber, normalizedCustomer.customerName, orderId]
  );

  const finalDoc = await refreshDocWithLocalPdfIfNeeded(docId, restaurant);
  scheduleWhatsappPdfSend(finalDoc, restaurant);
  return finalDoc;
}

router.post('/issue', authenticateToken, requireRole('admin', 'cajero', 'mozo'), async (req, res) => {
  try {
    const { order_id: orderId, doc_type: docTypeRaw, customer, invoice_lines_mode: invoiceLinesMode } = req.body || {};
    const docType = String(docTypeRaw || '').trim().toLowerCase();
    const created = await issueDocumentForOrder({
      orderId,
      docType,
      customer,
      replaceExisting: false,
      invoiceLinesMode,
    });
    emitOrderUpdateForBilling(req.app.get('io'), orderId);
    broadcastBillingDocumentRow(created);
    res.json(created);
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudo emitir comprobante electrónico' });
  }
});

router.put('/order/:orderId/document', authenticateToken, requireRole('admin', 'cajero', 'mozo'), async (req, res) => {
  try {
    const { orderId } = req.params;
    const { doc_type: docTypeRaw, customer, invoice_lines_mode: invoiceLinesMode } = req.body || {};
    const docType = String(docTypeRaw || '').trim().toLowerCase();
    const created = await issueDocumentForOrder({
      orderId,
      docType,
      customer,
      replaceExisting: true,
      invoiceLinesMode,
    });
    emitOrderUpdateForBilling(req.app.get('io'), orderId);
    broadcastBillingDocumentRow(created);
    res.json(created);
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudo cambiar el comprobante' });
  }
});

router.post('/:id/retry', authenticateToken, requireRole('admin', 'cajero'), async (req, res) => {
  try {
    const doc = queryOne('SELECT * FROM electronic_documents WHERE id = ?', [req.params.id]);
    if (!doc) return res.status(404).json({ error: 'Comprobante no encontrado' });
    if (String(doc.provider_status || '').toLowerCase() === 'local') {
      return res.status(400).json({ error: 'Las notas de venta locales no se envían al proveedor electrónico' });
    }
    if (!['error', 'pending', 'sent'].includes(String(doc.provider_status || '').toLowerCase())) {
      return res.status(400).json({ error: 'El comprobante no requiere reintento' });
    }

    const restaurant = queryOne('SELECT * FROM restaurants LIMIT 1');
    if (!restaurant) return res.status(400).json({ error: 'No hay restaurante configurado' });

    const payload = parseProviderPayload(doc.provider_payload);
    if (!payload || Object.keys(payload).length === 0) {
      return res.status(400).json({ error: 'No hay payload para reintentar este comprobante' });
    }

    const result = await sendToProvider(restaurant, payload);
    applyProviderResultToDocument(doc.id, result);

    const updated = await refreshDocWithLocalPdfIfNeeded(doc.id, restaurant);
    scheduleWhatsappPdfSend(updated, restaurant);
    emitOrderUpdateForBilling(req.app.get('io'), doc.order_id);
    broadcastBillingDocumentRow(updated);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudo reintentar el comprobante' });
  }
});

async function retryFailedDocumentsBatch({ limit = 20 } = {}) {
  const restaurant = queryOne('SELECT * FROM restaurants LIMIT 1');
  if (!restaurant) {
    return { processed: 0, success: 0, failed: 0, skipped: true, touchedOrderIds: [] };
  }
  if (!canSendToProvider(restaurant)) {
    return { processed: 0, success: 0, failed: 0, skipped: true, touchedOrderIds: [] };
  }

  const rows = queryAll(
    `SELECT * FROM electronic_documents
     WHERE provider_status IN ('error', 'pending')
     ORDER BY updated_at ASC
     LIMIT ?`,
    [Math.max(1, Math.min(50, Number(limit || 20)))]
  );

  let processed = 0;
  let success = 0;
  const touchedOrderIds = [];
  for (const row of rows) {
    const payload = parseProviderPayload(row.provider_payload);
    if (!payload || Object.keys(payload).length === 0) continue;
    const result = await sendToProvider(restaurant, payload);
    applyProviderResultToDocument(row.id, result);
    const updatedRow = await refreshDocWithLocalPdfIfNeeded(row.id, restaurant);
    scheduleWhatsappPdfSend(updatedRow, restaurant);
    broadcastBillingDocumentRow(updatedRow);
    processed += 1;
    if (row.order_id) touchedOrderIds.push(row.order_id);
    if (result.providerStatus === 'accepted' || result.providerStatus === 'sent') success += 1;
  }
  return {
    processed,
    success,
    failed: Math.max(0, processed - success),
    skipped: false,
    touchedOrderIds: [...new Set(touchedOrderIds)],
  };
}

router.post('/retry-failed', authenticateToken, requireRole('admin', 'cajero'), async (req, res) => {
  try {
    const result = await retryFailedDocumentsBatch({ limit: req.body?.limit || 20 });
    const io = req.app.get('io');
    if (io && Array.isArray(result.touchedOrderIds)) {
      for (const oid of result.touchedOrderIds) {
        emitOrderUpdateForBilling(io, oid);
      }
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudo ejecutar reintento masivo' });
  }
});

let autoRetryTimer = null;
let autoRetryRunning = false;
let autoRetryLastRunMs = 0;

function startBillingAutoRetryJob() {
  if (autoRetryTimer) return;
  autoRetryTimer = setInterval(async () => {
    if (autoRetryRunning) return;
    try {
      const restaurant = queryOne('SELECT * FROM restaurants LIMIT 1');
      if (!restaurant) return;
      if (Number(restaurant.billing_auto_retry_enabled ?? 1) !== 1) return;
      const intervalSec = Math.max(30, Math.min(3600, Number(restaurant.billing_auto_retry_interval_sec || 120)));
      const now = Date.now();
      if (now - autoRetryLastRunMs < intervalSec * 1000) return;
      autoRetryRunning = true;
      autoRetryLastRunMs = now;
      const batch = await retryFailedDocumentsBatch({ limit: 20 });
      const io = getSocketIo();
      if (io && Array.isArray(batch.touchedOrderIds)) {
        for (const oid of batch.touchedOrderIds) {
          emitOrderUpdateForBilling(io, oid);
        }
      }
    } catch (_) {
      // Silent by design: this runs in background.
    } finally {
      autoRetryRunning = false;
    }
  }, 10000);
}

module.exports = router;
module.exports.startBillingAutoRetryJob = startBillingAutoRetryJob;
