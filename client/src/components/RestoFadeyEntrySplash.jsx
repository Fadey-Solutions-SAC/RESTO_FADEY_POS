import { useEffect, useState } from 'react';

const SPLASH_SRC = '/resto-fadey-splash.png?v=2';
/** Tiempo visible con animación antes de mostrar el login. */
const SPLASH_HOLD_MS = 2600;
const SPLASH_EXIT_MS = 650;

/**
 * Pantalla completa de marca al ingresar; al terminar llama onComplete y desaparece.
 */
export default function RestoFadeyEntrySplash({ onComplete, active = true }) {
  const [phase, setPhase] = useState('in');

  useEffect(() => {
    if (!active) return undefined;
    setPhase('in');
    const holdTimer = setTimeout(() => setPhase('out'), SPLASH_HOLD_MS);
    return () => clearTimeout(holdTimer);
  }, [active]);

  useEffect(() => {
    if (phase !== 'out') return undefined;
    const exitTimer = setTimeout(() => {
      onComplete?.();
    }, SPLASH_EXIT_MS);
    return () => clearTimeout(exitTimer);
  }, [phase, onComplete]);

  if (!active) return null;

  return (
    <div
      className={`rf-entry-splash${phase === 'out' ? ' rf-entry-splash--out' : ''}`}
      role="presentation"
      aria-hidden="true"
    >
      <div className="rf-entry-splash__glow" />
      <div className="rf-entry-splash__media">
        <img
          src={SPLASH_SRC}
          alt=""
          className="rf-entry-splash__img"
          width={1024}
          height={1024}
          decoding="async"
          fetchPriority="high"
        />
      </div>
    </div>
  );
}
