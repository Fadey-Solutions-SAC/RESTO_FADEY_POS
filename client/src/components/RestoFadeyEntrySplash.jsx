import { useEffect, useRef, useState, useCallback } from 'react';
import {
  markEntrySplashStarted,
  markEntrySplashDone,
  isEntrySplashDone,
} from '../utils/entrySplashSession';

const LOGO_SRC = `/branding/resto-fadey-splash-logo.png?v=fy2026`;
const SPLASH_BG = '#000000';
/** Entrada + visible: ~2,6 s; salida: ~0,45 s. */
const SPLASH_HOLD_MS = 2600;
const SPLASH_EXIT_MS = 450;

/** Evita reiniciar animación si React remonta el componente (StrictMode). */
let splashAnimationStarted = false;

/**
 * Pantalla splash al abrir / recargar. Logo FY + crédito abajo a la izquierda.
 */
export default function RestoFadeyEntrySplash({ onComplete }) {
  const [phase, setPhase] = useState('in');
  const completedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const finishSplash = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    markEntrySplashDone();
    onCompleteRef.current?.();
  }, []);

  useEffect(() => {
    if (isEntrySplashDone()) {
      finishSplash();
      return undefined;
    }

    /* StrictMode remonta: reiniciar hold sin saltar la animación. */
    if (!splashAnimationStarted) {
      splashAnimationStarted = true;
      markEntrySplashStarted();
    }
    setPhase('in');

    const holdTimer = setTimeout(() => setPhase('out'), SPLASH_HOLD_MS);
    return () => clearTimeout(holdTimer);
  }, [finishSplash]);

  useEffect(() => {
    if (phase !== 'out') return undefined;
    const exitTimer = setTimeout(finishSplash, SPLASH_EXIT_MS);
    return () => clearTimeout(exitTimer);
  }, [phase, finishSplash]);

  if (completedRef.current) {
    return null;
  }

  return (
    <div
      className={`rf-entry-splash${phase === 'out' ? ' rf-entry-splash--out' : ''}`}
      style={{ backgroundColor: SPLASH_BG }}
      role="presentation"
      aria-hidden="true"
    >
      <div className="rf-entry-splash__stage">
        <div className={`rf-entry-splash__stack${phase === 'out' ? ' rf-entry-splash__stack--out' : ''}`}>
          <div className="rf-entry-splash__logo-wrap">
            <div className="rf-entry-splash__glow" aria-hidden />
            <div className="rf-entry-splash__logo-ring">
              <img
                src={LOGO_SRC}
                alt=""
                className="rf-entry-splash__logo-img"
                width={512}
                height={512}
                decoding="async"
                fetchPriority="high"
              />
              <span className="rf-entry-splash__shine" aria-hidden />
            </div>
          </div>
          <div className="rf-entry-splash__brand">
            <p className="rf-entry-splash__title">
              <span className="rf-entry-splash__title-rest">RESTO </span>
              <span className="rf-entry-splash__title-fadey">FADEY</span>
            </p>
            <p className="rf-entry-splash__tagline">Tecnología Que Potencia Tu Negocio</p>
          </div>
        </div>
      </div>
      <p className="rf-entry-splash__credit">Fadey Solutions SAC</p>
    </div>
  );
}
