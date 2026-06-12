/** Sistema global de temas Resto-FADEY (Configuración → Apariencia). */

import {
  ALL_THEME_IDS,
  PREMIUM_THEME_IDS,
  UI_THEME_PRESET_LIST,
  getThemePreset,
  getChartColorsForTheme,
  THEME_PRESETS,
  CUSTOM_THEME_VAR_KEYS,
} from './themePresets';

export {
  PREMIUM_THEME_IDS,
  UI_THEME_PRESET_LIST,
  getChartColorsForTheme,
  THEME_PRESETS,
  CUSTOM_THEME_VAR_KEYS,
};

export const UI_THEME_OPTIONS = UI_THEME_PRESET_LIST.map((p) => ({
  id: p.id,
  label: p.label,
  description: p.description,
  premium: PREMIUM_THEME_IDS.includes(p.id),
  swatch: p.vars?.['--ui-accent'] || '#2563eb',
  surface: p.vars?.['--ui-surface'] || '#1a2332',
  bodyBg: p.vars?.['--ui-body-bg'] || '#0f1419',
}));

export const UI_THEME_IDS = ALL_THEME_IDS;

export const DEFAULT_UI_THEME = 'corporate_blue';

export const UI_THEME_STORAGE_KEY = 'resto-ui-theme';
export const UI_THEME_USER_STORAGE_PREFIX = 'resto-ui-theme-user-';
export const UI_THEME_MODE_STORAGE_KEY = 'resto-ui-theme-mode';

export const UI_THEME_MODE_IDS = ['light', 'dark', 'auto'];

let autoModeMedia = null;
let autoModeListener = null;

export function getValidUiThemeId(raw) {
  const t = String(raw || '').trim();
  return UI_THEME_IDS.includes(t) ? t : DEFAULT_UI_THEME;
}

function userStorageKey(userId) {
  return `${UI_THEME_USER_STORAGE_PREFIX}${String(userId || '').trim()}`;
}

/** Preferencia individual (localStorage por usuario). */
export function readUserUiThemePreference(userId) {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(userStorageKey(userId));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

export function saveUserUiThemePreference(userId, data) {
  if (!userId) return;
  try {
    localStorage.setItem(userStorageKey(userId), JSON.stringify(data || {}));
  } catch (_) {
    /* ignore */
  }
}

export function readStoredUiThemeMode() {
  try {
    const m = String(localStorage.getItem(UI_THEME_MODE_STORAGE_KEY) || 'light').trim();
    return UI_THEME_MODE_IDS.includes(m) ? m : 'light';
  } catch (_) {
    return 'light';
  }
}

function resolveAutoColorScheme() {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function teardownAutoListener() {
  if (autoModeMedia && autoModeListener) {
    autoModeMedia.removeEventListener('change', autoModeListener);
  }
  autoModeMedia = null;
  autoModeListener = null;
}

function applyCssVariables(vars) {
  if (typeof document === 'undefined') return;
  const el = document.documentElement;
  Object.entries(vars || {}).forEach(([key, value]) => {
    if (value != null && value !== '') el.style.setProperty(key, value);
  });
}

function clearInlineThemeVars() {
  if (typeof document === 'undefined') return;
  const preset = getThemePreset('blue');
  Object.keys(preset.vars || {}).forEach((key) => {
    document.documentElement.style.removeProperty(key);
  });
}

/**
 * Aplica tema completo: preset + personalización + modo.
 * @param {string} id — id del preset
 * @param {{ custom?: Record<string,string>, mode?: string, userId?: string, persist?: boolean }} [opts]
 */
export function applyUiTheme(id, opts = {}) {
  const themeId = getValidUiThemeId(id);
  const preset = getThemePreset(themeId);
  const custom = opts.custom && typeof opts.custom === 'object' ? opts.custom : {};
  const mode = opts.mode ? String(opts.mode) : readStoredUiThemeMode();
  const validMode = UI_THEME_MODE_IDS.includes(mode) ? mode : 'light';

  let colorScheme = preset.colorScheme;
  if (validMode === 'auto') {
    colorScheme = resolveAutoColorScheme();
    teardownAutoListener();
    if (typeof window !== 'undefined' && window.matchMedia) {
      autoModeMedia = window.matchMedia('(prefers-color-scheme: dark)');
      autoModeListener = () => {
        const cs = resolveAutoColorScheme();
        document.documentElement.setAttribute('data-ui-color-scheme', cs);
        document.documentElement.style.colorScheme = cs;
        dispatchThemeChange(themeId);
      };
      autoModeMedia.addEventListener('change', autoModeListener);
    }
  } else {
    teardownAutoListener();
    colorScheme = validMode;
  }

  const mergedVars = { ...preset.vars, ...custom };

  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-ui-theme', themeId);
    document.documentElement.setAttribute('data-ui-theme-mode', validMode);
    document.documentElement.setAttribute('data-ui-color-scheme', colorScheme);
    document.documentElement.style.colorScheme = colorScheme;
    applyCssVariables(mergedVars);
    const writeGlobal = opts.writeGlobalStorage !== false;
    if (writeGlobal) {
      try {
        localStorage.setItem(UI_THEME_STORAGE_KEY, themeId);
        localStorage.setItem(UI_THEME_MODE_STORAGE_KEY, validMode);
      } catch (_) {
        /* ignore */
      }
    }
    if (opts.persist !== false && opts.userId) {
      const prev = readUserUiThemePreference(opts.userId) || {};
      saveUserUiThemePreference(opts.userId, {
        ...prev,
        usePersonal: true,
        theme: themeId,
        mode: validMode,
        custom,
      });
    }
  }

  dispatchThemeChange(themeId);
  return themeId;
}

export function dispatchThemeChange(themeId) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('ui-theme-change', {
      detail: {
        themeId,
        chartColors: getChartColorsForTheme(themeId),
      },
    })
  );
}

/** Desde objeto settings del restaurante (appSettings). */
export function applyUiThemeFromAppSettings(settings = {}, userId = '') {
  const restaurantTheme = getValidUiThemeId(settings.ui_theme);
  const custom =
    settings.ui_theme_custom && typeof settings.ui_theme_custom === 'object'
      ? settings.ui_theme_custom
      : {};
  const restaurantMode = settings.ui_theme_mode || readStoredUiThemeMode();

  const userPref = userId ? readUserUiThemePreference(userId) : null;
  const useUser = Boolean(userPref?.usePersonal && userPref.theme);

  const themeId = useUser ? getValidUiThemeId(userPref.theme) : restaurantTheme;
  const mode = useUser ? userPref.mode || restaurantMode : restaurantMode;
  const mergedCustom = useUser
    ? { ...custom, ...(userPref.custom || {}) }
    : custom;

  return applyUiTheme(themeId, {
    custom: mergedCustom,
    mode,
    userId: useUser ? userId : '',
    persist: false,
    writeGlobalStorage: !useUser,
  });
}

export function readStoredUiTheme() {
  try {
    return getValidUiThemeId(localStorage.getItem(UI_THEME_STORAGE_KEY));
  } catch (_) {
    return DEFAULT_UI_THEME;
  }
}

/** Arranque rápido antes de cargar settings del servidor. */
export function bootstrapUiTheme() {
  return applyUiTheme(readStoredUiTheme(), { mode: readStoredUiThemeMode(), persist: false });
}
