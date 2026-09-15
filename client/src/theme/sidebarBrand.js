/**
 * Marca Resto Fadey en sidebar según tema (referencia branding).
 * Corporativo → morado | Minimal White → azul | Emerald Business → verde
 */

export const SIDEBAR_BRAND_MARKS = {
  corporate_blue: {
    src: '/branding/sidebar-mark-corporate.png?v=1',
    fadey: '#C084FC',
  },
  purple: {
    src: '/branding/sidebar-mark-corporate.png?v=1',
    fadey: '#C084FC',
  },
  minimal_white: {
    src: '/branding/sidebar-mark-minimal.png?v=1',
    fadey: '#38BDF8',
  },
  blue: {
    src: '/branding/sidebar-mark-minimal.png?v=1',
    fadey: '#38BDF8',
  },
  emerald_business: {
    src: '/branding/sidebar-mark-emerald.png?v=1',
    fadey: '#34D399',
  },
  green: {
    src: '/branding/sidebar-mark-emerald.png?v=1',
    fadey: '#34D399',
  },
};

const FALLBACK_MARK = {
  src: '/branding/resto-fadey-logo.png',
  fadey: 'var(--ui-accent-muted, #38bdf8)',
};

export function getSidebarBrandMark(themeId) {
  const id = String(themeId || '').trim();
  return SIDEBAR_BRAND_MARKS[id] || FALLBACK_MARK;
}
