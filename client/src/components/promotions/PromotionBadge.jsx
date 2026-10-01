const RIBBON_TONES = {
  combo: 'linear-gradient(135deg,#7c3aed,#6d28d9)',
  '2x1': 'linear-gradient(135deg,#7c3aed,#9333ea)',
  '3x2': 'linear-gradient(135deg,#7c3aed,#9333ea)',
  default: 'linear-gradient(135deg,#f97316,#ea580c)',
};

const SIZES = {
  sm: { box: 44, band: 74, top: 9, left: -21, font: 8, pad: '1px 0' },
  md: { box: 66, band: 104, top: 15, left: -28, font: 10, pad: '2px 0' },
  lg: { box: 84, band: 132, top: 20, left: -34, font: 12, pad: '3px 0' },
};

export function promotionTone(type) {
  return RIBBON_TONES[type] || RIBBON_TONES.default;
}

/**
 * Cinta diagonal en la esquina superior izquierda.
 * El contenedor padre debe tener `position: relative` y `overflow: hidden`; la cinta es absoluta y no altera el tamaño.
 */
export default function PromotionBadge({ label, type = '', size = 'md', className = '' }) {
  if (!label) return null;
  const s = SIZES[size] || SIZES.md;
  return (
    <span
      aria-label={`Promoción ${label}`}
      className={`pointer-events-none absolute left-0 top-0 z-[2] overflow-hidden ${className}`.trim()}
      style={{ width: s.box, height: s.box }}
    >
      <span
        className="absolute block text-center font-extrabold uppercase leading-tight tracking-wide text-white"
        style={{
          width: s.band,
          top: s.top,
          left: s.left,
          padding: s.pad,
          fontSize: s.font,
          transform: 'rotate(-45deg)',
          background: promotionTone(type),
          boxShadow: '0 2px 6px rgba(15,23,42,0.25)',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
    </span>
  );
}
