/**
 * Chat IA Fadey — 100 % local a esta instancia (guías + datos del POS).
 * No llama a OpenAI ni a ningún servicio externo de LLM.
 */
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
  learnUserPhrase,
  resolveLearnedIntent,
} = require('./fadeyAiKnowledgeService');
const { runTool, resolveSalesPeriod } = require('./fadeyAiTools');
const { buildSupportAnswer } = require('./fadeyAiSupport');
const { buildReportAnswer, isReportRequest } = require('./fadeyAiReports');
const { buildPurchaseAnswer } = require('./fadeyAiPurchase');
const { buildAdvisorAnswer, analyze: analyzeBusiness, resolveAdvicePeriod } = require('./fadeyAiAdvisor');
const { buildConceptAnswer } = require('./fadeyAiConcepts');
const { toolSurveyInsights } = require('./fadeyAiBusinessAnalysis');
const {
  forecastAnswer,
  closedDaysAnswer,
  weekdayAdviceAnswer,
} = require('./fadeyAiForecast');
const { detectLanguage, toSpanishQuery, translateResult } = require('./fadeyAiI18n');
const {
  formatDisplayDateKey,
  resolveRegionalTimezone,
  partsFromDate,
  DEFAULT_TIMEZONE,
  getBusinessTodayDateKey,
} = require('../../utils/appDateTime');
const { resolveNaturalPeriod } = require('./fadeyAiDateParse');
const {
  suggestionOptionsForUser,
  accessIntroForUser,
  whatCanIDoAnswer,
  filterGuideHitsForUser,
  deniedGuideMessage,
  guideAllowedForUser,
  canUseTool,
  deniedToolMessage,
  isPlanModuleEnabled,
} = require('./fadeyAiAccess');
const {
  recall,
  trackTopic,
  topicSummary,
  handleMemoryCommand,
  relevantFact,
  goalProgressLine,
} = require('./fadeyAiUserMemory');
const { recordUserAiQuestion } = require('./fadeyAiQuestionExport');

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
    ...getChatDayInfo(),
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
  const createdAt = businessNow();
  runSql(
    `INSERT INTO fadey_ai_chat_messages (id, user_id, role, content, sources_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, userId, role, content, sources ? JSON.stringify(sources) : null, createdAt]
  );
  if (role === 'user') {
    try {
      recordUserAiQuestion({ userId, content, createdAt });
    } catch (err) {
      console.warn('[fadey-ai] no se guardó la pregunta para el panel:', err.message || err);
    }
  }
  return id;
}

function businessTimezone() {
  try {
    return resolveRegionalTimezone(queryOne);
  } catch (_) {
    return DEFAULT_TIMEZONE;
  }
}

function businessDayKey() {
  return String(businessNow()).slice(0, 10);
}

/** Día de negocio de `created_at`: hora local `YYYY-MM-DD HH:MM:SS` o ISO/UTC de versiones anteriores. */
function messageDayKey(createdAt, timeZone) {
  const s = String(createdAt || '').trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.slice(0, 10);
  const p = partsFromDate(d, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Día y zona horaria con que se reinicia el chat (configuración regional del restaurante). */
function getChatDayInfo() {
  return { day: businessDayKey(), timezone: businessTimezone() };
}

/**
 * Borra el historial de días anteriores (medianoche en la zona horaria del restaurante).
 * Revisa cada mensaje, así también limpia filas con fechas ISO/UTC o tras cambiar la zona horaria.
 */
function purgeFadeyAiChatIfNewDay() {
  ensureFadeyAiSchema();
  const { day: today, timezone } = getChatDayInfo();
  const rows = queryAll('SELECT id, created_at FROM fadey_ai_chat_messages') || [];
  const stale = rows.filter((r) => messageDayKey(r.created_at, timezone) < today).map((r) => r.id);
  for (let i = 0; i < stale.length; i += 200) {
    const ids = stale.slice(i, i + 200);
    runSql(`DELETE FROM fadey_ai_chat_messages WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  }
  const state = getState();
  if (String(state.last_chat_purge_day || '').slice(0, 10) !== today) {
    runSql(
      `UPDATE fadey_ai_state SET last_chat_purge_day = ?, updated_at = ? WHERE id = 1`,
      [today, businessNow()]
    );
  }
  return { purged: stale.length > 0, removed: stale.length, day: today };
}

