const { queryOne } = require('./database');
const {
  getBusinessTodayDateKey,
  getBusinessMonthKey,
  sqlBusinessTimestamp,
} = require('./utils/appDateTime');

const PAYMENT_METHOD_LABELS = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  yape: 'Yape',
  plin: 'Plin',
  online: 'Online',
  cortesia: 'Cortesía',
};

function isCourtesyDiscountReason(text) {
  return /^cortes[ií]a\s*:/i.test(String(text || '').trim());
}

/** SQL: filas de pedido que son cortesía (método o nota histórica). */
const COURTESY_ORDER_WHERE_SQL =
  "(IFNULL(payment_method, '') = 'cortesia' OR notes LIKE '%[DESCUENTO: Cortes%' OR notes LIKE '%[DESCUENTO: cortes%')";

function isCourtesyOrderRecord(row) {
  if (String(row?.payment_method || '').trim().toLowerCase() === COURTESY_PAYMENT_METHOD) return true;
  return /\[DESCUENTO:\s*Cortes/i.test(String(row?.notes || ''));
}

function parseCourtesyReasonFromNotes(notes) {
  const raw = String(notes || '');
  const tagged = raw.match(/\[DESCUENTO:\s*(Cortes[ií]a:\s*[^\]]+)\]/i);
  if (tagged) return tagged[1].replace(/^Cortes[ií]a:\s*/i, '').trim();
  const generic = raw.match(/\[DESCUENTO:\s*([^\]]+)\]/);
  return generic ? generic[1].trim() : '';
}

function courtesyReferenceAmount(order) {
  const disc = Number(order?.discount || 0);
  if (disc > 0) return disc;
  return Math.max(0, Number(order?.subtotal || 0) + Number(order?.delivery_fee || 0));
}

/** Pedidos con descuento o cortesía aplicados al cobrar. */
const SALES_ADJUSTMENT_WHERE_SQL =
  `(IFNULL(discount, 0) > 0.009 OR ${COURTESY_ORDER_WHERE_SQL})`;

function parseAdjustmentReasonFromNotes(notes) {
  return parseCourtesyReasonFromNotes(notes);
}

function classifySalesAdjustment(order) {
  if (isCourtesyOrderRecord(order)) return 'cortesia';
  if (Number(order?.discount || 0) > 0.009) return 'descuento';
  return null;
}

function adjustmentDiscountAmount(order) {
  if (isCourtesyOrderRecord(order)) return courtesyReferenceAmount(order);
  return Math.max(0, Number(order?.discount || 0));
}

function adjustmentAmountCharged(order) {
  if (isCourtesyOrderRecord(order)) return 0;
  return Math.max(0, Number(order?.total || 0));
}

function parseJsonSafe(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (_) {
    return fallback;
  }
}

function normalizeMethodName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function mapMethodNameToId(value) {
  const normalized = normalizeMethodName(value);
  if (!normalized) return '';
  if (normalized.includes('efect')) return 'efectivo';
  if (normalized.includes('tarjet')) return 'tarjeta';
  if (normalized.includes('yape')) return 'yape';
  if (normalized.includes('plin')) return 'plin';
  if (normalized === 'efectivo' || normalized === 'tarjeta' || normalized === 'yape' || normalized === 'plin') return normalized;
  return '';
}

function getAppSettingsSnapshot() {
  const pagosRow = queryOne('SELECT value FROM app_settings WHERE key = ?', ['pagos_sistema']);
  const settingsRow = queryOne('SELECT value FROM app_settings WHERE key = ?', ['settings']);
  return {
    pagosSistema: parseJsonSafe(pagosRow?.value, {}),
    settings: parseJsonSafe(settingsRow?.value, {}),
  };
}

function paymentIdsFromPagosSistema(pagosSistema) {
  const pagos = pagosSistema || {};
  const ids = [];
  if (Number(pagos.acepta_efectivo ?? 1) === 1) ids.push('efectivo');
  if (Number(pagos.acepta_tarjeta ?? 1) === 1) ids.push('tarjeta');
  if (Number(pagos.acepta_yape ?? 1) === 1) ids.push('yape');
  if (Number(pagos.acepta_plin ?? 1) === 1) ids.push('plin');
  return ids;
}

