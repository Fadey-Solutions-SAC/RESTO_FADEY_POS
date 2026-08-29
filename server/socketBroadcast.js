/** Referencia al servidor Socket.IO (se asigna desde index.js tras crear `io`). */
let ioRef = null;

function setSocketIo(io) {
  ioRef = io || null;
}

function getSocketIo() {
  return ioRef;
}

/** Aviso ligero para refrescar alertas operativas / panel en vivo (stock, inventario). */
function emitInventoryUpdate(payload = {}) {
  if (ioRef) {
    try {
      ioRef.emit('inventory-update', payload);
    } catch (_) {
      /* noop */
    }
  }
}

/** Estado de comprobante (SUNAT/local) para listas de facturación y ventas sin depender solo del pedido. */
function emitBillingDocumentUpdate(payload) {
  if (ioRef && payload && typeof payload === 'object') {
    try {
      ioRef.emit('billing-document-update', payload);
    } catch (_) {
      /* noop */
    }
  }
}

/** Bloqueo global del sistema (login / sesiones staff). */
function emitSystemLockUpdate(payload = {}) {
  if (ioRef) {
    try {
      const p = payload && typeof payload === 'object' ? payload : {};
      ioRef.emit('system-lock-update', p);
      ioRef.emit('staff-data-update', {
        kind: 'system-lock',
        ...p,
      });
    } catch (_) {
      /* noop */
    }
  }
}

/** Datos de módulos staff (reservas, clientes, créditos, catálogos) para sincronizar pestañas abiertas. */
function emitStaffDataUpdate(payload = {}) {
  if (ioRef) {
    try {
      const p = payload && typeof payload === 'object' ? payload : {};
      ioRef.emit('staff-data-update', p);
    } catch (_) {
      /* noop */
    }
  }
}

module.exports = {
  setSocketIo,
  getSocketIo,
  emitInventoryUpdate,
  emitBillingDocumentUpdate,
  emitStaffDataUpdate,
  emitSystemLockUpdate,
};
