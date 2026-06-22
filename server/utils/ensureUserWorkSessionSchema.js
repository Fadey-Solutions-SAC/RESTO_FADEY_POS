const { queryAll, runSql, saveDb } = require('../database');

/** Asegura columnas de jornada laboral (incl. session_kind) en BD existentes. */
function ensureUserWorkSessionSchema() {
  const cols = queryAll('PRAGMA table_info(user_work_sessions)');
  const names = new Set((cols || []).map((c) => c.name));
  let changed = false;

  const addCol = (name, ddl) => {
    if (names.has(name)) return;
    runSql(ddl);
    names.add(name);
    changed = true;
  };

  addCol('photo_login', 'ALTER TABLE user_work_sessions ADD COLUMN photo_login TEXT');
  addCol('photo_logout', 'ALTER TABLE user_work_sessions ADD COLUMN photo_logout TEXT');
  addCol('attendance_status', "ALTER TABLE user_work_sessions ADD COLUMN attendance_status TEXT DEFAULT 'pending'");
  addCol('last_activity_at', 'ALTER TABLE user_work_sessions ADD COLUMN last_activity_at TEXT');
  addCol('shift_label', "ALTER TABLE user_work_sessions ADD COLUMN shift_label TEXT DEFAULT ''");
  addCol('pause_minutes', 'ALTER TABLE user_work_sessions ADD COLUMN pause_minutes INTEGER DEFAULT 0');
  addCol('session_kind', "ALTER TABLE user_work_sessions ADD COLUMN session_kind TEXT DEFAULT 'jornada'");

  if (names.has('session_kind')) {
    runSql("UPDATE user_work_sessions SET session_kind = 'jornada' WHERE session_kind IS NULL OR trim(session_kind) = ''");
  }

  if (changed) {
    saveDb();
    console.info('[db] user_work_sessions: columnas de jornada verificadas (session_kind incluido)');
  }

  return { ok: true, changed };
}

module.exports = { ensureUserWorkSessionSchema };
