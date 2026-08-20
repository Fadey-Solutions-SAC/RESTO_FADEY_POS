/** Estilos tipográficos para la encuesta pública de fidelización. */
const LOYALTY_TEXT_STYLES = Object.freeze([
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

const STYLE_IDS = new Set(LOYALTY_TEXT_STYLES.map((s) => s.id));
const DEFAULT_TEXT_STYLE = 'clasico';

function normalizeTextStyle(value) {
  const id = String(value || '').trim().toLowerCase();
  return STYLE_IDS.has(id) ? id : DEFAULT_TEXT_STYLE;
}

module.exports = {
  LOYALTY_TEXT_STYLES,
  DEFAULT_TEXT_STYLE,
  normalizeTextStyle,
};
