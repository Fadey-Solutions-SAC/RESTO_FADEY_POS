/**
 * Memoria persistente de PIX por usuario: datos importantes que sobreviven al reinicio diario del chat.
 * - profile: nombre preferido, estilo de respuesta, idioma, nombre del negocio.
 * - goal: metas de venta (diaria / mensual).
 * - fact: notas que el usuario pidió recordar («recuerda que…»).
 * - topic: temas que más consulta (se aprende solo, para personalizar saludos y sugerencias).
 */
const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, runSql } = require('../../database');
const { ensureFadeyAiSchema } = require('./ensureFadeyAiSchema');
const { businessNow } = require('./fadeyAiKnowledgeService');

const MAX_FACTS = 40;

const TOPIC_LABELS = {
  sales_summary: 'ventas',
  sales_desk: 'cobros y pagos',
  top_products: 'productos más vendidos',
  low_stock: 'stock',
  hr_insights: 'equipo y demoras',
  active_staff: 'personal en jornada',
  business_insights: 'análisis del negocio',
  business_advice: 'consejos de negocio',
  business_concept: 'conceptos de negocio',
  customer_insights: 'clientes',
  cost_insights: 'costos y márgenes',
  report: 'informes',
  purchase_plan: 'compras',
  search_guides: 'guías del sistema',
  kitchen_open_orders: 'pedidos de cocina',
};

const STOP_WORDS = new Set([
  'que', 'los', 'las', 'del', 'para', 'por', 'con', 'una', 'uno', 'unos', 'unas', 'como', 'pero', 'esto', 'esta',
  'este', 'eso', 'esa', 'ese', 'muy', 'mas', 'son', 'hay', 'cuando', 'donde', 'siempre', 'todos', 'todas', 'tiene',
  'tienen', 'nuestro', 'nuestra', 'nosotros', 'mis', 'tus', 'sus', 'recuerda', 'acuerdate', 'olvides',
]);

