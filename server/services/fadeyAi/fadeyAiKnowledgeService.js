const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, runSql } = require('../../database');
const { nowLimaSql, formatLimaSqlDateTime } = require('../../utils/appDateTime');
const { ensureFadeyAiSchema } = require('./ensureFadeyAiSchema');
const { OPERATION_GUIDES } = require('./fadeyAiGuides');

const LEARNING_DAYS = 7;

function businessNow() {
  try {
    return nowLimaSql(queryOne);
  } catch (_) {
    return formatLimaSqlDateTime(new Date());
  }
}

function getState() {
  ensureFadeyAiSchema();
  return queryOne('SELECT * FROM fadey_ai_state WHERE id = 1') || {};
}

function upsertMemory({ id, kind, title, body, meta = null }) {
  ensureFadeyAiSchema();
  const now = businessNow();
  const mid = String(id || uuidv4());
  const existing = queryOne('SELECT id FROM fadey_ai_memory WHERE id = ?', [mid]);
  const metaJson = meta ? JSON.stringify(meta) : null;
  if (existing) {
    runSql(
      `UPDATE fadey_ai_memory SET kind = ?, title = ?, body = ?, meta_json = ?, updated_at = ? WHERE id = ?`,
      [kind, title || '', body || '', metaJson, now, mid]
    );
  } else {
    runSql(
      `INSERT INTO fadey_ai_memory (id, kind, title, body, meta_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [mid, kind, title || '', body || '', metaJson, now, now]
    );
  }
  return mid;
}

const STOPWORDS = new Set([
  'a', 'al', 'un', 'una', 'uno', 'el', 'la', 'los', 'las', 'de', 'del', 'en', 'y', 'o', 'u',
  'que', 'como', 'cómo', 'para', 'por', 'con', 'se', 'su', 'sus', 'mi', 'me', 'te', 'le',
  'es', 'son', 'hay', 'hacer', 'hago', 'hice', 'puedo', 'puede', 'quiero', 'necesito',
  'the', 'to', 'of', 'and', 'or', 'in', 'on', 'is', 'are', 'do', 'does', 'how',
]);

function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeQuery(q) {
  return normalizeText(q)
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/** Frases clave de la pregunta (mejor que tokens sueltos). */
function extractPhrases(q) {
  const n = normalizeText(q);
  const phrases = [];
  const patterns = [
    /crear?\s+un?\s+area(?:\s+de\s+produccion)?/,
    /creo\s+un?\s+area(?:\s+de\s+produccion)?/,
    /nueva\s+area(?:\s+de\s+produccion)?/,
    /area\s+de\s+produccion/,
    /vincular\s+(?:un?\s+)?area/,
    /asignar\s+(?:un?\s+)?area/,
    /crear?\s+un?\s+usuario/,
    /creo\s+un?\s+usuario/,
    /nuevo\s+usuario/,
    /cerrar\s+caja/,
    /abrir\s+caja/,
    /mover\s+(?:un?\s+)?pedido/,
    /traslad(?:ar|o)\s/,
    /requerimiento/,
    /recepcion/,
    /auto\s*pedido/,
    /impresora/,
    /salon(?:es)?/,
    /asistencia/,
  ];
  for (const re of patterns) {
    const m = n.match(re);
    if (m) phrases.push(m[0].trim());
  }
  return phrases;
}

function searchMemory(query, { kinds = null, limit = 8 } = {}) {
  ensureFadeyAiSchema();
  const q = normalizeText(query);
  let rows = queryAll(
    `SELECT id, kind, title, body, meta_json, updated_at
     FROM fadey_ai_memory
     ORDER BY datetime(updated_at) DESC
     LIMIT 300`
  ) || [];
  if (Array.isArray(kinds) && kinds.length) {
    const set = new Set(kinds.map(String));
    rows = rows.filter((r) => set.has(String(r.kind)));
  }
  if (!q) return rows.slice(0, limit);

  const tokens = tokenizeQuery(q);
  const phrases = extractPhrases(q);
  const wantsCreateArea = /crear?\s+un?\s+area|creo\s+un?\s+area|nueva\s+area/.test(q);
  const wantsCreateUser = /crear?\s+un?\s+usuario|creo\s+un?\s+usuario|nuevo\s+usuario/.test(q);
  const wantsLinkArea = /vincular|asignar/.test(q) && /area|produccion/.test(q);

  const scored = rows.map((r) => {
    let metaKw = [];
    try {
      const meta = r.meta_json ? JSON.parse(r.meta_json) : null;
      if (Array.isArray(meta?.keywords)) metaKw = meta.keywords.map(normalizeText);
    } catch (_) {
      /* noop */
    }
    const titleN = normalizeText(r.title);
    const bodyN = normalizeText(String(r.body || '').slice(0, 800));
    const kwN = metaKw.join(' ');
    const hayTitleKw = `${titleN} ${kwN}`;
    const hayAll = `${hayTitleKw} ${bodyN}`;

    let score = 0;

    // Frases completas pesan mucho (título/keywords)
    for (const ph of phrases) {
      if (hayTitleKw.includes(ph)) score += 40;
      else if (hayAll.includes(ph)) score += 12;
    }

    // Tokens significativos
    for (const t of tokens) {
      if (titleN.includes(t)) score += 14;
      else if (kwN.includes(t)) score += 10;
      else if (bodyN.includes(t)) score += 2;
    }

    // Intenciones específicas
    const id = String(r.id || '');
    if (wantsCreateArea) {
      if (id === 'guide-crear-area-produccion') score += 80;
      if (id === 'guide-crear-usuario') score -= 50;
      if (id === 'guide-area-produccion' && !wantsLinkArea) score -= 15;
    }
    if (wantsCreateUser) {
      if (id === 'guide-crear-usuario') score += 80;
      if (id === 'guide-crear-area-produccion') score -= 40;
    }
    if (wantsLinkArea && id === 'guide-area-produccion') score += 50;

    return { ...r, score };
  }).filter((r) => r.score > 0);

  scored.sort((a, b) => b.score - a.score || String(b.updated_at).localeCompare(String(a.updated_at)));
  return scored.slice(0, limit);
}

function bootstrapGuides() {
  for (const g of OPERATION_GUIDES) {
    const kw = Array.isArray(g.keywords) ? g.keywords.join(' ') : '';
    upsertMemory({
      id: g.id,
      kind: 'guide',
      title: g.title,
      body: `${g.body}\n\n(Palabras clave: ${kw})`,
      meta: { source: 'static', keywords: g.keywords || [] },
    });
  }
}

function bootstrapRestaurantProfile() {
  const restaurant = queryOne('SELECT id, name, currency, currency_symbol FROM restaurants LIMIT 1');
  if (restaurant) {
    upsertMemory({
      id: 'cfg-restaurant',
      kind: 'config',
      title: 'Restaurante',
      body: `Nombre: ${restaurant.name || 'Local'}. Moneda: ${restaurant.currency_symbol || 'S/'} (${restaurant.currency || 'PEN'}).`,
      meta: { restaurant_id: restaurant.id },
    });
  }
  try {
    const { listActiveProductionAreas } = require('../productionAreasService');
    const areas = listActiveProductionAreas() || [];
    if (areas.length) {
      upsertMemory({
        id: 'cfg-areas',
        kind: 'config',
        title: 'Áreas de producción',
        body: areas.map((a) => `- ${a.name || a.id} (${a.id})`).join('\n'),
        meta: { count: areas.length },
      });
    }
  } catch (_) {
    /* opcional */
  }
  const products = queryAll(
    `SELECT name, price, production_area, category_id
     FROM products
     WHERE IFNULL(is_active, 1) = 1
     ORDER BY name ASC
     LIMIT 120`
  ) || [];
  if (products.length) {
    const lines = products.map((p) => {
      const area = p.production_area ? ` · área ${p.production_area}` : '';
      return `- ${p.name}: S/ ${Number(p.price || 0).toFixed(2)}${area}`;
    });
    upsertMemory({
      id: 'cfg-products',
      kind: 'catalog',
      title: 'Carta activa (muestra)',
      body: `Productos activos (${products.length} listados):\n${lines.join('\n')}`,
      meta: { count: products.length },
    });
  }
}

function addDaysSql(sqlDatetime, days) {
  const d = new Date(String(sqlDatetime || '').replace(' ', 'T') + (String(sqlDatetime).includes('Z') ? '' : '-05:00'));
  if (Number.isNaN(d.getTime())) {
    const base = new Date();
    base.setDate(base.getDate() + days);
    return formatLimaSqlDateTime(base);
  }
  d.setDate(d.getDate() + days);
  return formatLimaSqlDateTime(d);
}

/**
 * Primera activación: guías + config + ventana de aprendizaje 7 días.
 * Re-ejecutable: refresca conocimiento sin resetear learning_until si ya existía.
 */
function bootstrapKnowledge({ forceLearningReset = false } = {}) {
  ensureFadeyAiSchema();
  bootstrapGuides();
  bootstrapRestaurantProfile();
  const now = businessNow();
  const state = getState();
  let learningUntil = state.learning_until;
  let bootstrappedAt = state.bootstrapped_at;
  if (!bootstrappedAt || forceLearningReset) {
    bootstrappedAt = now;
    learningUntil = addDaysSql(now, LEARNING_DAYS);
  } else if (!learningUntil) {
    learningUntil = addDaysSql(bootstrappedAt || now, LEARNING_DAYS);
  }
  runSql(
    `UPDATE fadey_ai_state
     SET bootstrapped_at = ?, learning_until = ?, updated_at = ?
     WHERE id = 1`,
    [bootstrappedAt, learningUntil, now]
  );
  return getState();
}

function isLearningPeriod() {
  const state = getState();
  if (!state.learning_until) return true;
  const now = businessNow();
  return String(now) < String(state.learning_until);
}

function saveDailySnapshot(summaryText, meta = {}) {
  const day = String(businessNow()).slice(0, 10);
  upsertMemory({
    id: `snap-${day}`,
    kind: 'snapshot',
    title: `Snapshot operativo ${day}`,
    body: summaryText,
    meta: { ...meta, day },
  });
  runSql(
    `UPDATE fadey_ai_state SET last_snapshot_at = ?, updated_at = ? WHERE id = 1`,
    [businessNow(), businessNow()]
  );
}

module.exports = {
  LEARNING_DAYS,
  ensureFadeyAiSchema,
  getState,
  upsertMemory,
  searchMemory,
  bootstrapKnowledge,
  bootstrapRestaurantProfile,
  isLearningPeriod,
  saveDailySnapshot,
  businessNow,
};
