export const LOYALTY_TEXT_STYLES = Object.freeze([
  { id: 'clasico', label: 'Clásico', hint: 'Sans-serif limpio y equilibrado' },
  { id: 'refinado', label: 'Refinado', hint: 'Serif de lujo con detalle editorial' },
  { id: 'moderno', label: 'Moderno', hint: 'Geométrico, nítido y actual' },
  { id: 'serif_elegante', label: 'Serif elegante', hint: 'Tipografía alta con aire premium' },
  { id: 'caligrafia', label: 'Caligrafía', hint: 'Títulos manuscritos y cuerpo suave' },
  { id: 'minimal', label: 'Minimal', hint: 'Líneas simples, mucho espacio' },
  { id: 'boutique', label: 'Boutique', hint: 'Capitales finas estilo boutique' },
  { id: 'gourmet', label: 'Gourmet', hint: 'Ideal para restaurante y alta cocina' },
  { id: 'artesanal', label: 'Artesanal', hint: 'Serif cálido con sans moderno' },
  { id: 'contemporaneo', label: 'Contemporáneo', hint: 'Redondeado, amigable y actual' },
]);

export const DEFAULT_LOYALTY_TEXT_STYLE = 'clasico';

export function surveyTypeClass(textStyle) {
  const id = String(textStyle || DEFAULT_LOYALTY_TEXT_STYLE).trim().toLowerCase();
  const valid = LOYALTY_TEXT_STYLES.some((s) => s.id === id);
  return `rf-survey-type--${valid ? id : DEFAULT_LOYALTY_TEXT_STYLE}`;
}

export function getTextStyleMeta(id) {
  return LOYALTY_TEXT_STYLES.find((s) => s.id === id) || LOYALTY_TEXT_STYLES[0];
}
