/**
 * Catálogo oficial de documentos legales Fadey Solutions S.A.C. / Resto Fadey POS.
 * version + updated_at: al cambiar el texto, suba la versión para exigir nueva aceptación.
 */

const LEGAL_DOCUMENTS = [
  {
    id: 'contrato_servicio',
    title: 'Contrato de servicio y licencia de uso',
    category: 'documentos_fadey',
    version: '1.0.0',
    updated_at: '2026-11-01',
    summary: 'Contrato entre Fadey Solutions S.A.C. y el cliente por el uso de Resto Fadey POS.',
    body: `CONTRATO DE SERVICIO Y LICENCIA DE USO — RESTO FADEY POS
Fadey Solutions S.A.C. («FADEY») y el cliente (administrador/titular del restaurante).

1. Objeto
FADEY otorga al CLIENTE una licencia de uso no exclusiva, intransferible y revocable del software Resto Fadey POS (aplicación web, módulos operativos, API y componentes asociados), conforme al plan contratado.

2. Alcance del servicio
Incluye acceso a los módulos habilitados, actualizaciones de producto dentro del plan, y soporte según el SLA vigente. No incluye desarrollos a medida ni integraciones no contratadas.

3. Obligaciones del CLIENTE
• Usar el sistema conforme a la ley y a estos documentos.
• Custodiar credenciales y dispositivos.
• Mantener datos de facturación y contacto actualizados.
• No revender, sublicenciar ni realizar ingeniería inversa del software.

4. Propiedad intelectual
Resto Fadey POS, marcas, código y documentación son de FADEY o sus licenciantes. El CLIENTE no adquiere propiedad sobre el software.

5. Pagos y suspensión
El servicio depende del plan y pagos vigentes. El incumplimiento de pago puede limitar o suspender el acceso, sin perjuicio de cobros pendientes.

6. Datos
El CLIENTE es responsable de la veracidad de la información que carga. El tratamiento de datos personales se rige por el Acuerdo de tratamiento y la Política de privacidad.

7. Limitación de responsabilidad
En la máxima medida permitida por la ley peruana, FADEY no responde por lucro cesante, pérdida de datos por culpa del CLIENTE, o interrupciones fuera de su control razonable. La responsabilidad agregada se limita a lo pagado por el CLIENTE en los últimos 12 meses por el servicio afectado.

8. Vigencia y terminación
Vigente mientras el plan esté activo. Cualquiera de las partes puede terminar según las condiciones comerciales y legales aplicables. Al terminar, el CLIENTE puede solicitar exportación de datos en un plazo razonable.

9. Aceptación
La aceptación electrónica por el usuario autorizado (admin) vincula al CLIENTE a este contrato en la versión aceptada.`,
  },
  {
    id: 'terminos_condiciones',
    title: 'Términos y condiciones de Resto Fadey POS',
    category: 'documentos_fadey',
    version: '1.0.0',
    updated_at: '2026-11-01',
    summary: 'Condiciones de uso de la plataforma Resto Fadey POS.',
    body: `TÉRMINOS Y CONDICIONES — RESTO FADEY POS
Fadey Solutions S.A.C.

1. Aceptación
El uso de Resto Fadey POS implica la aceptación de estos términos y de los documentos legales relacionados (privacidad, datos personales, seguridad y SLA).

2. Cuenta y usuarios
El administrador configura usuarios y permisos. Cada usuario es responsable de las acciones realizadas con su cuenta.

3. Uso permitido
El sistema se destina a la operación del restaurante (caja, mesas, cocina, inventario, clientes, reportes, etc.). Queda prohibido el uso ilícito, el abuso de la infraestructura o el intento de acceso no autorizado.

4. Contenido del CLIENTE
Menús, precios, pedidos, clientes y demás datos cargados son responsabilidad del CLIENTE. FADEY no audita la legalidad de cada operación comercial del local.

5. Disponibilidad
Se busca alta disponibilidad; sin embargo pueden existir mantenimientos programados o incidentes. Ver SLA.

6. Cambios
FADEY puede actualizar estos términos. Las versiones nuevas se publican en Configuración → Legal y documentos; puede requerirse nueva aceptación.

7. Ley aplicable
Se rigen por las leyes de la República del Perú. Controversias: jurisdicción de los tribunales competentes de Lima, salvo pacto distinto.`,
  },
  {
    id: 'politica_privacidad',
    title: 'Política de privacidad',
    category: 'documentos_fadey',
    version: '1.0.0',
    updated_at: '2026-11-01',
    summary: 'Cómo Fadey Solutions trata datos personales en Resto Fadey POS.',
    body: `POLÍTICA DE PRIVACIDAD — FADEY SOLUTIONS S.A.C. / RESTO FADEY POS

1. Responsable
Fadey Solutions S.A.C., proveedor de Resto Fadey POS.

2. Datos que se tratan
• Datos de cuenta y usuarios del restaurante (nombre, correo, rol, actividad de sesión).
• Datos operativos del negocio cargados por el CLIENTE (pedidos, mesas, productos, clientes del local, etc.).
• Datos técnicos (IP, dispositivo, registros de error y seguridad) necesarios para operar y proteger el servicio.

3. Finalidades
Prestar el servicio SaaS, soporte, facturación del plan, seguridad, mejora del producto y cumplimiento legal.

4. Base y principios
Tratamiento conforme a la normativa peruana de protección de datos personales y principios de proporcionalidad, seguridad y confidencialidad.

5. Encargos
Cuando FADEY trata datos por cuenta del restaurante (p. ej. clientes finales del local), aplica el Acuerdo de tratamiento de datos personales.

6. Conservación
Mientras exista relación contractual y los plazos legales/operativos aplicables. Tras la baja, se siguen procedimientos de retención o eliminación según política interna.

7. Derechos
Los titulares pueden ejercer acceso, rectificación, cancelación y oposición ante FADEY o, cuando corresponda, ante el restaurante como responsable de sus propios clientes.

8. Contacto
Solicitudes de privacidad: a través de los canales de soporte oficiales de Fadey Solutions S.A.C.`,
  },
  {
    id: 'acuerdo_datos',
    title: 'Acuerdo de tratamiento de datos personales',
    category: 'documentos_fadey',
    version: '1.0.0',
    updated_at: '2026-11-01',
    summary: 'Encargo de tratamiento entre el restaurante (responsable) y Fadey (encargado).',
    body: `ACUERDO DE TRATAMIENTO DE DATOS PERSONALES
Entre el CLIENTE (responsable del tratamiento de datos de sus comensales/empleados según corresponda) y Fadey Solutions S.A.C. (encargado del tratamiento al alojar/procesar datos en Resto Fadey POS).

1. Objeto
Regular el tratamiento que FADEY realiza por cuenta del CLIENTE al prestar Resto Fadey POS.

2. Instrucciones
FADEY tratará los datos solo para prestar el servicio, según instrucciones documentadas del CLIENTE y la ley aplicable.

3. Seguridad
FADEY aplicará medidas técnicas y organizativas razonables (control de acceso, cifrado en tránsito cuando aplique, respaldos, registro de eventos relevantes).

4. Subencargados
FADEY podrá usar proveedores de infraestructura/hosting necesarios para el servicio, bajo obligaciones equivalentes de confidencialidad y seguridad.

5. Confidencialidad
El personal autorizado de FADEY queda obligado a confidencialidad respecto de los datos del CLIENTE.

6. Asistencia
FADEY colaborará razonablemente con el CLIENTE ante ejercicios de derechos de titulares e incidentes de seguridad que afecten datos del CLIENTE.

7. Devolución o eliminación
Al terminar el servicio, FADEY facilitará la exportación razonable de datos y procederá a la eliminación o bloqueo conforme a sus procedimientos, salvo retención legal.

8. Aceptación
La aceptación de este documento en el sistema constituye el acuerdo de encargo para la versión indicada.`,
  },
  {
    id: 'politica_seguridad',
    title: 'Política de seguridad y confidencialidad',
    category: 'documentos_fadey',
    version: '1.0.0',
    updated_at: '2026-11-01',
    summary: 'Medidas y deberes de seguridad aplicables al uso de Resto Fadey POS.',
    body: `POLÍTICA DE SEGURIDAD Y CONFIDENCIALIDAD — RESTO FADEY POS

1. Objetivo
Proteger la confidencialidad, integridad y disponibilidad de la información del servicio y de los datos del CLIENTE.

2. Controles de FADEY
• Autenticación y sesiones.
• Separación de entornos y least privilege cuando aplique.
• Comunicaciones HTTPS en despliegues productivos.
• Registro de eventos relevantes y respuesta a incidentes.
• Actualizaciones de seguridad del producto.

3. Deberes del CLIENTE
• Usar contraseñas seguras y no compartir cuentas.
• Limitar permisos por rol.
• Proteger equipos POS, impresoras y redes locales.
• Reportar sospechas de acceso indebido a soporte Fadey.
• Cumplir políticas internas del restaurante sobre datos de clientes y personal.

4. Confidencialidad
La información no pública del CLIENTE y de FADEY no debe divulgarse a terceros no autorizados.

5. Incidentes
Ante un incidente de seguridad con impacto material, FADEY notificará al CLIENTE por los canales contractuales en un plazo razonable y colaborará en la remediación.

6. Auditoría razonable
FADEY puede revisar logs y uso anómalo para proteger la plataforma.`,
  },
  {
    id: 'sla_soporte',
    title: 'Condiciones de soporte y disponibilidad (SLA)',
    category: 'documentos_fadey',
    version: '1.0.0',
    updated_at: '2026-11-01',
    summary: 'Niveles de servicio, soporte y disponibilidad orientativos del producto.',
    body: `CONDICIONES DE SOPORTE Y DISPONIBILIDAD (SLA) — RESTO FADEY POS
Fadey Solutions S.A.C.

1. Disponibilidad objetivo
Objetivo de disponibilidad mensual del servicio en la nube: 99,0 % (excluye mantenimientos anunciados y causas de fuerza mayor o del CLIENTE: red local, dispositivos, energia, mal uso).

2. Canales de soporte
Soporte por los canales oficiales comunicados al CLIENTE (correo / chat / portal según plan).

3. Horario
Soporte en horario comercial de FADEY (hora de Lima), salvo planes que indiquen cobertura extendida.

4. Clasificación de incidentes (orientativa)
• Crítico: sistema inaccesible para todo el local.
• Alto: módulo esencial (caja/pedidos) degradado.
• Medio: funcionalidad parcial afectada.
• Bajo: consultas, mejoras o dudas de uso.

5. Tiempos de respuesta objetivo (primer contacto)
• Crítico: 4 horas hábiles.
• Alto: 8 horas hábiles.
• Medio: 1 día hábil.
• Bajo: 2 días hábiles.
Los tiempos de solución dependen de la causa raíz y no constituyen garantía absoluta.

6. Mantenimientos
FADEY procurará avisar con antelación mantenimientos programados. Emergencias de seguridad pueden aplicarse sin aviso previo.

7. Exclusiones
Fallos de internet del CLIENTE, hardware local, configuración incorrecta, terceros (pasarelas, SUNAT, ISP) o incumplimiento del CLIENTE.

8. Créditos / remedios
Salvo pacto comercial distinto, este SLA define compromisos de esfuerzo razonable; remedios comerciales se acuerdan caso por caso en el plan contratado.`,
  },
];

function listLegalDocumentsMeta() {
  return LEGAL_DOCUMENTS.map(({ body, ...meta }) => meta);
}

function getLegalDocument(id) {
  const key = String(id || '').trim();
  return LEGAL_DOCUMENTS.find((d) => d.id === key) || null;
}

module.exports = {
  LEGAL_DOCUMENTS,
  listLegalDocumentsMeta,
  getLegalDocument,
};
