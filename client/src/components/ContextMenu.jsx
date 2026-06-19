import { useEffect } from 'react';

/**
 * Menú contextual flotante (clic derecho). Se cierra al hacer clic fuera o Escape.
 */
export default function ContextMenu({ open, x, y, items = [], onClose }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !items.length) return null;

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-[200] cursor-default border-0 bg-transparent p-0"
        aria-label="Cerrar menú"
        onClick={onClose}
      />
      <div
        className="fixed z-[201] min-w-[180px] rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] py-1 shadow-xl"
        style={{ left: Math.max(8, x), top: Math.max(8, y) }}
        role="menu"
      >
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              item.onClick?.();
              onClose();
            }}
            className={`block w-full px-3 py-2 text-left text-sm ${
              item.disabled
                ? 'text-[var(--ui-muted)] cursor-not-allowed'
                : 'text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}
