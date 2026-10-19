/**
 * Intervalos de red de respaldo (ms).
 * Los eventos Socket.IO siguen actualizando caja, cocina, mesas y QR al instante.
 * No bajar estos valores en producción sin medir tráfico.
 */
export const REFRESH_MS = {
  POS_OPERATIONAL: 20_000,
  POS_CATALOG: 120_000,
  POS_BILLING: 30_000,
  KITCHEN: 20_000,
  DELIVERY: 20_000,
  TABLES: 20_000,
  ESCRITORIO_ORDERS: 30_000,
  ESCRITORIO_LIVE: 20_000,
  ESCRITORIO_CAJA_STATIONS: 30_000,
  SELF_ORDER: 15_000,
  LAYOUT_CAJA: 20_000,
  ADMIN_DELIVERY: 20_000,
};