function norm(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(text) {
  return norm(text)
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
}

function cleanValue(text) {
  return String(text || '').trim().replace(/^[:,\s]+/, '').replace(/[.!\s]+$/, '').trim();
}

function capitalize(text) {
  const s = cleanValue(text);
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function remember(userId, kind, mkey, value) {
  ensureFadeyAiSchema();
  const uid = String(userId || '');
  if (!uid || !mkey) return;
  const now = businessNow();
  const row = queryOne(
    'SELECT id FROM fadey_ai_user_memory WHERE user_id = ? AND kind = ? AND mkey = ?',
    [uid, kind, mkey]
  );
  if (row) {
    runSql(
      'UPDATE fadey_ai_user_memory SET value = ?, hits = hits + 1, updated_at = ? WHERE id = ?',
      [String(value), now, row.id]
    );
  } else {
    runSql(
      `INSERT INTO fadey_ai_user_memory (id, user_id, kind, mkey, value, hits, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      [uuidv4(), uid, kind, mkey, String(value), now, now]
    );
  }
}

function forget(userId, kind, mkey = null) {
  ensureFadeyAiSchema();
  if (mkey) {
    runSql('DELETE FROM fadey_ai_user_memory WHERE user_id = ? AND kind = ? AND mkey = ?', [String(userId), kind, mkey]);
  } else {
    runSql('DELETE FROM fadey_ai_user_memory WHERE user_id = ? AND kind = ?', [String(userId), kind]);
  }
}

function rows(userId) {
  ensureFadeyAiSchema();
  return queryAll(
    'SELECT id, kind, mkey, value, hits, created_at, updated_at FROM fadey_ai_user_memory WHERE user_id = ? ORDER BY updated_at DESC',
    [String(userId || '')]
  ) || [];
}

/** Perfil compacto que usa el chat para personalizar respuestas. */
function recall(userId) {
  const out = { profile: {}, goals: {}, facts: [], topics: [] };
  try {
    for (const r of rows(userId)) {
      if (r.kind === 'profile') out.profile[r.mkey] = r.value;
      else if (r.kind === 'goal') out.goals[r.mkey] = Number(r.value) || 0;
      else if (r.kind === 'fact') out.facts.push({ id: r.id, value: r.value });
      else if (r.kind === 'topic') out.topics.push({ key: r.mkey, hits: Number(r.hits) || 0 });
    }
    out.topics.sort((a, b) => b.hits - a.hits);
  } catch (_) {
    /* memoria opcional */
  }
  return out;
}

function listMemory(userId) {
  return rows(userId).map((r) => ({
    id: r.id,
    kind: r.kind,
    key: r.mkey,
    value: r.kind === 'topic' ? `${TOPIC_LABELS[r.mkey] || r.mkey} (${r.hits} consultas)` : r.value,
    updated_at: r.updated_at,
  }));
}

function forgetMemoryItem(userId, id) {
  ensureFadeyAiSchema();
  runSql('DELETE FROM fadey_ai_user_memory WHERE user_id = ? AND id = ?', [String(userId), String(id)]);
}

function clearUserMemory(userId) {
  ensureFadeyAiSchema();
  runSql('DELETE FROM fadey_ai_user_memory WHERE user_id = ?', [String(userId)]);
}

function trackTopic(userId, title) {
  const key = String(title || '').trim();
  if (!key || !TOPIC_LABELS[key]) return;
  try {
    remember(userId, 'topic', key, key);
  } catch (_) {
    /* opcional */
  }
}

/** «ventas y stock» con los temas más consultados (mínimo 3 consultas). */
function topicSummary(userId, max = 2) {
  const top = recall(userId).topics.filter((t) => t.hits >= 3).slice(0, max);
  const labels = top.map((t) => TOPIC_LABELS[t.key]).filter(Boolean);
  if (!labels.length) return '';
  return labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} y ${labels[labels.length - 1]}`;
}

function parseAmount(raw) {
  let s = String(raw || '').toLowerCase().replace(/s\/\.?|soles?|\s/g, '');
  const mil = /mil$/.test(s);
  s = s.replace(/mil$/, '');
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(',', '.');
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return mil ? n * 1000 : n;
}

function money(n) {
  return `S/ ${Number(n || 0).toFixed(2)}`;
}

function factKey(text) {
  return tokens(text).slice(0, 8).join(' ') || norm(text).slice(0, 60);
}

function listReply(userId) {
  const mem = recall(userId);
  const lines = [];
  if (mem.profile.name) lines.push(`- Te llamo: ${mem.profile.name}`);
  if (mem.profile.business_name) lines.push(`- Tu negocio: ${mem.profile.business_name}`);
  if (mem.profile.style) lines.push(`- Prefieres respuestas ${mem.profile.style === 'short' ? 'cortas' : 'detalladas'}`);
  if (mem.profile.lang) lines.push(`- Idioma preferido: ${mem.profile.lang === 'en' ? 'inglés' : 'español'}`);
  if (mem.goals.daily) lines.push(`- Meta de ventas diaria: ${money(mem.goals.daily)}`);
  if (mem.goals.monthly) lines.push(`- Meta de ventas mensual: ${money(mem.goals.monthly)}`);
  for (const f of mem.facts.slice(0, 15)) lines.push(`- ${f.value}`);
  const topics = topicSummary(userId, 3);
  if (topics) lines.push(`- Lo que más me consultas: ${topics}`);
  if (!lines.length) {
    return 'Aún no tengo nada guardado sobre ti. Puedes decirme, por ejemplo: «recuerda que los lunes cerramos», «llámame Carlos», «mi meta diaria es S/ 1500» o «prefiero respuestas cortas».';
  }
  return ['Esto es lo que recuerdo de ti:', ...lines, '', 'Para borrar algo escribe «olvida …» (por ejemplo «olvida mi meta») o «olvida todo».'].join('\n');
}

/** Datos estructurados dentro de una frase; devuelve confirmación o null. */
function parseStructured(userId, body, isQuestion) {
  const n = norm(body);

  const nameMatch = String(body).match(/(?:^|\s)(?:ll[aá]mame|me llamo|mi nombre es|puedes llamarme|prefiero que me llames)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-zÁÉÍÓÚÑáéíóúñ.]*(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-zÁÉÍÓÚÑáéíóúñ.]*){0,2})\s*[.!]?$/i);
  if (nameMatch && !isQuestion) {
    const name = capitalize(nameMatch[1]);
    remember(userId, 'profile', 'name', name);
    return `Entendido, te llamaré ${name}.`;
  }

  const bizMatch = String(body).match(/(?:mi|nuestro)\s+(?:restaurante|negocio|local|restaurant)\s+se\s+llama\s+(.{2,60})$/i);
  if (bizMatch && !isQuestion) {
    const biz = capitalize(bizMatch[1]);
    remember(userId, 'profile', 'business_name', biz);
    return `Anotado: tu negocio se llama ${biz}.`;
  }

  if (isQuestion) return null;

  if (/(respuestas?|responde(me)?|contesta(me)?|habla(me)?|s[eé]|se)\s+(m[aá]s\s+)?(cortas?|breves?|corto|breve|concis[oa]s?|direct[oa]s?|resumid[oa]s?)/.test(n)
    || /prefiero respuestas (cortas|breves|resumidas)/.test(n)) {
    remember(userId, 'profile', 'style', 'short');
    return 'De acuerdo, a partir de ahora te responderé de forma corta y directa. Si en algún momento quieres todo, escribe «más detalle».';
  }
  if (/(respuestas?|responde(me)?|contesta(me)?|expl[ií]ca(me)?)\s+(m[aá]s\s+)?(largas?|detallad[oa]s?|complet[oa]s?|con (m[aá]s )?detalle)/.test(n)
    || /prefiero respuestas (largas|detalladas|completas)/.test(n)) {
    remember(userId, 'profile', 'style', 'detailed');
    return 'Perfecto, te daré respuestas completas y con detalle.';
  }

  const langMatch = n.match(/(?:habla(?:me)?|responde(?:me)?|contesta(?:me)?|escribe(?:me)?)\s+(?:siempre\s+)?en\s+(ingles|espanol|castellano)/)
    || n.match(/(?:always\s+)?(?:answer|reply|speak|talk)(?:\s+to\s+me)?\s+(?:always\s+)?in\s+(english|spanish)/);
  if (langMatch && !isQuestion) {
    const lang = /ingles|english/.test(langMatch[1]) ? 'en' : 'es';
    remember(userId, 'profile', 'lang', lang);
    return lang === 'en' ? 'Got it, I will answer you in English from now on.' : 'Listo, te responderé siempre en español.';
  }

  const goalMatch = n.match(/(?:mi|nuestra|la)\s+meta(?:\s+de\s+ventas?)?(?:\s+(diaria|del dia|por dia|al dia|mensual|del mes|por mes|al mes))?(?:\s+de\s+ventas?)?\s+(?:es|son|sera|seria|de|:)\s+(?:de\s+)?((?:s\/\.?\s*)?\d[\d.,]*\s*(?:mil)?)/)
    || n.match(/(?:quiero|queremos)\s+vender\s+((?:s\/\.?\s*)?\d[\d.,]*\s*(?:mil)?)\s*(?:soles\s*)?(?:al|por|cada|en el)\s+(dia|mes)/);
  if (goalMatch && !isQuestion) {
    const isWant = /vender/.test(goalMatch[0]);
    const periodRaw = isWant ? goalMatch[2] : goalMatch[1] || '';
    const amount = parseAmount(isWant ? goalMatch[1] : goalMatch[2]);
    if (amount > 0) {
      const monthly = /mes|mensual/.test(periodRaw);
      remember(userId, 'goal', monthly ? 'monthly' : 'daily', amount);
      return `Anotado: tu meta de ventas ${monthly ? 'mensual' : 'diaria'} es ${money(amount)}. Cuando me pidas las ventas te diré cuánto llevas.`;
    }
  }

  return null;
}

/**
 * Comandos de memoria («recuerda…», «olvida…», «¿qué recuerdas de mí?», «llámame…», metas, estilo).
 * @returns {{ reply: string, sources: object[] } | null}
 */
function handleMemoryCommand(user, text) {
  const userId = String(user?.id || '');
  const raw = String(text || '').trim();
  if (!userId || !raw) return null;
  const n = norm(raw);
  const isQuestion = /\?\s*$/.test(raw) || /^¿/.test(raw);
  const out = (reply) => ({ reply, sources: [{ kind: 'tool', title: 'user_memory' }] });

  if (/(que|cuanto)\s+(recuerdas|sabes|tienes guardado|has aprendido|tienes anotado)\s+(de|sobre)\s+mi|^(tu|mi) memoria\b|que recuerdas\b|what do you (remember|know) about me/.test(n)) {
    return out(listReply(userId));
  }

  if (/^(?:pix[,\s]+)?(?:olvida|borra|elimina)(?:te)?\s+(?:todo(?:\s+lo\s+que\s+(?:sabes|recuerdas)(?:\s+de\s+mi)?)?|tu memoria|lo que sabes de mi)\s*[.!]?$/.test(n)) {
    clearUserMemory(userId);
    return out('Listo, borré todo lo que recordaba de ti. Empezamos de cero.');
  }

  const forgetMatch = n.match(/^(?:pix[,\s]+)?(?:olvida(?:te)?(?:\s+de)?|borra(?:\s+de\s+tu\s+memoria)?|ya no recuerdes)\s+(?:que\s+)?(.{3,})$/);
  if (forgetMatch) {
    const what = forgetMatch[1];
    if (/\bnombre\b/.test(what)) {
      forget(userId, 'profile', 'name');
      return out('Hecho, olvidé cómo llamarte.');
    }
    if (/\bmeta/.test(what)) {
      if (/mensual|mes/.test(what)) forget(userId, 'goal', 'monthly');
      else if (/diaria|dia/.test(what)) forget(userId, 'goal', 'daily');
      else forget(userId, 'goal');
      return out('Hecho, olvidé tu meta de ventas.');
    }
    if (/estilo|respuestas? (cortas|largas|detalladas)/.test(what)) {
      forget(userId, 'profile', 'style');
      return out('Hecho, vuelvo a responder con mi estilo normal.');
    }
    if (/idioma/.test(what)) {
      forget(userId, 'profile', 'lang');
      return out('Hecho, responderé en el idioma en que me escribas.');
    }
    const want = new Set(tokens(what));
    const facts = recall(userId).facts;
    let best = null;
    let bestScore = 0;
    for (const f of facts) {
      const score = tokens(f.value).filter((t) => want.has(t)).length;
      if (score > bestScore) {
        best = f;
        bestScore = score;
      }
    }
    if (best && bestScore >= 1) {
      forgetMemoryItem(userId, best.id);
      return out(`Hecho, olvidé: «${best.value}».`);
    }
    return out('No encontré eso en lo que recuerdo de ti. Escribe «¿qué recuerdas de mí?» para ver la lista.');
  }

  if (/cu[aá]l es mi meta|cual es mi meta|mi meta de ventas\??$/.test(n) && isQuestion) {
    const g = recall(userId).goals;
    if (!g.daily && !g.monthly) return out('Aún no me dijiste tu meta. Por ejemplo: «mi meta diaria es S/ 1500» o «mi meta mensual es S/ 40 mil».');
    const parts = [];
    if (g.daily) parts.push(`diaria ${money(g.daily)}`);
    if (g.monthly) parts.push(`mensual ${money(g.monthly)}`);
    return out(`Tu meta de ventas: ${parts.join(' · ')}.`);
  }

  const rememberMatch = raw.match(/^(?:pix[,\s]+)?(?:por favor[,\s]+)?(?:recuerda(?:lo)?|recu[eé]rdame|ac[uú]erdate(?:\s+de)?|no olvides|toma nota(?:\s+de)?|anota|guarda en tu memoria|memoriza)(?:\s+(?:que|de que|esto|lo siguiente))?\s*[:,]?\s+(.{3,})$/i);
  const body = rememberMatch ? rememberMatch[1] : raw;

  const structured = parseStructured(userId, body, isQuestion);
  if (structured) return out(structured);

  if (rememberMatch) {
    const value = capitalize(body);
    const facts = recall(userId).facts;
    if (facts.length >= MAX_FACTS) {
      forgetMemoryItem(userId, facts[facts.length - 1].id);
    }
    remember(userId, 'fact', factKey(value), value);
    return out(`Anotado, lo recordaré: «${value}».`);
  }

  return null;
}

/** Nota guardada relacionada con la consulta (para añadirla a la respuesta). */
function relevantFact(userId, text) {
  const want = new Set(tokens(text));
  if (!want.size) return null;
  let best = null;
  let bestScore = 0;
  for (const f of recall(userId).facts) {
    const ft = tokens(f.value);
    const score = ft.filter((t) => want.has(t)).length;
    const needed = ft.length <= 3 ? 1 : 2;
    if (score >= needed && score > bestScore) {
      best = f;
      bestScore = score;
    }
  }
  return best ? best.value : null;
}

/** Avance contra la meta guardada para un resumen de ventas. */
function goalProgressLine(userId, { from, to, sales, todayKey }) {
  const g = recall(userId).goals;
  const total = Number(sales || 0);
  if (g.daily && from === to && from === todayKey) {
    const pct = Math.round((total / g.daily) * 100);
    const left = g.daily - total;
    return left > 0
      ? `Meta diaria ${money(g.daily)}: llevas ${pct}%, te faltan ${money(left)}.`
      : `Meta diaria ${money(g.daily)}: ¡superada! (${pct}%).`;
  }
  if (g.monthly && from && to && from.slice(0, 7) === to.slice(0, 7) && from.endsWith('-01') && to.slice(0, 7) === String(todayKey || '').slice(0, 7)) {
    const pct = Math.round((total / g.monthly) * 100);
    const left = g.monthly - total;
    return left > 0
      ? `Meta mensual ${money(g.monthly)}: llevas ${pct}%, te faltan ${money(left)}.`
      : `Meta mensual ${money(g.monthly)}: ¡superada! (${pct}%).`;
  }
  return '';
}

module.exports = {
  recall,
  listMemory,
  forgetMemoryItem,
  clearUserMemory,
  trackTopic,
  topicSummary,
  handleMemoryCommand,
  relevantFact,
  goalProgressLine,
};
