/** Toast de aviso de reserva en caja (tamaño original). */
export const RESERVA_CAJA_TOAST_WRAP =
  'max-w-md w-[min(100vw-2rem,26rem)] rounded-xl border border-amber-500/50 bg-amber-50 text-amber-950 shadow-lg px-4 py-3';

export function ReservaCajaToastBody({ visible, title, message, onClose }) {
  return (
    <div
      className={`${visible ? 'animate-enter' : 'animate-leave'} ${RESERVA_CAJA_TOAST_WRAP}`}
      role="status"
    >
      <p className="text-sm font-bold">📅 {title}</p>
      <p className="text-xs mt-1.5 leading-snug whitespace-pre-wrap break-words">{message}</p>
      <button
        type="button"
        className="mt-2 text-xs font-semibold text-amber-800 underline underline-offset-2"
        onClick={onClose}
      >
        Cerrar aviso
      </button>
    </div>
  );
}
