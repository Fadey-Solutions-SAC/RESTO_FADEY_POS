const { logoToEscPosRaster } = require('./thermalLogo');
const {
  getEscposMagnification,
  thermalEffectiveCharsPerLine,
  gsBangMagnificationBuffer,
  GS_BANG_NORMAL,
} = require('./thermalMagnify');

/** Quita pies de depuración que no deben salir en papel (p. ej. «Modulo: caja»). */
function stripDebugLinesFromPreformattedText(raw) {
  let s = String(raw || '')
    .normalize('NFKC')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    /** Mismo criterio que `stripThermalDebugFooter`: no borrar espacios iniciales (centrado con espacios). */
    .trimEnd();
  s = s.replace(/\s*m[oó]dulo\s*:\s*[a-záéíóúñ0-9_-]+\b/gi, '');
  s = s.replace(/\n\d{1,2}\/\d{1,2}\/\d{4},\s*\d{1,2}:\d{2}:\d{2}\s*[ap]\.?\s*m\.?\s*$/i, '');
  return s
    .split('\n')
    .map((line) => line.replace(/\uFEFF/g, '').trimEnd())
    .filter((line) => {
      const t = String(line || '').trim();
      if (!t) return true;
      /** Mismo criterio que `stripThermalDebugFooter` en el cliente (no borrar líneas con «modulo» en medio). */
      if (/^m[oó]dulo\b/i.test(t)) return false;
      if (/^module\s*:/i.test(t)) return false;
      return true;
    })
    .join('\n');
}

function charsPerLine(paperWidth, options = {}) {
  return thermalEffectiveCharsPerLine(paperWidth, options);
}

/**
 * Líneas ya maquetadas por el cliente (espacios laterales importan). Sin `.trim()`;
 * si pasan de `width`, se parte en trozos fijos (no word-wrap).
 */
function wrapPreformattedPhysicalLine(line, width) {
  const raw = String(line ?? '').replace(/\r/g, '');
  const w = Math.max(1, Number(width) || 1);
  if (!raw) return [''];
  if (raw.length <= w) return [raw];
  const out = [];
  for (let i = 0; i < raw.length; i += w) {
    out.push(raw.slice(i, i + w));
  }
  return out;
}

function wrapLine(text, width) {
  const raw = String(text || '').trim();
  if (!raw) return [''];
  const words = raw.split(/\s+/).filter(Boolean);
  const out = [];
  let line = '';
  words.forEach((word) => {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= width) {
      line = next;
      return;
    }
    if (line) out.push(line);
    if (word.length <= width) {
      line = word;
      return;
    }
    for (let i = 0; i < word.length; i += width) {
      out.push(word.slice(i, i + width));
    }
    line = '';
  });
  if (line) out.push(line);
  return out.length ? out : [''];
}

/** ASCII imprimible para bytes que muchas térmicas tratan como texto plano. */
function escPosAsciiLine(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E]/g, '?');
}

/** Espacios finales dentro del ancho útil (evita salto de línea que desalinea el ticket). */
const THERMAL_LINE_TRAILING_MARGIN = 0;

/**
 * Centrado solo con espacios, línea exactamente `w` caracteres.
 * Con ESC a 0 (izquierda) la impresora no «re-centra» y no sale corrido.
 */
function centerLine(text, w) {
  const value = escPosAsciiLine(String(text || '').trim());
  const width = Math.max(1, Number(w) || 1);
  const tail = ' '.repeat(THERMAL_LINE_TRAILING_MARGIN);
  if (!value) return `${' '.repeat(width)}${tail}\n`;
  let vis = value.length > width ? value.slice(0, width) : value;
  if (vis.length >= width) return `${vis}${tail}\n`;
  const pad = width - vis.length;
  const left = Math.floor(pad / 2);
  const right = pad - left;
  return `${' '.repeat(left)}${vis}${' '.repeat(right)}${tail}\n`;
}

/**
 * Texto preformateado del cliente (ya centrado / tabulado). Sin `.trim()` para no romper espacios.
 * Solo ASCII térmico y ancho fijo `w` (mismo que `thermalCharWidth`).
 */
function preformattedLineOut(line, w) {
  const width = Math.max(1, Number(w) || 1);
  const raw = String(line ?? '').replace(/\r/g, '');
  const value = escPosAsciiLine(raw);
  let vis = value.length > width ? value.slice(0, width) : value;
  if (vis.length < width) vis += ' '.repeat(width - vis.length);
  return `${vis}${' '.repeat(THERMAL_LINE_TRAILING_MARGIN)}\n`;
}

/** Reinicio + alineación izquierda (sin tamaño; el GS ! va tras el logo si hay). */
const INIT_LEFT = Buffer.from('\x1B\x40\x1B\x61\x00', 'binary');
const ALIGN_CENTER = Buffer.from('\x1B\x61\x01', 'binary');
const CUT_PARTIAL = Buffer.from('\x1D\x56\x41', 'binary');

