import { useEffect, useState } from 'react';
import { LIGHT_THEME_IDS } from './themePresets';

/** Lee `data-ui-theme` en `<html>` y se actualiza al cambiar (Configuración → Apariencia). */
export function useUiTheme() {
  const read = () =>
    typeof document !== 'undefined'
      ? document.documentElement.getAttribute('data-ui-theme') || 'corporate_blue'
      : 'corporate_blue';

  const [theme, setTheme] = useState(read);

  useEffect(() => {
    const el = document.documentElement;
    const onChange = () => setTheme(read());
    const obs = new MutationObserver(onChange);
    obs.observe(el, { attributes: true, attributeFilter: ['data-ui-theme', 'data-ui-theme-mode'] });
    window.addEventListener('ui-theme-change', onChange);
    return () => {
      obs.disconnect();
      window.removeEventListener('ui-theme-change', onChange);
    };
  }, []);

  return theme;
}

function readIsLight() {
  if (typeof document === 'undefined') return false;
  const el = document.documentElement;
  const scheme = el.getAttribute('data-ui-color-scheme') || el.style.colorScheme || '';
  if (scheme === 'light') return true;
  if (scheme === 'dark') return false;
  const themeId = el.getAttribute('data-ui-theme') || '';
  return LIGHT_THEME_IDS.includes(themeId);
}

/** True cuando el contraste activo es claro (temas claros o modo claro). */
export function useIsUiThemeLight() {
  const themeId = useUiTheme();
  const [light, setLight] = useState(readIsLight);

  useEffect(() => {
    const sync = () => setLight(readIsLight());
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-ui-theme', 'data-ui-theme-mode', 'data-ui-color-scheme', 'style'],
    });
    window.addEventListener('ui-theme-change', sync);
    return () => {
      obs.disconnect();
      window.removeEventListener('ui-theme-change', sync);
    };
  }, [themeId]);

  return light;
}
