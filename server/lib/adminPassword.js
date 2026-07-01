const bcrypt = require('bcryptjs');
const { queryAll } = require('../database');

function verifyAdminPassword(password) {
  const pwd = String(password || '');
  if (!pwd) return false;
  const admins = queryAll(
    `SELECT password_hash FROM users
     WHERE lower(trim(coalesce(role, ''))) IN ('admin', 'master_admin')
       AND coalesce(is_active, 1) = 1`,
  );
  return admins.some((row) => row.password_hash && bcrypt.compareSync(pwd, row.password_hash));
}

module.exports = { verifyAdminPassword };
