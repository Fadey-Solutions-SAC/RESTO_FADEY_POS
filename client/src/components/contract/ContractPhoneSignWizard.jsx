import { useEffect, useRef, useState } from 'react';
import { MdNfc, MdLock, MdCheckCircle } from 'react-icons/md';
import { waitForPhoneNfcTag, finishPhoneNfcSignature, assertLocalPin } from '../../utils/phoneNfcSign';

/**
 * Pasos en el mismo teléfono: NFC → PIN → listo.
 * Sin QR ni apps externas.
 */
export default function ContractPhoneSignWizard({
  session,
  signerName,
  documentNumber,
  completePath,
  apiPost,
  onSigned,
  onError,
  onBusyChange,
}) {
  const [phase, setPhase] = useState('nfc'); // nfc | pin | working
  const [pin, setPin] = useState('');
  const [hint, setHint] = useState('Acerque su DNI electrónico a la parte trasera del teléfono');
  const [listening, setListening] = useState(false);
  const [needTap, setNeedTap] = useState(false);
  const abortRef = useRef(null);

  const stopListen = () => {
    try {
      abortRef.current?.abort();
    } catch (_) {
      /* noop */
    }
    abortRef.current = null;
    setListening(false);
  };

  const startListen = async () => {
    stopListen();
    const ac = new AbortController();
    abortRef.current = ac;
    setNeedTap(false);
    setListening(true);
    setPhase('nfc');
    setHint('Acerque su DNI electrónico a la parte trasera del teléfono');
    onBusyChange?.(true);
    try {
      await waitForPhoneNfcTag({ timeoutMs: 90_000, signal: ac.signal });
      if (ac.signal.aborted) return;
      setListening(false);
      setPhase('pin');
      setHint('DNI detectado. Ingrese el PIN (solo en este teléfono).');
      onBusyChange?.(false);
    } catch (err) {
      setListening(false);
      onBusyChange?.(false);
      if (err?.code === 'ABORTED' || err?.name === 'AbortError') return;
      if (err?.code === 'NFC_PERMISSION' || /user gesture|activation|not allowed/i.test(String(err?.message || ''))) {
        setNeedTap(true);
        setHint('Toque el botón para activar el lector NFC');
        return;
      }
      onError?.(err);
    }
  };

  useEffect(() => {
    void startListen();
    return () => stopListen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.request_id, session?.temporary_token]);

  const submitPin = async () => {
    try {
      assertLocalPin(pin);
    } catch (err) {
      onError?.(err);
      return;
    }
    setPhase('working');
    onBusyChange?.(true);
    const localPin = pin;
    setPin('');
    try {
      const done = await finishPhoneNfcSignature({
        session,
        signerName,
        documentNumber,
        pin: localPin,
        completePath,
        apiPost,
      });
      onSigned?.(done);
    } catch (err) {
      setPhase('pin');
      onError?.(err);
    } finally {
      onBusyChange?.(false);
    }
  };

  if (phase === 'working') {
    return (
      <div className="space-y-3 text-center py-8 text-sm">
        <p className="animate-pulse ui-text-muted">Registrando firma…</p>
      </div>
    );
  }

  if (phase === 'pin') {
    return (
      <div className="space-y-4 text-sm text-[var(--ui-body-text)]">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-center space-y-2">
          <MdCheckCircle className="text-4xl mx-auto text-emerald-600" />
          <p className="font-semibold">DNI leído</p>
          <p className="text-xs text-emerald-900/80">{hint}</p>
        </div>
        <label className="block">
          <span className="text-xs font-medium ui-text-muted inline-flex items-center gap-1">
            <MdLock /> PIN del DNIe
          </span>
          <input
            className="input-field mt-1 tracking-[0.35em] text-center text-lg"
            type="password"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 12))}
            placeholder="••••"
            autoFocus
          />
        </label>
        <p className="text-[11px] ui-text-muted text-center">
          El PIN no se envía a Resto Fadey; solo se usa en este teléfono.
        </p>
        <button
          type="button"
          className="btn-primary w-full"
          disabled={pin.length < 4}
          onClick={() => void submitPin()}
        >
          Confirmar y firmar
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 text-sm text-[var(--ui-body-text)]">
      <div className="rounded-xl border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] p-6 text-center space-y-3">
        <MdNfc className={`text-6xl mx-auto text-[var(--ui-accent)] ${listening ? 'animate-pulse' : ''}`} />
        <p className="font-semibold text-base">{hint}</p>
        <p className="text-xs ui-text-muted">
          {listening
            ? 'Mantenga el documento quieto hasta que se lea el chip.'
            : 'El lector NFC se usa en esta misma pantalla.'}
        </p>
        {needTap || !listening ? (
          <button
            type="button"
            className="btn-primary w-full mt-2"
            onClick={() => void startListen()}
          >
            Activar lector NFC
          </button>
        ) : null}
      </div>
    </div>
  );
}
