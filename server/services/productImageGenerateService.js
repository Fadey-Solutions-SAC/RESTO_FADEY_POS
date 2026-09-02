const fs = require('fs');
const path = require('path');
const { queryAll, runSql } = require('../database');
const { ensureUploadsRoot } = require('../uploadsPath');

const GENERIC_NAME_TOKENS = new Set([
  'antojo', 'otra', 'otro', 'otros', 'varios', 'vario', 'combo', 'menu',
  'extra', 'especial', 'promo', 'oferta', 'unidad', 'porcion', 'plato',
  'bebida', 'item', 'producto', 'habitacion', 'misc', 'general',
  'nuevo', 'prueba', 'test', 'temp', 'variedad', 'surtido', 'snack',
]);

const SIZE_ONLY_RE = /^(?:\d+(?:[.,]\d+)?\s*)?(?:ml|l|lt|litro|litros|kg|g|gr|oz|und|u)?$/i;

function normalizeToken(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/** Códigos internos (P01, A-12), no nombres cortos como «café» → cafe. */
function looksLikeSkuCode(norm) {
  if (!norm || norm.length > 10) return false;
  if (/[0-9]/.test(norm)) return true;
  if (/[-_.]/.test(norm)) return true;
  if (norm.length <= 5 && norm === norm.toUpperCase() && /^[A-Z]+$/.test(norm)) return true;
  return false;
}

function assessProductImageName(product) {
  const name = String(product?.name || '').trim();
  const desc = String(product?.description || '').trim();
  const category = String(product?.category_name || '').trim();
  const norm = normalizeToken(name);
  const words = norm.split(/\s+/).filter(Boolean);

  if (!name) {
    return {
      ambiguous: true,
      reason: 'sin_nombre',
      subject: '',
      message: 'El producto no tiene nombre.',
    };
  }

  const isGeneric =
    GENERIC_NAME_TOKENS.has(norm)
    || (words.length === 1 && GENERIC_NAME_TOKENS.has(words[0]));

  if (isGeneric) {
    if (desc.length >= 10) {
      return { ambiguous: false, subject: `${desc} (${category || 'comida'})`, message: '' };
    }
    return {
      ambiguous: true,
      reason: 'nombre_generico',
      subject: '',
      message: `El sistema no asimila el nombre "${name}". Agregue la imagen manualmente o complete la descripción del producto.`,
    };
  }

  if (norm.length < 3 || SIZE_ONLY_RE.test(norm) || looksLikeSkuCode(norm)) {
    if (desc.length >= 10) {
      return { ambiguous: false, subject: `${desc} (${category || 'comida'})`, message: '' };
    }
    return {
      ambiguous: true,
      reason: 'nombre_poco_descriptivo',
      subject: '',
      message: `El sistema no asimila el nombre "${name}". Agregue la imagen manualmente o complete la descripción del producto.`,
    };
  }

  const subjectParts = [name];
  if (category && !norm.includes(normalizeToken(category))) {
    subjectParts.push(`categoría ${category}`);
  }
  return { ambiguous: false, subject: subjectParts.join(', '), message: '' };
}

function isGptImageModel(model) {
  const m = String(model || '').toLowerCase();
  return m.includes('gpt-image');
}

function buildImageGenerationBody(model, prompt) {
  const m = String(model || 'dall-e-2').trim();
  const body = { model: m, prompt, n: 1 };

  if (isGptImageModel(m)) {
    body.size = '1024x1024';
    body.quality = 'medium';
    body.output_format = 'png';
    return body;
  }

  if (m === 'dall-e-3') {
    body.size = '1024x1024';
    body.response_format = 'b64_json';
    return body;
  }

  body.size = '512x512';
  body.response_format = 'b64_json';
  return body;
}

async function downloadImageBuffer(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      const err = new Error('No se pudo descargar la imagen generada.');
      err.status = 502;
      throw err;
    }
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

function parseOpenAiImageError(status, errText) {
  try {
    const parsed = JSON.parse(errText);
    const msg = parsed?.error?.message;
    if (msg) return `No se pudo generar la imagen (${status}): ${msg}`;
  } catch {
    /* ignore */
  }
  return `No se pudo generar la imagen (${status}). ${String(errText || '').slice(0, 200)}`;
}

async function generateImageWithOpenAI(subject) {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    const err = new Error('Configure OPENAI_API_KEY en el servidor para generar imágenes automáticas.');
    err.status = 503;
    throw err;
  }

  const prompt = [
    `Fotografía profesional de comida para menú de restaurante peruano: ${subject}.`,
    'Plato bien presentado, iluminación de estudio, fondo neutro, apetitoso, alta calidad.',
    'Sin texto, sin marcas, sin personas, sin manos.',
  ].join(' ');

  const model = String(process.env.OPENAI_IMAGE_MODEL || 'dall-e-2').trim();
  const requestBody = buildImageGenerationBody(model, prompt);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);

  try {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      const err = new Error(parseOpenAiImageError(response.status, errText));
      err.status = 502;
      throw err;
    }

    const data = await response.json();
    const item = data?.data?.[0];
    const b64 = item?.b64_json;
    if (b64) {
      return Buffer.from(b64, 'base64');
    }
    const url = item?.url;
    if (url) {
      return await downloadImageBuffer(url);
    }

    const err = new Error('La API no devolvió imagen.');
    err.status = 502;
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function saveProductImageBuffer(productId, buffer) {
  const uploadsRoot = ensureUploadsRoot();
  const dir = path.join(uploadsRoot, 'product-images');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const safeId = String(productId || 'x').replace(/[^a-zA-Z0-9_-]/g, '');
  const fileName = `auto-${safeId}-${Date.now()}.png`;
  fs.writeFileSync(path.join(dir, fileName), buffer);
  return `/uploads/product-images/${fileName}`;
}

