/**
 * Tokens visuales por tema — aplicados en runtime vía CSS variables en <html>.
 */

const LIVE_DEFAULTS = {
  success: '#34d399',
  warning: '#fbbf24',
  info: '#38bdf8',
  danger: '#fb7185',
};

/** Azul corporativo de referencia (muestra + recuadro de módulos). */
const CORPORATE_BLUE = '#2563EB';

/** Morado corporativo (referencia supervisor). */
const CORPORATE_PURPLE = '#10002B';

/** Menú oscuro morado: cabecera más oscura que el listado. */
const SIDEBAR_CHROME_DARK = {
  bg: CORPORATE_PURPLE,
  top: '#08001A',
  hover: '#1E0848',
  fg: '#E5E7EB',
  activeFg: '#ffffff',
};

/** Azul Minimal White (referencia usuario). */
const MINIMAL_NAVY = '#03045E';

/** Cada tema premium/oscuro tiene su propio chrome de menú (no compartir el morado). */
const SIDEBAR_BY_THEME = {
  corporate_blue: { ...SIDEBAR_CHROME_DARK, solid: CORPORATE_BLUE },
  minimal_white: {
    bg: MINIMAL_NAVY,
    top: '#02033F',
    hover: '#06107A',
    fg: '#ffffff',
    activeFg: '#ffffff',
    solid: '#0077B6',
  },
  emerald_business: { bg: '#064e3b', top: '#022c22', hover: '#065f46', fg: '#ECFDF5', activeFg: '#ffffff', solid: '#047857' },
  dark_elegance: {
    bg: '#0B1F3A',
    top: '#061529',
    hover: '#123056',
    fg: '#E5E7EB',
    activeFg: '#ffffff',
    solid: '#3b82f6',
  },
  gold_premium: {
    bg: '#000000',
    top: '#000000',
    hover: '#1F1F1F',
    fg: '#F5F5F5',
    activeFg: '#ffffff',
    solid: '#4B5563',
  },
  sunset_modern: {
    bg: '#3B1A10',
    top: '#24100A',
    hover: '#5A2818',
    fg: '#fff7ed',
    activeFg: '#ffffff',
    solid: '#EA580C',
  },
};

function preset(id, label, description, tags, vars, chartColors, colorScheme = 'dark') {
  const chrome = SIDEBAR_BY_THEME[id] || (colorScheme === 'light'
    ? SIDEBAR_BY_THEME.corporate_blue
    : { ...SIDEBAR_CHROME_DARK, solid: vars['--ui-accent'] || CORPORATE_BLUE });
  const solid = chrome.solid;
  const varsWithSidebar = {
    ...vars,
    '--ui-theme-solid': solid,
    '--ui-sidebar-panel-bg': chrome.bg,
    '--ui-sidebar-panel-top': chrome.top,
    '--ui-sidebar-panel-active': solid,
    '--ui-sidebar-panel-hover': chrome.hover,
    '--ui-sidebar-nav-fg': chrome.fg,
    '--ui-sidebar-panel-active-fg': chrome.activeFg,
    '--ui-sidebar-panel-active-border': solid,
  };
  return {
    id,
    label,
    description,
    tags,
    colorScheme,
    chartColors,
    vars: {
      ...varsWithSidebar,
      '--ui-chart-1': chartColors[0],
      '--ui-chart-2': chartColors[1],
      '--ui-chart-3': chartColors[2],
      '--ui-chart-4': chartColors[3],
      '--ui-chart-5': chartColors[4],
      '--ui-chart-6': chartColors[5],
    },
  };
}

