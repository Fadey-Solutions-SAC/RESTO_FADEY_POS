import { MdClose } from 'react-icons/md';
import { useIsUiThemeLight } from '../theme/useUiTheme';

/**
 * Modales centrados por defecto. Con tema global «claro», el panel usa superficie clara aunque variant sea oscuro.
 * Usa variant="light" en rutas de cliente; variant por defecto sigue siendo oscuro en temas blue/dark/gray/purple/green.
 */
export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  placement = 'center',
  variant = 'dark',
  containerClassName = '',
  headerClassName = '',
  titleClassName = '',
  closeButtonClassName = '',
  closeIconClassName = '',
  /** Sustituye la altura máxima del panel (p. ej. carta generador: casi pantalla completa). */
  maxHeightClass = 'max-h-[90vh]',
  dialogClassName = '',
  bodyClassName = '',
}) {
  const globalLight = useIsUiThemeLight();
  if (!isOpen) return null;

  const isLight = variant === 'light' || globalLight;

  const sizeClass = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    full: 'max-w-6xl',
    /** Casi ancho completo útil en escritorio (generador de cartas, etc.) */
    wide: 'max-w-[min(96rem,calc(100vw-1rem))]',
  }[size] || 'max-w-lg';

  const placementClass = placement === 'right' ? 'justify-end' : 'justify-center';

  const overlayClass = isLight ? 'bg-black/40 rf-modal-overlay' : 'bg-black/70 rf-modal-overlay';

  const panelClass = isLight
    ? 'border border-[color:var(--ui-border)] bg-[var(--ui-surface)] shadow-xl text-[var(--ui-body-text)]'
    : 'border border-[color:var(--ui-border)] bg-[var(--ui-surface)] shadow-2xl shadow-black/50';

  const headerDefault = isLight
    ? 'border-b border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] text-[var(--ui-body-text)]'
    : 'border-b border-[color:var(--ui-border)] bg-[var(--ui-surface-2)]';

  const titleDefault = 'text-[var(--ui-body-text)]';

  const closeDefault = 'hover:bg-[var(--ui-sidebar-hover)]';

  const closeIconDefault = 'text-[var(--ui-muted)]';

  const bodyClass = isLight
    ? `min-h-0 overflow-y-auto p-6 flex-1 bg-[var(--ui-surface)] text-[var(--ui-body-text)] [&_strong]:text-[var(--ui-body-text)] ${bodyClassName}`.trim()
    : `min-h-0 overflow-y-auto p-6 flex-1 bg-[var(--ui-surface)] modal-sheet-body ${bodyClassName}`.trim();

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center ${placementClass} p-4 ${containerClassName}`}
      role="presentation"
    >
      <button
        type="button"
        tabIndex={-1}
        className={`absolute inset-0 z-0 cursor-default border-0 ${overlayClass}`}
        aria-label="Cerrar"
        onClick={onClose}
      />
      <div
        className={`rf-modal-panel relative z-10 rounded-2xl w-full ${sizeClass} ${maxHeightClass} flex flex-col overflow-hidden ${panelClass} ${dialogClassName}`.trim()}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title != null && title !== '' ? 'modal-title' : undefined}
      >
        <div
          className={`flex items-center justify-between px-6 py-4 shrink-0 ${headerClassName || headerDefault}`}
        >
          {title != null && title !== '' ? (
            <h2 id="modal-title" className={`text-lg font-bold ${titleClassName || titleDefault}`}>
              {title}
            </h2>
          ) : (
            <span className="sr-only">Diálogo</span>
          )}
          <button
            type="button"
            onClick={onClose}
            className={`p-2 rounded-lg transition-colors ${closeButtonClassName || closeDefault}`}
            aria-label="Cerrar"
          >
            <MdClose className={`text-xl ${closeIconClassName || closeIconDefault}`} />
          </button>
        </div>
        <div className={bodyClass}>{children}</div>
      </div>
    </div>
  );
}
