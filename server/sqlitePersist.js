/**
 * Escritura atómica y copias de seguridad en el mismo disco que restaurant.db
 * (en Render: /data/backups). Evita “database disk image is malformed”
 * cuando un deploy o un corte pisa el .db a medias.
 */
const fs = require('fs');
const path = require('path');

const AUTO_KEEP = 48;
const DAILY_KEEP = 14;

function getPersistentBackupsDir(dbPath) {
  return path.join(path.dirname(dbPath), 'backups');
}

function atomicReplaceFile(srcTmp, destPath) {
  const destAbs = path.resolve(destPath);
  const srcAbs = path.resolve(srcTmp);
  if (process.platform === 'win32') {
    const bak = `${destAbs}.prev`;
    try {
      if (fs.existsSync(bak)) fs.unlinkSync(bak);
    } catch {
      /* ignore */
    }
    if (fs.existsSync(destAbs)) fs.renameSync(destAbs, bak);
    try {
      fs.renameSync(srcAbs, destAbs);
    } catch (err) {
      if (fs.existsSync(bak) && !fs.existsSync(destAbs)) {
        try { fs.renameSync(bak, destAbs); } catch { /* ignore */ }
      }
      throw err;
    }
    try { fs.unlinkSync(bak); } catch { /* ignore */ }
    return;
  }
  fs.renameSync(srcAbs, destAbs);
}

function writeFileAtomic(destPath, buffer) {
  const dir = path.dirname(destPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${destPath}.${process.pid}.${Date.now()}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, buffer, 0, buffer.length, 0);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    atomicReplaceFile(tmp, destPath);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
}

function rotateBackups(dir, prefix, keep) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  const files = names
    .filter((n) => n.startsWith(`${prefix}_`) && n.toLowerCase().endsWith('.db'))
    .map((n) => {
      const p = path.join(dir, n);
      try {
        return { path: p, mtime: fs.statSync(p).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
  for (const extra of files.slice(Math.max(1, keep))) {
    try { fs.unlinkSync(extra.path); } catch { /* ignore */ }
  }
}

function writeSnapshotBackup(dbPath, buffer, prefix) {
  const dir = getPersistentBackupsDir(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_');
  const dest = path.join(dir, `${prefix}_${ts}.db`);
  writeFileAtomic(dest, buffer);
  rotateBackups(dir, prefix, prefix.includes('daily') ? DAILY_KEEP : AUTO_KEEP);
  return dest;
}

function ensureDailyBackup(dbPath, buffer) {
  const dir = getPersistentBackupsDir(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const dest = path.join(dir, `restaurant_daily_${day}.db`);
  if (fs.existsSync(dest)) {
    try {
      if (fs.statSync(dest).size > 512) return dest;
    } catch {
      /* rewrite */
    }
  }
  writeFileAtomic(dest, buffer);
  rotateBackups(dir, 'restaurant_daily', DAILY_KEEP);
  return dest;
}

function hasPersistentBackup(dbPath) {
  const dir = getPersistentBackupsDir(dbPath);
  if (!fs.existsSync(dir)) return false;
  try {
    return fs.readdirSync(dir).some((n) => {
      const lower = n.toLowerCase();
      if (!lower.endsWith('.db') && !lower.endsWith('.bak')) return false;
      try {
        return fs.statSync(path.join(dir, n)).size > 512;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

function leftoverTmpCandidates(dbPath) {
  const dir = path.dirname(dbPath);
  const base = path.basename(dbPath);
  const out = [];
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    const lower = name.toLowerCase();
    if (!lower.endsWith('.tmp')) continue;
    if (lower.includes('recover') || lower.includes('restore')) continue;
    if (!name.startsWith(base) && !name.startsWith(`${base}.`)) continue;
    const p = path.join(dir, name);
    try {
      const st = fs.statSync(p);
      if (st.isFile() && st.size > 512) out.push({ path: p, mtime: st.mtimeMs, size: st.size });
    } catch {
      /* ignore */
    }
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

module.exports = {
  getPersistentBackupsDir,
  writeFileAtomic,
  writeSnapshotBackup,
  ensureDailyBackup,
  hasPersistentBackup,
  leftoverTmpCandidates,
  AUTO_KEEP,
  DAILY_KEEP,
};
