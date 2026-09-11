const { withTransaction } = require('../database');
const { ensureHrSchema } = require('./ensureHrSchema');

function tryRun(tx, sql, params = []) {
  try {
    tx.run(sql, params);
  } catch (_) {
    /* tabla opcional */
  }
}

/** Encuestas de fidelización cuyo mozo ya no existe en usuarios. */
function deleteOrphanWaiterLoyaltySurveys(tx) {
  tryRun(
    tx,
    `DELETE FROM loyalty_surveys
     WHERE trim(COALESCE(waiter_user_id, '')) != ''
       AND waiter_user_id NOT IN (SELECT id FROM users)`,
  );
}

function deleteWaiterLoyaltySurveysForUser(tx, userId) {
  tryRun(tx, 'DELETE FROM loyalty_surveys WHERE waiter_user_id = ?', [userId]);
}

function purgeHrForUser(tx, userId) {
  try {
    ensureHrSchema();
  } catch (_) {
    /* noop */
  }
  const emp = tx.queryOne('SELECT id FROM hr_employees WHERE user_id = ?', [userId]);
  if (!emp?.id) return;
  const employeeId = String(emp.id).trim();
  const attendances = tx.queryAll('SELECT id FROM hr_attendance WHERE employee_id = ?', [employeeId]) || [];
  for (const row of attendances) {
    tryRun(tx, 'DELETE FROM hr_attendance_adjustments WHERE attendance_id = ?', [row.id]);
  }
  tryRun(tx, 'DELETE FROM hr_attendance WHERE employee_id = ?', [employeeId]);
  tryRun(tx, 'DELETE FROM hr_leave_requests WHERE employee_id = ?', [employeeId]);
  tryRun(tx, 'DELETE FROM hr_qr_credentials WHERE employee_id = ?', [employeeId]);
  tryRun(tx, 'DELETE FROM hr_employees WHERE id = ?', [employeeId]);
}

/**
 * Elimina rastros del usuario en RRHH, encuestas (como mozo), jornadas y permisos.
 * No borra caja cerrada ni pedidos históricos.
 */
function purgeUserFromSystem(userId) {
  const id = String(userId || '').trim();
  if (!id) return { ok: false };

  withTransaction((tx) => {
    deleteWaiterLoyaltySurveysForUser(tx, id);
    purgeHrForUser(tx, id);
    tryRun(tx, 'DELETE FROM user_work_activity_events WHERE user_id = ?', [id]);
    tryRun(tx, 'DELETE FROM user_work_sessions WHERE user_id = ?', [id]);
    tryRun(tx, 'DELETE FROM user_permissions WHERE user_id = ?', [id]);
    tryRun(tx, 'DELETE FROM users WHERE id = ?', [id]);
  });

  return { ok: true };
}

/** Limpia encuestas huérfanas (mozo eliminado antes de este fix). */
function reconcileOrphanWaiterLoyaltySurveys() {
  withTransaction((tx) => {
    deleteOrphanWaiterLoyaltySurveys(tx);
  });
}

module.exports = {
  purgeUserFromSystem,
  reconcileOrphanWaiterLoyaltySurveys,
  deleteWaiterLoyaltySurveysForUser,
};
