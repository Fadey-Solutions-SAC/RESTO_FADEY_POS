/**
 * Escritura atómica y copias de seguridad en el mismo disco que restaurant.db
 * (en Render: /data/backups). Evita “database disk image is malformed”
 * cuando un deploy o un corte pisa el .db a medias.
 */
const fs = require('fs');
const path = require('path');

const AUTO_KEEP = 48;
const DAILY_KEEP = 30;
const MONTHLY_KEEP = 36;

function getPersistentBackupsDir(dbPath) {
  return path.join(path.dirname(dbPath), 'backups');
}

function getLastGoodPath(dbPath) {
  return `${path.resolve(dbPath)}.lastgood`;
}

function fileSizeOrZero(filePath) {
  try {
    return fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
  } catch {
    return 0;
  }
}

/**
 * Conserva el .db actual como .lastgood solo si parece una copia útil.
 * Nunca pisa un lastgood grande con un archivo vacío o truncado.
 */
function preserveCurrentAsLastGood(destAbs) {
  const destSize = fileSizeOrZero(destAbs);
  if (destSize < 512) return;
  const lastGood = getLastGoodPath(destAbs);
  const lastSize = fileSizeOrZero(lastGood);
  if (lastSize > destSize && destSize < 100 * 1024) {
    return;
  }
  try {
    if (fs.existsSync(lastGood)) fs.unlinkSync(lastGood);
  } catch {
    /* ignore */
  }
  try {
    fs.renameSync(destAbs, lastGood);
  } catch {
    try {
      fs.copyFileSync(destAbs, lastGood);
    } catch (copyErr) {
      console.warn('[sqlite-persist] no se pudo conservar lastgood:', copyErr.message || copyErr);
    }
  }
}

function atomicReplaceFile(srcTmp, destPath, { keepPrevious = false } = {}) {
  const destAbs = path.resolve(destPath);
  const srcAbs = path.resolve(srcTmp);
  const lastGood = getLastGoodPath(destAbs);

  if (keepPrevious && fs.existsSync(destAbs)) {
    preserveCurrentAsLastGood(destAbs);
  }

  if (process.platform === 'win32' && fs.existsSync(destAbs)) {
    const bak = `${destAbs}.prev`;
    try {
      if (fs.existsSync(bak)) fs.unlinkSync(bak);
    } catch {
      /* ignore */
    }
    try {
      fs.renameSync(destAbs, bak);
    } catch {
      try { fs.unlinkSync(destAbs); } catch { /* ignore */ }
    }
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

  try {
    fs.renameSync(srcAbs, destAbs);
  } catch (err) {
    if (keepPrevious && fs.existsSync(lastGood) && !fs.existsSync(destAbs)) {
      try { fs.renameSync(lastGood, destAbs); } catch { /* ignore */ }
    }
    throw err;
  }
}

function writeFileAtomic(destPath, buffer, { keepPrevious = false } = {}) {
  const dir = path.dirname(destPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${destPath}.${process.pid}.${Date.now()}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    const written = fs.writeSync(fd, buffer, 0, buffer.length, 0);
    if (written !== buffer.length) {
      throw new Error(`Escritura incompleta del backup (${written} de ${buffer.length} bytes)`);
    }
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    atomicReplaceFile(tmp, destPath, { keepPrevious });
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

/** Segundo destino opcional (otro disco, USB, NAS): `BACKUP_MIRROR_DIR`. */
function getBackupMirrorDir() {
  const raw = String(process.env.BACKUP_MIRROR_DIR || '').trim();
  return raw ? path.resolve(raw) : '';
}

function mirrorBackupFile(srcPath, prefix, keep) {
  const mirror = getBackupMirrorDir();
  if (!mirror || !srcPath) return '';
  try {
    if (!fs.existsSync(mirror)) fs.mkdirSync(mirror, { recursive: true });
    const dest = path.join(mirror, path.basename(srcPath));
    writeFileAtomic(dest, fs.readFileSync(srcPath));
    rotateBackups(mirror, prefix, keep);
    return dest;
  } catch (err) {
    console.warn('[sqlite-backup] copia espejo falló:', err.message || err);
    return '';
  }
}

function ensurePeriodBackup(dbPath, buffer, prefix, stamp, keep) {
  const dir = getPersistentBackupsDir(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${prefix}_${stamp}.db`);
  const mirror = getBackupMirrorDir();
  if (fs.existsSync(dest)) {
    try {
      if (fs.statSync(dest).size > 512) {
        if (mirror && !fs.existsSync(path.join(mirror, path.basename(dest)))) {
          mirrorBackupFile(dest, prefix, keep);
        }
        return { path: dest, created: false };
      }
    } catch {
      /* rewrite */
    }
  }
  writeFileAtomic(dest, buffer);
  rotateBackups(dir, prefix, keep);
  mirrorBackupFile(dest, prefix, keep);
  return { path: dest, created: true };
}

function ensureDailyBackup(dbPath, buffer) {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return ensurePeriodBackup(dbPath, buffer, 'restaurant_daily', day, DAILY_KEEP).path;
}

/** Una copia por mes, conservada 3 años: permite recuperar datos antiguos aunque se detecte tarde. */
function ensureMonthlyBackup(dbPath, buffer) {
  const month = new Date().toISOString().slice(0, 7).replace(/-/g, '');
  return ensurePeriodBackup(dbPath, buffer, 'restaurant_monthly', month, MONTHLY_KEEP).path;
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
  getLastGoodPath,
  writeFileAtomic,
  writeSnapshotBackup,
  ensureDailyBackup,
  ensureMonthlyBackup,
  getBackupMirrorDir,
  hasPersistentBackup,
  leftoverTmpCandidates,
  AUTO_KEEP,
  DAILY_KEEP,
  MONTHLY_KEEP,
};
