/**
 * Tokens visuales por tema — aplicados en runtime vía CSS variables en <html>.
 * Compatible con temas legacy (blue, light, dark, …).
 */

const LIVE_DEFAULTS = {
  success: '#34d399',
  warning: '#fbbf24',
  info: '#38bdf8',
  danger: '#fb7185',
};

/** Azul corporativo de referencia (muestra + recuadro de módulos). */
const CORPORATE_BLUE = '#2563EB';

/** Menú oscuro (referencia): cabecera más oscura que el listado de módulos. */
const SIDEBAR_CHROME_DARK = {
  bg: '#161625',
  top: '#0d0d17',
  hover: '#1e1e36',
  fg: '#E5E7EB',
  activeFg: '#ffffff',
};

/** Corporativo azul = mismo esquema oscuro de la referencia + píldora #2563EB. */
const SIDEBAR_BY_THEME = {
  corporate_blue: { ...SIDEBAR_CHROME_DARK, solid: CORPORATE_BLUE },
  minimal_white: { bg: '#E0F2FE', top: '#E0F2FE', hover: '#BAE6FD', fg: '#0f172a', activeFg: '#ffffff', solid: '#0EA5E9' },
  emerald_business: { bg: '#D1FAE5', top: '#D1FAE5', hover: '#A7F3D0', fg: '#064e3b', activeFg: '#ffffff', solid: '#059669' },
  dark_elegance: { ...SIDEBAR_CHROME_DARK, solid: CORPORATE_BLUE },
  gold_premium: { ...SIDEBAR_CHROME_DARK, solid: '#C9A227' },
  sunset_modern: { ...SIDEBAR_CHROME_DARK, solid: '#EA580C' },
  blue: { ...SIDEBAR_CHROME_DARK, solid: CORPORATE_BLUE },
  light: { bg: '#DBEAFE', top: '#DBEAFE', hover: '#BFDBFE', fg: '#0f172a', activeFg: '#ffffff', solid: CORPORATE_BLUE },
  dark: { ...SIDEBAR_CHROME_DARK, solid: CORPORATE_BLUE },
  gray: { bg: '#18181b', top: '#0f0f12', hover: '#27272a', fg: '#E5E7EB', activeFg: '#ffffff', solid: '#71717A' },
  purple: { ...SIDEBAR_CHROME_DARK, solid: '#5A4EEF' },
  green: { bg: '#D1FAE5', top: '#D1FAE5', hover: '#A7F3D0', fg: '#064e3b', activeFg: '#ffffff', solid: '#059669' },
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
    'Corporativo azul',
    'Elegante, empresarial y moderno',
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
      '--ui-logo-from': '#2563EB',
      '--ui-logo-to': '#1D4ED8',
      '--ui-btn-secondary-hover': 'rgba(15, 23, 42, 0.06)',
      '--ui-glass': 'rgba(255, 255, 255, 0.88)',
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
      '--ui-btn-secondary-hover': 'rgba(255, 255, 255, 0.06)',
      '--ui-glass': 'rgba(21, 25, 34, 0.82)',
    },
    ['#38bdf8', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#22d3ee'],
    'dark'
  ),

  gold_premium: preset(
    'gold_premium',
    'Gold Premium',
    'Lujo para restobares y gourmet',
    ['lujo', 'gourmet'],
    {
      '--ui-body-bg': '#0f0d0a',
      '--ui-body-text': '#faf7f2',
      '--ui-muted': '#c4b5a0',
      '--ui-surface': '#1a1712',
      '--ui-surface-2': '#252018',
      '--ui-border': 'rgba(212, 175, 55, 0.28)',
      '--ui-accent': '#c9a227',
      '--ui-accent-hover': '#b8921f',
      '--ui-accent-muted': '#e8c547',
      '--ui-input-bg': '#1a1712',
      '--ui-input-border': 'rgba(212, 175, 55, 0.35)',
      '--ui-focus-ring': '#e8c547',
      '--ui-sidebar-active-bg': 'rgba(201, 162, 39, 0.2)',
      '--ui-sidebar-hover': 'rgba(201, 162, 39, 0.1)',
      '--ui-sidebar-border': 'rgba(212, 175, 55, 0.2)',
      '--ui-logo-from': '#e8c547',
      '--ui-logo-to': '#a67c00',
      '--ui-btn-secondary-hover': 'rgba(255, 255, 255, 0.06)',
      '--ui-glass': 'rgba(26, 23, 18, 0.9)',
    },
    ['#e8c547', '#10b981', '#f59e0b', '#ef4444', '#d4af37', '#94a3b8'],
    'dark'
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
      '--ui-accent': '#0ea5e9',
      '--ui-accent-hover': '#0284c7',
      '--ui-accent-muted': '#38bdf8',
      '--ui-input-bg': '#ffffff',
      '--ui-input-border': 'rgba(0, 0, 0, 0.12)',
      '--ui-focus-ring': '#0ea5e9',
      '--ui-sidebar-active-bg': 'rgba(14, 165, 233, 0.1)',
      '--ui-sidebar-hover': 'rgba(0, 0, 0, 0.04)',
      '--ui-sidebar-border': 'rgba(0, 0, 0, 0.08)',
      '--ui-logo-from': '#38bdf8',
      '--ui-logo-to': '#0ea5e9',
      '--ui-btn-secondary-hover': 'rgba(0, 0, 0, 0.05)',
      '--ui-glass': 'rgba(255, 255, 255, 0.92)',
    },
    ['#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#6366f1', '#14b8a6'],
    'light'
  ),

  emerald_business: preset(
    'emerald_business',
    'Emerald Business',
    'Fresco, corporativo y moderno',
    ['cadena', 'corporativo'],
    {
      '--ui-body-bg': '#ecfdf5',
      '--ui-body-text': '#064e3b',
      '--ui-muted': '#047857',
      '--ui-surface': '#ffffff',
      '--ui-surface-2': '#f0fdf4',
      '--ui-border': 'rgba(5, 150, 105, 0.2)',
      '--ui-accent': '#059669',
      '--ui-accent-hover': '#047857',
      '--ui-accent-muted': '#10b981',
      '--ui-input-bg': '#ffffff',
      '--ui-input-border': 'rgba(5, 150, 105, 0.25)',
      '--ui-focus-ring': '#10b981',
      '--ui-sidebar-active-bg': 'rgba(16, 185, 129, 0.14)',
      '--ui-sidebar-hover': 'rgba(5, 150, 105, 0.08)',
      '--ui-sidebar-border': 'rgba(5, 150, 105, 0.15)',
      '--ui-logo-from': '#34d399',
      '--ui-logo-to': '#059669',
      '--ui-btn-secondary-hover': 'rgba(5, 150, 105, 0.06)',
      '--ui-glass': 'rgba(255, 255, 255, 0.9)',
    },
    ['#10b981', '#2563eb', '#f59e0b', '#ef4444', '#14b8a6', '#8b5cf6'],
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
      '--ui-btn-secondary-hover': 'rgba(255, 255, 255, 0.06)',
      '--ui-glass': 'rgba(38, 26, 22, 0.88)',
    },
    ['#fb923c', '#ef4444', '#fbbf24', '#34d399', '#f472b6', '#38bdf8'],
    'dark'
  ),

  /* —— Legacy (misma mecánica runtime) —— */
  blue: preset(
    'blue',
    'Azul clásico',
    'Tema histórico del sistema',
    ['legacy'],
    {
      '--ui-body-bg': '#0f1419',
      '--ui-body-text': '#f1f5f9',
      '--ui-muted': '#94a3b8',
      '--ui-surface': '#1a2332',
      '--ui-surface-2': '#243044',
      '--ui-border': 'rgba(59, 130, 246, 0.28)',
      '--ui-accent': '#2563eb',
      '--ui-accent-hover': '#1d4ed8',
      '--ui-accent-muted': '#3b82f6',
      '--ui-input-bg': '#1a2332',
      '--ui-input-border': 'rgba(59, 130, 246, 0.35)',
      '--ui-focus-ring': '#3b82f6',
      '--ui-sidebar-active-bg': 'rgba(59, 130, 246, 0.25)',
      '--ui-sidebar-hover': 'rgba(59, 130, 246, 0.15)',
      '--ui-sidebar-border': 'rgba(59, 130, 246, 0.3)',
      '--ui-logo-from': '#3b82f6',
      '--ui-logo-to': '#2563eb',
      '--ui-btn-secondary-hover': 'rgba(255, 255, 255, 0.08)',
      '--ui-glass': 'rgba(26, 35, 50, 0.88)',
    },
    ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4'],
    'dark'
  ),

  light: preset(
    'light',
    'Claro',
    'Alto contraste claro',
    ['legacy'],
    {
      '--ui-body-bg': '#ffffff',
      '--ui-body-text': '#0f172a',
      '--ui-muted': '#475569',
      '--ui-surface': '#ffffff',
      '--ui-surface-2': '#f8fafc',
      '--ui-border': 'rgba(15, 23, 42, 0.12)',
      '--ui-accent': '#2563eb',
      '--ui-accent-hover': '#1d4ed8',
      '--ui-accent-muted': '#2563eb',
      '--ui-input-bg': '#ffffff',
      '--ui-input-border': 'rgba(15, 23, 42, 0.15)',
      '--ui-focus-ring': '#2563eb',
      '--ui-sidebar-active-bg': 'rgba(37, 99, 235, 0.12)',
      '--ui-sidebar-hover': 'rgba(0, 0, 0, 0.04)',
      '--ui-sidebar-border': 'rgba(0, 0, 0, 0.1)',
      '--ui-logo-from': '#2563eb',
      '--ui-logo-to': '#1d4ed8',
      '--ui-btn-secondary-hover': 'rgba(0, 0, 0, 0.05)',
      '--ui-glass': 'rgba(255, 255, 255, 0.92)',
    },
    ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'],
    'light'
  ),

  dark: preset(
    'dark',
    'Oscuro',
    'Negro de alto contraste',
    ['legacy'],
    {
      '--ui-body-bg': '#000000',
      '--ui-body-text': '#f3f4f6',
      '--ui-muted': '#9ca3af',
      '--ui-surface': '#0a0a0a',
      '--ui-surface-2': '#171717',
      '--ui-border': 'rgba(75, 85, 99, 0.45)',
      '--ui-accent': '#3b82f6',
      '--ui-accent-hover': '#2563eb',
      '--ui-accent-muted': '#60a5fa',
      '--ui-input-bg': '#0a0a0a',
      '--ui-input-border': 'rgba(75, 85, 99, 0.5)',
      '--ui-focus-ring': '#3b82f6',
      '--ui-sidebar-active-bg': 'rgba(59, 130, 246, 0.22)',
      '--ui-sidebar-hover': 'rgba(59, 130, 246, 0.12)',
      '--ui-sidebar-border': 'rgba(75, 85, 99, 0.45)',
      '--ui-logo-from': '#3b82f6',
      '--ui-logo-to': '#1d4ed8',
      '--ui-btn-secondary-hover': 'rgba(255, 255, 255, 0.06)',
      '--ui-glass': 'rgba(10, 10, 10, 0.9)',
    },
    ['#60a5fa', '#34d399', '#fbbf24', '#f87171', '#c084fc', '#22d3ee'],
    'dark'
  ),

  gray: preset(
    'gray',
    'Gris',
    'Neutro intermedio',
    ['legacy'],
    {
      '--ui-body-bg': '#27272a',
      '--ui-body-text': '#fafafa',
      '--ui-muted': '#a1a1aa',
      '--ui-surface': '#3f3f46',
      '--ui-surface-2': '#52525b',
      '--ui-border': 'rgba(161, 161, 170, 0.35)',
      '--ui-accent': '#71717a',
      '--ui-accent-hover': '#52525b',
      '--ui-accent-muted': '#a1a1aa',
      '--ui-input-bg': '#3f3f46',
      '--ui-input-border': 'rgba(161, 161, 170, 0.4)',
      '--ui-focus-ring': '#a1a1aa',
      '--ui-sidebar-active-bg': 'rgba(113, 113, 122, 0.35)',
      '--ui-sidebar-hover': 'rgba(113, 113, 122, 0.22)',
      '--ui-sidebar-border': 'rgba(161, 161, 170, 0.28)',
      '--ui-logo-from': '#71717a',
      '--ui-logo-to': '#52525b',
      '--ui-btn-secondary-hover': 'rgba(255, 255, 255, 0.08)',
      '--ui-glass': 'rgba(63, 63, 70, 0.9)',
    },
    ['#a1a1aa', '#10b981', '#f59e0b', '#ef4444', '#818cf8', '#22d3ee'],
    'dark'
  ),

  purple: preset(
    'purple',
    'Morado',
    'Acentos violeta',
    ['legacy'],
    {
      '--ui-body-bg': '#0F101F',
      '--ui-body-text': '#FFFFFF',
      '--ui-muted': '#A0A0A0',
      '--ui-surface': '#17182A',
      '--ui-surface-2': '#1E1E36',
      '--ui-border': 'rgba(90, 78, 239, 0.28)',
      '--ui-accent': '#5A4EEF',
      '--ui-accent-hover': '#4C40D9',
      '--ui-accent-muted': '#7C75F5',
      '--ui-input-bg': '#17182A',
      '--ui-input-border': 'rgba(90, 78, 239, 0.4)',
      '--ui-focus-ring': '#5A4EEF',
      '--ui-sidebar-active-bg': 'rgba(90, 78, 239, 0.22)',
      '--ui-sidebar-hover': 'rgba(255, 255, 255, 0.06)',
      '--ui-sidebar-border': 'rgba(255, 255, 255, 0.08)',
      '--ui-logo-from': '#5A4EEF',
      '--ui-logo-to': '#5A4EEF',
      '--ui-btn-secondary-hover': 'rgba(255, 255, 255, 0.08)',
      '--ui-glass': 'rgba(23, 24, 42, 0.92)',
    },
    ['#5A4EEF', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#38bdf8'],
    'dark'
  ),

  green: preset(
    'green',
    'Verde esmeralda',
    'Fondos verdes clásicos',
    ['legacy'],
    {
      '--ui-body-bg': '#022c22',
      '--ui-body-text': '#ecfdf5',
      '--ui-muted': '#6ee7b7',
      '--ui-surface': '#065f46',
      '--ui-surface-2': '#047857',
      '--ui-border': 'rgba(52, 211, 153, 0.35)',
      '--ui-accent': '#10b981',
      '--ui-accent-hover': '#059669',
      '--ui-accent-muted': '#34d399',
      '--ui-input-bg': '#065f46',
      '--ui-input-border': 'rgba(52, 211, 153, 0.4)',
      '--ui-focus-ring': '#34d399',
      '--ui-sidebar-active-bg': 'rgba(16, 185, 129, 0.28)',
      '--ui-sidebar-hover': 'rgba(16, 185, 129, 0.16)',
      '--ui-sidebar-border': 'rgba(52, 211, 153, 0.28)',
      '--ui-logo-from': '#34d399',
      '--ui-logo-to': '#047857',
      '--ui-btn-secondary-hover': 'rgba(255, 255, 255, 0.08)',
      '--ui-glass': 'rgba(6, 95, 70, 0.88)',
    },
    ['#34d399', '#3b82f6', '#fbbf24', '#f87171', '#a78bfa', '#22d3ee'],
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

export const LEGACY_THEME_IDS = ['blue', 'light', 'dark', 'gray', 'purple', 'green'];

export const ALL_THEME_IDS = [...PREMIUM_THEME_IDS, ...LEGACY_THEME_IDS];

export const UI_THEME_PRESET_LIST = [
  ...PREMIUM_THEME_IDS.map((id) => THEME_PRESETS[id]),
  ...LEGACY_THEME_IDS.map((id) => THEME_PRESETS[id]),
];

export const CUSTOM_THEME_VAR_KEYS = [
  { key: '--ui-accent', label: 'Color principal' },
  { key: '--ui-accent-muted', label: 'Color secundario' },
  { key: '--ui-body-bg', label: 'Fondo general' },
  { key: '--ui-surface', label: 'Tarjetas / paneles' },
  { key: '--ui-body-text', label: 'Texto principal' },
];

export function getThemePreset(id) {
  const t = String(id || '').trim();
  return THEME_PRESETS[t] || THEME_PRESETS.blue;
}

export function getChartColorsForTheme(id) {
  return [...(getThemePreset(id).chartColors || [])];
}
