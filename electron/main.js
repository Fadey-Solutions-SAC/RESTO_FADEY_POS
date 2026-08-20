const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const http = require('http');
const { execFile, spawn } = require('child_process');
const express = require('express');
const cors = require('cors');
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, Notification, shell, dialog } = require('electron');
const { buildTicket } = require('../server/printing/escposBuilder');
const { getThermalGdiFontPx } = require('../server/printing/thermalMagnify');
const thermalPrintLayoutJson = require('../server/printing/thermalPrintLayout.json');

try {
  const tl = require('../server/printing/thermalPrintLayout.json');
  const { getEscposMagnification } = require('../server/printing/thermalMagnify');
  const magRed = getEscposMagnification({ viaNetwork: true });
  const magUsb = getEscposMagnification({ viaNetwork: false });
  console.log(
    `[electron] Ticket térmico ${tl.revision} · base ${tl.charsPerLine['80']} cols (80 mm) · GS red ${magRed.width}×${magRed.height} · usb ${magUsb.width}×${magUsb.height}`,
  );
} catch (e) {
  console.warn('[electron] thermalPrintLayout:', e.message);
}

const CORE_MODULE_KEYS = ['caja', 'cocina', 'bar'];

function isPrintingModuleKey(key) {
  const k = String(key || '').trim();
  if (!k || k === '__proto__' || k === 'constructor' || k === 'prototype') return false;
  return /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(k);
}

function collectPrintingModuleKeys(...objs) {
  const keys = new Set(CORE_MODULE_KEYS);
  for (const o of objs) {
    if (!o || typeof o !== 'object') continue;
    for (const k of Object.keys(o)) {
      if (isPrintingModuleKey(k)) keys.add(k);
    }
  }
  return [...keys];
}
/** API principal embebida (instalación NSIS); debe coincidir con VITE_API_URL en build de escritorio. */
const EMBEDDED_API_DEFAULT_PORT = 3001;
/**
 * En la app empaquetada la API Node ocupa 3001; el asistente Express de impresión empieza en 3002.
 * En desarrollo no se lanza la API desde Electron, así que 3001 sigue siendo el puerto típico del asistente.
 */
const LOCAL_ASSISTANT_BASE_PORT = Number(
  process.env.RESTO_ASSISTANT_PORT || (app.isPackaged ? 3002 : 3001),
);
const ASSISTANT_PORT_TRY_COUNT = 25;
/** Puerto donde quedó escuchando el asistente (3001… o siguiente libre). */
let assistantListenPort = null;
/** Puerto de la API restaurant (solo empaquetado). */
let embeddedApiListenPort = null;
let restaurantApiChild = null;
/** Evita avisos duplicados y reinicios en cascada al arrancar/reintentar la API embebida. */
let embeddedApiHealthGeneration = 0;
let embeddedApiWatchdogTimer = null;
let embeddedApiStopIntentional = false;
const API_HEALTH_SLOW_NOTICE_MS = 30_000;
const API_HEALTH_RESTART_MS = 75_000;
const API_HEALTH_GIVE_UP_MS = 120_000;
const API_RESTART_COOLDOWN_MS = 2_000;
/** Evita repetir el mismo aviso de bandeja (p. ej. cada wake del navegador). */
const BALLOON_COOLDOWN_MS = 20 * 60 * 1000;
const balloonLastShownAt = new Map();
const balloonShownOncePerSession = new Set();
let lastEmbeddedApiSpawnErrorAt = 0;
let mainWindow = null; // Ventana oculta auxiliar para APIs de impresión del sistema.
let tray = null;
let localServer = null;
let printerLib = null;
try {
  // Fallback nativo RAW si el módulo está disponible en esa instalación.
  // eslint-disable-next-line global-require, import/no-extraneous-dependencies
  printerLib = require('printer');
  console.log('[electron-printing] módulo "printer" cargado');
} catch (err) {
  console.warn('[electron-printing] módulo "printer" no disponible, se usarán fallbacks');
}

function isValidIp(value) {
  return /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(String(value || '').trim());
}

function configPath() {
  return path.join(app.getPath('userData'), 'printer-config.json');
}

/** Secreto JWT estable para la API embebida (sin depender de .env en la PC del cliente). */
function ensureDesktopJwtSecret(userDataDir) {
  const secretFile = path.join(userDataDir, '.jwt-secret');
  try {
    if (fs.existsSync(secretFile)) {
      const existing = fs.readFileSync(secretFile, 'utf8').trim();
      if (existing.length >= 16) return existing;
    }
  } catch (_) {
    /* continuar a generar */
  }
  const generated = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(secretFile, generated, { encoding: 'utf8', mode: 0o600 });
    return generated;
  } catch (err) {
    console.warn('[electron] no se pudo persistir JWT_SECRET; usando secreto derivado estable:', err?.message || err);
    /** Evita regenerar un secreto distinto en cada arranque (invalidaría sesiones). */
    return crypto.createHash('sha256').update(`resto-fadey-desktop|${userDataDir}`).digest('hex');
  }
}

function defaultConfig() {
  return {
    caja: { tipo: 'usb', nombre: '', ip: '', puerto: 9100, autoPrint: true, paperWidth: 80 },
    cocina: { tipo: 'usb', nombre: '', ip: '', puerto: 9100, autoPrint: true, paperWidth: 80 },
    bar: { tipo: 'usb', nombre: '', ip: '', puerto: 9100, autoPrint: true, paperWidth: 80 },
  };
}

function normalizeModule(raw = {}, moduleKey) {
  const tipo = String(raw.tipo || 'usb').toLowerCase() === 'red' ? 'red' : 'usb';
  const paperRaw = Number(raw.anchoPapel ?? raw.paperWidth ?? 80);
  const paper =
    paperRaw === 50 ? 50 : paperRaw === 58 ? 58 : paperRaw === 75 ? 75 : 80;
  const puerto = Number(raw.puerto ?? 9100);
  return {
    tipo,
    nombre: String(raw.nombre || '').trim(),
    ip: tipo === 'usb' ? '' : String(raw.ip || '').trim(),
    puerto: Number.isFinite(puerto) && puerto > 0 && puerto <= 65535 ? puerto : 9100,
    autoPrint: moduleKey === 'caja' ? true : Boolean(raw.autoPrint ?? true),
    paperWidth: paper,
    anchoPapel: paper,
  };
}

