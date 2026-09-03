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

run('ingreso a tiempo dentro de tolerancia', () => {
  const late = calc.computeLateMinutes('2026-09-02 08:08:00', '08:00', false);
  assert.strictEqual(late, 8);
  assert.strictEqual(calc.attendanceStatus({ lateMinutes: late, toleranceMinutes: 10 }), 'on_time');
});

run('tardanza', () => {
  const late = calc.computeLateMinutes('2026-09-02 08:17:00', '08:00', false);
  assert.strictEqual(late, 17);
  assert.strictEqual(calc.attendanceStatus({ lateMinutes: late, toleranceMinutes: 10 }), 'late');
});

run('tardanza justificada', () => {
  assert.strictEqual(
    calc.attendanceStatus({ lateMinutes: 20, toleranceMinutes: 10, justified: true }),
    'late_justified',
  );
});

run('horas trabajadas y extras', () => {
  const r = calc.computeWorkedAndOvertime({
    checkInSql: '2026-09-02 08:03:00',
    checkOutSql: '2026-09-02 17:12:00',
    breakMinutes: 60,
    maxHours: 8,
  });
  assert.strictEqual(r.raw_minutes, 9 * 60 + 9);
  assert.strictEqual(r.worked_minutes, 8 * 60 + 9);
  assert.strictEqual(r.overtime_minutes, 9);
});

run('salida sin ingreso no calcula negativo', () => {
  const r = calc.computeWorkedAndOvertime({
    checkInSql: '2026-09-02 17:00:00',
    checkOutSql: '2026-09-02 08:00:00',
    breakMinutes: 0,
    maxHours: 8,
  });
  assert.strictEqual(r.worked_minutes, 0);
});

run('jornada nocturna: work_date es el día de inicio', () => {
  const date = calc.workDateForCheckIn('2026-09-03 01:10:00', '22:00', '06:00');
  assert.strictEqual(date, '2026-09-02');
  const late = calc.computeLateMinutes('2026-09-02 22:04:00', '22:00', true);
  assert.strictEqual(late, 4);
});

run('jornada nocturna: horas a través de medianoche', () => {
  const r = calc.computeWorkedAndOvertime({
    checkInSql: '2026-09-02 22:00:00',
    checkOutSql: '2026-09-03 06:10:00',
    breakMinutes: 30,
    maxHours: 8,
  });
  assert.strictEqual(r.raw_minutes, 8 * 60 + 10);
  assert.strictEqual(r.worked_minutes, 7 * 60 + 40);
  assert.strictEqual(r.overtime_minutes, 0);
});

run('tolerancia exacta sigue a tiempo', () => {
  assert.strictEqual(calc.attendanceStatus({ lateMinutes: 10, toleranceMinutes: 10 }), 'on_time');
});

run('salida anticipada jornada nocturna', () => {
  assert.strictEqual(calc.computeEarlyLeaveMinutes('2026-09-03 05:50:00', '06:00', true), 10);
  assert.strictEqual(calc.computeEarlyLeaveMinutes('2026-09-02 23:00:00', '06:00', true), 7 * 60);
});

run('diff segundos para anti-doble marcación', () => {
  assert.strictEqual(calc.diffSecondsSql('2026-09-02 08:00:00', '2026-09-02 08:00:20'), 20);
});

console.log('hrAttendanceCalc: todas las pruebas OK');
