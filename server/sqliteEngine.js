/**
 * SQLite durable: better-sqlite3 + WAL en la nube.
 * sql.js reescribe todo el .db en cada save y un deploy/corte lo deja "malformed".
 * El motor nativo confirma cada transacción en disco (journal WAL).
 */
const fs = require('fs');
const path = require('path');
const { normalizeSqlParams } = require('./utils/sqlBind');
const { getLastGoodPath, writeFileAtomic } = require('./sqlitePersist');

function isElectronRendererOrMain() {
  return Boolean(process.versions.electron) && !process.env.ELECTRON_RUN_AS_NODE;
}

function isRenderHost() {
  return String(process.env.RENDER || '').toLowerCase() === 'true';
}

function wrapNodeSqliteConstructor(DatabaseSync) {
  return function NodeSqliteDatabase(dbPath, opts = {}) {
    const db = new DatabaseSync(dbPath, {
      readOnly: Boolean(opts.readonly || opts.readOnly),
      timeout: opts.timeout || 8000,
    });
    db.name = dbPath;
    db.pragma = (src) => {
      const sql = String(src || '').trim().toLowerCase().startsWith('pragma')
        ? String(src)
        : `PRAGMA ${src}`;
      try {
        const row = db.prepare(sql).get();
        if (row && typeof row === 'object') {
          const vals = Object.values(row);
          return vals.length === 1 ? vals[0] : row;
        }
        return row;
      } catch {
        db.exec(sql);
        return undefined;
      }
    };
    return db;
  };
}

function loadBetterSqlite3() {
  if (String(process.env.SQLITE_ENGINE || '').trim().toLowerCase() === 'sqljs') {
    return null;
  }
  if (isElectronRendererOrMain() && String(process.env.SQLITE_ENGINE || '').trim().toLowerCase() !== 'native') {
    return null;
  }
  try {
    const { DatabaseSync } = require('node:sqlite');
    if (typeof DatabaseSync === 'function') {
      return wrapNodeSqliteConstructor(DatabaseSync);
    }
  } catch (err) {
    console.warn('[sqlite-native] node:sqlite no disponible:', err.message || err);
  }
  try {
    return require('better-sqlite3');
  } catch (err) {
    if (isRenderHost()) {
      throw new Error(
        `SQLite nativo es obligatorio en Render (Node 22+ con node:sqlite). ${err.message || err}`,
      );
    }
    console.warn('[sqlite] motor nativo no cargó; se usa sql.js (menos duradero):', err.message || err);
    return null;
  }
}

function countTableNative(nativeDb, table) {
  try {
    const row = nativeDb.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get();
    return Number(row?.c || 0);
  } catch {
    return 0;
  }
}

function hasBusinessDataNative(nativeDb) {
  return countTableNative(nativeDb, 'users') > 0
    || countTableNative(nativeDb, 'products') > 0
    || countTableNative(nativeDb, 'orders') > 0
    || countTableNative(nativeDb, 'restaurants') > 0;
}

function applyDurablePragmas(nativeDb) {
  nativeDb.pragma('journal_mode = WAL');
  nativeDb.pragma('synchronous = FULL');
  nativeDb.pragma('busy_timeout = 8000');
  nativeDb.pragma('foreign_keys = ON');
  nativeDb.pragma('temp_store = MEMORY');
  nativeDb.pragma('wal_autocheckpoint = 500');
}

