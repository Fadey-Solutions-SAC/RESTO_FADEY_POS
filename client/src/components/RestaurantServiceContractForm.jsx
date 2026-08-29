import { useState, useRef, useEffect } from 'react';
import { MdNfc, MdRestore, MdDraw, MdCheckCircle, MdLock, MdPictureAsPdf, MdContentCopy } from 'react-icons/md';
import { api, resolveMediaUrl } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { DEFAULT_SERVICE_CONTRACT_TEXT } from '../data/defaultServiceContract';
import { normalizeContratoFromApi } from '../utils/contratoNormalize';
import { applySignaturesIntoContractText, CONTRACT_PROVIDER } from '../utils/contractSignatureDisplay';
import Modal from './Modal';
import toast from 'react-hot-toast';

function partyLabel(party) {
  if (party === 'vendedor') return 'Proveedor';
  return 'Cliente';
}

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

function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-PE');
  } catch {
    return String(iso);
  }
}

function qrImageUrl(data) {
  const q = encodeURIComponent(String(data || ''));
  return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${q}`;
}

/**
 * Contrato: ver + firmar (PDF + canal NFC).
 * Admin del negocio: solo ver y firmar una vez (comprador). Luego solo ver.
 * Maestro: editar texto (si no hay firmas) y firmar como vendedor.
 */
export default function RestaurantServiceContractForm({
  contrato,
  canEdit,
  onChange,
  cardClassName = 'rf-contrato-panel rounded-xl shadow-sm border border-[color:var(--ui-border)] bg-[var(--ui-surface)] flex flex-col min-h-0 h-[calc(100dvh-6.5rem)] max-h-[calc(100dvh-6.5rem)] overflow-hidden p-3 sm:p-4 gap-2',
}) {
  const { user } = useAuth();
  const isMaster = user?.role === 'master_admin';
  const isBusinessAdmin = user?.role === 'admin';
  const merged = normalizeContratoFromApi(contrato);
  const text = String(merged.texto_contrato || '').trim()
    ? String(merged.texto_contrato)
    : DEFAULT_SERVICE_CONTRACT_TEXT;

  const textLocked = Boolean(
    merged.text_locked
    || merged.estado_firma === 'firmado'
    || merged.estado_firma === 'firmando'
    || merged.firma_comprador?.status === 'firmado'
    || merged.firma_vendedor?.status === 'firmado',
  );
  const fullySigned = merged.estado_firma === 'firmado'
    || (merged.firma_comprador?.status === 'firmado' && merged.firma_vendedor?.status === 'firmado');

  // Defensa: el admin del negocio nunca edita texto, aunque el padre pase canEdit.
  const effectiveCanEdit = Boolean(canEdit && isMaster && !textLocked);

  const myParty = isMaster ? 'vendedor' : (isBusinessAdmin ? 'comprador' : '');
  const mySlot = myParty === 'vendedor' ? merged.firma_vendedor : merged.firma_comprador;
  const iAlreadySigned = mySlot?.status === 'firmado';
  // Una sola firma por parte: tras firmar, solo puede ver.
  const canSignMine = Boolean(myParty) && !iAlreadySigned && !fullySigned;

  const [signOpen, setSignOpen] = useState(false);
  const [ack, setAck] = useState(false);
  const [docNumber, setDocNumber] = useState('');
  const [signerName, setSignerName] = useState('');
  const [signLocalDate, setSignLocalDate] = useState(() => formatLocalDate());
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('confirm'); // confirm | preparing | nfc | done
  const [signFullyDone, setSignFullyDone] = useState(false);
  const [session, setSession] = useState(null);
  const pollRef = useRef(null);

  const patch = (partial) => {
    const next = { ...merged, ...partial };
    if (!effectiveCanEdit) {
      next.texto_contrato = merged.texto_contrato;
    }
    onChange(next);
  };

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => () => stopPoll(), []);

  const restoreDefaultText = () => {
    if (!effectiveCanEdit) return;
    if (!window.confirm('¿Restaurar el texto base del contrato desde el código?')) return;
    patch({ texto_contrato: DEFAULT_SERVICE_CONTRACT_TEXT });
    toast.success('Texto base restaurado. Pulse Guardar cambios para guardarlo.');
  };

  const openSign = () => {
    if (!canSignMine) {
      toast.error(iAlreadySigned
        ? 'Ya firmó este contrato. Solo puede consultarlo.'
        : 'No puede firmar en este momento.');
      return;
    }
    stopPoll();
    setAck(false);
    if (isBusinessAdmin) {
      setDocNumber('');
      setSignerName('');
    } else {
      setDocNumber(CONTRACT_PROVIDER.documento);
      setSignerName(CONTRACT_PROVIDER.gerente);
    }
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
    if (done?.contrato) onChange(normalizeContratoFromApi(done.contrato));
    setSignFullyDone(Boolean(done?.fully_signed));
    setStep('done');
    stopPoll();
    toast.success(
      done?.fully_signed
        ? 'Contrato firmado por ambas partes'
        : 'Su firma quedó registrada en el contrato',
    );
  };

  const startPoll = (requestId) => {
    stopPoll();
    pollRef.current = setInterval(async () => {
      try {
        const st = await api.get(`/contrato/sign/status/${requestId}`);
        if (st?.contrato) onChange(normalizeContratoFromApi(st.contrato));
        if (st?.completed || st?.party_signed) {
          onSignedOk({
            fully_signed: st.fully_signed,
            contrato: st.contrato,
          });
        }
      } catch (_) {
        /* seguir intentando hasta expirar */
      }
    }, 2500);
  };

  const beginSign = async () => {
    if (!ack) {
      toast.error('Confirme que revisó el contrato y desea firmarlo.');
      return;
    }
    if (isBusinessAdmin && !signerName.trim()) {
      toast.error('Indique el nombre del firmante.');
      return;
    }
    if (isBusinessAdmin && !docNumber.trim()) {
      toast.error('Indique el número de documento (DNIe / DNI).');
      return;
    }
    setBusy(true);
    setStep('preparing');
    try {
      const prep = await api.post('/contrato/sign', {
        party: myParty,
        document_number: docNumber.trim(),
        signer_name: signerName.trim(),
      });
      if (prep?.contrato) onChange(normalizeContratoFromApi(prep.contrato));
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
      const done = await api.post('/contrato/sign/complete', {
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

  const pdfUrl = merged.pdf_firmado_url || merged.pdf_original_url;
  const deepLink = session?.mobile?.deep_link || '';
  const sessionUrl = session?.mobile?.session_url || '';
  const webSignUrl = session?.mobile?.web_sign_url
    || (session?.temporary_token
      ? `${typeof window !== 'undefined' ? window.location.origin : ''}/firmar-contrato?token=${encodeURIComponent(session.temporary_token)}`
      : '');
  const qrTarget = webSignUrl || deepLink || sessionUrl;

  const displayText = applySignaturesIntoContractText(text, merged);
  const showTechMeta = isMaster;

  return (
    <div className={cardClassName}>
      <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="min-w-0">
          <h3 className="font-bold text-[var(--ui-body-text)] text-base sm:text-lg leading-tight">
            Contrato digital del servicio
          </h3>
          {showTechMeta ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
              <span className="rounded-full px-2 py-0.5 bg-[var(--ui-surface-2)] border border-[color:var(--ui-border)]">
                Estado: <strong>{merged.estado_firma || 'borrador'}</strong>
              </span>
              <span className="rounded-full px-2 py-0.5 bg-[var(--ui-surface-2)] border border-[color:var(--ui-border)]">
                Versión: <strong>{merged.version || 1}</strong>
              </span>
              {merged.document_hash ? (
                <span className="rounded-full px-2 py-0.5 bg-[var(--ui-surface-2)] border border-[color:var(--ui-border)] font-mono truncate max-w-[14rem]" title={merged.document_hash}>
                  Hash: {merged.document_hash.slice(0, 12)}…
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          {pdfUrl ? (
            <a
              className="btn-secondary text-xs py-1.5 px-2 inline-flex items-center gap-1"
              href={resolveMediaUrl(pdfUrl)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <MdPictureAsPdf className="text-base" /> Ver PDF
            </a>
          ) : null}
          {effectiveCanEdit ? (
            <button
              type="button"
              className="btn-secondary text-xs py-1.5 px-2 inline-flex items-center gap-1"
              onClick={restoreDefaultText}
            >
              <MdRestore className="text-base" /> Restaurar texto base
            </button>
          ) : null}
          {canSignMine ? (
            <button
              type="button"
              className="btn-primary text-sm py-2 px-3 inline-flex items-center gap-1.5"
              onClick={openSign}
            >
              <MdDraw className="text-lg" /> Firmar digitalmente
            </button>
          ) : null}
        </div>
      </div>

      {showTechMeta && fullySigned ? (
        <div className="shrink-0 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 flex items-start gap-2">
          <MdCheckCircle className="text-lg shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Contrato firmado digitalmente</p>
            <p className="text-[10px] mt-0.5">Fecha: {formatDateTime(merged.firmado_en)}</p>
          </div>
        </div>
      ) : null}
      {showTechMeta && !fullySigned && textLocked ? (
        <div className="shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-950 inline-flex items-center gap-1.5">
          <MdLock /> Texto bloqueado: hay firma en curso o registrada.
        </div>
      ) : null}

      <div className="flex-1 min-h-0 rounded-xl border border-[color:var(--ui-border)] bg-[#fbf8f2] overflow-hidden flex flex-col">
        {effectiveCanEdit ? (
          <textarea
            className="contract-body-text flex-1 min-h-0 w-full h-full resize-none bg-[#fbf8f2] text-[#3d2a1c] px-4 py-3 text-sm leading-relaxed border-0 focus:outline-none focus:ring-0 overflow-y-auto"
            value={text}
            onChange={(e) => patch({ texto_contrato: e.target.value })}
            spellCheck
          />
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
            <pre className="contract-body-text whitespace-pre-wrap break-words px-4 py-3 text-sm leading-relaxed text-[#3d2a1c] m-0">
              {displayText}
            </pre>
          </div>
        )}
      </div>

      <Modal
        isOpen={signOpen}
        onClose={closeSign}
        title="Firma digital"
        size="md"
        variant="light"
      >
        {step === 'done' ? (
          <div className="space-y-4 text-sm">
            <p className="font-semibold text-emerald-700 flex items-center gap-2">
              <MdCheckCircle className="text-xl" /> Firma registrada
            </p>
            <p className="ui-text-muted">
              Quedó asociada a este contrato (versión {merged.version}).
              {signFullyDone || fullySigned
                ? ' Ambas partes ya firmaron; el contrato queda cerrado.'
                : ' Falta la firma de la otra parte.'}
            </p>
            <button type="button" className="btn-primary w-full" onClick={closeSign}>
              Cerrar
            </button>
          </div>
        ) : step === 'preparing' ? (
          <p className="text-center ui-text-muted py-8 text-sm">Preparando documento PDF y hash…</p>
        ) : step === 'nfc' ? (
          <div className="space-y-4 text-sm text-[var(--ui-body-text)]">
            <div className="rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] p-4 text-center space-y-2">
              <MdNfc className="text-4xl mx-auto text-[var(--ui-accent)]" />
              <p className="font-semibold">Acerca tu DNI electrónico a la parte posterior del teléfono</p>
              <p className="text-xs ui-text-muted">
                Ingresa el PIN solo en el dispositivo. El PIN nunca llega a Resto Fadey.
              </p>
            </div>

            {session?.document_hash ? (
              <p className="text-[11px] font-mono break-all ui-text-muted">
                Hash PDF: {session.document_hash}
              </p>
            ) : null}

            {session?.pdf_original_url ? (
              <a
                className="btn-secondary w-full inline-flex justify-center items-center gap-1 text-sm"
                href={resolveMediaUrl(session.pdf_original_url)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MdPictureAsPdf /> Abrir PDF definitivo
              </a>
            ) : null}

            {(qrTarget) ? (
              <div className="flex flex-col items-center gap-2">
                <img
                  src={qrImageUrl(qrTarget)}
                  alt="QR firma"
                  width={160}
                  height={160}
                  className="rounded border border-[color:var(--ui-border)] bg-white p-1"
                />
                <p className="text-[11px] ui-text-muted text-center">
                  Escanee con el teléfono para abrir la página de firma / app Android.
                </p>
                {webSignUrl ? (
                  <a
                    href={webSignUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[var(--ui-accent)] hover:underline"
                  >
                    Abrir página de firma
                  </a>
                ) : null}
                {deepLink ? (
                  <button
                    type="button"
                    className="text-xs inline-flex items-center gap-1 ui-text-muted hover:underline"
                    onClick={() => void copyText(deepLink, 'Enlace profundo')}
                  >
                    <MdContentCopy /> Copiar deep link
                  </button>
                ) : null}
                {sessionUrl ? (
                  <button
                    type="button"
                    className="text-xs inline-flex items-center gap-1 ui-text-muted hover:underline"
                    onClick={() => void copyText(sessionUrl, 'URL de sesión')}
                  >
                    <MdContentCopy /> Copiar URL API móvil
                  </button>
                ) : null}
              </div>
            ) : null}

            <p className="text-center text-xs ui-text-muted animate-pulse">
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
          <div className="space-y-4 text-sm text-[var(--ui-body-text)]">
            <div className="rounded-lg bg-[var(--ui-surface-2)] border border-[color:var(--ui-border)] p-3 space-y-3">
              {isBusinessAdmin ? (
                <>
                  <label className="block">
                    <span className="text-xs font-medium ui-text-muted">Nombre</span>
                    <input
                      className="input-field mt-1"
                      value={signerName}
                      onChange={(e) => setSignerName(e.target.value)}
                      placeholder=""
                      autoComplete="name"
                      disabled={busy}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium ui-text-muted">N° documento (DNIe / DNI)</span>
                    <input
                      className="input-field mt-1"
                      value={docNumber}
                      onChange={(e) => setDocNumber(e.target.value)}
                      placeholder=""
                      inputMode="numeric"
                      disabled={busy}
                    />
                  </label>
                  <p>
                    <span className="ui-text-muted">Parte:</span> Cliente
                  </p>
                  <p>
                    <span className="ui-text-muted">Fecha:</span> {signLocalDate}
                  </p>
                </>
              ) : (
                <>
                  <p>
                    <span className="ui-text-muted">Nombre:</span> {CONTRACT_PROVIDER.gerente}
                  </p>
                  <p>
                    <span className="ui-text-muted">N° documento (DNIe / DNI):</span>{' '}
                    {CONTRACT_PROVIDER.documento}
                  </p>
                  <p><span className="ui-text-muted">Parte:</span> {partyLabel(myParty)}</p>
                  <p><span className="ui-text-muted">Fecha:</span> {signLocalDate}</p>
                </>
              )}
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
            <p className="text-[11px] ui-text-muted">
              Se generará el PDF definitivo. Luego podrá firmar con NFC en el teléfono (PIN solo en el dispositivo).
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
