import { useRef, useState } from 'react';

const SWIPE_DISMISS_PX = 88;

/** Deslizar horizontalmente para quitar avisos y toasts. */
export default function SwipeToDismiss({ children, onDismiss, className = '', disabled = false }) {
  const startX = useRef(null);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);

  const reset = () => {
    startX.current = null;
    setDx(0);
    setDragging(false);
  };

  const onPointerDown = (e) => {
    if (disabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    startX.current = e.clientX;
    setDragging(true);
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* noop */ }
  };

  const onPointerMove = (e) => {
    if (startX.current == null || disabled) return;
    setDx(e.clientX - startX.current);
  };

  const onPointerUp = () => {
    if (startX.current == null) return;
    const delta = dx;
    reset();
    if (Math.abs(delta) >= SWIPE_DISMISS_PX) onDismiss?.();
  };

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <div
        className="absolute inset-0 flex items-center justify-end px-4 bg-red-600/90 text-white text-xs font-semibold pointer-events-none"
        aria-hidden
      >
        Quitar
      </div>
      <div
        className="relative touch-pan-y"
        style={{
          transform: `translateX(${dx}px)`,
          transition: dragging ? 'none' : 'transform 0.18s ease-out',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={reset}
      >
        {children}
      </div>
    </div>
  );
}
