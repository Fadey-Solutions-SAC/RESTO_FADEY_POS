import { useEffect, useRef, useState, useCallback } from 'react';
import { MdCameraswitch, MdClose } from 'react-icons/md';

/**
 * Escáner QR con BarcodeDetector (Chromium / Electron / Android Chrome).
 * Fallback: pegar o escribir el payload RFHR:… (útil en demos / navegadores sin detector).
 */
export default function HrQrScanner({ onScan, paused = false }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(0);
  const lastRef = useRef('');
  const [error, setError] = useState('');
  const [manual, setManual] = useState('');
  const [supported, setSupported] = useState(true);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const emit = useCallback((raw) => {
    const value = String(raw || '').trim();
    if (!value) return;
    if (value === lastRef.current) return;
    lastRef.current = value;
    onScan?.(value);
    setTimeout(() => {
      if (lastRef.current === value) lastRef.current = '';
    }, 2500);
  }, [onScan]);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      setError('');
      if (paused) return;
      if (!navigator.mediaDevices?.getUserMedia) {
        setSupported(false);
        setError('Este dispositivo no permite usar la cámara.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' } },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        const Detector = window.BarcodeDetector;
        if (!Detector) {
          setSupported(false);
          setError('Escaneo por cámara no disponible en este navegador. Use Chrome o pegue el código abajo.');
          return;
        }
        const detector = new Detector({ formats: ['qr_code'] });
        const tick = async () => {
          if (cancelled || paused) return;
          try {
            const video = videoRef.current;
            if (video && video.readyState >= 2) {
              const codes = await detector.detect(video);
              if (codes?.[0]?.rawValue) emit(codes[0].rawValue);
            }
          } catch (_) {
            /* frame skip */
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch (err) {
        setSupported(false);
        setError(err?.message || 'No se pudo abrir la cámara');
      }
    }
    start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [paused, emit, stop]);

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-2xl border border-[color:var(--ui-border)] bg-black aspect-[4/3] max-h-[420px]">
        <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="w-[70%] max-w-xs aspect-square rounded-2xl border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        </div>
        {error ? (
          <div className="absolute inset-x-0 bottom-0 bg-black/70 text-white text-xs p-3 flex items-start gap-2">
            <MdCameraswitch className="text-lg shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        ) : null}
      </div>
      {!supported ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            emit(manual);
            setManual('');
          }}
        >
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="RFHR:… o token del QR"
            className="flex-1 h-10 px-3 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-sm"
          />
          <button type="submit" className="btn-primary text-sm px-4">Marcar</button>
          {manual ? (
            <button type="button" className="btn-secondary px-2" onClick={() => setManual('')} aria-label="Limpiar">
              <MdClose />
            </button>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
