/** Modal «Agregar / modificar pedido» (Mesas / Caja): compacto y anclado a la derecha en PC. */
export const STAFF_ORDER_MODAL_SIZE = 'staffOrder';

export const STAFF_ORDER_MODAL_MAX_HEIGHT =
  'h-[min(92vh,920px)] max-h-[min(92vh,920px)]';

export const STAFF_ORDER_MODAL_BODY_CLASS =
  '!flex !min-h-0 !min-w-0 !flex-1 !flex-col !overflow-hidden !px-3 !pb-3 !pt-2 sm:!px-4 sm:!pb-4';

/** Props comunes para <Modal /> al tomar pedido en mesa o caja. */
export function staffOrderModalProps({ isOpen, onClose, title }) {
  return {
    isOpen,
    onClose,
    title,
    size: STAFF_ORDER_MODAL_SIZE,
    placement: 'right',
    maxHeightClass: STAFF_ORDER_MODAL_MAX_HEIGHT,
    bodyClassName: STAFF_ORDER_MODAL_BODY_CLASS,
    /** En PC: hoja a la derecha; en móvil casi a pantalla completa. */
    dialogClassName:
      'sm:rounded-2xl lg:rounded-l-2xl lg:rounded-r-none lg:mr-0 lg:h-[min(96vh,960px)] lg:max-h-[96vh]',
    containerClassName: 'lg:items-stretch lg:justify-end lg:p-0 lg:py-2 lg:pr-2',
  };
}