function normalizeConfig(input) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const k of collectPrintingModuleKeys(src, defaultConfig())) {
    out[k] = normalizeModule(src[k], k);
  }
  return out;
}

function ensureConfigFile() {
  const p = configPath();
  if (!fs.existsSync(p)) {
    const cfg = normalizeConfig(defaultConfig());
    fs.writeFileSync(p, JSON.stringify(cfg, null, 2), 'utf8');
    console.log(`[electron-printing] config creada: ${p}`);
  }
}

function loadConfig() {
  try {
    ensureConfigFile();
    const p = configPath();
    const raw = fs.readFileSync(p, 'utf8');
    const cfg = normalizeConfig(JSON.parse(raw));
    console.log(`[electron-printing] config cargada: ${p}`);
    return cfg;
  } catch (err) {
    console.error('[electron-printing] error leyendo config:', err.message || err);
    const cfg = normalizeConfig(defaultConfig());
    try {
      fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf8');
    } catch (_) {
      // noop
    }
    return cfg;
  }
}

function saveConfig(input) {
  const current = loadConfig();
  const incoming = input && typeof input === 'object' ? input : {};
  const keys = collectPrintingModuleKeys(current, incoming, defaultConfig());
  const merged = {};
  for (const k of keys) {
    merged[k] = { ...(current[k] || {}), ...(incoming[k] || {}) };
  }
  const normalized = normalizeConfig(merged);
  keys
    .filter((k) => Object.prototype.hasOwnProperty.call(incoming, k))
    .forEach((k) => {
      const cfg = normalized[k];
      if (cfg.tipo !== 'usb') {
        if (!isValidIp(cfg.ip)) throw new Error(`IP inválida en ${k}`);
      }
    });
  fs.writeFileSync(configPath(), JSON.stringify(normalized, null, 2), 'utf8');
  console.log('[electron-printing] config guardada');
  return normalized;
}

async function getPrinters() {
  const win = mainWindow || BrowserWindow.getAllWindows()[0];
  const fromPrinterModule = () => {
    if (!printerLib || typeof printerLib.getPrinters !== 'function') return [];
    try {
      const list = (printerLib.getPrinters() || [])
        .map((p) => ({ name: String(p?.name || '').trim() }))
        .filter((p) => p.name);
      if (list.length) {
        console.log(`[electron-printing] impresoras detectadas (printer): ${list.length}`);
      }
      return list;
    } catch (err) {
      console.error('[electron-printing] error printer.getPrinters:', err.message || err);
      return [];
    }
  };
  const fromElectron = async () => {
    if (!win || typeof win.webContents?.getPrintersAsync !== 'function') {
      return [];
    }
    try {
      const raw = await win.webContents.getPrintersAsync();
      const list = (raw || [])
        .map((p) => ({ name: String(p?.name || '').trim() }))
        .filter((p) => p.name);
      if (list.length) {
        console.log(`[electron-printing] impresoras detectadas (Electron): ${list.length}`);
      }
      return list;
    } catch (err) {
      console.error('[electron-printing] error getPrintersAsync:', err.message || err);
      return [];
    }
  };

  const fromWindowsPowerShell = () => new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve([]);
    const ps = 'Get-Printer | Select-Object -ExpandProperty Name | ConvertTo-Json -Compress';
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { windowsHide: true, timeout: 5000, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          console.error('[electron-printing] error PowerShell Get-Printer:', err.message || err);
          return resolve([]);
        }
        try {
          const parsed = JSON.parse(String(stdout || '').trim() || '[]');
          const arr = Array.isArray(parsed) ? parsed : [parsed];
          const list = arr
            .map((name) => ({ name: String(name || '').trim() }))
            .filter((p) => p.name);
          if (list.length) {
            console.log(`[electron-printing] impresoras detectadas (PowerShell): ${list.length}`);
          }
          resolve(list);
        } catch (parseErr) {
          console.error('[electron-printing] JSON inválido de Get-Printer:', parseErr.message || parseErr);
          resolve([]);
        }
      },
    );
  });

  const first = fromPrinterModule();
  if (first.length) return first;
  const second = await fromElectron();
  if (second.length) return second;
  const third = await fromWindowsPowerShell();
  if (third.length) return third;
  if (!win) {
    console.warn('[electron-printing] getPrinters sin ventana y sin datos PowerShell');
  } else {
    console.warn('[electron-printing] no se detectaron impresoras por printer, Electron ni PowerShell');
  }
  return [];
}

function getNetworkPrintersFromWindows() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve([]);
    const ps = [
      '$printers = Get-Printer | Select-Object Name,PortName',
      '$ports = Get-PrinterPort | Select-Object Name,PrinterHostAddress,HostAddress,PortNumber',
      '$result = @()',
      'foreach($p in $printers){',
      '  $port = $ports | Where-Object { $_.Name -eq $p.PortName } | Select-Object -First 1',
      '  if($port){',
      '    $ip = $port.PrinterHostAddress',
      '    if(-not $ip){ $ip = $port.HostAddress }',
      '    if($ip){',
      '      $result += [pscustomobject]@{',
      '        name = $p.Name',
      '        ip = $ip',
      '        port = [int]($port.PortNumber)',
      '        portName = $p.PortName',
      '      }',
      '    }',
      '  }',
      '}',
      '$result | ConvertTo-Json -Compress',
    ].join('; ');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { windowsHide: true, timeout: 6000, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          console.error('[electron-printing] error Get-PrinterPort:', err.message || err);
          return resolve([]);
        }
        try {
          const parsed = JSON.parse(String(stdout || '').trim() || '[]');
          const arr = Array.isArray(parsed) ? parsed : [parsed];
          const list = arr
            .map((it) => ({
              name: String(it?.name || '').trim(),
              ip: String(it?.ip || '').trim(),
              port: Number(it?.port || 9100),
              portName: String(it?.portName || '').trim(),
            }))
            .filter((it) => isValidIp(it.ip) && Number.isFinite(it.port) && it.port > 0 && it.port <= 65535);
          console.log(`[electron-printing] impresoras de red detectadas (Windows): ${list.length}`);
          resolve(list);
        } catch (parseErr) {
          console.error('[electron-printing] JSON inválido Get-PrinterPort:', parseErr.message || parseErr);
          resolve([]);
        }
      },
    );
  });
}

