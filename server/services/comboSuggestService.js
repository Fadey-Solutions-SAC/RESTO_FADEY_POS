const { queryAll } = require('../database');

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function titleCase(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\b[\wáéíóúñü]/g, (c) => c.toUpperCase());
}

function shortName(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length <= 2) return titleCase(parts.join(' '));
  return titleCase(parts.slice(0, 2).join(' '));
}

function getDiscountRate(count) {
  if (count >= 4) return 0.18;
  if (count === 3) return 0.15;
  if (count === 2) return 0.12;
  if (count === 1) return 0.05;
  return 0;
}

function suggestComboPrice(total, count) {
  const safeTotal = Number(total || 0);
  if (safeTotal <= 0 || count <= 0) return 0;
  const rate = getDiscountRate(count);
  let price = safeTotal * (1 - rate);
  price = Math.floor(price * 2) / 2;
  if (price <= 0) price = roundMoney(safeTotal * 0.9);
  if (price >= safeTotal) price = roundMoney(safeTotal - 0.5);
  return Math.max(0.5, roundMoney(price));
}

function buildHeuristicName(products) {
  const names = products.map((p) => String(p.name || '').trim()).filter(Boolean);
  if (!names.length) return '';
  if (names.length === 1) return `Combo ${titleCase(names[0])}`;
  if (names.length === 2) {
    return `Duo ${shortName(names[0])} + ${shortName(names[1])}`;
  }
  if (names.length === 3) {
    return `Trío ${shortName(names[0])} + ${shortName(names[1])} + ${shortName(names[2])}`;
  }
  return `Combo Familiar ${names.length} Productos`;
}

function buildHeuristicDescription(products, total, suggestedPrice) {
  const list = products.map((p) => String(p.name || '').trim()).filter(Boolean);
  if (!list.length) return '';
  const savings = roundMoney(total - suggestedPrice);
  const joined =
    list.length === 1
      ? list[0]
      : `${list.slice(0, -1).join(', ')} y ${list[list.length - 1]}`;
  return `Incluye ${joined}. Precio por separado S/ ${total.toFixed(2)} — llévalo por S/ ${suggestedPrice.toFixed(2)} y ahorra S/ ${savings.toFixed(2)}.`;
}

function buildHeuristicSuggestions(products) {
  const total = roundMoney(products.reduce((sum, p) => sum + Number(p.price || 0), 0));
  const suggestedPrice = suggestComboPrice(total, products.length);
  const savings = roundMoney(Math.max(0, total - suggestedPrice));
  const discountPct = total > 0 ? Math.round((savings / total) * 100) : 0;

  return {
    source: 'auto',
    total,
    suggested_price: suggestedPrice,
    savings,
    discount_pct: discountPct,
    name: buildHeuristicName(products),
    description: buildHeuristicDescription(products, total, suggestedPrice),
  };
}

function parseJsonFromText(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

async function fetchOpenAiSuggestions(products, heuristic) {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey || products.length === 0) return null;

  const productLines = products
    .map((p) => `- ${p.name}: S/ ${Number(p.price || 0).toFixed(2)}`)
    .join('\n');

  const prompt = [
    'Eres un experto en cartas de restaurantes peruanos.',
    'Genera un nombre atractivo, una descripción corta de venta (máx. 2 oraciones) y un precio sugerido para un combo.',
    'Debes considerar TODOS los productos listados, no solo uno.',
    'El precio debe ser menor al total individual pero rentable para el negocio.',
    '',
    `Productos seleccionados:\n${productLines}`,
    `Total individual: S/ ${heuristic.total.toFixed(2)}`,
    `Referencia automática: nombre "${heuristic.name}", precio S/ ${heuristic.suggested_price.toFixed(2)}`,
    '',
    'Responde SOLO un JSON válido con esta forma:',
    '{"name":"...","description":"...","suggested_price":0.00}',
  ].join('\n');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: String(process.env.OPENAI_MODEL || 'gpt-4o-mini').trim(),
        temperature: 0.65,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    const parsed = parseJsonFromText(content);
    if (!parsed) return null;

    const suggestedPrice = roundMoney(parsed.suggested_price ?? heuristic.suggested_price);
    const safePrice =
      suggestedPrice > 0 && suggestedPrice < heuristic.total
        ? suggestedPrice
        : heuristic.suggested_price;

    return {
      source: 'ai',
      total: heuristic.total,
      suggested_price: safePrice,
      savings: roundMoney(Math.max(0, heuristic.total - safePrice)),
      discount_pct:
        heuristic.total > 0
          ? Math.round(((heuristic.total - safePrice) / heuristic.total) * 100)
          : 0,
      name: String(parsed.name || heuristic.name).trim() || heuristic.name,
      description: String(parsed.description || heuristic.description).trim() || heuristic.description,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function suggestComboProducts(productIds = []) {
  const ids = [...new Set((Array.isArray(productIds) ? productIds : []).map(String).filter(Boolean))];
  if (!ids.length) {
    return {
      source: 'auto',
      total: 0,
      suggested_price: 0,
      savings: 0,
      discount_pct: 0,
      name: '',
      description: '',
      products: [],
    };
  }

  const placeholders = ids.map(() => '?').join(', ');
  const rows = queryAll(
    `SELECT id, name, description, price, category_id
     FROM products
     WHERE id IN (${placeholders}) AND is_active = 1`,
    ids,
  );

  const rowMap = new Map(rows.map((p) => [String(p.id), p]));
  const products = ids.map((id) => rowMap.get(String(id))).filter(Boolean);

  const heuristic = buildHeuristicSuggestions(products);
  const aiResult = await fetchOpenAiSuggestions(products, heuristic);
  const result = aiResult || heuristic;

  return {
    ...result,
    product_ids: products.map((p) => p.id),
    product_count: products.length,
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      price: roundMoney(p.price),
    })),
  };
}

module.exports = {
  suggestComboProducts,
  buildHeuristicSuggestions,
};
