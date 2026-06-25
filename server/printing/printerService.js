const net = require('net');
const { loadConfig } = require('./printerConfig');
const { buildTicket } = require('./escposBuilder');
const { getPrinters } = require('./printerDetector');

let printerLib = null;
try {
  // eslint-disable-next-line global-require
  printerLib = require('printer');
} catch (_) {
  printerLib = null;
}

function isValidIp(value) {
  return /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(String(value || '').trim());
}

function printUsb(printerName, buffer) {
  if (!printerName) {
    throw new Error('impresora no encontrada: nombre USB vac?o');
  }
  if (!printerLib || typeof printerLib.printDirect !== 'function') {
    throw new Error('m?dulo "printer" no disponible en este entorno');
  }
  return new Promise((resolve, reject) => {
    printerLib.printDirect({
      data: buffer,
      printer: printerName,
      type: 'RAW',
      options: { interface: `printer:${printerName}` },
      success() { resolve({ ok: true }); },
      error(err) { reject(err); },
    });
  });
}

function printRed(ip, port, buffer) {
  const host = String(ip || '').trim();
  const safePort = Number(port || 9100);
  if (!isValidIp(host)) {
    throw new Error(`IP inv?lida: ${host}`);
  }
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    socket.setTimeout(3000);
    socket.connect(safePort, host, () => {
      socket.write(buffer);
      socket.end();
    });
    socket.on('error', (err) => {
      console.error('[printing] error red:', err.message || err);
      reject(new Error(`error de conexi?n: ${err.message}`));
    });
    socket.on('timeout', () => {
      socket.destroy();
      console.error('[printing] error red: timeout');
      reject(new Error('error de conexi?n: timeout'));
    });
    socket.on('close', () => resolve({ ok: true }));
  });
}

function checkRed(ip, port) {
  const host = String(ip || '').trim();
  const safePort = Number(port || 9100);
  if (!isValidIp(host)) return Promise.resolve(false);
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch (_) { /* noop */ }
      resolve(ok);
    };
    socket.setTimeout(3000);
    socket.connect(safePort, host, () => finish(true));
    socket.on('error', () => finish(false));
    socket.on('timeout', () => finish(false));
  });
}

async function getPrinterStatus(moduleName) {
  const moduleKey = String(moduleName || '').toLowerCase();
  if (!['caja', 'cocina', 'bar'].includes(moduleKey)) {
    throw new Error('m?dulo inv?lido para estado de impresora');
  }
  const cfg = loadConfig();
  const moduleCfg = cfg[moduleKey];
  if (moduleCfg.tipo === 'usb') {
    const printers = getPrinters();
    const connected = printers.some((p) => String(p.name || '').trim() === String(moduleCfg.nombre || '').trim());
    return {
      module: moduleKey,
      tipo: 'usb',
      connected,
      status: connected ? 'Conectada' : 'No disponible',
    };
  }
  const connected = await checkRed(moduleCfg.ip, moduleCfg.puerto);
  return {
    module: moduleKey,
    tipo: 'red',
    connected,
    status: connected ? 'Conectada' : 'No disponible',
  };
}

async function printTest(moduleName) {
  const moduleKey = String(moduleName || '').toLowerCase();
  const moduleLabel = moduleKey === 'caja' ? 'Caja' : moduleKey === 'cocina' ? 'Cocina' : 'Bar';
  return print(moduleKey, {
    title: 'PRUEBA DE IMPRESI?N',
    text: `${moduleLabel}\n${new Date().toLocaleString('es-PE')}`,
  });
}

async function print(moduleName, data = {}) {
  const moduleKey = String(moduleName || '').toLowerCase();
  if (!['caja', 'cocina', 'bar'].includes(moduleKey)) {
    throw new Error('m?dulo inv?lido para impresi?n');
  }
  const cfg = loadConfig();
  const moduleCfg = cfg[moduleKey];
  const pw =
    Number(data.paperWidth) ||
    Number(data.anchoPapel) ||
    Number(moduleCfg.anchoPapel) ||
    Number(moduleCfg.paperWidth) ||
    80;
  const viaNetwork = moduleCfg.tipo !== 'usb';
  const ticket = await buildTicket(moduleKey, { ...data, paperWidth: pw }, { paperWidth: pw, viaNetwork });
  const target = moduleCfg.tipo === 'usb'
    ? moduleCfg.nombre
    : `${moduleCfg.ip}:${moduleCfg.puerto}`;
  console.log(`[printing] m?dulo=${moduleKey} tipo=${moduleCfg.tipo} impresora=${target}`);

  if (moduleCfg.tipo === 'usb') {
    try {
      await printUsb(moduleCfg.nombre, ticket);
    } catch (err) {
      console.error(`[printing] error m?dulo=${moduleKey} tipo=usb impresora=${moduleCfg.nombre}:`, err.message || err);
      throw err;
    }
    return { ok: true, via: 'usb', module: moduleKey };
  }
  try {
    await printRed(moduleCfg.ip, moduleCfg.puerto, ticket);
  } catch (err) {
    console.error(`[printing] error m?dulo=${moduleKey} tipo=red impresora=${moduleCfg.ip}:${moduleCfg.puerto}:`, err.message || err);
    throw err;
  }
  return { ok: true, via: 'red', module: moduleKey };
}

module.exports = { print, printTest, getPrinterStatus, isValidIp };
