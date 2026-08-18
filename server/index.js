require('dotenv').config();
const path = require('path');

/** En Render, si arrancan `node server/index.js` sin render-start.sh, redirigir al script correcto. */
if (String(process.env.RENDER || '').toLowerCase() === 'true' && !process.env._RENDER_START_WRAPPER) {
  const { spawnSync } = require('child_process');
  const script = path.join(__dirname, '..', 'scripts', 'render-start.sh');
  console.warn('[render] Start debe ser bash scripts/render-start.sh — redirigiendo…');
  const result = spawnSync('bash', [script], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    env: process.env,
  });
  process.exit(typeof result.status === 'number' ? result.status : 1);
}

const { getToken: getPadronConsultaToken } = require('./peruConsultaPadron');
if (!getPadronConsultaToken()) {
  console.warn(
    '[consulta padrón] Defina PERU_CONSULTAS_TOKEN o DECOLECTA_API_KEY (https://decolecta.com/profile) para el botón DNI/RUC en caja.'
  );
}
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');
const { initDatabase, getDbPath, getDatabasePersistenceInfo, flushSaveDb, createSafetyBackup } = require('./database');
const { ensureUploadsRoot } = require('./uploadsPath');
const jwt = require('jsonwebtoken');
const { authenticateToken, requireRole, JWT_SECRET } = require('./middleware/auth');
const { createRateLimiter } = require('./middleware/rateLimit');

const app = express();
const server = http.createServer(app);

/** En Render/Railway el API es público; en PC local el bridge debe aceptar el origen de la PWA (Vercel) y localhost. */
function isCloudDeployment() {
  return String(process.env.RENDER || '').toLowerCase() === 'true' || !!process.env.RAILWAY_ENVIRONMENT;
}

const corsOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(v => v.trim())
  .filter(Boolean);

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wildcardToRegex(rule) {
  const escaped = escapeRegex(rule).replace(/\\\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

function isOriginAllowed(origin) {
  // Electron empaquetado (file://) suele enviar Origin "null".
  if (!origin || origin === 'null') return true;
  if (!isCloudDeployment()) {
    if (/\.vercel\.app$/i.test(origin)) return true;
    if (/^https?:\/\/localhost(:\d+)?$/i.test(origin)) return true;
    if (/^https?:\/\/127\.0\.0\.1(:\d+)?$/i.test(origin)) return true;
  }
  if (!corsOrigins.length) return true;
  if (corsOrigins.includes(origin)) return true;
  return corsOrigins
    .filter(rule => rule.includes('*'))
    .some((rule) => wildcardToRegex(rule).test(origin));
}

const corsOptions = {
  origin(origin, cb) {
    if (isOriginAllowed(origin)) return cb(null, true);
    return cb(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Backup-Bytes', 'Access-Control-Request-Private-Network'],
  exposedHeaders: ['X-Refreshed-Token'],
};
const io = new Server(server, {
  cors: corsOptions,
});

app.set('io', io);
const { setSocketIo } = require('./socketBroadcast');
setSocketIo(io);
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  next();
});
app.use(cors(corsOptions));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('x-request-id', requestId);
  req.requestId = requestId;
  next();
});
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    const elapsed = Date.now() - startedAt;
    console.log(JSON.stringify({
      level: 'info',
      msg: 'http_request',
      request_id: req.requestId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      elapsed_ms: elapsed,
    }));
  });
  next();
});

