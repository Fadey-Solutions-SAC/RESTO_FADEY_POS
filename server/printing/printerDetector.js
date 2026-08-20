const { execFileSync } = require('child_process');

let printerLib = null;
try {
  // eslint-disable-next-line global-require
  printerLib = require('printer');
} catch (_) {
  printerLib = null;
}

let cache = { at: 0, list: null };
const CACHE_MS = 4000;

function parsePrinterNameJson(stdout) {
  const parsed = JSON.parse(String(stdout || '').trim() || '[]');
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  return arr
    .map((name) => ({
      name: String(name || '').trim(),
      status: '',
      isDefault: false,
    }))
    .filter((p) => p.name);
}

function getPrintersFromPowerShell() {
  if (process.platform !== 'win32') return [];
  try {
    const stdout = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        'Get-Printer | Select-Object -ExpandProperty Name | ConvertTo-Json -Compress',
      ],
      { windowsHide: true, timeout: 8000, encoding: 'utf8', maxBuffer: 1024 * 1024 },
    );
    const list = parsePrinterNameJson(stdout);
    if (list.length) {
      console.log(`[printing] impresoras detectadas (PowerShell): ${list.length}`);
    }
    return list;
  } catch (err) {
    console.warn('[printing] PowerShell Get-Printer:', err.message || err);
    return [];
  }
}

function getPrintersFromNativeModule() {
  if (!printerLib || typeof printerLib.getPrinters !== 'function') return [];
  try {
    const list = printerLib.getPrinters().map((p) => ({
      name: String(p?.name || '').trim(),
      status: String(p?.status || ''),
      isDefault: Boolean(p?.isDefault),
    })).filter((p) => p.name);
    if (list.length) {
      console.log(`[printing] impresoras detectadas (módulo printer): ${list.length}`);
    }
    return list;
  } catch (err) {
    console.error('[printing] error detectando USB:', err.message);
    return [];
  }
}

function getPrinters() {
  const now = Date.now();
  if (cache.list && now - cache.at < CACHE_MS) return cache.list;
  let list = getPrintersFromNativeModule();
  if (!list.length) list = getPrintersFromPowerShell();
  if (!list.length && process.platform === 'win32') {
    console.warn('[printing] no se detectaron impresoras (módulo printer ni PowerShell).');
  }
  cache = { at: now, list };
  return list;
}

function getNetworkPrinters() {
  if (process.platform !== 'win32') return [];
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
  try {
    const stdout = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { windowsHide: true, timeout: 8000, encoding: 'utf8', maxBuffer: 1024 * 1024 },
    );
    const parsed = JSON.parse(String(stdout || '').trim() || '[]');
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    const list = arr
      .map((it) => ({
        name: String(it?.name || '').trim(),
        ip: String(it?.ip || '').trim(),
        port: Number(it?.port || 9100) || 9100,
        portName: String(it?.portName || '').trim(),
      }))
      .filter((it) => it.ip);
    console.log(`[printing] impresoras de red detectadas (Windows): ${list.length}`);
    return list;
  } catch (err) {
    console.warn('[printing] PowerShell Get-PrinterPort:', err.message || err);
    return [];
  }
}

module.exports = { getPrinters, getNetworkPrinters };
