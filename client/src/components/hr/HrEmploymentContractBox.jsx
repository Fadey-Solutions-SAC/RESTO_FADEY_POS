import { useEffect, useRef, useState } from 'react';
import {
  MdExpandMore,
  MdExpandLess,
  MdDraw,
  MdCheckCircle,
  MdNfc,
  MdPictureAsPdf,
  MdContentCopy,
  MdLock,
} from 'react-icons/md';
import toast from 'react-hot-toast';
import { api, resolveMediaUrl } from '../../utils/api';
import { DEFAULT_EMPLOYMENT_CONTRACT_TEXT } from '../../data/defaultEmploymentContract';
import Modal from '../Modal';

function formatLocalDate() {
  try {
    return new Date().toLocaleDateString('es-PE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function qrImageUrl(data) {
  const q = encodeURIComponent(String(data || ''));
  return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${q}`;
}

function applyEmploymentFooter(texto, contrato = {}) {
  let t = String(texto || '');
  const empleador = contrato.firma_vendedor || {};
  const empleado = contrato.firma_comprador || {};
  const anySigned = empleador.status === 'firmado' || empleado.status === 'firmado';
  if (anySigned) t = t.replace(/☐\s*Firma electrónica/g, '☑ Firma electrónica');

  const fmt = (iso) => {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString('es-PE'); } catch { return String(iso); }
  };
  const line = (slot) => {
    if (!slot || slot.status !== 'firmado') return 'Firma: ________________________';
    const name = String(slot.signer_name || 'Firmado digitalmente').trim();
    const doc = slot.document_number ? ` · Doc. ${slot.document_number}` : '';
    const when = slot.signed_at ? ` · ${fmt(slot.signed_at)}` : '';
    return `Firma: ${name}${doc}${when}`;
  };
  const empleadorNombre = empleador.status === 'firmado'
    ? String(empleador.signer_name || '________________________')
    : '________________________';
  const empleadoNombre = empleado.status === 'firmado'
    ? String(empleado.signer_name || '________________________')
    : '________________________';
  const fechaIso = contrato.firmado_en || empleador.signed_at || empleado.signed_at || '';
  const fecha = fechaIso ? fmt(fechaIso) : '____/____/________';
  const footer = `ACEPTACIÓN DIGITAL

EL EMPLEADOR: ${empleadorNombre}
${line(empleador)}

EL EMPLEADO: ${empleadoNombre}
${line(empleado)}
Fecha: ${fecha}`;

  const body = t.replace(/\n+ACEPTACIÓN DIGITAL\s*\n+EL EMPLEADOR:[\s\S]*$/i, '').replace(/\s+$/, '');
  return body ? `${body}\n\n${footer}` : footer;
}

/**
 * Cuadro de contrato laboral: se despliega al clic.
 * Firma digital DNIe (mismo canal móvil): primero empleador, luego empleado.
 */
export default function HrEmploymentContractBox({
  employeeId,
  employeeName = '',
  contractType = '',
  onContractTypeChange,
  summaryLabel = '',
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [contrato, setContrato] = useState(null);
  const [signOpen, setSignOpen] = useState(false);
  const [signParty, setSignParty] = useState('empleador');
  const [ack, setAck] = useState(false);
  const [docNumber, setDocNumber] = useState('');
  const [signerName, setSignerName] = useState('');
  const [signLocalDate, setSignLocalDate] = useState(() => formatLocalDate());
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('confirm');
  const [session, setSession] = useState(null);
  const [signFullyDone, setSignFullyDone] = useState(false);
  const pollRef = useRef(null);

  const textLocked = Boolean(contrato?.text_locked);
  const employerSigned = contrato?.firma_vendedor?.status === 'firmado';
  const employeeSigned = contrato?.firma_comprador?.status === 'firmado';
  const fullySigned = Boolean(contrato?.estado_firma === 'firmado' || (employerSigned && employeeSigned));
  const statusLabel = fullySigned
    ? 'Firmado'
    : employerSigned
      ? 'Falta firma empleado'
      : (summaryLabel || contrato?.estado_firma || 'Sin firmar');

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => () => stopPoll(), []);

  const loadContract = async () => {
    if (!employeeId) return;
    setLoading(true);
    try {
      const data = await api.get(`/hr/employees/${employeeId}/contract`);
      setContrato(data?.contrato || null);
    } catch (err) {
      toast.error(err.message || 'No se pudo cargar el contrato');
    } finally {
      setLoading(false);
    }
  };

  const toggleOpen = async () => {
    const next = !open;
    setOpen(next);
    if (next && !contrato) await loadContract();
  };

  const saveText = async () => {
    if (!employeeId || !contrato || textLocked) return;
    setSaving(true);
    try {
      const data = await api.put(`/hr/employees/${employeeId}/contract`, {
        texto_contrato: contrato.texto_contrato || '',
      });
      setContrato(data?.contrato || contrato);
      toast.success('Contrato guardado');
    } catch (err) {
      toast.error(err.message || 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  const openSign = (party) => {
    if (fullySigned) {
      toast.error('Este contrato ya está firmado por ambas partes.');
      return;
    }
    if (party === 'empleado' && !employerSigned) {
      toast.error('Primero debe firmar el empleador.');
      return;
    }
    if (party === 'empleador' && employerSigned) {
      toast.error('El empleador ya firmó.');
      return;
    }
    if (party === 'empleado' && employeeSigned) {
      toast.error('El empleado ya firmó.');
      return;
    }
    stopPoll();
    setSignParty(party);
    setAck(false);
    setDocNumber('');
    setSignerName(party === 'empleado' ? String(employeeName || '') : '');
    setSignLocalDate(formatLocalDate());
    setStep('confirm');
    setSignFullyDone(false);
    setSession(null);
    setSignOpen(true);
  };

  const closeSign = () => {
    if (busy) return;
    stopPoll();
    setSignOpen(false);
  };

  const onSignedOk = (done) => {
    if (done?.contrato) setContrato(done.contrato);
    setSignFullyDone(Boolean(done?.fully_signed));
    setStep('done');
    stopPoll();
    toast.success(
      done?.fully_signed
        ? 'Contrato firmado por empleador y empleado'
        : 'Firma registrada',
    );
  };

  const startPoll = (requestId) => {
    stopPoll();
    pollRef.current = setInterval(async () => {
      try {
        const st = await api.get(`/hr/employees/${employeeId}/contract/sign/status/${requestId}`);
        if (st?.contrato) setContrato(st.contrato);
        if (st?.completed || st?.party_signed) {
          onSignedOk({ fully_signed: st.fully_signed, contrato: st.contrato });
        }
      } catch (_) {
        /* retry */
      }
    }, 2500);
  };

  const beginSign = async () => {
    if (!ack) {
      toast.error('Confirme que revisó el contrato y desea firmarlo.');
      return;
    }
    if (!signerName.trim()) {
      toast.error('Indique el nombre del firmante.');
      return;
    }
    if (!docNumber.trim()) {
      toast.error('Indique el número de documento (DNIe / DNI).');
      return;
    }
    setBusy(true);
    setStep('preparing');
    try {
      const prep = await api.post(`/hr/employees/${employeeId}/contract/sign`, {
        party: signParty,
        document_number: docNumber.trim(),
        signer_name: signerName.trim(),
      });
      if (prep?.contrato) setContrato(prep.contrato);
      setSession(prep);
      setStep('nfc');
      if (prep?.request_id) startPoll(prep.request_id);
    } catch (err) {
      setStep('confirm');
      toast.error(err.message || 'No se pudo preparar la firma');
    } finally {
      setBusy(false);
    }
  };

  const completeWithMock = async () => {
    if (!session?.request_id || !session?.temporary_token) return;
    if (!session.mock_allowed && session.provider !== 'mock') {
      toast.error('MOCK no permitido en este despliegue.');
      return;
    }
    setBusy(true);
    try {
      const done = await api.post(`/hr/employees/${employeeId}/contract/sign/complete`, {
        request_id: session.request_id,
        temporary_token: session.temporary_token,
        ack_reviewed: true,
        document_number: docNumber.trim(),
        signer_name: signerName.trim(),
        use_mock: true,
      });
      onSignedOk(done);
    } catch (err) {
      if (err.message && /Espere la firma|AWAITING_MOBILE/i.test(err.message)) {
        toast('Espere la firma desde el teléfono…');
      } else {
        toast.error(err.message || 'No se pudo completar con MOCK');
      }
    } finally {
      setBusy(false);
    }
  };

  const copyText = async (value, label) => {
    try {
      await navigator.clipboard.writeText(String(value || ''));
      toast.success(`${label} copiado`);
    } catch {
      toast.error('No se pudo copiar');
    }
  };

  const displayText = applyEmploymentFooter(
    String(contrato?.texto_contrato || '').trim() || DEFAULT_EMPLOYMENT_CONTRACT_TEXT,
    contrato || {},
  );
  const pdfUrl = contrato?.pdf_firmado_url || contrato?.pdf_original_url;
  const webSignUrl = session?.mobile?.web_sign_url
    || (session?.temporary_token
      ? `${typeof window !== 'undefined' ? window.location.origin : ''}/firmar-contrato?token=${encodeURIComponent(session.temporary_token)}`
      : '');
  const qrTarget = webSignUrl || session?.mobile?.deep_link || session?.mobile?.session_url || '';

  return (
    <div className="sm:col-span-2 min-w-0 space-y-1.5">
      <span className="text-xs text-[var(--ui-muted)]">Contrato</span>
      <div className="rounded-xl border border-[color:var(--ui-border)] bg-[var(--ui-surface)] overflow-hidden">
        <button
          type="button"
          onClick={() => void toggleOpen()}
          className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-[var(--ui-surface-2)] transition-colors"
        >
          <div className="min-w-0">
            <div className="text-sm font-medium text-[var(--ui-body-text)] truncate">
              {contractType || 'planilla'} · contrato laboral
            </div>
            <div className="text-[11px] text-[var(--ui-muted)] mt-0.5">
              {statusLabel}
              {open ? '' : ' · toque para ver / firmar'}
            </div>
          </div>
          {open ? <MdExpandLess className="text-xl shrink-0" /> : <MdExpandMore className="text-xl shrink-0" />}
        </button>

        {open ? (
          <div className="border-t border-[color:var(--ui-border)] p-3 space-y-3">
            <label className="text-xs space-y-1 block min-w-0">
              <span className="text-[var(--ui-muted)]">Tipo (planilla, recibo, etc.)</span>
              <input
                type="text"
                value={contractType || ''}
                onChange={(e) => onContractTypeChange?.(e.target.value)}
                className="w-full min-w-0 h-9 px-2.5 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-sm"
                placeholder="planilla"
              />
            </label>

            {loading && !contrato ? (
              <p className="text-xs text-[var(--ui-muted)] py-6 text-center">Cargando contrato…</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  <span className="rounded-full px-2 py-0.5 bg-[var(--ui-surface-2)] border border-[color:var(--ui-border)]">
                    Empleador: <strong>{employerSigned ? 'Firmado' : 'Pendiente'}</strong>
                  </span>
                  <span className="rounded-full px-2 py-0.5 bg-[var(--ui-surface-2)] border border-[color:var(--ui-border)]">
                    Empleado: <strong>{employeeSigned ? 'Firmado' : 'Pendiente'}</strong>
                  </span>
                </div>

                {textLocked ? (
                  <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 inline-flex items-center gap-1">
                    <MdLock /> Texto bloqueado por firmas
                  </p>
                ) : null}

                <div className="rounded-lg border border-[color:var(--ui-border)] bg-[#fbf8f2] max-h-[min(40vh,280px)] overflow-y-auto">
                  {textLocked ? (
                    <pre className="whitespace-pre-wrap break-words px-3 py-2 text-xs leading-relaxed text-[#3d2a1c] m-0">
                      {displayText}
                    </pre>
                  ) : (
                    <textarea
                      className="w-full min-h-[12rem] resize-y bg-[#fbf8f2] text-[#3d2a1c] px-3 py-2 text-xs leading-relaxed border-0 focus:outline-none"
                      value={contrato?.texto_contrato ?? DEFAULT_EMPLOYMENT_CONTRACT_TEXT}
                      onChange={(e) => setContrato((p) => ({
                        ...(p || {}),
                        texto_contrato: e.target.value,
                      }))}
                    />
                  )}
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  {!textLocked ? (
                    <button
                      type="button"
                      className="btn-secondary text-xs w-full sm:w-auto"
                      disabled={saving}
                      onClick={() => void saveText()}
                    >
                      {saving ? 'Guardando…' : 'Guardar texto'}
                    </button>
                  ) : null}
                  {pdfUrl ? (
                    <a
                      className="btn-secondary text-xs w-full sm:w-auto inline-flex items-center justify-center gap-1"
                      href={resolveMediaUrl(pdfUrl)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <MdPictureAsPdf /> Ver PDF
                    </a>
                  ) : null}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    className="btn-primary text-xs py-2 inline-flex items-center justify-center gap-1 disabled:opacity-50"
                    disabled={fullySigned || employerSigned}
                    onClick={() => openSign('empleador')}
                  >
                    <MdDraw /> Firmar empleador
                  </button>
                  <button
                    type="button"
                    className="btn-primary text-xs py-2 inline-flex items-center justify-center gap-1 disabled:opacity-50"
                    disabled={fullySigned || !employerSigned || employeeSigned}
                    onClick={() => openSign('empleado')}
                  >
                    <MdDraw /> Firmar empleado
                  </button>
                </div>
                <p className="text-[11px] text-[var(--ui-muted)] leading-snug">
                  Orden: primero el empleador, luego el empleado. La firma se completa en el teléfono (DNIe / NFC), igual que el contrato del servicio.
                </p>
              </>
            )}
          </div>
        ) : null}
      </div>

      <Modal
        isOpen={signOpen}
        onClose={closeSign}
        title={signParty === 'empleador' ? 'Firma del empleador' : 'Firma del empleado'}
        size="md"
        variant="light"
      >
        {step === 'done' ? (
          <div className="space-y-4 text-sm">
            <p className="font-semibold text-emerald-700 flex items-center gap-2">
              <MdCheckCircle className="text-xl" /> Firma registrada
            </p>
            <p className="text-[var(--ui-muted)]">
              {signFullyDone || fullySigned
                ? 'Empleador y empleado ya firmaron; el contrato queda cerrado.'
                : 'Siguiente: firma del empleado en el dispositivo móvil.'}
            </p>
            <button type="button" className="btn-primary w-full" onClick={closeSign}>
              Cerrar
            </button>
          </div>
        ) : step === 'preparing' ? (
          <p className="text-center text-[var(--ui-muted)] py-8 text-sm">Preparando PDF y hash…</p>
        ) : step === 'nfc' ? (
          <div className="space-y-4 text-sm">
            <div className="rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] p-4 text-center space-y-2">
              <MdNfc className="text-4xl mx-auto text-[var(--ui-accent)]" />
              <p className="font-semibold">Acerque el DNIe al teléfono</p>
              <p className="text-xs text-[var(--ui-muted)]">
                El PIN solo se ingresa en el dispositivo. Nunca llega al servidor.
              </p>
            </div>
            {qrTarget ? (
              <div className="flex flex-col items-center gap-2">
                <img
                  src={qrImageUrl(qrTarget)}
                  alt="QR firma"
                  width={160}
                  height={160}
                  className="rounded border border-[color:var(--ui-border)] bg-white p-1"
                />
                <p className="text-[11px] text-[var(--ui-muted)] text-center">
                  Escanee con el móvil para abrir la página de firma.
                </p>
                {webSignUrl ? (
                  <a href={webSignUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--ui-accent)] hover:underline">
                    Abrir página de firma
                  </a>
                ) : null}
                {session?.mobile?.deep_link ? (
                  <button
                    type="button"
                    className="text-xs inline-flex items-center gap-1 text-[var(--ui-muted)]"
                    onClick={() => void copyText(session.mobile.deep_link, 'Enlace')}
                  >
                    <MdContentCopy /> Copiar deep link
                  </button>
                ) : null}
              </div>
            ) : null}
            <p className="text-center text-xs text-[var(--ui-muted)] animate-pulse">
              Esperando firma desde el teléfono…
            </p>
            {(session?.mock_allowed || session?.provider === 'mock') ? (
              <button
                type="button"
                className="btn-secondary w-full disabled:opacity-50"
                disabled={busy}
                onClick={() => void completeWithMock()}
              >
                Continuar con firma de prueba (MOCK)
              </button>
            ) : null}
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="rounded-lg bg-[var(--ui-surface-2)] border border-[color:var(--ui-border)] p-3 space-y-3">
              <label className="block">
                <span className="text-xs font-medium text-[var(--ui-muted)]">Nombre</span>
                <input
                  className="w-full mt-1 h-9 px-2.5 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-sm"
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                  disabled={busy}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-[var(--ui-muted)]">N° documento (DNIe / DNI)</span>
                <input
                  className="w-full mt-1 h-9 px-2.5 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-sm"
                  value={docNumber}
                  onChange={(e) => setDocNumber(e.target.value)}
                  inputMode="numeric"
                  disabled={busy}
                />
              </label>
              <p>
                <span className="text-[var(--ui-muted)]">Parte:</span>{' '}
                {signParty === 'empleador' ? 'Empleador' : 'Empleado'}
              </p>
              <p>
                <span className="text-[var(--ui-muted)]">Fecha:</span> {signLocalDate}
              </p>
            </div>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" className="mt-1" checked={ack} onChange={(e) => setAck(e.target.checked)} disabled={busy} />
              <span>He revisado el contrato y deseo firmarlo digitalmente.</span>
            </label>
            <button
              type="button"
              className="btn-primary w-full disabled:opacity-50"
              disabled={busy || !ack}
              onClick={() => void beginSign()}
            >
              Continuar con firma
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}
