/** IDs válidos de tema UI (sincronizado con client/src/theme/themePresets.js). */
const UI_THEME_IDS = new Set([
  'corporate_blue',
  'dark_elegance',
  'gold_premium',
  'minimal_white',
  'emerald_business',
  'sunset_modern',
]);

/** Temas de desarrollo retirados. Se reescriben al leer o guardar. */
const LEGACY_UI_THEME_MAP = {
  blue: 'corporate_blue',
  light: 'minimal_white',
  dark: 'dark_elegance',
  gray: 'gold_premium',
  purple: 'corporate_blue',
  green: 'emerald_business',
};

function getValidUiThemeId(raw) {
  const t = String(raw || '').trim();
  const mapped = LEGACY_UI_THEME_MAP[t] || t;
  return UI_THEME_IDS.has(mapped) ? mapped : 'corporate_blue';
}

module.exports = { UI_THEME_IDS, getValidUiThemeId };