function bufferToThermalPlain(buffer) {
  let s = Buffer.from(buffer || []).toString('latin1');
  s = s.replace(/\x1B\x40/g, '');
  s = s.replace(/\x1B\x61[\x00-\x02]/g, '');
  s = s.replace(/\x1D\x21[\x00-\xFF]/g, '');
  s = s.replace(/\x1B[\x20-\x7F]/g, '');
  s = s.replace(/[\r\n\x1A]*\x1D\x56[\x00\x01\x30\x31\x41][\s\S]*$/g, '');
  s = s.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');
  s = s.replace(/\n{3,}/g, '\n\n').trimEnd();
  return s;
}

function escapeHtmlPre(plain) {
  return String(plain || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function compactThermalLine(s) {
  return String(s || '').replace(/\s+/g, '').toUpperCase();
}

/** Quita la 1.ª línea si coincide con la marca (centrada con espacios) para repetirla como banner grande. */
function splitBrandFromThermalPlain(plain, brandRaw) {
  const brand = String(brandRaw || '').trim();
  if (!brand || !plain) return { banner: '', body: plain };
  const lines = plain.split(/\n/);
  if (!lines.length) return { banner: brand.toUpperCase(), body: plain };
  if (compactThermalLine(lines[0]) !== compactThermalLine(brand)) {
    return { banner: '', body: plain };
  }
  lines.shift();
  return { banner: brand.toUpperCase(), body: lines.join('\n') };
}

function escapeHtmlAttr(u) {
  return String(u || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isSpaceCenteredThermalLine(line) {
  const raw = String(line || '').replace(/\r/g, '');
  const core = raw.trim();
  if (!core) return false;
  if (raw === core) return false;
  const lead = raw.length - raw.trimStart().length;
  const trail = raw.length - raw.trimEnd().length;
  return lead >= 1 && Math.abs(lead - trail) <= 1;
}

function thermalPlainToGdiHtml(plain, fontPx) {
  const px = Math.max(9, Number(fontPx) || 11);
  const mono = "Consolas,'Courier New',monospace";
  return String(plain || '')
    .split('\n')
    .map((line) => {
      const raw = String(line || '').replace(/\r/g, '');
      if (!raw.trim()) return `<div style="height:0.55em" aria-hidden="true"></div>`;
      if (isSpaceCenteredThermalLine(raw)) {
        return `<div style="text-align:center;font-family:${mono};font-size:${px}px;line-height:1.25;font-weight:500;white-space:pre-wrap;word-break:keep-all;margin:0;padding:0">${escapeHtmlPre(raw.trim())}</div>`;
      }
      return `<div style="font-family:${mono};font-size:${px}px;line-height:1.25;font-weight:500;white-space:pre;overflow:visible;margin:0;padding:0">${escapeHtmlPre(raw)}</div>`;
    })
    .join('');
}

function printUSB(printerName, buffer, paperWidthMm = 80, gdiOpts = {}) {
  if (printerLib && typeof printerLib.printDirect === 'function') {
    return new Promise((resolve, reject) => {
      try {
        printerLib.printDirect({
          data: buffer,
          printer: String(printerName || '').trim(),
          type: 'RAW',
          success: () => resolve({ ok: true }),
          error: (err) => reject(new Error(err?.message || String(err || 'Error al imprimir RAW'))),
        });
      } catch (err) {
        reject(new Error(err?.message || 'Error al imprimir RAW'));
      }
    });
  }
  const win = mainWindow || BrowserWindow.getAllWindows()[0];
  if (!win) throw new Error('no hay ventana principal para imprimir');
  return new Promise((resolve, reject) => {
    const paperMm = (() => {
      const n = Number(paperWidthMm);
      if (n === 50 || n === 58 || n === 75 || n === 80) return n;
      if (Number.isFinite(n) && n > 0) return Math.min(80, Math.max(50, Math.round(n)));
      return 80;
    })();
    const logoUrl = String(gdiOpts.logoUrl || '').trim();
    const restaurantBrand = String(gdiOpts.restaurantBrand || '').trim();
    const plain = bufferToThermalPlain(buffer);
    const { banner, body } = splitBrandFromThermalPlain(plain, restaurantBrand);
    const fontPx = getThermalGdiFontPx(paperMm, { viaNetwork: false });
    const brandScale = Number(thermalPrintLayoutJson.gdiBrandFontScale);
    const brandMult =
      Number.isFinite(brandScale) && brandScale > 1 ? Math.min(2.25, brandScale) : 1.38;
    const brandPx = Math.min(42, Math.round(fontPx * brandMult));
    /** Micrómetros (1 mm = 1000) para `pageSize`; ancho = rollo configurado. */
    const pageW = Math.round(paperMm * 1000);
    const logoBlock = logoUrl
      ? `<div style="text-align:center;margin:0 auto 5px;width:100%"><img src="${escapeHtmlAttr(logoUrl)}" alt="" style="display:block;margin:0 auto;max-width:92%;max-height:24mm;object-fit:contain;image-orientation:from-image"/></div>`
      : '';
    const brandBlock = banner
      ? `<div style="text-align:center;font-weight:700;font-size:${brandPx}px;line-height:1.2;margin:0 auto 6px;padding:0;width:100%;font-family:Consolas,'Courier New',monospace">${escapeHtmlPre(banner)}</div>`
      : '';
    const bodyHtml = thermalPlainToGdiHtml(body.length ? body : '—', fontPx);
    const footSpacer = '<div style="height:8mm" aria-hidden="true"></div>';
    const html = `<!DOCTYPE html><meta charset="utf-8"><style>@page{margin:0}html,body{margin:0;padding:0;-webkit-print-color-adjust:exact;overflow:visible}body{width:${paperMm}mm;max-width:${paperMm}mm;margin:0 auto;box-sizing:border-box;overflow:visible}</style>${logoBlock}${brandBlock}${bodyHtml}${footSpacer}`;
    const printWin = new BrowserWindow({
      show: false,
      webPreferences: { offscreen: true },
    });
    const cleanup = (tmpPath) => {
      if (!tmpPath) return;
      try {
        fs.unlinkSync(tmpPath);
      } catch (_) {
        /* noop */
      }
    };
    let tmpHtml = null;
    if (html.length > 60000) {
      tmpHtml = path.join(app.getPath('temp'), `resto-gdi-print-${Date.now()}.html`);
      fs.writeFileSync(tmpHtml, html, 'utf8');
      printWin.loadFile(tmpHtml);
    } else {
      printWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    }
    printWin.webContents.on('did-fail-load', (_e, code, desc) => {
      cleanup(tmpHtml);
      printWin.close();
      reject(new Error(desc || `fallo al cargar vista de impresión (${code})`));
    });
    printWin.webContents.on('did-finish-load', () => {
      printWin.webContents.print(
        {
          silent: true,
          deviceName: printerName,
          printBackground: false,
          margins: { marginType: 'none' },
          pageSize: { width: pageW, height: 297000 },
        },
        (success, failureReason) => {
          cleanup(tmpHtml);
          if (!success) {
            console.error('[electron-printing] fallo print (USB):', failureReason);
            reject(new Error(failureReason || 'Error al imprimir'));
          } else {
            resolve({ ok: true });
          }
          printWin.close();
        },
      );
    });
  });
}

function printNetwork(ip, port, buffer) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    socket.setTimeout(3000);
    socket.connect(Number(port || 9100), String(ip || '').trim(), () => {
      socket.write(buffer);
      socket.end();
    });
    socket.on('error', (err) => reject(new Error(`error de conexión: ${err.message}`)));
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('error de conexión: timeout'));
    });
    socket.on('close', () => resolve({ ok: true }));
  });
}

