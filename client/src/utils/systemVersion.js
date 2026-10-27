/**
 * Versión del sistema RESTO FADEY (formato a.b.c.d, cada segmento 0–9).
 * Fuente: client/package.json → inyectada por Vite como __APP_VERSION__.
 */

const RAW =
  typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__
    ? String(__APP_VERSION__).trim()
    : '0.0.0.0';

/** @returns {string} p.ej. "1.1.2.7" */
export function getSystemVersion() {
  return RAW.replace(/^v\s*/i, '') || '0.0.0.0';
}

/** @returns {string} p.ej. "v 1.1.2.7" */
export function getSystemVersionLabel() {
  return `v ${getSystemVersion()}`;
}
