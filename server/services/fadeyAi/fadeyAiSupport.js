/**
 * IA Fadey — incidencias que la IA no puede resolver: explica el error probable,
 * dónde ocurre y prepara un mensaje de WhatsApp casi completo para soporte.
 */
const { queryOne } = require('../../database');
const { normalizeSpanish } = require('./fadeyAiDateParse');

const SUPPORT_WHATSAPP = '51934029719';
const SUPPORT_WHATSAPP_DISPLAY = '934 029 719';

const ISSUE_RE = new RegExp(
  [
    '\\berror(es)?\\b',
    '\\bfall(a|o|an|ando)\\b',
    '\\bbug\\b',
    '\\bproblema(s)?\\b',
    '\\bse (cuelga|congela|traba|cierra|reinicia|queda cargando)\\b',
    '\\bno (funciona|me deja|deja|puedo|carga|abre|imprime|conecta|sincroniza|llega|llegan|aparece|aparecen|sale|salen|guarda|responde|envia|reconoce|actualiza|cobra|cierra)\\b',
    '\\bpantalla (en )?blanc',
    '\\b(muy )?lento\\b',
    '\\bsoporte\\b',
    '\\bayuda tecnica\\b',
    '\\bcontactar\\b',
  ].join('|'),
);

const HOW_TO_RE = /^(como|donde|que es|para que|cual es)\b/;

const CATEGORIES = [
  {
    id: 'impresion',
    re: /imprim|impresora|ticket|tiketera|ticketera|precuenta|no sale la comanda/,
    module: 'Impresión (Configuración de impresoras / Asistente de impresión)',
    cause: 'El asistente de impresión está cerrado o la impresora está apagada, sin papel o desconectada (USB/red).',
    checks: [
      'Verifica que la impresora esté encendida, con papel y conectada.',
      'Abre el Asistente de impresión en la PC de caja y confirma que diga "conectado".',
      'Haz una impresión de prueba desde Configuración → Configuración de Impresoras.',
    ],
  },
  {
    id: 'facturacion',
    re: /sunat|comprobante|boleta|factura|nota de credito|nota de debito|\bcpe\b|efact|\bose\b|serie/,
    module: 'Facturación electrónica (Comprobantes / SUNAT)',
    cause: 'Datos del cliente inválidos (RUC/DNI), serie mal configurada o el servicio SUNAT/OSE no responde en ese momento.',
    checks: [
      'Revisa que el RUC/DNI del cliente sea correcto.',
      'Confirma la serie en Configuración → Comprobantes.',
      'Reintenta el envío en unos minutos (SUNAT a veces está saturado).',
    ],
  },
  {
    id: 'caja',
    re: /\bcaja\b|apertura|cierre|arqueo|cobr|pago|yape|plin|vuelto|ingreso|egreso/,
    module: 'Caja',
    cause: 'No hay un turno de caja abierto o la caja está asignada a otro usuario.',
    checks: [
      'Confirma que tu turno de caja esté abierto (Caja → Apertura y cierre).',
      'Verifica que tu usuario tenga asignada la caja correcta en Usuarios.',
      'Recarga la página (Ctrl + F5) e inténtalo de nuevo.',
    ],
  },
  {
    id: 'acceso',
    re: /login|ingresar|iniciar sesion|contrasena|clave|usuario (bloqueado|inactivo)|sesion/,
    module: 'Inicio de sesión / Usuarios',
    cause: 'Contraseña incorrecta, usuario inactivo o la sesión expiró por inactividad.',
    checks: [
      'Revisa mayúsculas y que el usuario esté activo en Configuración → Usuarios.',
      'Cierra sesión y vuelve a ingresar.',
    ],
  },
  {
    id: 'conexion',
    re: /internet|conexion|sin conexion|offline|sincroniz|servidor|no carga|lento|tarda|pantalla (en )?blanc|queda cargando/,
    module: 'Conexión / servidor',
    cause: 'Internet inestable o el servidor está despertando después de un tiempo sin uso.',
    checks: [
      'Verifica que otras páginas carguen (internet del local).',
      'Espera 30 segundos y recarga con Ctrl + F5.',
      'Si hay pedidos pendientes de sincronizar, no cierres la ventana hasta que se envíen.',
    ],
  },
  {
    id: 'produccion',
    re: /cocina|\bbar\b|comanda|produccion|despach|pedido no llega|no llegan los pedidos/,
    module: 'Cocina / Bar (áreas de producción)',
    cause: 'El producto no tiene asignada su área de producción o la pantalla de cocina/bar perdió conexión.',
    checks: [
      'Revisa el área de producción del producto en Productos.',
      'Recarga la pantalla de cocina/bar.',
    ],
  },
  {
    id: 'inventario',
    re: /stock|inventario|almacen|insumo|kardex|receta|requerimiento|compra/,
    module: 'Almacén / Inventario',
    cause: 'El producto no tiene receta o almacén asignado, o el stock no se registró en el almacén correcto.',
    checks: [
      'Verifica la receta y el almacén del producto.',
      'Revisa el movimiento en Almacén → Movimiento interno.',
    ],
  },
  {
    id: 'mesas',
    re: /mesa|salon|reserva|mover mesa|unir mesa/,
    module: 'Mesas / Reservas',
    cause: 'La mesa está bloqueada por otro usuario que tiene el pedido abierto, o la reserva no tiene mesa asignada.',
    checks: [
      'Pide al otro usuario que cierre el pedido de esa mesa.',
      'Recarga el mapa de mesas.',
    ],
  },
  {
    id: 'configuracion',
    re: /configuraci|eliminar|guardar|ajuste|permiso/,
    module: 'Configuración',
    cause: 'Los cambios no se guardaron o tu usuario no tiene permiso para esa sección.',
    checks: [
      'Presiona "Guardar" después de cada cambio y recarga la página.',
      'Confirma con el administrador que tengas permiso para ese módulo.',
    ],
  },
];

