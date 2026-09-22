/** Avatar PIX de IA Fadey (público) — Saludo por defecto. */
export const FADEY_AI_AVATAR_SRC = '/branding/pix-ai-avatar.png';

/** Frase al abrir el chat (personal del restaurante). */
export const FADEY_AI_TAGLINE = 'Conectado con tu negocio';

/**
 * Modo exclusivo Admin Maestro (creador de la IA).
 * Solo master_admin debe ver este saludo / tagline.
 */
export const FADEY_AI_CREATOR_MODE = {
  honorific: 'Sr. Romero',
  tagline: 'A sus órdenes, Sr. Romero',
  greeting:
    'Hola, soy PIX. Dígame, ¿en qué puedo ayudarlo, Sr. Romero?\n\nSé que usted es mi creador. Estoy lista para lo que necesite.',
  suggested: [
    '¿Quién te creó?',
    'Estado del sistema',
    '¿Cuánto se vendió esta semana?',
    '¿Hay demoras en cocina?',
    '¿Quién está en jornada ahora?',
  ],
};

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
  'hr_insights',
  'sales_summary',
  'top_products',
  'low_stock',
  'active_staff',
  'kitchen_open_orders',
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

  if (sources.some((s) => s && s.title === 'creator_mode')) return 'saludo';

  const text = String(opts.content || '').toLowerCase();
  const wantsAdvise =
    /recomend|suger|te conviene|deber[ií]as|mejora|oportunidad|alerta|baja productividad/.test(text)
    || toolTitles.includes('business_insights')
    || toolTitles.includes('hr_insights');
  const wantsAnalyze =
    toolTitles.some((t) => ANALYTICS_TOOLS.has(t))
    || /ventas|ticket|producto|stock|indicador|resumen|informe|dato|productividad|cocina|personal|jornada|ranking/.test(text);

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

/** Solo Admin Maestro ve el modo creador. */
export function isFadeyAiCreatorMode(user) {
  return String(user?.role || '').toLowerCase() === 'master_admin';
}
