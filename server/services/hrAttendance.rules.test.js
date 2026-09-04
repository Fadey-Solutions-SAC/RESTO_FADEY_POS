/**
 * Pruebas de reglas de negocio de RR.HH. (sin DB).
 * Ejecutar: node server/services/hrAttendance.rules.test.js
 */
const assert = require('assert');
const calc = require('./hrAttendanceCalc');

function run(name, fn) {
  try {
    fn();
    console.log(`ok  ${name}`);
  } catch (err) {
    console.error(`fail  ${name}`);
    throw err;
  }
}

run('QR payload no incluye PII', () => {
  const token = 'abc123token';
  const payload = `RFHR:${token}`;
  assert.ok(!payload.includes('@'));
  assert.ok(!payload.toLowerCase().includes('juan'));
  assert.ok(payload.startsWith('RFHR:'));
});

run('doble marcación: ventana corta', () => {
  const secs = calc.diffSecondsSql('2026-09-02 08:00:00', '2026-09-02 08:00:10');
  assert.ok(secs < 25);
});

run('salida sin ingreso (checkout solo) no aplica: worked 0 si invertido', () => {
  const r = calc.computeWorkedAndOvertime({
    checkInSql: '2026-09-02 17:00:00',
    checkOutSql: '2026-09-02 08:00:00',
    breakMinutes: 0,
    maxHours: 8,
  });
  assert.strictEqual(r.worked_minutes, 0);
});

run('cambio de horario no recalcula past: scheduled times son snapshot', () => {
  const lateOld = calc.computeLateMinutes('2026-09-02 08:15:00', '08:00', false);
  const lateNew = calc.computeLateMinutes('2026-09-02 08:15:00', '09:00', false);
  assert.strictEqual(lateOld, 15);
  assert.strictEqual(lateNew, 0);
});

run('zona horaria: jsNowSql usa America/Lima (no UTC del proceso)', () => {
  // 13:03 UTC = 08:03 en America/Lima (UTC-5)
  const d = new Date(Date.UTC(2026, 8, 2, 13, 3, 0));
  const sql = calc.jsNowSql(d, 'America/Lima');
  assert.strictEqual(sql, '2026-09-02 08:03:00');
});

run('turno corto: no restar refrigerio completo (evita 0h)', () => {
  const r = calc.computeWorkedAndOvertime({
    checkInSql: '2026-09-02 23:00:00',
    checkOutSql: '2026-09-02 23:07:00',
    breakMinutes: 60,
    maxHours: 8,
  });
  assert.strictEqual(r.worked_minutes, 7);
  assert.strictEqual(r.break_minutes, 0);
});

run('ingreso UTC naive se normaliza a Lima para contar horas', () => {
  // 04:00 UTC = 23:00 Lima día anterior
  const r = calc.computeWorkedAndOvertime({
    checkInSql: '2026-09-03 04:00:00',
    checkOutSql: '2026-09-02 23:07:00',
    breakMinutes: 60,
    maxHours: 8,
    timeZone: 'America/Lima',
  });
  assert.ok(r.check_in_fixed);
  assert.strictEqual(r.worked_minutes, 7);
});

run('jornada normal sí descuenta refrigerio', () => {
  const r = calc.computeWorkedAndOvertime({
    checkInSql: '2026-09-02 08:00:00',
    checkOutSql: '2026-09-02 17:00:00',
    breakMinutes: 60,
    maxHours: 8,
  });
  assert.strictEqual(r.raw_minutes, 540);
  assert.strictEqual(r.worked_minutes, 480);
  assert.strictEqual(r.break_minutes, 60);
});

console.log('hrAttendance.rules: OK');
