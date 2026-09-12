const { queryOne, runSql } = require('../database');
const {
  SIGNATURE_STATUSES,
  emptyFirmaSlot,
  normalizeContrato,
  isFullySigned,
  hashContractText,
} = require('./contratoStore');

function ensureEmploymentContractColumn() {
  try {
    const cols = require('../database').queryAll('PRAGMA table_info(hr_employees)') || [];
    if (!cols.some((c) => c.name === 'employment_contract_json')) {
      runSql("ALTER TABLE hr_employees ADD COLUMN employment_contract_json TEXT DEFAULT ''");
    }
  } catch (_) {
    /* noop */
  }
}

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

function buildEmploymentAcceptanceFooter(contrato = {}) {
  const empleador = contrato.firma_vendedor || {};
  const empleado = contrato.firma_comprador || {};
  const empleadorNombre = empleador?.status === 'firmado'
    ? String(empleador.signer_name || '________________________').trim()
    : '________________________';
  const empleadoNombre = empleado?.status === 'firmado'
    ? String(empleado.signer_name || '________________________').trim()
    : '________________________';
  const fechaIso = contrato.firmado_en
    || (empleado?.status === 'firmado' && empleado.signed_at)
    || (empleador?.status === 'firmado' && empleador.signed_at)
    || '';
  const fecha = fechaIso ? formatPeDateTime(fechaIso) : '____/____/________';
  return `ACEPTACIÓN DIGITAL

EL EMPLEADOR: ${empleadorNombre}
${firmaLine(empleador)}

EL EMPLEADO: ${empleadoNombre}
${firmaLine(empleado)}
Fecha: ${fecha}`;
}

function stripEmploymentAcceptance(texto) {
  let out = String(texto || '');
  const trail = /\n+ACEPTACIÓN DIGITAL\s*\n+EL EMPLEADOR:[\s\S]*$/i;
  let guard = 0;
  while (trail.test(out) && guard < 8) {
    out = out.replace(trail, '');
    guard += 1;
  }
  return out.replace(/\s+$/, '');
}

function applyEmploymentSignaturesIntoText(texto, contrato = {}) {
  let t = String(texto || '');
  const anySigned = contrato.firma_comprador?.status === 'firmado'
    || contrato.firma_vendedor?.status === 'firmado';
  if (anySigned) {
    t = t.replace(/☐\s*Firma electrónica/g, '☑ Firma electrónica');
  }
  const body = stripEmploymentAcceptance(t);
  const footer = buildEmploymentAcceptanceFooter(contrato);
  if (!body) return footer;
  return `${body}\n\n${footer}`;
}

function defaultEmploymentText() {
  try {
    const { DEFAULT_EMPLOYMENT_CONTRACT_TEXT } = require('../data/defaultEmploymentContract');
    return String(DEFAULT_EMPLOYMENT_CONTRACT_TEXT || '');
  } catch {
    return '';
  }
}

function publicEmploymentContratoView(contrato) {
  const source = normalizeContrato(contrato || {});
  return {
    ...source,
    kind: 'employment',
    can_sign_again: !isFullySigned(source),
    text_locked: isFullySigned(source)
      || source.estado_firma === SIGNATURE_STATUSES.FIRMANDO
      || source.firma_comprador?.status === 'firmado'
      || source.firma_vendedor?.status === 'firmado',
  };
}

function readEmploymentContrato(employeeId) {
  ensureEmploymentContractColumn();
  const row = queryOne('SELECT employment_contract_json FROM hr_employees WHERE id = ?', [
    String(employeeId || ''),
  ]);
  let parsed = {};
  try {
    parsed = row?.employment_contract_json
      ? JSON.parse(row.employment_contract_json)
      : {};
  } catch {
    parsed = {};
  }
  const next = normalizeContrato(parsed);
  if (!String(next.texto_contrato || '').trim()) {
    next.texto_contrato = defaultEmploymentText();
  }
  return next;
}

function writeEmploymentContrato(employeeId, contrato) {
  ensureEmploymentContractColumn();
  const next = normalizeContrato(contrato);
  runSql(
    `UPDATE hr_employees SET employment_contract_json = ?, updated_at = datetime('now') WHERE id = ?`,
    [JSON.stringify(next), String(employeeId || '')],
  );
  return next;
}

function employmentContractSummary(employeeIdOrJson) {
  let raw = employeeIdOrJson;
  if (
    typeof employeeIdOrJson === 'string'
    && employeeIdOrJson.trim()
    && !employeeIdOrJson.trim().startsWith('{')
    && employeeIdOrJson.length < 80
  ) {
    const row = queryOne('SELECT employment_contract_json FROM hr_employees WHERE id = ?', [employeeIdOrJson]);
    raw = row?.employment_contract_json || '';
  }
  let parsed = {};
  try {
    parsed = typeof raw === 'string' && raw ? JSON.parse(raw) : (raw && typeof raw === 'object' ? raw : {});
  } catch {
    parsed = {};
  }
  const c = normalizeContrato(parsed);
  const employerSigned = c.firma_vendedor?.status === 'firmado';
  const employeeSigned = c.firma_comprador?.status === 'firmado';
  let label = 'Sin firmar';
  if (employerSigned && employeeSigned) label = 'Firmado';
  else if (employerSigned) label = 'Falta firma empleado';
  else if (c.estado_firma === SIGNATURE_STATUSES.FIRMANDO) label = 'En firma';
  else if (String(c.texto_contrato || '').trim()) label = 'Borrador';
  return {
    estado_firma: c.estado_firma,
    employer_signed: employerSigned,
    employee_signed: employeeSigned,
    fully_signed: employerSigned && employeeSigned,
    label,
  };
}

module.exports = {
  SIGNATURE_STATUSES,
  emptyFirmaSlot,
  ensureEmploymentContractColumn,
  readEmploymentContrato,
  writeEmploymentContrato,
  publicEmploymentContratoView,
  applyEmploymentSignaturesIntoText,
  employmentContractSummary,
  defaultEmploymentText,
  isFullySigned,
  hashContractText,
};
