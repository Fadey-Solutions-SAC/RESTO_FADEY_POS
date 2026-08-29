import { useEffect, useMemo, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MdNfc, MdCheckCircle, MdPictureAsPdf, MdPhoneAndroid } from 'react-icons/md';
import { getApiBase, resolveMediaUrl } from '../../utils/api';
import { hasNativeDnieBridge, requestNativeDnieSign } from '../../utils/dnieSignerBridge';
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
 * Página pública abierta desde el QR / deep link.
 * Flujo: ver sesión → NFC nativo (bridge) o MOCK de desarrollo → POST firma.
 */
export default function FirmarContratoMovil() {
  const [params] = useSearchParams();
  const token = String(params.get('token') || '').trim();
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [nativeReady, setNativeReady] = useState(false);
  const [step, setStep] = useState('idle'); // idle | nfc | sending | done

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
      if (data.status === 'completed') setDone(true);
    } catch (err) {
      setError(err.message || 'No se pudo cargar la sesión');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const check = () => setNativeReady(hasNativeDnieBridge());
    check();
    const t = setInterval(check, 1000);
    window.RestoFadeyDniePage = {
      onNativeReady: check,
      getToken: () => token,
      getSession: () => session,
    };
    return () => {
      clearInterval(t);
      try {
        delete window.RestoFadeyDniePage;
      } catch (_) {
        /* noop */
      }
    };
  }, [token, session]);

  const pdfHref = useMemo(() => {
    if (!session) return '';
    const u = session.pdf_url || session.pdf_path || '';
    return u ? resolveMediaUrl(u) : '';
  }, [session]);

  const submitPayload = async (payload) => {
    setStep('sending');
    const result = await fetchJson(`/contrato/sign/mobile/${encodeURIComponent(token)}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setDone(true);
    setStep('done');
    setSession((prev) => ({ ...prev, status: 'completed' }));
    toast.success(result.fully_signed ? 'Contrato firmado por ambas partes' : 'Firma registrada');
    return result;
  };

  const runNativeSign = async () => {
    if (!session || session.status !== 'pending') return;
    setBusy(true);
    setStep('nfc');
    try {
      const deviceResult = await requestNativeDnieSign(session);
      await submitPayload({
        ...deviceResult,
        document_hash: deviceResult.document_hash || session.document_hash,
        method: deviceResult.method || 'dnie_nfc',
      });
    } catch (err) {
      setStep('idle');
      toast.error(err.message || 'No se pudo firmar con DNIe');
    } finally {
      setBusy(false);
    }
  };

  const runDevMock = async () => {
    if (!session?.mock_allowed) {
      toast.error('MOCK no permitido en este servidor');
      return;
    }
    setBusy(true);
    try {
      await submitPayload({
        mock: true,
        method: 'mock_dnie_mobile',
        signature_value: `MOCK_MOBILE_${session.document_hash.slice(0, 24)}_${Date.now().toString(36)}`,
        signature_algorithm: 'MOCK-SHA256-RSA',
        certificate_serial: `MOCK-MOB-${Date.now().toString(36)}`,
        certificate_subject: `CN=${session.signer_name || 'Firmante'}, SERIALNUMBER=00000000`,
        certificate_issuer: 'CN=MOCK DNIe CA',
        document_number: '',
        document_hash: session.document_hash,
        validation_status: 'VALID',
      });
    } catch (err) {
      toast.error(err.message || 'Error MOCK');
    } finally {
      setBusy(false);
    }
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
          <h1 className="text-2xl font-serif font-semibold">Firma digital del contrato</h1>
          <p className="text-sm text-[#6b5340]">DNIe + NFC · el PIN solo en este teléfono</p>
        </header>

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{error}</div>
        ) : null}

        {done || session?.status === 'completed' ? (
          <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-6 text-center space-y-2">
            <MdCheckCircle className="text-4xl mx-auto text-emerald-600" />
            <p className="font-semibold">Firma registrada</p>
            <p className="text-sm text-emerald-900/80">Ya puede volver a la pantalla del contrato en el computador.</p>
          </div>
        ) : session ? (
          <>
            <div className="rounded-xl bg-white/80 border border-[#e0d4c4] p-4 space-y-2 text-sm">
              <p><span className="text-[#8a6a4a]">Firmante:</span> {session.signer_name || '—'}</p>
              <p><span className="text-[#8a6a4a]">Parte:</span> {session.party}</p>
              <p><span className="text-[#8a6a4a]">Versión:</span> {session.contract_version}</p>
              <p className="font-mono text-[10px] break-all text-[#6b5340]">Hash: {session.document_hash}</p>
            </div>

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

            <div className="rounded-xl border border-[#d4b896] bg-[#fff8ef] p-5 text-center space-y-3">
              <MdNfc className={`text-5xl mx-auto text-[#b07a3a] ${step === 'nfc' ? 'animate-pulse' : ''}`} />
              <p className="font-semibold">
                {step === 'nfc' ? 'Acerque el DNIe e ingrese el PIN…' : 'Acerque su DNI electrónico'}
              </p>
              <p className="text-xs text-[#6b5340]">
                Use la app Android RESTO FADEY Firma. El PIN no se envía al servidor.
              </p>
              <div className="flex items-center justify-center gap-2 text-xs text-[#8a6a4a]">
                <MdPhoneAndroid />
                {nativeReady ? 'App nativa detectada' : 'Abra esta página dentro de la app Android'}
              </div>
              <button
                type="button"
                disabled={busy || !nativeReady}
                onClick={() => void runNativeSign()}
                className="w-full rounded-xl bg-[#3d2a1c] text-[#f3efe6] py-3 text-sm font-semibold disabled:opacity-40"
              >
                {busy ? 'Procesando…' : 'Firmar con DNIe (NFC)'}
              </button>
            </div>

            {session.mock_allowed ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void runDevMock()}
                className="w-full rounded-xl border border-dashed border-[#c4a882] py-2.5 text-xs text-[#6b5340]"
              >
                Firma de prueba (MOCK móvil) — solo desarrollo
              </button>
            ) : null}

            <p className="text-[10px] text-center text-[#8a6a4a] leading-relaxed">
              APDU y verificación criptográfica del DNIe peruano: REQUIERE VALIDACIÓN TÉCNICA.
              Esta fase conecta el canal móvil; no inventa comandos NFC.
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