function getHistory(userId, limit = 40) {
  ensureFadeyAiSchema();
  purgeFadeyAiChatIfNewDay();
  const { day: today, timezone } = getChatDayInfo();
  const max = Math.min(100, Math.max(1, Number(limit) || 40));
  const rows = (queryAll(
    `SELECT id, role, content, sources_json, created_at
     FROM fadey_ai_chat_messages
     WHERE user_id = ?
     ORDER BY created_at DESC, rowid DESC
     LIMIT 300`,
    [userId]
  ) || []).filter((r) => messageDayKey(r.created_at, timezone) === today).slice(0, max);
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
      reply: 'No encontré una guía exacta dentro de tus módulos. Prueba preguntar con más detalle o escribe «¿qué puedo hacer?».\n\nSi es un error del sistema, descríbelo (por ejemplo «error al imprimir») o escribe «soporte» y te preparo el mensaje para el equipo técnico.',
      sources: [],
    };
  }
  const best = hits[0];
  const body = String(best.body || '').replace(/\n*\(Palabras clave:[\s\S]*$/, '').trim();
  return {
    reply: best.kind === 'guide'
      ? `**${best.title}**\n\n${body}\n\nSi algo no aparece como se describe, puede que tu usuario no tenga permiso para ese módulo o que la opción esté desactivada en la configuración; consúltalo con el administrador.`
      : `**${best.title}**\n\n${body}`,
    sources: [{ kind: best.kind, title: best.title, id: best.id || null }],
  };
}