function getAllowedPaymentMethods() {
  const { pagosSistema, settings } = getAppSettingsSnapshot();
  const formasPago = Array.isArray(settings?.formas_pago) ? settings.formas_pago : [];
  const seen = new Set();
  const ordered = [];

  for (const item of formasPago.filter((row) => Number(row?.active ?? 1) === 1)) {
    const id = mapMethodNameToId(item?.name);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }

  for (const id of paymentIdsFromPagosSistema(pagosSistema)) {
    if (seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }

  if (ordered.length === 0) return ['efectivo', 'tarjeta'];
  return ordered;
}

function getPaymentMethodOptionsPayload({ includeOnline = false } = {}) {
  const { pagosSistema, settings } = getAppSettingsSnapshot();
  const formasPago = Array.isArray(settings?.formas_pago) ? settings.formas_pago : [];
  const seen = new Set();
  const options = [];

  for (const item of formasPago.filter((row) => Number(row?.active ?? 1) === 1)) {
    const id = mapMethodNameToId(item?.name);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const customLabel = String(item?.name || '').trim();
    options.push({ value: id, label: customLabel || PAYMENT_METHOD_LABELS[id] || id });
  }

  for (const id of paymentIdsFromPagosSistema(pagosSistema)) {
    if (seen.has(id)) continue;
    seen.add(id);
    options.push({ value: id, label: PAYMENT_METHOD_LABELS[id] || id });
  }

  if (includeOnline) options.push({ value: 'online', label: PAYMENT_METHOD_LABELS.online });
  if (options.length === 0) {
    return [
      { value: 'efectivo', label: PAYMENT_METHOD_LABELS.efectivo },
      { value: 'yape', label: PAYMENT_METHOD_LABELS.yape },
      { value: 'plin', label: PAYMENT_METHOD_LABELS.plin },
      { value: 'tarjeta', label: PAYMENT_METHOD_LABELS.tarjeta },
    ];
  }
  return options;
}

function normalizePaymentMethod(rawMethod, { fallback = 'efectivo', allowOnline = false } = {}) {
  const requested = String(rawMethod || '').trim().toLowerCase();
  if (!requested) return fallback;
  if (requested === COURTESY_PAYMENT_METHOD) return COURTESY_PAYMENT_METHOD;
  if (allowOnline && requested === 'online') return 'online';
  const allowed = getAllowedPaymentMethods();
  if (allowed.includes(requested)) return requested;
  return fallback;
}

function isPaymentMethodAllowed(method, { allowOnline = false } = {}) {
  const normalized = String(method || '').trim().toLowerCase();
  if (allowOnline && normalized === 'online') return true;
  return getAllowedPaymentMethods().includes(normalized);
}

function assertPaymentMethodAllowed(method, { allowOnline = false } = {}) {
  if (isPaymentMethodAllowed(method, { allowOnline })) return;
  const allowed = getAllowedPaymentMethods();
  const labels = allowed.map((m) => PAYMENT_METHOD_LABELS[m] || m).join(', ');
  throw new Error(`Método de pago no permitido. Configuración actual: ${labels}`);
}


const COURTESY_PAYMENT_METHOD = 'cortesia';
const FINANCIAL_FILTER_SQL =
  "status != 'cancelled' AND payment_status = 'paid' AND IFNULL(payment_method, '') != 'cortesia'";

/** Expresiones SQL de ventas en zona horaria del restaurante (p. ej. America/Lima). */
function getSalesEventSql() {
  const at = 'COALESCE(updated_at, created_at)';
  const local = sqlBusinessTimestamp(at, queryOne);
  const orderAt = 'COALESCE(o.updated_at, o.created_at)';
  const orderLocal = sqlBusinessTimestamp(orderAt, queryOne);
  const today = getBusinessTodayDateKey(queryOne);
  const month = getBusinessMonthKey(queryOne);
  return {
    EVENT_AT: at,
    EVENT_LOCAL: local,
    EVENT_DATE: `DATE(${local})`,
    EVENT_MONTH: `strftime('%Y-%m', ${local})`,
    EVENT_HOUR: `strftime('%H', ${local})`,
    ORDER_LOCAL: orderLocal,
    ORDER_DATE: `DATE(${orderLocal})`,
    ORDER_MONTH: `strftime('%Y-%m', ${orderLocal})`,
    TODAY: `'${today}'`,
    MONTH: `'${month}'`,
  };
}

function getLocalTodayDateKey() {
  return getBusinessTodayDateKey(queryOne);
}

/** @deprecated Use getSalesEventSql().TODAY */
function getLocalTodaySql() {
  return getSalesEventSql().TODAY;
}

module.exports = {
  COURTESY_PAYMENT_METHOD,
  COURTESY_ORDER_WHERE_SQL,
  SALES_ADJUSTMENT_WHERE_SQL,
  FINANCIAL_FILTER_SQL,
  getSalesEventSql,
  getLocalTodaySql,
  getLocalTodayDateKey,
  getAllowedPaymentMethods,
  getPaymentMethodOptionsPayload,
  normalizePaymentMethod,
  isPaymentMethodAllowed,
  assertPaymentMethodAllowed,
  isCourtesyDiscountReason,
  isCourtesyOrderRecord,
  parseCourtesyReasonFromNotes,
  parseAdjustmentReasonFromNotes,
  courtesyReferenceAmount,
  classifySalesAdjustment,
  adjustmentDiscountAmount,
  adjustmentAmountCharged,
};
