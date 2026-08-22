/** Debe coincidir con server/masterAdminService.js → PAGO_USO_SUBIR_COMPROBANTE_AVISO_TITLE */
export const PAGO_USO_SUBIR_COMPROBANTE_AVISO_TITLE = 'Pago por uso — subir comprobante';

/** Debe coincidir con server/services/platformPaymentService.js */
export const PAGO_COMPROBANTE_PENDING_TITLE = 'Comprobante recibido — pendiente de aprobación';
export const PAGO_RECHAZADO_TITLE = 'Pago rechazado — Resto Fadey';
export const PAGO_APROBADO_TITLE = 'Pago aprobado — Resto Fadey';

/** Módulo Mi empresa → Pago de plan */
export const PAGO_PLAN_MODULE_PATH = '/admin/mi-restaurant?view=pago_uso_sistema';

/** Avisos del ciclo de pago que deben ofrecer ir a cargar/ver comprobante. */
export function isPagoPlanAvisoTitle(title) {
  const t = String(title || '').trim();
  if (!t) return false;
  if (
    t === PAGO_USO_SUBIR_COMPROBANTE_AVISO_TITLE
    || t === PAGO_COMPROBANTE_PENDING_TITLE
    || t === PAGO_RECHAZADO_TITLE
  ) {
    return true;
  }
  // Variantes / avisos automáticos de facturación relacionados al plan
  if (/subir comprobante|falta de pago|pago por uso|pago de plan/i.test(t)) return true;
  return false;
}
