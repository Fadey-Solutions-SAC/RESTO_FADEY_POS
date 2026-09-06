/** Toast compacto de aviso de reserva en caja. */
export const RESERVA_CAJA_TOAST_WRAP =
  'max-w-[min(100vw-2rem,16.5rem)] w-[16.5rem] rounded-lg border border-amber-500/45 bg-amber-50 text-amber-950 shadow-md px-2.5 py-2';

export function ReservaCajaToastBody({ visible, title, message, onClose }) {
  return (
    <div
      className={`${visible ? 'animate-enter' : 'animate-leave'} ${RESERVA_CAJA_TOAST_WRAP}`}
      role="status"
    >
      <p className="text-[11px] font-bold leading-snug">📅 {title}</p>
      <p className="text-[10px] mt-1 leading-snug line-clamp-4 whitespace-pre-wrap break-words">
        {message}
      </p>
      <button
        type="button"
        className="mt-1.5 text-[10px] font-semibold text-amber-800 underline underline-offset-2"
        onClick={onClose}
      >
        Cerrar aviso
      </button>
    </div>
  );
}
