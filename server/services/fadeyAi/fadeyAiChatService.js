const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, runSql } = require('../../database');
const { getControlConfig } = require('../../masterAdminService');
const { ensureFadeyAiSchema } = require('./ensureFadeyAiSchema');
const {
  bootstrapKnowledge,
  getState,
  isLearningPeriod,
  searchMemory,
  businessNow,
} = require('./fadeyAiKnowledgeService');
const { toolsForUser, runTool } = require('./fadeyAiTools');

const RATE = new Map();
const MAX_PER_MIN = 20;

function hasLlmKey() {
  return Boolean(String(process.env.OPENAI_API_KEY || '').trim());
}

function isFeatureEnabled() {
  try {
    return Number(getControlConfig().fadey_ai_enabled) === 1;
  } catch (_) {
    return false;
  }
}

function getStatus() {
  ensureFadeyAiSchema();
  const enabled = isFeatureEnabled();
  const state = getState();
  const learning = enabled ? isLearningPeriod() : false;
  return {
    enabled,
    has_llm_key: hasLlmKey(),
    learning,
    bootstrapped_at: state.bootstrapped_at || null,
    learning_until: state.learning_until || null,
    last_monitor_at: state.last_monitor_at || null,
    mode: !enabled ? 'off' : (hasLlmKey() ? 'full' : 'guides_only'),
  };
}

function checkRateLimit(userId) {
  const key = String(userId || '');
  const now = Date.now();
  let bucket = RATE.get(key);
  if (!bucket || now - bucket.start > 60_000) {
    bucket = { start: now, count: 0 };
    RATE.set(key, bucket);
  }
  bucket.count += 1;
  return bucket.count <= MAX_PER_MIN;
}

