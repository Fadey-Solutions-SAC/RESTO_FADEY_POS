/**
 * Verifica el panel unificado de gastos sin tocar la base real.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcryptjs');
const express = require('express');
const { v4: uuidv4 } = require('uuid');

require('dotenv').config();
if (!String(process.env.JWT_SECRET || '').trim()) process.env.JWT_SECRET = 'gastos-dashboard-check-secret';
const dbDir = path.join(os.tmpdir(), `fadey-gastos-${Date.now()}`);
fs.mkdirSync(dbDir, { recursive: true });
const dbFile = path.join(dbDir, 'gastos.db');
process.env.DB_PATH = dbFile;

const { initDatabase, queryOne, runSql } = require('../server/database');
const { signStaffToken } = require('../server/utils/staffJwt');
const inventoryRouter = require('../server/routes/inventory');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function api(server, method, urlPath, { token, body } = {}) {
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

function cleanup() {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbFile + suffix); } catch (_) { /* temporal */ }
  }
  try { fs.rmdirSync(dbDir); } catch (_) { /* temporal */ }
}

async function main() {
  await initDatabase();
  const restaurantId = queryOne('SELECT id FROM restaurants LIMIT 1')?.id || null;
  const adminId = uuidv4();
  const cashierId = uuidv4();
  const password = 'Admin123!';
  const hash = bcrypt.hashSync(password, 10);
  runSql(
    `INSERT INTO users (id, username, email, password_hash, full_name, role, restaurant_id, is_active)
     VALUES (?, 'gastosadmin', 'gastosadmin@test.pe', ?, 'Admin Gastos', 'admin', ?, 1)`,
    [adminId, hash, restaurantId],
  );
  runSql(
    `INSERT INTO users (id, username, email, password_hash, full_name, role, restaurant_id, is_active)
     VALUES (?, 'gastoscaja', 'gastoscaja@test.pe', 'x', 'Caja Gastos', 'cajero', ?, 1)`,
    [cashierId, restaurantId],
  );
  const token = (id, role, name) => signStaffToken({
    id, username: id, role, full_name: name, restaurant_id: restaurantId,
  });
  const adminToken = token(adminId, 'admin', 'Admin Gastos');
  const cashierToken = token(cashierId, 'cajero', 'Caja Gastos');

  const app = express();
  app.use(express.json());
  app.use('/inventory', inventoryRouter);
  const server = await listen(app);
  try {
    const init = await api(server, 'GET', '/inventory/expenses-dashboard?from=2026-10-01&to=2026-10-12', { token: adminToken });
    assert(init.status === 200, `el panel debe inicializar tablas (${init.status})`);

    const purchaseId = uuidv4();
    runSql(
      `INSERT INTO inventory_expenses
       (id, requirement_id, product_id, warehouse_id, quantity, unit_cost, total_cost, notes, created_by, created_at, purchase_date)
       VALUES (?, 'req-uno', '', '', 100, 0.5, 50, 'Recepción de compra', ?, '2026-10-12 15:00:00', '2026-10-12')`,
      [purchaseId, adminId],
    );
    const legacyPurchaseId = uuidv4();
    runSql(
      `INSERT INTO inventory_expenses
       (id, requirement_id, product_id, warehouse_id, quantity, unit_cost, total_cost, notes, created_by, created_at, purchase_date)
       VALUES (?, 'req-historico', '', '', 10, 3, 30, 'Recepción histórica', ?, '2026-10-06 10:00:00', NULL)`,
      [legacyPurchaseId, adminId],
    );
    const registerId = uuidv4();
    runSql(
      `INSERT INTO cash_registers (id, user_id, restaurant_id, opening_amount, opened_at, caja_station_id)
       VALUES (?, ?, ?, 0, '2026-10-01 08:00:00', 'caja-test')`,
      [registerId, adminId, restaurantId],
    );
    const insertCash = (amount, concept, createdAt) => runSql(
      `INSERT INTO cash_movements (id, register_id, user_id, type, amount, concept, created_at)
       VALUES (?, ?, ?, 'expense', ?, ?, ?)`,
      [uuidv4(), registerId, adminId, amount, concept, createdAt],
    );
    insertCash(50, 'Compra por recepción (req-uno)', '2026-10-12 15:01:00');
    insertCash(320, 'Pago de electricidad', '2026-10-10 15:00:00');
    insertCash(85, 'Útiles varios', '2026-10-08 15:00:00');
    insertCash(100, 'Pago de electricidad', '2026-09-25 15:00:00');
    runSql(
      `INSERT INTO investment_movements (id, amount, concept, user_id, source, created_at)
       VALUES (?, 250, 'Pago de salario - Mozo', ?, 'payroll', '2026-10-09 09:00:00')`,
      [uuidv4(), cashierId],
    );
    runSql(
      `INSERT INTO finance_loss_events (id, category, amount, concept, occurred_at, created_at)
       VALUES (?, 'danio_propiedad', 25, 'Rotura de utensilio', '2026-10-07 11:00:00', '2026-10-07 11:00:00')`,
      [uuidv4()],
    );

    const panel = await api(server, 'GET', '/inventory/expenses-dashboard?from=2026-10-01&to=2026-10-12', { token: adminToken });
    assert(panel.status === 200, `el panel responde (${panel.status})`);
    assert(panel.json.summary.total === 760, `total esperado 760, salió ${panel.json.summary.total}`);
    const amounts = Object.fromEntries(panel.json.summary.by_category.map((row) => [row.id, row.amount]));
    assert(amounts.supplies === 80, `compras esperado 80, salió ${amounts.supplies}`);
    assert(amounts.operating === 320, `operativos esperado 320, salió ${amounts.operating}`);
    assert(amounts.staff === 250, `personal esperado 250, salió ${amounts.staff}`);
    assert(amounts.other === 110, `otros esperado 110, salió ${amounts.other}`);
    assert(!panel.json.rows.some((row) => row.concept.startsWith('Compra por recepción')), 'el egreso automático no se duplica');
    assert(panel.json.rows.some((row) => row.source_id === legacyPurchaseId && row.category === 'supplies'), 'la recepción histórica sin purchase_date sigue visible como compra de insumos');
    assert(panel.json.summary.variation_pct === 660, `variación esperada 660%, salió ${panel.json.summary.variation_pct}`);

    const operating = await api(server, 'GET', '/inventory/expenses-dashboard?from=2026-10-01&to=2026-10-12&category=operating', { token: adminToken });
    assert(operating.json.summary.total === 320 && operating.json.rows.length === 1, 'el filtro por categoría afecta total y tabla');

    const search = await api(server, 'GET', '/inventory/expenses-dashboard?from=2026-10-01&to=2026-10-12&search=salario', { token: adminToken });
    assert(search.json.summary.total === 250 && search.json.rows[0]?.category === 'staff', 'la búsqueda afecta el panel completo');

    const denied = await api(server, 'GET', '/inventory/expenses-dashboard?from=2026-10-01&to=2026-10-12', { token: cashierToken });
    assert(denied.status === 403, `cajero no debe consultar gastos (${denied.status})`);

    const edited = await api(server, 'PUT', '/inventory/expenses', {
      token: adminToken,
      body: {
        admin_password: password,
        requirement_id: 'req-uno',
        purchase_date: '2026-10-12',
        notes: 'Compra corregida',
        updates: [{ id: purchaseId, quantity: 100, unit_cost: 0.6 }],
      },
    });
    assert(edited.status === 200, `la edición debe funcionar (${edited.status})`);
    const editedRow = queryOne('SELECT total_cost, notes FROM inventory_expenses WHERE id = ?', [purchaseId]);
    assert(editedRow.total_cost === 60 && editedRow.notes === 'Compra corregida', 'la edición recalcula y conserva la nota');

    console.log('gastos-dashboard-check: ok');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(cleanup);
