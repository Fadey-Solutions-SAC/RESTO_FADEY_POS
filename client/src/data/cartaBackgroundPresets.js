/** Fondos JPEG del generador. El sistema fija texto, título y subtítulos según el color de fondo. */

const dataUrlCache = new Map();

export const CARTA_BACKGROUND_PRESETS = [
  {
    id: 'negro',
    name: 'Negro',
    src: '/carta-formats/negro.jpeg',
    colors: {
      bg: '#0a0a0a',
      text: '#f8fafc',
      title: '#f5d76e',
      section: '#e8c547',
      price: '#f5d76e',
    },
  },
  {
    id: 'crema',
    name: 'Crema',
    src: '/carta-formats/crema.jpeg',
    colors: {
      bg: '#f4e8c8',
      text: '#1c1917',
      title: '#14532d',
      section: '#166534',
      price: '#3f2e1e',
    },
  },
  {
    id: 'pizarra',
    name: 'Pizarra',
    src: '/carta-formats/pizarra.jpeg',
    colors: {
      bg: '#171717',
      text: '#f8fafc',
      title: '#ffffff',
      section: '#e2e8f0',
      price: '#fde68a',
    },
  },
  {
    id: 'blanco',
    name: 'Blanco',
    src: '/carta-formats/blanco.jpeg',
    colors: {
      bg: '#fafafa',
      text: '#14532d',
      title: '#166534',
      section: '#15803d',
      price: '#9a3412',
    },
  },
  {
    id: 'marfil',
    name: 'Marfil',
    src: '/carta-formats/marfil.jpeg',
    colors: {
      bg: '#faf6ee',
      text: '#1c1917',
      title: '#9a3412',
      section: '#14532d',
      price: '#c2410c',
    },
  },
  {
    id: 'selva',
    name: 'Selva',
    src: '/carta-formats/selva.jpeg',
    colors: {
      bg: '#f7f1e3',
      text: '#14532d',
      title: '#166534',
      section: '#15803d',
      price: '#c2410c',
    },
  },
  {
    id: 'marfil-limon',
    name: 'Marfil limón',
    src: '/carta-formats/marfil-limon.jpeg',
    colors: {
      bg: '#faf6ee',
      text: '#1c1917',
      title: '#3f2e1e',
      section: '#14532d',
      price: '#a16207',
    },
  },
  {
    id: 'crema-tomate',
    name: 'Crema tomate',
    src: '/carta-formats/crema-tomate.jpeg',
    colors: {
      bg: '#f7f0dc',
      text: '#1c1917',
      title: '#14532d',
      section: '#166534',
      price: '#b91c1c',
    },
  },
  {
    id: 'blanco-organico',
    name: 'Blanco orgánico',
    src: '/carta-formats/blanco-organico.jpeg',
    colors: {
      bg: '#faf8f5',
      text: '#1c1917',
      title: '#14532d',
      section: '#166534',
      price: '#c2410c',
    },
  },
  {
    id: 'kraft',
    name: 'Kraft',
    src: '/carta-formats/kraft.jpeg',
    colors: {
      bg: '#d4b896',
      text: '#1c1917',
      title: '#3f2e1e',
      section: '#14532d',
      price: '#9a3412',
    },
  },
  {
    id: 'kraft-terracota',
    name: 'Kraft terracota',
    src: '/carta-formats/kraft-terracota.jpeg',
    colors: {
      bg: '#e8d5b5',
      text: '#1c1917',
      title: '#9a3412',
      section: '#14532d',
      price: '#c2410c',
    },
  },
];

export const DEFAULT_CARTA_PRESET_ID = 'crema';

export function cartaPresetById(id) {
  return CARTA_BACKGROUND_PRESETS.find((row) => row.id === id) || CARTA_BACKGROUND_PRESETS[0];
}

/** Convierte el JPEG público a data URL para que el SVG/PNG lo embeba. */
export async function loadCartaBackgroundDataUrl(src) {
  const key = String(src || '').trim();
  if (!key) return '';
  if (dataUrlCache.has(key)) return dataUrlCache.get(key);
  const res = await fetch(key);
  if (!res.ok) throw new Error('No se pudo cargar el fondo de la carta');
  const blob = await res.blob();
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('No se pudo leer el fondo de la carta'));
    reader.readAsDataURL(blob);
  });
  dataUrlCache.set(key, dataUrl);
  return dataUrl;
}

export async function resolvePresetBackgroundHref(presetId) {
  const preset = cartaPresetById(presetId);
  if (!preset?.src) return '';
  return loadCartaBackgroundDataUrl(preset.src);
}
