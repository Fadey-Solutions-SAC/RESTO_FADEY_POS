/**
 * Recupera un SQLite ilegible (disk image malformed) sin borrar el archivo original.
 * 1) sqlite3 ".recover" si el CLI existe
 * 2) copias hermanas (.bak, backups/*.db) que sí se puedan abrir
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { leftoverTmpCandidates, writeFileAtomic } = require('./sqlitePersist');

function countTableSqlJs(database, table) {
  try {
    const stmt = database.prepare(`SELECT COUNT(*) AS c FROM ${table}`);
    let n = 0;
    if (stmt.step()) n = Number(stmt.getAsObject().c || 0);
    stmt.free();
    return n;
  } catch {
    return 0;
  }
}

function countUsersSqlJs(database) {
  return countTableSqlJs(database, 'users');
}

function hasBusinessData(database) {
  return countUsersSqlJs(database) > 0
    || countTableSqlJs(database, 'products') > 0
    || countTableSqlJs(database, 'orders') > 0
    || countTableSqlJs(database, 'restaurants') > 0;
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

function dumpSqliteSql(bin, srcPath, sqlPath, command) {
  const outFd = fs.openSync(sqlPath, 'w');
  try {
    const dump = spawnSync(bin, [srcPath, command], {
      stdio: ['ignore', outFd, 'pipe'],
      timeout: 180000,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    return dump;
  } finally {
    fs.closeSync(outFd);
  }
}

function sqlite3CopyViaBackup(srcPath, destPath) {
  const bin = findSqlite3Bin();
  if (!bin) return false;
  try {
    if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
  } catch {
    /* ignore */
  }
  const destEsc = String(destPath).replace(/'/g, "''");
  const attempts = [
    [srcPath, `.backup '${destEsc}'`],
    [srcPath, `VACUUM INTO '${destEsc}'`],
  ];
  for (const args of attempts) {
    const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 180000 });
    let size = 0;
    try { size = fs.existsSync(destPath) ? fs.statSync(destPath).size : 0; } catch { size = 0; }
    console.warn(
      `[sqlite-recover] ${String(args[1]).slice(0, 28)} status=${r.status} size=${size} stderr=${String(r.stderr || '').slice(0, 240)}`,
    );
    if (size > 512) return true;
  }
  return false;
}

function recoverWithSqliteCli(srcPath, destPath) {
  const bin = findSqlite3Bin();
  if (!bin) {
    console.warn('[sqlite-recover] sqlite3 CLI no está en PATH');
    return false;
  }
  const sqlPath = `${destPath}.sql`;
  try {
    if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
    if (fs.existsSync(sqlPath)) fs.unlinkSync(sqlPath);
  } catch {
    /* ignore */
  }

  let dump = dumpSqliteSql(bin, srcPath, sqlPath, '.dump');
  let sqlBytes = 0;
  try { sqlBytes = fs.existsSync(sqlPath) ? fs.statSync(sqlPath).size : 0; } catch { sqlBytes = 0; }
  console.warn(
    `[sqlite-recover] .dump status=${dump.status} sql=${sqlBytes}b stderr=${String(dump.stderr || '').slice(0, 300)}`,
  );

  if (sqlBytes < 64) {
    dump = dumpSqliteSql(bin, srcPath, sqlPath, '.recover');
    try { sqlBytes = fs.existsSync(sqlPath) ? fs.statSync(sqlPath).size : 0; } catch { sqlBytes = 0; }
    console.warn(
      `[sqlite-recover] .recover status=${dump.status} sql=${sqlBytes}b stderr=${String(dump.stderr || '').slice(0, 300)}`,
    );
  }

  if (sqlBytes < 64) {
    console.warn('[sqlite-recover] sqlite3 no produjo SQL usable');
    return false;
  }

  const sql = fs.readFileSync(sqlPath);
  const load = spawnSync(bin, [destPath], {
    input: sql,
    encoding: 'buffer',
    maxBuffer: 512 * 1024 * 1024,
    timeout: 180000,
  });
  console.warn(
    `[sqlite-recover] load status=${load.status} dest=${fs.existsSync(destPath) ? fs.statSync(destPath).size : 0}b`,
  );
  try { fs.unlinkSync(sqlPath); } catch { /* ignore */ }
  if (!fs.existsSync(destPath)) return false;
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

function listLastResortCandidates(dbPath) {
  const dir = path.dirname(dbPath);
  const out = [];
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    const lower = name.toLowerCase();
    const isLastResort = lower.includes('malformed')
      || lower.includes('before-sqljs-clean')
      || lower.endsWith('.prev')
      || lower.includes('.db.sqljs-clean');
    if (!isLastResort) continue;
    const p = path.resolve(path.join(dir, name));
    if (p === path.resolve(dbPath)) continue;
    try {
      const st = fs.statSync(p);
      if (st.isFile() && st.size > 512) out.push({ path: p, mtime: st.mtimeMs, size: st.size });
    } catch {
      /* ignore */
    }
  }
  out.sort((a, b) => b.size - a.size);
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
      if (minUsers > 0 && users === 0 && !hasBusinessData(database)) {
        database.close();
        console.warn('[sqlite-recover] El archivo principal abre pero no tiene datos; se buscará copia.');
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

  const sqljsClean = `${dbPath}.sqljs-clean`;
  if (sqlite3CopyViaBackup(dbPath, sqljsClean)) {
    try {
      const buf = fs.readFileSync(sqljsClean);
      const database = openSqlJsBuffer(SQL, buf);
      const users = countUsersSqlJs(database);
      if (minUsers > 0 && users === 0 && !hasBusinessData(database)) {
        database.close();
        console.warn('[sqlite-recover] sqlite3 .backup quedó sin datos de negocio; se ignora.');
      } else {
        writeFileAtomic(dbPath, buf);
        console.warn(`[sqlite-recover] Reescrito con sqlite3 .backup (${users} usuario(s)).`);
        try { fs.unlinkSync(sqljsClean); } catch { /* ignore */ }
        return { db: database, recovered: true };
      }
    } catch (backupErr) {
      console.warn('[sqlite-recover] sqlite3 .backup no lo abre sql.js:', backupErr.message || backupErr);
    }
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
      if (minUsers > 0 && users === 0 && !hasBusinessData(database)) {
        database.close();
        console.warn('[sqlite-recover] .recover no dejó datos de negocio; se descarta.');
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

  try {
    const dir = path.dirname(dbPath);
    const names = fs.readdirSync(dir).slice(0, 40).map((n) => {
      try {
        const st = fs.statSync(path.join(dir, n));
        return `${n}:${st.size}`;
      } catch {
        return n;
      }
    });
    console.warn('[sqlite-recover] archivos junto a la base:', names.join(' | '));
  } catch (listErr) {
    console.warn('[sqlite-recover] no se pudo listar el disco:', listErr.message || listErr);
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

  for (const cand of listLastResortCandidates(dbPath)) {
    try {
      const buf = fs.readFileSync(cand.path);
      const database = openSqlJsBuffer(SQL, buf);
      const users = countUsersSqlJs(database);
      if (users === 0 && !hasBusinessData(database)) {
        database.close();
        continue;
      }
      if (minUsers > 0 && users === 0) {
        database.close();
        continue;
      }
      writeFileAtomic(dbPath, buf);
      console.warn(`[sqlite-recover] Restaurado desde copia de último recurso ${cand.path} (${users} usuario(s), ${cand.size} bytes).`);
      return { db: database, recovered: true };
    } catch {
      /* siguiente */
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