async function printByModule(moduleKey, payload = {}) {
  const key = String(moduleKey || '').trim();
  if (!isPrintingModuleKey(key)) throw new Error('módulo inválido');
  const cfgAll = loadConfig();
  const cfg = cfgAll[key] || cfgAll[key.toLowerCase()];
  if (!cfg) throw new Error(`módulo no configurado: ${key}`);
  const pw =
    Number(payload.paperWidth) ||
    Number(payload.anchoPapel) ||
    Number(cfg.paperWidth) ||
    Number(cfg.anchoPapel) ||
    80;
  const viaNetwork = cfg.tipo !== 'usb';
  const useGdiUsbFallback =
    cfg.tipo === 'usb' && (!printerLib || typeof printerLib.printDirect !== 'function');
  const ticket = await buildTicket(
    key,
    { ...payload, paperWidth: pw, omitRasterForGdi: useGdiUsbFallback },
    { paperWidth: pw, viaNetwork },
  );
  if (cfg.tipo === 'usb') {
    if (!cfg.nombre) throw new Error(`impresora USB no configurada en ${key}`);
    console.log(`[electron-printing] imprimir ${key} usb (Electron driver): ${cfg.nombre}`);
    return printUSB(cfg.nombre, ticket, pw, {
      logoUrl: useGdiUsbFallback ? String(payload.logoUrl || payload.logo || '').trim() : '',
      restaurantBrand: String(payload.restaurantBrand || '').trim(),
    });
  }
  if (!isValidIp(cfg.ip)) throw new Error(`IP inválida en ${key}`);
  console.log(`[electron-printing] imprimir ${key} red: ${cfg.ip}:${cfg.puerto}`);
  return printNetwork(cfg.ip, cfg.puerto, ticket);
}

async function printerStatus(moduleKey) {
  const key = String(moduleKey || '').trim();
  if (!isPrintingModuleKey(key)) throw new Error('módulo inválido');
  const cfgAll = loadConfig();
  const cfg = cfgAll[key] || cfgAll[key.toLowerCase()];
  if (!cfg) throw new Error(`módulo no configurado: ${key}`);
  if (cfg.tipo === 'usb') {
    const connected = (await getPrinters()).some((p) => p.name === cfg.nombre);
    return { status: connected ? 'Conectada' : 'No disponible', connected, tipo: 'usb', module: key };
  }
  const connected = await new Promise((resolve) => {
    if (!isValidIp(cfg.ip)) return resolve(false);
    const socket = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch (_) { /* noop */ }
      resolve(ok);
    };
    socket.setTimeout(3000);
    socket.connect(Number(cfg.puerto || 9100), cfg.ip, () => finish(true));
    socket.on('error', () => finish(false));
    socket.on('timeout', () => finish(false));
  });
  return { status: connected ? 'Conectada' : 'No disponible', connected, tipo: 'red', module: key };
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  const preloadPath = path.join(__dirname, 'preload.js');
  mainWindow = new BrowserWindow({
    width: 600,
    height: 400,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: preloadPath,
    },
  });
  mainWindow.on('close', (e) => {
    // Asistente en segundo plano: no cerrar al hacer "X".
    if (app.isQuitting) return;
    e.preventDefault();
    mainWindow.hide();
  });
  mainWindow.loadURL('about:blank');
  return mainWindow;
}

function bridgePortFilePath() {
  return path.join(app.getPath('userData'), 'printing-bridge-port.json');
}

function saveBridgePort(port) {
  try {
    fs.writeFileSync(
      bridgePortFilePath(),
      JSON.stringify({ port, updatedAt: new Date().toISOString() }),
      'utf8',
    );
  } catch (_) {
    /* noop */
  }
}