const GENERAL = {
  id: 'general',
  module: 'General',
  cause: 'Un error puntual del navegador (caché) o una acción interrumpida por la conexión.',
  checks: [
    'Recarga la página con Ctrl + F5.',
    'Cierra sesión y vuelve a ingresar.',
  ],
};

const CATEGORIES_EN = {
  impresion: {
    module: 'Printing (Printer settings / Printing assistant)',
    cause: 'The printing assistant is closed or the printer is off, out of paper or disconnected (USB/network).',
    checks: [
      'Check that the printer is on, has paper and is connected.',
      'Open the Printing assistant on the cashier PC and confirm it says "connected".',
      'Print a test page from Settings → Printer settings.',
    ],
  },
  facturacion: {
    module: 'Electronic invoicing (Receipts / SUNAT)',
    cause: 'Invalid customer data (RUC/DNI), a misconfigured series, or the SUNAT/OSE service is not responding right now.',
    checks: [
      "Check that the customer's RUC/DNI is correct.",
      'Confirm the series in Settings → Receipts.',
      'Retry sending in a few minutes (SUNAT is sometimes overloaded).',
    ],
  },
  caja: {
    module: 'Cash register',
    cause: 'There is no open cash shift or the register is assigned to another user.',
    checks: [
      'Confirm your cash shift is open (Cash register → Open and close).',
      'Check that your user has the correct register assigned in Users.',
      'Reload the page (Ctrl + F5) and try again.',
    ],
  },
  acceso: {
    module: 'Login / Users',
    cause: 'Wrong password, inactive user or the session expired due to inactivity.',
    checks: [
      'Check capital letters and that the user is active in Settings → Users.',
      'Log out and log in again.',
    ],
  },
  conexion: {
    module: 'Connection / server',
    cause: 'Unstable internet or the server is waking up after a period without use.',
    checks: [
      'Check that other websites load (local internet).',
      'Wait 30 seconds and reload with Ctrl + F5.',
      'If there are orders pending sync, do not close the window until they are sent.',
    ],
  },
  produccion: {
    module: 'Kitchen / Bar (production areas)',
    cause: 'The product has no production area assigned or the kitchen/bar screen lost its connection.',
    checks: [
      'Check the production area of the product in Products.',
      'Reload the kitchen/bar screen.',
    ],
  },
  inventario: {
    module: 'Warehouse / Inventory',
    cause: 'The product has no recipe or warehouse assigned, or the stock was recorded in the wrong warehouse.',
    checks: [
      'Check the recipe and warehouse of the product.',
      'Review the movement in Warehouse → Internal movement.',
    ],
  },
  mesas: {
    module: 'Tables / Reservations',
    cause: 'The table is locked by another user who has the order open, or the reservation has no table assigned.',
    checks: [
      'Ask the other user to close the order on that table.',
      'Reload the table map.',
    ],
  },
  configuracion: {
    module: 'Settings',
    cause: "The changes were not saved or your user doesn't have permission for that section.",
    checks: [
      'Press "Save" after each change and reload the page.',
      'Confirm with the administrator that you have permission for that module.',
    ],
  },
  general: {
    module: 'General',
    cause: 'A one-off browser error (cache) or an action interrupted by the connection.',
    checks: [
      'Reload the page with Ctrl + F5.',
      'Log out and log in again.',
    ],
  },
};

