import { useRef, useState } from 'react';

const SWIPE_DISMISS_PX = 72;
const EXIT_MS = 160;

/** Deslizar horizontalmente para quitar avisos y toasts. Sin fondo ni botón: el aviso se va directo. */
export default function SwipeToDismiss({ children, onDismiss, className = '', disabled = false }) {
  const startX = useRef(null);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const reset = () => {
    startX.current = null;
    setDx(0);
    setDragging(false);
  };

  const onPointerDown = (e) => {
    if (disabled || leaving) return;
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
    startX.current = null;
    setDragging(false);
    if (Math.abs(delta) < SWIPE_DISMISS_PX) {
      setDx(0);
      return;
    }
    // Sale de pantalla hacia el lado del gesto y se quita.
    const width = typeof window !== 'undefined' ? window.innerWidth : 600;
    setLeaving(true);
    setDx(delta > 0 ? width : -width);
    setTimeout(() => {
      onDismiss?.();
      setLeaving(false);
      setDx(0);
    }, EXIT_MS);
  };

  const opacity = Math.max(0, 1 - Math.abs(dx) / 260);

  return (
    <div className={className}>
      <div
        className="touch-pan-y select-none"
        style={{
          transform: `translateX(${dx}px)`,
          opacity,
          transition: dragging ? 'none' : `transform ${EXIT_MS}ms ease-out, opacity ${EXIT_MS}ms ease-out`,
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