function buildAssistantExpressApp() {
  const assistant = express();
  assistant.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    next();
  });
  assistant.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Access-Control-Request-Private-Network'],
  }));
  assistant.use(express.json({ limit: '2mb' }));

  const assistantHealthPayload = () => ({
    status: 'ok',
    mode: 'assistant',
    port: assistantListenPort || null,
    origin: assistantListenPort ? `http://127.0.0.1:${assistantListenPort}` : '',
    service: 'resto-fadey-printing-assistant',
  });

  assistant.get('/health', (_req, res) => res.json(assistantHealthPayload()));
  assistant.get('/api/health', (_req, res) => res.json(assistantHealthPayload()));
  assistant.get('/api/printing/bridge', (_req, res) => res.json(assistantHealthPayload()));
  assistant.get('/api/printers', async (_req, res) => {
    try {
      const list = await getPrinters();
      res.json(list);
    } catch (err) {
      res.status(500).json({ error: err?.message || 'No se pudo obtener impresoras' });
    }
  });
  assistant.get('/api/printing/config', (_req, res) => {
    try {
      res.json(loadConfig());
    } catch (err) {
      res.status(500).json({ error: err?.message || 'No se pudo leer configuración' });
    }
  });
  assistant.get('/api/printing/network-printers', async (_req, res) => {
    try {
      const list = await getNetworkPrintersFromWindows();
      res.json(list);
    } catch (err) {
      res.status(500).json({ error: err?.message || 'No se pudo detectar impresoras de red' });
    }
  });
  assistant.put('/api/printing/config', (req, res) => {
    try {
      res.json(saveConfig(req.body || {}));
    } catch (err) {
      res.status(400).json({ error: err?.message || 'No se pudo guardar configuración' });
    }
  });
  assistant.get('/api/printing/status/:module', async (req, res) => {
    try {
      const status = await printerStatus(req.params.module);
      res.json(status);
    } catch (err) {
      res.status(400).json({ error: err?.message || 'No se pudo obtener estado' });
    }
  });
  assistant.post('/api/printing/test/:module', async (req, res) => {
    try {
      const mod = String(req.params.module || '').trim();
      if (!isPrintingModuleKey(mod)) throw new Error('módulo inválido');
      const cfgAll = loadConfig();
      const cfg = cfgAll[mod] || cfgAll[mod.toLowerCase()];
      if (!cfg) throw new Error(`módulo no configurado: ${mod}`);
      const pw = cfg.paperWidth || cfg.anchoPapel || 80;
      await printByModule(mod, {
        title: 'PRUEBA DE IMPRESIÓN',
        text: `${mod.toUpperCase()}\n${pw} mm (config)\n${new Date().toLocaleString('es-PE')}`,
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err?.message || 'No se pudo imprimir prueba' });
    }
  });
  assistant.post('/api/printing/print/:module', async (req, res) => {
    try {
      await printByModule(req.params.module, req.body || {});
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err?.message || 'No se pudo imprimir' });
    }
  });

  return assistant;
}

function listenAssistantOnPort(expressApp, port) {
  return new Promise((resolve, reject) => {
    const srv = expressApp.listen(port, '127.0.0.1', () => resolve(srv));
    srv.on('error', (err) => reject(err));
  });
}

function getPackagedServerEntry() {
  return path.join(__dirname, '..', 'server', 'index.js');
}

function stopEmbeddedRestaurantApi() {
  embeddedApiHealthGeneration += 1;
  embeddedApiStopIntentional = true;
  if (!restaurantApiChild) return;
  try {
    restaurantApiChild.kill();
  } catch (_) {
    /* noop */
  }
  restaurantApiChild = null;
  embeddedApiListenPort = null;
}

function waitForEmbeddedApiHealthz(port, maxMs, callback) {
  const deadline = Date.now() + maxMs;
  const probe = () => {
    const req = http.get(`http://127.0.0.1:${port}/api/healthz`, (res) => {
      res.resume();
      if (res.statusCode === 200) {
        callback(true);
        return;
      }
      if (Date.now() < deadline) setTimeout(probe, 400);
      else callback(false);
    });
    req.on('error', () => {
      if (Date.now() < deadline) setTimeout(probe, 400);
      else callback(false);
    });
    req.setTimeout(2500, () => {
      try {
        req.destroy();
      } catch (_) {
        /* noop */
      }
      if (Date.now() < deadline) setTimeout(probe, 400);
      else callback(false);
    });
  };
  probe();
}

function tryOpenBrowserFirstRun(apiPort) {
  if (!app.isPackaged) return;
  const flagPath = path.join(app.getPath('userData'), '.resto-opened-browser-once');
  if (fs.existsSync(flagPath)) return;
  const url = `http://127.0.0.1:${apiPort}`;
  setTimeout(() => {
    void shell
      .openExternal(url)
      .then(() => {
        try {
          fs.writeFileSync(flagPath, new Date().toISOString(), 'utf8');
        } catch (_) {
          /* noop */
        }
      })
      .catch(() => {});
  }, 600);
}

function monitorEmbeddedApiHealth(portNum, { isRestart = false } = {}) {
  const gen = ++embeddedApiHealthGeneration;
  const startAt = Date.now();
  let slowNoticeShown = false;
  let failNoticeShown = false;
  let restartAttempted = false;

  const tick = () => {
    if (gen !== embeddedApiHealthGeneration || app.isQuitting) return;
    waitForEmbeddedApiHealthz(portNum, 2800, (ok) => {
      if (gen !== embeddedApiHealthGeneration || app.isQuitting) return;
      if (ok) {
        console.log('[electron] API respondió /api/healthz');
        if (slowNoticeShown) {
          showTrayBalloon(
            'Resto FADEY',
            'Servicio local listo. Ya puede usar el sistema e imprimir.',
            { oncePerSession: true },
          );
        }
        tryOpenBrowserFirstRun(portNum);
        updateTrayMenu();
        return;
      }

      const elapsed = Date.now() - startAt;
      if (!slowNoticeShown && elapsed >= API_HEALTH_SLOW_NOTICE_MS) {
        slowNoticeShown = true;
        showTrayBalloon(
          'Resto FADEY',
          'Iniciando servicios… Mantenga el ícono junto al reloj. Si hay antivirus, permita Resto FADEY en esta PC.',
          { oncePerSession: true },
        );
      }

      if (!restartAttempted && elapsed >= API_HEALTH_RESTART_MS) {
        restartAttempted = true;
        failNoticeShown = true;
        console.warn('[electron] API lenta o detenida; reinicio automático del servicio local');
        stopEmbeddedRestaurantApi();
        showTrayBalloon(
          'Resto FADEY',
          'Reiniciando servicio local. Espere un momento; no abra otra copia del programa.',
          { cooldownMs: 10 * 60 * 1000 },
        );
        setTimeout(() => {
          if (gen === embeddedApiHealthGeneration && !app.isQuitting) {
            startEmbeddedRestaurantApi({ isRestart: true });
          }
        }, API_RESTART_COOLDOWN_MS);
        return;
      }

      if (!failNoticeShown && elapsed >= API_HEALTH_GIVE_UP_MS) {
        failNoticeShown = true;
        showTrayBalloon(
          'Resto FADEY',
          'El servicio local tarda más de lo normal. Clic derecho en el ícono → «Reintentar servicio de impresión». Si persiste, excluya Resto FADEY del antivirus.',
          { oncePerSession: true },
        );
        return;
      }

      if (elapsed < API_HEALTH_GIVE_UP_MS + 15_000) {
        setTimeout(tick, 600);
      }
    });
  };

  if (isRestart) {
    setTimeout(tick, 800);
  } else {
    tick();
  }
}

