/** Imagen de marca completa en pantalla de ingreso (splash animado). */
const SPLASH_SRC = '/resto-fadey-splash.png';

export default function RestoFadeyEntryHero({ className = '' }) {
  return (
    <div className={`rf-entry-hero ${className}`.trim()} aria-hidden={false}>
      <div className="rf-entry-hero__glow" aria-hidden />
      <div className="rf-entry-hero__frame rf-entry-hero--animate">
        <img
          src={SPLASH_SRC}
          alt="Resto-FADEY — Tu solución completa"
          className="rf-entry-hero__img"
          width={1024}
          height={1024}
          decoding="async"
          fetchPriority="high"
        />
      </div>
    </div>
  );
}
