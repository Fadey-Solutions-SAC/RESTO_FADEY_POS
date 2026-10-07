/**
 * IA Fadey bilingüe: si el usuario escribe en inglés, se entiende la pregunta
 * (traducida a términos del POS en español) y la respuesta se devuelve en inglés
 * con Google Traductor. Si escribe en español, la respuesta se queda en español.
 * Sin internet, el inglés usa el diccionario local.
 */
const { translateEsToEn, translateManyEsToEn } = require('./fadeyAiGoogleTranslate');

const EN_WORDS = new Set([
  'the', 'what', 'how', 'is', 'are', 'was', 'were', 'my', 'me', 'i', 'you', 'your', 'do', 'does', 'did', 'can', 'could',
  'please', 'show', 'give', 'tell', 'today', 'yesterday', 'sales', 'sold', 'sell', 'report', 'reports', 'which', 'who',
  'where', 'when', 'why', 'this', 'last', 'week', 'month', 'year', 'best', 'top', 'products', 'customers', 'clients',
  'not', 'working', 'help', 'hello', 'hi', 'hey', 'printer', 'print', 'support', 'much', 'many', 'of', 'for',
  'with', 'and', 'on', 'in', 'to', 'from', 'about', 'there', 'any', 'have', 'has', 'need', 'want', 'download', 'staff',
  'inventory', 'costs', 'margin', 'margins', 'orders', 'order', 'table', 'tables', 'kitchen', 'waiter', 'waiters',
  'cash', 'register', 'open', 'close', 'create', 'doesnt', "doesn't", "can't", 'cannot', "won't", 'it', 'an', 'a',
  'good', 'morning', 'afternoon', 'evening', 'thanks', 'thank', 'sunday', 'monday', 'tuesday', 'wednesday',
  'thursday', 'friday', 'saturday', 'low', 'stock', 'pending', 'payment', 'methods', 'delays', 'productivity',
  'non', 'cashless', 'card', 'cards', 'transfer', 'payments', 'breakdown', 'paid', 'collected', 'by',
  'forecast', 'predict', 'prepare', 'prep', 'closed', 'next', 'days', 'should', 'worth', 'will', 'we',
  'sundays', 'mondays', 'tuesdays', 'wednesdays', 'thursdays', 'fridays', 'saturdays', 'slowest', 'dropping',
]);

const ES_WORDS = new Set([
  'el', 'la', 'los', 'las', 'de', 'del', 'que', 'como', 'cuanto', 'cuantos', 'cuantas', 'ventas', 'venta', 'vendi',
  'hoy', 'ayer', 'informe', 'reporte', 'por', 'para', 'mis', 'mi', 'un', 'una', 'es', 'son', 'me', 'hola', 'mes',
  'semana', 'ano', 'productos', 'clientes', 'no', 'funciona', 'deja', 'puedo', 'ayuda', 'soporte', 'impresora',
  'caja', 'mesa', 'mesas', 'pedido', 'cocina', 'quien', 'donde', 'cual', 'hay', 'esta', 'este', 'y', 'o', 'en', 'con',
  'dame', 'dime', 'muestra', 'quiero', 'necesito', 'gracias', 'buenos', 'buenas', 'dias', 'tardes', 'noches',
  'domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'stock', 'bajo', 'personal', 'costos',
]);

