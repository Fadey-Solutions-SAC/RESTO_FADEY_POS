import { useEffect, useRef, useState, useCallback } from 'react';
import jsQR from 'jsqr';
import { MdCameraswitch, MdClose } from 'react-icons/md';

/**
 * Escáner QR para kiosco de asistencia (PC / Electron / móvil).
 * - Cámara + BarcodeDetector (si existe) + jsQR en canvas (mejor para QR en pantalla de celular).
 * - Preferencia a cámara frontal en escritorio; se puede cambiar de cámara.
 * - Entrada manual siempre disponible como respaldo.
 */
export default function HrQrScanner({ onScan, paused = false }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(0);
  const lastRef = useRef('');
  const [error, setError] = useState('');
  const [manual, setManual] = useState('');
  const [cameraLabel, setCameraLabel] = useState('');
  const [starting, setStarting] = useState(true);
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState('');

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

  const decodeFromVideo = useCallback((video) => {
    if (!video || video.readyState < 2 || !video.videoWidth) return '';
    const canvas = canvasRef.current;
    if (!canvas) return '';
    const maxW = 720;
    const scale = Math.min(1, maxW / Math.max(1, video.videoWidth));
    const w = Math.max(1, Math.floor(video.videoWidth * scale));
    const h = Math.max(1, Math.floor(video.videoHeight * scale));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return '';
    ctx.drawImage(video, 0, 0, w, h);

    const tryDecode = (data) => {
      const code = jsQR(data.data, data.width, data.height, { inversionAttempts: 'attemptBoth' });
      return code?.data ? String(code.data).trim() : '';
    };

    let imageData;
    try {
      imageData = ctx.getImageData(0, 0, w, h);
    } catch {
      return '';
    }
    const full = tryDecode(imageData);
    if (full) return full;

    const crop = Math.floor(Math.min(w, h) * 0.72);
    const sx = Math.floor((w - crop) / 2);
    const sy = Math.floor((h - crop) / 2);
    try {
      return tryDecode(ctx.getImageData(sx, sy, crop, crop));
    } catch {
      return '';
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      setStarting(true);
      setError('');
      stop();
      if (paused) {
        setStarting(false);
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Este equipo no permite usar la cámara. Use la entrada manual abajo.');
        setStarting(false);
        return;
      }

      const constraints = {
        audio: false,
        video: deviceId
          ? {
              deviceId: { exact: deviceId },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            }
          : {
              facingMode: { ideal: 'user' },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
      };

      try {
        let stream;
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
        }
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        try {
          const all = await navigator.mediaDevices.enumerateDevices();
          const cams = (all || []).filter((d) => d.kind === 'videoinput');
          setDevices(cams);
          const track = stream.getVideoTracks()[0];
          const settingsId = track?.getSettings?.()?.deviceId || '';
          const match = cams.find((c) => c.deviceId === settingsId);
          setCameraLabel(match?.label || track?.label || 'Cámara');
          if (settingsId && !deviceId) setDeviceId(settingsId);
        } catch {
          setCameraLabel(stream.getVideoTracks()[0]?.label || 'Cámara');
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute('playsinline', 'true');
          await videoRef.current.play().catch(() => {});
        }

        let detector = null;
        if (typeof window !== 'undefined' && window.BarcodeDetector) {
          try {
            detector = new window.BarcodeDetector({ formats: ['qr_code'] });
          } catch {
            detector = null;
          }
        }

        setStarting(false);
        let lastTick = 0;
        const tick = async (ts) => {
          if (cancelled || paused) return;
          if (ts - lastTick < 100) {
            rafRef.current = requestAnimationFrame(tick);
            return;
          }
          lastTick = ts;
          try {
            const video = videoRef.current;
            if (detector && video && video.readyState >= 2) {
              try {
                const codes = await detector.detect(video);
                if (codes?.[0]?.rawValue) {
                  emit(codes[0].rawValue);
                  rafRef.current = requestAnimationFrame(tick);
                  return;
                }
              } catch (_) {
                /* jsQR */
              }
            }
            const fromJs = decodeFromVideo(video);
            if (fromJs) emit(fromJs);
          } catch (_) {
            /* frame skip */
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch (err) {
        if (!cancelled) {
          setError(
            err?.name === 'NotAllowedError'
              ? 'Permiso de cámara denegado. Habilítela en el navegador o use la entrada manual.'
              : (err?.message || 'No se pudo abrir la cámara. Use la entrada manual abajo.'),
          );
          setStarting(false);
        }
      }
    }

    start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [paused, deviceId, emit, stop, decodeFromVideo]);

  const switchCamera = () => {
    if (devices.length < 2) {
      setError('Solo hay una cámara disponible en este equipo.');
      return;
    }
    const idx = Math.max(0, devices.findIndex((d) => d.deviceId === deviceId));
    const next = devices[(idx + 1) % devices.length];
    if (next?.deviceId) setDeviceId(next.deviceId);
  };

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-2xl border border-[color:var(--ui-border)] bg-black aspect-[4/3] max-h-[420px]">
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          playsInline
          muted
          autoPlay
        />
        <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="w-[70%] max-w-xs aspect-square rounded-2xl border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        </div>
        <div className="absolute top-2 left-2 right-2 flex items-start justify-between gap-2">
          <span className="text-[10px] sm:text-xs px-2 py-1 rounded-md bg-black/60 text-white/90 truncate max-w-[70%]">
            {starting ? 'Abriendo cámara…' : (cameraLabel || 'Cámara')}
          </span>
          {devices.length > 1 ? (
            <button
              type="button"
              onClick={switchCamera}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-black/60 text-white hover:bg-black/80"
              title="Cambiar cámara"
            >
              <MdCameraswitch className="text-base" />
              Cambiar
            </button>
          ) : null}
        </div>
        {error ? (
          <div className="absolute inset-x-0 bottom-0 bg-black/75 text-white text-xs p-3 flex items-start gap-2">
            <MdCameraswitch className="text-lg shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        ) : (
          <div className="absolute inset-x-0 bottom-0 bg-black/55 text-white text-[11px] sm:text-xs p-2.5 text-center">
            Acerca el QR del celular a la cámara (brillo alto, sin reflejos). Mantén el código dentro del cuadro.
          </div>
        )}
      </div>

      <form
        className="flex flex-col sm:flex-row gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          emit(manual);
          setManual('');
        }}
      >
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="Pegar token (RFHR:…)"
          className="flex-1 h-10 px-3 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-sm"
        />
        <div className="flex gap-2">
          <button type="submit" className="btn-primary text-sm px-4 flex-1 sm:flex-none">Marcar</button>
          {manual ? (
            <button type="button" className="btn-secondary px-2" onClick={() => setManual('')} aria-label="Limpiar">
              <MdClose />
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
