import { useState, useRef, useEffect } from 'react';
import { MdRestore, MdDraw, MdCheckCircle, MdLock, MdPictureAsPdf } from 'react-icons/md';
import { api, resolveMediaUrl } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { DEFAULT_SERVICE_CONTRACT_TEXT } from '../data/defaultServiceContract';
import { normalizeContratoFromApi } from '../utils/contratoNormalize';
import { applySignaturesIntoContractText, CONTRACT_PROVIDER } from '../utils/contractSignatureDisplay';
import Modal from './Modal';
import ContractPhoneSignWizard from './contract/ContractPhoneSignWizard';
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

/**
 * Contrato: ver + firmar en el mismo teléfono (nombre/DNI → NFC → PIN).
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
    } catch (err) {
      setStep('confirm');
      toast.error(err.message || 'No se pudo preparar la firma');
    } finally {
      setBusy(false);
    }
  };

  const pdfUrl = merged.pdf_firmado_url || merged.pdf_original_url;

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
        ) : step === 'nfc' && session ? (
          <ContractPhoneSignWizard
            session={session}
            signerName={signerName.trim()}
            documentNumber={docNumber.trim()}
            completePath="/contrato/sign/complete"
            apiPost={(path, body) => api.post(path, body)}
            onBusyChange={setBusy}
            onSigned={(done) => onSignedOk(done)}
            onError={(err) => {
              toast.error(err?.message || 'No se pudo firmar');
              if (err?.code === 'NFC_UNAVAILABLE' || err?.code === 'NFC_TIMEOUT' || err?.code === 'NFC_PERMISSION') {
                setStep('confirm');
              }
            }}
          />
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
              Firmar
            </button>
            <p className="text-[11px] ui-text-muted">
              Siguiente: acercar el DNI al NFC e ingresar el PIN en este teléfono.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