function magnifyStartBuffer(options = {}) {
  const viaNetwork = options.viaNetwork === true;
  const { width: mw, height: mh } = getEscposMagnification({ viaNetwork });
  const mag = gsBangMagnificationBuffer(mw, mh);
  return mag || Buffer.alloc(0);
}

/** Avance antes del corte para que el último renglón no quede pegado al borde del papel. */
const FEED_BEFORE_CUT = Buffer.from('\n\n\n\n\n', 'latin1');

function tailAfterBody() {
  return Buffer.concat([FEED_BEFORE_CUT, GS_BANG_NORMAL, CUT_PARTIAL]);
}

/**
 * @param {string} moduleName
 * @param {object} data
 * @param {object} options — { paperWidth: 58|80, viaNetwork?: boolean }
 * @returns {Promise<Buffer>}
 */
async function buildTicket(moduleName, data = {}, options = {}) {
  const paperW = Number(data.paperWidth) || Number(options.paperWidth) || 80;
  const width = charsPerLine(paperW, options);

  /** Sin `.trim()` global: borra espacios de centrado de la 1.ª línea. */
  const cleanedPreformatted = stripDebugLinesFromPreformattedText(String(data.text ?? ''));
  if (data.preformatted && cleanedPreformatted) {
    const parts = [];
    cleanedPreformatted.split('\n').forEach((rawPart) => {
      /** Conservar espacios de centrado/inset del cliente (`wrapLine` hace trim y desplaza el bloque). */
      wrapPreformattedPhysicalLine(rawPart, width).forEach((line) => {
        parts.push(Buffer.from(preformattedLineOut(line, width), 'latin1'));
      });
    });
    parts.push(Buffer.from('\n', 'latin1'));
    const body = Buffer.concat(parts);

    const chunks = [INIT_LEFT];

    const modKey = String(moduleName || '').toLowerCase();
    const logoUrl = data.logoUrl || data.logo;
    const skipLogo = data.skipThermalLogo === true || String(process.env.RESTO_THERMAL_NO_LOGO || '') === '1';
    /**
     * Caja (precuenta, nota, boleta/factura): logo por defecto si hay URL.
     * Raster no se incrusta si `omitRasterForGdi` (Electron imprime `<img>` en HTML).
     */
    const wantLogo =
      Boolean(logoUrl) &&
      !skipLogo &&
      (data.includeThermalLogo === true ||
        (data.includeThermalLogo !== false && modKey === 'caja') ||
        String(process.env.RESTO_THERMAL_LOGO || '') === '1');
    const embedRaster = wantLogo && !data.omitRasterForGdi;
    if (embedRaster) {
      const raster = await logoToEscPosRaster(String(logoUrl).trim(), paperW);
      if (raster && raster.length) {
        chunks.push(ALIGN_CENTER);
        chunks.push(raster);
        chunks.push(INIT_LEFT);
        chunks.push(Buffer.from('\n', 'latin1'));
      }
    }

    const magBuf = magnifyStartBuffer(options);
    if (magBuf.length) chunks.push(magBuf);

    chunks.push(body);
    chunks.push(tailAfterBody());
    return Buffer.concat(chunks);
  }

  const bodyParts = [];
  const pushCentered = (raw) => {
    wrapLine(raw, width).forEach((ln) => {
      bodyParts.push(Buffer.from(centerLine(ln, width), 'latin1'));
    });
  };

  const headerRaw =
    String(data.restaurantHeader || data.restaurantName || 'RESTAURANTE').trim() || 'RESTAURANTE';
  pushCentered(headerRaw.toUpperCase());
  if (data.title) pushCentered(String(data.title).toUpperCase());
  if (data.mesa) pushCentered(`Mesa: ${data.mesa}`);
  if (data.orderNumber != null) pushCentered(`Pedido: #${data.orderNumber}`);
  bodyParts.push(Buffer.from(centerLine('-'.repeat(width), width), 'latin1'));

  const items = Array.isArray(data.items) ? data.items : [];
  items.forEach((item) => {
    const qty = Number(item.quantity || item.qty || 0);
    const name = String(item.product_name || item.name || '').trim() || 'Producto';
    pushCentered(`${qty || 1} ${name}`);
  });

  if (items.length === 0 && data.text) {
    String(data.text)
      .split('\n')
      .forEach((part) => pushCentered(part));
  }

  bodyParts.push(Buffer.from('\n', 'latin1'));
  bodyParts.push(Buffer.from(centerLine('-'.repeat(width), width), 'latin1'));
  bodyParts.push(Buffer.from('\n', 'latin1'));

  const body = Buffer.concat(bodyParts);

  const magBuf = magnifyStartBuffer(options);
  const head = magBuf.length ? Buffer.concat([INIT_LEFT, magBuf]) : INIT_LEFT;
  return Buffer.concat([head, body, tailAfterBody()]);
}

module.exports = { buildTicket, charsPerLine };