const ROLE_LABELS = {
  admin: 'Administrador',
  master_admin: 'Administrador maestro',
  cajero: 'Cajero',
  mozo: 'Mozo',
  cocina: 'Cocina',
  bar: 'Bar',
  produccion: 'Producción',
  delivery: 'Delivery',
};

const STRONG_ISSUE_RE = /\berror(es)?\b|\bfall(a|o|an|ando)\b|\bbug\b|\bse (cuelga|congela|traba)\b|\bno (funciona|me deja|imprime|carga|conecta|sincroniza)\b|pantalla (en )?blanc|\bsoporte\b/;
const ANALYTICS_RE = /\b(margen|margenes|ventas|vendi|cuanto|cuantos|cuantas|reporte|ranking|top|analisis|analiza|costos?|ganancia|ticket promedio|clientes)\b/;

function isSupportIssueMessage(message) {
  const m = normalizeSpanish(String(message || '')).replace(/^[¿?¡!\s]+/, '');
  if (!m || m.length < 4) return false;
  if (!ISSUE_RE.test(m)) return false;
  const strong = STRONG_ISSUE_RE.test(m);
  if (!strong && ANALYTICS_RE.test(m)) return false;
  if (HOW_TO_RE.test(m) && !strong) return false;
  return true;
}

function detectCategory(message) {
  const m = normalizeSpanish(String(message || ''));
  return CATEGORIES.find((c) => c.re.test(m)) || GENERAL;
}

