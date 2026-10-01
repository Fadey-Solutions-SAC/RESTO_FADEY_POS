const RIBBON_PALETTE = [
  'linear-gradient(135deg,#f97316,#ea580c)',
  'linear-gradient(135deg,#8b5cf6,#6d28d9)',
  'linear-gradient(135deg,#ec4899,#be185d)',
  'linear-gradient(135deg,#ef4444,#b91c1c)',
  'linear-gradient(135deg,#10b981,#047857)',
  'linear-gradient(135deg,#3b82f6,#1d4ed8)',
  'linear-gradient(135deg,#14b8a6,#0f766e)',
  'linear-gradient(135deg,#f59e0b,#b45309)',
  'linear-gradient(135deg,#d946ef,#a21caf)',
  'linear-gradient(135deg,#06b6d4,#0e7490)',
];

const TYPE_TONES = {
  combo: RIBBON_PALETTE[1],
  '2x1': RIBBON_PALETTE[1],
  '3x2': RIBBON_PALETTE[1],
};

/** `box`: área recortada en la esquina; `center`: centro del listón; `notch`: profundidad del corte en V. */
const SIZES = {
  sm: { box: 50, band: 58, height: 16, center: 22, font: 8, notch: 6 },
  md: { box: 112, band: 124, height: 26, center: 48, font: 12, notch: 10 },
  lg: { box: 140, band: 156, height: 32, center: 60, font: 14, notch: 12 },
};

function hashSeed(seed) {
  const s = String(seed || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Color de la promoción: aleatorio por promoción pero estable (mismo id → mismo color). */
export function promotionTone(type, seed) {
  if (seed) return RIBBON_PALETTE[hashSeed(seed) % RIBBON_PALETTE.length];
  return TYPE_TONES[type] || RIBBON_PALETTE[0];
}

/**
 * Listón diagonal con extremos en V sobre la esquina superior izquierda.
 * El contenedor padre debe tener `position: relative` y `overflow: hidden`; el listón es absoluto y no altera el tamaño.
 */
export default function PromotionBadge({ label, type = '', seed = '', size = 'md', className = '' }) {
  if (!label) return null;
  const s = SIZES[size] || SIZES.md;
  return (
    <span
      aria-label={`Promoción ${label}`}
      className={`pointer-events-none absolute left-0 top-0 z-[2] overflow-hidden ${className}`.trim()}
      style={{ width: s.box, height: s.box }}
    >
      <span
        className="absolute block"
        style={{
          width: s.band,
          height: s.height,
          left: s.center - s.band / 2,
          top: s.center - s.height / 2,
          transform: 'rotate(-45deg)',
          filter: 'drop-shadow(0 2px 3px rgba(15,23,42,0.35))',
        }}
      >
        <span
          className="flex h-full w-full items-center justify-center font-extrabold uppercase tracking-wide text-white"
          style={{
            fontSize: s.font,
            lineHeight: 1,
            paddingInline: s.notch + 2,
            whiteSpace: 'nowrap',
            background: promotionTone(type, seed),
            clipPath: `polygon(0 0, 100% 0, calc(100% - ${s.notch}px) 50%, 100% 100%, 0 100%, ${s.notch}px 50%)`,
            textShadow: '0 1px 1px rgba(0,0,0,0.25)',
          }}
        >
          {label}
        </span>
      </span>
    </span>
  );
}
