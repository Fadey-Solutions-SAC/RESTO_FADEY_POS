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
const { runTool, resolveSalesPeriod } = require('./fadeyAiTools');
const {
  suggestionOptionsForUser,
  accessIntroForUser,
  whatCanIDoAnswer,
  filterGuideHitsForUser,
  deniedGuideMessage,
  guideAllowedForUser,
} = require('./fadeyAiAccess');

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

function guidesOnlyReply(message, user) {
  const hits = filterGuideHitsForUser(
    user,
    searchMemory(message, { kinds: ['guide', 'config', 'catalog', 'snapshot'], limit: 6 }),
  ).slice(0, 2);
  if (!hits.length) {
    const raw = searchMemory(message, { kinds: ['guide'], limit: 1 });
    if (raw[0] && !guideAllowedForUser(user, raw[0].id)) {
      return {
        reply: deniedGuideMessage(user, raw[0].id),
        sources: [{ kind: 'tool', title: 'permission_denied' }],
      };
    }
    return {
      reply: 'No encontré una guía exacta dentro de tus módulos. Prueba preguntar con más detalle o escribe «¿qué puedo hacer?».',
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

function displayUserName(user) {
  const uname = String(user?.username || '').trim();
  if (uname) return uname;
  const full = String(user?.full_name || '').trim();
  if (full && !/^administrador maestro$/i.test(full)) return full.split(/\s+/)[0] || full;
  return 'usuario';
}

/** Opciones rápidas según módulos ya asignados en Usuarios. */
function staffHelpOptions(user) {
  return suggestionOptionsForUser(user);
}

function isGreetingMessage(message) {
  const m = String(message || '').toLowerCase().trim();
  return /^(hola|hola!|holaa+|buenas|buenos d[ií]as|buenas tardes|buenas noches|hey|saludos)(\s+[a-záéíóúñ.!?]*)?$/i.test(m)
    || /^(hola|buenas|buenos d[ií]as|buenas tardes|buenas noches)\s+(pix|ia|fadey)\b/.test(m);
}

/**
 * Saludo personalizado con nombre + opciones de ayuda (usuarios del sistema).
 */
function tryStaffGreetingAnswer(message, user) {
  if (!isGreetingMessage(message)) return null;
  if (isMasterCreator(user)) {
    return null;
  }

  const name = displayUserName(user);
  const options = staffHelpOptions(user);
  const lines = [
    `¡Hola, ${name}! Soy PIX, tu asistente IA Fadey.`,
    accessIntroForUser(user),
    'Solo te guío en los módulos y acciones que tienes permitidos en el POS.',
    '',
    'Opciones rápidas:',
    ...options.map((o, i) => `${i + 1}. ${o}`),
    '',
    'Elige una opción o escríbeme tu consulta.',
  ];
  return {
    chunks: [lines.join('\n')],
    sources: [{ kind: 'tool', title: 'greeting' }],
    options,
  };
}

function isMasterCreator(user) {
  return String(user?.role || '').toLowerCase() === 'master_admin';
}

function isOriginQuestion(message) {
  const m = String(message || '').toLowerCase();
  return /qui[eé]n (te |me )?(cre[oó]|hizo|dise[nñ][oó]|program)|tu creador|soy tu creador|de qui[eé]n eres|a qui[eé]n perteneces|qui[eé]n (te )?desarroll|para qui[eé]n trabajas/.test(m);
}

/**
 * Origen de PIX: Fadey Solutions / Sr. Romero (disponible para cualquier usuario que lo pregunte).
 * No se ofrece como chip de sugerencia.
 */
function tryOriginAnswer(message, user) {
  if (!isOriginQuestion(message)) return null;
  if (isMasterCreator(user)) {
    return {
      chunks: [
        'Pertenezco a la empresa Fadey Solutions. Mi principal desarrollador es el Sr. Romero. Soy PIX, la IA Fadey del POS Resto Fadey, y estoy a sus órdenes.',
      ],
      sources: [{ kind: 'tool', title: 'creator_mode' }],
    };
  }
  return {
    chunks: [
      'Pertenezco a la empresa Fadey Solutions. Mi principal desarrollador es el Sr. Romero. Soy PIX, la IA Fadey del POS.',
    ],
    sources: [{ kind: 'tool', title: 'origin' }],
  };
}

/**
 * Respuestas solo visibles/activas para Admin Maestro (creador de PIX).
 * Otros roles nunca reciben este tono ni reconocimiento.
 */
function tryMasterCreatorAnswer(message, user) {
  if (!isMasterCreator(user)) return null;
  const m = String(message || '').toLowerCase();

  // Origen / creador: respuesta común (Fadey Solutions + Sr. Romero).
  const origin = tryOriginAnswer(message, user);
  if (origin?.chunks?.length) return origin;

  if (/qui[eé]n eres|c[oó]mo te llamas/.test(m)) {
    return {
      chunks: [
        'Soy PIX, la IA Fadey del POS Resto Fadey. Pertenezco a Fadey Solutions; mi principal desarrollador es el Sr. Romero. Estoy a sus órdenes.',
      ],
      sources: [{ kind: 'tool', title: 'creator_mode' }],
    };
  }

  if (/estado del sistema|c[oó]mo est[aá]s|todo bien|hola pix|buenas|buenos d[ií]as|buenas tardes|buenas noches|^hola\b/.test(m.trim())) {
    const options = staffHelpOptions(user);
    return {
      chunks: [
        [
          'Hola, Sr. Romero. Estoy operativa y a sus órdenes.',
          'Puedo ayudarlo con el negocio, el equipo, demoras, stock y el control del sistema.',
          '',
          'Opciones rápidas:',
          ...options.map((o, i) => `${i + 1}. ${o}`),
          '',
          '¿En qué puedo ayudarlo?',
        ].join('\n'),
      ],
      sources: [{ kind: 'tool', title: 'creator_mode' }],
      options,
    };
  }

  return null;
}

function hrFocusForMessage(message) {
  const m = String(message || '').toLowerCase();
  if (/demora(s)?|retraso(s)?|cocina.*(lenta|demor)|hay demoras/.test(m)) return 'kitchen';
  if (/qui[eé]n est[aá] (en )?(jornada|turno)|personal (en jornada|activo|online)/.test(m)) return 'staff';
  if (/c[oó]mo va (la )?productividad|productividad del equipo|ranking/.test(m)) return 'productivity';
  return 'full';
}

function salesScopeForMessage(message) {
  return resolveSalesPeriod(message).scope;
}

function formatSalesReply(r) {
  const label = r.label || (r.from === r.to ? r.from : `${r.from} → ${r.to}`);
  const range = r.from === r.to ? r.from : `${r.from} → ${r.to}`;
  return `Ventas ${label}: S/ ${Number(r.sales || 0).toFixed(2)} · ${r.orders} cuenta(s) (${range}).`;
}

function isExplicitHowToMessage(message) {
  const m = String(message || '').toLowerCase().trim();
  return /^(c[oó]mo|como)\s+(marcar|cerrar|abrir|crear|configurar|registrar|cambiar|usar|hacer|poner|activar|desactivar|generar|imprimir|liberar|mover|anular|cobrar|pagar)/.test(m)
    || /\b(c[oó]mo|como)\s+(marcar|cerrar|abrir|crear|configurar|registrar|cambiar|usar)\b/.test(m)
    || (/cerrar\s+caja|abrir\s+caja/.test(m) && !/cu[aá]nto|vend[ií]|venta|demora|productividad|jornada|qui[eé]n/.test(m));
}

/** Respuestas cortas a datos en vivo (sin guiar a módulos). */
function tryDirectDataAnswer(message, user) {
  const m = String(message || '').toLowerCase();
  if (isExplicitHowToMessage(m)) return null;

  if (/qu[eé] puedo (hacer|ver|usar)|mis (m[oó]dulos|permisos)|a qu[eé] tengo acceso/.test(m)) {
    return {
      chunks: [whatCanIDoAnswer(user)],
      sources: [{ kind: 'tool', title: 'permissions_scope' }],
      options: staffHelpOptions(user),
    };
  }

  const denyOrOk = (r, title, focus = null) => {
    if (r?.denied && r?.error) {
      return { chunks: [r.error], sources: [{ kind: 'tool', title: 'permission_denied' }] };
    }
    if (r?.ok && r.text) {
      return { chunks: [r.text], sources: [{ kind: 'tool', title, focus }] };
    }
    return null;
  };

  if (/demora(s)?|retraso(s)? (en )?cocina|hay demoras|cocina.*(lenta|demor)/.test(m)) {
    const r = runTool('hr_insights', { focus: 'kitchen' }, user);
    const out = denyOrOk(r, 'hr_insights', 'kitchen');
    if (out) return out;
  }

  if (/qui[eé]n est[aá] (en )?(jornada|turno)|personal (en jornada|activo|online)/.test(m)) {
    const staff = runTool('active_staff', {}, user);
    if (staff?.denied && staff?.error) {
      return { chunks: [staff.error], sources: [{ kind: 'tool', title: 'permission_denied' }] };
    }
    if (staff.ok && Array.isArray(staff.staff)) {
      const names = staff.staff.slice(0, 12).map((s) => s.name || s.full_name).filter(Boolean);
      const text = names.length
        ? `En jornada ahora (${names.length}): ${names.join(', ')}.`
        : 'Nadie con jornada abierta en este momento.';
      return { chunks: [text], sources: [{ kind: 'tool', title: 'active_staff' }] };
    }
    const r = runTool('hr_insights', { focus: 'staff' }, user);
    const out = denyOrOk(r, 'hr_insights', 'staff');
    if (out) return out;
  }

  if (/c[oó]mo va (la )?productividad|productividad del equipo|ranking (de )?(mozo|cajero|cocina|equipo)/.test(m)) {
    const r = runTool('hr_insights', { focus: 'productivity' }, user);
    const out = denyOrOk(r, 'hr_insights', 'productivity');
    if (out) return out;
  }

  if (/pendiente(s)?( de )?cobro|por cobrar|sin cobrar|cu[aá]nto.*pendiente|hay pendiente/.test(m)) {
    const r = runTool('sales_desk', { focus: 'pending', message }, user);
    const out = denyOrOk(r, 'sales_desk', 'pending');
    if (out) return out;
  }

  if (/forma(s)? de pago|reparti.*(pago|yape|efectivo)|yape.*efectivo|efectivo.*yape|pagos \(yape|c[oó]mo se (pagan|cobran|repartieron)/.test(m)) {
    const r = runTool('sales_desk', { focus: 'payments', message }, user);
    const out = denyOrOk(r, 'sales_desk', 'payments');
    if (out) return out;
  }

  if (/mesero.*(m[aá]s|vend)|qui[eé]n vend[ií][oó] m[aá]s|top mesero|ranking (de )?mesero|ventas por mesero/.test(m)) {
    const r = runTool('sales_desk', { focus: 'waiters', message }, user);
    const out = denyOrOk(r, 'sales_desk', 'waiters');
    if (out) return out;
  }

  if (/venta|vend[ií]|facturaci[oó]n|recaud|cu[aá]nto\s+(vend|factur|hago|hice)/.test(m)) {
    const period = resolveSalesPeriod(message);
    const r = runTool('sales_summary', {
      scope: period.scope,
      from: period.from,
      to: period.to,
      label: period.label,
    }, user);
    if (r?.denied && r?.error) {
      return { chunks: [r.error], sources: [{ kind: 'tool', title: 'permission_denied' }] };
    }
    if (r.ok) {
      return {
        chunks: [formatSalesReply(r)],
        sources: [{ kind: 'tool', title: 'sales_summary' }],
      };
    }
    if (r?.error) {
      return {
        chunks: [r.error],
        sources: [{ kind: 'tool', title: 'sales_summary' }],
      };
    }
  }

  if (/stock|agotad|inventario bajo/.test(m)) {
    const r = runTool('low_stock', {}, user);
    if (r?.denied && r?.error) {
      return { chunks: [r.error], sources: [{ kind: 'tool', title: 'permission_denied' }] };
    }
    if (r.ok) {
      return {
        chunks: [r.count ? `Stock bajo (${r.count}): ${r.items.slice(0, 5).map((i) => i.name).join(', ')}.` : 'No hay productos en umbral de stock bajo.'],
        sources: [{ kind: 'tool', title: 'low_stock' }],
      };
    }
  }

  return null;
}

function applyLearnedIntent(message, user, chunks, sources) {
  const learned = resolveLearnedIntent(message);
  if (!learned?.intent) return false;
  const intent = learned.intent;

  // Preguntas de datos: preferir respuesta directa aunque el aprendizaje apunte a una guía.
  if (!isExplicitHowToMessage(message)) {
    const direct = tryDirectDataAnswer(message, user);
    if (direct?.chunks?.length) {
      chunks.push(...direct.chunks);
      sources.push(...direct.sources.map((s) => ({ ...s, learned: true })));
      return true;
    }
  }

  if (intent.startsWith('guide-') || intent.startsWith('guide:') || intent.includes('guide')) {
    if (!isExplicitHowToMessage(message)) return false;
    const guideId = intent.replace(/^guide:/, '');
    if (guideId && !guideAllowedForUser(user, guideId)) {
      chunks.push(deniedGuideMessage(user, guideId));
      sources.push({ kind: 'tool', title: 'permission_denied', learned: true });
      return true;
    }
    const hits = filterGuideHitsForUser(user, searchMemory(message, { kinds: ['guide', 'config'], limit: 3 }));
    const byId = hits.find((h) => String(h.id || '') === guideId || String(h.id || '').includes(guideId));
    const best = byId || hits[0];
    if (best) {
      const body = String(best.body || '').replace(/\n*\(Palabras clave:[\s\S]*$/, '').trim();
      chunks.push(`**${best.title}**\n${body}`);
      sources.push({ kind: 'tool', title: 'search_guides', learned: true });
      return true;
    }
  }

  let toolName = intent.replace(/^tool:/, '');
  let focusFromIntent = null;
  const hrFocusMatch = toolName.match(/^hr_insights:(.+)$/);
  if (hrFocusMatch) {
    toolName = 'hr_insights';
    focusFromIntent = hrFocusMatch[1];
  }
  if (['business_insights', 'hr_insights', 'sales_summary', 'sales_desk', 'top_products', 'low_stock', 'active_staff', 'kitchen_open_orders'].includes(toolName)) {
    const args = toolName === 'sales_summary'
      ? (() => {
        const period = resolveSalesPeriod(message);
        return { scope: period.scope, from: period.from, to: period.to, label: period.label };
      })()
      : toolName === 'sales_desk'
        ? { focus: /pendiente|cobro/.test(String(message || '').toLowerCase()) ? 'pending'
          : /pago|yape|efectivo|tarjeta/.test(String(message || '').toLowerCase()) ? 'payments'
            : /mesero/.test(String(message || '').toLowerCase()) ? 'waiters' : 'full', message }
      : toolName === 'hr_insights'
        ? { focus: focusFromIntent || hrFocusForMessage(message) }
        : {};
    const r = runTool(toolName, args, user);
    if (r?.denied && r?.error) {
      chunks.push(r.error);
      sources.push({ kind: 'tool', title: 'permission_denied', learned: true });
      return true;
    }
    if (r.ok) {
      if (r.text) chunks.push(r.text);
      else if (toolName === 'sales_summary') {
        chunks.push(formatSalesReply(r));
      } else if (toolName === 'top_products' && r.items?.length) {
        const top = r.items[0];
        chunks.push(`Más vendido (${r.date}): ${top.name} (${top.qty} uds).`);
      } else if (toolName === 'low_stock') {
        chunks.push(r.count ? `Stock bajo (${r.count}): ${r.items.slice(0, 5).map((i) => i.name).join(', ')}.` : 'No hay productos en umbral de stock bajo.');
      } else if (toolName === 'active_staff') {
        const names = (r.staff || []).slice(0, 12).map((s) => s.name || s.full_name).filter(Boolean);
        chunks.push(names.length ? `Personal en jornada: ${names.join(', ')}.` : 'Nadie con jornada abierta.');
      } else if (toolName === 'kitchen_open_orders') {
        chunks.push(r.text || `Pedidos abiertos cocina/bar: ${r.open_count ?? 0}.`);
      }
      if (chunks.length) {
        sources.push({ kind: 'tool', title: toolName, learned: true, focus: args.focus || null });
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

  // Modo creador (solo master_admin): reconocimiento / saludo especial.
  const creator = tryMasterCreatorAnswer(message, user);
  if (creator?.chunks?.length) {
    return creator;
  }

  // Origen de PIX (cualquier usuario): Fadey Solutions / Sr. Romero.
  const origin = tryOriginAnswer(message, user);
  if (origin?.chunks?.length) {
    return origin;
  }

  // Saludo personalizado con nombre + opciones (resto del personal).
  const greeting = tryStaffGreetingAnswer(message, user);
  if (greeting?.chunks?.length) {
    return greeting;
  }

  // 1) Datos directos primero (demoras, jornada, ventas…) — nunca como guía de módulos.
  const direct = tryDirectDataAnswer(message, user);
  if (direct?.chunks?.length) {
    // Si es el creador, un toque de respeto sin cambiar el dato.
    if (isMasterCreator(user) && direct.chunks[0] && !/Sr\. Romero/i.test(direct.chunks[0])) {
      direct.chunks[0] = `${direct.chunks[0]}`;
    }
    return direct;
  }

  if (applyLearnedIntent(message, user, chunks, sources)) {
    return { chunks, sources };
  }

  const isExplicitHowTo = isExplicitHowToMessage(m);

  const wantsHrData =
    !isExplicitHowTo && (
      /productividad|personal en (turno|jornada)|qui[eé]n est[aá] (trabajando|en turno|en jornada)|emplead|rr\.?\s*hh|recursos humanos|ranking (de )?(mozo|cajero|cocina)|tiempo (promedio )?en cocina|hora pico operativa|baja productividad|calificaci[oó]n de mozo/.test(m)
      || /qui[eé]n (vende|atiende|cobra) m[aá]s|demora(s)?|personal (activo|online)|c[oó]mo va (la )?productividad/.test(m)
      || (/\bjornada\b/.test(m) && !/marcar|asistencia|qr/.test(m))
    );

  const wantsAnalytics = !isExplicitHowTo && !wantsHrData && (
    /recomienda|recomendaci[oó]n|analiz|decisi[oó]n|vendimos|qu[eé]\s+vend|resumen de ventas|genera un resumen|informe de ventas|reporte de ventas|indicador|proyecci|alerta|datos en (vivo|tiempo)/.test(m)
    || /qu[eé] me recomiendas|mejorar (ventas|negocio)|qu[eé] hago/.test(m)
  );

  if (isExplicitHowTo) {
    const r = runTool('search_guides', { query: message }, user);
    if (r.ok && r.hits?.length) {
      const best = r.hits[0];
      chunks.push(`**${best.title}**\n${best.body}`);
      sources.push({ kind: 'tool', title: 'search_guides', guideId: best.id || null });
      return { chunks, sources };
    }
    // Guía existe pero fuera de permisos del usuario
    const rawHits = searchMemory(message, { kinds: ['guide'], limit: 1 });
    if (rawHits[0] && !guideAllowedForUser(user, rawHits[0].id)) {
      chunks.push(deniedGuideMessage(user, rawHits[0].id));
      sources.push({ kind: 'tool', title: 'permission_denied', guideId: rawHits[0].id });
      return { chunks, sources };
    }
  }

  if (wantsHrData) {
    const r = runTool('hr_insights', { focus: hrFocusForMessage(m) }, user);
    if (r?.denied && r?.error) {
      chunks.push(r.error);
      sources.push({ kind: 'tool', title: 'permission_denied' });
      return { chunks, sources };
    }
    if (r.ok && r.text) {
      chunks.push(r.text);
      sources.push({ kind: 'tool', title: 'hr_insights', focus: hrFocusForMessage(m) });
      return { chunks, sources };
    }
  }

  if (wantsAnalytics) {
    const r = runTool('business_insights', {}, user);
    if (r?.denied && r?.error) {
      chunks.push(r.error);
      sources.push({ kind: 'tool', title: 'permission_denied' });
      return { chunks, sources };
    }
    if (r.ok && r.text) {
      chunks.push(r.text);
      sources.push({ kind: 'tool', title: 'business_insights' });
      return { chunks, sources };
    }
  }

  if (/plato|producto.*m[aá]s|m[aá]s vend|top/.test(m) && !/c[oó]mo/.test(m) && !wantsHrData) {
    const dateMatch = m.match(/(\d{4}-\d{2}-\d{2})/);
    const r = runTool('top_products', dateMatch ? { date: dateMatch[1] } : { scope: /mes/.test(m) ? 'month' : 'day' }, user);
    if (r?.denied && r?.error) {
      chunks.push(r.error);
      sources.push({ kind: 'tool', title: 'permission_denied' });
      return { chunks, sources };
    }
    if (r.ok && r.items?.length) {
      const top = r.items[0];
      chunks.push(`Más vendido (${r.date}): ${top.name} (${top.qty} uds${top.revenue != null ? `, S/ ${Number(top.revenue).toFixed(2)}` : ''}).`);
      sources.push({ kind: 'tool', title: 'top_products' });
    }
  }
  return { chunks, sources };
}

function rememberSuccessfulIntent(message, sources) {
  try {
    const src = Array.isArray(sources) && sources[0] ? sources[0] : null;
    if (!src) return;
    // No aprender guías para preguntas de datos (evita volver a “paso a paso” / menús).
    if (!isExplicitHowToMessage(message) && (src.title === 'search_guides' || src.kind === 'guide')) {
      return;
    }
    let intent = null;
    if (src.kind === 'tool' && src.title === 'search_guides' && src.guideId) {
      intent = String(src.guideId);
    } else if (src.kind === 'tool' && src.title === 'hr_insights' && src.focus && src.focus !== 'full') {
      intent = `tool:hr_insights:${src.focus}`;
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
    result = {
      reply: prefetch.chunks.join('\n\n'),
      sources: prefetch.sources,
      options: Array.isArray(prefetch.options) ? prefetch.options : undefined,
    };
  } else {
    result = guidesOnlyReply(text, user);
    if (isMasterCreator(user) && result?.reply && /no encontr[eé] una gu[ií]a/i.test(result.reply)) {
      result = {
        reply: 'Sr. Romero, no encontré una guía exacta para eso. ¿Puede darme más detalle o pedirme un dato del negocio?',
        sources: [{ kind: 'tool', title: 'creator_mode' }],
      };
    }
  }
  rememberSuccessfulIntent(text, result.sources);
  saveMessage(user.id, 'assistant', result.reply, result.sources);
  return {
    ...result,
    mode: 'local',
    status: getStatus(),
    creator_mode: isMasterCreator(user),
  };
}

module.exports = {
  getStatus,
  isFeatureEnabled,
  chat,
  getHistory,
  bootstrapKnowledge,
  purgeFadeyAiChatIfNewDay,
};