function wrapNativeDatabase(nativeDb) {
  return {
    _engine: 'native',
    _native: nativeDb,
    run(sql, params) {
      const safe = normalizeSqlParams(Array.isArray(params) ? params : []);
      if (!safe.length) {
        nativeDb.exec(sql);
        return;
      }
      nativeDb.prepare(sql).run(...safe);
    },
    exec(sql) {
      nativeDb.exec(sql);
    },
    prepare(sql) {
      const stmt = nativeDb.prepare(sql);
      let bound = [];
      let rows = null;
      let index = 0;
      return {
        bind(params) {
          bound = normalizeSqlParams(Array.isArray(params) ? params : []);
        },
        step() {
          if (!rows) {
            rows = bound.length ? stmt.all(...bound) : stmt.all();
            index = 0;
          }
          if (index >= rows.length) return false;
          this._current = rows[index];
          index += 1;
          return true;
        },
        getAsObject() {
          return this._current || {};
        },
        free() {
          rows = null;
          index = 0;
          this._current = null;
        },
      };
    },
    export() {
      checkpointNative(nativeDb, 'TRUNCATE');
      return fs.readFileSync(nativeDb.name);
    },
    close() {
      try {
        checkpointNative(nativeDb, 'TRUNCATE');
      } catch {
        /* ignore */
      }
      nativeDb.close();
    },
  };
}

function checkpointNative(nativeDb, mode = 'PASSIVE') {
  const allowed = new Set(['PASSIVE', 'FULL', 'RESTART', 'TRUNCATE']);
  const kind = allowed.has(String(mode).toUpperCase()) ? String(mode).toUpperCase() : 'PASSIVE';
  nativeDb.pragma(`wal_checkpoint(${kind})`);
}