function startEmbeddedApiWatchdog() {
  if (!app.isPackaged || embeddedApiWatchdogTimer) return;
  embeddedApiWatchdogTimer = setInterval(() => {
    if (app.isQuitting) return;
    const port = embeddedApiListenPort || EMBEDDED_API_DEFAULT_PORT;
    waitForEmbeddedApiHealthz(port, 4000, (ok) => {
      if (ok) return;
      if (restaurantApiChild) {
        console.warn('[electron] watchdog: API no responde aún; se espera sin reiniciar');
        return;
      }
      console.warn('[electron] watchdog: API caída; reinicio');
      startEmbeddedRestaurantApi({ isRestart: true });
    });
  }, 45_000);
}

function startEmbeddedRestaurantApi({ isRestart = false } = {}) {
  if (!app.isPackaged) return;
  if (restaurantApiChild && !isRestart) return;
  if (isRestart) stopEmbeddedRestaurantApi();
  const port = String(process.env.PORT || EMBEDDED_API_DEFAULT_PORT);
  const portNum = Number(port) || EMBEDDED_API_DEFAULT_PORT;
  embeddedApiListenPort = portNum;
  const userData = app.getPath('userData');
  const dbPath = path.join(userData, 'restaurant.db');
  const uploadsDir = path.join(userData, 'uploads');
  const jwtSecret = String(process.env.JWT_SECRET || '').trim() || ensureDesktopJwtSecret(userData);
  const printerConfigPath = path.join(userData, 'printer-config.json');
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    DB_PATH: dbPath,
    UPLOADS_DIR: uploadsDir,
    PRINTING_CONFIG_PATH: printerConfigPath,
    PORT: port,
    LISTEN_HOST: process.env.LISTEN_HOST || '0.0.0.0',
    JWT_SECRET: jwtSecret,
  };
  const serverEntry = getPackagedServerEntry();
  /** app.asar es un archivo en Windows; no puede ser cwd del spawn de la API embebida. */
  const cwd = app.isPackaged ? path.dirname(process.execPath) : path.join(__dirname, '..');
  const execPath = process.execPath;
  if (!fs.existsSync(execPath)) {
    console.error('[electron] ejecutable no encontrado:', execPath);
    showTrayBalloon(
      'Resto FADEY',
      'No se encontró el programa instalado. Reinstale RestoFADEY.Setup.exe y abra solo un acceso directo.',
    );
    return;
  }
  try {
    restaurantApiChild = spawn(execPath, [serverEntry], {
      env,
      cwd,
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    restaurantApiChild.on('error', (err) => {
      console.error('[electron] no se pudo iniciar API embebida (spawn):', err?.message || err);
      restaurantApiChild = null;
      embeddedApiListenPort = null;
      const now = Date.now();
      if (now - lastEmbeddedApiSpawnErrorAt >= 10 * 60 * 1000) {
        lastEmbeddedApiSpawnErrorAt = now;
        showTrayBalloon(
          'Resto FADEY',
          'Servicio local no inició. Cierre otras copias de Resto FADEY, reinstale si hace falta y use «Reintentar servicio de impresión».',
          { oncePerSession: true },
        );
      }
    });
    restaurantApiChild.stderr?.on('data', (d) => {
      const t = String(d || '').trimEnd().slice(-500);
      if (t) console.error('[resto-api]', t);
    });
    restaurantApiChild.on('exit', (code) => {
      console.warn('[resto-api] proceso API terminado, código:', code);
      restaurantApiChild = null;
      embeddedApiListenPort = null;
      updateTrayMenu();
      const intentional = embeddedApiStopIntentional;
      embeddedApiStopIntentional = false;
      if (!app.isQuitting && app.isPackaged && !intentional) {
        showTrayBalloon(
          'Resto FADEY',
          'El servicio local se detuvo (p. ej. antivirus). Reiniciando automáticamente…',
          { cooldownMs: 10 * 60 * 1000 },
        );
        setTimeout(() => startEmbeddedRestaurantApi({ isRestart: true }), API_RESTART_COOLDOWN_MS);
      }
    });
    console.log(`[electron] API Resto iniciada (DB: ${dbPath}, PORT=${port})`);
    monitorEmbeddedApiHealth(portNum, { isRestart });
  } catch (e) {
    embeddedApiListenPort = null;
    console.error('[electron] no se pudo iniciar API embebida:', e?.message || e);
    showTrayBalloon(
      'Resto FADEY',
      'No se pudo iniciar el servidor local. Revise el antivirus o use «Reintentar servicio de impresión» en el ícono junto al reloj.',
      { oncePerSession: true },
    );
  }
}

function showTrayBalloon(title, body, opts = {}) {
  const { oncePerSession = false, cooldownMs = BALLOON_COOLDOWN_MS } = opts;
  const key = `${String(title || '')}\0${String(body || '')}`;
  if (oncePerSession) {
    if (balloonShownOncePerSession.has(key)) return;
    balloonShownOncePerSession.add(key);
  } else {
    const last = balloonLastShownAt.get(key) || 0;
    if (Date.now() - last < cooldownMs) return;
    balloonLastShownAt.set(key, Date.now());
  }
  try {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
    }
  } catch (_) {
    /* noop */
  }
}