function normalize(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** 'en' si el mensaje está claramente en inglés; en caso de duda, 'es'. */
function detectLanguage(message) {
  const raw = String(message || '');
  if (/[ñ¿¡áéíóú]/i.test(raw)) return 'es';
  const words = normalize(raw).replace(/[^a-z0-9'\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return 'es';
  let en = 0;
  let es = 0;
  for (const w of words) {
    if (EN_WORDS.has(w)) en += 1;
    if (ES_WORDS.has(w)) es += 1;
  }
  if (words.length === 1 && EN_WORDS.has(words[0]) && !ES_WORDS.has(words[0])) return 'en';
  return en > es && en >= 1 ? 'en' : 'es';
}

/* ───────────── Opciones rápidas (ida y vuelta exacta) ───────────── */

const OPTION_PAIRS = [
  ['¿Cómo cobrar una mesa?', 'How do I charge a table?'],
  ['¿Cómo cerrar caja?', 'How do I close the cash register?'],
  ['¿Cómo tomar un pedido en mesa?', 'How do I take a table order?'],
  ['¿Cómo realizar un pedido?', 'How do I place an order?'],
  ['¿Cómo mover un pedido de mesa?', 'How do I move an order to another table?'],
  ['¿Cuánto vendí hoy?', 'How much did I sell today?'],
  ['¿Hay demoras en cocina?', 'Are there kitchen delays?'],
  ['¿Hay stock bajo?', 'Is there low stock?'],
  ['¿Quién está en jornada ahora?', 'Who is on shift now?'],
  ['¿Cómo marcar asistencia con QR?', 'How do I clock in with QR?'],
  ['¿Cómo gestionar delivery?', 'How do I manage delivery?'],
  ['¿Cómo crear una reserva?', 'How do I create a reservation?'],
  ['¿Cómo crear un usuario?', 'How do I create a user?'],
  ['¿Cómo hacer un requerimiento?', 'How do I make a stock request?'],
  ['¿Qué puedo hacer en el POS?', 'What can I do in the POS?'],
  ['Descargar en Excel', 'Download Excel'],
  ['Descargar en PDF', 'Download PDF'],
];

/* ───────────── Inglés → consulta en español ───────────── */

const EN_TO_ES_QUERY = [
  [/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)s\b/g, '$1'],
  [/\b(sales )?(forecast(ing)?|predict(ion)?s?|projections?)\b/g, 'pronostico'],
  [/\bnext (\d+ )?days\b/g, 'proximos $1dias'],
  [/\bday after tomorrow\b/g, 'pasado manana'],
  [/\btomorrow\b/g, 'manana'],
  [/\b(next|coming) (sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/g, 'proximo $2'],
  [/\b(next|coming|upcoming) week\b/g, 'proxima semana'],
  [/\bwhat (should|do|must) (i|we) (prepare|prep)\b|\bwhat to (prepare|prep)\b/g, 'que debo preparar'],
  [/\b(prepare|prep) for\b/g, 'preparar para'],
  [/\b(which|what) days? (are|do) (we|you) (close|closed|off)\b|\b(which|what) days? (is|are) (it|we) closed\b/g, 'que dias cerramos'],
  [/\b(closed days|days off|rest days?)\b/g, 'dias de descanso'],
  [/\b(should|must) (i|we) close( on)?\b/g, 'conviene cerrar'],
  [/\b(should|must) (i|we) open( on)?\b/g, 'conviene abrir'],
  [/\b(is it )?worth (opening|open)( on)?\b/g, 'conviene abrir'],
  [/\b(slowest|worst|weakest) days?\b/g, 'peor dia'],
  [/\b(dropping|declining|going down|falling|decreasing|lower)\b/g, 'bajan'],
  [/\bwhat (sells|will sell|do we sell|do i sell)\b/g, 'que se vende'],
  [/\bhow much will (i|we) sell\b/g, 'cuanto venderemos'],
  [/\b(is not|isn'?t|does not|doesn'?t|won'?t|will not|can'?t|cannot|not) (print|printing)\b/g, 'no imprime'],
  [/\b(is not|isn'?t|does not|doesn'?t|won'?t|not) (work|working|load|loading|open|opening)\b/g, 'no funciona'],
  [/\bwhat (is|are)\b/g, 'que es'],
  [/\bwhat does (.+?) mean\b/g, 'que significa $1'],
  [/\bhow (do|can|should) (i|we|you) calculate\b/g, 'como calcular'],
  [/\bhow is (.+?) calculated\b/g, 'como se calcula $1'],
  [/\bcalculat\w*\b/g, 'calcular'],
  [/\bformula\b/g, 'formula'],
  [/\bbreak[- ]?even( point)?\b/g, 'punto de equilibrio'],
  [/\bfixed (costs?|expenses)\b/g, 'costos fijos'],
  [/\bcontribution margin\b/g, 'margen de contribucion'],
  [/\baverage (ticket|check|spend)\b/g, 'ticket promedio'],
  [/\bnet sales\b/g, 'ventas netas'],
  [/\bgross sales\b/g, 'ventas brutas'],
  [/\bcancel+ation rate\b/g, 'tasa de cancelacion'],
  [/\blabou?r cost\b/g, 'costo laboral'],
  [/\binventory turnover\b/g, 'rotacion de inventario'],
  [/\b(days of inventory|inventory days)\b/g, 'dias de inventario'],
  [/\breorder point\b/g, 'punto de reposicion'],
  [/\bsafety stock\b/g, 'stock de seguridad'],
  [/\binventory (difference|variance)\b/g, 'diferencia de inventario'],
  [/\btable (occupancy|turnover)\b/g, 'ocupacion de mesas'],
  [/\bcash flow\b/g, 'flujo de caja'],
  [/\bmenu engineering\b/g, 'ingenieria de menu'],
  [/\brecipe cost(ing)?\b/g, 'costo de receta'],
  [/\bmarkup\b/g, 'recargo'],
  [/\b(upsell\w*|cross[- ]?sell\w*)\b/g, 'venta complementaria'],
  [/\bpercentage change\b/g, 'variacion porcentual'],
  [/\bshopping list|purchase list|buying list\b/g, 'lista de compras'],
  [/\bsell more\b/g, 'vender mas'],
  [/\b(make|earn) more( money)?\b/g, 'ganar mas'],
  [/\b(improve|boost|increase|grow|raise|maximize)\b/g, 'mejorar'],
  [/\b(profits?|earnings|income|revenue)\b/g, 'ganancias'],
  [/\b(tips|ideas|advice|strategy|strategies)\b/g, 'consejos'],
  [/\bbusiness\b/g, 'negocio'],
  [/\b(should|do|must|need to) (i|we) (buy|order|restock|purchase|reorder)\b/g, 'debo comprar'],
  [/\bto (buy|restock|reorder|purchase)\b/g, 'por comprar'],
  [/\bhow much did (i|we) (sell|make)\b/g, 'cuanto vendi'],
  [/\bhow much\b/g, 'cuanto'],
  [/\bhow many\b/g, 'cuantos'],
  [/\b(best[- ]?sell(ers|ing)?|top[- ]selling|most sold|most ordered)\b/g, 'mas vendidos'],
  [/\btop products?\b/g, 'productos mas vendidos'],
  [/\bsales report\b/g, 'informe de ventas'],
  [/\b(reports?|dashboard)\b/g, 'informe'],
  [/\b(charts?|graphs?|statistics|stats)\b/g, 'graficos'],
  [/\bday before yesterday\b/g, 'anteayer'],
  [/\byesterday\b/g, 'ayer'],
  [/\btoday\b/g, 'hoy'],
  [/\bthis week\b/g, 'esta semana'],
  [/\blast week\b/g, 'semana pasada'],
  [/\bthis month\b/g, 'este mes'],
  [/\blast month\b/g, 'mes pasado'],
  [/\bthis year\b/g, 'este ano'],
  [/\b(for|of|in|during|so far this) the month\b|\bmonth[- ]to[- ]date\b|\bmtd\b|\bmonthly\b/g, 'este mes'],
  [/\b(for|of|in|during) the week\b|\bweek[- ]to[- ]date\b|\bweekly\b/g, 'esta semana'],
  [/\b(for|of|in|during) the year\b|\byear[- ]to[- ]date\b|\bytd\b/g, 'este ano'],
  [/\b(for|of|in|during) the day\b|\bso far today\b/g, 'hoy'],
  [/\blast (\d+) days\b/g, 'ultimos $1 dias'],
  [/\b(\d+) days ago\b/g, 'hace $1 dias'],
  [/\bweekend\b/g, 'fin de semana'],
  [/\blast (sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/g, 'ultimo $1'],
  [/\bthis (sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/g, 'este $1'],
  [/\bsunday\b/g, 'domingo'], [/\bmonday\b/g, 'lunes'], [/\btuesday\b/g, 'martes'], [/\bwednesday\b/g, 'miercoles'],
  [/\bthursday\b/g, 'jueves'], [/\bfriday\b/g, 'viernes'], [/\bsaturday\b/g, 'sabado'],
  [/\bjanuary\b/g, 'enero'], [/\bfebruary\b/g, 'febrero'], [/\bmarch\b/g, 'marzo'], [/\bapril\b/g, 'abril'],
  [/\bmay\b/g, 'mayo'], [/\bjune\b/g, 'junio'], [/\bjuly\b/g, 'julio'], [/\baugust\b/g, 'agosto'],
  [/\bseptember\b/g, 'septiembre'], [/\boctober\b/g, 'octubre'], [/\bnovember\b/g, 'noviembre'], [/\bdecember\b/g, 'diciembre'],
  [/\bon the (\d{1,2})(st|nd|rd|th)?\b/g, 'el $1'],
  [/\bthe (\d{1,2})(st|nd|rd|th)\b/g, 'el $1'],
  [/\bfrom (\S+) to (\S+)\b/g, 'del $1 al $2'],
  [/\b(by|per|for each|broken down by) (payment )?(methods?|type)\b/g, 'por metodo de pago'],
  [/\bpayment methods?\b/g, 'formas de pago'],
  [/\bcash (register|drawer|box)\b/g, 'caja'],
  [/\b(non[- ]?cash|cashless|not (in |by |with )?cash|other than cash|without cash|except cash|excluding cash)\b/g, 'sin efectivo'],
  [/\b(digital|electronic) (payments?|sales)\b/g, 'pagos digitales'],
  [/\b(in |by |with )?cash\b/g, ' efectivo'],
  [/\b(credit |debit )?cards?\b/g, 'tarjeta'],
  [/\b(bank )?transfers?\b/g, 'transferencia'],
  [/\bpayments?\b/g, 'pagos'],
  [/\bmonths?\b/g, 'mes'],
  [/\bweeks?\b/g, 'semana'],
  [/\byears?\b/g, 'ano'],
  [/\b(pending|unpaid)( payments?| bills?| accounts?)?\b/g, 'pendiente de cobro'],
  [/\bwho is (working|on shift|clocked in)\b/g, 'quien esta en jornada'],
  [/\bon shift\b/g, 'en jornada'],
  [/\bkitchen delays?\b/g, 'demoras en cocina'],
  [/\bdelays?\b/g, 'demoras'],
  [/\bproductivity\b/g, 'productividad'],
  [/\blow stock\b/g, 'stock bajo'],
  [/\b(inventory|warehouse)\b/g, 'inventario'],
  [/\b(customers?|clients?|guests?)\b/g, 'clientes'],
  [/\b(costs?|food cost)\b/g, 'costos'],
  [/\b(margins?|profitability|profit)\b/g, 'margen'],
  [/\b(staff|employees?|workers?|team)\b/g, 'personal'],
  [/\bwaiters?\b/g, 'meseros'],
  [/\bproducts?\b/g, 'productos'],
  [/\bdishes\b/g, 'platos'],
  [/\bsales\b/g, 'ventas'],
  [/\bsold\b/g, 'vendi'],
  [/\b(doesn'?t|does not|isn'?t|is not) work(ing)?\b/g, 'no funciona'],
  [/\bnot working\b/g, 'no funciona'],
  [/\b(won'?t|will not) let me\b/g, 'no me deja'],
  [/\b(can'?t|cannot|unable to)\b/g, 'no puedo'],
  [/\b(doesn'?t|does not|won'?t) print\b/g, 'no imprime'],
  [/\b(doesn'?t|does not|won'?t) load\b/g, 'no carga'],
  [/\b(doesn'?t|does not|won'?t) connect\b/g, 'no conecta'],
  [/\b(crash(es|ed)?|freez(es|ing)|stuck|hangs?)\b/g, 'se cuelga'],
  [/\bblank screen\b/g, 'pantalla en blanco'],
  [/\bslow\b/g, 'lento'],
  [/\b(errors?|bug|issue|problem)\b/g, 'error'],
  [/\bprint(er|ing)?\b/g, 'impresora'],
  [/\b(invoice|receipt|e-?invoice)s?\b/g, 'comprobante'],
  [/\bcash register\b/g, 'caja'],
  [/\b(register|checkout|cashier)\b/g, 'caja'],
  [/\b(tech(nical)? )?support\b/g, 'soporte'],
  [/\b(log ?in|sign ?in|password)\b/g, 'iniciar sesion contrasena'],
  [/\b(reservations?|bookings?)\b/g, 'reserva'],
  [/\bkitchen\b/g, 'cocina'],
  [/\btables?\b/g, 'mesa'],
  [/\borders?\b/g, 'pedido'],
  [/\b(settings?|configuration)\b/g, 'configuracion'],
  [/\bwhat can i do\b/g, 'que puedo hacer'],
  [/\bwho (created|made|built) you\b/g, 'quien te creo'],
  [/\bwho are you\b/g, 'quien eres'],
  [/\bhow (do|can|to|should) (i|we)?\s*/g, 'como '],
  [/\bhow to\b/g, 'como'],
  [/\b(create|add|new)\b/g, 'crear'],
  [/\bopen\b/g, 'abrir'],
  [/\bclose\b/g, 'cerrar'],
  [/\b(charge|pay)\b/g, 'cobrar'],
  [/\bmove\b/g, 'mover'],
  [/\bdownload\b/g, 'descargar'],
  [/^(hello|hi|hey|good (morning|afternoon|evening))\b/g, 'hola'],
  [/\b(what|which)\b/g, 'que'],
];

function toSpanishQuery(message) {
  const raw = String(message || '').trim();
  const option = OPTION_PAIRS.find(([, en]) => en.toLowerCase() === raw.toLowerCase());
  if (option) return option[0];
  let q = normalize(raw).replace(/[?!]+/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [re, rep] of EN_TO_ES_QUERY) q = q.replace(re, rep);
  return q.replace(/\s+/g, ' ').trim();
}

/**
 * Preguntas mixtas o con typos («eoeal cash ventas», «non-cash for the month»)
 * se pliegan a español antes de buscar el dato. No toca frases que no hablen de ventas.
 */
function prepareSalesQuery(message) {
  let m = String(message || '');
  m = m.replace(/\b(eoeal|eoetal|totla|toatl|totol|totl|totaal|ttal|totsl|totall|toal)\b/gi, 'total');
  const looksSales = /venta|vend|cobr|pag|total|cuanto|monto|sales|sold|cash|efectivo|mes|month/i.test(m);
  if (!looksSales) return m.replace(/\s+/g, ' ').trim();
  m = m.replace(/\bcash (register|drawer|box)\b/gi, 'caja');
  m = m.replace(/\bnon[-\s]?cash\b/gi, 'sin efectivo');
  m = m.replace(/\bcashless\b/gi, 'sin efectivo');
  m = m.replace(/\b(without|except|excluding|not)\s+(in\s+|by\s+|with\s+)?cash\b/gi, 'sin efectivo');
  m = m.replace(/\bother than cash\b/gi, 'sin efectivo');
  m = m.replace(/\b(in|by|with)\s+cash\b/gi, 'en efectivo');
  m = m.replace(/\bcash\b/gi, 'efectivo');
  m = m.replace(/\b(for|of|in|during)\s+(the|this)\s+month\b/gi, 'este mes');
  m = m.replace(/\bthis month\b/gi, 'este mes');
  m = m.replace(/\bfor the month\b/gi, 'este mes');
  return m.replace(/\s+/g, ' ').trim();
}

/* ───────────── Español → inglés (respuestas) ───────────── */

const ES_TO_EN = [
  // Saludos / identidad
  ['Soy PIX, tu asistente IA Fadey.', "I'm PIX, your Fadey AI assistant."],
  ['Solo te guío en los módulos y acciones que tienes permitidos en el POS.', 'I only guide you through the modules and actions you are allowed to use in the POS.'],
  ['Elige una opción o escríbeme tu consulta.', 'Pick an option or type your question.'],
  ['Opciones rápidas:', 'Quick options:'],
  ['Como administrador puedes consultar todos los módulos del POS.', 'As an administrator you can use every POS module.'],
  ['Aún no tienes módulos POS asignados; solo puedo ayudarte con lo básico (login, asistencia).', "You don't have POS modules assigned yet; I can only help with the basics (login, attendance)."],
  ['Según tus permisos, te ayudo con:', 'Based on your permissions, I can help with:'],
  ['Puedo darte pasos e información solo de lo que tienes permitido.', 'I can only give you steps and information for what you are allowed to do.'],
  ['Módulos activos:', 'Active modules:'],
  ['Tus módulos activos:', 'Your active modules:'],
  ['No tienes módulos POS activos.', "You don't have active POS modules."],
  ['Pertenezco a la empresa Fadey Solutions. Mi principal desarrollador es el Sr. Romero. Soy PIX, la IA Fadey del POS.', 'I belong to Fadey Solutions. My lead developer is Mr. Romero. I am PIX, the Fadey AI of the POS.'],
  ['Pertenezco a la empresa Fadey Solutions. Mi principal desarrollador es el Sr. Romero. Soy PIX, la IA Fadey del POS Resto Fadey, y estoy a sus órdenes.', 'I belong to Fadey Solutions. My lead developer is Mr. Romero. I am PIX, the Fadey AI of the Resto Fadey POS, at your service.'],
  ['Soy PIX, la IA Fadey del POS Resto Fadey. Pertenezco a Fadey Solutions; mi principal desarrollador es el Sr. Romero. Estoy a sus órdenes.', 'I am PIX, the Fadey AI of the Resto Fadey POS. I belong to Fadey Solutions; my lead developer is Mr. Romero. At your service.'],
  ['Hola, Sr. Romero. Estoy operativa y a sus órdenes.', 'Hello, Mr. Romero. I am up and running and at your service.'],
  ['Puedo ayudarlo con el negocio, el equipo, demoras, stock y el control del sistema.', 'I can help you with the business, the team, delays, stock and system control.'],
  ['¿En qué puedo ayudarlo?', 'How can I help you?'],
  ['No tienes permiso para ver esa información.', "You don't have permission to see that information."],
  ['Requiere acceso a:', 'Requires access to:'],
  ['Pide al administrador que active el módulo en tus permisos.', 'Ask your administrator to enable the module in your permissions.'],
  ['Pide al administrador que te asigne el permiso.', 'Ask your administrator to grant you the permission.'],
  ['No encontré una guía exacta dentro de tus módulos. Prueba preguntar con más detalle o escribe «¿qué puedo hacer?».', "I couldn't find an exact guide within your modules. Try asking in more detail or type “what can I do?”."],
  ['Si es un error del sistema, descríbelo (por ejemplo «error al imprimir») o escribe «soporte» y te preparo el mensaje para el equipo técnico.', 'If it is a system error, describe it (for example “printing error”) or type “support” and I will prepare the message for the technical team.'],

  // Ventas
  ['No hay cuentas cobradas en esa fecha.', 'There are no paid accounts on that date.'],
  ['Ticket promedio', 'Average ticket'],
  ['Productos más vendidos', 'Best-selling products'],
  ['Lo más vendido', 'Best sellers'],
  ['hoy aún no hay ventas cobradas', 'no paid sales yet today'],
  ['Aún no hay ventas cobradas', 'There are no paid sales yet'],
  ['para calcular los productos más vendidos.', 'to calculate the best-selling products.'],
  ['No hay ventas cobradas', 'No paid sales'],
  ['Escritorio de ventas', 'Sales desk'],
  ['Pendiente de cobro', 'Pending collection'],
  ['Formas de pago (cobrado):', 'Payment methods (collected):'],
  ['Pronóstico de los próximos', 'Forecast for the next'],
  [' días**', ' days**'],
  ['Pronóstico para', 'Forecast for'],
  ['Venta esperada:', 'Expected sales:'],
  ['pedido(s)', 'order(s)'],
  ['cerrado (no se abre caja normalmente)', 'closed (register is not usually opened)'],
  ['Prepara para', 'Prepare for'],
  ['suele salir:', 'usually sells:'],
  ['no alcanza — tienes', 'not enough — you have'],
  [', se necesitan ~', ', need ~'],
  ['te queda poco —', 'running low —'],
  [' para ~', ' for ~'],
  ['Prepara los insumos de:', 'Prepare the ingredients for:'],
  ['(sin receta vinculada)', '(no linked recipe)'],
  ['Almacén (administrador)', 'Storage (administrator)'],
  ['se venden ~', 'sells ~'],
  ['— reponer:', '— restock:'],
  ['no alcanza — stock', 'not enough — stock'],
  ['ya bajo su mínimo', 'already below its minimum'],
  ['justo en su mínimo', 'right at its minimum'],
  ['→ repón ~', '→ restock ~'],
  ['(hasta su máximo', '(up to its maximum'],
  ['quedaría bajo su mínimo tras vender ~', 'would drop below its minimum after selling ~'],
  ['Almacén sin stock suficiente:', 'Storage without enough stock:'],
  ['Almacén bajo mínimo (stock/mín.):', 'Storage below minimum (stock/min.):'],
  ['se esperan ~', 'expected ~'],
  ['(solo', '(only'],
  ['Los domingos', 'Sundays'], ['Los lunes', 'Mondays'], ['Los martes', 'Tuesdays'], ['Los miércoles', 'Wednesdays'],
  ['Los jueves', 'Thursdays'], ['Los viernes', 'Fridays'], ['Los sábados', 'Saturdays'],
  ['los domingos', 'Sundays'], ['los lunes', 'Mondays'], ['los martes', 'Tuesdays'], ['los miércoles', 'Wednesdays'],
  ['los jueves', 'Thursdays'], ['los viernes', 'Fridays'], ['los sábados', 'Saturdays'],
  ['Cocina', 'Kitchen'],
  ['Día más fuerte:', 'Strongest day:'],
  ['Días que normalmente no se abre caja (local cerrado):', 'Days the register is not usually opened (closed):'],
  ['No los cuento en el pronóstico.', 'I leave them out of the forecast.'],
  ['vs mes anterior', 'vs previous month'],
  ['Cálculo: promedio de cada día de la semana en las últimas', 'Calculation: average of each weekday over the last'],
  ['semana(s), dando más peso al último mes. ↑ = se vende más de lo normal ese día.', 'week(s), weighting the last month more. ↑ = sells more than usual that day.'],
  ['Aún no tengo suficiente historial para pronosticar (necesito al menos 7 días con caja abierta y ventas). Sigue registrando ventas y vuelve a preguntarme.', "I don't have enough history to forecast yet (I need at least 7 days with an open register and sales). Keep recording sales and ask me again."],
  ['Normalmente los', 'Usually on'],
  ['no se abre caja (el local cierra), así que no espero ventas.', 'the register is not opened (closed), so I expect no sales.'],
  ['Según el historial de caja, normalmente no se abre los', 'According to the register history, it is usually not opened on'],
  ['abiertos', 'open'],
  ['Esos días no los cuento al pronosticar ventas ni al pedirte preparar insumos.', 'I leave those days out of sales forecasts and prep reminders.'],
  ['No detecto un día fijo de descanso: se abrió caja todos los días de la semana en el período analizado.', 'I see no fixed day off: the register was opened every weekday in the analyzed period.'],
  ['Período analizado:', 'Analyzed period:'],
  ['Venta promedio por día (último mes)', 'Average sales per day (last month)'],
  ['venden en promedio', 'sell on average'],
  ['de un día normal de', 'of a normal day of'],
  ['y vienen bajando', 'and have been dropping'],
  ['frente al mes anterior', 'compared to the previous month'],
  ['Si abrir ese día te cuesta más de lo que deja (personal, luz, gas, merma), conviene evaluar cerrar los', 'If opening that day costs more than it brings in (staff, power, gas, waste), consider closing on'],
  ['o abrir medio turno.', 'or opening half a shift.'],
  ['Ningún día abierto vende tan poco como para recomendarte cerrarlo; refuerza el más flojo con promociones.', 'No open day sells low enough to recommend closing it; boost the slowest one with promotions.'],
  ['último mes:', 'last month:'],
  ['por día', 'per day'],
  ['Mes anterior:', 'Previous month:'],
  ['Recomendación:', 'Recommendation:'],
  ['evalúa cerrar los', 'consider closing on'],
  ['No conviene cerrar: los', 'Closing is not advisable:'],
  ['se mantienen dentro de lo normal.', 'stay within normal levels.'],
  ['ya figuran como cerrados (no se abre caja normalmente).', 'already show as closed (register is not usually opened).'],
  ['Día más flojo', 'Slowest day'],
  ['pasado mañana', 'the day after tomorrow'],
  ['mañana', 'tomorrow'],
  ['Mañana', 'Tomorrow'],
  ['Hoy', 'Today'],
  ['domingos', 'Sundays'], ['sábados', 'Saturdays'],
  ['Ventas por método de pago', 'Sales by payment method'],
  ['Ventas en efectivo', 'Cash sales'],
  ['Ventas sin efectivo', 'Non-cash sales'],
  ['Ventas con', 'Sales with'],
  ['No hay cuentas cobradas en ese período.', 'There are no paid accounts in that period.'],
  ['Representa el', 'That is'],
  ['del total cobrado', 'of total collected'],
  ['Detalle por método:', 'Breakdown by method:'],
  ['Total cobrado:', 'Total collected:'],
  ['cuenta(s) multimétodo', 'multi-method account(s)'],
  [': cada parte se sumó a su método con el monto exacto.', ': each part was added to its method with the exact amount.'],
  ['Incluye', 'Includes'],
  ['Sin cobros con forma de pago en este período.', 'No payments recorded in this period.'],
  ['Top meseros:', 'Top waiters:'],
  ['Sin ventas por mesero en este período.', 'No sales by waiter in this period.'],
  ['Cobrado:', 'Collected:'],
  ['Anuladas:', 'Voided:'],
  ['Stock bajo en productos no transformables', 'Low stock in non-prepared products'],
  ['No hay productos no transformables (bebidas, envasados, etc.) bajo su stock mínimo.', 'No non-prepared products (drinks, packaged goods, etc.) are below their minimum stock.'],
  ['más en Inventario.', 'more in Inventory.'],
  ['En jornada ahora', 'On shift now'],
  ['Nadie con jornada abierta en este momento.', 'Nobody is on shift right now.'],

  // Informes
  ['Informe de ventas', 'Sales report'],
  ['Informe de productos', 'Products report'],
  ['Informe de clientes', 'Customers report'],
  ['Informe de personal', 'Staff report'],
  ['Informe de costos y márgenes', 'Costs and margins report'],
  ['Informe de inventario', 'Inventory report'],
  ['Lo más importante', 'Key takeaways'],
  ['¿Deseas descargar el informe? Elige **Excel** o **PDF** (incluye gráficos y todo el detalle).', 'Would you like to download the report? Choose **Excel** or **PDF** (includes charts and full detail).'],
  ['No encontré datos para este período. Prueba con otro rango, por ejemplo «informe de ventas del mes pasado».', 'I found no data for this period. Try another range, for example “sales report last month”.'],
  ['Primero pídeme el informe, por ejemplo «informe de ventas de este mes» o «reporte de productos de la semana pasada». Luego te pregunto si lo quieres en Excel o PDF.', 'First ask me for the report, for example “sales report this month” or “products report last week”. Then I will ask if you want it in Excel or PDF.'],
  ['vs período anterior', 'vs previous period'],
  ['frente al período anterior', 'compared to the previous period'],
  ['Ventas cobradas', 'Paid sales'],
  ['Pendiente de cobro', 'Pending collection'],
  ['Comandas despachadas (producción)', 'Dispatched tickets (production)'],
  ['Comandas despachadas', 'Dispatched tickets'],
  ['Comandas', 'Kitchen tickets'],
  ['Anuladas', 'Voided'],
  ['Ventas por día', 'Sales by day'],
  ['Ventas por mes', 'Sales by month'],
  ['Ventas por hora', 'Sales by hour'],
  ['Ventas por mesero', 'Sales by waiter'],
  ['Ventas por canal', 'Sales by channel'],
  ['Ventas por producto', 'Sales by product'],
  ['Ventas por categoría', 'Sales by category'],
  ['Ventas de productos', 'Product sales'],
  ['Top 10 productos (S/)', 'Top 10 products (S/)'],
  ['Top 10 por ventas (S/)', 'Top 10 by sales (S/)'],
  ['Top 10 por unidades', 'Top 10 by units'],
  ['Top 10 clientes por gasto', 'Top 10 customers by spend'],
  ['Top 10 por ganancia (S/)', 'Top 10 by profit (S/)'],
  ['Mayor % de costo', 'Highest cost %'],
  ['Gasto por insumo', 'Spend by ingredient'],
  ['Mayor valor en inventario', 'Highest inventory value'],
  ['Stock bajo: actual vs mínimo', 'Low stock: current vs minimum'],
  ['Valor: productos vs insumos', 'Value: products vs ingredients'],
  ['Cuentas por día de la semana', 'Accounts by weekday'],
  ['Cuentas por hora', 'Accounts by hour'],
  ['Cuentas por canal', 'Accounts by channel'],
  ['Cuentas por mesero', 'Accounts by waiter'],
  ['Cuentas atendidas', 'Accounts served'],
  ['Clientes identificados', 'Identified customers'],
  ['% cuentas identificadas', '% identified accounts'],
  ['Clientes recurrentes', 'Returning customers'],
  ['Mejores clientes', 'Best customers'],
  ['Clientes por día de la semana', 'Customers by weekday'],
  ['Personal con ventas', 'Staff with sales'],
  ['Ventas atribuidas', 'Attributed sales'],
  ['Desempeño de meseros', 'Waiter performance'],
  ['Producción (comandas despachadas)', 'Production (dispatched tickets)'],
  ['Min. prom. de salida', 'Avg. minutes to dispatch'],
  ['Ventas analizadas', 'Analyzed sales'],
  ['Costo de lo vendido', 'Cost of goods sold'],
  ['Margen bruto', 'Gross margin'],
  ['Costo / ventas', 'Cost / sales'],
  ['Food cost (platos)', 'Food cost (dishes)'],
  ['Productos sin costo', 'Products without cost'],
  ['Costos y márgenes por producto', 'Costs and margins by product'],
  ['Costo desde', 'Cost source'],
  ['Margen unit.', 'Unit margin'],
  ['Costo %', 'Cost %'],
  ['Valor productos', 'Products value'],
  ['Valor insumos', 'Ingredients value'],
  ['Productos con stock bajo', 'Products with low stock'],
  ['Insumos con stock bajo', 'Ingredients with low stock'],
  ['Productos (stock)', 'Products (stock)'],
  ['Insumos (stock)', 'Ingredients (stock)'],
  ['Unidades vendidas', 'Units sold'],
  ['Productos distintos', 'Distinct products'],
  ['Peso del top 10', 'Top 10 share'],
  ['Formas de pago', 'Payment methods'],
  ['Stock al', 'Stock as of'],
  ['Ticket prom.', 'Avg. ticket'],
  ['Precio prom.', 'Avg. price'],
  ['Costo prom.', 'Avg. cost'],
  ['Costo unit.', 'Unit cost'],
  ['Gasto total', 'Total spend'],
  ['% del total', '% of total'],
  ['Sin categoría', 'Uncategorized'],
  ['Sin mesero', 'No waiter'],
  ['Stock bajo', 'Low stock'],
  ['Mejor día:', 'Best day:'],
  ['Mejor mes:', 'Best month:'],
  ['Hora pico:', 'Peak hour:'],
  ['Asegura personal completo en ese horario.', 'Make sure you are fully staffed at that time.'],
  ['Forma de pago principal:', 'Main payment method:'],
  ['de lo cobrado', 'of collections'],
  ['Producto que más factura:', 'Top-grossing product:'],
  ['pendientes de cobro en', 'pending collection in'],
  ['pedido(s) anulados por', 'voided order(s) for'],
  ['revisa los motivos de anulación.', 'review the void reasons.'],
  ['Las ventas subieron', 'Sales went up'],
  ['Las ventas bajaron', 'Sales went down'],
  ['Abajo tienes', 'Below you have'],
  ['gráfico(s) y', 'chart(s) and'],
  ['tabla(s) con el detalle.', 'table(s) with the detail.'],
  ['No hay productos ni insumos por debajo del mínimo.', 'No products or ingredients are below minimum.'],
  ['Reponer pronto:', 'Restock soon:'],
  ['Insumos bajo mínimo:', 'Ingredients below minimum:'],

  // Compras sugeridas
  ['Lista de compras sugerida', 'Suggested shopping list'],
  ['Productos por comprar', 'Products to buy'],
  ['Insumos por comprar', 'Ingredients to buy'],
  ['Inversión estimada:', 'Estimated spend:'],
  ['Inversión estimada', 'Estimated spend'],
  ['Cantidad sugerida a comprar', 'Suggested quantity to buy'],
  ['Stock actual vs mínimo', 'Current stock vs minimum'],
  ['Venta diaria', 'Daily sales'],
  ['Prioridad', 'Priority'],
  ['Comprar', 'Buy'],
  ['Agotados, comprar primero:', 'Out of stock, buy first:'],
  ['Agotados', 'Out of stock'],
  ['Agotado', 'Out of stock'],
  ['Bajo mínimo', 'Below minimum'],
  ['Se agota pronto', 'Running out soon'],
  ['artículo(s) sin costo registrado: la inversión estimada sale incompleta.', 'item(s) without a recorded cost: the estimated spend is incomplete.'],
  ['Cantidades calculadas para cubrir', 'Quantities calculated to cover'],
  ['días de venta más el stock mínimo, según lo vendido en los últimos', 'days of sales plus the minimum stock, based on sales over the last'],
  ['Limitaciones: se basa en el stock registrado en el sistema; no considera compras en camino ni el tiempo de entrega del proveedor. Verifica el stock físico antes de comprar.', 'Limitations: based on the stock recorded in the system; it does not consider purchases in transit or supplier lead time. Check the physical stock before buying.'],
  ['Si algo no aparece como se describe, puede que tu usuario no tenga permiso para ese módulo o que la opción esté desactivada en la configuración; consúltalo con el administrador.', 'If something does not appear as described, your user may not have permission for that module or the option may be disabled in the settings; check with the administrator.'],
  ['Cálculo: cubre', 'Calculation: covers'],
  ['días de venta más el stock mínimo (según los últimos', 'days of sales plus the minimum stock (based on the last'],
  ['días).', 'days).'],
  ['días.', 'days.'],
  ['más en el detalle.', 'more in the detail.'],
  ['vendes ~', 'you sell ~'],
  ['/día', '/day'],
  ['→ comprar', '→ buy'],
  ['stock al', 'stock as of'],
  ['No necesitas comprar nada por ahora: ningún producto ni insumo está bajo su mínimo ni se agota en los próximos 3 días', "You don't need to buy anything for now: no product or ingredient is below its minimum or running out in the next 3 days"],

  // Soporte
  ['Incidencia detectada — soporte técnico', 'Issue detected — technical support'],
  ['Error reportado:', 'Reported error:'],
  ['Dónde está sucediendo:', 'Where it is happening:'],
  ['Causa más común:', 'Most common cause:'],
  ['Prueba primero:', 'Try this first:'],
  ['Si el problema continúa, contacta a soporte por WhatsApp al', 'If the problem continues, contact support on WhatsApp at'],
  ['Te dejé el mensaje casi listo (encargado, local, contacto y dominio). Solo completa si usan AnyDesk (y su ID), la hora del error y cualquier detalle adicional.', 'I left the message almost ready (person in charge, location, contact and domain). Just fill in whether you use AnyDesk (and its ID), the time of the error and any extra detail.'],

  // Palabras sueltas frecuentes (al final: frases largas primero)
  ['cuenta(s)', 'account(s)'],
  ['cuentas', 'accounts'],
  ['Cuentas', 'Accounts'],
  ['Ventas', 'Sales'],
  ['ventas', 'sales'],
  ['Producto', 'Product'],
  ['Productos', 'Products'],
  ['Categoría', 'Category'],
  ['Categorías', 'Categories'],
  ['Cantidad', 'Quantity'],
  ['Unidades', 'Units'],
  ['Mesero', 'Waiter'],
  ['Método', 'Method'],
  ['Cobros', 'Payments'],
  ['Monto', 'Amount'],
  ['Fecha', 'Date'],
  ['Hora', 'Hour'],
  ['Mes', 'Month'],
  ['Día', 'Day'],
  ['Cliente', 'Customer'],
  ['Visitas', 'Visits'],
  ['Usuario', 'User'],
  ['Precio', 'Price'],
  ['Costo', 'Cost'],
  ['Vendidos', 'Sold'],
  ['Ganancia', 'Profit'],
  ['Insumo', 'Ingredient'],
  ['Gasto', 'Spend'],
  ['Mínimo', 'Minimum'],
  ['Valor', 'Value'],
  ['Estado', 'Status'],
  ['Unidad', 'Unit'],
  ['Receta', 'Recipe'],
  ['Compra', 'Purchase'],
  ['Salón', 'Dine-in'],
  ['Para llevar', 'Takeaway'],
  ['Efectivo', 'Cash'],
  ['Tarjeta', 'Card'],
  ['Transferencia', 'Transfer'],
  ['Otros', 'Other'],
  ['Productos', 'Products'],
  ['Insumos', 'Ingredients'],
  ['TOTAL', 'TOTAL'],
  ['este mes', 'this month'],
  ['mes pasado', 'last month'],
  ['esta semana', 'this week'],
  ['semana pasada', 'last week'],
  ['última semana (últimos 7 días)', 'last week (last 7 days)'],
  ['últimos 30 días', 'last 30 days'],
  ['anteayer', 'day before yesterday'],
  ['ayer', 'yesterday'],
  ['hoy', 'today'],
  ['de hoy', 'today'],
  ['del mes', 'this month'],
  ['último domingo', 'last Sunday'], ['último lunes', 'last Monday'], ['último martes', 'last Tuesday'],
  ['último miércoles', 'last Wednesday'], ['último jueves', 'last Thursday'], ['último viernes', 'last Friday'],
  ['último sábado', 'last Saturday'],
  ['domingo', 'Sunday'], ['lunes', 'Monday'], ['martes', 'Tuesday'], ['miércoles', 'Wednesday'],
  ['jueves', 'Thursday'], ['viernes', 'Friday'], ['sábado', 'Saturday'],
  ['enero', 'January'], ['febrero', 'February'], ['marzo', 'March'], ['abril', 'April'], ['mayo', 'May'],
  ['junio', 'June'], ['julio', 'July'], ['agosto', 'August'], ['septiembre', 'September'], ['setiembre', 'September'],
  ['octubre', 'October'], ['noviembre', 'November'], ['diciembre', 'December'],
  ['uds', 'units'],
  ['mín.', 'min.'],
  ['…y', '…and'],
  [' con ', ' with '],
  [' y ', ' and '],
];

ES_TO_EN.push(...OPTION_PAIRS, ['Ejemplos:', 'Examples:']);

const ES_TO_EN_SORTED = [...ES_TO_EN].sort((a, b) => b[0].length - a[0].length);

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const ES_TO_EN_RULES = ES_TO_EN_SORTED.map(([es, en]) => {
  const startsWord = /^[\p{L}\d]/u.test(es);
  const endsWord = /[\p{L}\d]$/u.test(es);
  const re = new RegExp(`${startsWord ? '(?<![\\p{L}\\d])' : ''}${escapeRe(es)}${endsWord ? '(?![\\p{L}\\d])' : ''}`, 'gu');
  return [re, en];
});

const OPTION_ES_TO_EN = new Map(OPTION_PAIRS.map(([es, en]) => [es, en]));

function translateToEnglish(text) {
  if (text == null) return text;
  let out = String(text);
  const exact = OPTION_ES_TO_EN.get(out.trim());
  if (exact) return exact;
  out = out.replace(/¡Hola, ([^!]+)!/g, 'Hi, $1!');
  for (const [re, en] of ES_TO_EN_RULES) out = out.replace(re, en);
  return out.replace(/[¿¡]/g, '');
}

/** Traduce solo valores de celdas que son etiquetas conocidas (no nombres de productos o personas). */
const CELL_VALUES = new Map(
  ES_TO_EN.filter(([es]) => es.length > 2 && !es.startsWith(' ')).map(([es, en]) => [es.toLowerCase(), en]),
);
function translateCell(value) {
  if (typeof value !== 'string') return value;
  return CELL_VALUES.get(value.trim().toLowerCase()) || value;
}

function translateReport(report) {
  if (!report || report.lang === 'en') return report;
  return {
    ...report,
    lang: 'en',
    title: translateToEnglish(report.title),
    subtitle: translateToEnglish(report.subtitle),
    kpis: (report.kpis || []).map((k) => ({ ...k, label: translateToEnglish(k.label) })),
    charts: (report.charts || []).map((c) => ({
      ...c,
      title: translateToEnglish(c.title),
      series: c.series?.map((s) => ({ ...s, label: translateToEnglish(s.label) })),
      data: (c.data || []).map((d) => ({ ...d, name: translateCell(d.name) })),
    })),
    tables: (report.tables || []).map((t) => ({
      ...t,
      title: translateToEnglish(t.title),
      columns: (t.columns || []).map((col) => ({ ...col, label: translateToEnglish(col.label) })),
      rows: (t.rows || []).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, translateCell(v)]))),
      totals: t.totals ? Object.fromEntries(Object.entries(t.totals).map(([k, v]) => [k, translateCell(v)])) : t.totals,
    })),
    insights: (report.insights || []).map((s) => translateToEnglish(s)),
  };
}

function applyPhraseMap(report, map) {
  const tr = (s) => (typeof s === 'string' && map.has(s) ? map.get(s) : translateToEnglish(s));
  return {
    ...report,
    lang: 'en',
    title: tr(report.title),
    subtitle: tr(report.subtitle),
    kpis: (report.kpis || []).map((k) => ({ ...k, label: tr(k.label) })),
    charts: (report.charts || []).map((c) => ({
      ...c,
      title: tr(c.title),
      series: c.series?.map((s) => ({ ...s, label: tr(s.label) })),
      data: (c.data || []).map((d) => ({ ...d, name: translateCell(d.name) })),
    })),
    tables: (report.tables || []).map((t) => ({
      ...t,
      title: tr(t.title),
      columns: (t.columns || []).map((col) => ({ ...col, label: tr(col.label) })),
      rows: (t.rows || []).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, translateCell(v)]))),
      totals: t.totals ? Object.fromEntries(Object.entries(t.totals).map(([k, v]) => [k, translateCell(v)])) : t.totals,
    })),
    insights: (report.insights || []).map((s) => tr(s)),
  };
}

function reportPhrases(report) {
  const list = [];
  const add = (s) => { if (typeof s === 'string' && s.trim()) list.push(s); };
  add(report.title);
  add(report.subtitle);
  (report.kpis || []).forEach((k) => add(k.label));
  (report.charts || []).forEach((c) => {
    add(c.title);
    (c.series || []).forEach((s) => add(s.label));
  });
  (report.tables || []).forEach((t) => {
    add(t.title);
    (t.columns || []).forEach((col) => add(col.label));
  });
  (report.insights || []).forEach(add);
  return list;
}

/** Traduce el resultado completo del chat. Google si hay red; diccionario si no. */
async function translateResult(result, { isGuide = false } = {}) {
  if (!result) return result;
  if (result.translated) return result;

  const googleReply = await translateEsToEn(result.reply);
  let reply;
  if (googleReply) reply = googleReply;
  else if (isGuide) reply = `(This guide is written in Spanish.)\n\n${result.reply}`;
  else reply = translateToEnglish(result.reply);

  let options = result.options;
  if (Array.isArray(options) && options.length) {
    const mapped = await translateManyEsToEn(options);
    options = options.map((o) => (mapped && mapped.get(o)) || translateToEnglish(o));
  }

  let sources = result.sources;
  if (Array.isArray(sources)) {
    const next = [];
    for (const s of sources) {
      if (!(s?.title === 'report' && s.report) || s.report.lang === 'en') {
        next.push(s);
        continue;
      }
      const mapped = await translateManyEsToEn(reportPhrases(s.report));
      next.push({
        ...s,
        report: mapped ? applyPhraseMap(s.report, mapped) : translateReport(s.report),
      });
    }
    sources = next;
  }

  return {
    ...result,
    reply,
    options,
    sources,
    translated: true,
  };
}

module.exports = {
  detectLanguage,
  toSpanishQuery,
  prepareSalesQuery,
  translateToEnglish,
  translateReport,
  translateResult,
};