function vacuumNativeInto(nativeDb, destPath) {
  const dir = path.dirname(destPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${destPath}.${process.pid}.vac`;
  try {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  } catch {
    /* ignore */
  }
  nativeDb.prepare('VACUUM INTO ?').run(tmp);
  const buf = fs.readFileSync(tmp);
  writeFileAtomic(destPath, buf, { keepPrevious: false });
  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  return destPath;
}

function tryOpenNative(BetterSqlite, dbPath, { readonly = false } = {}) {
  const nativeDb = new BetterSqlite(dbPath, {
    fileMustExist: readonly,
    timeout: 8000,
    readonly,
  });
  if (!readonly) applyDurablePragmas(nativeDb);
  return nativeDb;
}

function removeWalSidecars(dbPath) {
  for (const side of [`${dbPath}-wal`, `${dbPath}-shm`]) {
    try {
      if (fs.existsSync(side)) fs.unlinkSync(side);
    } catch {
      /* ignore */
    }
  }
}

function copyOver(src, dest) {
  const buf = fs.readFileSync(src);
  writeFileAtomic(dest, buf, { keepPrevious: true });
  removeWalSidecars(dest);
}

function moveAsideCorrupt(dbPath) {
  removeWalSidecars(dbPath);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_');
  const dest = `${dbPath}.malformed-${stamp}`;
  try {
    if (fs.existsSync(dbPath)) fs.renameSync(dbPath, dest);
    console.warn('[sqlite-native] Archivo dañado apartado:', dest);
  } catch (err) {
    console.warn('[sqlite-native] no se pudo apartar el dañado:', err.message || err);
  }
}

/**
 * @returns {Promise<{ db: object, recovered: boolean, emptyBoot: boolean, reason: string }>}
 */
async function openNativeWithRecover(BetterSqlite, dbPath, { minUsers = 0 } = {}) {
  const parentDir = path.dirname(dbPath);
  if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });

  const tryPath = (filePath, recovered) => {
    if (!fs.existsSync(filePath) && minUsers > 0) {
      return null;
    }
    const nativeDb = tryOpenNative(BetterSqlite, filePath);
    const users = countTableNative(nativeDb, 'users');
    const empty = users === 0 && !hasBusinessDataNative(nativeDb);
    if (minUsers > 0 && empty) {
      nativeDb.close();
      return null;
    }
    return { db: wrapNativeDatabase(nativeDb), recovered, emptyBoot: false, reason: '' };
  };

  try {
    const opened = tryPath(dbPath, false);
    if (opened) {
      console.info('[sqlite-native] WAL + synchronous=FULL en', dbPath);
      return opened;
    }
    console.warn('[sqlite-native] El archivo principal abre pero no tiene datos; se busca lastgood/backups.');
  } catch (openErr) {
    console.error('[sqlite-native] No se abre el archivo principal:', openErr.message || openErr);
  }

  const lastGood = getLastGoodPath(dbPath);
  if (fs.existsSync(lastGood)) {
    try {
      const probe = tryOpenNative(BetterSqlite, lastGood, { readonly: true });
      const users = countTableNative(probe, 'users');
      const ok = users > 0 || hasBusinessDataNative(probe);
      probe.close();
      if (ok) {
        moveAsideCorrupt(dbPath);
        copyOver(lastGood, dbPath);
        const restored = tryPath(dbPath, true);
        if (restored) {
          console.warn(`[sqlite-native] Restaurado desde lastgood (${users} usuario(s)).`);
          return restored;
        }
      }
    } catch (lastGoodErr) {
      console.warn('[sqlite-native] lastgood no usable:', lastGoodErr.message || lastGoodErr);
    }
  }

  try {
    const { openOrRecoverSqliteFile } = require('./sqliteRecover');
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();
    let fileBuffer = Buffer.alloc(0);
    try {
      if (fs.existsSync(dbPath)) fileBuffer = fs.readFileSync(dbPath);
    } catch {
      /* ignore */
    }
    const recovered = openOrRecoverSqliteFile(SQL, dbPath, fileBuffer, { minUsers });
    if (recovered.db && typeof recovered.db.close === 'function') {
      try { recovered.db.close(); } catch { /* ignore */ }
    }
    if (!recovered.error) {
      const opened = tryPath(dbPath, true);
      if (opened) return opened;
    }
    moveAsideCorrupt(dbPath);
    const nativeDb = tryOpenNative(BetterSqlite, dbPath);
    return {
      db: wrapNativeDatabase(nativeDb),
      recovered: false,
      emptyBoot: true,
      reason: recovered.error ? recovered.error.message : 'sin copia usable',
    };
  } catch (recoverErr) {
    console.warn('[sqlite-native] recover auxiliar no disponible:', recoverErr.message || recoverErr);
  }

  moveAsideCorrupt(dbPath);
  const nativeDb = tryOpenNative(BetterSqlite, dbPath);
  return {
    db: wrapNativeDatabase(nativeDb),
    recovered: false,
    emptyBoot: true,
    reason: 'no se pudo abrir SQLite nativo',
  };
}

function reopenNative(BetterSqlite, dbPath) {
  const nativeDb = tryOpenNative(BetterSqlite, dbPath);
  return wrapNativeDatabase(nativeDb);
}

function probeSqliteBuffer(BetterSqlite, fileBuffer) {
  const tmp = path.join(
    require('os').tmpdir(),
    `resto-sqlite-probe-${process.pid}-${Date.now()}.db`,
  );
  fs.writeFileSync(tmp, fileBuffer);
  try {
    const nativeDb = new BetterSqlite(tmp, { readonly: true, fileMustExist: true });
    nativeDb.prepare('SELECT 1 AS ok').get();
    try {
      const check = nativeDb.prepare('PRAGMA quick_check').get();
      const ok = String(check?.quick_check || check?.integrity_check || 'ok').toLowerCase();
      if (ok && ok !== 'ok') {
        throw new Error(`El backup no pasa verificación SQLite (${ok})`);
      }
    } catch (err) {
      if (/verificación SQLite/i.test(String(err?.message || ''))) throw err;
    }
    nativeDb.close();
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

function isNativeDb(database) {
  return Boolean(database && database._engine === 'native' && database._native);
}

module.exports = {
  loadBetterSqlite3,
  openNativeWithRecover,
  reopenNative,
  probeSqliteBuffer,
  checkpointNative,
  vacuumNativeInto,
  isNativeDb,
  wrapNativeDatabase,
  removeWalSidecars,
};