async function stopAssistantServer() {
  if (!localServer) return;
  await new Promise((resolve) => {
    try {
      localServer.close(() => resolve());
    } catch (_) {
      resolve();
    }
  });
  localServer = null;
}

async function startPrintingAssistantServer() {
  if (assistantListenPort && localServer) {
    return assistantListenPort;
  }
  await stopAssistantServer();
  assistantListenPort = null;

  let lastErr = null;
  for (let i = 0; i < ASSISTANT_PORT_TRY_COUNT; i += 1) {
    const port = LOCAL_ASSISTANT_BASE_PORT + i;
    try {
      const expressApp = buildAssistantExpressApp();
      localServer = await listenAssistantOnPort(expressApp, port);
      assistantListenPort = port;
      saveBridgePort(port);
      console.log(`[electron] asistente de impresión activo en http://127.0.0.1:${port}`);
      updateTrayMenu();
      return port;
    } catch (err) {
      lastErr = err;
      if (localServer) {
        try {
          localServer.close();
        } catch (_) {
          /* noop */
        }
        localServer = null;
      }
      if (err && err.code !== 'EADDRINUSE') {
        console.error('[electron] error servidor asistente:', err.message || err);
        break;
      }
    }
  }

  assistantListenPort = null;
  updateTrayMenu();
  console.error('[electron] no se pudo abrir ningún puerto para el asistente:', lastErr?.message || lastErr);
  showTrayBalloon(
    'Resto FADEY — Impresión',
    'No se pudo iniciar el servicio en esta PC (puertos ocupados). Elija «Reintentar servicio» en el ícono junto al reloj o reinicie Windows.',
    { oncePerSession: true },
  );
  return null;
}

