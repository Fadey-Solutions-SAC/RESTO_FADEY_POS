#!/usr/bin/env node
const assert = require('assert');

async function main() {
  const { parseMenuLines, buildMenuCartaSvgString } = await import('../client/src/utils/generateMenuCartaSvg.js');
  const { buildCartaTextFromCategory, CARTA_MAX_PRODUCTS } = await import('../client/src/utils/cartaFromCatalog.js');

  const rows = parseMenuLines(`# Entradas
Ceviche clásico | Pescado fresco  28
Wantán frito  18`);
  assert.strictEqual(rows[0].kind, 'section');
  assert.strictEqual(rows[1].name, 'Ceviche clásico');
  assert.strictEqual(rows[1].description, 'Pescado fresco');
  assert.strictEqual(rows[1].price, 28);
  assert.strictEqual(rows[2].price, 18);

  const category = { id: 'c1', name: 'Entradas' };
  const products = Array.from({ length: 12 }, (_, i) => ({
    id: `p${i}`,
    name: `Plato ${i + 1}`,
    description: `Desc ${i + 1}`,
    price: 10 + i,
    category_id: 'c1',
    is_active: 1,
  }));
  const packed = buildCartaTextFromCategory({ category, products });
  assert.strictEqual(packed.used, CARTA_MAX_PRODUCTS);
  assert.strictEqual(packed.omitted, 2);
  assert.ok(packed.text.includes('Plato 1 | Desc 1  10'));

  const svg = buildMenuCartaSvgString({
    rows: packed.text ? parseMenuLines(packed.text) : [],
    title: packed.title,
    presetId: 'crema',
    page: 'a4',
  });
  assert.ok(svg.includes('viewBox="0 0 794 1123"'));
  assert.ok(svg.includes('Desc 1'));
  assert.ok(svg.includes('S/ 10'));
  assert.ok(svg.includes('/carta-formats/crema.jpeg'));
  assert.ok(svg.includes('#14532d'));
  assert.ok(!svg.includes('>MENÚ</text>'));

  const svgWine = buildMenuCartaSvgString({
    rows: parseMenuLines('Malbec  63'),
    title: 'Vinos y champán',
    presetId: 'negro',
    page: 'a4',
    style: { subtitle: '', titleSize: 30 },
  });
  assert.ok(!svgWine.includes('>MENÚ</text>'));
  assert.ok(svgWine.includes('Vinos y champán'));

  const svgMargin = buildMenuCartaSvgString({
    rows: parseMenuLines('Malbec  63'),
    title: 'Vinos',
    presetId: 'negro',
    page: 'a4',
    style: { marginRight: 160, marginLeft: 120 },
  });
  assert.ok(svgMargin.includes('x="634"'));
  assert.ok(svgMargin.includes('x="120"'));

  const { CARTA_BACKGROUND_PRESETS } = await import('../client/src/data/cartaBackgroundPresets.js');
  assert.ok(CARTA_BACKGROUND_PRESETS.length >= 11);
  assert.ok(CARTA_BACKGROUND_PRESETS.every((row) => row.src && row.colors?.text && row.colors?.title && row.colors?.section));

  const { cartaHasDisplayableContent, isGeneratedCarta } = await import('../client/src/utils/autoPedidoCartaShape.js');
  assert.ok(isGeneratedCarta({ source: 'generated', generated: { title: 'Entradas', text: 'Lomo 35' } }));
  assert.ok(cartaHasDisplayableContent({ source: 'generated', generated: { title: 'Entradas', text: 'Lomo 35' }, url: '' }));
  assert.ok(!cartaHasDisplayableContent({ name: 'Carta 1', url: '' }));

  console.log('verify-carta-generator: ok');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
