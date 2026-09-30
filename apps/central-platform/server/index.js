require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase } = require('./database');

const app = express();
const PORT = Number(process.env.PORT) || 4000;

if (!process.env.JWT_SECRET) {
  console.warn('[central] JWT_SECRET no definido');
}
if (!process.env.API_SECRET_KEY) {
  console.warn('[central] API_SECRET_KEY no definido — sync desde POS rechazada');
}

const corsOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: corsOrigins.length ? corsOrigins : true,
    credentials: true,
  })
);
app.use('/api/payments', express.json({ limit: '20mb' }));
app.use(express.json({ limit: '2mb' }));

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'restofadey-central' }));
app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'restofadey-central' }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/license-status', require('./routes/licenseStatus'));
app.use('/api/sync', require('./routes/sync'));
app.use('/api/admin', require('./routes/admin'));

const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));
app.get('/admin', (req, res) => {
  res.sendFile(path.join(publicDir, 'admin.html'));
});

async function start() {
  await initDatabase();
  app.listen(PORT, () => {
    console.log(`[central-platform] http://localhost:${PORT}`);
    console.log(`[central-platform] panel admin: http://localhost:${PORT}/admin`);
  });
}

start().catch((err) => {
  console.error('[central-platform] fallo al iniciar:', err);
  process.exit(1);
});
