import { cartaPresetById, DEFAULT_CARTA_PRESET_ID } from '../data/cartaBackgroundPresets.js';

/** Escapa texto de usuario para insertar en SVG/XML. */
export function escapeXml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function normalizeHex(color, fallback = '#000000') {
  const s = String(color || '').trim();
  const m = s.match(/^#?([0-9a-fA-F]{6})$/);
  if (m) return `#${m[1].toLowerCase()}`;
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  return fallback;
}

function hexToRgb(hex) {
  const h = normalizeHex(hex, '#000000').slice(1);
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHex(r, g, b) {
  const c = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function mixHex(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const u = 1 - t;
  return rgbToHex(A.r * u + B.r * t, A.g * u + B.g * t, A.b * u + B.b * t);
}

function shadeHex(hex, delta) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r + delta, g + delta, b + delta);
}

/** Colores por defecto del generador (se sobreescriben con el preset del fondo). */
export const DEFAULT_MENU_CARTA_COLORS = {
  bg: '#f4e8c8',
  text: '#1c1917',
  title: '#14532d',
  section: '#166534',
  price: '#3f2e1e',
};

/**
 * Interpreta líneas de menú.
 * - Línea con # al inicio (tras espacios): solo ahí es categoría / sección en la carta.
 * - Nombre | descripción  precio  (descripción y precio opcionales).
 * - Con precio al final: ítem con precio ("Ceviche clásico  28", "Lomo 35,50").
 * - Sin # y sin precio: ítem solo texto.
 */
export function parseMenuLines(raw) {
  const lines = String(raw || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const rows = [];
  for (const line of lines) {
    if (/^#+\s*/.test(line)) {
      rows.push({ kind: 'section', label: line.replace(/^#+\s*/, '').trim() });
      continue;
    }
    let rest = line;
    let price = null;
    const priced = rest.match(/^(.+?)\s+(?:S\/?\s*)?\$?\s*([\d.,]+)\s*$/i);
    if (priced) {
      const num = parseFloat(String(priced[2]).replace(',', '.'));
      if (Number.isFinite(num)) {
        rest = priced[1].replace(/[·\u00B7\u2013\u2014\-–—]\s*$/u, '').trim();
        price = num;
      }
    }
    let name = rest;
    let description = '';
    const pipe = rest.indexOf('|');
    if (pipe >= 0) {
      name = rest.slice(0, pipe).trim();
      description = rest.slice(pipe + 1).trim();
    }
    rows.push({
      kind: 'item',
      name: name || rest,
      description,
      price,
    });
  }
  return rows;
}

function formatPriceS(value) {
  const n = Number(value);
  if (value === null || value === undefined || !Number.isFinite(n)) return '';
  const fixed = Math.abs(n - Math.round(n)) < 0.001 ? String(Math.round(n)) : n.toFixed(2).replace(/\.?0+$/, '');
  return `S/ ${fixed}`;
}

function clipMenuName(name, max = 42) {
  const s = String(name || '').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function wrapWords(text, maxChars, maxLines = 2) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines) return lines.slice(0, maxLines);
    } else {
      current = next;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

function buildPresetDecor(pattern, W, H, padX, lineStroke, section) {
  const parts = [];
  if (pattern === 'frame') {
    parts.push(`<rect x="22" y="22" width="${W - 44}" height="${H - 44}" fill="none" stroke="${escapeXml(section)}" stroke-width="2.2" rx="8"/>`);
    parts.push(`<rect x="30" y="30" width="${W - 60}" height="${H - 60}" fill="none" stroke="${escapeXml(lineStroke)}" stroke-width="1" rx="5"/>`);
  }
  if (pattern === 'paper') {
    for (let y = 70; y < H - 40; y += 28) {
      parts.push(`<line x1="${padX}" y1="${y}" x2="${W - padX}" y2="${y}" stroke="${escapeXml(lineStroke)}" stroke-width="0.4" opacity="0.25"/>`);
    }
  }
  if (pattern === 'linen') {
    parts.push(`<rect width="100%" height="100%" fill="url(#linen)" opacity="0.18"/>`);
  }
  if (pattern === 'vignette') {
    parts.push(`<rect width="100%" height="100%" fill="url(#vignette)" pointer-events="none"/>`);
  }
  return parts;
}

/**
 * Genera un SVG tipo carta. page: 'a4' fija tamaño imprimible; 'auto' crece con el contenido.
 */
export function buildMenuCartaSvgString({
  rows,
  title = 'Nuestra carta',
  colors: colorsIn = {},
  presetId = DEFAULT_CARTA_PRESET_ID,
  page = 'a4',
  backgroundHref = '',
} = {}) {
  const preset = cartaPresetById(presetId);
  const c = { ...DEFAULT_MENU_CARTA_COLORS, ...preset.colors, ...colorsIn };
  const bg = normalizeHex(c.bg, DEFAULT_MENU_CARTA_COLORS.bg);
  const text = normalizeHex(c.text, DEFAULT_MENU_CARTA_COLORS.text);
  const titleFill = normalizeHex(c.title || c.text, DEFAULT_MENU_CARTA_COLORS.title);
  const section = normalizeHex(c.section, DEFAULT_MENU_CARTA_COLORS.section);
  const price = normalizeHex(c.price, DEFAULT_MENU_CARTA_COLORS.price);
  const bgStop0 = shadeHex(bg, 22);
  const bgStop1 = shadeHex(bg, 10);
  const bgStop2 = shadeHex(bg, -38);
  const subtitleFill = section;
  const footerFill = mixHex(text, bg, 0.42);
  const lineStroke = mixHex(section, bg, 0.45);
  const accent0 = mixHex(section, price, 0.35);
  const accent1 = section;
  const accent2 = mixHex(section, text, 0.25);
  const descFill = mixHex(text, bg, 0.28);
  const imageHref = String(backgroundHref || preset.src || '').trim();
  const hasPhoto = Boolean(imageHref);

  const isA4 = page !== 'auto';
  const W = isA4 ? 794 : 420;
  const padX = isA4 ? (hasPhoto ? 88 : 64) : 36;
  const titleBlock = isA4 ? 132 : 88;
  const lineHSection = isA4 ? 46 : 40;
  const lineHItem = isA4 ? 78 : 52;
  const list = Array.isArray(rows) ? rows : [];

  let totalH = titleBlock + 28 + 36;
  for (const r of list) {
    totalH += r.kind === 'section' ? lineHSection + 8 : lineHItem;
  }
  totalH += 36;
  const H = isA4 ? 1123 : totalH;

  const parts = [];
  parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeXml(title)}">`
  );
  parts.push(
    '<defs>',
    '<linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">',
    `<stop offset="0%" style="stop-color:${bgStop0}"/>`,
    `<stop offset="55%" style="stop-color:${bgStop1}"/>`,
    `<stop offset="100%" style="stop-color:${bgStop2}"/>`,
    '</linearGradient>',
    '<linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">',
    `<stop offset="0%" style="stop-color:${accent0}"/>`,
    `<stop offset="50%" style="stop-color:${accent1}"/>`,
    `<stop offset="100%" style="stop-color:${accent2}"/>`,
    '</linearGradient>',
    '<radialGradient id="vignette" cx="50%" cy="45%" r="72%">',
    '<stop offset="60%" stop-color="#000000" stop-opacity="0"/>',
    '<stop offset="100%" stop-color="#000000" stop-opacity="0.28"/>',
    '</radialGradient>',
    '<pattern id="linen" width="8" height="8" patternUnits="userSpaceOnUse">',
    `<path d="M0 8 L8 0" stroke="${escapeXml(lineStroke)}" stroke-width="0.6"/>`,
    '</pattern>',
    '</defs>'
  );
  parts.push(`<rect width="100%" height="100%" fill="${hasPhoto ? escapeXml(bg) : 'url(#bg)'}"/>`);
  if (hasPhoto) {
    parts.push(
      `<image href="${escapeXml(imageHref)}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice" />`
    );
  } else {
    parts.push(...buildPresetDecor(preset.pattern, W, H, padX, lineStroke, section));
    parts.push(`<rect x="${padX}" y="${isA4 ? 48 : 36}" width="${W - padX * 2}" height="3" fill="url(#accent)" rx="1.5"/>`);
  }
  parts.push(
    `<text x="${W / 2}" y="${isA4 ? 96 : 72}" text-anchor="middle" fill="${titleFill}" font-family="system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="${isA4 ? 36 : 26}" font-weight="700" letter-spacing="0.02em">${escapeXml(title)}</text>`
  );
  parts.push(
    `<text x="${W / 2}" y="${isA4 ? 124 : 96}" text-anchor="middle" fill="${subtitleFill}" font-family="system-ui,-apple-system,sans-serif" font-size="${isA4 ? 13 : 11}" letter-spacing="0.14em">MENÚ</text>`
  );

  let y = titleBlock + (isA4 ? 36 : 28);
  const nameMax = isA4 ? 46 : 36;
  const descMax = isA4 ? 62 : 42;
  const fontName = isA4 ? 20 : 16;
  const fontDesc = isA4 ? 13 : 11;
  const fontSection = isA4 ? 18 : 15;

  for (const r of list) {
    if (y > H - 56) break;
    if (r.kind === 'section') {
      parts.push(
        `<text x="${padX}" y="${y}" fill="${section}" font-family="system-ui,-apple-system,sans-serif" font-size="${fontSection}" font-weight="700" letter-spacing="0.06em">${escapeXml(r.label)}</text>`
      );
      parts.push(
        `<line x1="${padX}" y1="${y + 10}" x2="${W - padX}" y2="${y + 10}" stroke="${lineStroke}" stroke-width="1"/>`
      );
      y += lineHSection + 8;
    } else {
      const name = escapeXml(clipMenuName(r.name, nameMax));
      const hasPrice = r.price != null && Number.isFinite(Number(r.price));
      parts.push(
        `<text x="${padX}" y="${y}" fill="${text}" font-family="system-ui,-apple-system,sans-serif" font-size="${fontName}" font-weight="600">${name}</text>`
      );
      if (hasPrice) {
        parts.push(
          `<text x="${W - padX}" y="${y}" text-anchor="end" fill="${price}" font-family="system-ui,-apple-system,sans-serif" font-size="${fontName}" font-weight="700">${escapeXml(formatPriceS(r.price))}</text>`
        );
      }
      const descLines = wrapWords(r.description, descMax, 2);
      descLines.forEach((line, idx) => {
        parts.push(
          `<text x="${padX}" y="${y + 22 + idx * 16}" fill="${descFill}" font-family="system-ui,-apple-system,sans-serif" font-size="${fontDesc}" font-weight="400">${escapeXml(line)}</text>`
        );
      });
      y += lineHItem;
    }
  }

  parts.push(
    `<text x="${W / 2}" y="${H - 28}" text-anchor="middle" fill="${footerFill}" font-family="system-ui,-apple-system,sans-serif" font-size="${isA4 ? 12 : 10}">Gracias por su visita</text>`
  );
  parts.push('</svg>');
  return parts.join('');
}

/** Blob listo para `api.upload` (image/svg+xml). */
export function buildMenuCartaSvgBlob({ rows, title, colors, presetId, page = 'a4', backgroundHref }) {
  const svg = buildMenuCartaSvgString({ rows, title, colors, presetId, page, backgroundHref });
  return new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
}
