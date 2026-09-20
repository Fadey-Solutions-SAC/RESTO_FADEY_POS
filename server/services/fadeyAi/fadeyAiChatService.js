/**
 * Chat IA Fadey — 100 % local a esta instancia (guías + datos del POS).
 * No llama a OpenAI ni a ningún servicio externo de LLM.
 */
const { v4: uuidv4 } = require('uuid');
const { queryAll, runSql } = require('../../database');
const { getControlConfig } = require('../../masterAdminService');
const { ensureFadeyAiSchema } = require('./ensureFadeyAiSchema');
const {
  bootstrapKnowledge,
  getState,
  isLearningPeriod,
  searchMemory,
  businessNow,
} = require('./fadeyAiKnowledgeService');
const { runTool } = require('./fadeyAiTools');

const RATE = new Map();
const MAX_PER_MIN = 20;

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
    learning,
    bootstrapped_at: state.bootstrapped_at || null,
    learning_until: state.learning_until || null,
    last_monitor_at: state.last_monitor_at || null,
    mode: !enabled ? 'off' : 'local',
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
  purgeFadeyAiChatIfNewDay();
  const id = uuidv4();
  runSql(
    `INSERT INTO fadey_ai_chat_messages (id, user_id, role, content, sources_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, userId, role, content, sources ? JSON.stringify(sources) : null, businessNow()]
  );
  return id;
}

/**
 * Borra el historial de chat al pasar la medianoche (día Lima).
 * Seguro llamar muchas veces: solo ejecuta el DELETE al cambiar el día.
 */
function purgeFadeyAiChatIfNewDay() {
  ensureFadeyAiSchema();
  const today = String(businessNow()).slice(0, 10);
  const state = getState();
  const last = state.last_chat_purge_day ? String(state.last_chat_purge_day).slice(0, 10) : null;
  if (last === today) return { purged: false, day: today };

  runSql(`DELETE FROM fadey_ai_chat_messages WHERE substr(created_at, 1, 10) < ?`, [today]);
  runSql(
    `UPDATE fadey_ai_state SET last_chat_purge_day = ?, updated_at = ? WHERE id = 1`,
    [today, businessNow()]
  );
  return { purged: true, day: today };
}

function getHistory(userId, limit = 40) {
  ensureFadeyAiSchema();
  purgeFadeyAiChatIfNewDay();
  const today = String(businessNow()).slice(0, 10);
  const rows = queryAll(
    `SELECT id, role, content, sources_json, created_at
     FROM fadey_ai_chat_messages
     WHERE user_id = ?
       AND substr(created_at, 1, 10) = ?
     ORDER BY datetime(created_at) DESC
     LIMIT ?`,
    [userId, today, Math.min(100, Math.max(1, Number(limit) || 40))]
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

function guidesOnlyReply(message) {
  const hits = searchMemory(message, { kinds: ['guide', 'config', 'catalog', 'snapshot'], limit: 2 });
  if (!hits.length) {
    return {
      reply: 'No encontré una guía exacta. Prueba preguntar con más detalle.',
      sources: [],
    };
  }
  const best = hits[0];
  const body = String(best.body || '').replace(/\n*\(Palabras clave:[\s\S]*$/, '').trim();
  return {
    reply: `**${best.title}**\n\n${body}`,
    sources: [{ kind: best.kind, title: best.title }],
  };
}

function heuristicToolPrefetch(message, user) {
  const m = String(message || '').toLowerCase();
  const sources = [];
  const chunks = [];
  const isHowTo = /c[oó]mo |como |paso a paso|dónde |donde |explicame|explícame|ayuda|creo |crear |configurar |registrar /.test(m)
    || /cerrar caja|abrir caja|requerimiento|recepci[oó]n|auto.?pedido|carta|usuario|impresora|sal[oó]n|liberar mesa|asistencia|cobrar|área|area|producci|mover|traslad|transfer/.test(m)
    || /descuento|cortes[ií]a|oferta|cr[eé]dito|fideliz|encuesta|cliente|delivery|reserva|inventario|kardex|egreso|ingreso|informe|reporte|permiso|qr|mensaje|notificaci|almac[eé]n|gasto|indicador|offline|sunat|comprobante|plan/.test(m);

  if (isHowTo) {
    const r = runTool('search_guides', { query: message }, user);
    if (r.ok && r.hits?.length) {
      const best = r.hits[0];
      chunks.push(`**${best.title}**\n${best.body}`);
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

  const prefetch = heuristicToolPrefetch(text, user);
  let result;
  if (prefetch.chunks.length) {
    result = { reply: prefetch.chunks.join('\n\n'), sources: prefetch.sources };
  } else {
    result = guidesOnlyReply(text);
  }
  saveMessage(user.id, 'assistant', result.reply, result.sources);
  return { ...result, mode: 'local', status: getStatus() };
}

module.exports = {
  getStatus,
  isFeatureEnabled,
  chat,
  getHistory,
  bootstrapKnowledge,
  purgeFadeyAiChatIfNewDay,
};
