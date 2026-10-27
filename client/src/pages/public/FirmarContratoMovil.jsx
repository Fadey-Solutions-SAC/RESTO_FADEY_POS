import { useEffect, useMemo, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MdCheckCircle, MdPictureAsPdf } from 'react-icons/md';
import { getApiBase, resolveMediaUrl } from '../../utils/api';
import ContractPhoneSignWizard from '../../components/contract/ContractPhoneSignWizard';
import toast from 'react-hot-toast';

async function fetchJson(path, options = {}) {
  const res = await fetch(`${getApiBase()}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new Error(data?.error || text || `Error HTTP ${res.status}`);
  }
  return data;
}

/**
 * Firma en el teléfono: datos → NFC → PIN → listo (sin QR ni app aparte).
 */
export default function FirmarContratoMovil() {
  const [params] = useSearchParams();
  const token = String(params.get('token') || '').trim();
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [step, setStep] = useState('confirm'); // confirm | nfc | done
  const [ack, setAck] = useState(false);
  const [docNumber, setDocNumber] = useState('');
  const [signerName, setSignerName] = useState('');

  const load = useCallback(async () => {
    if (!token) {
      setError('Falta el token de firma en la URL.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await fetchJson(`/contrato/sign/mobile/${encodeURIComponent(token)}`);
      setSession(data);
      if (data.status === 'completed') {
        setDone(true);
        setStep('done');
      }
      if (data.signer_name) setSignerName(String(data.signer_name));
    } catch (err) {
      setError(err.message || 'No se pudo cargar la sesión');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const pdfHref = useMemo(() => {
    if (!session) return '';
    const u = session.pdf_url || session.pdf_path || '';
    return u ? resolveMediaUrl(u) : '';
  }, [session]);

  const startNfc = () => {
    if (!ack) {
      toast.error('Confirme que revisó el contrato.');
      return;
    }
    if (!signerName.trim()) {
      toast.error('Indique el nombre.');
      return;
    }
    if (!docNumber.trim()) {
      toast.error('Indique el número de DNI.');
      return;
    }
    setStep('nfc');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f3efe6] text-[#3d2a1c]">
        <p className="text-sm">Cargando sesión de firma…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f3efe6] text-[#3d2a1c] px-4 py-8">
      <div className="max-w-md mx-auto space-y-5">
        <header className="text-center space-y-1">
          <p className="text-xs uppercase tracking-[0.2em] text-[#8a6a4a]">RESTO FADEY</p>
          <h1 className="text-2xl font-serif font-semibold">Firma digital</h1>
          <p className="text-sm text-[#6b5340]">En este teléfono: DNI + NFC + PIN</p>
        </header>

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{error}</div>
        ) : null}

        {done || session?.status === 'completed' || step === 'done' ? (
          <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-6 text-center space-y-2">
            <MdCheckCircle className="text-4xl mx-auto text-emerald-600" />
            <p className="font-semibold">Firma registrada</p>
            <p className="text-sm text-emerald-900/80">Ya puede volver al contrato.</p>
          </div>
        ) : session ? (
          <>
            {pdfHref ? (
              <a
                href={pdfHref}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 rounded-xl bg-white border border-[#e0d4c4] py-3 text-sm font-medium"
              >
                <MdPictureAsPdf /> Ver PDF del contrato
              </a>
            ) : null}

            {step === 'nfc' ? (
              <div className="rounded-xl bg-white/90 border border-[#e0d4c4] p-4">
                <ContractPhoneSignWizard
                  session={{
                    ...session,
                    temporary_token: token,
                    // Completar siempre por token móvil (página pública sin login).
                    mock_allowed: false,
                    provider: 'real',
                  }}
                  signerName={signerName.trim()}
                  documentNumber={docNumber.trim()}
                  completePath="/contrato/sign/complete"
                  apiPost={(path, body) => fetchJson(path, { method: 'POST', body: JSON.stringify(body) })}
                  onBusyChange={setBusy}
                  onSigned={() => {
                    setDone(true);
                    setStep('done');
                    toast.success('Firma registrada');
                  }}
                  onError={(err) => {
                    toast.error(err?.message || 'No se pudo firmar');
                    if (err?.code === 'NFC_UNAVAILABLE' || err?.code === 'NFC_TIMEOUT') {
                      setStep('confirm');
                    }
                  }}
                />
              </div>
            ) : (
              <div className="rounded-xl bg-white/90 border border-[#e0d4c4] p-4 space-y-3 text-sm">
                <label className="block">
                  <span className="text-xs text-[#8a6a4a]">Nombre</span>
                  <input
                    className="mt-1 w-full rounded-lg border border-[#e0d4c4] bg-[#fbf8f2] px-3 py-2"
                    value={signerName}
                    onChange={(e) => setSignerName(e.target.value)}
                    disabled={busy}
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-[#8a6a4a]">N° DNI / DNIe</span>
                  <input
                    className="mt-1 w-full rounded-lg border border-[#e0d4c4] bg-[#fbf8f2] px-3 py-2"
                    value={docNumber}
                    onChange={(e) => setDocNumber(e.target.value)}
                    inputMode="numeric"
                    disabled={busy}
                  />
                </label>
                <p className="text-xs text-[#6b5340]">Parte: {session.party || '—'}</p>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" className="mt-1" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                  <span>He revisado el contrato y deseo firmarlo.</span>
                </label>
                <button
                  type="button"
                  disabled={busy || !ack}
                  onClick={startNfc}
                  className="w-full rounded-xl bg-[#3d2a1c] text-[#f3efe6] py-3 text-sm font-semibold disabled:opacity-40"
                >
                  Firmar
                </button>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
