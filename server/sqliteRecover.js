/**
 * Recupera un SQLite ilegible (disk image malformed) sin borrar el archivo original.
 * 1) sqlite3 ".recover" si el CLI existe
 * 2) copias hermanas (.bak, backups/*.db) que sí se puedan abrir
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { leftoverTmpCandidates, writeFileAtomic } = require('./sqlitePersist');

function countUsersSqlJs(database) {
  try {
    const stmt = database.prepare('SELECT COUNT(*) AS c FROM users');
    let n = 0;
    if (stmt.step()) n = Number(stmt.getAsObject().c || 0);
    stmt.free();
    return n;
  } catch {
    return 0;
  }
}

function openSqlJsBuffer(SQL, buffer) {
  const database = new SQL.Database(buffer);
  database.run('SELECT 1');
  return database;
}

function findSqlite3Bin() {
  for (const cmd of ['sqlite3', 'sqlite3.exe']) {
    const probe = spawnSync(cmd, ['-version'], { encoding: 'utf8' });
    if (probe.status === 0) return cmd;
  }
  return null;
}

function recoverWithSqliteCli(srcPath, destPath) {
  const bin = findSqlite3Bin();
  if (!bin) return false;
  try {
    if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
  } catch {
    /* ignore */
  }
  const dump = spawnSync(bin, [srcPath, '.recover'], {
    encoding: 'buffer',
    maxBuffer: 512 * 1024 * 1024,
    timeout: 120000,
  });
  if (dump.status !== 0 || !dump.stdout || dump.stdout.length < 64) {
    console.warn('[sqlite-recover] sqlite3 .recover no produjo SQL usable');
    return false;
  }
  const load = spawnSync(bin, [destPath], {
    input: dump.stdout,
    encoding: 'buffer',
    maxBuffer: 512 * 1024 * 1024,
    timeout: 120000,
  });
  if (load.status !== 0 || !fs.existsSync(destPath)) return false;
  return fs.statSync(destPath).size > 512;
}

function listBackupCandidates(dbPath) {
  const dir = path.dirname(dbPath);
  const dirs = [
    dir,
    path.join(dir, 'backups'),
    path.join(__dirname, '..', 'backups'),
  ];
  const out = [];
  const seen = new Set();
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    let names = [];
    try {
      names = fs.readdirSync(d);
    } catch {
      continue;
    }
    for (const name of names) {
      const lower = name.toLowerCase();
      if (lower.includes('malformed') || lower.includes('recover.tmp')) continue;
      const looksDb = lower.endsWith('.db')
        || lower.endsWith('.bak')
        || lower.endsWith('.db.bak')
        || lower.endsWith('.sqlite')
        || (lower.endsWith('.tmp') && !lower.includes('recover') && !lower.includes('restore'));
      if (!looksDb) continue;
      const p = path.resolve(path.join(d, name));
      if (p === path.resolve(dbPath) || seen.has(p)) continue;
      seen.add(p);
      try {
        const st = fs.statSync(p);
        if (st.isFile() && st.size > 512) out.push({ path: p, mtime: st.mtimeMs, size: st.size });
      } catch {
        /* ignore */
      }
    }
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

/**
 * @returns {{ db: object, recovered: boolean } | { error: Error }}
 */
function openOrRecoverSqliteFile(SQL, dbPath, fileBuffer, { minUsers = 0 } = {}) {
  const bufLen = fileBuffer ? fileBuffer.length : 0;
  if (bufLen >= 512) {
    try {
      const database = openSqlJsBuffer(SQL, fileBuffer);
      const users = countUsersSqlJs(database);
      if (minUsers > 0 && users === 0) {
        database.close();
        console.warn('[sqlite-recover] El archivo principal abre pero no tiene usuarios; se buscará copia.');
      } else {
        return { db: database, recovered: false };
      }
    } catch (openErr) {
      console.error('[sqlite-recover] No se abre el archivo principal:', openErr.message || openErr);
    }
  } else {
    console.error('[sqlite-recover] Archivo principal ausente o demasiado pequeño.');
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_');
  const corruptCopy = `${dbPath}.malformed-${stamp}`;
  try {
    fs.copyFileSync(dbPath, corruptCopy);
    console.warn('[sqlite-recover] Copia del archivo dañado:', corruptCopy);
  } catch (copyErr) {
    console.warn('[sqlite-recover] No se pudo copiar el dañado:', copyErr.message || copyErr);
  }

  for (const cand of leftoverTmpCandidates(dbPath)) {
    try {
      const buf = fs.readFileSync(cand.path);
      const database = openSqlJsBuffer(SQL, buf);
      const users = countUsersSqlJs(database);
      if (minUsers > 0 && users === 0) {
        database.close();
        continue;
      }
      writeFileAtomic(dbPath, buf);
      console.warn(`[sqlite-recover] Restaurado desde escritura atómica incompleta ${cand.path} (${users} usuario(s)).`);
      return { db: database, recovered: true };
    } catch {
      /* siguiente */
    }
  }

  const recoveredPath = `${dbPath}.recover.tmp`;
  if (recoverWithSqliteCli(dbPath, recoveredPath)) {
    try {
      const buf = fs.readFileSync(recoveredPath);
      const database = openSqlJsBuffer(SQL, buf);
      const users = countUsersSqlJs(database);
      if (minUsers > 0 && users === 0) {
        database.close();
        console.warn('[sqlite-recover] .recover dejó 0 usuarios; se descarta para no perder el historial.');
      } else {
        writeFileAtomic(dbPath, buf);
        console.warn(`[sqlite-recover] Base reparada con sqlite3 .recover (${users} usuario(s)).`);
        try { fs.unlinkSync(recoveredPath); } catch { /* ignore */ }
        return { db: database, recovered: true };
      }
    } catch (recErr) {
      console.warn('[sqlite-recover] El archivo .recover no es válido:', recErr.message || recErr);
    }
  }

  for (const cand of listBackupCandidates(dbPath)) {
    try {
      const buf = fs.readFileSync(cand.path);
      const database = openSqlJsBuffer(SQL, buf);
      const users = countUsersSqlJs(database);
      if (minUsers > 0 && users === 0) {
        database.close();
        continue;
      }
      writeFileAtomic(dbPath, buf);
      console.warn(`[sqlite-recover] Restaurado desde copia ${cand.path} (${users} usuario(s)).`);
      return { db: database, recovered: true };
    } catch {
      /* siguiente candidato */
    }
  }

  return {
    error: new Error(
      `[SQLite CRÍTICO] No se pudo abrir ${dbPath}. Restaure backup. database disk image is malformed`,
    ),
  };
}

module.exports = {
  openOrRecoverSqliteFile,
};
