/**
 * Estado de verificación criptográfica de una firma DNIe.
 */
export default function SignatureValidationBadge({ slot }) {
  if (!slot || slot.status !== 'firmado') return null;

  const status = String(slot.validation_status || '').toUpperCase();
  const mock = Boolean(slot.mock);

  let label = 'Pendiente de validación técnica';
  let className = 'bg-amber-50 text-amber-900 border-amber-200';

  if (mock) {
    label = 'Firma MOCK (solo desarrollo)';
    className = 'bg-slate-100 text-slate-700 border-slate-200';
  } else if (status === 'VALID') {
    label = 'Firma verificada (RENIEC / PKI)';
    className = 'bg-emerald-50 text-emerald-900 border-emerald-200';
  } else if (status === 'REJECTED' || status === 'INVALID') {
    label = 'Firma rechazada';
    className = 'bg-red-50 text-red-900 border-red-200';
  } else if (status === 'PENDING_SERVER_PKI' || status === 'PENDING_TECHNICAL_VALIDATION') {
    label = 'Pendiente de verificación PKI RENIEC';
    className = 'bg-amber-50 text-amber-900 border-amber-200';
  }

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${className}`}
      title={slot.certificate_subject || slot.method || ''}
    >
      {label}
    </span>
  );
}