/** @type {Record<string, ReturnType<typeof preset>>} */
export const THEME_PRESETS = {
  corporate_blue: preset(
    'corporate_blue',
    'Corporativo',
    'Elegante, empresarial y moderno (marca morada)',
    ['empresarial', 'restaurante moderno'],
    {
      '--ui-body-bg': '#f0f4fa',
      '--ui-body-text': '#0f172a',
      '--ui-muted': '#475569',
      '--ui-surface': '#ffffff',
      '--ui-surface-2': '#f1f5f9',
      '--ui-border': 'rgba(15, 23, 42, 0.12)',
      '--ui-accent': '#2563EB',
      '--ui-accent-hover': '#1D4ED8',
      '--ui-accent-muted': '#3B82F6',
      '--ui-input-bg': '#ffffff',
      '--ui-input-border': 'rgba(15, 23, 42, 0.18)',
      '--ui-focus-ring': '#2563EB',
      '--ui-sidebar-active-bg': 'rgba(37, 99, 235, 0.22)',
      '--ui-sidebar-hover': 'rgba(255, 255, 255, 0.06)',
      '--ui-sidebar-border': 'rgba(255, 255, 255, 0.08)',
      '--ui-logo-from': '#A855F7',
      '--ui-logo-to': '#7C3AED',
      '--ui-brand-fadey': '#C084FC',
      '--ui-btn-secondary-hover': 'rgba(15, 23, 42, 0.06)',
      '--ui-glass': 'rgba(255, 255, 255, 0.88)',
      // Variante clara del menú morado #10002B
      '--ui-shell-header-bg': '#C4B5FD',
    },
    ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'],
    'light'
  ),

  dark_elegance: preset(
    'dark_elegance',
    'Dark Elegance',
    'Premium, tecnológico y sofisticado',
    ['premium', 'glass'],
    {
      '--ui-body-bg': '#0c0e12',
      '--ui-body-text': '#f1f5f9',
      '--ui-muted': '#94a3b8',
      '--ui-surface': '#151922',
      '--ui-surface-2': '#1e2430',
      '--ui-border': 'rgba(96, 165, 250, 0.22)',
      '--ui-accent': '#3b82f6',
      '--ui-accent-hover': '#60a5fa',
      '--ui-accent-muted': '#38bdf8',
      '--ui-input-bg': '#12161e',
      '--ui-input-border': 'rgba(148, 163, 184, 0.25)',
      '--ui-focus-ring': '#38bdf8',
      '--ui-sidebar-active-bg': 'rgba(56, 189, 248, 0.18)',
      '--ui-sidebar-hover': 'rgba(56, 189, 248, 0.1)',
      '--ui-sidebar-border': 'rgba(148, 163, 184, 0.15)',
      '--ui-logo-from': '#38bdf8',
      '--ui-logo-to': '#2563eb',
      '--ui-brand-fadey': '#38BDF8',
      '--ui-btn-secondary-hover': 'rgba(255, 255, 255, 0.06)',
      '--ui-glass': 'rgba(21, 25, 34, 0.82)',
    },
    ['#38bdf8', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#22d3ee'],
    'dark'
  ),

  gold_premium: preset(
    'gold_premium',
    'Gold Premium',
    'Menú negro y pantalla de operaciones blanca',
    ['contraste', 'operación'],
    {
      '--ui-body-bg': '#ffffff',
      '--ui-body-text': '#111827',
      '--ui-muted': '#4B5563',
      '--ui-surface': '#ffffff',
      '--ui-surface-2': '#F3F4F6',
      '--ui-border': 'rgba(17, 24, 39, 0.12)',
      '--ui-accent': '#4B5563',
      '--ui-accent-hover': '#374151',
      '--ui-accent-muted': '#9CA3AF',
      '--ui-input-bg': '#ffffff',
      '--ui-input-border': 'rgba(17, 24, 39, 0.16)',
      '--ui-focus-ring': '#6B7280',
      '--ui-sidebar-active-bg': 'rgba(255, 255, 255, 0.12)',
      '--ui-sidebar-hover': 'rgba(255, 255, 255, 0.08)',
      '--ui-sidebar-border': 'rgba(255, 255, 255, 0.12)',
      '--ui-logo-from': '#9CA3AF',
      '--ui-logo-to': '#4B5563',
      '--ui-brand-fadey': '#D1D5DB',
      '--ui-btn-secondary-hover': 'rgba(17, 24, 39, 0.06)',
      '--ui-glass': 'rgba(255, 255, 255, 0.94)',
      '--ui-shell-header-bg': '#E5E7EB',
    },
    ['#4B5563', '#6B7280', '#9CA3AF', '#374151', '#111827', '#D1D5DB'],
    'light'
  ),

  minimal_white: preset(
    'minimal_white',
    'Minimal White',
    'Limpio, minimalista y moderno',
    ['cafetería', 'minimal'],
    {
      '--ui-body-bg': '#fafafa',
      '--ui-body-text': '#171717',
      '--ui-muted': '#525252',
      '--ui-surface': '#ffffff',
      '--ui-surface-2': '#f5f5f5',
      '--ui-border': 'rgba(0, 0, 0, 0.08)',
      '--ui-accent': MINIMAL_NAVY,
      '--ui-accent-hover': '#02033F',
      '--ui-accent-muted': '#0077B6',
      '--ui-input-bg': '#ffffff',
      '--ui-input-border': 'rgba(0, 0, 0, 0.12)',
      '--ui-focus-ring': '#0077B6',
      '--ui-sidebar-active-bg': 'rgba(255, 255, 255, 0.18)',
      '--ui-sidebar-hover': 'rgba(255, 255, 255, 0.12)',
      '--ui-sidebar-border': 'rgba(255, 255, 255, 0.2)',
      '--ui-logo-from': '#0077B6',
      '--ui-logo-to': MINIMAL_NAVY,
      '--ui-brand-fadey': '#38BDF8',
      '--ui-btn-secondary-hover': 'rgba(0, 0, 0, 0.05)',
      '--ui-glass': 'rgba(255, 255, 255, 0.92)',
      // Variante clara azul del menú navy #03045E (no lila)
      '--ui-shell-header-bg': '#93C5FD',
    },
    ['#03045e', '#0077b6', '#f59e0b', '#ef4444', '#6366f1', '#14b8a6'],
    'light'
  ),

  emerald_business: preset(
    'emerald_business',
    'Emerald Business',
    'Fresco, corporativo y moderno',
    ['cadena', 'corporativo'],
    {
      '--ui-body-bg': '#f0fdf4',
      '--ui-body-text': '#022c22',
      '--ui-muted': '#065f46',
      '--ui-surface': '#ffffff',
      '--ui-surface-2': '#ecfdf5',
      '--ui-border': 'rgba(6, 78, 59, 0.22)',
      '--ui-accent': '#064e3b',
      '--ui-accent-hover': '#022c22',
      '--ui-accent-muted': '#047857',
      '--ui-input-bg': '#ffffff',
      '--ui-input-border': 'rgba(6, 78, 59, 0.28)',
      '--ui-focus-ring': '#047857',
      '--ui-sidebar-active-bg': 'rgba(4, 120, 87, 0.22)',
      '--ui-sidebar-hover': 'rgba(255, 255, 255, 0.08)',
      '--ui-sidebar-border': 'rgba(255, 255, 255, 0.12)',
      '--ui-logo-from': '#047857',
      '--ui-logo-to': '#064e3b',
      '--ui-brand-fadey': '#34D399',
      '--ui-btn-secondary-hover': 'rgba(6, 78, 59, 0.08)',
      '--ui-glass': 'rgba(255, 255, 255, 0.9)',
      // Variante clara más verde del menú esmeralda
      '--ui-shell-header-bg': '#34D399',
    },
    ['#064e3b', '#2563eb', '#f59e0b', '#ef4444', '#047857', '#8b5cf6'],
    'light'
  ),

  sunset_modern: preset(
    'sunset_modern',
    'Sunset Modern',
    'Creativo, elegante y juvenil',
    ['fast food', 'marca joven'],
    {
      '--ui-body-bg': '#1a1210',
      '--ui-body-text': '#fff7ed',
      '--ui-muted': '#fdba74',
      '--ui-surface': '#261a16',
      '--ui-surface-2': '#32221c',
      '--ui-border': 'rgba(251, 146, 60, 0.28)',
      '--ui-accent': '#ea580c',
      '--ui-accent-hover': '#c2410c',
      '--ui-accent-muted': '#fb923c',
      '--ui-input-bg': '#261a16',
      '--ui-input-border': 'rgba(251, 146, 60, 0.35)',
      '--ui-focus-ring': '#fb923c',
      '--ui-sidebar-active-bg': 'rgba(234, 88, 12, 0.22)',
      '--ui-sidebar-hover': 'rgba(251, 146, 60, 0.12)',
      '--ui-sidebar-border': 'rgba(251, 146, 60, 0.2)',
      '--ui-logo-from': '#fb923c',
      '--ui-logo-to': '#ea580c',
      '--ui-brand-fadey': '#FB923C',
      '--ui-btn-secondary-hover': 'rgba(255, 255, 255, 0.06)',
      '--ui-glass': 'rgba(38, 26, 22, 0.88)',
    },
    ['#fb923c', '#ef4444', '#fbbf24', '#34d399', '#f472b6', '#38bdf8'],
    'dark'
  ),
};

export const PREMIUM_THEME_IDS = [
  'corporate_blue',
  'dark_elegance',
  'gold_premium',
  'minimal_white',
  'emerald_business',
  'sunset_modern',
];

/** Temas con superficies claras: siempre usan contraste de modo claro. */
export const LIGHT_THEME_IDS = [
  'corporate_blue',
  'minimal_white',
  'emerald_business',
  'gold_premium',
];

/** IDs de desarrollo ya retirados. Se reescriben a un tema premium al leer o guardar. */
export const LEGACY_UI_THEME_MAP = {
  blue: 'corporate_blue',
  light: 'minimal_white',
  dark: 'dark_elegance',
  gray: 'gold_premium',
  purple: 'corporate_blue',
  green: 'emerald_business',
};

export const ALL_THEME_IDS = [...PREMIUM_THEME_IDS];

export const UI_THEME_PRESET_LIST = PREMIUM_THEME_IDS.map((id) => THEME_PRESETS[id]);

export const CUSTOM_THEME_VAR_KEYS = [
  { key: '--ui-accent', label: 'Color principal' },
  { key: '--ui-accent-muted', label: 'Color secundario' },
  { key: '--ui-body-bg', label: 'Fondo general' },
  { key: '--ui-surface', label: 'Tarjetas / paneles' },
  { key: '--ui-body-text', label: 'Texto principal' },
];

export function getThemePreset(id) {
  const raw = String(id || '').trim();
  const t = LEGACY_UI_THEME_MAP[raw] || raw;
  return THEME_PRESETS[t] || THEME_PRESETS.corporate_blue;
}

export function getChartColorsForTheme(id) {
  return [...(getThemePreset(id).chartColors || [])];
}
