const { queryAll } = require('../database');

function tableExists(name) {
  const row = queryAll(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`, [name]);
  return Array.isArray(row) && row.length > 0;
}

function ensureHrSchema() {
  const { runSql } = require('../database');

  runSql(`
    CREATE TABLE IF NOT EXISTS hr_schedules (
      id TEXT PRIMARY KEY,
      restaurant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      start_time TEXT NOT NULL DEFAULT '08:00',
      end_time TEXT NOT NULL DEFAULT '17:00',
      tolerance_in_minutes INTEGER NOT NULL DEFAULT 10,
      tolerance_out_minutes INTEGER NOT NULL DEFAULT 10,
      break_minutes INTEGER NOT NULL DEFAULT 60,
      work_days TEXT NOT NULL DEFAULT '[0,1,2,3,4,5]',
      max_hours REAL NOT NULL DEFAULT 8,
      overtime_after_minutes INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  runSql(`
    CREATE TABLE IF NOT EXISTS hr_employees (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      restaurant_id TEXT NOT NULL,
      branch_id TEXT NOT NULL DEFAULT '',
      employee_code TEXT DEFAULT '',
      document_id TEXT DEFAULT '',
      position TEXT DEFAULT '',
      department TEXT DEFAULT '',
      hire_date TEXT DEFAULT '',
      contract_type TEXT DEFAULT 'planilla',
      status TEXT NOT NULL DEFAULT 'active',
      schedule_id TEXT DEFAULT '',
      photo_url TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  runSql(`
    CREATE TABLE IF NOT EXISTS hr_qr_credentials (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      revoked_at TEXT
    )
  `);

  runSql(`
    CREATE TABLE IF NOT EXISTS hr_attendance (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      restaurant_id TEXT NOT NULL,
      branch_id TEXT NOT NULL DEFAULT '',
      work_date TEXT NOT NULL,
      check_in_at TEXT,
      check_out_at TEXT,
      scheduled_start TEXT DEFAULT '',
      scheduled_end TEXT DEFAULT '',
      worked_minutes INTEGER NOT NULL DEFAULT 0,
      break_minutes INTEGER NOT NULL DEFAULT 0,
      overtime_minutes INTEGER NOT NULL DEFAULT 0,
      late_minutes INTEGER NOT NULL DEFAULT 0,
      early_leave_minutes INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      late_justified INTEGER NOT NULL DEFAULT 0,
      late_justification TEXT DEFAULT '',
      device_id TEXT DEFAULT '',
      ip_address TEXT DEFAULT '',
      source TEXT NOT NULL DEFAULT 'qr',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  runSql(`
    CREATE TABLE IF NOT EXISTS hr_attendance_adjustments (
      id TEXT PRIMARY KEY,
      attendance_id TEXT NOT NULL,
      actor_user_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      old_values TEXT NOT NULL DEFAULT '{}',
      new_values TEXT NOT NULL DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  runSql(`
    CREATE TABLE IF NOT EXISTS hr_leave_requests (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      restaurant_id TEXT NOT NULL,
      type TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      reason TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      approved_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  runSql('CREATE INDEX IF NOT EXISTS idx_hr_emp_user ON hr_employees(user_id)');
  runSql('CREATE INDEX IF NOT EXISTS idx_hr_emp_rest ON hr_employees(restaurant_id, status)');
  runSql('CREATE INDEX IF NOT EXISTS idx_hr_att_emp_date ON hr_attendance(employee_id, work_date)');
  runSql('CREATE INDEX IF NOT EXISTS idx_hr_att_open ON hr_attendance(employee_id, check_out_at)');
  runSql('CREATE INDEX IF NOT EXISTS idx_hr_qr_hash ON hr_qr_credentials(token_hash)');
  runSql('CREATE INDEX IF NOT EXISTS idx_hr_leave_emp ON hr_leave_requests(employee_id, start_date)');
  try {
    runSql('CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_att_one_open ON hr_attendance(employee_id) WHERE check_out_at IS NULL');
  } catch (_) {
    /* sql.js antiguo puede no soportar índice parcial */
  }

  try {
    const cols = queryAll('PRAGMA table_info(hr_qr_credentials)') || [];
    if (!cols.some((c) => c.name === 'token_cipher')) {
      runSql("ALTER TABLE hr_qr_credentials ADD COLUMN token_cipher TEXT DEFAULT ''");
    }
  } catch (_) {
    /* noop */
  }

  return { ok: true, tables: tableExists('hr_employees') };
}

module.exports = { ensureHrSchema };
