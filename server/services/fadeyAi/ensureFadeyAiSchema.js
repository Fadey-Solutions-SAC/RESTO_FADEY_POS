/**
 * Schema local del asistente IA Fadey (por instancia / web service).
 */
const { runSql, queryOne } = require('../../database');

let ensured = false;

function ensureFadeyAiSchema() {
  if (ensured) return;
  runSql(`
    CREATE TABLE IF NOT EXISTS fadey_ai_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      bootstrapped_at TEXT,
      learning_until TEXT,
      last_monitor_at TEXT,
      last_snapshot_at TEXT,
      updated_at TEXT
    )
  `);
  runSql(`
    CREATE TABLE IF NOT EXISTS fadey_ai_memory (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      title TEXT,
      body TEXT NOT NULL,
      meta_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  runSql(`CREATE INDEX IF NOT EXISTS idx_fadey_ai_memory_kind ON fadey_ai_memory(kind)`);
  runSql(`
    CREATE TABLE IF NOT EXISTS fadey_ai_chat_messages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      sources_json TEXT,
      created_at TEXT NOT NULL
    )
  `);
  runSql(`CREATE INDEX IF NOT EXISTS idx_fadey_ai_chat_user ON fadey_ai_chat_messages(user_id, created_at)`);
  try {
    runSql(`ALTER TABLE fadey_ai_state ADD COLUMN last_chat_purge_day TEXT`);
  } catch (_) {
    /* columna ya existe */
  }
  const row = queryOne('SELECT id FROM fadey_ai_state WHERE id = 1');
  if (!row) {
    runSql(
      `INSERT INTO fadey_ai_state (id, bootstrapped_at, learning_until, last_monitor_at, last_snapshot_at, updated_at)
       VALUES (1, NULL, NULL, NULL, NULL, datetime('now'))`
    );
  }
  ensured = true;
}

module.exports = { ensureFadeyAiSchema };