function cleanText(v, max = 160) {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function buildSupportAnswer(message, user, context = {}, { originalMessage, lang = 'es' } = {}) {
  if (!isSupportIssueMessage(message)) return null;
  const cat = detectCategory(message);
  const en = lang === 'en';
  const catEn = CATEGORIES_EN[cat.id] || CATEGORIES_EN.general;

  const restaurant = queryOne('SELECT name, phone FROM restaurants LIMIT 1') || {};
  const userRow = user?.id ? queryOne('SELECT full_name, phone FROM users WHERE id = ?', [user.id]) || {} : {};

  const where = cleanText(context.module_title) || cat.module;
  const path = cleanText(context.path, 120);
  const whereFull = path ? `${where} (${path})` : where;
  const responsible = cleanText(userRow.full_name || user?.full_name || user?.username) || '______';
  const role = ROLE_LABELS[String(user?.role || '').toLowerCase()] || '';
  const localName = cleanText(restaurant.name) || '______';
  const contact = cleanText(userRow.phone) || cleanText(restaurant.phone) || '______';
  const domain = cleanText(context.host, 120) || '______';
  const onlyAsksSupport = /^(quiero |necesito )?(contactar( a| con)? )?(el |un )?soporte( tecnico)?[.!?]*$/
    .test(normalizeSpanish(message).replace(/^[¿?¡!\s]+/, ''));
  const errorText = onlyAsksSupport ? '______ (describa el error)' : cleanText(originalMessage || message, 400);

  const waLines = [
    'Hola, soporte Resto Fadey. Quiero reportar una incidencia:',
    '',
    `*Error:* ${errorText}`,
    `*Posible causa (según IA Fadey):* ${cat.cause}`,
    `*Dónde ocurre:* ${whereFull}`,
    `*Persona encargada:* ${responsible}${role ? ` (${role})` : ''}`,
    `*Local:* ${localName}`,
    `*Número de contacto:* ${contact}`,
    `*Dominio:* ${domain}`,
    '*Desde cuándo ocurre / hora aproximada:* ______',
    '*Mensaje de error exacto (o captura):* ______',
    '*¿Afecta a un usuario o a varios? ¿Un equipo o varios?:* ______',
    '*¿Hubo cambios recientes (equipo, impresora, internet, configuración)?:* ______',
    '*N° de pedido / comprobante afectado (si aplica):* ______',
    '*¿Usan AnyDesk?:* Sí / No — ID AnyDesk: ______',
    '*Detalle adicional:* ______',
  ];
  const waMessage = waLines.join('\n');
  const whatsappUrl = `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(waMessage)}`;

  const reply = en ? [
    '**Issue detected — technical support**',
    '',
    `Reported error: "${onlyAsksSupport ? '______ (describe the error)' : errorText}"`,
    `Where it is happening: ${cleanText(context.module_title) ? whereFull : (path ? `${catEn.module} (${path})` : catEn.module)}`,
    `Most common cause: ${catEn.cause}`,
    '',
    'Try this first:',
    ...catEn.checks.map((c) => `• ${c}`),
    '',
    'To diagnose it, note: since when it happens, the exact error message (or a screenshot), whether it affects one or several users/devices, any recent changes, and the order/receipt number if there is one.',
    'Did it get solved with these checks? If not:',
    `contact support on WhatsApp at ${SUPPORT_WHATSAPP_DISPLAY}. I left the message almost ready (person in charge, location, contact and domain); just fill in the blanks. The message is in Spanish for the support team.`,
    'Never share passwords or verification codes, not even with support.',
  ].join('\n') : [
    '**Incidencia detectada — soporte técnico**',
    '',
    `Error reportado: "${errorText}"`,
    `Dónde está sucediendo: ${whereFull}`,
    `Causa más común: ${cat.cause}`,
    '',
    'Prueba primero:',
    ...cat.checks.map((c) => `• ${c}`),
    '',
    'Para diagnosticarlo anota: desde cuándo ocurre, el mensaje de error exacto (o una captura), si afecta a uno o varios usuarios/equipos, si hubo cambios recientes y el N° de pedido o comprobante si existe.',
    '¿Se resolvió con estas comprobaciones? Si no:',
    `contacta a soporte por WhatsApp al ${SUPPORT_WHATSAPP_DISPLAY}. Te dejé el mensaje casi listo (encargado, local, contacto y dominio); solo completa los espacios en blanco.`,
    'Nunca compartas contraseñas ni códigos de verificación, ni siquiera con soporte.',
  ].join('\n');

  return {
    reply,
    sources: [{
      kind: 'tool',
      title: 'support_contact',
      category: cat.id,
      whatsapp_url: whatsappUrl,
      whatsapp_message: waMessage,
      whatsapp_number: SUPPORT_WHATSAPP_DISPLAY,
      lang: en ? 'en' : 'es',
    }],
  };
}

module.exports = {
  isSupportIssueMessage,
  buildSupportAnswer,
  SUPPORT_WHATSAPP,
};
