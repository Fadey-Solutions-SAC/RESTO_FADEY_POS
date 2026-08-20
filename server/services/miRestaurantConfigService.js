/**
 * Configuración extendida «Mi Restaurante» (app_settings.mi_restaurant).
 * Complementa la fila `restaurants` sin sustituir integraciones existentes.
 */

const { queryOne, runSql } = require('../database');
const { emitStaffDataUpdate } = require('../socketBroadcast');

const SETTINGS_KEY = 'mi_restaurant';

function parseJsonSafe(value, fallback) {
  try {
    if (value == null || value === '') return fallback;
    return JSON.parse(String(value));
  } catch (_) {
    return fallback;
  }
}

function defaultMiRestaurantProfile() {
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
    meta: {
      updated_at: '',
      updated_by: '',
    },
  };
}

function deepMerge(base, patch) {
  const out = { ...base };
  if (!patch || typeof patch !== 'object') return out;
  for (const k of Object.keys(patch)) {
    const pv = patch[k];
    if (pv && typeof pv === 'object' && !Array.isArray(pv) && base[k] && typeof base[k] === 'object') {
      out[k] = deepMerge(base[k], pv);
    } else if (pv !== undefined) {
      out[k] = pv;
    }
  }
  return out;
}

function readStoredProfile() {
  const row = queryOne('SELECT value FROM app_settings WHERE key = ?', [SETTINGS_KEY]);
  return deepMerge(defaultMiRestaurantProfile(), parseJsonSafe(row?.value, {}));
}

function saveStoredProfile(profile, { actorUserId = '', actorName = '' } = {}) {
  const next = deepMerge(defaultMiRestaurantProfile(), profile);
  next.meta = {
    ...next.meta,
    updated_at: new Date().toISOString(),
    updated_by: String(actorName || actorUserId || '').slice(0, 120),
  };
  runSql(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [SETTINGS_KEY, JSON.stringify(next)]
  );
  emitStaffDataUpdate({ domain: 'app_config' });
  return next;
}

/** Sincroniza campos del perfil desde la fila restaurants (lectura API). */
function hydrateProfileFromRestaurant(restaurant, profile) {
  const r = restaurant || {};
  const p = deepMerge(defaultMiRestaurantProfile(), profile);
  return p;
}

/** Aplica perfil → campos opcionales de restaurants en PUT (sin borrar datos no enviados). */
function restaurantPatchFromProfile(restaurant, profilePatch) {
  const p = deepMerge(defaultMiRestaurantProfile(), profilePatch);
  const patch = {};
  const g = p.general || {};
  if (g.description != null && String(g.description).trim()) {
    /* descripción solo en JSON; no hay columna dedicada */
  }
  if (g.whatsapp != null && String(g.whatsapp).trim()) {
    /* whatsapp en JSON; teléfono principal sigue en restaurants.phone */
  }
  const d = p.delivery_extra || {};
  if (d.contact_phone != null && String(d.contact_phone).trim()) {
    patch.phone = String(d.contact_phone).trim();
  }
  return patch;
}

function validateProfile(profile, restaurant = {}) {
  const errors = [];
  const ruc = String(profile?.general?.ruc ?? restaurant?.company_ruc ?? '').trim();
  if (ruc && !/^\d{11}$/.test(ruc)) errors.push('RUC debe tener 11 dígitos');
  const email = String(profile?.general?.email ?? restaurant?.email ?? '').trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Correo electrónico no válido');
  const w = Number(profile?.ticket?.paper_width_mm);
  if (Number.isFinite(w) && ![58, 80].includes(w)) errors.push('Ancho de ticket: use 58 o 80 mm');
  return errors;
}

/** Respuesta enriquecida para GET /restaurant */
function attachProfileToRestaurant(restaurant) {
  if (!restaurant) return restaurant;
  const profile = readStoredProfile();
  restaurant.profile = profile;
  restaurant.profile_effective = buildEffectiveSnapshot(restaurant, profile);
  return restaurant;
}

function buildEffectiveSnapshot(restaurant, profile) {
  const r = restaurant || {};
  const p = profile || defaultMiRestaurantProfile();
  return {
    display_name: String(r.name || r.billing_nombre_comercial || '').trim(),
    legal_name: String(r.legal_name || '').trim(),
    ruc: String(r.company_ruc || '').trim(),
    address: String(r.billing_emisor_direccion || r.address || '').trim(),
    phone: String(r.phone || '').trim(),
    email: String(r.email || '').trim(),
    logo: String(r.logo || '').trim(),
    tax_rate: Number(r.tax_rate ?? 18),
    currency: String(r.currency || 'PEN'),
    currency_symbol: String(r.currency_symbol || 'S/'),
    delivery: {
      enabled: Number(r.delivery_enabled) === 1,
      fee: Number(r.delivery_fee ?? 0),
      min_order: Number(r.delivery_min_order ?? 0),
      radius_km: Number(r.delivery_radius_km ?? 0),
      ...p.delivery_extra,
    },
    ticket: { ...p.ticket, logo_url: String(p.branding?.logo_ticket || r.logo || '').trim() },
    qr: p.qr,
    messages: p.messages,
    branding: {
      logo_main: String(r.logo || '').trim(),
      logo_ticket: String(p.branding?.logo_ticket || r.logo || '').trim(),
      favicon: String(p.branding?.favicon || '').trim(),
      qr_hero_image: String(p.branding?.qr_hero_image || '').trim(),
      encuesta_cover_image: String(p.branding?.encuesta_cover_image || '').trim(),
    },
    general_extras: p.general,
  };
}

function mergeProfileUpdate(incoming, { actorUserId = '', actorName = '', restaurant = null } = {}) {
  const current = readStoredProfile();
  const merged = deepMerge(current, incoming);
  const errors = validateProfile(merged, restaurant || {});
  if (errors.length) {
    const err = new Error(errors.join('. '));
    err.statusCode = 400;
    throw err;
  }
  return saveStoredProfile(merged, { actorUserId, actorName });
}

module.exports = {
  SETTINGS_KEY,
  defaultMiRestaurantProfile,
  readStoredProfile,
  saveStoredProfile,
  mergeProfileUpdate,
  attachProfileToRestaurant,
  buildEffectiveSnapshot,
  restaurantPatchFromProfile,
  validateProfile,
};
