#!/usr/bin/env node
/**
 * Pruebas GIT Cards con datos aislados (DB temporal).
 * Cubre reglas de configuración, elegibilidad, avance automático al cobro,
 * selector de Caja, recompensa única, canje único, encuesta y reinicio.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'git-cards-verify-secret';
process.env.DB_PATH = path.join(os.tmpdir(), `git-cards-verify-${Date.now()}.db`);

const { initDatabase, runSql, queryOne, queryAll, ensureLoyaltySurveysTable } = require('../server/database');
const git = require('../server/gitCardsService');

const results = [];

function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log(`  OK  ${name}`);
  } catch (err) {
    results.push({ name, ok: false, error: err.message });
    console.error(`  FAIL ${name}: ${err.message}`);
    throw err;
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  OK  ${name}`);
  } catch (err) {
    results.push({ name, ok: false, error: err.message });
    console.error(`  FAIL ${name}: ${err.message}`);
    throw err;
  }
}

function insertOrder({ customerId, restaurantId, total, status = 'delivered', payment = 'paid', method = 'efectivo' }) {
  const id = uuidv4();
  runSql(
    `INSERT INTO orders (id, order_number, customer_id, customer_name, restaurant_id, type, status, total, payment_method, payment_status)
     VALUES (?, ?, ?, 'GIT Test', ?, 'pickup', ?, ?, ?, ?)`,
    [id, Math.floor(Math.random() * 90000) + 1000, customerId, restaurantId, status, total, method, payment],
  );
  return id;
}

async function main() {
  console.log('GIT Cards — pruebas unitarias de reglas');
  check('S/ 249.99 no cumple mínimo 250', () => {
    assert.strictEqual(git.isEligibleAmount(249.99, 250), false);
  });
  check('S/ 250 cumple mínimo 250', () => {
    assert.strictEqual(git.isEligibleAmount(250, 250), true);
  });
  check('configuración inválida no se acepta', () => {
    const errors = git.validateConfig(git.normalizeConfig({ min_spend: -1, goal: 0, enabled: true, reward_title: '' }));
    assert.ok(errors.length >= 3);
  });
  check('configuración de prueba 250 / 3 es válida', () => {
    const cfg = git.normalizeConfig({ min_spend: 250, goal: 3, reward_title: 'Postre', enabled: true });
    assert.strictEqual(cfg.min_spend, 250);
    assert.strictEqual(cfg.goal, 3);
    assert.deepStrictEqual(git.validateConfig(cfg), []);
  });

  console.log('\nGIT Cards — persistencia y flujo (DB temporal)');
  await initDatabase();
  git.ensureGitCardsTables();

  const restaurant = queryOne('SELECT id FROM restaurants LIMIT 1');
  assert.ok(restaurant?.id, 'Debe existir restaurante de seed');
  const customerId = `git-test-${uuidv4()}`;
  runSql(
    `INSERT INTO customers (id, name, email, password_hash, phone, doc_number)
     VALUES (?, 'Cliente GIT Test', ?, 'x', '999111222', '12345678')`,
    [customerId, `${customerId}@git.test`],
  );

  await checkAsync('B. persistencia de configuración 250 / 3', () => {
    const saved = git.saveConfig({
      enabled: true,
      min_spend: 250,
      goal: 3,
      reward_title: 'Postre de cortesía',
      survey_required: false,
      auto_reset: true,
      cycle_valid_days: 90,
      reward_valid_days: 30,
    }, { id: 'verify', username: 'verify' });
    assert.strictEqual(saved.min_spend, 250);
    assert.strictEqual(saved.goal, 3);
    const again = git.getConfig();
    assert.strictEqual(again.min_spend, 250);
    assert.strictEqual(again.goal, 3);
  });

  await checkAsync('C. compra 249.99 no genera avance', () => {
    const orderId = insertOrder({ customerId, restaurantId: restaurant.id, total: 249.99 });
    const result = git.considerPaidOrder(orderId, { id: 'caja', username: 'caja' });
    assert.strictEqual(result.skipped, 'min_spend');
    const row = queryOne('SELECT * FROM git_cards_advances WHERE order_id = ?', [orderId]);
    assert.ok(!row);
  });

  let firstEligible;
  await checkAsync('D. compra 250 registra un avance automático', () => {
    git.getOrCreateActiveCycle(customerId);
    firstEligible = insertOrder({ customerId, restaurantId: restaurant.id, total: 250 });
    const result = git.considerPaidOrder(firstEligible, { id: 'caja', username: 'caja' });
    assert.strictEqual(result.approved, true);
    assert.strictEqual(result.advance.status, 'approved');
    const profile = git.getMemberProfile(customerId);
    assert.strictEqual(profile.card.progress.confirmed, 1);
    assert.strictEqual(profile.card.progress.pending, 0);
    const retry = git.considerPaidOrder(firstEligible, { id: 'caja', username: 'caja' });
    assert.strictEqual(retry.skipped, 'already');
    const again = git.getMemberProfile(customerId);
    assert.strictEqual(again.card.progress.confirmed, 1);
    assert.strictEqual(
      queryAll('SELECT id FROM git_cards_advances WHERE order_id = ?', [firstEligible]).length,
      1,
    );
  });

  await checkAsync('E. decideAdvance sobre un avance ya confirmado es idempotente', () => {
    const first = git.decideAdvance(queryOne('SELECT id FROM git_cards_advances WHERE order_id = ?', [firstEligible]).id, 'approve', '', { id: 'caja', username: 'caja' });
    assert.strictEqual(first.already, true);
    const profile = git.getMemberProfile(customerId);
    assert.strictEqual(profile.card.progress.confirmed, 1);
  });

  await checkAsync('F. rechazo de pendiente legado conserva motivo y no suma', () => {
    const orderId = insertOrder({ customerId, restaurantId: restaurant.id, total: 260 });
    const cycle = queryOne(
      "SELECT * FROM git_cards_cycles WHERE customer_id = ? AND status = 'active' ORDER BY datetime(started_at) DESC LIMIT 1",
      [customerId],
    );
    const advanceId = uuidv4();
    runSql(
      `INSERT INTO git_cards_advances
        (id, cycle_id, customer_id, restaurant_id, order_id, amount, status, survey_ok)
       VALUES (?, ?, ?, ?, ?, 260, 'pending', 1)`,
      [advanceId, cycle.id, customerId, restaurant.id, orderId],
    );
    const decided = git.decideAdvance(advanceId, 'reject', 'Ticket no corresponde al cliente', { id: 'caja', username: 'caja' });
    assert.strictEqual(decided.advance.status, 'rejected');
    const profile = git.getMemberProfile(customerId);
    assert.strictEqual(profile.card.progress.confirmed, 1);
    assert.ok(profile.advances.some((a) => a.status === 'rejected' && /Ticket/.test(a.reject_reason)));
  });

  let rewardId;
  await checkAsync('G. tres cobros elegibles emiten una sola recompensa', () => {
    const second = insertOrder({ customerId, restaurantId: restaurant.id, total: 250 });
    const third = insertOrder({ customerId, restaurantId: restaurant.id, total: 300 });
    const a2 = git.considerPaidOrder(second, { id: 'caja', username: 'caja' });
    const last = git.considerPaidOrder(third, { id: 'caja', username: 'caja' });
    assert.strictEqual(a2.approved, true);
    assert.ok(last.completed);
    assert.ok(last.reward);
    const rewards = queryAll('SELECT * FROM git_cards_rewards WHERE customer_id = ?', [customerId]);
    assert.strictEqual(rewards.length, 1);
    git.considerPaidOrder(third, { id: 'caja', username: 'caja' });
    const rewardsAgain = queryAll('SELECT * FROM git_cards_rewards WHERE customer_id = ?', [customerId]);
    assert.strictEqual(rewardsAgain.length, 1);
    rewardId = rewards[0].id;
    const cycles = queryAll('SELECT * FROM git_cards_cycles WHERE customer_id = ?', [customerId]);
    assert.ok(cycles.some((c) => c.status === 'completed'));
    assert.ok(cycles.some((c) => c.status === 'active'), 'auto-reset debe abrir un ciclo nuevo');
  });

  await checkAsync('H. canje único', () => {
    const used = git.redeemReward(rewardId, { id: 'caja', username: 'caja' });
    assert.strictEqual(used.status, 'used');
    let rejected = false;
    try {
      git.redeemReward(rewardId, { id: 'caja', username: 'caja' });
    } catch (err) {
      rejected = err.status === 409 || /ya fue canjeada/i.test(err.message);
    }
    assert.ok(rejected, 'el segundo canje debe rechazarse');
  });

  await checkAsync('I. encuesta obligatoria bloquea elegibilidad', () => {
    git.saveConfig({ survey_required: true }, { id: 'verify', username: 'verify' });
    const otherId = `git-test-${uuidv4()}`;
    runSql(
      `INSERT INTO customers (id, name, email, password_hash, phone) VALUES (?, 'Cliente Encuesta', ?, 'x', '999000111')`,
      [otherId, `${otherId}@git.test`],
    );
    git.getOrCreateActiveCycle(otherId);
    const orderId = insertOrder({ customerId: otherId, restaurantId: restaurant.id, total: 250 });
    const blocked = git.considerPaidOrder(orderId, { id: 'caja', username: 'caja' });
    assert.strictEqual(blocked.skipped, 'survey');
    git.recordSurvey(otherId, { rating: 5 });
    const allowed = git.considerPaidOrder(orderId, { id: 'caja', username: 'caja' });
    assert.strictEqual(allowed.approved, true);
    git.saveConfig({ survey_required: false }, { id: 'verify', username: 'verify' });
  });

  await checkAsync('I. enlace personal no expone DNI completo', () => {
    const access = git.getOrCreateAccess(customerId);
    const customer = queryOne('SELECT id, name, phone, doc_number FROM customers WHERE id = ?', [customerId]);
    const card = git.publicCardPayload(customer);
    assert.ok(access.token);
    assert.ok(!String(card.customer.doc_masked).includes('12345678'));
    assert.ok(card.customer.doc_masked.endsWith('678'));
    const other = git.findAccessByToken('token-ajeno-inexistente');
    assert.strictEqual(other, null);
  });

  await checkAsync('J. aislamiento por restaurante', () => {
    const foreign = insertOrder({ customerId, restaurantId: restaurant.id, total: 250 });
    const pending = git.considerPaidOrder(foreign, { id: 'caja', username: 'caja' });
    runSql("UPDATE git_cards_advances SET restaurant_id = 'otro-restaurante' WHERE id = ?", [pending.advance.id]);
    let denied = false;
    try {
      git.decideAdvance(pending.advance.id, 'approve', '', { id: 'caja', username: 'caja' });
    } catch (err) {
      denied = err.status === 403;
    }
    assert.ok(denied);
  });

  await checkAsync('K. vencimiento y reinicio conservan historial', () => {
    const cycle = queryOne(
      "SELECT * FROM git_cards_cycles WHERE customer_id = ? AND status = 'active' ORDER BY datetime(started_at) DESC LIMIT 1",
      [customerId],
    );
    assert.ok(cycle);
    runSql("UPDATE git_cards_cycles SET expires_at = ? WHERE id = ?", ['2000-01-01T00:00:00.000Z', cycle.id]);
    git.processExpirations();
    git.processExpirations();
    const cycles = queryAll('SELECT * FROM git_cards_cycles WHERE customer_id = ?', [customerId]);
    const expired = cycles.filter((c) => c.id === cycle.id && c.status === 'expired');
    const active = cycles.filter((c) => c.status === 'active');
    assert.strictEqual(expired.length, 1);
    assert.strictEqual(active.length, 1);
    const events = queryAll("SELECT * FROM git_cards_events WHERE customer_id = ? AND kind = 'cycle_expired'", [customerId]);
    assert.strictEqual(events.length, 1);
    const history = queryAll('SELECT * FROM git_cards_advances WHERE customer_id = ?', [customerId]);
    assert.ok(history.length >= 3);
  });

  await checkAsync('Fidelización A-B. encuesta genera continuación y no avanza', () => {
    ensureLoyaltySurveysTable();
    const surveyId = uuidv4();
    runSql(
      `INSERT INTO loyalty_surveys (id, customer_name, comment, rating, answers_json, visit_area, party_size)
       VALUES (?, 'Cliente Encuesta Flujo', '', 5, '{}', 'restaurante', 2)`,
      [surveyId],
    );
    const token = git.createLoyaltyContinueSession(surveyId);
    const opened = git.readLoyaltyContinue(token);
    assert.strictEqual(opened.linked, false);
    assert.ok(opened.survey);
    const advances = queryAll('SELECT * FROM git_cards_advances WHERE customer_id = ?', [customerId]);
    assert.ok(!advances.some((a) => a.order_id === surveyId));
    const token2 = git.createLoyaltyContinueSession(surveyId);
    assert.notStrictEqual(token, token2);
  });

  await checkAsync('Fidelización C-D. registro nuevo y recuperación sin duplicar', () => {
    const surveyId = uuidv4();
    runSql(
      `INSERT INTO loyalty_surveys (id, customer_name, comment, rating, answers_json, visit_area, party_size)
       VALUES (?, 'Ana GIT Fidel', '', 5, '{}', 'restaurante', 2)`,
      [surveyId],
    );
    const token = git.createLoyaltyContinueSession(surveyId);
    const first = git.linkLoyaltyContinue(token, { name: 'Ana GIT Fidel', phone: '987654321', doc_number: '87654321' });
    assert.strictEqual(first.created_customer, true);
    assert.ok(first.card);
    const same = git.linkLoyaltyContinue(token, { name: 'Ana GIT Fidel', phone: '987654321' });
    assert.strictEqual(same.created_customer, false);
    const tokenB = git.createLoyaltyContinueSession('');
    const recovered = git.linkLoyaltyContinue(tokenB, { name: 'Ana GIT Fidel', phone: '987654321' });
    assert.strictEqual(recovered.created_customer, false);
    assert.strictEqual(recovered.card.customer.name, first.card.customer.name);
    const customers = queryAll("SELECT id FROM customers WHERE phone LIKE '%987654321%' OR doc_number = '87654321'");
    assert.strictEqual(customers.length, 1);
  });

  await checkAsync('Fidelización E-G. encuesta no crea avance; cobro elegible sí suma', () => {
    const ana = queryOne("SELECT * FROM customers WHERE doc_number = '87654321'");
    const before = git.getMemberProfile(ana.id);
    const confirmed = before.card.progress.confirmed;
    const surveyId = uuidv4();
    runSql(
      `INSERT INTO loyalty_surveys (id, customer_name, comment, rating, answers_json, visit_area, party_size, customer_id)
       VALUES (?, 'Ana GIT Fidel', '', 5, '{}', 'restaurante', 2, ?)`,
      [surveyId, ana.id],
    );
    git.attachLoyaltySurveyAsGitEvidence(ana.id, surveyId);
    git.attachLoyaltySurveyAsGitEvidence(ana.id, surveyId);
    const evidence = queryAll('SELECT * FROM git_cards_surveys WHERE loyalty_survey_id = ?', [surveyId]);
    assert.strictEqual(evidence.length, 1);
    const afterSurvey = git.getMemberProfile(ana.id);
    assert.strictEqual(afterSurvey.card.progress.confirmed, confirmed);
    const orderId = insertOrder({ customerId: ana.id, restaurantId: restaurant.id, total: 250 });
    const paid = git.considerPaidOrder(orderId, { id: 'caja', username: 'caja' });
    assert.strictEqual(paid.approved, true);
    const after = git.getMemberProfile(ana.id);
    assert.strictEqual(after.card.progress.confirmed, confirmed + 1);
    assert.ok((after.surveys || []).length >= 1);
  });

  await checkAsync('Fidelización H. recompensa visible sin canje automático', () => {
    git.saveConfig({ survey_required: false, min_spend: 10, goal: 1, reward_title: 'Café' }, { id: 'verify', username: 'verify' });
    const cid = `git-test-${uuidv4()}`;
    runSql(
      `INSERT INTO customers (id, name, email, password_hash, phone) VALUES (?, 'Reward Pub', ?, 'x', '911111111')`,
      [cid, `${cid}@git.test`],
    );
    git.getOrCreateActiveCycle(cid);
    const o1 = insertOrder({ customerId: cid, restaurantId: restaurant.id, total: 20 });
    const decided = git.considerPaidOrder(o1, { id: 'caja', username: 'caja' });
    assert.ok(decided.reward);
    const customer = queryOne('SELECT id, name, phone, doc_number FROM customers WHERE id = ?', [cid]);
    const card = git.publicCardPayload(customer);
    assert.strictEqual(card.status, 'reward_available');
    assert.ok(card.rewards_public.some((r) => r.status === 'available'));
    assert.ok(!JSON.stringify(card).includes('redeemed_by'));
    const still = queryOne("SELECT status FROM git_cards_rewards WHERE customer_id = ?", [cid]);
    assert.strictEqual(still.status, 'available');
  });

  await checkAsync('Fidelización I. sesión de otro restaurante se niega', () => {
    const token = git.createLoyaltyContinueSession('');
    runSql("UPDATE git_cards_loyalty_sessions SET restaurant_id = 'otro-rest' WHERE token = ?", [token]);
    let denied = false;
    try {
      git.readLoyaltyContinue(token);
    } catch (err) {
      denied = err.status === 404;
    }
    assert.ok(denied);
  });

  await checkAsync('Público. consulta por nombre y DNI sin crear tarjeta', () => {
    const ana = queryOne("SELECT * FROM customers WHERE doc_number = '87654321'");
    const cyclesBefore = queryAll('SELECT id FROM git_cards_cycles WHERE customer_id = ?', [ana.id]).length;
    const found = git.lookupPublicGitCard({ name: 'Ana GIT Fidel', doc_number: '87654321' });
    assert.ok(found.card);
    assert.strictEqual(found.created_customer, false);
    const cyclesAfter = queryAll('SELECT id FROM git_cards_cycles WHERE customer_id = ?', [ana.id]).length;
    assert.strictEqual(cyclesAfter, cyclesBefore);
    let missed = false;
    try {
      git.lookupPublicGitCard({ name: 'Otra Persona', doc_number: '87654321' });
    } catch (err) {
      missed = err.status === 404 && /No encontramos/i.test(err.message);
    }
    assert.ok(missed);
    let unknown = false;
    try {
      git.lookupPublicGitCard({ name: 'Ana GIT Fidel', doc_number: '00000000' });
    } catch (err) {
      unknown = err.status === 404 && /No encontramos/i.test(err.message);
      assert.ok(!String(err.message).includes('Ana'));
    }
    assert.ok(unknown);
  });

  await checkAsync('Caja. selector busca por nombre, inicial y DNI', () => {
    const byName = git.listEligibleCajaClients('Cliente GIT');
    assert.ok(byName.program_open);
    assert.ok(byName.rows.some((row) => row.id === customerId));
    const byLetter = git.listEligibleCajaClients('c');
    assert.ok(byLetter.rows.some((row) => row.id === customerId));
    const byDni = git.listEligibleCajaClients('12345678');
    assert.ok(byDni.rows.some((row) => row.id === customerId));
    assert.ok(!JSON.stringify(byDni.rows).includes('12345678'));
    const stranger = git.listEligibleCajaClients('zzz-no-existe');
    assert.ok(!stranger.rows.some((row) => row.id === customerId));
  });

  await checkAsync('Caja. vista previa no modifica el progreso', () => {
    const before = git.getMemberProfile(customerId);
    const preview = git.previewCajaGitCustomer(customerId);
    assert.strictEqual(preview.customer.id, customerId);
    assert.ok(preview.card);
    const after = git.getMemberProfile(customerId);
    assert.strictEqual(after.card.progress.confirmed, before.card.progress.confirmed);
    assert.strictEqual(after.advances.length, before.advances.length);
  });

  await checkAsync('Admin. indicadores coinciden con persistencia y no duplican', () => {
    const summary = git.adminDashboardSummary();
    const restaurantId = restaurant.id;
    const registered = Number(queryOne(
      `SELECT COUNT(*) as c FROM (
         SELECT customer_id FROM git_cards_cycles x
         WHERE IFNULL(x.restaurant_id, '') IN ('', ?)
           AND EXISTS (SELECT 1 FROM customers c WHERE c.id = x.customer_id)
         UNION
         SELECT customer_id FROM git_cards_access x
         WHERE IFNULL(x.restaurant_id, '') IN ('', ?)
           AND EXISTS (SELECT 1 FROM customers c WHERE c.id = x.customer_id)
       )`,
      [restaurantId, restaurantId],
    )?.c || 0);
    const active = Number(queryOne(
      `SELECT COUNT(DISTINCT customer_id) as c FROM git_cards_cycles
       WHERE status = 'active'
         AND IFNULL(restaurant_id, '') IN ('', ?)
         AND (IFNULL(expires_at, '') = '' OR datetime(expires_at) > datetime('now'))`,
      [restaurantId],
    )?.c || 0);
    const pending = Number(queryOne(
      `SELECT COUNT(*) as c FROM git_cards_advances
       WHERE status = 'pending' AND IFNULL(restaurant_id, '') IN ('', ?)`,
      [restaurantId],
    )?.c || 0);
    const rewards = Number(queryOne(
      `SELECT COUNT(*) as c FROM git_cards_rewards
       WHERE status = 'available'
         AND IFNULL(restaurant_id, '') IN ('', ?)
         AND (IFNULL(expires_at, '') = '' OR datetime(expires_at) > datetime('now'))`,
      [restaurantId],
    )?.c || 0);
    const inactive = Number(queryOne(
      `SELECT COUNT(*) as c FROM (
         SELECT DISTINCT customer_id FROM git_cards_cycles
         WHERE IFNULL(restaurant_id, '') IN ('', ?)
       ) enrolled
       WHERE enrolled.customer_id NOT IN (
         SELECT DISTINCT customer_id FROM git_cards_cycles
         WHERE status = 'active'
           AND IFNULL(restaurant_id, '') IN ('', ?)
           AND (IFNULL(expires_at, '') = '' OR datetime(expires_at) > datetime('now'))
       )`,
      [restaurantId, restaurantId],
    )?.c || 0);
    const near = Number(queryOne(
      `SELECT COUNT(DISTINCT customer_id) as c FROM git_cards_cycles
       WHERE status = 'active'
         AND IFNULL(restaurant_id, '') IN ('', ?)
         AND goal >= 1
         AND (IFNULL(expires_at, '') = '' OR datetime(expires_at) > datetime('now'))
         AND (
           SELECT COUNT(*) FROM git_cards_advances a
           WHERE a.cycle_id = git_cards_cycles.id AND a.status = 'approved'
         ) = (goal - 1)`,
      [restaurantId],
    )?.c || 0);
    assert.strictEqual(summary.registered, registered);
    assert.strictEqual(summary.active_cards, active);
    assert.strictEqual(summary.inactive_cards, inactive);
    assert.strictEqual(summary.near_complete, near);
    assert.strictEqual(summary.pending_purchases, pending);
    assert.strictEqual(summary.available_rewards, rewards);
    assert.strictEqual(summary.registered, git.summaryCount());
    const byDni = git.listMembers({ q: '12345678', pageSize: 50 });
    assert.ok(byDni.rows.some((row) => row.customer_id === customerId));
    assert.ok(!JSON.stringify(byDni.rows).includes('12345678'));
    const actives = git.listMembers({ status: 'active', pageSize: 50 });
    assert.ok(actives.rows.every((row) => row.status === 'active' || (row.status_flags || []).includes('active')));
    const rewardsList = git.listMembers({ status: 'reward_available', pageSize: 50 });
    assert.ok(rewardsList.rows.every((row) => row.status === 'reward_available' || (row.status_flags || []).includes('reward_available')));
    const preview = git.previewCajaGitCustomer(customerId);
    const before = git.getMemberProfile(customerId);
    const afterPreview = git.getMemberProfile(customerId);
    assert.ok(preview.card);
    assert.strictEqual(afterPreview.card.progress.confirmed, before.card.progress.confirmed);
  });

  await checkAsync('Admin. próximos a completar usan meta vigente y no cuentan pendientes', () => {
    git.saveConfig({ min_spend: 10, goal: 3, survey_required: false, reward_title: 'Postre de cortesía' }, { id: 'verify', username: 'verify' });
    const cid = `git-test-${uuidv4()}`;
    runSql(
      `INSERT INTO customers (id, name, email, password_hash, phone, doc_number)
       VALUES (?, 'Cerca Meta', ?, 'x', '922222222', '55556666')`,
      [cid, `${cid}@git.test`],
    );
    git.getOrCreateActiveCycle(cid);
    const before = git.adminDashboardSummary().near_complete;
    const o1 = insertOrder({ customerId: cid, restaurantId: restaurant.id, total: 20 });
    const o2 = insertOrder({ customerId: cid, restaurantId: restaurant.id, total: 20 });
    git.considerPaidOrder(o1, { id: 'caja', username: 'caja' });
    git.considerPaidOrder(o2, { id: 'caja', username: 'caja' });
    assert.strictEqual(git.adminDashboardSummary().near_complete, before + 1);
    const pendingOrder = insertOrder({ customerId: cid, restaurantId: restaurant.id, total: 20 });
    const cycle = queryOne(
      "SELECT * FROM git_cards_cycles WHERE customer_id = ? AND status = 'active' ORDER BY datetime(started_at) DESC LIMIT 1",
      [cid],
    );
    runSql(
      `INSERT INTO git_cards_advances
        (id, cycle_id, customer_id, restaurant_id, order_id, amount, status, survey_ok)
       VALUES (?, ?, ?, ?, ?, 20, 'pending', 1)`,
      [uuidv4(), cycle.id, cid, restaurant.id, pendingOrder],
    );
    assert.strictEqual(git.adminDashboardSummary().near_complete, before + 1);
    const o3 = insertOrder({ customerId: cid, restaurantId: restaurant.id, total: 20 });
    git.considerPaidOrder(o3, { id: 'caja', username: 'caja' });
    assert.strictEqual(git.adminDashboardSummary().near_complete, before);
  });

  await checkAsync('Admin. agregar cliente reutiliza registro y no duplica tarjeta', () => {
    const first = git.enrollStaffCustomer({
      name: 'Nuevo GIT Admin',
      phone: '933333333',
      doc_type: '1',
      doc_number: '77778888',
    }, { id: 'caja', username: 'caja' });
    assert.strictEqual(first.created_customer, true);
    assert.strictEqual(first.already_enrolled, false);
    const advances = queryAll('SELECT id FROM git_cards_advances WHERE customer_id = ?', [first.customer.id]);
    assert.strictEqual(advances.length, 0);
    const again = git.enrollStaffCustomer({
      name: 'Nuevo GIT Admin',
      phone: '933333333',
      doc_type: '1',
      doc_number: '77778888',
    }, { id: 'caja', username: 'caja' });
    assert.strictEqual(again.created_customer, false);
    assert.strictEqual(again.already_enrolled, true);
    assert.strictEqual(again.customer.id, first.customer.id);
    const customers = queryAll("SELECT id FROM customers WHERE doc_number = '77778888'");
    assert.strictEqual(customers.length, 1);
    const cycles = queryAll('SELECT id FROM git_cards_cycles WHERE customer_id = ?', [first.customer.id]);
    assert.strictEqual(cycles.length, 1);
    const plainId = `git-test-${uuidv4()}`;
    runSql(
      `INSERT INTO customers (id, name, email, password_hash, phone, doc_number)
       VALUES (?, 'Cliente Maestro', ?, 'x', '944444444', '66667777')`,
      [plainId, `${plainId}@git.test`],
    );
    const existing = git.enrollStaffCustomer({
      name: 'Cliente Maestro',
      phone: '944444444',
      doc_type: '1',
      doc_number: '66667777',
    }, { id: 'caja', username: 'caja' });
    assert.strictEqual(existing.created_customer, false);
    assert.strictEqual(existing.linked, true);
    assert.strictEqual(existing.customer.id, plainId);
    assert.ok(queryOne("SELECT id FROM git_cards_cycles WHERE customer_id = ? AND status = 'active'", [plainId]));
  });

  await checkAsync('Caja. cobro fallido, cancelado o sin cliente no avanza', () => {
    const unpaid = insertOrder({ customerId, restaurantId: restaurant.id, total: 250, payment: 'pending' });
    assert.strictEqual(git.considerPaidOrder(unpaid, { id: 'caja', username: 'caja' }).skipped, 'unpaid');
    const cancelled = insertOrder({
      customerId,
      restaurantId: restaurant.id,
      total: 250,
      status: 'cancelled',
    });
    assert.strictEqual(git.considerPaidOrder(cancelled, { id: 'caja', username: 'caja' }).skipped, 'cancelled');
    const noCustomer = insertOrder({ customerId: '', restaurantId: restaurant.id, total: 250 });
    assert.strictEqual(git.considerPaidOrder(noCustomer, { id: 'caja', username: 'caja' }).skipped, 'no_customer');
    const noCardId = `git-test-${uuidv4()}`;
    runSql(
      `INSERT INTO customers (id, name, email, password_hash, phone) VALUES (?, 'Sin Tarjeta', ?, 'x', '900000000')`,
      [noCardId, `${noCardId}@git.test`],
    );
    const noCardOrder = insertOrder({ customerId: noCardId, restaurantId: restaurant.id, total: 250 });
    assert.strictEqual(git.considerPaidOrder(noCardOrder, { id: 'caja', username: 'caja' }).skipped, 'no_active_card');
  });

  await checkAsync('Público. registro reutiliza tarjeta y no suma avance', () => {
    const ana = queryOne("SELECT * FROM customers WHERE doc_number = '87654321'");
    const before = git.getMemberProfile(ana.id);
    const token = git.createLoyaltyContinueSession('');
    const again = git.linkLoyaltyContinue(token, { name: 'Ana GIT Fidel', phone: '987654321', doc_number: '87654321' });
    assert.strictEqual(again.created_customer, false);
    const after = git.getMemberProfile(ana.id);
    assert.strictEqual(after.card.progress.confirmed, before.card.progress.confirmed);
    assert.strictEqual(after.rewards.length, before.rewards.length);
  });

  const productId = `git-prod-${uuidv4()}`;
  runSql(
    `INSERT INTO products (id, name, price, stock, is_active, restaurant_id, process_type)
     VALUES (?, 'Postre GIT Catálogo', 12, 10, 1, ?, 'non_transformed')`,
    [productId, restaurant.id],
  );

  let courtesyPromo;
  let courtesyCustomer;
  await checkAsync('Promo A. producto de cortesía desde catálogo real', () => {
    courtesyPromo = git.createPromotion({
      name: 'Postre de cortesía',
      description: 'Completa y recibe postre',
      start_at: '2020-01-01T00:00:00.000Z',
      min_spend: 20,
      goal: 2,
      reward_kind: 'product',
      product_id: productId,
      product_qty: 1,
      card_style: 'blue',
    }, { id: 'verify', username: 'verify' }, { activate: true });
    assert.strictEqual(courtesyPromo.status, 'active');
    assert.strictEqual(courtesyPromo.product_id, productId);
    assert.strictEqual(courtesyPromo.product_name, 'Postre GIT Catálogo');
    let rejected = false;
    try {
      git.createPromotion({
        name: 'Inválida',
        reward_kind: 'product',
        min_spend: 10,
        goal: 2,
        card_style: 'blue',
      }, { id: 'verify' }, { activate: true });
    } catch (err) {
      rejected = err.status === 400;
    }
    assert.ok(rejected, 'no se activa sin producto del catálogo');
  });

  await checkAsync('Promo B-C. emitir recompensa única no descuenta inventario', () => {
    courtesyCustomer = `git-promo-${uuidv4()}`;
    runSql(
      `INSERT INTO customers (id, name, email, password_hash, phone) VALUES (?, 'Cliente Cortesía', ?, 'x', '911111111')`,
      [courtesyCustomer, `${courtesyCustomer}@git.test`],
    );
    git.getOrCreateActiveCycle(courtesyCustomer, git.promotionToConfig(courtesyPromo));
    const stockBefore = Number(queryOne('SELECT stock FROM products WHERE id = ?', [productId]).stock);
    const first = insertOrder({ customerId: courtesyCustomer, restaurantId: restaurant.id, total: 25 });
    const second = insertOrder({ customerId: courtesyCustomer, restaurantId: restaurant.id, total: 25 });
    assert.strictEqual(git.considerPaidOrder(first, { id: 'caja', username: 'caja' }).approved, true);
    const last = git.considerPaidOrder(second, { id: 'caja', username: 'caja' });
    assert.ok(last.completed);
    assert.ok(last.reward);
    const rewards = queryAll('SELECT * FROM git_cards_rewards WHERE customer_id = ?', [courtesyCustomer]);
    assert.strictEqual(rewards.length, 1);
    assert.strictEqual(rewards[0].reward_kind, 'product');
    assert.strictEqual(rewards[0].product_id, productId);
    assert.strictEqual(rewards[0].status, 'available');
    assert.strictEqual(Number(rewards[0].inventory_applied || 0), 0);
    const stockAfterIssue = Number(queryOne('SELECT stock FROM products WHERE id = ?', [productId]).stock);
    assert.strictEqual(stockAfterIssue, stockBefore);
    git.considerPaidOrder(second, { id: 'caja', username: 'caja' });
    assert.strictEqual(queryAll('SELECT id FROM git_cards_rewards WHERE customer_id = ?', [courtesyCustomer]).length, 1);
  });

  await checkAsync('Promo D. canje descuenta inventario una sola vez', () => {
    const reward = queryOne('SELECT * FROM git_cards_rewards WHERE customer_id = ?', [courtesyCustomer]);
    const stockBefore = Number(queryOne('SELECT stock FROM products WHERE id = ?', [productId]).stock);
    const used = git.redeemReward(reward.id, { id: 'caja', username: 'caja' });
    assert.strictEqual(used.status, 'used');
    assert.strictEqual(Number(used.inventory_applied), 1);
    const stockAfter = Number(queryOne('SELECT stock FROM products WHERE id = ?', [productId]).stock);
    assert.strictEqual(stockAfter, stockBefore - 1);
    let rejected = false;
    try {
      git.redeemReward(reward.id, { id: 'caja', username: 'caja' });
    } catch (err) {
      rejected = err.status === 409;
    }
    assert.ok(rejected);
    assert.strictEqual(Number(queryOne('SELECT stock FROM products WHERE id = ?', [productId]).stock), stockAfter);
  });

  let percentPromo;
  let percentRewardId;
  await checkAsync('Promo E. descuento porcentual se aplica en cobro', () => {
    percentPromo = git.createPromotion({
      name: '10% GIT',
      min_spend: 10,
      goal: 1,
      reward_kind: 'discount',
      discount_type: 'percent',
      discount_value: 10,
      card_style: 'green',
    }, { id: 'verify' }, { activate: true });
    const cid = `git-pct-${uuidv4()}`;
    runSql(
      `INSERT INTO customers (id, name, email, password_hash) VALUES (?, 'Cliente %', ?, 'x')`,
      [cid, `${cid}@git.test`],
    );
    git.getOrCreateActiveCycle(cid, git.promotionToConfig(percentPromo));
    const paid = insertOrder({ customerId: cid, restaurantId: restaurant.id, total: 100 });
    const done = git.considerPaidOrder(paid, { id: 'caja' });
    assert.ok(done.reward);
    percentRewardId = done.reward.id;
    const unpaidId = uuidv4();
    runSql(
      `INSERT INTO orders (id, order_number, customer_id, restaurant_id, type, status, total, discount, payment_status)
       VALUES (?, 8001, ?, ?, 'dine_in', 'pending', 100, 0, 'pending')`,
      [unpaidId, cid, restaurant.id],
    );
    const applied = git.applyDiscountRewardToOrder(percentRewardId, unpaidId, { id: 'caja', username: 'caja' });
    assert.strictEqual(applied.discount, 10);
    assert.strictEqual(Number(applied.order.total), 90);
    assert.strictEqual(applied.reward.status, 'used');
    let rejected = false;
    try {
      git.applyDiscountRewardToOrder(percentRewardId, unpaidId, { id: 'caja' });
    } catch (err) {
      rejected = err.status === 409 || err.status === 400;
    }
    assert.ok(rejected);
  });

  await checkAsync('Promo F. descuento fijo respeta tope y base', () => {
    const promo = git.createPromotion({
      name: 'S/ 20 tope 15',
      min_spend: 10,
      goal: 1,
      reward_kind: 'discount',
      discount_type: 'fixed',
      discount_value: 20,
      discount_max: 15,
      discount_min_spend: 50,
      card_style: 'green',
    }, { id: 'verify' }, { activate: true });
    const cid = `git-fix-${uuidv4()}`;
    runSql(
      `INSERT INTO customers (id, name, email, password_hash) VALUES (?, 'Cliente fijo', ?, 'x')`,
      [cid, `${cid}@git.test`],
    );
    git.getOrCreateActiveCycle(cid, git.promotionToConfig(promo));
    const paid = insertOrder({ customerId: cid, restaurantId: restaurant.id, total: 80 });
    const done = git.considerPaidOrder(paid, { id: 'caja' });
    const lowId = uuidv4();
    runSql(
      `INSERT INTO orders (id, order_number, customer_id, restaurant_id, type, status, total, discount, payment_status)
       VALUES (?, 8002, ?, ?, 'dine_in', 'pending', 40, 0, 'pending')`,
      [lowId, cid, restaurant.id],
    );
    let blocked = false;
    try {
      git.applyDiscountRewardToOrder(done.reward.id, lowId, { id: 'caja' });
    } catch (err) {
      blocked = /mínimo/i.test(err.message);
    }
    assert.ok(blocked);
    const okId = uuidv4();
    runSql(
      `INSERT INTO orders (id, order_number, customer_id, restaurant_id, type, status, total, discount, payment_status)
       VALUES (?, 8003, ?, ?, 'dine_in', 'pending', 80, 0, 'pending')`,
      [okId, cid, restaurant.id],
    );
    const applied = git.applyDiscountRewardToOrder(done.reward.id, okId, { id: 'caja' });
    assert.strictEqual(applied.discount, 15);
  });

  await checkAsync('Promo G. otro beneficio no toca inventario ni cobro', () => {
    const promo = git.createPromotion({
      name: 'Cumpleaños',
      min_spend: 10,
      goal: 1,
      reward_kind: 'other',
      other_name: 'Foto impresa',
      other_description: 'Se entrega en caja',
      card_style: 'wine',
    }, { id: 'verify' }, { activate: true });
    const cid = `git-other-${uuidv4()}`;
    runSql(
      `INSERT INTO customers (id, name, email, password_hash) VALUES (?, 'Cliente otro', ?, 'x')`,
      [cid, `${cid}@git.test`],
    );
    git.getOrCreateActiveCycle(cid, git.promotionToConfig(promo));
    const stockBefore = Number(queryOne('SELECT stock FROM products WHERE id = ?', [productId]).stock);
    const paid = insertOrder({ customerId: cid, restaurantId: restaurant.id, total: 30 });
    const done = git.considerPaidOrder(paid, { id: 'caja' });
    assert.strictEqual(done.reward.reward_kind, 'other');
    const used = git.redeemReward(done.reward.id, { id: 'caja' });
    assert.strictEqual(used.status, 'used');
    assert.strictEqual(Number(used.inventory_applied || 0), 0);
    assert.strictEqual(Number(queryOne('SELECT stock FROM products WHERE id = ?', [productId]).stock), stockBefore);
  });

  await checkAsync('Promo H. cada promoción conserva su propio diseño', () => {
    const blue = git.createPromotion({
      name: 'Azul',
      min_spend: 10,
      goal: 3,
      reward_kind: 'other',
      other_name: 'Azul',
      card_style: 'blue',
    }, { id: 'verify' }, { activate: true });
    const forest = git.createPromotion({
      name: 'Bosque',
      min_spend: 10,
      goal: 3,
      reward_kind: 'other',
      other_name: 'Bosque',
      card_style: 'forest',
    }, { id: 'verify' }, { activate: true });
    const a = `git-style-a-${uuidv4()}`;
    const b = `git-style-b-${uuidv4()}`;
    runSql('INSERT INTO customers (id, name, email, password_hash) VALUES (?, ?, ?, ?), (?, ?, ?, ?)', [
      a, 'Estilo A', `${a}@git.test`, 'x', b, 'Estilo B', `${b}@git.test`, 'x',
    ]);
    git.getOrCreateActiveCycle(a, git.promotionToConfig(blue));
    git.getOrCreateActiveCycle(b, git.promotionToConfig(forest));
    git.updatePromotion(blue.id, { ...blue, card_style: 'cream', confirm_affects_active: true }, { id: 'verify' });
    const cardA = git.publicCardPayload(queryOne('SELECT * FROM customers WHERE id = ?', [a]));
    const cardB = git.publicCardPayload(queryOne('SELECT * FROM customers WHERE id = ?', [b]));
    assert.strictEqual(cardA.card_style, 'blue');
    assert.strictEqual(cardB.card_style, 'forest');
    assert.notStrictEqual(cardA.colors.bg, cardB.colors.bg);
  });

  await checkAsync('Promo I-J. pausar, finalizar, vigencia y reinicio', () => {
    const promo = git.createPromotion({
      name: 'Pausa',
      min_spend: 10,
      goal: 3,
      reward_kind: 'other',
      other_name: 'Pausa',
      card_style: 'cream',
      auto_reset: true,
      cycle_valid_days: 30,
    }, { id: 'verify' }, { activate: true });
    const cid = `git-pause-${uuidv4()}`;
    runSql(
      `INSERT INTO customers (id, name, email, password_hash) VALUES (?, 'Pausa', ?, 'x')`,
      [cid, `${cid}@git.test`],
    );
    git.getOrCreateActiveCycle(cid, git.promotionToConfig(promo));
    const first = insertOrder({ customerId: cid, restaurantId: restaurant.id, total: 20 });
    assert.strictEqual(git.considerPaidOrder(first, { id: 'caja' }).approved, true);
    git.setPromotionStatus(promo.id, 'paused', { id: 'verify' });
    const second = insertOrder({ customerId: cid, restaurantId: restaurant.id, total: 20 });
    assert.strictEqual(git.considerPaidOrder(second, { id: 'caja' }).skipped, 'paused');
    assert.strictEqual(queryAll('SELECT id FROM git_cards_advances WHERE customer_id = ?', [cid]).length, 1);
    git.setPromotionStatus(promo.id, 'ended', { id: 'verify' });
    const history = queryAll('SELECT * FROM git_cards_advances WHERE customer_id = ?', [cid]);
    assert.strictEqual(history.length, 1);
    const ended = git.getPromotionDetail(promo.id);
    assert.strictEqual(ended.status, 'ended');
    let expiredOk = false;
    try {
      git.createPromotion({
        name: 'Vencida',
        start_at: '2020-01-01',
        end_at: '2020-01-02',
        min_spend: 10,
        goal: 1,
        reward_kind: 'other',
        other_name: 'X',
        card_style: 'blue',
      }, { id: 'verify' }, { activate: true });
    } catch (err) {
      expiredOk = /periodo/i.test(err.message);
    }
    assert.ok(expiredOk);
  });

  await checkAsync('Promo K. reintentos no duplican avance ni recompensa', () => {
    const promo = git.createPromotion({
      name: 'Idempotente',
      min_spend: 10,
      goal: 1,
      reward_kind: 'other',
      other_name: 'Uno',
      card_style: 'blue',
    }, { id: 'verify' }, { activate: true });
    const cid = `git-idemp-${uuidv4()}`;
    runSql(
      `INSERT INTO customers (id, name, email, password_hash) VALUES (?, 'Idem', ?, 'x')`,
      [cid, `${cid}@git.test`],
    );
    git.getOrCreateActiveCycle(cid, git.promotionToConfig(promo));
    const orderId = insertOrder({ customerId: cid, restaurantId: restaurant.id, total: 15 });
    const a = git.considerPaidOrder(orderId, { id: 'caja' });
    const b = git.considerPaidOrder(orderId, { id: 'caja' });
    assert.strictEqual(a.approved, true);
    assert.strictEqual(b.skipped, 'already');
    assert.strictEqual(queryAll('SELECT id FROM git_cards_advances WHERE order_id = ?', [orderId]).length, 1);
    assert.strictEqual(queryAll('SELECT id FROM git_cards_rewards WHERE customer_id = ?', [cid]).length, 1);
  });

  await checkAsync('Promo L. listado real y funciones existentes siguen operativas', () => {
    const listed = git.listPromotions();
    assert.ok(listed.active_promotions >= 1);
    assert.ok(listed.available_rewards >= 0);
    assert.ok(listed.promotions.some((p) => p.id === courtesyPromo.id));
    const dashboard = git.adminDashboardSummary();
    assert.strictEqual(listed.available_rewards, dashboard.available_rewards);
    const catalog = git.searchCatalogProducts('Postre GIT');
    assert.ok(catalog.some((p) => p.id === productId));
    const caja = git.listEligibleCajaClients('Cliente Cortesía');
    assert.ok(caja.program_open);
    const cfg = git.getConfig();
    assert.ok(cfg.goal >= 1);
    assert.ok(queryOne('SELECT id FROM git_cards_cycles WHERE customer_id = ?', [customerId]));
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\nResultado: ${results.length - failed.length}/${results.length} pruebas OK`);
  try { fs.unlinkSync(process.env.DB_PATH); } catch (_) { /* noop */ }
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  try { fs.unlinkSync(process.env.DB_PATH); } catch (_) { /* noop */ }
  process.exit(1);
});
