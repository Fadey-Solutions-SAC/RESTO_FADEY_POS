import { useEffect, useState } from 'react';
import { MdRestaurantMenu } from 'react-icons/md';

const MESSAGES = [
  'Preparando la carta para ti…',
  'Calentando la cocina…',
  'Acomodando tu mesa…',
  'Revisando las promociones del día…',
  'Ya casi está listo…',
];

export const MAX_LOAD_RETRIES = 8;

/** Errores de red o del servidor (p. ej. Render arrancando); los 4xx son respuestas definitivas. */
export function isRetryableLoadError(err) {
  const status = Number(err?.status || 0);
  return !status || status >= 500;
}

/** Pantalla de espera del QR de auto pedido mientras carga la carta (incluye reintentos del servidor). */
export default function SelfOrderLoading({ subtitle = '', slow = false }) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % MESSAGES.length), 2200);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex min-h-screen min-h-[100dvh] items-center justify-center bg-[var(--ui-body-bg)] p-6 text-center text-[var(--ui-body-text)]">
      <div className="w-full max-w-sm rounded-3xl border border-[color:var(--ui-border)] bg-[var(--ui-surface)] px-8 py-10 shadow-xl">
        <div className="relative mx-auto mb-6 h-20 w-20">
          <span className="absolute inset-0 animate-ping rounded-full bg-[var(--ui-accent)] opacity-20" />
          <span className="absolute inset-0 animate-spin rounded-full border-4 border-[color:var(--ui-border)] border-t-[var(--ui-accent)]" />
          <span className="absolute inset-0 flex items-center justify-center">
            <MdRestaurantMenu className="text-4xl text-[var(--ui-accent)]" />
          </span>
        </div>
        <h1 className="mb-1 text-lg font-bold">¡Bienvenido!</h1>
        {subtitle ? <p className="mb-3 text-xs font-semibold text-[var(--ui-accent)]">{subtitle}</p> : null}
        <p key={idx} className="min-h-[1.25rem] text-sm text-[var(--ui-muted)] animate-pulse">
          {MESSAGES[idx]}
        </p>
        {slow ? (
          <p className="mt-4 text-xs text-[var(--ui-muted)]">
            Está tardando un poco más de lo normal. No cierres esta página, seguimos intentando.
          </p>
        ) : null}
      </div>
    </div>
  );
}
