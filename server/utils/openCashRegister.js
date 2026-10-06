const { queryOne } = require('../database');

function getUserCajaStationId(userId) {
  const row = queryOne('SELECT caja_station_id FROM users WHERE id = ?', [userId]);
  return String(row?.caja_station_id || '').trim();
}

function getOpenRegisterByStation(stationId) {
  const sid = String(stationId || '').trim();
  if (!sid) return null;
  return (
    queryOne(
      `SELECT * FROM cash_registers
       WHERE closed_at IS NULL AND trim(coalesce(caja_station_id, '')) = ?
       ORDER BY datetime(opened_at) DESC
       LIMIT 1`,
      [sid],
    ) || null
  );
}

/**
 * Turno abierto con el que opera el usuario: el que abrió él mismo o, si es cajero,
 * el turno abierto en su caja asignada aunque lo haya abierto otro usuario (p. ej. admin).
 */
function getOpenRegisterForUser(user) {
  const userId = user?.id;
  if (!userId) return null;
  const own = queryOne(
    `SELECT * FROM cash_registers
     WHERE user_id = ? AND closed_at IS NULL
     ORDER BY datetime(opened_at) DESC
     LIMIT 1`,
    [userId],
  );
  if (own) return own;
  if (String(user?.role || '').toLowerCase() !== 'cajero') return null;
  return getOpenRegisterByStation(getUserCajaStationId(userId));
}

module.exports = {
  getUserCajaStationId,
  getOpenRegisterByStation,
  getOpenRegisterForUser,
};
