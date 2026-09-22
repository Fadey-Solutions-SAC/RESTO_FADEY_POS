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
  learnUserPhrase,
  resolveLearnedIntent,
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
    sources: [{ kind: best.kind, title: best.title, id: best.id || null }],
  };
}

function applyLearnedIntent(message, user, chunks, sources) {
  const learned = resolveLearnedIntent(message);
  if (!learned?.intent) return false;
  const intent = learned.intent;

  if (intent.startsWith('guide-') || intent.startsWith('guide:') || intent.includes('guide')) {
    const guideId = intent.replace(/^guide:/, '');
    const hits = searchMemory(message, { kinds: ['guide', 'config'], limit: 3 });
    const byId = hits.find((h) => String(h.id || '') === guideId || String(h.id || '').includes(guideId));
    const best = byId || hits[0];
    if (best) {
      const body = String(best.body || '').replace(/\n*\(Palabras clave:[\s\S]*$/, '').trim();
      chunks.push(`**${best.title}**\n${body}`);
      sources.push({ kind: 'tool', title: 'search_guides', learned: true });
      return true;
    }
  }

  const toolName = intent.replace(/^tool:/, '');
  if (['business_insights', 'hr_insights', 'sales_summary', 'top_products', 'low_stock', 'active_staff', 'kitchen_open_orders'].includes(toolName)) {
    const args = toolName === 'sales_summary'
      ? {
        scope: /hoy|dia|día/.test(String(message || '').toLowerCase())
          ? 'today'
          : /(semana|7\s*d[ií]as|últimos?\s*7)/.test(String(message || '').toLowerCase())
            ? 'week'
            : 'month',
      }
      : {};
    const r = runTool(toolName, args, user);
    if (r.ok) {
      if (r.text) chunks.push(r.text);
      else if (toolName === 'sales_summary') {
        chunks.push(`Ventas: S/ ${Number(r.sales || 0).toFixed(2)} · ${r.orders} cuenta(s) (${r.from} → ${r.to}).`);
      } else if (toolName === 'top_products' && r.items?.length) {
        const top = r.items[0];
        chunks.push(`Más vendido (${r.date}): ${top.name} (${top.qty} uds).`);
      } else if (toolName === 'low_stock') {
        chunks.push(r.count ? `Stock bajo (${r.count}): ${r.items.slice(0, 5).map((i) => i.name).join(', ')}` : 'No hay productos en umbral de stock bajo.');
      } else if (toolName === 'active_staff') {
        const names = (r.staff || []).slice(0, 12).map((s) => s.name || s.full_name).filter(Boolean);
        chunks.push(names.length ? `Personal en jornada: ${names.join(', ')}.` : 'Nadie con jornada abierta.');
      } else if (toolName === 'kitchen_open_orders') {
        chunks.push(r.text || `Pedidos abiertos cocina/bar: ${r.open_count ?? 0}.`);
      }
      if (chunks.length) {
        sources.push({ kind: 'tool', title: toolName, learned: true });
        return true;
      }
    }
  }
  return false;
}

function heuristicToolPrefetch(message, user) {
  const m = String(message || '').toLowerCase();
  const sources = [];
  const chunks = [];

  if (applyLearnedIntent(message, user, chunks, sources)) {
    return { chunks, sources };
  }

  // Guías explícitas ("cómo cerrar caja", "cómo marcar asistencia") van primero.
  // No confundir con datos: "cómo va la productividad", "cuánto vendí", "hay demoras".
  const isExplicitHowTo =
    /^(c[oó]mo|como)\s+(marcar|cerrar|abrir|crear|configurar|registrar|cambiar|usar|hacer|poner|activar|desactivar|generar|imprimir|liberar|mover|anular|cobrar|pagar)/.test(m.trim())
    || /\b(c[oó]mo|como)\s+(marcar|cerrar|abrir|crear|configurar|registrar|cambiar|usar)\b/.test(m)
    || (/cerrar\s+caja|abrir\s+caja/.test(m) && !/cu[aá]nto|vend[ií]|venta|demora|productividad|jornada|qui[eé]n/.test(m));

  const wantsHrData =
    !isExplicitHowTo && (
      /productividad|personal en (turno|jornada)|qui[eé]n est[aá] (trabajando|en turno|en jornada)|emplead|rr\.?\s*hh|recursos humanos|ranking (de )?(mozo|cajero|cocina)|tiempo (promedio )?en cocina|hora pico operativa|baja productividad|calificaci[oó]n de mozo/.test(m)
      || /qui[eé]n (vende|atiende|cobra) m[aá]s|demora(s)? (en )?cocina|personal (activo|online)|c[oó]mo va (la )?productividad|hay demoras/.test(m)
      || (/\bjornada\b/.test(m) && !/marcar|asistencia|qr/.test(m))
    );

  const wantsAnalytics = !isExplicitHowTo && !wantsHrData && (
    /recomienda|recomendaci[oó]n|analiz|decisi[oó]n|vendimos|qu[eé]\s+vend|resumen de ventas|genera un resumen|informe de ventas|reporte de ventas|indicador|proyecci|alerta|datos en (vivo|tiempo)/.test(m)
    || /qu[eé] me recomiendas|mejorar (ventas|negocio)|qu[eé] hago/.test(m)
  );

  const wantsSales =
    !isExplicitHowTo && !wantsHrData && /venta|vend[ií]|facturaci[oó]n|recaud|cu[aá]nto\s+(vend|factur|hago|hice)/.test(m);

  if (isExplicitHowTo) {
    const r = runTool('search_guides', { query: message }, user);
    if (r.ok && r.hits?.length) {
      const best = r.hits[0];
      chunks.push(`**${best.title}**\n${best.body}`);
      sources.push({ kind: 'tool', title: 'search_guides', guideId: best.id || null });
      return { chunks, sources };
    }
  }

  if (wantsHrData) {
    // Preguntas puntuales de cocina / jornada: respuesta directa sin lista numerada de guía.
    if (/demora(s)? (en )?cocina|retraso(s)? (en )?cocina|cocina.*(lenta|demor)/.test(m)) {
      const r = runTool('hr_insights', {}, user);
      if (r.ok && r.text) {
        const kitchenLine = String(r.text).split('\n').find((l) => /cocina \(per[ií]odo\)/i.test(l));
        chunks.push(
          kitchenLine
            || 'Sin datos de demoras de cocina en este momento. Revisa Productividad POS → Por área.',
        );
        sources.push({ kind: 'tool', title: 'hr_insights' });
        return { chunks, sources };
      }
    }
    if (/qui[eé]n est[aá] (en )?(jornada|turno)|personal (en jornada|activo|online)/.test(m)) {
      const staff = runTool('active_staff', {}, user);
      if (staff.ok && Array.isArray(staff.staff)) {
        const names = staff.staff.slice(0, 12).map((s) => s.name || s.full_name).filter(Boolean);
        chunks.push(
          names.length
            ? `Personal en jornada ahora: ${names.join(', ')}.`
            : 'Nadie con jornada abierta en este momento.',
        );
        sources.push({ kind: 'tool', title: 'active_staff' });
        return { chunks, sources };
      }
    }
    const r = runTool('hr_insights', {}, user);
    if (r.ok && r.text) {
      chunks.push(r.text);
      sources.push({ kind: 'tool', title: 'hr_insights' });
      return { chunks, sources };
    }
  }

  if (wantsAnalytics) {
    const r = runTool('business_insights', {}, user);
    if (r.ok && r.text) {
      chunks.push(r.text);
      sources.push({ kind: 'tool', title: 'business_insights' });
      return { chunks, sources };
    }
  }

  if (wantsSales) {
    const scope = /hoy|dia|día/.test(m)
      ? 'today'
      : /(semana|7\s*d[ií]as|últimos?\s*7)/.test(m)
        ? 'week'
        : 'month';
    const r = runTool('sales_summary', { scope }, user);
    if (r.ok) {
      chunks.push(`Ventas: S/ ${Number(r.sales || 0).toFixed(2)} · ${r.orders} cuenta(s) (${r.from} → ${r.to}).`);
      sources.push({ kind: 'tool', title: 'sales_summary' });
      return { chunks, sources };
    }
  }

  if (/plato|producto.*m[aá]s|m[aá]s vend|top/.test(m) && !/c[oó]mo/.test(m) && !wantsHrData) {
    const dateMatch = m.match(/(\d{4}-\d{2}-\d{2})/);
    const r = runTool('top_products', dateMatch ? { date: dateMatch[1] } : { scope: /mes/.test(m) ? 'month' : 'day' }, user);
    if (r.ok && r.items?.length) {
      const top = r.items[0];
      chunks.push(`Más vendido (${r.date}): ${top.name} (${top.qty} uds${top.revenue != null ? `, S/ ${Number(top.revenue).toFixed(2)}` : ''}).`);
      sources.push({ kind: 'tool', title: 'top_products' });
    }
  }
  if (/stock|agotad|inventario/.test(m) && !isExplicitHowTo) {
    const r = runTool('low_stock', {}, user);
    if (r.ok) {
      chunks.push(r.count ? `Stock bajo (${r.count}): ${r.items.slice(0, 5).map((i) => i.name).join(', ')}` : 'No hay productos en umbral de stock bajo.');
      sources.push({ kind: 'tool', title: 'low_stock' });
    }
  }
  return { chunks, sources };
}

function rememberSuccessfulIntent(message, sources) {
  try {
    const src = Array.isArray(sources) && sources[0] ? sources[0] : null;
    if (!src) return;
    let intent = null;
    if (src.kind === 'tool' && src.title === 'search_guides' && src.guideId) {
      intent = String(src.guideId);
    } else if (src.kind === 'tool' && src.title) {
      intent = `tool:${src.title}`;
    } else if (src.kind === 'guide' || src.kind === 'config') {
      intent = src.id ? String(src.id) : `guide:${src.title || 'unknown'}`;
    }
    if (!intent) return;
    learnUserPhrase(message, intent, { source: src.title || src.kind });
  } catch (_) {
    /* aprendizaje opcional */
  }
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
  rememberSuccessfulIntent(text, result.sources);
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