function displayUserName(user) {
  const remembered = String(recall(user?.id).profile.name || '').trim();
  if (remembered) return remembered;
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
  const habits = topicSummary(user.id);
  const lines = [
    `¡Hola, ${name}! Soy PIX, tu asistente IA Fadey.`,
    accessIntroForUser(user),
    'Solo te guío en los módulos y acciones que tienes permitidos en el POS.',
    ...(habits ? [`Sé que sueles consultarme sobre ${habits}; pídemelo cuando quieras.`] : []),
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

function formatSalesReply(r, user = null) {
  const range = r.from === r.to
    ? formatDisplayDateKey(r.from)
    : `${formatDisplayDateKey(r.from)} → ${formatDisplayDateKey(r.to)}`;
  const label = r.label || range;
  const suffix = label.includes(formatDisplayDateKey(r.from)) ? '' : ` (${range})`;
  const head = `Ventas ${label}: S/ ${Number(r.sales || 0).toFixed(2)} · ${r.orders} cuenta(s)${suffix}.`;
  let goal = '';
  if (user?.id) {
    try {
      goal = goalProgressLine(user.id, { from: r.from, to: r.to, sales: r.sales, todayKey: businessDayKey() });
    } catch (_) {
      goal = '';
    }
  }
  const tail = goal ? `\n${goal}` : '';
  if (!r.orders) return `${head}\nNo hay cuentas cobradas en esa fecha.${tail}`;
  return `${head}\nTicket promedio: S/ ${(Number(r.sales || 0) / r.orders).toFixed(2)}.${tail}`;
}

/**
 * Pregunta de ventas filtrada por método de pago («ventas en efectivo», «sin efectivo», «con Yape»…).
 * @returns {'all'|'efectivo'|'noncash'|'yape'|'plin'|'tarjeta'|'online'|'transferencia'|null}
 */
function detectPaymentMethodFilter(message) {
  const m = String(message || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (!/venta|vend|cobr|pag|ingres|entr(o|aron|ado)|recaud|factur|total|cuanto|monto|recibi/.test(m)) return null;
  if (/\b(abrir|cerrar|arqueo|apertura|cierre)\b/.test(m) && !/venta|vend|cobrad/.test(m)) return null;

  const nonCash = /\b(sin|no|excepto|menos|salvo|aparte del?|fuera del?)\s+(el\s+|en\s+|con\s+)?efectivo\b/.test(m)
    || /\bque no (sea|sean|fue|fueron|es|son)( en| con)? efectivo\b/.test(m)
    || /\bdistint\w* (a|al|de|del) efectivo\b/.test(m)
    || /\b(pagos?|medios?|metodos?|cobros?|ventas?)\s+(digitales|electronic\w*)\b/.test(m);
  if (nonCash) return 'noncash';

  const found = [];
  if (/\befectivo\b|\bal contado\b/.test(m)) found.push('efectivo');
  if (/\byape\b/.test(m)) found.push('yape');
  if (/\bplin\b/.test(m)) found.push('plin');
  if (/\btarjetas?\b|\bvisa\b|\bmastercard\b/.test(m)) found.push('tarjeta');
  if (/\btransferencias?\b/.test(m)) found.push('transferencia');
  if (/\bonline\b|\ben linea\b/.test(m)) found.push('online');
  if (found.length === 1) return found[0];
  if (found.length > 1 || /\bpor (cada )?(metodo|forma|medio|tipo)( de pago)?\b|desglose.*pago/.test(m)) return 'all';
  return null;
}

const FORECAST_DOWS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const FORECAST_MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/**
 * Días pedidos en un pronóstico («hoy», «mañana», «pasado mañana», «próximo martes», «el domingo», «fin de semana», «10/10», «el 15»).
 * @returns {{ targets: Array<{offset:number}|{dow:number,next:boolean}|{day:number,month:number|null}>, days: number|null }}
 */
function detectForecastWhen(m) {
  const found = [];
  const add = (index, target) => found.push({ index, target });
  let rest = m;
  const take = (re, fn) => {
    rest = rest.replace(re, (...args) => {
      const match = args[0];
      const index = args[args.length - 2];
      fn(args, index);
      return ' '.repeat(match.length);
    });
  };
  take(/\bpasado manana\b/g, (_, i) => add(i, { offset: 2 }));
  take(/\besta manana\b/g, (_, i) => add(i, { offset: 0 }));
  take(/\b(por|en|de|a) la manana\b/g, () => {});
  take(/\bmanana\b/g, (_, i) => add(i, { offset: 1 }));
  take(/\bhoy\b/g, (_, i) => add(i, { offset: 0 }));
  take(/\bfin(es)? de semana\b/g, (_, i) => { add(i, { dow: 6, next: false }); add(i + 1, { dow: 0, next: false }); });
  take(/\b(?:(proxim\w*|siguiente)\s+)?(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b(\s+(que viene|proxim\w*|siguiente))?/g, (args, i) => {
    add(i, { dow: FORECAST_DOWS.indexOf(args[2]), next: Boolean(args[1] || args[3]) });
  });
  take(/\b(\d{1,2})\s*[/-]\s*(\d{1,2})\b/g, (args, i) => {
    const day = Number(args[1]);
    const month = Number(args[2]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) add(i, { day, month });
  });
  take(new RegExp(`\\b(?:el )?(?:dia )?(\\d{1,2}) de (${FORECAST_MONTHS.join('|')})\\b`, 'g'), (args, i) => {
    add(i, { day: Number(args[1]), month: FORECAST_MONTHS.indexOf(args[2]) + 1 });
  });
  take(/\bel (?:dia )?(\d{1,2})\b(?! (dias|semanas))/g, (args, i) => {
    const day = Number(args[1]);
    if (day >= 1 && day <= 31) add(i, { day, month: null });
  });

  let days = null;
  const nd = rest.match(/\b(?:proxim\w*|siguientes?)\s+(\d{1,2})\s+dias\b|\b(\d{1,2})\s+dias\s+(?:proxim\w*|siguientes?|que vienen)\b/);
  if (nd) days = Math.min(14, Math.max(1, Number(nd[1] || nd[2])));
  else if (/\b(proxim\w*|siguiente) semana\b|\bsemana que viene\b|\besta semana\b|\bproxim\w* dias\b/.test(rest)) days = 7;

  return { targets: found.sort((a, b) => a.index - b.index).map((f) => f.target), days };
}

/** Pronóstico / días cerrados / conveniencia de abrir un día. */
function detectForecastIntent(message) {
  const m = String(message || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[¿?¡!.,;:]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^como\b/.test(m)) return null;
  const dm = m.match(/\b(domingo|lunes|martes|miercoles|jueves|viernes|sabado)s?\b/);
  const dow = dm ? FORECAST_DOWS.indexOf(dm[1]) : null;

  if (/\b(que|cuales) dias? (cerr|cierr|no (se )?abr|descans)|\bdias? (de descanso|cerrad\w*|que no (se )?abr)|\bcuando (cerramos|cierro|cierran|descansamos)\b|no se abre (la )?caja/.test(m)) {
    return { kind: 'closed' };
  }
  const advice = /\b(conviene|deberia|vale la pena|es rentable|me conviene) (cerrar|abrir|atender)\b|\bcerrar (los|el|todos los) (domingo|lunes|martes|miercoles|jueves|viernes|sabado)/.test(m)
    || /\b(dia|dias) (mas )?(flojos?|malos?|peor(es)?)\b|\bpeor dia\b|\bque dia (se )?vend\w* menos\b/.test(m)
    || (dow != null && /\b(baj\w*|cae\w*|cay\w*|flojo\w*|menos|peor|malo\w*|rentab\w*|conviene)\b/.test(m) && !/pronostic|prepar/.test(m));
  if (advice) return { kind: 'advice', dow };

  const forecast = /pronostic|proyecc|prevision|\bprever\b|predic|\bproxim\w* (\d+ )?(dias|semana)|semana que viene|que (se )?(vendera|venderemos|va a vender|voy a vender|vamos a vender)|cuanto (vendere|venderemos|voy a vender|vamos a vender)|que (debo|tengo que|hay que|deberia|toca) preparar|\bque preparo\b|\bpreparar para\b|mise en place|que insumos (necesito|preparo|debo|hay que)/.test(m)
    || (dow != null && /\b(se vende\w*|venden|vendo|sale|salen|preparar|prepar\w*|esperar|espero)\b/.test(m));
  const when = detectForecastWhen(m);
  const futureRef = when.targets.some((t) => t.offset == null || t.offset > 0);
  const futureForecast = futureRef && /\b(se vende\w*|venderan|vendere\w*|venderia\w*|vendo|sale|saldra\w*|salen|esper\w*|habra|ira|iremos|va a ir)\b/.test(m);
  if (forecast || futureForecast) return { kind: 'forecast', dow, targets: when.targets, days: when.days };
  return null;
}

function buildForecastChatAnswer(message, user) {
  const intent = detectForecastIntent(message);
  if (!intent) return null;
  const showMoney = canUseTool(user, 'sales_summary');
  if (!showMoney && !canUseTool(user, 'top_products')) {
    return { reply: deniedToolMessage('sales_summary'), sources: [{ kind: 'tool', title: 'permission_denied' }] };
  }
  let reply;
  if (intent.kind === 'closed') reply = closedDaysAnswer();
  else if (intent.kind === 'advice') {
    if (!showMoney) return { reply: deniedToolMessage('sales_summary'), sources: [{ kind: 'tool', title: 'permission_denied' }] };
    reply = weekdayAdviceAnswer(intent.dow);
  } else {
    reply = forecastAnswer({ targets: intent.targets, days: intent.days, showMoney, includeStore: canUseTool(user, 'low_stock') });
  }
  return { reply, sources: [{ kind: 'tool', title: 'sales_forecast', focus: intent.kind }] };
}

function isCustomerAnalysisQuestion(m) {
  return /\bclientes?\b/.test(m)
    && /analiz|an[aá]lisis|recurrent|frecuent|fiel|mejores|top|qui[eé]n|cu[aá]nt|per[ií]odo|comportamiento|vuelven|nuevos|perfil|ticket|informe|resumen/.test(m)
    && !/c[oó]mo (registr|crea|agreg|a[nñ]ad)/.test(m);
}

function isCostAnalysisQuestion(m) {
  return /costo|coste|food\s*cost|margen|m[aá]rgenes|rentab|precio de compra|insumos? (de|por|en) (cada )?(producto|plato)|receta|maximizar (la )?ganancia|ganancias? por (plato|producto)|calidad de (los )?(plato|platillo)|ingenier[ií]a de men[uú]|mejorar (los )?(plato|platillo)|bajar costos|reducir costos/.test(m)
    && !/c[oó]mo (registr|crea|agreg|a[nñ]ad|vincul|configur)/.test(m);
}

/** Mensaje que es básicamente solo una fecha o período ("20/09", "el domingo", "ayer"). */
function isBarePeriodMessage(message) {
  const period = resolveSalesPeriod(message);
  if (!period.explicit) return null;
  const rest = String(message || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\d{1,4}([/.-]\d{1,2}){1,2}/g, ' ')
    .replace(/\b(y|el|la|los|las|del|de|al|a|en|dia|fecha|ultimo|ultima|penultimo|pasado|pasada|anterior|este|esta|hoy|ayer|anteayer|antier|hace|dias?|semanas?|mes(es)?|ano|fin|que|tal|como|fue|paso|me|dame|dime|muestra|ver|informe|reporte|resumen|domingo|lunes|martes|miercoles|jueves|viernes|sabado|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|entre|desde|hasta|\d+)\b/g, ' ')
    .replace(/[¿?¡!.,;:]/g, ' ')
    .trim();
  return rest.length === 0 ? period : null;
}

function isExplicitHowToMessage(message) {
  const m = String(message || '').toLowerCase().trim();
  return /^(c[oó]mo|como)\s+(marcar|cerrar|abrir|crear|configurar|registrar|cambiar|usar|hacer|poner|activar|desactivar|generar|imprimir|liberar|mover|anular|cobrar|pagar)/.test(m)
    || /\b(c[oó]mo|como)\s+(marcar|cerrar|abrir|crear|configurar|registrar|cambiar|usar)\b/.test(m)
    || (/cerrar\s+caja|abrir\s+caja/.test(m) && !/cu[aá]nto|vend[ií]|venta|demora|productividad|jornada|qui[eé]n/.test(m));
}

function formatLowStockReply(r) {
  if (!r.count) return 'No hay productos no transformables (bebidas, envasados, etc.) bajo su stock mínimo.';
  const lines = r.items.slice(0, 8).map((i) => `- ${i.name}: ${i.stock} (mín. ${i.min_stock})`);
  const more = r.count > lines.length ? `\n…y ${r.count - lines.length} más en Inventario.` : '';
  return `Stock bajo en productos no transformables (${r.count}):\n${lines.join('\n')}${more}`;
}

function isTopProductsQuestion(m) {
  if (/mesero|mozo|cajero/.test(m)) return false;
  return /(producto|plato|bebida|item|art[ií]culo)s?\b.*(m[aá]s\s+vend|se\s+vend\w*\s+m[aá]s|vend\w*\s+m[aá]s|m[aá]s\s+pedid|m[aá]s\s+sal|top)/.test(m)
    || /(qu[eé]|cu[aá]l(es)?)\s+(es\s+lo\s+que\s+)?se\s+vende\w*\s+m[aá]s|lo\s+m[aá]s\s+vendido|m[aá]s\s+vendid[oa]s?|top\s+(de\s+)?(producto|plato|venta)s?/.test(m);
}

function formatTopProductsList(r) {
  const lines = r.items.slice(0, 5).map((it, i) => {
    const money = it.revenue != null ? ` · S/ ${Number(it.revenue).toFixed(2)}` : '';
    return `${i + 1}. ${it.name} — ${it.qty} uds${money}`;
  });
  return lines.join('\n');
}

function topProductsAnswer(m, user) {
  const period = resolveSalesPeriod(m);
  const explicit = Boolean(period.explicit) && period.scope !== 'today';
  const args = explicit ? { from: period.from, to: period.to, limit: 5 } : { scope: 'day', limit: 5 };
  let r = runTool('top_products', args, user);
  if (r?.denied && r?.error) {
    return { chunks: [r.error], sources: [{ kind: 'tool', title: 'permission_denied' }] };
  }
  const shown = formatDisplayDateKey(r?.date);
  let label = explicit ? `(${period.label})` : `de hoy (${shown})`;
  if (r?.ok && !r.items?.length && !explicit) {
    const monthly = runTool('top_products', { scope: 'month', limit: 5 }, user);
    if (monthly?.ok && monthly.items?.length) {
      r = monthly;
      label = `del mes (${formatDisplayDateKey(monthly.date)}) — hoy aún no hay ventas cobradas`;
    }
  }
  if (!r?.ok) return null;
  if (!r.items?.length) {
    return {
      chunks: [`Aún no hay ventas cobradas ${label} para calcular los productos más vendidos.`],
      sources: [{ kind: 'tool', title: 'top_products' }],
    };
  }
  return {
    chunks: [`Productos más vendidos ${label}:\n${formatTopProductsList(r)}`],
    sources: [{ kind: 'tool', title: 'top_products' }],
  };
}

/** Respuestas cortas a datos en vivo (sin guiar a módulos). */
function tryDirectDataAnswer(message, user) {
  const m = String(message || '').toLowerCase();
  if (isExplicitHowToMessage(m)) return null;

  if (/encuesta/.test(m) && !isReportRequest(message) && !/c[oó]mo\s+(configurar|crear|armar|hacer|usar)|configurar la encuesta|descargar el qr|formato de la encuesta/.test(m)) {
    if (!isPlanModuleEnabled('fidelizacion')) {
      return {
        chunks: ['Fidelización no está activo en el plan de este negocio, así que no hay encuestas para mostrar.'],
        sources: [{ kind: 'tool', title: 'plan_module_off' }],
      };
    }
    if (!canUseTool(user, 'survey_insights')) {
      return {
        chunks: [deniedToolMessage('survey_insights')],
        sources: [{ kind: 'tool', title: 'permission_denied' }],
      };
    }
    const period = resolveNaturalPeriod(message, getBusinessTodayDateKey(queryOne), { defaultScope: 'month' });
    const survey = toolSurveyInsights(
      period.explicit ? period.from : null,
      period.explicit ? period.to : null,
    );
    if (survey?.text) {
      return {
        chunks: [survey.text],
        sources: [{ kind: 'tool', title: 'survey_insights' }],
      };
    }
  }

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

  const payFilter = detectPaymentMethodFilter(m);
  if (payFilter) {
    const r = runTool('sales_desk', { focus: 'method', method: payFilter, message }, user);
    const out = denyOrOk(r, 'sales_desk', 'method');
    if (out) return out;
  }

  if (/forma(s)? de pago|reparti.*(pago|yape|efectivo)|yape.*efectivo|efectivo.*yape|pagos \(yape|c[oó]mo se (pagan|cobran|repartieron)/.test(m)) {
    const r = runTool('sales_desk', { focus: 'payments', message }, user);
    const out = denyOrOk(r, 'sales_desk', 'payments');
    if (out) return out;
  }

  if (isCostAnalysisQuestion(m)) {
    const r = runTool('cost_insights', { message }, user);
    const out = denyOrOk(r, 'cost_insights');
    if (out) return out;
  }

  if (isCustomerAnalysisQuestion(m)) {
    const r = runTool('customer_insights', { message }, user);
    const out = denyOrOk(r, 'customer_insights');
    if (out) return out;
  }

  if (isTopProductsQuestion(m)) {
    return topProductsAnswer(m, user);
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
        chunks: [formatSalesReply(r, user)],
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
        chunks: [formatLowStockReply(r)],
        sources: [{ kind: 'tool', title: 'low_stock' }],
      };
    }
  }

  const barePeriod = isBarePeriodMessage(message);
  if (barePeriod) {
    const r = runTool('sales_summary', {
      scope: barePeriod.scope,
      from: barePeriod.from,
      to: barePeriod.to,
      label: barePeriod.label,
    }, user);
    if (r?.ok) {
      const chunks = [formatSalesReply(r, user)];
      const top = runTool('top_products', { from: barePeriod.from, to: barePeriod.to, limit: 3 }, user);
      if (top?.ok && top.items?.length) chunks.push(`Lo más vendido:\n${formatTopProductsList(top)}`);
      return { chunks: [chunks.join('\n\n')], sources: [{ kind: 'tool', title: 'sales_summary' }] };
    }
    const top = runTool('top_products', { from: barePeriod.from, to: barePeriod.to, limit: 5 }, user);
    if (top?.ok) {
      return {
        chunks: [top.items?.length
          ? `Lo más vendido (${barePeriod.label}):\n${formatTopProductsList(top)}`
          : `No hay ventas cobradas (${barePeriod.label}).`],
        sources: [{ kind: 'tool', title: 'top_products' }],
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
  if (['customer_insights', 'cost_insights'].includes(toolName)) {
    const r = runTool(toolName, { message }, user);
    if (r?.denied && r?.error) {
      chunks.push(r.error);
      sources.push({ kind: 'tool', title: 'permission_denied', learned: true });
      return true;
    }
    if (r?.ok && r.text) {
      chunks.push(r.text);
      sources.push({ kind: 'tool', title: toolName, learned: true });
      return true;
    }
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
        chunks.push(formatSalesReply(r, user));
      } else if (toolName === 'top_products' && r.items?.length) {
        const top = r.items[0];
        chunks.push(`Más vendido (${formatDisplayDateKey(r.date)}): ${top.name} (${top.qty} uds).`);
      } else if (toolName === 'low_stock') {
        chunks.push(formatLowStockReply(r));
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
      chunks.push(`Más vendido (${formatDisplayDateKey(r.date)}): ${top.name} (${top.qty} uds${top.revenue != null ? `, S/ ${Number(top.revenue).toFixed(2)}` : ''}).`);
      sources.push({ kind: 'tool', title: 'top_products' });
    }
  }
  return { chunks, sources };
}

function rememberSuccessfulIntent(message, sources) {
  try {
    const src = Array.isArray(sources) && sources[0] ? sources[0] : null;
    if (!src) return;
    if (['support_contact', 'report', 'report_hint', 'purchase_plan', 'business_advice', 'business_concept', 'sales_forecast'].includes(src.title)) return;
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

const MORE_DETAIL_RE = /^(m[aá]s detalles?|dame m[aá]s detalles?|ver (todo|completo|la respuesta completa)|respuesta completa|completa)[.!]?$/i;
/** Última respuesta completa por usuario cuando se resumió (estilo «respuestas cortas»). */
const LAST_FULL_REPLY = new Map();
const NO_PERSONALIZE = new Set(['user_memory', 'greeting', 'creator_mode', 'origin', 'permission_denied', 'support_contact']);

function shortenReply(text) {
  const paragraphs = String(text || '').split(/\n{2,}/);
  let short = paragraphs.slice(0, 2).join('\n\n');
  const lines = short.split('\n');
  if (lines.length > 8) short = lines.slice(0, 8).join('\n');
  return short.length <= String(text || '').length * 0.75 ? short : null;
}

/** Aplica lo que PIX recuerda del usuario: notas relacionadas, estilo de respuesta y temas frecuentes. */
function personalizeResult(user, query, result, memory) {
  const sources = Array.isArray(result.sources) ? result.sources : [];
  const title = sources[0]?.title || '';
  try {
    trackTopic(user.id, title);
  } catch (_) {
    /* opcional */
  }
  if (NO_PERSONALIZE.has(title)) return result;
  const isReport = sources.some((s) => s && (s.kind === 'report' || s.title === 'report' || s.report));
  let reply = String(result.reply || '');

  const fact = relevantFact(user.id, query);
  if (fact && !reply.includes(fact)) reply = `${reply}\n\nNota que me pediste recordar: ${fact}`;

  if (memory?.profile?.style === 'short' && !isReport && reply.length > 500) {
    const short = shortenReply(reply);
    if (short) {
      LAST_FULL_REPLY.set(String(user.id), { ...result, reply });
      reply = `${short}\n\n(Te lo resumí porque prefieres respuestas cortas. Escribe «más detalle» para verlo completo.)`;
    }
  }
  return { ...result, reply };
}

async function chat(user, message, context = {}) {
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

  const memory = recall(user.id);
  const detected = detectLanguage(text);
  const lang = memory.profile.lang === 'en' || memory.profile.lang === 'es' ? memory.profile.lang : detected;
  const query = detected === 'en' ? toSpanishQuery(text) : text;

  const memoryAnswer = handleMemoryCommand(user, text);
  if (memoryAnswer) {
    let out = memoryAnswer;
    if (lang === 'en' && !/^Got it/.test(out.reply)) out = translateResult(out, { isGuide: false });
    saveMessage(user.id, 'assistant', out.reply, out.sources);
    return { ...out, lang, mode: 'local', status: getStatus(), creator_mode: isMasterCreator(user) };
  }

  if (MORE_DETAIL_RE.test(text.trim())) {
    let full = LAST_FULL_REPLY.get(String(user.id)) || {
      reply: 'Esa ya fue la respuesta completa. ¿Quieres que te explique otra cosa?',
      sources: [{ kind: 'tool', title: 'user_memory' }],
    };
    LAST_FULL_REPLY.delete(String(user.id));
    if (lang === 'en') full = translateResult(full, { isGuide: false });
    saveMessage(user.id, 'assistant', full.reply, full.sources);
    return { ...full, lang, mode: 'local', status: getStatus(), creator_mode: isMasterCreator(user) };
  }

  const report = buildForecastChatAnswer(query, user)
    || buildConceptAnswer(query, user, { lang, analyzeFn: analyzeBusiness, periodFn: resolveAdvicePeriod })
    || buildPurchaseAnswer(query, user)
    || buildAdvisorAnswer(query, user, { lang })
    || buildReportAnswer(query, user);
  const support = report ? null : buildSupportAnswer(query, user, context, { originalMessage: text, lang });
  const prefetch = report || support ? { chunks: [] } : heuristicToolPrefetch(query, user);
  let result;
  if (report) {
    result = report;
  } else if (support) {
    result = support;
  } else if (prefetch.chunks.length) {
    result = {
      reply: prefetch.chunks.join('\n\n'),
      sources: prefetch.sources,
      options: Array.isArray(prefetch.options) ? prefetch.options : undefined,
    };
  } else {
    result = guidesOnlyReply(query, user);
    if (isMasterCreator(user) && result?.reply && /no encontr[eé] una gu[ií]a/i.test(result.reply)) {
      result = {
        reply:
          lang === 'en'
            ? "Mr. Romero, I couldn't find an exact guide for that. Could you give me more detail or ask me for a business figure?"
            : 'Sr. Romero, no encontré una guía exacta para eso. ¿Puede darme más detalle o pedirme un dato del negocio?',
        sources: [{ kind: 'tool', title: 'creator_mode' }],
      };
    }
  }
  rememberSuccessfulIntent(query, result.sources);
  result = personalizeResult(user, query, result, memory);
  if (lang === 'en') {
    const src = Array.isArray(result.sources) ? result.sources[0] : null;
    const isGuide = !!src && (src.kind === 'guide' || src.kind === 'config' || src.title === 'search_guides');
    result = translateResult(result, { isGuide });
  }
  saveMessage(user.id, 'assistant', result.reply, result.sources);
  return {
    ...result,
    lang,
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
  getChatDayInfo,
  bootstrapKnowledge,
  purgeFadeyAiChatIfNewDay,
};