function updateTrayMenu() {
  if (!tray) return;
  const statusLabel = assistantListenPort
    ? `Servicio listo · puerto ${assistantListenPort}`
    : 'Servicio detenido — pulse «Reintentar»';
  const template = [{ label: statusLabel, enabled: false }];
  if (app.isPackaged) {
    const apiPort = embeddedApiListenPort || EMBEDDED_API_DEFAULT_PORT;
    template.push({
      label: `Abrir sistema · puerto ${apiPort}`,
      click: () => {
        void shell.openExternal(`http://127.0.0.1:${apiPort}`).catch(() => {});
      },
    });
    template.push({
      label: 'Buscar actualizaciones',
      click: () => {
        void checkDesktopUpdates({ notifyIfNone: true });
      },
    });
  }
  template.push(
    {
      label: 'Reintentar servicio de impresión',
      click: () => {
        void startPrintingAssistantServer();
        if (app.isPackaged) {
          startEmbeddedRestaurantApi({ isRestart: true });
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Salir',
      click: () => {
        app.isQuitting = true;
        void stopAssistantServer().finally(() => {
          try {
            app.quit();
          } catch (_) {
            process.exit(0);
          }
        });
      },
    },
  );
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  if (tray) return;
  const iconPath = path.join(__dirname, '..', 'client', 'public', 'pwa-icon-192.png');
  const icon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('Resto FADEY — Impresión (mantenga abierto para cobrar con ticket)');
  updateTrayMenu();
}

function configureAutoStart() {
  if (process.platform !== 'win32') return;
  try {
    app.setLoginItemSettings({
      openAtLogin: true,
      path: process.execPath,
    });
    console.log('[electron] inicio con Windows activado');
  } catch (err) {
    console.warn('[electron] no se pudo activar inicio con Windows:', err?.message || err);
  }
}

let autoUpdaterRef = null;
let autoUpdateCheckInFlight = false;
let lastAutoUpdateNoticeAt = 0;

function getAutoUpdater() {
  if (autoUpdaterRef) return autoUpdaterRef;
  try {
    autoUpdaterRef = require('electron-updater').autoUpdater;
    autoUpdaterRef.autoDownload = true;
    autoUpdaterRef.autoInstallOnAppQuit = true;
    autoUpdaterRef.allowDowngrade = false;
    autoUpdaterRef.on('error', (err) => {
      console.warn('[electron-updater]', err?.message || err);
    });
    autoUpdaterRef.on('update-available', (info) => {
      console.log('[electron-updater] disponible:', info?.version);
      showTrayBalloon(
        'Resto FADEY',
        `Hay una actualización (${info?.version || ''}). Se descargará e instalará sola.`,
      );
    });
    autoUpdaterRef.on('update-downloaded', (info) => {
      console.log('[electron-updater] descargada:', info?.version);
      showTrayBalloon(
        'Resto FADEY',
        'Actualización lista. El sistema se reiniciará para aplicarla.',
      );
      setTimeout(() => {
        try {
          autoUpdaterRef.quitAndInstall(false, true);
        } catch (err) {
          console.warn('[electron-updater] install:', err?.message || err);
        }
      }, 2500);
    });
  } catch (err) {
    console.warn('[electron] electron-updater no disponible:', err?.message || err);
    autoUpdaterRef = null;
  }
  return autoUpdaterRef;
}

const DESKTOP_UPDATE_FEEDS = [
  { provider: 'github', owner: 'Fadey-Solutions-SAC', repo: 'RESTO_FADEY_POS' },
  { provider: 'github', owner: 'MECATRONIC-MEN', repo: 'RESTAURANT' },
  { provider: 'generic', url: 'https://updates.restofadey.com/desktop' },
];

async function checkDesktopUpdates({ notifyIfNone = false } = {}) {
  if (!app.isPackaged) return;
  const updater = getAutoUpdater();
  if (!updater || autoUpdateCheckInFlight) return;
  autoUpdateCheckInFlight = true;
  try {
    let lastErr = null;
    let result = null;
    for (const feed of DESKTOP_UPDATE_FEEDS) {
      try {
        updater.setFeedURL(feed);
        result = await updater.checkForUpdates();
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        console.warn('[electron-updater] feed', feed.owner || feed.url, err?.message || err);
      }
    }
    if (lastErr) throw lastErr;
    const remote = result?.updateInfo?.version;
    if (notifyIfNone && remote && remote === app.getVersion()) {
      const now = Date.now();
      if (now - lastAutoUpdateNoticeAt > 20_000) {
        lastAutoUpdateNoticeAt = now;
        dialog.showMessageBox({
          type: 'info',
          title: 'Resto FADEY',
          message: `Ya está en la última versión (${app.getVersion()}).`,
        }).catch(() => {});
      }
    }
  } catch (err) {
    console.warn('[electron-updater] check:', err?.message || err);
    if (notifyIfNone) {
      dialog.showMessageBox({
        type: 'warning',
        title: 'Resto FADEY',
        message: 'No se pudo buscar actualizaciones. Revise internet o publique un Release en GitHub.',
      }).catch(() => {});
    }
  } finally {
    autoUpdateCheckInFlight = false;
  }
}

function startDesktopAutoUpdater() {
  if (!app.isPackaged) return;
  const updater = getAutoUpdater();
  if (!updater) return;
  void checkDesktopUpdates();
  setInterval(() => {
    void checkDesktopUpdates();
  }, 4 * 60 * 60 * 1000);
}

function registerProtocolClient() {
  if (process.platform === 'win32' || process.platform === 'linux') {
    try {
      if (process.defaultApp && process.argv.length >= 2) {
        app.setAsDefaultProtocolClient('restofadey', process.execPath, [path.resolve(process.argv[1])]);
      } else {
        app.setAsDefaultProtocolClient('restofadey');
      }
    } catch (err) {
      console.warn('[electron] protocol restofadey://:', err?.message || err);
    }
  } else {
    try {
      app.setAsDefaultProtocolClient('restofadey');
    } catch (err) {
      console.warn('[electron] protocol restofadey://:', err?.message || err);
    }
  }
}

function extractProtocolUrl(argv = process.argv) {
  return (argv || []).find((arg) => String(arg || '').toLowerCase().startsWith('restofadey://')) || '';
}

function wakePrintingServicesFromProtocol() {
  /** Solo el arranque principal gestiona la API embebida (3001). El wake del navegador no debe reiniciarla. */
  if (!assistantListenPort) {
    void startPrintingAssistantServer();
  }
}

function handleProtocolWake(url = '') {
  const raw = String(url || '').trim();
  if (raw && !raw.toLowerCase().startsWith('restofadey://')) return;
  if (assistantListenPort && (!app.isPackaged || restaurantApiChild)) {
    console.log('[electron] wake ignorado: servicios ya activos');
    return;
  }
  console.log('[electron] activación por protocolo:', raw || 'restofadey://wake');
  wakePrintingServicesFromProtocol();
}

let pendingProtocolWake = extractProtocolUrl(process.argv);

registerProtocolClient();

app.on('open-url', (event, url) => {
  event.preventDefault();
  handleProtocolWake(url);
});

function registerPrintingIpc() {
  ipcMain.on('preload:ready', () => {
    console.log('[electron] IPC funcionando: preload:ready');
  });
  ipcMain.handle('printing:getBridgeOrigin', async () => ({
    ok: Boolean(assistantListenPort),
    origin: assistantListenPort ? `http://127.0.0.1:${assistantListenPort}` : '',
    port: assistantListenPort,
  }));
  ipcMain.handle('printing:health', async () => {
    if (!assistantListenPort) {
      throw new Error(
        'Servicio de impresión no activo. Clic derecho en el ícono Resto FADEY junto al reloj → «Reintentar servicio de impresión».',
      );
    }
    return { status: 'ok', port: assistantListenPort };
  });
  ipcMain.handle('printing:getConfig', async () => loadConfig());
  ipcMain.handle('printing:saveConfig', async (_event, cfg) => saveConfig(cfg));
  ipcMain.handle('printing:getPrinters', async (_event, moduleKey = '') => {
    console.log(`[electron-printing] getPrinters solicitado por módulo: ${moduleKey || '-'}`);
    return getPrinters();
  });
  ipcMain.handle('printing:getStatus', async (_event, moduleKey) => printerStatus(moduleKey));
  ipcMain.handle('printing:printTest', async (_event, moduleKey) => {
    const key = String(moduleKey || '').toLowerCase();
    const label = key === 'caja' ? 'Caja' : key === 'cocina' ? 'Cocina' : 'Bar';
    const cfg = loadConfig()[key];
    const pw = cfg?.paperWidth || cfg?.anchoPapel || 80;
    return printByModule(moduleKey, {
      title: 'PRUEBA DE IMPRESIÓN',
      text: `${label}\n${pw} mm (config)\n${new Date().toLocaleString('es-PE')}`,
    });
  });
  ipcMain.handle('printing:printModule', async (_event, moduleKey, payload) => printByModule(moduleKey, payload || {}));
}

const acquiredSingleInstance = app.requestSingleInstanceLock();

if (!acquiredSingleInstance) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const protocolUrl = extractProtocolUrl(argv);
    if (protocolUrl) handleProtocolWake(protocolUrl);
    else wakePrintingServicesFromProtocol();
  });

  app.on('will-quit', () => {
    if (embeddedApiWatchdogTimer) {
      clearInterval(embeddedApiWatchdogTimer);
      embeddedApiWatchdogTimer = null;
    }
    stopEmbeddedRestaurantApi();
  });

  app.whenReady().then(() => {
    console.log('[electron] proceso main iniciado');
    if (app.isPackaged) {
      console.log('[electron] ejecutable:', process.execPath);
    }
    if (pendingProtocolWake) {
      handleProtocolWake(pendingProtocolWake);
      pendingProtocolWake = '';
    }
    startEmbeddedRestaurantApi();
    startEmbeddedApiWatchdog();
    configureAutoStart();
    createWindow();
    createTray();
    void startPrintingAssistantServer();
    registerPrintingIpc();
    startDesktopAutoUpdater();
    app.on('activate', () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
    });
  });
}

app.on('window-all-closed', () => {
  // Mantener asistente en segundo plano.
  if (process.platform === 'darwin') app.dock?.hide();
});
