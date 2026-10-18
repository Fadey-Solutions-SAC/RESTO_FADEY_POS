const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, runSql, withTransaction, logAudit } = require('./database');

const SETTINGS_KEY = 'git_cards';
const CARD_STYLES = {
  night: { bg: '#111827', text: '#f8fafc', accent: '#f5d76e', muted: '#94a3b8' },
  cream: { bg: '#f5efe3', text: '#3f2e1f', accent: '#b45309', muted: '#8b7355' },
  wine: { bg: '#4a1c2a', text: '#fde8e8', accent: '#f5c6aa', muted: '#d4a5a5' },
  forest: { bg: '#14332a', text: '#ecfdf5', accent: '#86efac', muted: '#6b9b88' },
};

const DEFAULT_CONFIG = {
  enabled: true,
  program_name: 'GIT Cards',
  restaurant_name: '',
  logo_url: '',
  card_style: 'night',
  card_bg: '',
  card_text: '',
  card_accent: '',
  reward_title: 'Recompensa GIT Cards',
  reward_description: 'Al completar la tarjeta recibe la recompensa configurada.',
  info_text: 'Cada compra que alcance el consumo mínimo y sea aprobada suma un avance.',
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
  const styleKey = CARD_STYLES[src.card_style] ? src.card_style : 'night';
  const style = CARD_STYLES[styleKey];
  const minSpend = Number(src.min_spend);
  const goal = Number(src.goal);
  const rewardDays = Number(src.reward_valid_days);
  const cycleDays = Number(src.cycle_valid_days);
  return {
    enabled: src.enabled !== false,
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

function getConfig() {
  ensureGitCardsTables();
  const row = queryOne('SELECT value FROM app_settings WHERE key = ?', [SETTINGS_KEY]);
  const restaurant = currentRestaurant();
  const stored = normalizeConfig(parseJson(row?.value, {}));
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
  return next;
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
  const sql = `INSERT INTO git_cards_cycles
    (id, customer_id, restaurant_id, goal, min_spend, started_at, expires_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`;
  const params = [id, customerId, restaurantId, config.goal, config.min_spend, startedAt, expiresAt];
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
    const config = getConfig();
    if (config.auto_reset && programIsOpen(config) && !getActiveCycle(cycle.customer_id)) {
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
  tx.run(
    `INSERT INTO git_cards_rewards
      (id, cycle_id, customer_id, restaurant_id, title, status, issued_at, expires_at)
     VALUES (?, ?, ?, ?, ?, 'available', ?, ?)`,
    [
      id,
      cycle.id,
      cycle.customer_id,
      cycle.restaurant_id || currentRestaurantId(),
      config.reward_title,
      issuedAt,
      sqliteNowPlusDays(config.reward_valid_days),
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

function considerPaidOrder(orderId, actor = {}) {
  ensureGitCardsTables();
  const order = queryOne('SELECT * FROM orders WHERE id = ?', [orderId]);
  if (!order) return { skipped: 'missing_order' };
  const config = getConfig();
  if (!config.enabled) return { skipped: 'disabled' };
  if (!programIsOpen(config)) return { skipped: 'program_expired' };
  const customerId = String(order.customer_id || '').trim();
  if (!customerId) return { skipped: 'no_customer' };
  if (String(order.status || '') === 'cancelled') return { skipped: 'cancelled' };
  if (String(order.payment_status || '') !== 'paid') return { skipped: 'unpaid' };
  if (String(order.payment_method || '') === 'cortesia') return { skipped: 'cortesia' };
  try {
    assertRestaurant(order.restaurant_id);
  } catch (err) {
    return { skipped: 'restaurant' };
  }

  const existing = queryOne('SELECT * FROM git_cards_advances WHERE order_id = ?', [order.id]);
  if (existing) return { skipped: 'already', advance: existing };

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

  let created = null;
  withTransaction((tx) => {
    const again = tx.queryOne('SELECT * FROM git_cards_advances WHERE order_id = ?', [order.id]);
    if (again) {
      created = again;
      return;
    }
    let cycle = tx.queryOne(
      `SELECT * FROM git_cards_cycles
       WHERE customer_id = ? AND status = 'active'
       ORDER BY datetime(started_at) DESC LIMIT 1`,
      [customerId],
    );
    if (!cycle) {
      const cycleId = createCycle(customerId, config, tx);
      cycle = tx.queryOne('SELECT * FROM git_cards_cycles WHERE id = ?', [cycleId]);
    }
    const id = uuidv4();
    tx.run(
      `INSERT INTO git_cards_advances
        (id, cycle_id, customer_id, restaurant_id, order_id, amount, status, survey_ok)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', 1)`,
      [id, cycle.id, customerId, cycle.restaurant_id || currentRestaurantId(), order.id, amount],
    );
    insertEvent(tx, {
      customer_id: customerId,
      restaurant_id: cycle.restaurant_id,
      cycle_id: cycle.id,
      kind: 'advance_pending',
      detail: `Compra ${amount} pendiente de validación`,
      order_id: order.id,
      amount,
      actor_id: actor.id || '',
      actor_name: actor.full_name || actor.username || '',
    });
    created = tx.queryOne('SELECT * FROM git_cards_advances WHERE id = ?', [id]);
  });
  notifyStaff('pending', 'GIT Cards: compra pendiente', `${customer.name || 'Cliente'} · S/ ${amount}`);
  return { pending: true, advance: created };
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
      const cycle = tx.queryOne('SELECT * FROM git_cards_cycles WHERE id = ?', [advance.cycle_id]);
      const approved = countApproved(advance.cycle_id, tx);
      const goal = Number(cycle?.goal || getConfig().goal);
      if (cycle && approved >= goal && cycle.status === 'active') {
        tx.run(
          "UPDATE git_cards_cycles SET status = 'completed', completed_at = ? WHERE id = ? AND status = 'active'",
          [nowIso(), cycle.id],
        );
        reward = issueRewardIfNeeded(tx, cycle, getConfig(), actor);
        completed = true;
        const config = getConfig();
        if (config.auto_reset && programIsOpen(config)) {
          const stillActive = tx.queryOne(
            "SELECT id FROM git_cards_cycles WHERE customer_id = ? AND status = 'active' LIMIT 1",
            [advance.customer_id],
          );
          if (!stillActive) createCycle(advance.customer_id, config, tx);
        }
      }
    }
    return { advance: updated, reward, completed };
  });

  if (result.already) return result;
  if (result.completed) {
    notifyStaff('completed', 'GIT Cards: tarjeta completada', 'Se emitió una recompensa');
  } else if (wanted === 'approved') {
    notifyStaff('advance', 'GIT Cards: avance confirmado', `+1 avance`);
  }
  return result;
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
    insertEvent(tx, {
      customer_id: reward.customer_id,
      restaurant_id: reward.restaurant_id,
      cycle_id: reward.cycle_id,
      kind: 'reward_redeemed',
      detail: `Canje: ${reward.title}`,
      actor_id: actor.id || '',
      actor_name: actor.full_name || actor.username || '',
    });
    return updated;
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

function publicCardPayload(customer, extra = {}) {
  const config = getConfig();
  const cycle = extra.cycle || getActiveCycle(customer.id) || queryOne(
    `SELECT * FROM git_cards_cycles WHERE customer_id = ? ORDER BY datetime(started_at) DESC LIMIT 1`,
    [customer.id],
  );
  const progress = cycleProgress(cycle);
  const rewards = queryAll(
    `SELECT * FROM git_cards_rewards WHERE customer_id = ? ORDER BY datetime(issued_at) DESC`,
    [customer.id],
  ) || [];
  const { status, flags } = deriveStatus({ cycle, progress, rewards });
  const style = CARD_STYLES[config.card_style] || CARD_STYLES.night;
  const payload = {
    program_name: config.program_name,
    restaurant_name: config.restaurant_name,
    logo_url: config.logo_url,
    info_text: config.info_text,
    reward_title: config.reward_title,
    reward_description: config.reward_description,
    card_style: config.card_style,
    colors: {
      bg: config.card_bg || style.bg,
      text: config.card_text || style.text,
      accent: config.card_accent || style.accent,
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
  const customers = queryAll(
    `SELECT id, name, email, phone, doc_type, doc_number, created_at
     FROM customers
     ORDER BY datetime(created_at) DESC
     LIMIT 500`,
  ) || [];
  const needle = String(q || '').trim().toLowerCase();
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
    };
  }).filter((row) => {
    if (needle) {
      const hay = `${row.name} ${row.phone}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    if (status && status !== 'all') {
      if (status === 'none') return row.status === 'none';
      return row.status === status || row.status_flags.includes(status);
    }
    return true;
  });
  const total = rows.length;
  const safePage = Math.max(1, Number(page) || 1);
  const size = Math.max(1, Math.min(50, Number(pageSize) || 10));
  const start = (safePage - 1) * size;
  return {
    total,
    page: safePage,
    page_size: size,
    rows: rows.slice(start, start + size),
    active_count: rows.filter((r) => r.status !== 'none').length,
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
      enabled: config.enabled,
      survey_required: config.survey_required,
      program_name: config.program_name,
    };
  } catch (_) {
    return { enabled: false, survey_required: false, program_name: 'GIT Cards' };
  }
}

function summaryCount() {
  ensureGitCardsTables();
  const row = queryOne(
    `SELECT COUNT(DISTINCT customer_id) as c
     FROM git_cards_cycles`,
  );
  return Number(row?.c || 0);
}

function cardStyles() {
  return Object.entries(CARD_STYLES).map(([id, colors]) => ({ id, ...colors }));
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
  recordSurvey,
  customerHasSurvey,
  processExpirations,
  summaryCount,
  cardStyles,
  maskDoc,
  programIsOpen,
  createLoyaltyContinueSession,
  readLoyaltyContinue,
  linkLoyaltyContinue,
  publicProgramSummary,
  publicGitHint,
  sanitizedRewards,
  findCustomerByIdentity,
  attachLoyaltySurveyAsGitEvidence,
};
