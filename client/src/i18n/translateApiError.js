import i18n from './index';

/** Mensajes del API en español → clave i18n (errors namespace). */
const SERVER_MESSAGE_KEYS = [
  [/no se pudo enviar el pedido a cocina/i, 'errors:orders.sendFailed'],
  [/no se pudo procesar el pedido/i, 'errors:orders.processFailed'],
  [/pedido no encontrado/i, 'errors:orders.notFound'],
  [/no tiene permisos.*pedido/i, 'errors:orders.forbidden'],
  [/categor[ií]a no encontrada/i, 'errors:categories.notFound'],
  [/error al actualizar la categor[ií]a/i, 'errors:categories.updateFailed'],
  [/no se pudo guardar la categor[ií]a/i, 'errors:categories.saveFailed'],
  [/token.*expirad[oa]|jwt expired/i, 'errors:sessionExpired'],
  [/inactividad.*36\s*h|36\s*h.*inactividad/i, 'errors:sessionIdleTimeout'],
  [/token.*inv[aá]lido|sesi[oó]n inv[aá]lida/i, 'errors:invalidSession'],
  [/no tienes permisos|no tiene permisos/i, 'errors:forbidden'],
];

function translateKnownServerMessage(message) {
  const raw = String(message || '').trim();
  if (!raw || raw === 'undefined') return '';
  for (const [pattern, key] of SERVER_MESSAGE_KEYS) {
    if (pattern.test(raw)) {
      return i18n.t(key, { defaultValue: raw });
    }
  }
  return raw;
}

/**
 * Mensaje amigable para respuestas HTTP fallidas del API.
 * @param {Response} res
 * @param {object|null} data
 * @param {string} endpoint
 */
export function translateApiErrorMessage(res, data, endpoint) {
  const fromApi = data?.error != null ? String(data.error).trim() : '';
  const translated = translateKnownServerMessage(fromApi);
  if (translated && !/^internal server error$/i.test(translated)) {
    return translated;
  }

  const ep = String(endpoint || '');
  if (ep.includes('/orders')) {
    if (res.status >= 500) return i18n.t('errors:orders.sendFailed');
    if (res.status === 403) return i18n.t('errors:orders.forbidden');
    if (res.status === 404) return i18n.t('errors:orders.notFound');
    return i18n.t('errors:orders.processFailed');
  }
  if (ep.includes('/categories')) {
    if (res.status === 404) return i18n.t('errors:categories.notFound');
    if (res.status >= 500) return i18n.t('errors:categories.updateFailed');
    return i18n.t('errors:categories.saveFailed');
  }
  if (res.status === 404) return i18n.t('errors:service404');
  const isLoginAttempt = /\/auth\/(login|customer\/login|customer\/register)/.test(ep);
  if (res.status === 401) {
    if (isLoginAttempt && fromApi) return fromApi;
    return i18n.t('errors:sessionExpired');
  }
  if (res.status === 403) {
    if (translated && translated !== fromApi) return translated;
    return i18n.t('errors:forbidden');
  }
  if (res.status >= 500) return i18n.t('errors:server');
  return data?.message || i18n.t('errors:generic');
}
