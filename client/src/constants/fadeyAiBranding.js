/** Avatar PIX de IA Fadey (público) — Saludo por defecto. */
export const FADEY_AI_AVATAR_SRC = '/branding/pix-ai-avatar.png';

/** Frase al abrir el chat. */
export const FADEY_AI_TAGLINE = 'Conectado con tu negocio';

/** Evento global para abrir el chat PIX desde otros paneles. */
export const OPEN_FADEY_AI_EVENT = 'rf-open-fadey-ai';

/** Expresiones / usos del personaje según la acción de la IA. */
export const FADEY_AI_EXPRESSIONS = {
  saludo: '/branding/pix-saludo.png',
  pensando: '/branding/pix-pensando.png',
  feliz: '/branding/pix-feliz.png',
  analizando: '/branding/pix-analizando.png',
  asesorando: '/branding/pix-asesorando.png',
  chat: '/branding/pix-chat.png',
  notif: '/branding/pix-notif.png',
  reportes: '/branding/pix-reportes.png',
};

const ANALYTICS_TOOLS = new Set([
  'business_insights',
  'sales_summary',
  'top_products',
  'low_stock',
]);

/**
 * Resuelve la expresión PIX según el estado / fuentes de la respuesta.
 * @param {{ busy?: boolean, sources?: Array<{ kind?: string, title?: string }>|null, content?: string }} opts
 * @returns {'saludo'|'pensando'|'feliz'|'analizando'|'asesorando'}
 */
export function resolveFadeyAiMood(opts = {}) {
  if (opts.busy) return 'pensando';

  const sources = Array.isArray(opts.sources) ? opts.sources : [];
  const toolTitles = sources
    .filter((s) => s && (s.kind === 'tool' || ANALYTICS_TOOLS.has(String(s.title || ''))))
    .map((s) => String(s.title || '').toLowerCase());

  const text = String(opts.content || '').toLowerCase();
  const wantsAdvise =
    /recomend|suger|te conviene|deber[ií]as|mejora|oportunidad|alerta/.test(text)
    || toolTitles.includes('business_insights');
  const wantsAnalyze =
    toolTitles.some((t) => ANALYTICS_TOOLS.has(t))
    || /ventas|ticket|producto|stock|indicador|resumen|informe|dato/.test(text);

  if (wantsAdvise && (wantsAnalyze || /recomend|suger/.test(text))) return 'asesorando';
  if (wantsAnalyze) return 'analizando';
  if (sources.some((s) => s && (s.kind === 'guide' || s.title === 'search_guides'))) return 'feliz';
  if (text.trim()) return 'feliz';
  return 'saludo';
}

/** Src del avatar según mood (fallback a Saludo). */
export function getFadeyAiAvatarSrc(mood = 'saludo') {
  return FADEY_AI_EXPRESSIONS[mood] || FADEY_AI_EXPRESSIONS.saludo || FADEY_AI_AVATAR_SRC;
}