let uploadsDir;
try {
  uploadsDir = ensureUploadsRoot();
} catch (err) {
  console.error(err?.message || err);
  process.exit(1);
}
const billingCertsDir = path.join(uploadsDir, 'billing-certs');
if (!fs.existsSync(billingCertsDir)) fs.mkdirSync(billingCertsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).substr(2, 9)}${ext}`);
  }
});
const uploadImageExtOk = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.heic', '.heif', '.avif', '.bmp']);
const uploadWordExtOk = new Set(['.doc', '.docx']);
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const mime = String(file.mimetype || '').toLowerCase();
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowedMime = new Set([
      'image/jpeg', 'image/jpg', 'image/pjpeg', 'image/png', 'image/webp', 'image/gif',
      'image/svg+xml', 'image/heic', 'image/heif', 'image/avif', 'image/bmp', 'image/x-ms-bmp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]);
    if (allowedMime.has(mime)) return cb(null, true);
    if ((mime === 'application/octet-stream' || !mime) && uploadImageExtOk.has(ext)) return cb(null, true);
    if ((mime === 'application/octet-stream' || !mime) && uploadWordExtOk.has(ext)) return cb(null, true);
    return cb(new Error('Tipo de archivo no permitido (imagen, PDF o Word .doc / .docx)'));
  },
});

app.post('/api/upload', authenticateToken, requireRole('admin', 'cajero', 'mozo', 'master_admin'), (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'El archivo supera el límite de 15 MB' });
      }
      return res.status(400).json({ error: err.message || 'No se pudo subir el archivo' });
    }
    if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });
    res.json({ url: `/uploads/${req.file.filename}` });
  });
});

const certStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, billingCertsDir),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname || '') || '').toLowerCase();
    const safe = ext === '.p12' ? '.p12' : '.pfx';
    cb(null, `${Date.now()}-${Math.random().toString(36).substr(2, 9)}${safe}`);
  },
});
const certUpload = multer({
  storage: certStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = (path.extname(file.originalname || '') || '').toLowerCase();
    if (ext !== '.pfx' && ext !== '.p12') {
      return cb(new Error('Solo archivos .pfx o .p12'));
    }
    return cb(null, true);
  },
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.post('/api/upload/billing-cert', authenticateToken, requireRole('admin', 'master_admin'), (req, res) => {
  certUpload.single('cert')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'No se pudo guardar el certificado' });
    if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });
    res.json({ url: `/uploads/billing-certs/${req.file.filename}` });
  });
});

app.get('/api/healthz', (req, res) => res.json({ ok: true, uptime: process.uptime(), bridge: 'restaurant-node' }));
/** Instalación Windows: el front local descubre impresión sin escanear puertos del asistente. */
app.get('/api/printing/bridge', (req, res) => {
  const port = Number(process.env.PORT) || 3001;
  res.json({
    status: 'ok',
    mode: 'embedded',
    port,
    origin: `http://127.0.0.1:${port}`,
    service: 'resto-fadey-embedded-api',
  });
});
app.get('/api/readyz', async (req, res) => {
  try {
    await initDatabase();
    res.json({ ready: true });
  } catch (err) {
    res.status(503).json({ ready: false, error: err.message });
  }
});

const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 40,
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/customer/login', authLimiter);

