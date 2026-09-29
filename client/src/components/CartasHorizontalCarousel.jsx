import { useRef, useEffect, useState, useCallback } from 'react';
import { MdChevronLeft, MdChevronRight } from 'react-icons/md';
import { resolveMediaUrl } from '../utils/api';

function isPdfUrl(url) {
  return /\.pdf(\?|$)/i.test(String(url || ''));
}

/**
 * Carrusel horizontal con scroll-snap (deslizar en móvil / trackpad).
 */
export default function CartasHorizontalCarousel({ cartas = [], className = '', showSwipeHint = true }) {
  const scrollerRef = useRef(null);
  const [index, setIndex] = useState(0);
  const scrollTimeoutRef = useRef(null);
  const [brokenUrls, setBrokenUrls] = useState(() => new Set());
  const markBroken = useCallback((url) => {
    setBrokenUrls((prev) => (prev.has(url) ? prev : new Set(prev).add(url)));
  }, []);

  const len = cartas.length;
  const active = len ? cartas[Math.min(index, len - 1)] : null;

  const updateIndexFromScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || len === 0) return;
    const w = el.clientWidth;
    if (w <= 0) return;
    const next = Math.round(el.scrollLeft / w);
    setIndex(Math.max(0, Math.min(next, len - 1)));
  }, [len]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return undefined;
    const onScroll = () => {
      if (scrollTimeoutRef.current) window.clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = window.setTimeout(updateIndexFromScroll, 60);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.clearTimeout(scrollTimeoutRef.current);
      el.removeEventListener('scroll', onScroll);
    };
  }, [updateIndexFromScroll]);

  useEffect(() => {
    setIndex(0);
    const el = scrollerRef.current;
    if (el) el.scrollLeft = 0;
  }, [len, cartas.map((c) => c.id).join('|')]);

  const go = (delta) => {
    const el = scrollerRef.current;
    if (!el || len === 0) return;
    const w = el.clientWidth;
    const next = Math.max(0, Math.min(index + delta, len - 1));
    el.scrollTo({ left: next * w, behavior: 'smooth' });
    setIndex(next);
  };

  if (len === 0) {
    return (
      <div className={`flex items-center justify-center ui-text-muted text-sm p-8 ${className}`}>
        Sin cartas configuradas
      </div>
    );
  }

  return (
    <div className={`flex flex-col min-h-0 min-w-0 ${className}`}>
      {showSwipeHint ? (
        <p className="text-center text-[10px] uppercase tracking-wider text-[#93C5FD] font-semibold px-2 py-2 shrink-0">
          Desliza a los lados para cambiar de carta
        </p>
      ) : null}

      <div className="relative flex-1 min-h-[200px] min-w-0 group">
        <button
          type="button"
          onClick={() => go(-1)}
          disabled={index <= 0}
          className="absolute left-1 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-[var(--ui-surface)] border border-[color:var(--ui-border)] text-[var(--ui-body-text)] shadow-lg disabled:opacity-30 disabled:pointer-events-none hover:bg-[var(--ui-sidebar-hover)]"
          aria-label="Carta anterior"
        >
          <MdChevronLeft className="text-2xl" />
        </button>
        <button
          type="button"
          onClick={() => go(1)}
          disabled={index >= len - 1}
          className="absolute right-1 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-[var(--ui-surface)] border border-[color:var(--ui-border)] text-[var(--ui-body-text)] shadow-lg disabled:opacity-30 disabled:pointer-events-none hover:bg-[var(--ui-sidebar-hover)]"
          aria-label="Carta siguiente"
        >
          <MdChevronRight className="text-2xl" />
        </button>

        <div
          ref={scrollerRef}
          className="flex h-full w-full overflow-x-auto overflow-y-hidden snap-x snap-mandatory scroll-smooth touch-pan-x overscroll-x-contain [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#334155]"
          style={{ scrollbarColor: '#334155 transparent' }}
        >
          {cartas.map((c) => (
            <div
              key={c.id}
              className="snap-center shrink-0 w-full h-full min-w-full flex items-center justify-center bg-[var(--ui-body-bg)] px-2 pb-2 box-border"
            >
              {c.url && isPdfUrl(c.url) ? (
                <iframe
                  title={c.name}
                  src={resolveMediaUrl(c.url)}
                  className="w-full h-full min-h-[280px] rounded-lg border border-[#334155] bg-white"
                />
              ) : c.url && brokenUrls.has(c.url) ? (
                <div className="flex flex-col items-center justify-center gap-1 text-center text-sm text-[var(--ui-muted)] p-6 rounded-lg border border-dashed border-[#334155]">
                  <span className="font-semibold text-[var(--ui-body-text)]">{c.name}</span>
                  <span>Archivo no disponible o no es una imagen válida</span>
                </div>
              ) : c.url ? (
                <img
                  src={resolveMediaUrl(c.url)}
                  alt={c.name}
                  onError={() => markBroken(c.url)}
                  className="max-h-full max-w-full w-auto h-auto object-contain rounded-lg border border-[#334155]"
                />
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col items-center gap-1 py-2 shrink-0">
        <p className="text-xs text-[#BFDBFE] font-medium truncate max-w-[95%] text-center">{active?.name || ''}</p>
        <div className="flex gap-1.5 justify-center">
          {cartas.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                const el = scrollerRef.current;
                if (!el) return;
                const w = el.clientWidth;
                el.scrollTo({ left: i * w, behavior: 'smooth' });
                setIndex(i);
              }}
              className={`h-2 rounded-full transition-all ${
                i === index ? 'w-6 bg-[#3B82F6]' : 'w-2 bg-[#475569] hover:bg-[#64748b]'
              }`}
              aria-label={`Ir a ${c.name}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