function saveMessage(userId, role, content, sources = null) {
  ensureFadeyAiSchema();
  const id = uuidv4();
  runSql(
    `INSERT INTO fadey_ai_chat_messages (id, user_id, role, content, sources_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, userId, role, content, sources ? JSON.stringify(sources) : null, businessNow()]
  );
  return id;
}

function getHistory(userId, limit = 40) {
  ensureFadeyAiSchema();
  const rows = queryAll(
    `SELECT id, role, content, sources_json, created_at
     FROM fadey_ai_chat_messages
     WHERE user_id = ?
     ORDER BY datetime(created_at) DESC
     LIMIT ?`,
    [userId, Math.min(100, Math.max(1, Number(limit) || 40))]
  ) || [];
  return rows.reverse().map((r) => ({
    id: r.id,
    role: r.role,
    content: r.content,
    sources: (() => {
      try {
        return r.sources_json ? JSON.parse(r.sources_json) : null;
      } catch {
        return null;
      }
    })(),
    created_at: r.created_at,
  }));
}

function buildSystemPrompt(user, status) {
  const role = String(user?.role || 'staff');
  const name = String(user?.full_name || user?.username || 'usuario').trim();
  const learningNote = status.learning
    ? 'Estás en periodo de aprendizaje (primera semana): prioriza guías y datos recientes; indica que sigues aprendiendo el ritmo del local.'
    : 'Ya pasaste el periodo inicial de aprendizaje: usa snapshots y herramientas con confianza.';
  return `Eres IA Fadey, el asistente propio de ESTE restaurante (esta instalación del POS).
Hablas en español claro. Te diriges a ${name} (rol: ${role}).
${learningNote}
Cuando pregunten CÓMO hacer algo (cerrar caja, requerimiento, recepción, auto pedido QR, cartas vs productos, crear usuario, área de producción, impresora, salones, etc.):
1. Usa SIEMPRE la herramienta search_guides.
2. Responde con el paso a paso completo de la guía (números 1, 2, 3…).
3. Indica la ruta de menú exacta (ej. Caja → Apertura y cierre).
Reglas:
- No inventes cifras ni stock: usa herramientas. Si una tool falla o no hay permiso, dilo.
- No ejecutes cobros, anulaciones ni cambios de precio; solo orientas.
- Responde con datos concretos del local cuando uses tools de ventas/stock.`;
}

async function callOpenAi({ messages, tools }) {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) return null;
  const model = String(process.env.OPENAI_MODEL || 'gpt-4o-mini').trim() || 'gpt-4o-mini';
  const body = {
    model,
    messages,
    temperature: 0.3,
  };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`LLM error ${response.status}: ${errText.slice(0, 200)}`);
  }
  const data = await response.json();
  return data?.choices?.[0]?.message || null;
}

function guidesOnlyReply(message, user) {
  const hits = searchMemory(message, { kinds: ['guide', 'config', 'catalog', 'snapshot'], limit: 3 });
  if (!hits.length) {
    return {
      reply: 'No encontré una guía exacta. Prueba preguntar por ejemplo:\n• Cómo cerrar caja\n• Cómo generar un requerimiento\n• Cómo cargar una carta al auto pedido\n• Cómo crear un usuario\n• Cómo configurar impresora\n• Cómo configurar salones\n\nEl administrador maestro puede activar la clave LLM (OPENAI_API_KEY) para respuestas más flexibles.',
      sources: [],
    };
  }
  const best = hits[0];
  const body = String(best.body || '').replace(/\n*\(Palabras clave:[\s\S]*$/, '').trim();
  let reply = `**${best.title}**\n\n${body}`;
  if (hits.length > 1) {
    reply += `\n\n---\nTambién relacionado: ${hits.slice(1).map((h) => h.title).join(' · ')}`;
  }
  return {
    reply,
    sources: hits.map((h) => ({ kind: h.kind, title: h.title })),
  };
}

function heuristicToolPrefetch(message, user) {
  const m = String(message || '').toLowerCase();
  const sources = [];
  const chunks = [];
  const isHowTo = /c[oó]mo |como |paso a paso|dónde |donde |explicame|explícame|ayuda/.test(m)
    || /cerrar caja|abrir caja|requerimiento|recepci[oó]n|auto.?pedido|carta|usuario|impresora|sal[oó]n|liberar mesa|asistencia|cobrar|área|area de producci/.test(m);

  // Preguntas de procedimiento: priorizar guías completas
  if (isHowTo) {
    const r = runTool('search_guides', { query: message }, user);
    if (r.ok && r.hits?.length) {
      const best = r.hits[0];
      chunks.push(`**${best.title}**\n${best.body}`);
      if (r.hits[1]) chunks.push(`Relacionado: ${r.hits[1].title}`);
      sources.push({ kind: 'tool', title: 'search_guides' });
      return { chunks, sources };
    }
  }

  if (/venta|vend[ií]|facturaci[oó]n|recaud|resumen/.test(m) && !isHowTo) {
    const r = runTool('sales_summary', { scope: /hoy/.test(m) ? 'today' : 'month' }, user);
    if (r.ok) {
      chunks.push(`Ventas: S/ ${Number(r.sales || 0).toFixed(2)} · ${r.orders} cuenta(s) (${r.from} → ${r.to}).`);
      sources.push({ kind: 'tool', title: 'sales_summary' });
    }
  }
  if (/plato|producto.*m[aá]s|m[aá]s vend|top/.test(m) && !/c[oó]mo/.test(m)) {
    const dateMatch = m.match(/(\d{4}-\d{2}-\d{2})/);
    const r = runTool('top_products', dateMatch ? { date: dateMatch[1] } : { scope: /mes/.test(m) ? 'month' : 'day' }, user);
    if (r.ok && r.items?.length) {
      const top = r.items[0];
      chunks.push(`Más vendido (${r.date}): ${top.name} (${top.qty} uds${top.revenue != null ? `, S/ ${Number(top.revenue).toFixed(2)}` : ''}).`);
      sources.push({ kind: 'tool', title: 'top_products' });
    }
  }
  if (/stock|agotad|inventario/.test(m) && !isHowTo) {
    const r = runTool('low_stock', {}, user);
    if (r.ok) {
      chunks.push(r.count ? `Stock bajo (${r.count}): ${r.items.slice(0, 5).map((i) => i.name).join(', ')}` : 'No hay productos en umbral de stock bajo.');
      sources.push({ kind: 'tool', title: 'low_stock' });
    }
  }
  return { chunks, sources };
}

async function chat(user, message) {
  if (!isFeatureEnabled()) {
    const err = new Error('El asistente IA Fadey está desactivado en este plan.');
    err.status = 403;
    throw err;
  }
  const text = String(message || '').trim();
  if (!text) {
    const err = new Error('Escribe una pregunta.');
    err.status = 400;
    throw err;
  }
  if (!checkRateLimit(user.id)) {
    const err = new Error('Demasiados mensajes. Espera un minuto.');
    err.status = 429;
    throw err;
  }

  ensureFadeyAiSchema();
  const st = getStatus();
  if (!st.bootstrapped_at) {
    bootstrapKnowledge();
  } else {
    try {
      bootstrapKnowledge({ forceLearningReset: false });
    } catch (_) {
      /* refresh soft */
    }
  }

  saveMessage(user.id, 'user', text);

  if (!hasLlmKey()) {
    const prefetch = heuristicToolPrefetch(text, user);
    let result;
    if (prefetch.chunks.length) {
      result = { reply: prefetch.chunks.join('\n\n'), sources: prefetch.sources };
    } else {
      result = guidesOnlyReply(text, user);
    }
    saveMessage(user.id, 'assistant', result.reply, result.sources);
    return { ...result, mode: 'guides_only', status: getStatus() };
  }

  const tools = toolsForUser(user);
  const history = getHistory(user.id, 12).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
  }));
  const messages = [
    { role: 'system', content: buildSystemPrompt(user, st) },
    ...history.slice(0, -1),
    { role: 'user', content: text },
  ];

  let assistantMsg = await callOpenAi({ messages, tools });
  const sources = [];
  let guard = 0;
  while (assistantMsg?.tool_calls?.length && guard < 4) {
    guard += 1;
    messages.push({
      role: 'assistant',
      content: assistantMsg.content || null,
      tool_calls: assistantMsg.tool_calls,
    });
    for (const call of assistantMsg.tool_calls) {
      const name = call.function?.name;
      let args = {};
      try {
        args = JSON.parse(call.function?.arguments || '{}');
      } catch {
        args = {};
      }
      const result = runTool(name, args, user);
      sources.push({ kind: 'tool', title: name });
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
    assistantMsg = await callOpenAi({ messages, tools });
  }

  const reply = String(assistantMsg?.content || '').trim()
    || 'No pude generar una respuesta. Intenta de nuevo.';
  saveMessage(user.id, 'assistant', reply, sources);
  return { reply, sources, mode: 'full', status: getStatus() };
}

module.exports = {
  getStatus,
  isFeatureEnabled,
  hasLlmKey,
  chat,
  getHistory,
  bootstrapKnowledge,
};
