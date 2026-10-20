const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, runSql, withTransaction, logAudit } = require('./database');

const SETTINGS_KEY = 'git_cards';
const CARD_STYLES = {
  vinyl: { bg: '#0c0c0c', text: '#f6ead2', accent: '#f5b942', muted: '#7dd3fc', label: 'Vinilo', family: 'vinyl' },
  brew: { bg: '#2a1a10', text: '#f3e6c8', accent: '#f5c16c', muted: '#c4a574', label: 'Cervecería', family: 'brew' },
  ink: { bg: '#f4efe6', text: '#3a2a22', accent: '#1e3a5f', muted: '#6b5344', label: 'Tinta', family: 'ink' },
  sakura: { bg: '#e7d3a1', text: '#3f2a1c', accent: '#e7a0b4', muted: '#8a6a4a', label: 'Sakura', family: 'sakura' },
  gauge: { bg: '#14080a', text: '#fecaca', accent: '#ff2d2d', muted: '#7f1d1d', label: 'Motor', family: 'gauge' },
  copper: { bg: '#1a120c', text: '#f3d2b3', accent: '#c9845a', muted: '#8a6248', label: 'Cobre', family: 'copper' },
  prestige: { bg: '#d7dde6', text: '#1f2937', accent: '#94a3b8', muted: '#64748b', label: 'Prestigio', family: 'prestige' },
  neon: { bg: '#070816', text: '#e0f2fe', accent: '#22d3ee', muted: '#f472b6', label: 'Neón', family: 'neon' },
  pearl: { bg: '#f4f1f6', text: '#4b5563', accent: '#c4b5fd', muted: '#9ca3af', label: 'Nácar', family: 'pearl' },
  steel: { bg: '#c5c8ce', text: '#1f2937', accent: '#f8fafc', muted: '#64748b', label: 'Acero', family: 'steel' },
  plata: { bg: '#d5d8de', text: '#111827', accent: '#f8fafc', muted: '#6b7280', label: 'Plata', family: 'plata' },
  marfil: { bg: '#f7f7f8', text: '#374151', accent: '#ffffff', muted: '#9ca3af', label: 'Marfil', family: 'marfil' },
  botanica: { bg: '#0f7a4a', text: '#ecfdf5', accent: '#bbf7d0', muted: '#166534', label: 'Botánica', family: 'botanica' },
  gourmet: { bg: '#0c0c0c', text: '#f8f1e3', accent: '#e4c27a', muted: '#a8a29e', label: 'Gourmet', family: 'gourmet' },
  oro: { bg: '#f6f1e7', text: '#3f3428', accent: '#d4a24c', muted: '#a89070', label: 'Oro', family: 'oro' },
  olas: { bg: '#1578d4', text: '#f0f9ff', accent: '#e0f2fe', muted: '#075985', label: 'Olas', family: 'olas' },
  blue: { bg: '#1e4b8e', text: '#f8fafc', accent: '#93c5fd', muted: '#bfdbfe', label: 'Azul', family: 'classic' },
  green: { bg: '#166534', text: '#ecfdf5', accent: '#86efac', muted: '#6ee7b7', label: 'Verde', family: 'classic' },
  wine: { bg: '#4a1c2a', text: '#fde8e8', accent: '#f5c6aa', muted: '#d4a5a5', label: 'Vino', family: 'classic' },
  cream: { bg: '#f5efe3', text: '#3f2e1f', accent: '#b45309', muted: '#8b7355', label: 'Crema', family: 'classic' },
  forest: { bg: '#14332a', text: '#ecfdf5', accent: '#86efac', muted: '#6b9b88', label: 'Bosque', family: 'classic' },
  night: { bg: '#111827', text: '#f8fafc', accent: '#f5d76e', muted: '#94a3b8', label: 'Noche', family: 'classic' },
};

const RETIRED_STYLE_IDS = new Set(['vinyl', 'brew', 'ink', 'sakura', 'gauge', 'copper']);

function designStyleIds() {
  return Object.keys(CARD_STYLES).filter((id) => CARD_STYLES[id].family !== 'classic' && !RETIRED_STYLE_IDS.has(id));
}

function randomDesignStyleId() {
  const ids = designStyleIds();
  return ids[Math.floor(Math.random() * ids.length)] || 'gourmet';
}

const DEFAULT_CONFIG = {
  enabled: true,
  /** Interruptor de restaurante: oculta el módulo en encuesta, Clientes y Caja sin borrar la promoción. */
  module_enabled: true,
  program_name: 'GIT Cards',
  restaurant_name: '',
  logo_url: '',
  card_style: 'blue',
  card_bg: '',
  card_text: '',
  card_accent: '',
  reward_title: 'Recompensa GIT Cards',
  reward_description: 'Al completar la tarjeta recibe la recompensa configurada.',
  info_text: 'Cada compra cobrada que alcance el consumo mínimo suma un avance.',
  min_spend: 250,
  goal: 3,
  survey_required: false,
  notify_push: false,
  program_expires_at: '',
  reward_valid_days: 30,
  cycle_valid_days: 90,
  auto_reset: true,
};

let tablesReady = false;

function nowIso() {
  return new Date().toISOString();
}

