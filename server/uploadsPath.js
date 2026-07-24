const fs = require('fs');
const path = require('path');

/**
 * Raíz del directorio servido en `/uploads` (logos, cartas, certificados, PDFs).
 * En la nube con disco persistente: use el mismo volumen que la base (p. ej. DB_PATH=/data/restaurant.db → /data/uploads).
 * Opcional: variable UPLOADS_DIR para fijar la ruta explícitamente.
 */
function getUploadsRoot() {
  const explicit = String(process.env.UPLOADS_DIR || '').trim();
  if (explicit) return path.resolve(explicit);

  const dbPath = String(process.env.DB_PATH || '').trim();
  if (dbPath) {
    const absDb = path.isAbsolute(dbPath) ? dbPath : path.resolve(process.cwd(), dbPath);
    return path.join(path.dirname(absDb), 'uploads');
  }
  return path.join(__dirname, '..', 'uploads');
}

function dataVolumeMissingForDbPath() {
  const dbPath = String(process.env.DB_PATH || '').replace(/\\/g, '/');
  if (!dbPath.startsWith('/data/')) return false;
  try {
    return !fs.existsSync('/data');
  } catch {
    return true;
  }
}

/**
 * Crea el directorio de uploads de forma segura.
 * Si DB_PATH usa /data pero no hay disco montado, falla con mensaje claro (no EACCES críptico).
 */
function ensureUploadsRoot() {
  const dir = getUploadsRoot();
  if (dataVolumeMissingForDbPath()) {
    const msg =
      '[uploads CRÍTICO] DB_PATH apunta a /data pero /data no existe (disco no montado). ' +
      'Render → Disks → mount /data → Start: bash scripts/render-start.sh';
    throw new Error(msg);
  }
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return dir;
  } catch (err) {
    throw new Error(
      `No se pudo preparar uploads en ${dir}: ${err?.message || err}. ` +
        'Verifique disco persistente en /data en Render.',
    );
  }
}

module.exports = { getUploadsRoot, ensureUploadsRoot, dataVolumeMissingForDbPath };
