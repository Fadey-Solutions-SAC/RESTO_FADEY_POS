/**
 * Construye el JSON esperado por el bot Python (server/efact) y llama a su API HTTP.
 */

const fs = require('fs');
const path = require('path');
const { effectiveEfactApiUrl, effectiveEfactHttpSecret } = require('./efactConnection');
const { getUploadsRoot } = require('./uploadsPath');

/** Rutas subidas por el panel (/uploads/...) → ruta absoluta en el mismo host que Node. */
function resolveCertPathForBot(certPath) {
  const s = String(certPath || '').trim();
  if (!s) return '';
  const norm = s.replace(/\\/g, '/');
  if (/^\/?uploads\//i.test(norm)) {
    const rel = norm.replace(/^\/?uploads\/?/i, '');
    return path.join(getUploadsRoot(), rel);
  }
  if (path.isAbsolute(s)) return s;
  return path.resolve(process.cwd(), s);
}

function parseBillingPanelJson(restaurant) {
  try {
    const raw = restaurant?.billing_panel_json;
    const o = raw ? JSON.parse(raw) : {};
    return o && typeof o === 'object' ? o : {};
  } catch (_) {
    return {};
  }
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round2(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

function formatIssueDateIso(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatIssueTime(date = new Date()) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function foldPlace(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** «LIMA» a secas es el valor por defecto viejo, no la dirección del local. */
function isPlaceholderLima(value) {
  const folded = foldPlace(value);
  return !folded || folded === 'LIMA' || folded === 'LIMA LIMA' || folded === 'LIMA LIMA LIMA';
}

/** Distrito|departamento → ubigeo INEI. Moyobamba es distrito y provincia. */
const UBIGEO_POR_LUGAR = {
  'MOYOBAMBA|SAN MARTIN': '220101',
  'TARAPOTO|SAN MARTIN': '220901',
  'RIOJA|SAN MARTIN': '220801',
  'JUANJUI|SAN MARTIN': '220601',
  'LAMAS|SAN MARTIN': '220501',
  'LIMA|LIMA': '150101',
};

function parseFiscalPlace(address) {
  const parts = String(address || '')
    .split(/\s*[-–—,/]\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return { distrito: '', provincia: '', departamento: '' };
  return {
    distrito: parts[0],
    provincia: parts.length >= 3 ? parts[1] : parts[0],
    departamento: parts[parts.length - 1],
  };
}

function resolveEmisorGeo(restaurant, direccionFiscal) {
  const parsed = parseFiscalPlace(direccionFiscal);
  const stored = {
    distrito: String(restaurant.billing_emisor_distrito || '').trim(),
    provincia: String(restaurant.billing_emisor_provincia || '').trim(),
    departamento: String(restaurant.billing_emisor_departamento || '').trim(),
    ubigeo: String(restaurant.billing_emisor_ubigeo || '').trim(),
  };
  const distrito = isPlaceholderLima(stored.distrito) && parsed.distrito
    ? parsed.distrito
    : (stored.distrito || parsed.distrito || '');
  const provincia = isPlaceholderLima(stored.provincia) && parsed.provincia
    ? parsed.provincia
    : (stored.provincia || parsed.provincia || '');
  const departamento = isPlaceholderLima(stored.departamento) && parsed.departamento
    ? parsed.departamento
    : (stored.departamento || parsed.departamento || '');
  const known = UBIGEO_POR_LUGAR[`${foldPlace(distrito)}|${foldPlace(departamento)}`] || '';
  const departmentIsLima = foldPlace(departamento) === 'LIMA';
  let ubigeo = stored.ubigeo;
  if ((!ubigeo || ubigeo === '150101') && known && !departmentIsLima) ubigeo = known;
  if (!ubigeo) ubigeo = known || (departmentIsLima ? '150101' : '');
  return {
    distrito: distrito || 'LIMA',
    provincia: provincia || 'LIMA',
    departamento: departamento || 'LIMA',
    ubigeo: ubigeo || '150101',
  };
}

/** Catálogo 07: 10 gravado, 20 exonerado, 30 inafecto. */
function afectacionFromTaxType(taxType) {
  const kind = String(taxType || 'igv').toLowerCase();
  if (kind === 'exonerado') return '20';
  if (kind === 'inafecto') return '30';
  return '10';
}

function afectacionConsumo(items) {
  const codes = (items || []).map((item) => afectacionFromTaxType(item.tax_type));
  if (codes.length && codes.every((code) => code === '20')) return '20';
  if (codes.length && codes.every((code) => code === '30')) return '30';
  return '10';
}

function buildEfactSaleJson({
  restaurant,
  order,
  items,
  customer,
  docType,
  series,
  correlative,
  invoiceLinesMode = 'detallado',
}) {
  const taxRate = toNumber(restaurant.tax_rate, 18);
  const ruc = String(restaurant.company_ruc || '').replace(/\D/g, '').slice(0, 11);
  const razon = String(
    restaurant.legal_name
    || restaurant.billing_nombre_comercial
    || restaurant.name
    || '',
  ).trim();
  if (!ruc) throw new Error('Configure el RUC del emisor en Facturación electrónica y guarde los cambios');
  if (!/^\d{11}$/.test(ruc)) throw new Error('El RUC del emisor debe tener 11 dígitos');
  if (!razon) throw new Error('Configure la razón social / apellidos y nombres del emisor en Facturación electrónica');

  const lineas = invoiceLinesMode === 'consumo'
    ? [
      {
        descripcion: 'VENTA POR CONSUMO',
        cantidad: '1',
        precio_unitario_sin_igv: round2(order.subtotal).toFixed(2),
        codigo_afectacion_igv: afectacionConsumo(items),
      },
    ]
    : items.map((item) => {
      const quantity = toNumber(item.quantity, 0);
      const precioSin = round2(item.unit_price);
      return {
        descripcion: item.product_name || 'Producto',
        cantidad: String(quantity),
        precio_unitario_sin_igv: precioSin.toFixed(2),
        codigo_afectacion_igv: afectacionFromTaxType(item.tax_type),
      };
    });

  const direccionFiscal = String(restaurant.billing_emisor_direccion || '').trim()
    || String(restaurant.address || '').trim()
    || 'LIMA';

  const docNum = String(customer.customerDocNumber || '').trim();
  const tipoDoc = String(customer.customerDocType || '1').trim();

  const geo = resolveEmisorGeo(restaurant, direccionFiscal);
  const ubigeo = geo.ubigeo;
  const provincia = geo.provincia;
  const departamento = geo.departamento;
  const distrito = geo.distrito;
  const direccionCliente = isPlaceholderLima(customer.customerAddress)
    ? (isPlaceholderLima(direccionFiscal) ? (customer.customerAddress || 'SIN DIRECCION') : direccionFiscal)
    : customer.customerAddress;

  const panel = parseBillingPanelJson(restaurant);
  const usuarioSol = String(panel.sol_usuario || '').trim();
  const claveSol = String(panel.sol_clave || '').trim();
  const ambiente = panel.sunat_modo === 'produccion' ? 'produccion' : 'beta';
  const certPath = String(panel.cert_pfx_path || '').trim();
  const certPwd = String(panel.cert_pfx_password || '').trim();

  const payload = {
    tipo: docType === 'factura' ? '01' : '03',
    serie: series,
    correlativo: toNumber(correlative, 1),
    fecha_emision: formatIssueDateIso(),
    hora_emision: formatIssueTime(),
    moneda: (restaurant.currency || 'PEN') === 'USD' ? 'USD' : 'PEN',
    porcentaje_igv: String(taxRate),
    observaciones: String(order.notes || '').trim() || `Pedido #${order.order_number || order.id}`,
    emisor: {
      ruc,
      razon_social: razon,
      nombre_comercial: String(restaurant.billing_nombre_comercial || restaurant.name || '').trim() || razon,
      ubigeo,
      direccion: direccionFiscal,
      provincia,
      departamento,
      distrito,
      telefono: String(restaurant.phone || '').trim(),
      correo: String(restaurant.email || '').trim(),
    },
    cliente: {
      tipo_doc: tipoDoc,
      numero_doc: docNum || (tipoDoc === '6' ? '' : '00000000'),
      razon_social: customer.customerName,
      direccion: direccionCliente,
    },
    lineas,
  };

  if (usuarioSol && claveSol) {
    payload.panel_credenciales = {
      ruc,
      usuario_sol: usuarioSol,
      clave_sol: claveSol,
      ambiente,
    };
  }
  if (certPath && certPwd) {
    const abs = resolveCertPathForBot(certPath);
    payload.panel_certificado = { ruta_pfx: abs || certPath, password: certPwd };
  }

  return payload;
}

/**
 * Copia del JSON para que el navegador de esta PC lo mande al bot local.
 * El .pfx del servidor viaja en base64: el bot de la PC no ve el disco del servidor.
 */
function prepareRelaySale(saleJson) {
  let sale;
  try {
    sale = JSON.parse(JSON.stringify(saleJson || {}));
  } catch (_) {
    return saleJson || {};
  }
  const cert = sale.panel_certificado;
  if (!cert || typeof cert !== 'object') return sale;
  const abs = resolveCertPathForBot(cert.ruta_pfx);
  if (abs && fs.existsSync(abs)) {
    try {
      const buf = fs.readFileSync(abs);
      if (buf.length > 0 && buf.length < 2_000_000) {
        cert.pfx_base64 = buf.toString('base64');
        delete cert.ruta_pfx;
      }
    } catch (_) {
      /* el bot avisará si no puede firmar */
    }
  }
  return sale;
}

function describeBotMessage(parsed) {
  const bits = [];
  const push = (value) => {
    const text = typeof value === 'string' ? value.trim() : '';
    if (text && !bits.includes(text)) bits.push(text);
  };
  push(parsed?.sunat?.mensaje);
  push(parsed?.mensaje);
  push(parsed?.detail);
  if (typeof parsed?.error === 'string') push(parsed.error);
  else if (parsed?.error && typeof parsed.error === 'object') {
    push(parsed.error.message || parsed.error.detail);
  }
  return bits.filter((text) => text !== 'Procesado').join(' — ');
}

function mapEfactResponseToProviderResult(parsed, responseOk) {
  const initial = {
    providerStatus: 'pending',
    providerMessage: 'Comprobante generado localmente (pendiente de envío)',
    hashCode: '',
    sunatDescription: '',
    xmlUrl: '',
    cdrUrl: '',
    pdfUrl: '',
    providerResponse: parsed || {},
  };

  if (!responseOk) {
    const msg = describeBotMessage(parsed) || 'Error HTTP en API del bot';
    const pathsErr = parsed?.paths && typeof parsed.paths === 'object' ? parsed.paths : {};
    return {
      ...initial,
      providerStatus: 'error',
      providerMessage: msg,
      pdfUrl: String(pathsErr.pdf || ''),
      xmlUrl: String(pathsErr.xml_firmado || pathsErr.xml_sin_firma || ''),
      cdrUrl: String(pathsErr.cdr_xml || pathsErr.cdr_zip || ''),
      providerResponse: parsed || {},
    };
  }

  const sunat = parsed?.sunat;
  const sunatOk = sunat && sunat.ok === true;
  const sunatRespondio = Boolean(sunat?.respondio) || Boolean(pathsHaveCdr(parsed));
  const flowFailed = parsed?.ok === false;
  const paths = parsed?.paths || {};
  const hasSignedXml = Boolean(paths.xml_firmado);
  /** Sin .pfx el bot solo genera XML/PDF y no debe considerarse éxito SUNAT. */
  const noSunatFlow = !flowFailed && parsed?.ok !== false && !hasSignedXml && sunat == null;

  let providerStatus = 'sent';
  if (sunatOk) providerStatus = 'accepted';
  else if (flowFailed || (sunat && sunat.ok === false)) providerStatus = 'error';
  else if (noSunatFlow) providerStatus = 'error';
  else if (sunatRespondio && !sunatOk) providerStatus = 'error';
  else if (hasSignedXml && sunat == null) providerStatus = 'sent';

  const noCertMsg =
    'Falta certificado digital (.pfx/.p12) o su contraseña. Súbalo en Facturación electrónica y guarde.';

  const sunatMsg = String(sunat?.mensaje || parsed?.mensaje || '');
  const digest = String(parsed?.hash || '').trim();
  const hashCode = digest.length >= 20 ? digest : '';
  return {
    providerStatus,
    providerMessage: noSunatFlow
      ? noCertMsg
      : (sunatMsg || (parsed?.ok ? 'Procesado por bot local' : 'Revisar respuesta del bot')),
    hashCode,
    sunatDescription: sunatMsg,
    xmlUrl: String(paths.xml_firmado || paths.xml_sin_firma || ''),
    cdrUrl: String(paths.cdr_xml || paths.cdr_zip || ''),
    pdfUrl: String(paths.pdf || ''),
    providerResponse: parsed || {},
  };
}

function pathsHaveCdr(parsed) {
  const p = parsed?.paths;
  return Boolean(p && (p.cdr_xml || p.cdr_zip));
}

async function sendEfactSale(restaurant, saleJson) {
  const base = String(effectiveEfactApiUrl(restaurant) || '').replace(/\/$/, '');
  if (!base) {
    const err = { error: 'Falta URL del bot e-fact (http://… en Mi Restaurante o variable EFACT_API_URL en el servidor).' };
    return {
      response: { ok: false, status: 503 },
      parsed: err,
      providerResult: mapEfactResponseToProviderResult(err, false),
    };
  }
  const secret = String(effectiveEfactHttpSecret(restaurant) || '').trim();
  const headers = { 'Content-Type': 'application/json' };
  if (secret) headers['X-EFACT-SECRET'] = secret;

  const response = await fetch(`${base}/emitir`, {
    method: 'POST',
    headers,
    body: JSON.stringify(saleJson),
  });

  const rawText = await response.text();
  let parsed = {};
  try {
    parsed = rawText ? JSON.parse(rawText) : {};
  } catch (_) {
    parsed = { raw: rawText };
  }

  return {
    response,
    parsed,
    providerResult: mapEfactResponseToProviderResult(parsed, response.ok),
  };
}

module.exports = {
  buildEfactSaleJson,
  prepareRelaySale,
  sendEfactSale,
  mapEfactResponseToProviderResult,
};