function shouldSkipProductImage(product, { onlyMissing = true } = {}) {
  if (!product) return { skip: true, reason: 'not_found' };
  if (String(product.image_source || '').toLowerCase() === 'manual') {
    return { skip: true, reason: 'manual_image' };
  }
  const hasImage = Boolean(String(product.image || '').trim());
  if (onlyMissing && hasImage) {
    return { skip: true, reason: 'already_has_image' };
  }
  return { skip: false };
}

async function generateProductMenuImage(product, options = {}) {
  const skipInfo = shouldSkipProductImage(product, options);
  if (skipInfo.skip) {
    return {
      product_id: product.id,
      product_name: product.name,
      status: 'skipped',
      reason: skipInfo.reason,
      message: skipInfo.reason === 'manual_image'
        ? 'Imagen manual: no se reemplaza automáticamente.'
        : skipInfo.reason === 'already_has_image'
          ? 'Ya tiene imagen.'
          : '',
    };
  }

  const assessment = assessProductImageName(product);
  if (assessment.ambiguous) {
    return {
      product_id: product.id,
      product_name: product.name,
      status: 'ambiguous',
      reason: assessment.reason,
      message: assessment.message,
    };
  }

  try {
    const buffer = await generateImageWithOpenAI(assessment.subject);
    const url = saveProductImageBuffer(product.id, buffer);
    runSql(
      `UPDATE products SET image = ?, image_source = 'auto', updated_at = datetime('now') WHERE id = ?`,
      [url, product.id],
    );
    return {
      product_id: product.id,
      product_name: product.name,
      status: 'ok',
      image: url,
      message: 'Imagen generada.',
    };
  } catch (err) {
    return {
      product_id: product.id,
      product_name: product.name,
      status: 'error',
      message: err.message || 'Error al generar imagen.',
    };
  }
}

async function batchGenerateProductMenuImages({ productIds, onlyMissing = true, categoryId } = {}) {
  let query = `SELECT p.*, c.name AS category_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.is_active = 1 AND COALESCE(TRIM(p.category_id), '') <> ''`;
  const params = [];
  if (Array.isArray(productIds) && productIds.length) {
    query += ` AND p.id IN (${productIds.map(() => '?').join(',')})`;
    params.push(...productIds);
  }
  if (categoryId && categoryId !== 'all') {
    query += ' AND p.category_id = ?';
    params.push(categoryId);
  }
  query += ' ORDER BY p.name';

  const products = queryAll(query, params) || [];
  const results = [];
  for (const product of products) {
    const result = await generateProductMenuImage(product, { onlyMissing });
    results.push(result);
    if (result.status === 'ok') {
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  }

  return {
    summary: {
      total: results.length,
      generated: results.filter((r) => r.status === 'ok').length,
      ambiguous: results.filter((r) => r.status === 'ambiguous').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      errors: results.filter((r) => r.status === 'error').length,
    },
    results,
  };
}

module.exports = {
  assessProductImageName,
  generateProductMenuImage,
  batchGenerateProductMenuImages,
};
