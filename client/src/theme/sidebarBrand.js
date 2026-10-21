/**
 * Marca Resto Fadey (RY) en sidebar y previews de tema.
 * Misma forma en todos los temas; solo cambia el color del acento.
 */

const RY = {
  corporate: '/branding/sidebar-mark-corporate.png?v=3',
  minimal: '/branding/sidebar-mark-minimal.png?v=3',
  emerald: '/branding/sidebar-mark-emerald.png?v=3',
  gold: '/branding/sidebar-mark-gold.png?v=3',
  sunset: '/branding/sidebar-mark-sunset.png?v=3',
};

export const SIDEBAR_BRAND_MARKS = {
  corporate_blue: { src: RY.corporate, fadey: '#C084FC' },
  dark_elegance: { src: RY.minimal, fadey: '#38BDF8' },
  minimal_white: { src: RY.minimal, fadey: '#38BDF8' },
  gold_premium: { src: RY.gold, fadey: '#D1D5DB' },
  emerald_business: { src: RY.emerald, fadey: '#34D399' },
  sunset_modern: { src: RY.sunset, fadey: '#FB923C' },
};

const FALLBACK_MARK = {
  src: RY.minimal,
  fadey: 'var(--ui-accent-muted, #38bdf8)',
};

export function getSidebarBrandMark(themeId) {
  const id = String(themeId || '').trim();
  return SIDEBAR_BRAND_MARKS[id] || FALLBACK_MARK;
}
