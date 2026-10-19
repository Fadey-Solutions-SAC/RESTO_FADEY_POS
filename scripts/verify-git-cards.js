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
         SELECT customer_id FROM git_cards_cycles WHERE IFNULL(restaurant_id, '') IN ('', ?)
         UNION
         SELECT customer_id FROM git_cards_access WHERE IFNULL(restaurant_id, '') IN ('', ?)
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
    assert.strictEqual(summary.registered, registered);
    assert.strictEqual(summary.active_cards, active);
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
