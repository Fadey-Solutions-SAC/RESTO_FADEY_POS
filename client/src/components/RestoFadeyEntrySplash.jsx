import { useEffect, useRef, useState, useCallback } from 'react';
import {
  markEntrySplashStarted,
  markEntrySplashDone,
  isEntrySplashDone,
} from '../utils/entrySplashSession';
import EntrySplashCircuits from './EntrySplashCircuits';

/**
 * Logo de empresa FY (circular). NO regenerar/recortar salvo indicación explícita del usuario.
 * Archivo fuente protegido: branding/resto-fadey-splash-logo-source.png
 */
const LOGO_SRC = `/branding/resto-fadey-splash-logo.png?v=fy-company-locked-1`;
const SPLASH_BG = '#000000';
const SPLASH_HOLD_MS = 3000;
const SPLASH_EXIT_MS = 450;

let splashAnimationStarted = false;

/**
 * Pantalla splash al abrir / recargar. Logo FY circular + crédito abajo a la izquierda.
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
      <EntrySplashCircuits />
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
        </div>
      </div>
      <p className="rf-entry-splash__credit">Fadey Solutions SAC</p>
    </div>
  );
}
