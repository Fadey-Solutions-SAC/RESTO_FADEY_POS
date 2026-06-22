/** Valores por defecto al fusionar respuesta de GET /admin-modules/config/app */
export const DEFAULT_APP_SETTINGS = {
  regional: {
    country: 'Peru',
    timezone: 'America/Lima',
    language: 'es',
    date_format: 'DD/MM/YYYY',
    time_format: '24h',
    currency_code: 'PEN',
    currency_symbol: 'S/',
    decimal_separator: '.',
    thousands_separator: ',',
    ticket_language: 'es',
    number_decimals: 2,
    rounding_mode: 'standard',
  },
};

/**
 * Normaliza la respuesta del API (blob `settings` + clave `regional` suelta en BD).
 * @param {object} payload
 */
export function normalizeConfigFromApi(payload) {
  const settingsBlob =
    payload && typeof payload.settings === 'object' && payload.settings !== null
      ? payload.settings
      : payload && typeof payload === 'object'
        ? payload
        : {};
  const topRegional =
    payload && typeof payload.regional === 'object' && payload.regional !== null
      ? payload.regional
      : {};
  const settingsRegional =
    settingsBlob.regional && typeof settingsBlob.regional === 'object' ? settingsBlob.regional : null;
  // Prioridad: settings.regional (blob guardado). Clave suelta `regional` solo si el blob no tiene regional.
  const regionalMerged = settingsRegional
    ? { ...DEFAULT_APP_SETTINGS.regional, ...settingsRegional }
    : { ...DEFAULT_APP_SETTINGS.regional, ...topRegional };
  return {
    ...DEFAULT_APP_SETTINGS,
    ...settingsBlob,
    regional: regionalMerged,
  };
}

/** Tras guardar, conserva lo enviado si la respuesta del API llegó incompleta. */
export function mergeSavedAppSettings(normalized, source) {
  if (!source || typeof source !== 'object' || !normalized) return normalized;
  const next = { ...normalized };
  if (source.regional && typeof source.regional === 'object') {
    next.regional = { ...(next.regional || {}), ...source.regional };
  }
  const arrayKeys = [
    'locales', 'almacenes', 'salones', 'cajas', 'comprobantes', 'impresoras', 'tarjetas',
    'monedas', 'cuentas_transferencia', 'marcas', 'imagenes_self', 'categoria_anular', 'formas_pago',
  ];
  arrayKeys.forEach((key) => {
    if (Array.isArray(source[key])) next[key] = source[key];
  });
  if (source.impuestos && typeof source.impuestos === 'object') {
    next.impuestos = { ...(next.impuestos || {}), ...source.impuestos };
  }
  if (source.jornada_laboral && typeof source.jornada_laboral === 'object') {
    next.jornada_laboral = { ...(next.jornada_laboral || {}), ...source.jornada_laboral };
  }
  if (source.apariencia && typeof source.apariencia === 'object') {
    next.apariencia = { ...(next.apariencia || {}), ...source.apariencia };
  }
  if (Object.prototype.hasOwnProperty.call(source, 'ui_theme')) {
    next.ui_theme = source.ui_theme;
  }
  if (Object.prototype.hasOwnProperty.call(source, 'ui_theme_mode')) {
    next.ui_theme_mode = source.ui_theme_mode;
  }
  if (Object.prototype.hasOwnProperty.call(source, 'ui_theme_custom')) {
    next.ui_theme_custom =
      source.ui_theme_custom && typeof source.ui_theme_custom === 'object' && !Array.isArray(source.ui_theme_custom)
        ? { ...source.ui_theme_custom }
        : {};
  }
  if (Array.isArray(source.auto_pedido_cartas)) {
    next.auto_pedido_cartas = source.auto_pedido_cartas;
  }
  return next;
}