app.use('/api/public/self-order', require('./routes/publicSelfOrder'));
app.use('/api/system', require('./routes/system'));
app.use('/api/license', require('./routes/license'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/restaurant', require('./routes/restaurant'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/products', require('./routes/products'));
app.use('/api/production-areas', require('./routes/productionAreas'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/users', require('./routes/users'));
app.use('/api/staff-chat', require('./routes/staffChat'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/kardex-inventory', require('./routes/kardexInventory'));
app.use('/api/pos', require('./routes/pos'));
app.use('/api/delivery', require('./routes/delivery'));
app.use('/api/tables', require('./routes/tables'));
app.use('/api/admin-modules', require('./routes/adminModules'));
app.use('/api/business-config', require('./routes/businessConfig'));
const { getPrinters } = require('./printing/printerDetector');
app.get('/printers', (req, res) => {
  try {
    const mod = String(req.query.module || '').trim().toLowerCase();
    const list = getPrinters().map((p) => ({ name: p.name }));
    console.log(
      `[printing] GET /printers → ${list.length} impresora(s)${mod ? ` (módulo solicitante: ${mod})` : ''}`,
    );
    res.json(list);
  } catch (err) {
    console.error('[printing] error GET /printers:', err.message || err);
    res.status(500).json({ error: 'No se pudieron detectar impresoras' });
  }
});
/** Alias solicitado: GET /api/printers → [{ "name": "..." }] (misma auth que /api/printing/printers). */
app.get(
  '/api/printers',
  authenticateToken,
  requireRole('admin', 'master_admin', 'cajero', 'mozo', 'cocina', 'bar'),
  (req, res) => {
    const mod = String(req.query.module || '').trim().toLowerCase();
    const list = getPrinters().map((p) => ({ name: p.name }));
    console.log(
      `[printing] GET /api/printers → ${list.length} impresora(s)${mod ? ` (módulo solicitante: ${mod})` : ''}`,
    );
    res.json(list);
  },
);
app.use('/api/printing', require('./routes/printing'));
app.use('/api/master-admin', require('./routes/masterAdmin'));
if (!process.env.ELECTRON_RUN_AS_NODE) {
  app.use('/api/central-sync', require('./routes/centralSync'));
  app.use('/api/platform-payments', require('./routes/platformPayments'));
}
const billingRoutes = require('./routes/billing');
app.use('/api/billing', billingRoutes);

app.use((err, req, res, next) => {
  if (!err) return next();
  const path = String(req.originalUrl || '');
  let fallback = 'Ocurrió un error. Intente nuevamente.';
  if (path.includes('/orders')) fallback = 'No se pudo procesar el pedido. Intente nuevamente.';
  else if (path.includes('/categories')) fallback = 'Error al guardar la categoría. Intente nuevamente.';
  const raw = String(err.message || '').trim();
  const safe =
    !raw || raw === 'undefined' || /^internal server error$/i.test(raw) ? fallback : raw;
  console.error(JSON.stringify({
    level: 'error',
    msg: 'unhandled_error',
    request_id: req.requestId,
    path: req.originalUrl,
    method: req.method,
    error: err.message,
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
  }));
  if (!res.headersSent) {
    res.status(err.status || 500).json({ error: safe });
  }
});

const clientBuild = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientBuild)) {
  app.use(express.static(clientBuild));
  app.get('*', (req, res) => res.sendFile(path.join(clientBuild, 'index.html')));
}

io.on('connection', (socket) => {
  console.log(`Cliente conectado: ${socket.id}`);
  socket.on('join-staff', (payload) => {
    try {
      const token = payload?.token;
      if (!token) return;
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded.type === 'customer' || decoded.role === 'master_admin') return;
      if (!decoded.id) return;
      socket.join(`staff-${decoded.id}`);
      socket.join('staff-broadcast');
    } catch (_) {
      /* token inválido: ignorar */
    }
  });
  socket.on('join-kitchen', () => { socket.join('kitchen'); });
  socket.on('join-bar', () => { socket.join('bar'); });
  socket.on('join-delivery', (driverId) => { socket.join(`delivery-${driverId}`); });
  socket.on('join-customer', (customerId) => { socket.join(`customer-${customerId}`); });
  socket.on('disconnect', () => { console.log(`Desconectado: ${socket.id}`); });
});

const PORT = Number(process.env.PORT) || 3001;
const LISTEN_HOST = process.env.LISTEN_HOST || (isCloudDeployment() ? '0.0.0.0' : '127.0.0.1');

function logSqlitePersistenceWarnings() {
  const info = getDatabasePersistenceInfo();
  const normalized = String(info.path || '').replace(/\\/g, '/');
  const onRender = String(process.env.RENDER || '').toLowerCase() === 'true';
  const onRailway = !!process.env.RAILWAY_ENVIRONMENT;
  const cloudEphemeralHost = onRender || onRailway;

  const persistentMount =
    normalized.startsWith('/data/') ||
    normalized === '/data/restaurant.db' ||
    normalized.startsWith('/mnt/') ||
    normalized.startsWith('/var/persistent/');

  if (!info.fileExistedBeforeInit) {
    console.warn(`
********************************************************************************
* [SQLite] Se creó o encontró una base NUEVA (vacía) en: ${info.path}
* Si ya tenías productos/usuarios y desaparecieron: no los borró el código del
* deploy; estás usando otra ruta o un disco EFÍMERO (típico en Render sin Disk).
********************************************************************************
`);
  }

  if (cloudEphemeralHost && !persistentMount) {
    console.error(`
********************************************************************************
* [CRÍTICO] Riesgo de PERDER DATOS en cada deploy / rebuild
* El archivo SQLite está fuera de un volumen persistente (${info.path}).
* Sin Disk + DB_PATH, Render/Railway recrean el contenedor y el .db desaparece.
*
* Render: Service → Disks → Add disk → Mount path: /data
* Environment: DB_PATH=/data/restaurant.db  (sin comillas, ruta absoluta)
* Luego Manual Deploy. Guía: DEPLOY_GITHUB_VERCEL_RENDER.md sección 1b
********************************************************************************
`);
  } else if (cloudEphemeralHost && persistentMount) {
    console.log(`[SQLite] DB_PATH parece volumen persistente: ${info.path} (motor ${info.engine})`);
  }
}

async function start() {
  try {
    await initDatabase();
  } catch (err) {
    console.error('[server] initDatabase no bloquea el arranque (maestro puede restaurar .db):', err.message || err);
  }
  try {
    const { ensureUserWorkSessionSchema } = require('./utils/ensureUserWorkSessionSchema');
    ensureUserWorkSessionSchema();
    const { backfillOpenSessionActivity, closeStaleOpenWorkSessions } = require('./services/workSessionService');
    backfillOpenSessionActivity();
    closeStaleOpenWorkSessions();
    setInterval(() => {
      try {
        closeStaleOpenWorkSessions();
      } catch (err) {
        console.warn('[work-session] auto-cierre inactividad:', err.message || err);
      }
    }, 60 * 60 * 1000);
  } catch (err) {
    console.warn('[db] user_work_sessions schema (startup):', err.message || err);
  }
  try {
    const { ensureOrdersSchema } = require('./utils/ensureOrdersSchema');
    ensureOrdersSchema();
  } catch (err) {
    console.warn('[db] orders schema (startup):', err.message || err);
  }
  try {
    const { repairKitchenOrdersAtStartup } = require('./services/kitchenOrderRepairService');
    repairKitchenOrdersAtStartup();
  } catch (err) {
    console.warn('[kitchen-repair] no ejecutada:', err.message || err);
  }
  try {
    const { migrateCatalogNamesToUppercase } = require('./services/catalogNameMigration');
    migrateCatalogNamesToUppercase();
  } catch (err) {
    console.warn('[catalog-names] migración no ejecutada:', err.message || err);
  }
  if (!process.env.ELECTRON_RUN_AS_NODE) {
    try {
      const { initPosSaasIdentity } = require('./services/posSaasIdentityService');
      initPosSaasIdentity();
    } catch (err) {
      console.warn('[saas-pos] identidad no inicializada:', err.message || err);
    }
  }
  logSqlitePersistenceWarnings();
  console.log(`[DB] SQLite path: ${getDbPath()} (${getDatabasePersistenceInfo().engine})`);
  console.log(`[uploads] Archivos estáticos en: ${uploadsDir}`);
  console.log('[printing] Bridge de impresión: rutas /api/printing/* y GET /api/printers (USB vía Node en esta máquina).');
  if (typeof billingRoutes.startBillingAutoRetryJob === 'function') {
    billingRoutes.startBillingAutoRetryJob();
  }
  if (!process.env.ELECTRON_RUN_AS_NODE) {
    try {
      const { startPlatformPaymentPoller } = require('./services/platformPaymentService');
      startPlatformPaymentPoller();
    } catch (err) {
      console.warn('[platform-payment] poller no iniciado:', err.message || err);
    }
  }
  try {
    const { startProductSalesMidnightJob } = require('./services/productSalesTrackingService');
    startProductSalesMidnightJob();
  } catch (err) {
    console.warn('[product-sales-idle] job nocturno no iniciado:', err.message || err);
  }
  try {
    const { startReservationScheduler } = require('./services/reservationSchedulerService');
    startReservationScheduler();
  } catch (err) {
    console.warn('[reservation-scheduler] no iniciado:', err.message || err);
  }
  try {
    const { processBarAutoDismiss } = require('./services/barAutoDismissService');
    setInterval(() => {
      try {
        processBarAutoDismiss({ io });
      } catch (err) {
        console.warn('[bar-auto-dismiss] intervalo:', err.message || err);
      }
    }, 60 * 1000);
  } catch (err) {
    console.warn('[bar-auto-dismiss] no iniciado:', err.message || err);
  }
  setInterval(() => {
    try {
      createSafetyBackup();
    } catch (err) {
      console.warn('[sqlite-backup] copia periódica:', err.message || err);
    }
  }, 10 * 60 * 1000);
  const flushSqliteOnExit = (signal) => {
    try {
      flushSaveDb();
      createSafetyBackup({ force: true });
    } catch (err) {
      console.warn('[sqlite] flush al salir:', err.message || err);
    }
    if (signal) process.exit(0);
  };
  process.on('SIGTERM', () => flushSqliteOnExit('SIGTERM'));
  process.on('SIGINT', () => flushSqliteOnExit('SIGINT'));
  process.on('beforeExit', () => {
    try {
      flushSaveDb();
    } catch (err) {
      console.warn('[sqlite] flush beforeExit:', err.message || err);
    }
  });
  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`[server] puerto ocupado: ${LISTEN_HOST}:${PORT}. Cierre la instancia previa o cambie PORT.`);
      return;
    }
    console.error('[server] error en el socket HTTP:', err.message || err);
  });
  server.listen(PORT, LISTEN_HOST, () => {
    const localUrl = `http://${LISTEN_HOST === '0.0.0.0' ? '127.0.0.1' : LISTEN_HOST}:${PORT}`;
    console.log(`[server] escuchando en http://${LISTEN_HOST}:${PORT} (acceso local típico: ${localUrl})`);
    console.log(`
======================================================
   RESTAURANT PLATFORM - SERVIDOR ACTIVO
   Host: ${LISTEN_HOST}  Puerto: ${PORT}
   Base de datos: ${getDbPath()}
   Impresión USB: ejecute este proceso en la PC caja (no se inicia solo desde el navegador/PWA).
   Maestro: use MASTER_USERNAME / MASTER_PASSWORD (.env) o credenciales ya guardadas.
   Staff: sin usuarios demo; el maestro crea el administrador en /master.
   Datos: en la nube use disco persistente y DB_PATH (ver .env.example).
======================================================
    `);
  });
}

start().catch((err) => {
  console.error('[server] error al iniciar la aplicación:', err.message || err);
  process.exit(1);
});
