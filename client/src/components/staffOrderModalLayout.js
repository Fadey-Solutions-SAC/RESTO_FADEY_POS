/** Modal «Agregar / modificar pedido» (Mesas, Caja, Reservas con la misma UI). */
export const STAFF_ORDER_MODAL_SIZE = 'staffOrder';

export const STAFF_ORDER_MODAL_MAX_HEIGHT =
  'h-[min(92vh,920px)] max-h-[min(92vh,920px)]';

export const STAFF_ORDER_MODAL_BODY_CLASS =
  '!flex !min-h-0 !min-w-0 !flex-1 !flex-col !overflow-hidden !px-4 !pb-4 !pt-2 sm:!px-6 sm:!pb-6';

/** Props comunes para <Modal /> al tomar pedido en mesa o caja. */
export function staffOrderModalProps({ isOpen, onClose, title }) {
  return {
    isOpen,
    onClose,
    title,
    size: STAFF_ORDER_MODAL_SIZE,
    maxHeightClass: STAFF_ORDER_MODAL_MAX_HEIGHT,
    bodyClassName: STAFF_ORDER_MODAL_BODY_CLASS,
  };
}
