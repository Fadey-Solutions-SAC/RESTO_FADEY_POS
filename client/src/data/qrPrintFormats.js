/** Formatos de hoja QR incluidos (proporción A5). Las fracciones son del ancho y alto de la imagen. */
export const QR_PRINT_FORMATS = [
  {
    id: 'bar',
    name: 'Bar',
    src: '/qr-formats/bar.jpg?v=a5',
    logoShape: 'ellipse',
    qr: { x: 0.327, y: 0.447, w: 0.343, h: 0.225 },
    logo: { x: 0.33, y: 0.037, w: 0.34, h: 0.132 },
  },
  {
    id: 'heladeria',
    name: 'Heladería',
    src: '/qr-formats/heladeria.jpg?v=a5',
    logoShape: 'ellipse',
    qr: { x: 0.33, y: 0.437, w: 0.337, h: 0.23 },
    logo: { x: 0.31, y: 0.024, w: 0.38, h: 0.153 },
  },
  {
    id: 'polleria',
    name: 'Pollería',
    src: '/qr-formats/polleria.jpg?v=a5',
    logoShape: 'ellipse',
    qr: { x: 0.333, y: 0.439, w: 0.337, h: 0.225 },
    logo: { x: 0.285, y: 0.032, w: 0.43, h: 0.169 },
  },
  {
    id: 'rio',
    name: 'Río',
    src: '/qr-formats/rio.jpg?v=a5',
    logoShape: 'ellipse',
    qr: { x: 0.33, y: 0.431, w: 0.337, h: 0.219 },
    logo: { x: 0.3, y: 0.015, w: 0.4, h: 0.153 },
  },
  {
    id: 'parrilla',
    name: 'Parrilla',
    src: '/qr-formats/parrilla.jpg?v=a5',
    logoShape: 'ellipse',
    qr: { x: 0.333, y: 0.434, w: 0.331, h: 0.215 },
    logo: { x: 0.32, y: 0.022, w: 0.36, h: 0.148 },
  },
  {
    id: 'restaurante',
    name: 'Restaurante',
    src: '/qr-formats/restaurante.jpg?v=a5',
    logoShape: 'roundrect',
    qr: { x: 0.333, y: 0.431, w: 0.334, h: 0.217 },
    logo: { x: 0.355, y: 0.009, w: 0.29, h: 0.135 },
  },
  {
    id: 'playa',
    name: 'Playa',
    src: '/qr-formats/playa.jpg?v=a5',
    logoShape: 'ellipse',
    qr: { x: 0.318, y: 0.434, w: 0.358, h: 0.236 },
    logo: { x: 0.3, y: 0.005, w: 0.4, h: 0.159 },
  },
  {
    id: 'restobar',
    name: 'Restobar',
    src: '/qr-formats/restobar.jpg?v=a5',
    logoShape: 'roundrect',
    qr: { x: 0.333, y: 0.433, w: 0.331, h: 0.215 },
    logo: { x: 0.34, y: 0.001, w: 0.32, h: 0.14 },
  },
  {
    id: 'selva',
    name: 'Selva',
    src: '/qr-formats/selva.jpg?v=a5',
    logoShape: 'ellipse',
    qr: { x: 0.326, y: 0.452, w: 0.346, h: 0.243 },
    logo: { x: 0.27, y: 0.005, w: 0.46, h: 0.164 },
  },
];

function formatSrcKey(src) {
  return String(src || '')
    .split('?')[0]
    .replace(/\\/g, '/');
}

export function qrPrintFormatBySrc(src) {
  const value = formatSrcKey(src);
  if (!value) return null;
  return (
    QR_PRINT_FORMATS.find((item) => {
      const key = formatSrcKey(item.src);
      return value === key || value.endsWith(key) || key.endsWith(value);
    }) || null
  );
}
