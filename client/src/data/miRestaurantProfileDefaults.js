/** Valores por defecto del perfil extendido (alineado con server/services/miRestaurantConfigService.js). */
export function defaultMiRestaurantProfile() {
  return {
    general: {
      address_reference: '',
      phone_secondary: '',
      whatsapp: '',
      website: '',
      social_facebook: '',
      social_instagram: '',
      social_tiktok: '',
      description: '',
    },
    branding: {
      logo_ticket: '',
      favicon: '',
      qr_hero_image: '',
      encuesta_cover_image: '',
    },
    ticket: {
      paper_width_mm: 80,
      alignment: 'center',
      show_logo: 1,
      show_qr: 0,
      show_social: 1,
      welcome_message: '',
      footer_message: '',
      promo_message: '',
      auto_notes: '',
      custom_footer: '',
    },
    tax_display: {
      rounding_mode: 'standard',
      show_tax_breakdown: 1,
    },
    delivery_extra: {
      estimated_minutes: 45,
      message: '',
      auto_notes: '',
      contact_phone: '',
      coverage_zones: '',
    },
    qr: {
      cover_title: '',
      welcome_message: '',
      primary_color: '#f04438',
      banner_url: '',
      show_social: 1,
      terms_text: '',
    },
    messages: {
      ticket: '',
      reservas: '',
      delivery: '',
      promos: '',
      clientes: '',
      whatsapp: '',
    },
    meta: { updated_at: '', updated_by: '' },
  };
}

export function mergeMiRestaurantProfile(base, patch) {
  const b = base && typeof base === 'object' ? base : defaultMiRestaurantProfile();
  if (!patch || typeof patch !== 'object') return b;
  const out = { ...b };
  for (const k of Object.keys(patch)) {
    const pv = patch[k];
    if (pv && typeof pv === 'object' && !Array.isArray(pv) && b[k] && typeof b[k] === 'object') {
      out[k] = { ...b[k], ...pv };
    } else if (pv !== undefined) {
      out[k] = pv;
    }
  }
  return out;
}

export const MESSAGE_VARIABLES_HELP =
  'Variables: {cliente} {pedido} {mesa} {total} {restaurante} {fecha} {hora}';
