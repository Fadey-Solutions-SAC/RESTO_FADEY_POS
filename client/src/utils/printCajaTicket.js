import { api, hasElectronPrinting, electronPrinting } from './api';

/** Imprime en la impresora configurada de caja (Electron o bridge). */
export async function printCajaTicket(payload) {
  try {
    if (hasElectronPrinting()) {
      await electronPrinting.printModule('caja', payload);
    } else {
      await api.printing.post('/printing/print/caja', payload);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || 'No se pudo imprimir' };
  }
}
