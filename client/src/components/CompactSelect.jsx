import { useEffect, useId, useRef, useState } from 'react';
import { MdExpandMore } from 'react-icons/md';

/**
 * Selector compacto: el desplegable tiene altura máxima y scroll (el <select> nativo no).
 */
export default function CompactSelect({
  value = '',
  onChange,
  options = [],
  placeholder = 'Seleccionar',
  className = '',
  buttonClassName = '',
  disabled = false,
  title = '',
  emptyHint = '',
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const listId = useId();

  const selected = options.find((o) => String(o.value) === String(value));
  const label = selected ? selected.label : placeholder;

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative min-w-0 ${className}`}>
      <button
        type="button"
        disabled={disabled}
        title={title || label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className={`input-field flex w-full items-center justify-between gap-1.5 text-left text-xs py-1.5 disabled:opacity-50 ${buttonClassName}`}
      >
        <span className="min-w-0 truncate">{label}</span>
        <MdExpandMore
          className={`shrink-0 text-base text-[var(--ui-muted)] transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-[11.5rem] w-full overflow-y-auto overscroll-contain rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] py-0.5 shadow-lg scrollbar-thin"
        >
          {options.length === 0 ? (
            <li className="px-2.5 py-2 text-[11px] text-[var(--ui-muted)]">
              {emptyHint || 'Sin opciones'}
            </li>
          ) : (
            options.map((o) => {
              const active = String(o.value) === String(value);
              return (
                <li key={String(o.value) || '__empty'} role="option" aria-selected={active}>
                  <button
                    type="button"
                    className={`flex w-full px-2.5 py-1.5 text-left text-xs leading-snug ${
                      active
                        ? 'bg-[var(--ui-accent)] text-white'
                        : 'text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]'
                    }`}
                    onClick={() => {
                      onChange?.(o.value);
                      setOpen(false);
                    }}
                  >
                    {o.label}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
