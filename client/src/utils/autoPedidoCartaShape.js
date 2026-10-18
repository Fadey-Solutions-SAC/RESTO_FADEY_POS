export function isGeneratedCarta(carta) {
  const generated = carta?.generated;
  if (generated && typeof generated === 'object') {
    return Boolean(String(generated.text || '').trim() || String(generated.title || '').trim());
  }
  return String(carta?.source || '') === 'generated';
}

export function cartaHasDisplayableContent(carta) {
  return Boolean(String(carta?.url || '').trim() || isGeneratedCarta(carta));
}

export function buildGeneratedCartaPayload({ title, text, presetId, colors, style } = {}) {
  return {
    title: String(title || '').trim(),
    text: String(text || ''),
    presetId: String(presetId || '').trim(),
    colors: colors && typeof colors === 'object' ? { ...colors } : {},
    style: style && typeof style === 'object' ? { ...style } : {},
  };
}