function sqliteNowPlusDays(days) {
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0) return '';
  const d = new Date(Date.now() + n * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

function parseJson(raw, fallback) {
  try {
    if (raw == null || raw === '') return fallback;
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function isEligibleAmount(amount, minSpend) {
  const value = Number(amount);
  const min = Number(minSpend);
  if (!Number.isFinite(value) || !Number.isFinite(min)) return false;
  return value + 1e-9 >= min;
}

function normalizeConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const styleKey = CARD_STYLES[src.card_style] ? src.card_style : 'blue';
  const style = CARD_STYLES[styleKey];
  const minSpend = Number(src.min_spend);
  const goal = Number(src.goal);
  const rewardDays = Number(src.reward_valid_days);
  const cycleDays = Number(src.cycle_valid_days);
  return {
    enabled: src.enabled !== false,
    module_enabled: src.module_enabled !== false,
    program_name: String(src.program_name || DEFAULT_CONFIG.program_name).trim() || 'GIT Cards',
    restaurant_name: String(src.restaurant_name || '').trim(),
    logo_url: String(src.logo_url || '').trim(),
    card_style: styleKey,
    card_bg: String(src.card_bg || '').trim() || style.bg,
    card_text: String(src.card_text || '').trim() || style.text,
    card_accent: String(src.card_accent || '').trim() || style.accent,
    reward_title: String(src.reward_title || '').trim(),
    reward_description: String(src.reward_description || '').trim(),
    info_text: String(src.info_text || '').trim(),
    min_spend: Number.isFinite(minSpend) ? minSpend : DEFAULT_CONFIG.min_spend,
    goal: Number.isFinite(goal) ? Math.trunc(goal) : DEFAULT_CONFIG.goal,
    survey_required: src.survey_required === true || src.survey_required === 1 || src.survey_required === '1',
    notify_push: src.notify_push === true || src.notify_push === 1 || src.notify_push === '1',
    program_expires_at: String(src.program_expires_at || '').trim(),
    reward_valid_days: Number.isFinite(rewardDays) ? Math.max(0, Math.trunc(rewardDays)) : DEFAULT_CONFIG.reward_valid_days,
    cycle_valid_days: Number.isFinite(cycleDays) ? Math.max(0, Math.trunc(cycleDays)) : DEFAULT_CONFIG.cycle_valid_days,
    auto_reset: src.auto_reset !== false,
  };
}

function validateConfig(config) {
  const errors = [];
  if (!Number.isFinite(config.min_spend) || config.min_spend < 0) {
    errors.push('El consumo mínimo debe ser un número válido y no negativo.');
  }
  if (!Number.isInteger(config.goal) || config.goal < 1) {
    errors.push('La meta de avances debe ser un entero positivo.');
  }
  if (config.enabled && !String(config.reward_title || '').trim()) {
    errors.push('La recompensa debe estar definida cuando el programa está activo.');
  }
  if (config.program_expires_at) {
    const exp = Date.parse(config.program_expires_at);
    if (!Number.isFinite(exp)) errors.push('La fecha de vigencia del programa no es válida.');
  }
  if (!Number.isFinite(config.reward_valid_days) || config.reward_valid_days < 0) {
    errors.push('Los días de vigencia de la recompensa no son válidos.');
  }
  if (!Number.isFinite(config.cycle_valid_days) || config.cycle_valid_days < 0) {
    errors.push('Los días de vigencia de la tarjeta no son válidos.');
  }
  if (!CARD_STYLES[config.card_style]) {
    errors.push('El estilo visual de la tarjeta no está permitido.');
  }
  return errors;
}

function ensureGitCardsTables() {
  if (tablesReady) {
    ensureLoyaltyBridgeTables();
    ensurePromotionsSchema();
    return;
  }
  runSql(`
    CREATE TABLE IF NOT EXISTS git_cards_cycles (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      restaurant_id TEXT DEFAULT '',
      goal INTEGER NOT NULL,
      min_spend REAL NOT NULL,
      started_at TEXT NOT NULL,
      expires_at TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      completed_at TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  runSql(`
    CREATE TABLE IF NOT EXISTS git_cards_advances (
      id TEXT PRIMARY KEY,
      cycle_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      restaurant_id TEXT DEFAULT '',
      order_id TEXT NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL,
      reject_reason TEXT DEFAULT '',
      decided_by TEXT DEFAULT '',
      decided_by_name TEXT DEFAULT '',
      decided_at TEXT DEFAULT '',
      survey_ok INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(order_id)
    )
  `);
  runSql(`
    CREATE TABLE IF NOT EXISTS git_cards_rewards (
      id TEXT PRIMARY KEY,
      cycle_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      restaurant_id TEXT DEFAULT '',
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      issued_at TEXT NOT NULL,
      expires_at TEXT DEFAULT '',
      redeemed_at TEXT DEFAULT '',
      redeemed_by TEXT DEFAULT '',
      redeemed_by_name TEXT DEFAULT '',
      UNIQUE(cycle_id)
    )
  `);
  runSql(`
    CREATE TABLE IF NOT EXISTS git_cards_events (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      restaurant_id TEXT DEFAULT '',
      cycle_id TEXT DEFAULT '',
      kind TEXT NOT NULL,
      detail TEXT DEFAULT '',
      order_id TEXT DEFAULT '',
      amount REAL DEFAULT 0,
      actor_id TEXT DEFAULT '',
      actor_name TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  runSql(`
    CREATE TABLE IF NOT EXISTS git_cards_access (
      customer_id TEXT PRIMARY KEY,
      restaurant_id TEXT DEFAULT '',
      token TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  runSql(`
    CREATE TABLE IF NOT EXISTS git_cards_surveys (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      restaurant_id TEXT DEFAULT '',
      completed_at TEXT NOT NULL,
      answers_json TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  runSql('CREATE INDEX IF NOT EXISTS idx_git_cards_cycles_customer ON git_cards_cycles(customer_id, status)');
  runSql('CREATE INDEX IF NOT EXISTS idx_git_cards_advances_cycle ON git_cards_advances(cycle_id, status)');
  runSql('CREATE INDEX IF NOT EXISTS idx_git_cards_advances_customer ON git_cards_advances(customer_id, status)');
  runSql('CREATE INDEX IF NOT EXISTS idx_git_cards_rewards_customer ON git_cards_rewards(customer_id, status)');
  runSql('CREATE INDEX IF NOT EXISTS idx_git_cards_events_customer ON git_cards_events(customer_id, created_at)');
  runSql('CREATE INDEX IF NOT EXISTS idx_git_cards_surveys_customer ON git_cards_surveys(customer_id, completed_at)');
  tablesReady = true;
  ensureLoyaltyBridgeTables();
  ensurePromotionsSchema();
}

function addGitColumn(sql) {
  try {
    runSql(sql);
  } catch (err) {
    if (!/duplicate column|already exists/i.test(String(err.message || err))) throw err;
  }
}

function ensurePromotionsSchema() {
  runSql(`
    CREATE TABLE IF NOT EXISTS git_cards_promotions (
      id TEXT PRIMARY KEY,
      restaurant_id TEXT DEFAULT '',
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      start_at TEXT DEFAULT '',
      end_at TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      min_spend REAL NOT NULL DEFAULT 0,
      goal INTEGER NOT NULL DEFAULT 3,
      survey_required INTEGER DEFAULT 0,
      cycle_valid_days INTEGER DEFAULT 90,
      reward_valid_days INTEGER DEFAULT 30,
      auto_reset INTEGER DEFAULT 1,
      reward_kind TEXT NOT NULL DEFAULT 'other',
      reward_title TEXT DEFAULT '',
      reward_description TEXT DEFAULT '',
      product_id TEXT DEFAULT '',
      product_name TEXT DEFAULT '',
      product_qty REAL DEFAULT 1,
      variant_id TEXT DEFAULT '',
      variant_name TEXT DEFAULT '',
      discount_type TEXT DEFAULT '',
      discount_value REAL DEFAULT 0,
      discount_min_spend REAL DEFAULT 0,
      discount_max REAL DEFAULT 0,
      discount_conditions TEXT DEFAULT '',
      other_name TEXT DEFAULT '',
      other_description TEXT DEFAULT '',
      other_conditions TEXT DEFAULT '',
      other_delivery TEXT DEFAULT '',
      card_style TEXT DEFAULT 'blue',
      card_bg TEXT DEFAULT '',
      card_text TEXT DEFAULT '',
      card_accent TEXT DEFAULT '',
      logo_url TEXT DEFAULT '',
      info_text TEXT DEFAULT '',
      restaurant_name TEXT DEFAULT '',
      notify_push INTEGER DEFAULT 0,
      archived INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  addGitColumn("ALTER TABLE git_cards_cycles ADD COLUMN promotion_id TEXT DEFAULT ''");
  addGitColumn("ALTER TABLE git_cards_cycles ADD COLUMN card_style TEXT DEFAULT ''");
  addGitColumn("ALTER TABLE git_cards_cycles ADD COLUMN card_bg TEXT DEFAULT ''");
  addGitColumn("ALTER TABLE git_cards_cycles ADD COLUMN card_text TEXT DEFAULT ''");
  addGitColumn("ALTER TABLE git_cards_cycles ADD COLUMN card_accent TEXT DEFAULT ''");
  addGitColumn("ALTER TABLE git_cards_cycles ADD COLUMN program_name TEXT DEFAULT ''");
  addGitColumn("ALTER TABLE git_cards_cycles ADD COLUMN info_text TEXT DEFAULT ''");
  addGitColumn("ALTER TABLE git_cards_cycles ADD COLUMN reward_title TEXT DEFAULT ''");
  addGitColumn("ALTER TABLE git_cards_rewards ADD COLUMN promotion_id TEXT DEFAULT ''");
  addGitColumn("ALTER TABLE git_cards_rewards ADD COLUMN reward_kind TEXT DEFAULT ''");
  addGitColumn("ALTER TABLE git_cards_rewards ADD COLUMN product_id TEXT DEFAULT ''");
  addGitColumn("ALTER TABLE git_cards_rewards ADD COLUMN product_qty REAL DEFAULT 1");
  addGitColumn("ALTER TABLE git_cards_rewards ADD COLUMN discount_type TEXT DEFAULT ''");
  addGitColumn("ALTER TABLE git_cards_rewards ADD COLUMN discount_value REAL DEFAULT 0");
  addGitColumn("ALTER TABLE git_cards_rewards ADD COLUMN discount_min_spend REAL DEFAULT 0");
  addGitColumn("ALTER TABLE git_cards_rewards ADD COLUMN discount_max REAL DEFAULT 0");
  addGitColumn("ALTER TABLE git_cards_rewards ADD COLUMN inventory_applied INTEGER DEFAULT 0");
  addGitColumn("ALTER TABLE git_cards_rewards ADD COLUMN applied_order_id TEXT DEFAULT ''");
  addGitColumn("ALTER TABLE git_cards_advances ADD COLUMN promotion_id TEXT DEFAULT ''");
  migrateLegacyPromotion();
}

function migrateLegacyPromotion() {
  const existing = queryOne('SELECT id FROM git_cards_promotions LIMIT 1');
  if (existing) return;
  const restaurant = currentRestaurant();
  const stored = queryOne('SELECT value FROM app_settings WHERE key = ?', [SETTINGS_KEY]);
  const cfg = normalizeConfig(parseJson(stored?.value, {}));
  const id = uuidv4();
  const style = CARD_STYLES[cfg.card_style] || CARD_STYLES.blue;
  runSql(
    `INSERT INTO git_cards_promotions (
      id, restaurant_id, name, description, start_at, end_at, status,
      min_spend, goal, survey_required, cycle_valid_days, reward_valid_days, auto_reset,
      reward_kind, reward_title, reward_description, other_name, other_description,
      card_style, card_bg, card_text, card_accent, logo_url, info_text, restaurant_name, notify_push
    ) VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, 'other', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      String(restaurant.id || ''),
      cfg.program_name || 'GIT Cards',
      cfg.info_text || '',
      cfg.program_expires_at || '',
      cfg.enabled === false ? 'paused' : 'active',
      cfg.min_spend,
      cfg.goal,
      cfg.survey_required ? 1 : 0,
      cfg.cycle_valid_days,
      cfg.reward_valid_days,
      cfg.auto_reset ? 1 : 0,
      cfg.reward_title,
      cfg.reward_description,
      cfg.reward_title,
      cfg.reward_description,
      cfg.card_style,
      cfg.card_bg || style.bg,
      cfg.card_text || style.text,
      cfg.card_accent || style.accent,
      cfg.logo_url,
      cfg.info_text,
      cfg.restaurant_name || String(restaurant.name || ''),
      cfg.notify_push ? 1 : 0,
    ],
  );
  runSql("UPDATE git_cards_cycles SET promotion_id = ? WHERE IFNULL(promotion_id, '') = ''", [id]);
  runSql("UPDATE git_cards_rewards SET promotion_id = ? WHERE IFNULL(promotion_id, '') = ''", [id]);
  runSql("UPDATE git_cards_advances SET promotion_id = ? WHERE IFNULL(promotion_id, '') = ''", [id]);
  runSql(
    `UPDATE git_cards_cycles
     SET card_style = COALESCE(NULLIF(card_style, ''), ?),
         card_bg = COALESCE(NULLIF(card_bg, ''), ?),
         card_text = COALESCE(NULLIF(card_text, ''), ?),
         card_accent = COALESCE(NULLIF(card_accent, ''), ?),
         program_name = COALESCE(NULLIF(program_name, ''), ?),
         info_text = COALESCE(NULLIF(info_text, ''), ?),
         reward_title = COALESCE(NULLIF(reward_title, ''), ?)
     WHERE promotion_id = ?`,
    [cfg.card_style, cfg.card_bg || style.bg, cfg.card_text || style.text, cfg.card_accent || style.accent, cfg.program_name, cfg.info_text, cfg.reward_title, id],
  );
}

function ensureLoyaltyBridgeTables() {
  runSql(`
    CREATE TABLE IF NOT EXISTS git_cards_loyalty_sessions (
      token TEXT PRIMARY KEY,
      survey_id TEXT DEFAULT '',
      customer_id TEXT DEFAULT '',
      restaurant_id TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  try {
    runSql("ALTER TABLE git_cards_surveys ADD COLUMN loyalty_survey_id TEXT DEFAULT ''");
  } catch (err) {
    if (!/duplicate column|already exists/i.test(String(err.message || err))) {
      console.warn('[git-cards] loyalty_survey_id:', err.message || err);
    }
  }
  try {
    runSql("CREATE UNIQUE INDEX IF NOT EXISTS idx_git_cards_surveys_loyalty ON git_cards_surveys(loyalty_survey_id) WHERE IFNULL(loyalty_survey_id, '') != ''");
  } catch (_) {
    /* noop */
  }
}

function currentRestaurant() {
  return queryOne('SELECT id, name, logo FROM restaurants LIMIT 1') || {};
}

function currentRestaurantId() {
  return String(currentRestaurant().id || '').trim();
}

function assertRestaurant(rowRestaurantId) {
  const current = currentRestaurantId();
  const row = String(rowRestaurantId || '').trim();
  if (current && row && current !== row) {
    const err = new Error('No autorizado para este restaurante');
    err.status = 403;
    throw err;
  }
}

function readStoredGitCardsSettings() {
  const row = queryOne('SELECT value FROM app_settings WHERE key = ?', [SETTINGS_KEY]);
  return parseJson(row?.value, {});
}

function getConfig() {
  ensureGitCardsTables();
  const restaurant = currentRestaurant();
  const storedRaw = readStoredGitCardsSettings();
  const moduleEnabled = storedRaw.module_enabled !== false;
  const promo = getPrimaryPromotion();
  if (promo) {
    const cfg = promotionToConfig(promo);
    cfg.module_enabled = moduleEnabled;
    if (!cfg.restaurant_name) cfg.restaurant_name = String(restaurant.name || '').trim();
    if (!cfg.logo_url) cfg.logo_url = String(restaurant.logo || '').trim();
    return cfg;
  }
  const stored = normalizeConfig(storedRaw);
  stored.module_enabled = moduleEnabled;
  if (!stored.restaurant_name) stored.restaurant_name = String(restaurant.name || '').trim();
  if (!stored.logo_url) stored.logo_url = String(restaurant.logo || '').trim();
  return stored;
}

function saveConfig(raw, actor = {}) {
  ensureGitCardsTables();
  const next = normalizeConfig({ ...getConfig(), ...raw });
  const errors = validateConfig(next);
  if (errors.length) {
    const err = new Error(errors.join(' '));
    err.status = 400;
    err.errors = errors;
    throw err;
  }
  const previous = queryOne('SELECT value FROM app_settings WHERE key = ?', [SETTINGS_KEY]);
  runSql(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [SETTINGS_KEY, JSON.stringify(next)],
  );
  logAudit({
    actorUserId: actor.id || '',
    actorName: actor.full_name || actor.username || '',
    action: 'git_cards.config_update',
    resourceType: 'git_cards',
    resourceId: SETTINGS_KEY,
    details: { before: parseJson(previous?.value, {}), after: next },
  });
  syncPrimaryPromotionFromConfig(next);
  return next;
}

function refreshPromotionStatuses() {
  const now = Date.now();
  const rows = queryAll("SELECT * FROM git_cards_promotions WHERE archived = 0") || [];
  rows.forEach((row) => {
    const start = row.start_at ? Date.parse(row.start_at) : NaN;
    const end = row.end_at ? Date.parse(row.end_at) : NaN;
    if (row.status === 'scheduled' && Number.isFinite(start) && now >= start && (!Number.isFinite(end) || now <= end)) {
      runSql("UPDATE git_cards_promotions SET status = 'active', updated_at = datetime('now') WHERE id = ? AND status = 'scheduled'", [row.id]);
    }
    if (row.status === 'active' && Number.isFinite(end) && now > end) {
      runSql("UPDATE git_cards_promotions SET status = 'ended', updated_at = datetime('now') WHERE id = ? AND status = 'active'", [row.id]);
    }
  });
}

function getPromotion(id) {
  if (!id) return null;
  return queryOne('SELECT * FROM git_cards_promotions WHERE id = ?', [id]);
}

function getPrimaryPromotion() {
  ensurePromotionsSchema();
  refreshPromotionStatuses();
  const restaurantId = currentRestaurantId();
  return queryOne(
    `SELECT * FROM git_cards_promotions
     WHERE archived = 0 AND (IFNULL(restaurant_id, '') IN ('', ?))
       AND status = 'active'
     ORDER BY datetime(created_at) DESC LIMIT 1`,
    [restaurantId],
  ) || queryOne(
    `SELECT * FROM git_cards_promotions
     WHERE archived = 0 AND (IFNULL(restaurant_id, '') IN ('', ?))
     ORDER BY datetime(created_at) ASC LIMIT 1`,
    [restaurantId],
  );
}

function promotionToConfig(promo) {
  if (!promo) return normalizeConfig({});
  const cfg = normalizeConfig({
    enabled: promo.status === 'active',
    program_name: promo.name,
    restaurant_name: promo.restaurant_name,
    logo_url: promo.logo_url,
    card_style: promo.card_style,
    card_bg: promo.card_bg,
    card_text: promo.card_text,
    card_accent: promo.card_accent,
    reward_title: promo.reward_title || promo.other_name || promo.product_name,
    reward_description: promo.reward_description || promo.other_description,
    info_text: promo.info_text || promo.description,
    min_spend: promo.min_spend,
    goal: promo.goal,
    survey_required: promo.survey_required,
    notify_push: promo.notify_push,
    program_expires_at: promo.end_at,
    reward_valid_days: promo.reward_valid_days,
    cycle_valid_days: promo.cycle_valid_days,
    auto_reset: promo.auto_reset,
  });
  cfg.promotion_id = promo.id;
  return cfg;
}

function promotionAcceptsAdvances(promo) {
  if (!promo || promo.archived) return false;
  if (promo.status !== 'active') return false;
  const now = Date.now();
  if (promo.start_at && Date.parse(promo.start_at) > now) return false;
  if (promo.end_at && Date.parse(promo.end_at) < now) return false;
  return true;
}

function syncPrimaryPromotionFromConfig(config) {
  const promo = getPrimaryPromotion();
  if (!promo) return;
  const style = CARD_STYLES[config.card_style] || CARD_STYLES.blue;
  runSql(
    `UPDATE git_cards_promotions SET
      name = ?, description = ?, end_at = ?, status = CASE WHEN status IN ('draft', 'ended', 'paused') AND ? = 0 THEN status WHEN ? = 0 THEN 'paused' ELSE 'active' END,
      min_spend = ?, goal = ?, survey_required = ?, cycle_valid_days = ?, reward_valid_days = ?, auto_reset = ?,
      reward_title = ?, reward_description = ?, card_style = ?, card_bg = ?, card_text = ?, card_accent = ?,
      logo_url = ?, info_text = ?, restaurant_name = ?, notify_push = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [
      config.program_name,
      config.info_text,
      config.program_expires_at || '',
      config.enabled ? 1 : 0,
      config.enabled ? 1 : 0,
      config.min_spend,
      config.goal,
      config.survey_required ? 1 : 0,
      config.cycle_valid_days,
      config.reward_valid_days,
      config.auto_reset ? 1 : 0,
      config.reward_title,
      config.reward_description,
      config.card_style,
      config.card_bg || style.bg,
      config.card_text || style.text,
      config.card_accent || style.accent,
      config.logo_url,
      config.info_text,
      config.restaurant_name,
      config.notify_push ? 1 : 0,
      promo.id,
    ],
  );
}

function insertEvent(txOrNull, payload) {
  const sql = `INSERT INTO git_cards_events
    (id, customer_id, restaurant_id, cycle_id, kind, detail, order_id, amount, actor_id, actor_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const params = [
    uuidv4(),
    payload.customer_id,
    payload.restaurant_id || currentRestaurantId(),
    payload.cycle_id || '',
    payload.kind,
    payload.detail || '',
    payload.order_id || '',
    Number(payload.amount || 0),
    payload.actor_id || '',
    payload.actor_name || '',
  ];
  if (txOrNull) txOrNull.run(sql, params);
  else runSql(sql, params);
}

function programIsOpen(config = getConfig()) {
  if (config.module_enabled === false) return false;
  if (!config.enabled) return false;
  if (!config.program_expires_at) return true;
  const exp = Date.parse(config.program_expires_at);
  return Number.isFinite(exp) ? Date.now() <= exp : true;
}

function maskDoc(value) {
  const s = String(value || '').replace(/\s/g, '');
  if (!s) return '';
  if (s.length <= 3) return '***';
  return `${'*'.repeat(s.length - 3)}${s.slice(-3)}`;
}

function getOrCreateAccess(customerId) {
  ensureGitCardsTables();
  const existing = queryOne('SELECT * FROM git_cards_access WHERE customer_id = ?', [customerId]);
  if (existing) {
    assertRestaurant(existing.restaurant_id);
    return existing;
  }
  const token = crypto.randomBytes(24).toString('hex');
  const restaurantId = currentRestaurantId();
  runSql(
    'INSERT INTO git_cards_access (customer_id, restaurant_id, token) VALUES (?, ?, ?)',
    [customerId, restaurantId, token],
  );
  return queryOne('SELECT * FROM git_cards_access WHERE customer_id = ?', [customerId]);
}

function findAccessByToken(token) {
  ensureGitCardsTables();
  const row = queryOne('SELECT * FROM git_cards_access WHERE token = ?', [String(token || '').trim()]);
  if (!row) return null;
  try {
    assertRestaurant(row.restaurant_id);
  } catch (_) {
    return null;
  }
  return row;
}

function customerHasSurvey(customer, order) {
  const customerId = String(customer?.id || '').trim();
  if (!customerId) return false;
  const when = order?.paid_at || order?.created_at || 'now';
  const tagged = queryOne(
    `SELECT id FROM git_cards_surveys
     WHERE customer_id = ?
       AND date(completed_at) = date(?)
     LIMIT 1`,
    [customerId, when],
  );
  if (tagged) return true;
  const linked = queryOne(
    `SELECT id FROM loyalty_surveys
     WHERE customer_id = ?
       AND date(created_at) = date(?)
     LIMIT 1`,
    [customerId, when],
  );
  if (linked) return true;
  const name = String(customer?.name || '').trim().toLowerCase();
  if (!name) return false;
  const survey = queryOne(
    `SELECT id FROM loyalty_surveys
     WHERE lower(trim(customer_name)) = ?
       AND date(created_at) = date(?)
     LIMIT 1`,
    [name, when],
  );
  return !!survey;
}

function recordSurvey(customerId, answers = {}) {
  ensureGitCardsTables();
  const restaurantId = currentRestaurantId();
  runSql(
    'INSERT INTO git_cards_surveys (id, customer_id, restaurant_id, completed_at, answers_json) VALUES (?, ?, ?, ?, ?)',
    [uuidv4(), customerId, restaurantId, nowIso(), JSON.stringify(answers || {})],
  );
  insertEvent(null, {
    customer_id: customerId,
    restaurant_id: restaurantId,
    kind: 'survey',
    detail: 'Encuesta GIT Cards completada',
  });
  return true;
}

function getActiveCycle(customerId) {
  return queryOne(
    `SELECT * FROM git_cards_cycles
     WHERE customer_id = ? AND status = 'active'
     ORDER BY datetime(started_at) DESC LIMIT 1`,
    [customerId],
  );
}

function createCycle(customerId, config = getConfig(), tx = null) {
  const id = uuidv4();
  const restaurantId = currentRestaurantId();
  const startedAt = nowIso();
  const expiresAt = sqliteNowPlusDays(config.cycle_valid_days);
  const promo = getPromotion(config.promotion_id) || getPrimaryPromotion();
  const style = CARD_STYLES[config.card_style] || CARD_STYLES.blue;
  const sql = `INSERT INTO git_cards_cycles
    (id, customer_id, restaurant_id, goal, min_spend, started_at, expires_at, status,
     promotion_id, card_style, card_bg, card_text, card_accent, program_name, info_text, reward_title)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)`;
  const params = [
    id, customerId, restaurantId, config.goal, config.min_spend, startedAt, expiresAt,
    promo?.id || '',
    config.card_style || promo?.card_style || 'blue',
    config.card_bg || style.bg,
    config.card_text || style.text,
    config.card_accent || style.accent,
    config.program_name || '',
    config.info_text || '',
    config.reward_title || '',
  ];
  if (tx) tx.run(sql, params);
  else runSql(sql, params);
  insertEvent(tx, {
    customer_id: customerId,
    restaurant_id: restaurantId,
    cycle_id: id,
    kind: 'cycle_started',
    detail: `Nuevo ciclo ${config.goal} avances · mínimo ${config.min_spend}`,
  });
  return id;
}

function getOrCreateActiveCycle(customerId, config = getConfig(), tx = null) {
  const existing = getActiveCycle(customerId);
  if (existing) return existing;
  const id = createCycle(customerId, config, tx);
  return queryOne('SELECT * FROM git_cards_cycles WHERE id = ?', [id]);
}

function expireIfNeeded(cycle) {
  if (!cycle || cycle.status !== 'active' || !cycle.expires_at) return cycle;
  if (Date.parse(cycle.expires_at) > Date.now()) return cycle;
  withTransaction((tx) => {
    const fresh = tx.queryOne('SELECT * FROM git_cards_cycles WHERE id = ?', [cycle.id]);
    if (!fresh || fresh.status !== 'active') return;
    tx.run("UPDATE git_cards_cycles SET status = 'expired' WHERE id = ? AND status = 'active'", [cycle.id]);
    insertEvent(tx, {
      customer_id: cycle.customer_id,
      restaurant_id: cycle.restaurant_id,
      cycle_id: cycle.id,
      kind: 'cycle_expired',
      detail: 'Tarjeta vencida',
    });
    const promo = getPromotion(cycle.promotion_id) || getPrimaryPromotion();
    const config = promo ? promotionToConfig(promo) : getConfig();
    if (config.auto_reset && promotionAcceptsAdvances(promo || { status: config.enabled ? 'active' : 'paused', end_at: config.program_expires_at }) && !getActiveCycle(cycle.customer_id)) {
      createCycle(cycle.customer_id, config, tx);
    }
  });
  return queryOne('SELECT * FROM git_cards_cycles WHERE id = ?', [cycle.id]);
}

function expireRewards() {
  const rows = queryAll(
    `SELECT * FROM git_cards_rewards
     WHERE status = 'available' AND IFNULL(expires_at, '') != '' AND datetime(expires_at) <= datetime('now')`,
  ) || [];
  rows.forEach((reward) => {
    withTransaction((tx) => {
      const fresh = tx.queryOne('SELECT * FROM git_cards_rewards WHERE id = ?', [reward.id]);
      if (!fresh || fresh.status !== 'available') return;
      tx.run("UPDATE git_cards_rewards SET status = 'expired' WHERE id = ? AND status = 'available'", [reward.id]);
      insertEvent(tx, {
        customer_id: reward.customer_id,
        restaurant_id: reward.restaurant_id,
        cycle_id: reward.cycle_id,
        kind: 'reward_expired',
        detail: `Recompensa vencida: ${reward.title}`,
      });
    });
  });
}

function processExpirations() {
  ensureGitCardsTables();
  refreshPromotionStatuses();
  expireRewards();
  const cycles = queryAll("SELECT * FROM git_cards_cycles WHERE status = 'active' AND IFNULL(expires_at, '') != ''") || [];
  cycles.forEach((cycle) => expireIfNeeded(cycle));
}

function countApproved(cycleId, tx = null) {
  const q = tx ? tx.queryOne.bind(tx) : queryOne;
  const row = q(
    "SELECT COUNT(*) as c FROM git_cards_advances WHERE cycle_id = ? AND status = 'approved'",
    [cycleId],
  );
  return Number(row?.c || 0);
}

function issueRewardIfNeeded(tx, cycle, config, actor = {}) {
  const existing = tx.queryOne('SELECT * FROM git_cards_rewards WHERE cycle_id = ?', [cycle.id]);
  if (existing) return existing;
  const id = uuidv4();
  const issuedAt = nowIso();
  const promo = getPromotion(cycle.promotion_id || config.promotion_id) || getPrimaryPromotion();
  const title = config.reward_title || promo?.reward_title || promo?.product_name || promo?.other_name || 'Recompensa GIT Cards';
  tx.run(
    `INSERT INTO git_cards_rewards
      (id, cycle_id, customer_id, restaurant_id, title, status, issued_at, expires_at,
       promotion_id, reward_kind, product_id, product_qty, discount_type, discount_value, discount_min_spend, discount_max, inventory_applied)
     VALUES (?, ?, ?, ?, ?, 'available', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      id,
      cycle.id,
      cycle.customer_id,
      cycle.restaurant_id || currentRestaurantId(),
      title,
      issuedAt,
      sqliteNowPlusDays(config.reward_valid_days),
      promo?.id || cycle.promotion_id || '',
      promo?.reward_kind || 'other',
      promo?.product_id || '',
      Number(promo?.product_qty || 1),
      promo?.discount_type || '',
      Number(promo?.discount_value || 0),
      Number(promo?.discount_min_spend || 0),
      Number(promo?.discount_max || 0),
    ],
  );
  insertEvent(tx, {
    customer_id: cycle.customer_id,
    restaurant_id: cycle.restaurant_id,
    cycle_id: cycle.id,
    kind: 'reward_issued',
    detail: `Recompensa emitida: ${config.reward_title}`,
    actor_id: actor.id || '',
    actor_name: actor.full_name || actor.username || '',
  });
  return tx.queryOne('SELECT * FROM git_cards_rewards WHERE id = ?', [id]);
}

function notifyStaff(kind, title, body) {
  const config = getConfig();
  if (!config.notify_push) return;
  try {
    const { sendPushToUser } = require('./services/webPushService');
    const users = queryAll(
      `SELECT id FROM users
       WHERE CAST(COALESCE(is_active, 1) AS INTEGER) = 1
         AND lower(trim(COALESCE(role, ''))) IN ('admin', 'cajero')`,
    ) || [];
    users.forEach((u) => {
      sendPushToUser(u.id, { title, body, tag: `git-cards-${kind}`, url: '/admin/clientes/git-cards', kind }).catch(() => {});
    });
  } catch (_) {
    /* la falta de push no bloquea GIT Cards */
  }
}

function completeApprovedCycleIfNeeded(tx, advance, actor = {}) {
  const cycle = tx.queryOne('SELECT * FROM git_cards_cycles WHERE id = ?', [advance.cycle_id]);
  const approved = countApproved(advance.cycle_id, tx);
  const goal = Number(cycle?.goal || getConfig().goal);
  if (!cycle || approved < goal || cycle.status !== 'active') {
    return { reward: null, completed: false };
  }
  tx.run(
    "UPDATE git_cards_cycles SET status = 'completed', completed_at = ? WHERE id = ? AND status = 'active'",
    [nowIso(), cycle.id],
  );
  const promo = getPromotion(cycle.promotion_id) || getPrimaryPromotion();
  const config = promo ? promotionToConfig(promo) : getConfig();
  const reward = issueRewardIfNeeded(tx, cycle, config, actor);
  if (config.auto_reset && promotionAcceptsAdvances(promo || { status: config.enabled ? 'active' : 'paused', end_at: config.program_expires_at })) {
    const stillActive = tx.queryOne(
      "SELECT id FROM git_cards_cycles WHERE customer_id = ? AND status = 'active' LIMIT 1",
      [advance.customer_id],
    );
    if (!stillActive) createCycle(advance.customer_id, config, tx);
  }
  return { reward, completed: true };
}

function isUniqueConstraintError(err) {
  const msg = String(err?.message || err || '');
  return /UNIQUE constraint failed|unique constraint/i.test(msg);
}

function considerPaidOrder(orderId, actor = {}) {
  ensureGitCardsTables();
  processExpirations();
  const order = queryOne('SELECT * FROM orders WHERE id = ?', [orderId]);
  if (!order) return { skipped: 'missing_order' };
  const customerId = String(order.customer_id || '').trim();
  if (!customerId) return { skipped: 'no_customer' };
  const cycleForRules = getActiveCycle(customerId);
  const promoForRules = getPromotion(cycleForRules?.promotion_id) || getPrimaryPromotion();
  const config = promoForRules ? promotionToConfig(promoForRules) : getConfig();
  if (config.module_enabled === false) {
    return { skipped: 'module_disabled' };
  }
  if (!config.enabled || !promotionAcceptsAdvances(promoForRules || { status: config.enabled ? 'active' : 'paused', end_at: config.program_expires_at })) {
    return { skipped: promoForRules?.status === 'paused' ? 'paused' : (config.enabled ? 'program_expired' : 'disabled') };
  }
  if (String(order.status || '') === 'cancelled') return { skipped: 'cancelled' };
  if (String(order.payment_status || '') !== 'paid') return { skipped: 'unpaid' };
  if (String(order.payment_method || '') === 'cortesia') return { skipped: 'cortesia' };
  try {
    assertRestaurant(order.restaurant_id);
  } catch (err) {
    return { skipped: 'restaurant' };
  }

  const existing = queryOne('SELECT * FROM git_cards_advances WHERE order_id = ?', [order.id]);
  if (existing) {
    if (existing.status === 'pending') {
      try {
        const decided = decideAdvance(existing.id, 'approve', '', actor);
        return {
          approved: true,
          recovered: true,
          advance: decided.advance || existing,
          reward: decided.reward || null,
          completed: !!decided.completed,
        };
      } catch (err) {
        return { skipped: 'already', advance: existing, error: err.message };
      }
    }
    return { skipped: 'already', advance: existing };
  }

  const amount = round2(order.total);
  if (!isEligibleAmount(amount, config.min_spend)) {
    insertEvent(null, {
      customer_id: customerId,
      restaurant_id: order.restaurant_id || currentRestaurantId(),
      kind: 'ineligible',
      detail: `Compra ${amount} no alcanza el mínimo ${config.min_spend}`,
      order_id: order.id,
      amount,
    });
    return { skipped: 'min_spend', amount, min_spend: config.min_spend };
  }

  const customer = queryOne('SELECT id, name FROM customers WHERE id = ?', [customerId]);
  if (!customer) return { skipped: 'missing_customer' };
  const surveyOk = !config.survey_required || customerHasSurvey(customer, order);
  if (!surveyOk) {
    insertEvent(null, {
      customer_id: customerId,
      restaurant_id: order.restaurant_id || currentRestaurantId(),
      kind: 'survey_required',
      detail: 'La encuesta es obligatoria y no está completa',
      order_id: order.id,
      amount,
    });
    return { skipped: 'survey' };
  }

  const activeCycle = getActiveCycle(customerId);
  if (!activeCycle) return { skipped: 'no_active_card' };
  try {
    assertRestaurant(activeCycle.restaurant_id);
  } catch (err) {
    return { skipped: 'restaurant' };
  }

  let created = null;
  let completed = false;
  let reward = null;
  try {
    withTransaction((tx) => {
      const again = tx.queryOne('SELECT * FROM git_cards_advances WHERE order_id = ?', [order.id]);
      if (again) {
        created = again;
        return;
      }
      const cycle = tx.queryOne(
        `SELECT * FROM git_cards_cycles
         WHERE customer_id = ? AND status = 'active'
         ORDER BY datetime(started_at) DESC LIMIT 1`,
        [customerId],
      );
      if (!cycle) {
        created = { skipped: 'no_active_card' };
        return;
      }
      const id = uuidv4();
      const decidedAt = nowIso();
      tx.run(
        `INSERT INTO git_cards_advances
          (id, cycle_id, customer_id, restaurant_id, order_id, amount, status, survey_ok, decided_by, decided_by_name, decided_at, promotion_id)
         VALUES (?, ?, ?, ?, ?, ?, 'approved', 1, ?, ?, ?, ?)`,
        [
          id,
          cycle.id,
          customerId,
          cycle.restaurant_id || currentRestaurantId(),
          order.id,
          amount,
          actor.id || '',
          actor.full_name || actor.username || '',
          decidedAt,
          cycle.promotion_id || promoForRules?.id || '',
        ],
      );
      insertEvent(tx, {
        customer_id: customerId,
        restaurant_id: cycle.restaurant_id,
        cycle_id: cycle.id,
        kind: 'advance_approved',
        detail: `Avance automático · compra ${amount}`,
        order_id: order.id,
        amount,
        actor_id: actor.id || '',
        actor_name: actor.full_name || actor.username || '',
      });
      created = tx.queryOne('SELECT * FROM git_cards_advances WHERE id = ?', [id]);
      const done = completeApprovedCycleIfNeeded(tx, created, actor);
      completed = !!done.completed;
      reward = done.reward || null;
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      const again = queryOne('SELECT * FROM git_cards_advances WHERE order_id = ?', [order.id]);
      return { skipped: 'already', advance: again };
    }
    throw err;
  }
  if (created?.skipped) return created;
  if (!created) return { skipped: 'already' };
  if (created.status !== 'approved') {
    return { skipped: 'already', advance: created };
  }
  if (completed) {
    notifyStaff('completed', 'GIT Cards: tarjeta completada', 'Se emitió una recompensa');
  }
  return { approved: true, advance: created, reward, completed };
}

function handleVoidedOrder(orderId, actor = {}) {
  ensureGitCardsTables();
  const advance = queryOne('SELECT * FROM git_cards_advances WHERE order_id = ?', [orderId]);
  if (!advance) return { skipped: 'no_advance' };
  if (advance.status === 'voided') return { skipped: 'already_voided' };
  withTransaction((tx) => {
    const fresh = tx.queryOne('SELECT * FROM git_cards_advances WHERE id = ?', [advance.id]);
    if (!fresh || fresh.status === 'voided') return;
    tx.run(
      "UPDATE git_cards_advances SET status = 'voided', decided_at = ?, decided_by = ?, decided_by_name = ? WHERE id = ?",
      [nowIso(), actor.id || '', actor.full_name || actor.username || '', advance.id],
    );
    insertEvent(tx, {
      customer_id: advance.customer_id,
      restaurant_id: advance.restaurant_id,
      cycle_id: advance.cycle_id,
      kind: 'advance_voided',
      detail: 'La compra asociada fue anulada o revertida',
      order_id: advance.order_id,
      amount: advance.amount,
      actor_id: actor.id || '',
      actor_name: actor.full_name || actor.username || '',
    });
    const reward = tx.queryOne(
      "SELECT * FROM git_cards_rewards WHERE cycle_id = ? AND status = 'available'",
      [advance.cycle_id],
    );
    if (fresh.status === 'approved' && reward) {
      const approvedLeft = Number(
        tx.queryOne(
          "SELECT COUNT(*) as c FROM git_cards_advances WHERE cycle_id = ? AND status = 'approved'",
          [advance.cycle_id],
        )?.c || 0,
      );
      const cycle = tx.queryOne('SELECT * FROM git_cards_cycles WHERE id = ?', [advance.cycle_id]);
      if (cycle && approvedLeft < Number(cycle.goal || 0)) {
        tx.run("UPDATE git_cards_rewards SET status = 'expired' WHERE id = ? AND status = 'available'", [reward.id]);
        tx.run(
          "UPDATE git_cards_cycles SET status = 'active', completed_at = '' WHERE id = ? AND status = 'completed'",
          [advance.cycle_id],
        );
        insertEvent(tx, {
          customer_id: advance.customer_id,
          restaurant_id: advance.restaurant_id,
          cycle_id: advance.cycle_id,
          kind: 'reward_retracted',
          detail: 'Recompensa retirada porque la compra aprobada fue anulada',
          order_id: advance.order_id,
        });
      }
    }
  });
  return { voided: true };
}

function decideAdvance(advanceId, decision, reason, actor = {}) {
  ensureGitCardsTables();
  const wanted = decision === 'reject' ? 'rejected' : 'approved';
  if (wanted === 'rejected' && String(reason || '').trim().length < 3) {
    const err = new Error('Indique el motivo del rechazo (mínimo 3 caracteres).');
    err.status = 400;
    throw err;
  }

  const result = withTransaction((tx) => {
    const advance = tx.queryOne('SELECT * FROM git_cards_advances WHERE id = ?', [advanceId]);
    if (!advance) {
      const err = new Error('Solicitud no encontrada');
      err.status = 404;
      throw err;
    }
    assertRestaurant(advance.restaurant_id);
    if (advance.status !== 'pending') {
      return { already: true, advance };
    }
    const order = tx.queryOne('SELECT * FROM orders WHERE id = ?', [advance.order_id]);
    if (wanted === 'approved') {
      if (!order || String(order.status || '') === 'cancelled' || String(order.payment_status || '') !== 'paid') {
        const err = new Error('No hay una venta pagada vigente vinculada a esta solicitud.');
        err.status = 400;
        throw err;
      }
      const config = getConfig();
      if (!isEligibleAmount(order.total, config.min_spend)) {
        const err = new Error('La venta ya no cumple el consumo mínimo configurado.');
        err.status = 400;
        throw err;
      }
    }
    tx.run(
      `UPDATE git_cards_advances
       SET status = ?, reject_reason = ?, decided_by = ?, decided_by_name = ?, decided_at = ?
       WHERE id = ? AND status = 'pending'`,
      [
        wanted,
        wanted === 'rejected' ? String(reason || '').trim() : '',
        actor.id || '',
        actor.full_name || actor.username || '',
        nowIso(),
        advance.id,
      ],
    );
    const updated = tx.queryOne('SELECT * FROM git_cards_advances WHERE id = ?', [advance.id]);
    insertEvent(tx, {
      customer_id: advance.customer_id,
      restaurant_id: advance.restaurant_id,
      cycle_id: advance.cycle_id,
      kind: wanted === 'approved' ? 'advance_approved' : 'advance_rejected',
      detail: wanted === 'approved'
        ? `Avance aprobado · compra ${advance.amount}`
        : `Avance rechazado: ${String(reason || '').trim()}`,
      order_id: advance.order_id,
      amount: advance.amount,
      actor_id: actor.id || '',
      actor_name: actor.full_name || actor.username || '',
    });

    let reward = null;
    let completed = false;
    if (wanted === 'approved') {
      const done = completeApprovedCycleIfNeeded(tx, updated, actor);
      reward = done.reward;
      completed = done.completed;
    }
    return { advance: updated, reward, completed };
  });

  if (result.already) return result;
  if (result.completed) {
    notifyStaff('completed', 'GIT Cards: tarjeta completada', 'Se emitió una recompensa');
  }
  return result;
}

function applyRewardInventoryTx(tx, reward, actor = {}) {
  if (String(reward.reward_kind || '') !== 'product') return { skipped: true, reason: 'no_product' };
  if (Number(reward.inventory_applied) === 1) return { skipped: true, reason: 'already' };
  const productId = String(reward.product_id || '').trim();
  if (!productId) return { skipped: true, reason: 'sin_producto' };
  const qty = Number(reward.product_qty || 1) || 1;
  const { salidaInsumosPorProducto } = require('./services/kardexInventoryService');
  const { deductNonTransformedStockTx } = require('./warehouseStock');
  salidaInsumosPorProducto(tx, {
    productId,
    quantity: qty,
    referencia: `GIT Cards canje ${reward.title || ''}`.trim(),
    referenciaId: reward.id,
    userId: actor.id || '',
    eventAt: nowIso(),
  });
  deductNonTransformedStockTx(tx, productId, qty);
  tx.run('UPDATE git_cards_rewards SET inventory_applied = 1 WHERE id = ?', [reward.id]);
  return { skipped: false };
}

function redeemReward(rewardId, actor = {}) {
  ensureGitCardsTables();
  return withTransaction((tx) => {
    const reward = tx.queryOne('SELECT * FROM git_cards_rewards WHERE id = ?', [rewardId]);
    if (!reward) {
      const err = new Error('Recompensa no encontrada');
      err.status = 404;
      throw err;
    }
    assertRestaurant(reward.restaurant_id);
    if (reward.status === 'used') {
      const err = new Error('Esta recompensa ya fue canjeada.');
      err.status = 409;
      throw err;
    }
    if (reward.status === 'expired') {
      const err = new Error('Esta recompensa está vencida.');
      err.status = 400;
      throw err;
    }
    if (reward.status !== 'available') {
      const err = new Error('La recompensa no está disponible.');
      err.status = 400;
      throw err;
    }
    if (reward.expires_at && Date.parse(reward.expires_at) <= Date.now()) {
      tx.run("UPDATE git_cards_rewards SET status = 'expired' WHERE id = ? AND status = 'available'", [reward.id]);
      const err = new Error('Esta recompensa está vencida.');
      err.status = 400;
      throw err;
    }
    tx.run(
      `UPDATE git_cards_rewards
       SET status = 'used', redeemed_at = ?, redeemed_by = ?, redeemed_by_name = ?
       WHERE id = ? AND status = 'available'`,
      [nowIso(), actor.id || '', actor.full_name || actor.username || '', reward.id],
    );
    const updated = tx.queryOne('SELECT * FROM git_cards_rewards WHERE id = ?', [reward.id]);
    if (!updated || updated.status !== 'used') {
      const err = new Error('Esta recompensa ya fue canjeada.');
      err.status = 409;
      throw err;
    }
    applyRewardInventoryTx(tx, updated, actor);
    insertEvent(tx, {
      customer_id: reward.customer_id,
      restaurant_id: reward.restaurant_id,
      cycle_id: reward.cycle_id,
      kind: 'reward_redeemed',
      detail: `Canje: ${reward.title}`,
      actor_id: actor.id || '',
      actor_name: actor.full_name || actor.username || '',
    });
    return tx.queryOne('SELECT * FROM git_cards_rewards WHERE id = ?', [reward.id]);
  });
}

function cycleProgress(cycle) {
  if (!cycle) {
    return { confirmed: 0, pending: 0, rejected: 0, goal: getConfig().goal, remaining: getConfig().goal };
  }
  const rows = queryAll('SELECT status, COUNT(*) as c FROM git_cards_advances WHERE cycle_id = ? GROUP BY status', [cycle.id]) || [];
  const counts = { approved: 0, pending: 0, rejected: 0, voided: 0 };
  rows.forEach((r) => { counts[r.status] = Number(r.c || 0); });
  const goal = Number(cycle.goal || 0);
  return {
    confirmed: counts.approved,
    pending: counts.pending,
    rejected: counts.rejected,
    voided: counts.voided,
    goal,
    remaining: Math.max(0, goal - counts.approved),
  };
}

function deriveStatus({ cycle, progress, rewards }) {
  const flags = [];
  const available = (rewards || []).filter((r) => r.status === 'available');
  const used = (rewards || []).filter((r) => r.status === 'used');
  const expiredRewards = (rewards || []).filter((r) => r.status === 'expired');
  if (!cycle) {
    if (used.length) flags.push('reward_used');
    return { status: used.length ? 'reward_used' : 'none', flags };
  }
  if (progress.pending > 0) flags.push('pending');
  if (available.length) flags.push('reward_available');
  if (used.length) flags.push('reward_used');
  if (cycle.status === 'expired') flags.push('expired');
  if (cycle.status === 'completed') flags.push('completed');
  if (cycle.status === 'active') flags.push('active');
  if (expiredRewards.length) flags.push('reward_expired');

  let status = 'active';
  if (available.length) status = 'reward_available';
  else if (progress.pending > 0) status = 'pending';
  else if (cycle.status === 'completed') status = 'completed';
  else if (cycle.status === 'expired') status = 'expired';
  else if (used.length && progress.confirmed === 0) status = 'reward_used';
  else if (cycle.status === 'active') status = 'active';
  return { status, flags };
}

function moneyLabel(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  return `S/ ${n.toFixed(2)}`;
}

function cardTerms(source) {
  const src = source && typeof source === 'object' ? source : {};
  const lines = [];
  const push = (label, value) => {
    const text = String(value || '').trim();
    if (text) lines.push({ label, value: text });
  };
  if (Number(src.min_spend) > 0) push('Consumo mínimo', moneyLabel(src.min_spend));
  if (Number(src.goal) > 0) push('Avances para completar', String(src.goal));
  push('Encuesta', src.survey_required ? 'Obligatoria' : 'No exigida');
  if (Number(src.cycle_valid_days) > 0) push('Vigencia de la tarjeta', `${src.cycle_valid_days} días`);
  if (Number(src.reward_valid_days) > 0) push('Vigencia de la recompensa', `${src.reward_valid_days} días`);
  push('Recompensa', src.reward_title || src.product_name || src.other_name || '');
  push('Detalle', src.reward_description || src.other_description || '');
  push('Condiciones', src.discount_conditions || src.other_conditions || '');
  push('Al completar la meta', src.auto_reset === false || src.auto_reset === 0 ? 'El ciclo no se reinicia' : 'El ciclo se reinicia');
  return lines;
}

function publicCardPayload(customer, extra = {}) {
  const config = getConfig();
  const cycle = extra.cycle || getActiveCycle(customer.id) || queryOne(
    `SELECT * FROM git_cards_cycles WHERE customer_id = ? ORDER BY datetime(started_at) DESC LIMIT 1`,
    [customer.id],
  );
  const promo = getPromotion(cycle?.promotion_id) || getPrimaryPromotion();
  const styleKey = cycle?.card_style || promo?.card_style || config.card_style;
  const style = CARD_STYLES[styleKey] || CARD_STYLES.blue;
  const progress = cycleProgress(cycle);
  const rewards = queryAll(
    `SELECT * FROM git_cards_rewards WHERE customer_id = ? ORDER BY datetime(issued_at) DESC`,
    [customer.id],
  ) || [];
  const { status, flags } = deriveStatus({ cycle, progress, rewards });
  const payload = {
    program_name: promo?.name || cycle?.program_name || config.program_name,
    restaurant_name: promo?.restaurant_name || config.restaurant_name,
    logo_url: promo?.logo_url || config.logo_url,
    info_text: promo?.info_text || cycle?.info_text || config.info_text,
    description: promo?.description || '',
    reward_title: (promo?.reward_kind === 'product'
      ? [promo.product_name || promo.reward_title, promo.variant_name].filter(Boolean).join(' · ')
      : '') || promo?.reward_title || cycle?.reward_title || config.reward_title,
    reward_description: promo?.reward_description || config.reward_description,
    terms: cardTerms(promo || config),
    card_style: promo?.card_style || styleKey,
    promotion_id: cycle?.promotion_id || promo?.id || '',
    colors: {
      bg: promo?.card_bg || cycle?.card_bg || config.card_bg || style.bg,
      text: promo?.card_text || cycle?.card_text || config.card_text || style.text,
      accent: promo?.card_accent || cycle?.card_accent || config.card_accent || style.accent,
      muted: style.muted,
    },
    customer: {
      id: customer.id,
      name: customer.name,
      phone: extra.includeContact ? (customer.phone || '') : '',
      doc_masked: maskDoc(customer.doc_number),
    },
    cycle: cycle ? {
      id: cycle.id,
      status: cycle.status,
      started_at: cycle.started_at,
      expires_at: cycle.expires_at,
      completed_at: cycle.completed_at,
    } : null,
    progress,
    status,
    status_flags: flags,
    current_reward: (sanitizedRewards(customer.id).find((r) => r.status === 'available')
      || sanitizedRewards(customer.id)[0]
      || null),
    rewards_public: sanitizedRewards(customer.id),
    next_step: '',
  };
  payload.next_step = publicGitHint(payload);
  return payload;
}

function listMembers({ q = '', status = 'all', page = 1, pageSize = 10 } = {}) {
  ensureGitCardsTables();
  processExpirations();
  const restaurantId = currentRestaurantId();
  const customers = queryAll(
    `SELECT c.id, c.name, c.email, c.phone, c.doc_type, c.doc_number, c.created_at
     FROM customers c
     WHERE c.id IN (
       SELECT customer_id FROM git_cards_cycles
       WHERE IFNULL(restaurant_id, '') IN ('', ?)
       UNION
       SELECT customer_id FROM git_cards_access
       WHERE IFNULL(restaurant_id, '') IN ('', ?)
     )
     ORDER BY datetime(c.created_at) DESC
     LIMIT 500`,
    [restaurantId, restaurantId],
  ) || [];
  const needle = String(q || '').trim();
  const needleLower = needle.toLowerCase();
  const needleDigits = needle.replace(/\D/g, '');
  const rows = customers.map((c) => {
    const cycle = getActiveCycle(c.id) || queryOne(
      `SELECT * FROM git_cards_cycles WHERE customer_id = ? ORDER BY datetime(started_at) DESC LIMIT 1`,
      [c.id],
    );
    const progress = cycleProgress(cycle);
    const rewards = queryAll(
      `SELECT * FROM git_cards_rewards WHERE customer_id = ? ORDER BY datetime(issued_at) DESC`,
      [c.id],
    ) || [];
    const lastEligible = queryOne(
      `SELECT created_at, amount, status FROM git_cards_advances
       WHERE customer_id = ? ORDER BY datetime(created_at) DESC LIMIT 1`,
      [c.id],
    );
    const derived = deriveStatus({ cycle, progress, rewards });
    return {
      customer_id: c.id,
      name: c.name,
      phone: c.phone || '',
      email: c.email || '',
      doc_masked: maskDoc(c.doc_number),
      enrolled_at: cycle?.started_at || '',
      status: derived.status,
      status_flags: derived.flags,
      progress,
      pending_count: progress.pending,
      rewards_available: rewards.filter((r) => r.status === 'available').length,
      last_activity: lastEligible?.created_at || '',
      last_amount: lastEligible ? Number(lastEligible.amount || 0) : 0,
      _doc: String(c.doc_number || ''),
    };
  }).filter((row) => {
    if (needleLower) {
      const hay = `${row.name} ${row.phone}`.toLowerCase();
      const docDigits = String(row._doc || '').replace(/\D/g, '');
      const matchesText = hay.includes(needleLower);
      const matchesDoc = needleDigits ? docDigits.includes(needleDigits) : false;
      if (!matchesText && !matchesDoc) return false;
    }
    if (status && status !== 'all') {
      if (status === 'none') return row.status === 'none';
      if (status === 'inactive') {
        return row.status !== 'none' && !(row.status_flags || []).includes('active');
      }
      return row.status === status || row.status_flags.includes(status);
    }
    return true;
  }).map((row) => {
    const { _doc, ...safe } = row;
    return safe;
  });
  const total = rows.length;
  const hasActiveCard = (row) => row.status === 'active' || (row.status_flags || []).includes('active');
  const counts = {
    registered: total,
    active_cards: rows.filter(hasActiveCard).length,
    inactive_cards: rows.filter((row) => !hasActiveCard(row)).length,
    near_complete: rows.filter((row) => {
      const goal = Number(row.progress?.goal || 0);
      const confirmed = Number(row.progress?.confirmed || 0);
      return hasActiveCard(row) && goal > 1 && confirmed === goal - 1;
    }).length,
  };
  const safePage = Math.max(1, Number(page) || 1);
  const size = Math.max(1, Math.min(50, Number(pageSize) || 10));
  const start = (safePage - 1) * size;
  return {
    total,
    page: safePage,
    page_size: size,
    rows: rows.slice(start, start + size),
    active_count: rows.filter((r) => r.status !== 'none').length,
    counts,
  };
}

function getMemberProfile(customerId) {
  ensureGitCardsTables();
  processExpirations();
  const customer = queryOne(
    'SELECT id, name, email, phone, doc_type, doc_number, created_at FROM customers WHERE id = ?',
    [customerId],
  );
  if (!customer) {
    const err = new Error('Cliente no encontrado');
    err.status = 404;
    throw err;
  }
  const cycles = queryAll(
    `SELECT * FROM git_cards_cycles WHERE customer_id = ? ORDER BY datetime(started_at) DESC`,
    [customerId],
  ) || [];
  const advances = queryAll(
    `SELECT a.*, o.order_number, o.total as order_total, o.payment_status, o.status as order_status
     FROM git_cards_advances a
     LEFT JOIN orders o ON o.id = a.order_id
     WHERE a.customer_id = ?
     ORDER BY datetime(a.created_at) DESC`,
    [customerId],
  ) || [];
  const rewards = queryAll(
    `SELECT * FROM git_cards_rewards WHERE customer_id = ? ORDER BY datetime(issued_at) DESC`,
    [customerId],
  ) || [];
  const events = queryAll(
    `SELECT * FROM git_cards_events WHERE customer_id = ? ORDER BY datetime(created_at) DESC LIMIT 80`,
    [customerId],
  ) || [];
  const access = getOrCreateAccess(customerId);
  const card = publicCardPayload(customer, { includeContact: true });
  const surveys = queryAll(
    `SELECT id, customer_name, rating, visit_date, visit_area, party_size, created_at
     FROM loyalty_surveys
     WHERE customer_id = ?
     ORDER BY datetime(created_at) DESC
     LIMIT 20`,
    [customerId],
  ) || [];
  return {
    customer: {
      id: customer.id,
      name: customer.name,
      phone: customer.phone || '',
      email: customer.email || '',
      doc_masked: maskDoc(customer.doc_number),
      created_at: customer.created_at,
    },
    card,
    cycles: cycles.map((cycle) => ({ ...cycle, progress: cycleProgress(cycle) })),
    advances,
    rewards,
    events,
    surveys,
    access: {
      token: access.token,
      path: `/git-cards/${access.token}`,
    },
  };
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function publicGitHint(card) {
  if (!card) return 'Complete su identificación para ver GIT Cards.';
  if (card.status === 'reward_available') {
    return 'Tiene una recompensa disponible. Solicite el canje en caja; no se canjea desde esta pantalla.';
  }
  if (card.status === 'pending') {
    return 'Hay una compra pendiente de validación. El progreso no aumenta hasta que Caja la apruebe.';
  }
  if (card.status === 'none' || !card.cycle) {
    return 'Su tarjeta quedó activada. Una compra elegible y aprobada sumará el primer avance.';
  }
  if (Number(card.progress?.remaining || 0) > 0) {
    return `Le faltan ${card.progress.remaining} avance(s) confirmado(s) para completar la tarjeta.`;
  }
  return 'Consulte con caja si necesita ayuda con su tarjeta.';
}

function publicAction(card) {
  if (!card) return 'register';
  if (card.status === 'reward_available') return 'reward';
  if (card.status === 'pending') return 'pending';
  return 'view';
}

function sanitizedRewards(customerId) {
  return (queryAll(
    `SELECT id, title, status, issued_at, expires_at, redeemed_at
     FROM git_cards_rewards WHERE customer_id = ? ORDER BY datetime(issued_at) DESC`,
    [customerId],
  ) || []).map((r) => ({
    title: r.title,
    status: r.status,
    issued_at: r.issued_at,
    expires_at: r.expires_at || '',
    redeemed_at: r.redeemed_at || '',
  }));
}

function normalizePersonName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function namesMatch(given, stored) {
  const givenTokens = normalizePersonName(given).split(' ').filter((t) => t.length > 1);
  const storedTokens = normalizePersonName(stored).split(' ').filter((t) => t.length > 1);
  if (!givenTokens.length || !storedTokens.length) return false;
  if (givenTokens[0] !== storedTokens[0]) return false;
  if (storedTokens.length >= 2) {
    return givenTokens.includes(storedTokens[storedTokens.length - 1]);
  }
  return true;
}

function customerHasGitCard(customerId) {
  if (!customerId) return false;
  const access = queryOne('SELECT customer_id FROM git_cards_access WHERE customer_id = ? LIMIT 1', [customerId]);
  if (access) return true;
  const cycle = queryOne('SELECT id FROM git_cards_cycles WHERE customer_id = ? LIMIT 1', [customerId]);
  return !!cycle;
}

const LOOKUP_MISS = 'No encontramos una GIT Card con esos datos. Verifique el nombre y el DNI.';

function lookupPublicGitCard({ name, doc_number }) {
  ensureGitCardsTables();
  processExpirations();
  const displayName = String(name || '').trim();
  const doc = String(doc_number || '').replace(/\D/g, '');
  if (displayName.length < 2 || doc.length < 8) {
    const err = new Error('Indique su nombre y DNI para consultar su tarjeta.');
    err.status = 400;
    throw err;
  }
  const customer = queryOne(
    "SELECT * FROM customers WHERE replace(IFNULL(doc_number,''), ' ', '') = ? LIMIT 1",
    [doc],
  );
  if (!customer || !namesMatch(displayName, customer.name) || !customerHasGitCard(customer.id)) {
    const err = new Error(LOOKUP_MISS);
    err.status = 404;
    throw err;
  }
  try {
    const access = queryOne('SELECT restaurant_id FROM git_cards_access WHERE customer_id = ? LIMIT 1', [customer.id]);
    const cycle = queryOne('SELECT restaurant_id FROM git_cards_cycles WHERE customer_id = ? LIMIT 1', [customer.id]);
    assertRestaurant(access?.restaurant_id || cycle?.restaurant_id);
  } catch (_) {
    const err = new Error(LOOKUP_MISS);
    err.status = 404;
    throw err;
  }
  const card = publicCardPayload(customer, { includeContact: false });
  return {
    linked: true,
    created_customer: false,
    program_name: card.program_name,
    restaurant_name: card.restaurant_name,
    card,
    rewards: sanitizedRewards(customer.id),
    next_step: card.next_step,
    action: publicAction(card),
  };
}

function findCustomerByIdentity({ phone, doc_number }) {
  const phoneN = normalizePhone(phone);
  const doc = String(doc_number || '').replace(/\D/g, '');
  let byPhone = null;
  let byDoc = null;
  if (phoneN.length >= 6) {
    const tail = phoneN.slice(-9);
    byPhone = queryOne(
      `SELECT * FROM customers
       WHERE replace(replace(replace(replace(IFNULL(phone,''), ' ', ''), '-', ''), '+', ''), '.', '') LIKE ?
       LIMIT 1`,
      [`%${tail}`],
    );
  }
  if (doc.length >= 8) {
    byDoc = queryOne('SELECT * FROM customers WHERE replace(IFNULL(doc_number,\'\'), \' \', \'\') = ? LIMIT 1', [doc]);
  }
  if (byPhone && byDoc && byPhone.id !== byDoc.id) {
    const err = new Error('El teléfono y el documento corresponden a clientes distintos. Verifique los datos.');
    err.status = 409;
    throw err;
  }
  return byPhone || byDoc || null;
}

function createPublicCustomer({ name, phone, doc_number, doc_type = '1' }) {
  const displayName = String(name || '').trim().replace(/\s+/g, ' ');
  if (displayName.length < 2) {
    const err = new Error('Indique su nombre para activar GIT Cards.');
    err.status = 400;
    throw err;
  }
  const phoneN = normalizePhone(phone);
  const doc = String(doc_number || '').replace(/\D/g, '');
  const email = doc
    ? `cliente.${doc}@local.resto`
    : `cliente.${phoneN || Date.now()}@local.resto`;
  const existingEmail = queryOne('SELECT id FROM customers WHERE email = ?', [email]);
  const nextEmail = existingEmail ? `cliente.${uuidv4().slice(0, 8)}@local.resto` : email;
  const id = uuidv4();
  runSql(
    'INSERT INTO customers (id, name, email, password_hash, phone, address, doc_type, doc_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, displayName, nextEmail, bcrypt.hashSync('cliente123', 10), phoneN, '', doc.length === 11 ? '6' : (doc_type || '1'), doc],
  );
  logAudit({
    actorUserId: '',
    actorName: 'fidelizacion-publica',
    action: 'customer.create_from_loyalty',
    resourceType: 'customer',
    resourceId: id,
    details: { phone: phoneN, doc_number: doc },
  });
  return queryOne('SELECT * FROM customers WHERE id = ?', [id]);
}

function attachLoyaltySurveyAsGitEvidence(customerId, surveyId) {
  if (!customerId || !surveyId) return null;
  const existing = queryOne('SELECT * FROM git_cards_surveys WHERE loyalty_survey_id = ?', [surveyId]);
  if (existing) return existing;
  const survey = queryOne('SELECT * FROM loyalty_surveys WHERE id = ?', [surveyId]);
  const id = uuidv4();
  runSql(
    `INSERT INTO git_cards_surveys (id, customer_id, restaurant_id, completed_at, answers_json, loyalty_survey_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      customerId,
      currentRestaurantId(),
      survey?.created_at || nowIso(),
      survey?.answers_json || '{}',
      surveyId,
    ],
  );
  insertEvent(null, {
    customer_id: customerId,
    restaurant_id: currentRestaurantId(),
    kind: 'survey_linked',
    detail: `Encuesta de fidelización vinculada (${surveyId.slice(0, 8)})`,
  });
  return queryOne('SELECT * FROM git_cards_surveys WHERE id = ?', [id]);
}

function createLoyaltyContinueSession(surveyId = '') {
  ensureGitCardsTables();
  const token = crypto.randomBytes(24).toString('hex');
  runSql(
    'INSERT INTO git_cards_loyalty_sessions (token, survey_id, customer_id, restaurant_id) VALUES (?, ?, ?, ?)',
    [token, String(surveyId || ''), '', currentRestaurantId()],
  );
  return token;
}

function getLoyaltySession(token) {
  ensureGitCardsTables();
  const session = queryOne('SELECT * FROM git_cards_loyalty_sessions WHERE token = ?', [String(token || '').trim()]);
  if (!session) return null;
  try {
    assertRestaurant(session.restaurant_id);
  } catch (_) {
    return null;
  }
  return session;
}

function buildLoyaltyContinuePayload(session, extras = {}) {
  processExpirations();
  const config = getConfig();
  const restaurant = currentRestaurant();
  const survey = session.survey_id
    ? queryOne('SELECT id, customer_name, created_at, customer_id FROM loyalty_surveys WHERE id = ?', [session.survey_id])
    : null;
  const customer = session.customer_id
    ? queryOne('SELECT id, name, phone, doc_number FROM customers WHERE id = ?', [session.customer_id])
    : null;
  const card = customer ? publicCardPayload(customer, { includeContact: false }) : null;
  return {
    linked: !!customer,
    created_customer: extras.created_customer === true,
    restaurant_name: config.restaurant_name || restaurant.name || 'Resto Fadey App',
    logo_url: config.logo_url || restaurant.logo || '',
    program_name: config.program_name,
    survey_required: config.survey_required,
    survey: survey ? {
      id: survey.id,
      customer_name: survey.customer_name,
      created_at: survey.created_at,
    } : null,
    card,
    rewards: customer ? sanitizedRewards(customer.id) : [],
    next_step: publicGitHint(card),
    action: publicAction(card),
  };
}

function readLoyaltyContinue(token) {
  const session = getLoyaltySession(token);
  if (!session) {
    const err = new Error('El enlace de continuación no es válido o expiró.');
    err.status = 404;
    throw err;
  }
  return buildLoyaltyContinuePayload(session);
}

function linkLoyaltyContinue(token, identity = {}) {
  const session = getLoyaltySession(token);
  if (!session) {
    const err = new Error('El enlace de continuación no es válido o expiró.');
    err.status = 404;
    throw err;
  }
  if (session.customer_id) {
    return buildLoyaltyContinuePayload(session, { created_customer: false });
  }
  const phone = normalizePhone(identity.phone);
  const doc = String(identity.doc_number || '').replace(/\D/g, '');
  if (phone.length < 6 && doc.length < 8) {
    const err = new Error('Indique su teléfono o documento para verificar su identidad.');
    err.status = 400;
    throw err;
  }
  let customer = findCustomerByIdentity({ phone, doc_number: doc });
  let created = false;
  if (!customer) {
    const surveyName = session.survey_id
      ? queryOne('SELECT customer_name FROM loyalty_surveys WHERE id = ?', [session.survey_id])?.customer_name
      : '';
    customer = createPublicCustomer({
      name: identity.name || surveyName,
      phone,
      doc_number: doc,
      doc_type: identity.doc_type,
    });
    created = true;
  }
  if (session.survey_id) {
    runSql(
      "UPDATE loyalty_surveys SET customer_id = ? WHERE id = ? AND IFNULL(customer_id, '') = ''",
      [customer.id, session.survey_id],
    );
    attachLoyaltySurveyAsGitEvidence(customer.id, session.survey_id);
  }
  getOrCreateAccess(customer.id);
  getOrCreateActiveCycle(customer.id, getConfig());
  runSql('UPDATE git_cards_loyalty_sessions SET customer_id = ? WHERE token = ?', [customer.id, session.token]);
  const next = getLoyaltySession(token);
  return buildLoyaltyContinuePayload(next, { created_customer: created });
}

function publicProgramSummary() {
  try {
    const config = getConfig();
    return {
      enabled: config.module_enabled !== false,
      survey_required: config.survey_required,
      program_name: config.program_name,
    };
  } catch (_) {
    return { enabled: false, survey_required: false, program_name: 'GIT Cards' };
  }
}

function restaurantScopeSql(alias) {
  return `(IFNULL(${alias}.restaurant_id, '') = '' OR ${alias}.restaurant_id = ?)`;
}

function adminDashboardSummary() {
  ensureGitCardsTables();
  processExpirations();
  const restaurantId = currentRestaurantId();
  const scope = restaurantScopeSql('x');
  const registeredRow = queryOne(
    `SELECT COUNT(*) as c FROM (
       SELECT customer_id FROM git_cards_cycles x
       WHERE ${scope} AND EXISTS (SELECT 1 FROM customers c WHERE c.id = x.customer_id)
       UNION
       SELECT customer_id FROM git_cards_access x
       WHERE ${scope} AND EXISTS (SELECT 1 FROM customers c WHERE c.id = x.customer_id)
     )`,
    [restaurantId, restaurantId],
  );
  const activeRow = queryOne(
    `SELECT COUNT(DISTINCT customer_id) as c
     FROM git_cards_cycles x
     WHERE x.status = 'active'
       AND ${scope}
       AND (IFNULL(x.expires_at, '') = '' OR datetime(x.expires_at) > datetime('now'))`,
    [restaurantId],
  );
  const pendingRow = queryOne(
    `SELECT COUNT(*) as c
     FROM git_cards_advances x
     WHERE x.status = 'pending'
       AND ${scope}`,
    [restaurantId],
  );
  const rewardsRow = queryOne(
    `SELECT COUNT(*) as c
     FROM git_cards_rewards x
     WHERE x.status = 'available'
       AND ${scope}
       AND (IFNULL(x.expires_at, '') = '' OR datetime(x.expires_at) > datetime('now'))`,
    [restaurantId],
  );
  const inactiveRow = queryOne(
    `SELECT COUNT(*) as c FROM (
       SELECT DISTINCT customer_id
       FROM git_cards_cycles x
       WHERE ${scope}
     ) enrolled
     WHERE enrolled.customer_id NOT IN (
       SELECT DISTINCT customer_id
       FROM git_cards_cycles x
       WHERE x.status = 'active'
         AND ${scope}
         AND (IFNULL(x.expires_at, '') = '' OR datetime(x.expires_at) > datetime('now'))
     )`,
    [restaurantId, restaurantId],
  );
  const nearCompleteRow = queryOne(
    `SELECT COUNT(DISTINCT x.customer_id) as c
     FROM git_cards_cycles x
     WHERE x.status = 'active'
       AND ${scope}
       AND x.goal >= 1
       AND (IFNULL(x.expires_at, '') = '' OR datetime(x.expires_at) > datetime('now'))
       AND (
         SELECT COUNT(*) FROM git_cards_advances a
         WHERE a.cycle_id = x.id AND a.status = 'approved'
       ) = (x.goal - 1)`,
    [restaurantId],
  );
  return {
    enabled: getConfig().module_enabled !== false,
    registered: Number(registeredRow?.c || 0),
    active_cards: Number(activeRow?.c || 0),
    inactive_cards: Number(inactiveRow?.c || 0),
    near_complete: Number(nearCompleteRow?.c || 0),
    pending_purchases: Number(pendingRow?.c || 0),
    available_rewards: Number(rewardsRow?.c || 0),
  };
}

function summaryCount() {
  return adminDashboardSummary().registered;
}

function cardStyles() {
  return Object.entries(CARD_STYLES)
    .filter(([id]) => !RETIRED_STYLE_IDS.has(id))
    .map(([id, colors]) => ({ id, ...colors }));
}

function cycleIsCajaEligible(cycle) {
  if (!cycle || cycle.status !== 'active') return false;
  if (cycle.expires_at && Date.parse(cycle.expires_at) <= Date.now()) return false;
  try {
    assertRestaurant(cycle.restaurant_id);
  } catch (_) {
    return false;
  }
  const promo = getPromotion(cycle.promotion_id);
  if (promo) return promotionAcceptsAdvances(promo);
  return programIsOpen(getConfig());
}

function matchesCajaClientSearch(row, needle) {
  const q = String(needle || '').trim().toLowerCase();
  if (!q) return true;
  const name = String(row.name || '').trim().toLowerCase();
  const parts = name.split(/\s+/).filter(Boolean);
  if (name.startsWith(q)) return true;
  if (parts.some((part) => part.startsWith(q))) return true;
  if (name.includes(q)) return true;
  const qDigits = String(needle || '').replace(/\D/g, '');
  const doc = String(row.doc_number || '').replace(/\D/g, '');
  if (qDigits && doc.includes(qDigits)) return true;
  return false;
}

function toCajaClientRow(row) {
  const progress = cycleProgress({
    id: row.id,
    goal: row.goal,
    status: row.status,
  });
  return {
    id: row.customer_id,
    name: row.name,
    doc_masked: maskDoc(row.doc_number),
    cycle_id: row.id,
    status: 'active',
    progress: {
      confirmed: progress.confirmed,
      pending: progress.pending,
      goal: progress.goal,
    },
    expires_at: row.expires_at || '',
    promotion_id: row.promotion_id || '',
    discount_reward: sanitizeDiscountReward(availableDiscountReward(row.customer_id)),
  };
}

function anyPromotionAcceptsAdvances() {
  const restaurantId = currentRestaurantId();
  const rows = queryAll(
    `SELECT * FROM git_cards_promotions
     WHERE archived = 0 AND (IFNULL(restaurant_id, '') IN ('', ?))`,
    [restaurantId],
  ) || [];
  return rows.some((row) => promotionAcceptsAdvances(row));
}

function availableDiscountReward(customerId) {
  return queryOne(
    `SELECT * FROM git_cards_rewards
     WHERE customer_id = ?
       AND status = 'available'
       AND reward_kind = 'discount'
       AND (IFNULL(expires_at, '') = '' OR datetime(expires_at) > datetime('now'))
     ORDER BY datetime(issued_at) DESC LIMIT 1`,
    [customerId],
  );
}

function listEligibleCajaClients(q = '') {
  ensureGitCardsTables();
  processExpirations();
  if (!anyPromotionAcceptsAdvances()) {
    return { rows: [], program_open: false };
  }
  const restaurantId = currentRestaurantId();
  const cycles = queryAll(
    `SELECT cy.id, cy.customer_id, cy.goal, cy.status, cy.expires_at, cy.restaurant_id, cy.promotion_id,
            c.name, c.doc_number
     FROM git_cards_cycles cy
     JOIN customers c ON c.id = cy.customer_id
     WHERE cy.status = 'active'
       AND (IFNULL(cy.restaurant_id, '') = '' OR cy.restaurant_id = ?)
     ORDER BY lower(c.name) ASC
     LIMIT 300`,
    [restaurantId],
  ) || [];
  const eligible = cycles.filter((row) => cycleIsCajaEligible(row));
  const needle = String(q || '').trim();
  const filtered = needle ? eligible.filter((row) => matchesCajaClientSearch(row, needle)) : eligible;
  return {
    rows: filtered.slice(0, 30).map(toCajaClientRow),
    program_open: true,
  };
}

function previewCajaGitCustomer(customerId) {
  ensureGitCardsTables();
  processExpirations();
  const id = String(customerId || '').trim();
  if (!id) {
    const err = new Error('Cliente no encontrado');
    err.status = 404;
    throw err;
  }
  const customer = queryOne('SELECT id, name, doc_number FROM customers WHERE id = ?', [id]);
  if (!customer) {
    const err = new Error('Cliente no encontrado');
    err.status = 404;
    throw err;
  }
  const cycle = getActiveCycle(customer.id);
  if (cycle) {
    try {
      assertRestaurant(cycle.restaurant_id);
    } catch (err) {
      throw err;
    }
  }
  const card = publicCardPayload(customer);
  return {
    customer: {
      id: customer.id,
      name: customer.name,
      doc_masked: maskDoc(customer.doc_number),
    },
    card,
    discount_reward: sanitizeDiscountReward(availableDiscountReward(customer.id)),
    eligible: cycleIsCajaEligible(cycle),
  };
}

function enrollStaffCustomer(payload = {}, actor = {}) {
  ensureGitCardsTables();
  processExpirations();
  const name = String(payload.name || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2) {
    const err = new Error('El nombre es requerido');
    err.status = 400;
    throw err;
  }
  const phone = String(payload.phone || '').trim();
  const address = String(payload.address || '').trim();
  const emailRaw = String(payload.email || '').trim().toLowerCase();
  const docTypeRaw = String(payload.doc_type || '1').trim();
  const docType = docTypeRaw === '6' ? '6' : (docTypeRaw === '0' ? '0' : '1');
  const doc = String(payload.doc_number || '').replace(/\D/g, '');
  if (docType === '1' && doc && !/^\d{8}$/.test(doc)) {
    const err = new Error('DNI inválido, debe tener 8 dígitos');
    err.status = 400;
    throw err;
  }
  if (docType === '6' && doc && !/^\d{11}$/.test(doc)) {
    const err = new Error('RUC inválido, debe tener 11 dígitos');
    err.status = 400;
    throw err;
  }

  let customer = findCustomerByIdentity({ phone, doc_number: doc });
  if (!customer && emailRaw) {
    customer = queryOne('SELECT * FROM customers WHERE lower(trim(email)) = ? LIMIT 1', [emailRaw]);
  }

  const publicCustomer = (row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone || '',
    doc_masked: maskDoc(row.doc_number),
  });

  if (customer) {
    if (customerHasGitCard(customer.id)) {
      return {
        created_customer: false,
        already_enrolled: true,
        linked: false,
        customer: publicCustomer(customer),
      };
    }
    getOrCreateAccess(customer.id);
    getOrCreateActiveCycle(customer.id, resolvePromotionConfig(payload));
    insertEvent(null, {
      customer_id: customer.id,
      restaurant_id: currentRestaurantId(),
      kind: 'staff_enroll',
      detail: 'Cliente existente vinculado a GIT Cards desde administración',
      actor_id: actor.id || '',
      actor_name: actor.full_name || actor.username || '',
    });
    return {
      created_customer: false,
      already_enrolled: false,
      linked: true,
      customer: publicCustomer(customer),
    };
  }

  const fallbackEmail = doc
    ? `cliente.${doc}@local.resto`
    : `cliente.${Date.now()}@local.resto`;
  const requestedEmail = emailRaw || fallbackEmail;
  const emailTaken = queryOne('SELECT id FROM customers WHERE email = ?', [requestedEmail]);
  const email = emailTaken ? `cliente.${uuidv4().slice(0, 8)}@local.resto` : requestedEmail;
  const id = uuidv4();
  const password = String(payload.password || '').trim() || 'cliente123';
  runSql(
    'INSERT INTO customers (id, name, email, password_hash, phone, address, doc_type, doc_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, name, email, bcrypt.hashSync(password, 10), phone, address, docType, doc],
  );
  logAudit({
    actorUserId: actor.id || '',
    actorName: actor.full_name || actor.username || '',
    action: 'customer.create',
    resourceType: 'customer',
    resourceId: id,
    details: { source: 'git_cards', email, doc_type: docType, doc_number: doc },
  });
  const created = queryOne('SELECT * FROM customers WHERE id = ?', [id]);
  getOrCreateAccess(created.id);
  getOrCreateActiveCycle(created.id, resolvePromotionConfig(payload));
  return {
    created_customer: true,
    already_enrolled: false,
    linked: true,
    customer: publicCustomer(created),
  };
}

function sanitizeDiscountReward(reward) {
  if (!reward) return null;
  return {
    id: reward.id,
    title: reward.title,
    discount_type: reward.discount_type || '',
    discount_value: Number(reward.discount_value || 0),
    discount_min_spend: Number(reward.discount_min_spend || 0),
    discount_max: Number(reward.discount_max || 0),
  };
}

function resolvePromotionConfig(payload = {}) {
  const requested = getPromotion(payload.promotion_id);
  if (requested) {
    if (!promotionAcceptsAdvances(requested)) {
      const err = new Error('La promoción seleccionada no está activa.');
      err.status = 400;
      throw err;
    }
    return promotionToConfig(requested);
  }
  return getConfig();
}

function resolveCajaGitCustomer(customerId) {
  const preview = previewCajaGitCustomer(customerId);
  if (!preview.eligible) {
    const err = new Error('El cliente no tiene una GIT Card activa para participar.');
    err.status = 400;
    throw err;
  }
  return { id: preview.customer.id, name: preview.customer.name };
}

function throwHttp(message, status = 400, extra = {}) {
  const err = new Error(message);
  err.status = status;
  Object.assign(err, extra);
  throw err;
}

function promotionRewardLabel(promo) {
  if (promo.reward_kind === 'product') return 'Producto de cortesía';
  if (promo.reward_kind === 'discount') {
    return promo.discount_type === 'percent' ? 'Descuento porcentual' : 'Descuento fijo';
  }
  return 'Otro beneficio';
}

function promotionBenefitLabel(promo) {
  if (promo.reward_kind === 'product') {
    const qty = Number(promo.product_qty || 1);
    const name = [promo.product_name, promo.variant_name].filter(Boolean).join(' · ') || 'Producto';
    return qty > 1 ? `${name} × ${qty}` : name;
  }
  if (promo.reward_kind === 'discount') {
    if (promo.discount_type === 'percent') return `${Number(promo.discount_value || 0)} %`;
    return `S/ ${Number(promo.discount_value || 0).toFixed(2)}`;
  }
  return promo.other_name || promo.reward_title || 'Beneficio';
}

function promotionHistoryCounts(id) {
  const cycles = Number(queryOne('SELECT COUNT(*) as c FROM git_cards_cycles WHERE promotion_id = ?', [id])?.c || 0);
  const rewards = Number(queryOne('SELECT COUNT(*) as c FROM git_cards_rewards WHERE promotion_id = ?', [id])?.c || 0);
  const advances = Number(queryOne('SELECT COUNT(*) as c FROM git_cards_advances WHERE promotion_id = ?', [id])?.c || 0);
  const available = Number(queryOne(
    `SELECT COUNT(*) as c FROM git_cards_rewards
     WHERE promotion_id = ? AND status = 'available'
       AND (IFNULL(expires_at, '') = '' OR datetime(expires_at) > datetime('now'))`,
    [id],
  )?.c || 0);
  return { cycles, rewards, advances, available, total: cycles + rewards + advances };
}

function activationErrors(promo) {
  const errors = [];
  if (!String(promo.name || '').trim()) errors.push('Indique el nombre de la promoción.');
  if (!Number.isFinite(Number(promo.min_spend)) || Number(promo.min_spend) < 0) {
    errors.push('El consumo mínimo debe ser un número válido y no negativo.');
  }
  if (!Number.isInteger(Number(promo.goal)) || Number(promo.goal) < 1) {
    errors.push('La meta de avances debe ser un entero positivo.');
  }
  if (promo.start_at && !Number.isFinite(Date.parse(promo.start_at))) {
    errors.push('La fecha de inicio no es válida.');
  }
  if (promo.end_at && !Number.isFinite(Date.parse(promo.end_at))) {
    errors.push('La fecha de finalización no es válida.');
  }
  if (promo.start_at && promo.end_at && Date.parse(promo.end_at) < Date.parse(promo.start_at)) {
    errors.push('La fecha de finalización no puede ser anterior al inicio.');
  }
  if (promo.reward_kind === 'product') {
    if (!String(promo.product_id || '').trim()) errors.push('Seleccione un producto del catálogo.');
    if (!(Number(promo.product_qty) > 0)) errors.push('La cantidad de cortesía debe ser mayor a cero.');
  } else if (promo.reward_kind === 'discount') {
    if (!['percent', 'fixed'].includes(String(promo.discount_type || ''))) {
      errors.push('Elija descuento porcentual o importe fijo.');
    }
    if (!(Number(promo.discount_value) > 0)) errors.push('Indique el valor del descuento.');
    if (promo.discount_type === 'percent' && Number(promo.discount_value) > 100) {
      errors.push('El descuento porcentual no puede superar 100 %.');
    }
  } else if (!String(promo.other_name || promo.reward_title || '').trim()) {
    errors.push('Indique el nombre del beneficio.');
  }
  if (!CARD_STYLES[promo.card_style]) errors.push('Elija un estilo de tarjeta válido.');
  return errors;
}

function resolveActivationStatus(status, startAt, endAt) {
  const now = Date.now();
  const start = startAt ? Date.parse(startAt) : NaN;
  const end = endAt ? Date.parse(endAt) : NaN;
  if (Number.isFinite(end) && now > end) {
    throwHttp('No se puede activar una promoción fuera de su periodo de vigencia.');
  }
  if (Number.isFinite(start) && now < start) return 'scheduled';
  return status === 'scheduled' ? 'active' : (status || 'active');
}

function normalizePromotionInput(raw = {}, previous = {}) {
  const src = { ...previous, ...raw };
  const styleKey = CARD_STYLES[src.card_style]
    ? src.card_style
    : (previous.card_style && CARD_STYLES[previous.card_style] ? previous.card_style : randomDesignStyleId());
  const style = CARD_STYLES[styleKey];
  const restaurant = currentRestaurant();
  const kind = ['product', 'discount', 'other'].includes(src.reward_kind) ? src.reward_kind : 'other';
  const minSpend = Number(src.min_spend);
  const goal = Number(src.goal);
  const productQty = Number(src.product_qty);
  const rewardTitle = String(src.reward_title || src.product_name || src.other_name || '').trim();
  return {
    name: String(src.name || '').trim(),
    description: String(src.description || '').trim(),
    start_at: String(src.start_at || '').trim(),
    end_at: String(src.end_at || '').trim(),
    status: ['draft', 'scheduled', 'active', 'paused', 'ended'].includes(src.status) ? src.status : 'draft',
    min_spend: Number.isFinite(minSpend) ? minSpend : 0,
    goal: Number.isFinite(goal) ? Math.trunc(goal) : 3,
    survey_required: src.survey_required === true || src.survey_required === 1 || src.survey_required === '1' ? 1 : 0,
    cycle_valid_days: Math.max(0, Math.trunc(Number(src.cycle_valid_days) || 90)),
    reward_valid_days: Math.max(0, Math.trunc(Number(src.reward_valid_days) || 30)),
    auto_reset: src.auto_reset === false || src.auto_reset === 0 || src.auto_reset === '0' ? 0 : 1,
    reward_kind: kind,
    reward_title: rewardTitle,
    reward_description: String(src.reward_description || src.other_description || '').trim(),
    product_id: kind === 'product' ? String(src.product_id || '').trim() : '',
    product_name: kind === 'product' ? String(src.product_name || '').trim() : '',
    product_qty: kind === 'product' ? (Number.isFinite(productQty) && productQty > 0 ? productQty : 1) : 1,
    variant_id: kind === 'product' ? String(src.variant_id || '').trim() : '',
    variant_name: kind === 'product' ? String(src.variant_name || '').trim() : '',
    discount_type: kind === 'discount' && ['percent', 'fixed'].includes(src.discount_type) ? src.discount_type : (kind === 'discount' ? '' : ''),
    discount_value: kind === 'discount' ? Number(src.discount_value || 0) : 0,
    discount_min_spend: kind === 'discount' ? Number(src.discount_min_spend || 0) : 0,
    discount_max: kind === 'discount' ? Number(src.discount_max || 0) : 0,
    discount_conditions: kind === 'discount' ? String(src.discount_conditions || '').trim() : '',
    other_name: kind === 'other' ? String(src.other_name || rewardTitle || '').trim() : '',
    other_description: kind === 'other' ? String(src.other_description || src.reward_description || '').trim() : '',
    other_conditions: kind === 'other' ? String(src.other_conditions || '').trim() : '',
    other_delivery: kind === 'other' ? String(src.other_delivery || '').trim() : '',
    card_style: styleKey,
    card_bg: String(src.card_bg || '').trim() || style.bg,
    card_text: String(src.card_text || '').trim() || style.text,
    card_accent: String(src.card_accent || '').trim() || style.accent,
    logo_url: String(src.logo_url || previous.logo_url || restaurant.logo || '').trim(),
    info_text: String(src.info_text || src.description || '').trim(),
    restaurant_name: String(src.restaurant_name || previous.restaurant_name || restaurant.name || '').trim(),
    notify_push: src.notify_push === true || src.notify_push === 1 || src.notify_push === '1' ? 1 : 0,
  };
}

function bindProductFromCatalog(promo) {
  if (promo.reward_kind !== 'product' || !promo.product_id) return promo;
  const product = queryOne('SELECT id, name, price, is_active FROM products WHERE id = ?', [promo.product_id]);
  if (!product) throwHttp('El producto seleccionado no existe en el catálogo.');
  if (Number(product.is_active) === 0) throwHttp('El producto seleccionado no está activo.');
  let variantName = promo.variant_name;
  if (promo.variant_id) {
    const variant = queryOne('SELECT id, name, product_id FROM product_variants WHERE id = ?', [promo.variant_id]);
    if (!variant || variant.product_id !== product.id) throwHttp('La presentación seleccionada no pertenece al producto.');
    variantName = variant.name;
  }
  return {
    ...promo,
    product_name: product.name,
    variant_name: variantName || '',
    reward_title: promo.reward_title || product.name,
  };
}

function serializePromotion(row) {
  if (!row) return null;
  const history = promotionHistoryCounts(row.id);
  const style = CARD_STYLES[row.card_style] || CARD_STYLES.blue;
  return {
    ...row,
    survey_required: Number(row.survey_required) === 1,
    auto_reset: Number(row.auto_reset) !== 0,
    notify_push: Number(row.notify_push) === 1,
    archived: Number(row.archived) === 1,
    reward_label: promotionRewardLabel(row),
    benefit_label: promotionBenefitLabel(row),
    style: { id: row.card_style, ...style },
    history,
    can_delete: history.total === 0,
    activation_errors: activationErrors(row),
  };
}

function insertPromotionRow(id, promo, restaurantId) {
  runSql(
    `INSERT INTO git_cards_promotions (
      id, restaurant_id, name, description, start_at, end_at, status,
      min_spend, goal, survey_required, cycle_valid_days, reward_valid_days, auto_reset,
      reward_kind, reward_title, reward_description,
      product_id, product_name, product_qty, variant_id, variant_name,
      discount_type, discount_value, discount_min_spend, discount_max, discount_conditions,
      other_name, other_description, other_conditions, other_delivery,
      card_style, card_bg, card_text, card_accent, logo_url, info_text, restaurant_name, notify_push
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, restaurantId, promo.name, promo.description, promo.start_at, promo.end_at, promo.status,
      promo.min_spend, promo.goal, promo.survey_required, promo.cycle_valid_days, promo.reward_valid_days, promo.auto_reset,
      promo.reward_kind, promo.reward_title, promo.reward_description,
      promo.product_id, promo.product_name, promo.product_qty, promo.variant_id, promo.variant_name,
      promo.discount_type, promo.discount_value, promo.discount_min_spend, promo.discount_max, promo.discount_conditions,
      promo.other_name, promo.other_description, promo.other_conditions, promo.other_delivery,
      promo.card_style, promo.card_bg, promo.card_text, promo.card_accent, promo.logo_url, promo.info_text, promo.restaurant_name, promo.notify_push,
    ],
  );
}

function updatePromotionRow(id, promo) {
  runSql(
    `UPDATE git_cards_promotions SET
      name = ?, description = ?, start_at = ?, end_at = ?, status = ?,
      min_spend = ?, goal = ?, survey_required = ?, cycle_valid_days = ?, reward_valid_days = ?, auto_reset = ?,
      reward_kind = ?, reward_title = ?, reward_description = ?,
      product_id = ?, product_name = ?, product_qty = ?, variant_id = ?, variant_name = ?,
      discount_type = ?, discount_value = ?, discount_min_spend = ?, discount_max = ?, discount_conditions = ?,
      other_name = ?, other_description = ?, other_conditions = ?, other_delivery = ?,
      card_style = ?, card_bg = ?, card_text = ?, card_accent = ?, logo_url = ?, info_text = ?, restaurant_name = ?, notify_push = ?,
      updated_at = datetime('now')
     WHERE id = ?`,
    [
      promo.name, promo.description, promo.start_at, promo.end_at, promo.status,
      promo.min_spend, promo.goal, promo.survey_required, promo.cycle_valid_days, promo.reward_valid_days, promo.auto_reset,
      promo.reward_kind, promo.reward_title, promo.reward_description,
      promo.product_id, promo.product_name, promo.product_qty, promo.variant_id, promo.variant_name,
      promo.discount_type, promo.discount_value, promo.discount_min_spend, promo.discount_max, promo.discount_conditions,
      promo.other_name, promo.other_description, promo.other_conditions, promo.other_delivery,
      promo.card_style, promo.card_bg, promo.card_text, promo.card_accent, promo.logo_url, promo.info_text, promo.restaurant_name, promo.notify_push,
      id,
    ],
  );
}

function listPromotions() {
  ensureGitCardsTables();
  refreshPromotionStatuses();
  const restaurantId = currentRestaurantId();
  const rows = queryAll(
    `SELECT * FROM git_cards_promotions
     WHERE archived = 0 AND (IFNULL(restaurant_id, '') IN ('', ?))
     ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC`,
    [restaurantId],
  ) || [];
  const promotions = rows.map(serializePromotion);
  const restaurant = currentRestaurant();
  return {
    promotions,
    active_promotions: promotions.filter((p) => p.status === 'active').length,
    available_rewards: adminDashboardSummary().available_rewards,
    styles: cardStyles(),
    restaurant_name: String(restaurant?.name || '').trim(),
    logo_url: String(restaurant?.logo || '').trim(),
  };
}

function getPromotionDetail(id) {
  ensureGitCardsTables();
  refreshPromotionStatuses();
  const row = getPromotion(id);
  if (!row) throwHttp('Promoción no encontrada', 404);
  assertRestaurant(row.restaurant_id);
  return serializePromotion(row);
}

function createPromotion(raw = {}, actor = {}, { activate = false } = {}) {
  ensureGitCardsTables();
  let promo = bindProductFromCatalog(normalizePromotionInput(raw));
  let status = activate ? 'active' : (promo.status === 'active' ? 'active' : 'draft');
  if (status === 'active' || status === 'scheduled') {
    const errors = activationErrors(promo);
    if (errors.length) throwHttp(errors.join(' '), 400, { errors });
    status = resolveActivationStatus(status, promo.start_at, promo.end_at);
  } else {
    status = 'draft';
  }
  promo = { ...promo, status };
  const id = uuidv4();
  insertPromotionRow(id, promo, currentRestaurantId());
  logAudit({
    actorUserId: actor.id || '',
    actorName: actor.full_name || actor.username || '',
    action: 'git_cards.promotion_create',
    resourceType: 'git_cards_promotion',
    resourceId: id,
    details: { name: promo.name, status, reward_kind: promo.reward_kind },
  });
  return getPromotionDetail(id);
}

function updatePromotion(id, raw = {}, actor = {}) {
  ensureGitCardsTables();
  const current = getPromotion(id);
  if (!current) throwHttp('Promoción no encontrada', 404);
  assertRestaurant(current.restaurant_id);
  if (current.status === 'ended' || Number(current.archived) === 1) {
    throwHttp('Una promoción finalizada no se puede editar.');
  }
  let promo = bindProductFromCatalog(normalizePromotionInput(raw, current));
  const history = promotionHistoryCounts(id);
  const sensitive = ['min_spend', 'goal', 'survey_required', 'reward_kind', 'product_id', 'discount_type', 'discount_value'];
  const affectsActive = history.total > 0 && sensitive.some((key) => String(promo[key] ?? '') !== String(current[key] ?? ''));
  if (affectsActive && raw.confirm_affects_active !== true && raw.confirm_affects_active !== 1) {
    throwHttp(
      'Esta promoción ya tiene tarjetas o recompensas. Confirme el cambio para aplicarlo solo a compras futuras. El historial no se modifica.',
      409,
      { requires_confirm: true, affects_active: true },
    );
  }
  promo = { ...promo, status: current.status };
  if (current.status === 'active' || current.status === 'scheduled') {
    const errors = activationErrors(promo);
    if (errors.length) throwHttp(errors.join(' '), 400, { errors });
    promo.status = resolveActivationStatus(current.status, promo.start_at, promo.end_at);
  }
  updatePromotionRow(id, promo);
  logAudit({
    actorUserId: actor.id || '',
    actorName: actor.full_name || actor.username || '',
    action: 'git_cards.promotion_update',
    resourceType: 'git_cards_promotion',
    resourceId: id,
    details: { affects_active: !!affectsActive },
  });
  return getPromotionDetail(id);
}

function setPromotionStatus(id, nextStatus, actor = {}) {
  ensureGitCardsTables();
  refreshPromotionStatuses();
  const current = getPromotion(id);
  if (!current) throwHttp('Promoción no encontrada', 404);
  assertRestaurant(current.restaurant_id);
  if (Number(current.archived) === 1) throwHttp('La promoción está archivada.');
  const allowed = {
    active: ['draft', 'scheduled', 'paused'],
    paused: ['active'],
    ended: ['active', 'paused', 'scheduled', 'draft'],
  };
  if (!(allowed[nextStatus] || []).includes(current.status)) {
    throwHttp(`No se puede pasar de ${current.status} a ${nextStatus}.`);
  }
  if (nextStatus === 'active') {
    const errors = activationErrors(current);
    if (errors.length) throwHttp(errors.join(' '), 400, { errors });
    nextStatus = resolveActivationStatus('active', current.start_at, current.end_at);
  }
  runSql(
    'UPDATE git_cards_promotions SET status = ?, updated_at = datetime(\'now\') WHERE id = ?',
    [nextStatus, id],
  );
  logAudit({
    actorUserId: actor.id || '',
    actorName: actor.full_name || actor.username || '',
    action: `git_cards.promotion_${nextStatus}`,
    resourceType: 'git_cards_promotion',
    resourceId: id,
    details: { from: current.status, to: nextStatus },
  });
  return getPromotionDetail(id);
}

function archivePromotion(id, actor = {}) {
  ensureGitCardsTables();
  const current = getPromotion(id);
  if (!current) throwHttp('Promoción no encontrada', 404);
  assertRestaurant(current.restaurant_id);
  const history = promotionHistoryCounts(id);
  if (history.total > 0) {
    throwHttp('No se puede eliminar una promoción con historial. Finalícela o archívela.', 409);
  }
  runSql(
    "UPDATE git_cards_promotions SET archived = 1, status = CASE WHEN status = 'ended' THEN status ELSE 'ended' END, updated_at = datetime('now') WHERE id = ?",
    [id],
  );
  logAudit({
    actorUserId: actor.id || '',
    actorName: actor.full_name || actor.username || '',
    action: 'git_cards.promotion_archive',
    resourceType: 'git_cards_promotion',
    resourceId: id,
  });
  return { archived: true, id };
}

function foldSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function searchCatalogProducts(q = '') {
  const tokens = foldSearch(q).split(/\s+/).filter(Boolean);
  const rows = queryAll(
    `SELECT p.id, p.name, p.price, p.stock, p.process_type, p.is_active, c.name as category_name
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE IFNULL(p.is_active, 1) = 1
     ORDER BY p.name`,
  ) || [];
  const variants = queryAll(
    'SELECT id, product_id, name, price_modifier FROM product_variants WHERE IFNULL(is_active, 1) = 1',
  ) || [];
  const variantsByProduct = new Map();
  variants.forEach((variant) => {
    const list = variantsByProduct.get(variant.product_id) || [];
    list.push(variant);
    variantsByProduct.set(variant.product_id, list);
  });
  const matched = rows.filter((product) => {
    if (!tokens.length) return true;
    const haystack = foldSearch([
      product.name,
      product.category_name,
      ...(variantsByProduct.get(product.id) || []).map((variant) => variant.name),
    ].join(' '));
    return tokens.every((token) => haystack.includes(token));
  }).slice(0, 25);
  return matched.map((p) => {
    const productVariants = variantsByProduct.get(p.id) || [];
    let stock = null;
    let inventory_controlled = false;
    if (String(p.process_type || '') === 'non_transformed') {
      inventory_controlled = true;
      const sum = queryOne(
        'SELECT COALESCE(SUM(quantity), 0) as t FROM inventory_warehouse_stocks WHERE product_id = ?',
        [p.id],
      );
      stock = Number(sum?.t ?? p.stock ?? 0);
    }
    return {
      id: p.id,
      name: p.name,
      price: Number(p.price || 0),
      category_name: p.category_name || '',
      variants: productVariants,
      inventory_controlled,
      stock,
    };
  });
}

function previewPromotionCard(raw = {}) {
  const restaurant = currentRestaurant();
  const promo = normalizePromotionInput(raw);
  const style = CARD_STYLES[promo.card_style] || CARD_STYLES.blue;
  return {
    program_name: promo.name || 'GIT Cards',
    restaurant_name: promo.restaurant_name || restaurant.name || '',
    logo_url: promo.logo_url || restaurant.logo || '',
    info_text: promo.info_text,
    reward_title: promo.reward_title || promotionBenefitLabel(promo),
    reward_description: promo.reward_description || promo.other_description,
    card_style: promo.card_style,
    colors: { bg: promo.card_bg || style.bg, text: promo.card_text || style.text, accent: promo.card_accent || style.accent, muted: style.muted },
    customer: { id: 'preview', name: 'Cliente de ejemplo', phone: '', doc_masked: '*****321' },
    cycle: { id: 'preview', status: 'active', started_at: nowIso(), expires_at: '', completed_at: '' },
    progress: { confirmed: Math.max(0, Math.min(1, promo.goal - 1)), pending: 0, rejected: 0, voided: 0, goal: promo.goal, remaining: Math.max(0, promo.goal - 1) },
    status: 'active',
    status_flags: ['active'],
    current_reward: null,
    rewards_public: [],
    next_step: promo.info_text || 'Cada compra que cumpla las condiciones sumará un avance.',
  };
}

function loadRewardOrThrow(id, tx = null) {
  const reward = tx
    ? tx.queryOne('SELECT * FROM git_cards_rewards WHERE id = ?', [id])
    : queryOne('SELECT * FROM git_cards_rewards WHERE id = ?', [id]);
  if (!reward) throwHttp('Recompensa no encontrada', 404);
  assertRestaurant(reward.restaurant_id);
  return reward;
}

function quoteDiscountRewardForOrder(rewardId, orderId, tx = null) {
  const q = tx || { queryOne, queryAll };
  const reward = loadRewardOrThrow(rewardId, tx);
  if (reward.reward_kind !== 'discount') throwHttp('Esta recompensa no es un descuento.');
  if (reward.status !== 'available') throwHttp(reward.status === 'used' ? 'Esta recompensa ya fue canjeada.' : 'La recompensa no está disponible.', reward.status === 'used' ? 409 : 400);
  const order = q.queryOne('SELECT * FROM orders WHERE id = ?', [orderId]);
  if (!order) throwHttp('Pedido no encontrado', 404);
  const items = q.queryAll('SELECT quantity, unit_price, subtotal FROM order_items WHERE order_id = ?', [orderId]) || [];
  const { getOrderChargeBase } = require('./utils/orderChargeBase');
  const base = getOrderChargeBase(order, items);
  const minSpend = Number(reward.discount_min_spend || 0);
  if (minSpend > 0 && base + 1e-9 < minSpend) {
    throwHttp(`La compra no alcanza el mínimo de S/ ${minSpend.toFixed(2)} para canjear este descuento.`);
  }
  let amount = reward.discount_type === 'percent'
    ? base * (Number(reward.discount_value || 0) / 100)
    : Number(reward.discount_value || 0);
  const max = Number(reward.discount_max || 0);
  if (max > 0) amount = Math.min(amount, max);
  amount = Math.max(0, Math.min(round2(amount), base));
  return {
    reward_id: reward.id,
    title: reward.title,
    base: round2(base),
    amount,
    new_total: round2(Math.max(0, base - amount)),
    discount_type: reward.discount_type,
    discount_value: Number(reward.discount_value || 0),
  };
}

function consumeDiscountRewardTx(tx, rewardId, orderId, actor = {}) {
  const reward = tx.queryOne('SELECT * FROM git_cards_rewards WHERE id = ?', [rewardId]);
  if (!reward) throwHttp('Recompensa no encontrada', 404);
  if (reward.status === 'used' && String(reward.applied_order_id || '') === String(orderId)) {
    return reward;
  }
  if (reward.status !== 'available') {
    throwHttp(reward.status === 'used' ? 'Esta recompensa ya fue canjeada.' : 'La recompensa no está disponible.', reward.status === 'used' ? 409 : 400);
  }
  tx.run(
    `UPDATE git_cards_rewards
     SET status = 'used', redeemed_at = ?, redeemed_by = ?, redeemed_by_name = ?, applied_order_id = ?
     WHERE id = ? AND status = 'available'`,
    [nowIso(), actor.id || '', actor.full_name || actor.username || '', orderId, reward.id],
  );
  const updated = tx.queryOne('SELECT * FROM git_cards_rewards WHERE id = ?', [reward.id]);
  if (!updated || updated.status !== 'used') throwHttp('Esta recompensa ya fue canjeada.', 409);
  insertEvent(tx, {
    customer_id: reward.customer_id,
    restaurant_id: reward.restaurant_id,
    cycle_id: reward.cycle_id,
    kind: 'reward_redeemed',
    detail: `Descuento aplicado al cobro: ${reward.title}`,
    order_id: orderId,
    actor_id: actor.id || '',
    actor_name: actor.full_name || actor.username || '',
  });
  return updated;
}

function applyDiscountRewardToOrder(rewardId, orderId, actor = {}) {
  ensureGitCardsTables();
  return withTransaction((tx) => {
    const reward = loadRewardOrThrow(rewardId, tx);
    if (reward.reward_kind !== 'discount') throwHttp('Esta recompensa no es un descuento.');
    const order = tx.queryOne('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!order) throwHttp('Pedido no encontrado', 404);
    if (String(order.status || '') === 'cancelled') throwHttp('No se puede aplicar el descuento a un pedido anulado.');
    if (String(order.payment_status || '') === 'paid') throwHttp('El descuento debe aplicarse antes de completar el cobro.');
    const quote = quoteDiscountRewardForOrder(rewardId, orderId, tx);
    const note = ` [DESCUENTO: GIT Cards ${reward.title}]`;
    tx.run(
      "UPDATE orders SET discount = ?, total = ?, notes = COALESCE(notes, '') || ?, updated_at = datetime('now') WHERE id = ?",
      [quote.amount, quote.new_total, note, orderId],
    );
    const used = consumeDiscountRewardTx(tx, rewardId, orderId, actor);
    return { reward: used, discount: quote.amount, order: tx.queryOne('SELECT * FROM orders WHERE id = ?', [orderId]) };
  });
}

module.exports = {
  SETTINGS_KEY,
  CARD_STYLES,
  DEFAULT_CONFIG,
  ensureGitCardsTables,
  normalizeConfig,
  validateConfig,
  isEligibleAmount,
  getConfig,
  saveConfig,
  considerPaidOrder,
  handleVoidedOrder,
  decideAdvance,
  redeemReward,
  listMembers,
  getMemberProfile,
  publicCardPayload,
  findAccessByToken,
  getOrCreateAccess,
  getOrCreateActiveCycle,
  recordSurvey,
  customerHasSurvey,
  processExpirations,
  summaryCount,
  adminDashboardSummary,
  cardStyles,
  maskDoc,
  programIsOpen,
  createLoyaltyContinueSession,
  readLoyaltyContinue,
  linkLoyaltyContinue,
  lookupPublicGitCard,
  namesMatch,
  customerHasGitCard,
  publicProgramSummary,
  publicGitHint,
  sanitizedRewards,
  findCustomerByIdentity,
  attachLoyaltySurveyAsGitEvidence,
  listEligibleCajaClients,
  previewCajaGitCustomer,
  resolveCajaGitCustomer,
  enrollStaffCustomer,
  listPromotions,
  getPromotion,
  getPromotionDetail,
  createPromotion,
  updatePromotion,
  setPromotionStatus,
  archivePromotion,
  searchCatalogProducts,
  previewPromotionCard,
  quoteDiscountRewardForOrder,
  applyDiscountRewardToOrder,
  consumeDiscountRewardTx,
  promotionAcceptsAdvances,
  promotionToConfig,
};
