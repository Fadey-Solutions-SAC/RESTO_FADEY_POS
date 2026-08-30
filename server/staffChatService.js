const { queryOne, runSql } = require('./database');

/** Historial visible solo durante este período; luego se borra por completo. */
const CHAT_RETENTION_HOURS = 24;

function ensureStateRow() {
  runSql(
    `INSERT OR IGNORE INTO internal_chat_state (id, cycle_id, cycle_started_at)
     VALUES (1, 1, datetime('now'))`
  );
}

/**
 * Elimina mensajes con más de 24 h (respaldo si el ciclo no se avanzó a tiempo).
 */
function pruneExpiredStaffChatMessages() {
  ensureStateRow();
  runSql(
    `DELETE FROM staff_internal_messages
     WHERE datetime(created_at) < datetime('now', '-${CHAT_RETENTION_HOURS} hours')`
  );
}

/**
 * Cada 24 h desde cycle_started_at: nuevo ciclo y borrado del historial anterior.
 */
function advanceStaffChatCycleIfDue() {
  ensureStateRow();
  pruneExpiredStaffChatMessages();

  const state = queryOne('SELECT cycle_id, cycle_started_at FROM internal_chat_state WHERE id = 1');
  if (!state?.cycle_started_at) {
    runSql(`UPDATE internal_chat_state SET cycle_started_at = datetime('now') WHERE id = 1`);
    return false;
  }

  const diff = queryOne(
    `SELECT (julianday('now') - julianday(?)) * 24 AS hours_since`,
    [state.cycle_started_at]
  );
  const hours = Number(diff?.hours_since || 0);
  if (hours < CHAT_RETENTION_HOURS) return false;

  const nextCycle = Number(state.cycle_id || 1) + 1;
  runSql('DELETE FROM staff_internal_messages');
  runSql(
    `UPDATE internal_chat_state
     SET cycle_id = ?, all_staff_offline_at = NULL, cycle_started_at = datetime('now')
     WHERE id = 1`,
    [nextCycle]
  );
  return true;
}

function getChatState() {
  ensureStateRow();
  advanceStaffChatCycleIfDue();
  const row = queryOne(
    'SELECT cycle_id, cycle_started_at, all_staff_offline_at FROM internal_chat_state WHERE id = 1'
  );
  const ends = row?.cycle_started_at
    ? queryOne(`SELECT datetime(?, '+${CHAT_RETENTION_HOURS} hours') AS cycle_ends_at`, [row.cycle_started_at])
    : null;
  return {
    cycle_id: Number(row?.cycle_id || 1),
    cycle_started_at: row?.cycle_started_at || null,
    cycle_ends_at: ends?.cycle_ends_at || null,
    retention_hours: CHAT_RETENTION_HOURS,
    all_staff_offline_at: row?.all_staff_offline_at || null,
  };
}

function getCurrentCycleId() {
  const s = getChatState();
  return Number(s?.cycle_id || 1);
}

/** Compatibilidad con logout; el reinicio ya no depende de sesiones cerradas. */
function markAllStaffOfflineIfNeeded() {
  ensureStateRow();
}

module.exports = {
  CHAT_RETENTION_HOURS,
  ensureStateRow,
  markAllStaffOfflineIfNeeded,
  advanceStaffChatCycleIfDue,
  pruneExpiredStaffChatMessages,
  getChatState,
  getCurrentCycleId,
};
