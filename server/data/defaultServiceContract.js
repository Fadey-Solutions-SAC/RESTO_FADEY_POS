/**
 * Texto base del contrato digital (editable en UI; la versión guardada vive en app_settings.contrato).
 * Si en BD no hay texto, se usa este contenido.
 */
const DEFAULT_SERVICE_CONTRACT_TEXT = `CONTRATO DIGITAL DE LICENCIA Y PRESTACIÓN DE SERVICIO SaaS PARA SISTEMA DE RESTAURANTES

PRIMERA: PARTES
El presente contrato es celebrado entre:
EL PROVEEDOR: FADEY SOLUTIONS SAC, identificado con RUC N° 10600327327, empresa de prestación del sistema de gestión para restaurantes, correo electrónico fadeysolutions@gmail.com.
EL CLIENTE: ________________________, identificado con RUC N° ________________________, propietario del establecimiento.

SEGUNDA: OBJETO DEL CONTRATO
EL PROVEEDOR concede a EL CLIENTE una licencia de uso limitada, no exclusiva, intransferible y revocable del sistema de gestión para restaurantes (RESTO FADEY.POS) que incluye funcionalidades como:
• Punto de venta (POS)
• Gestión de pedidos
• Control de caja
• Gestión de productos y menú
• Reportes y estadísticas
• Módulos adicionales que el proveedor implemente
• Facturación automática (sujeta al tipo de plan adquirido).

TERCERA: MODALIDAD DEL SERVICIO (SaaS)
EL SISTEMA se proporciona bajo modalidad Software como Servicio (SaaS):
• Acceso vía internet (app/web)
• Infraestructura en la nube administrada por EL PROVEEDOR
• No existe entrega del código fuente
• EL CLIENTE no adquiere propiedad del software.

CUARTA: PROPIEDAD INTELECTUAL
Todos los derechos del sistema (código, diseño, base de datos, marca, lógica, funcionalidades) son propiedad exclusiva de EL PROVEEDOR.
EL CLIENTE queda prohibido de:
• Copiar, clonar o replicar el sistema
• Vender o sublicenciar el sistema
• Intentar acceder al código fuente
• Descompilar o modificar el software.

QUINTA: PRECIO Y FACTURACIÓN
EL CLIENTE pagará: S/ 249.00 bajo modalidad: Mensual.
Condiciones:
• Pago por adelantado
• No reembolsable
• La falta de pago habilita la suspensión automática del servicio; se notificará en el sistema 3 días antes de la fecha de facturación.

SEXTA: ACTIVACIÓN DEL SERVICIO
El servicio será activado una vez que:
1. EL CLIENTE firme digitalmente el contrato.
2. Se confirme el pago correspondiente.
3. La activación será dentro de un plazo de 72 horas.
4. La entrega de credenciales se enviará al contacto del cliente al culminar la activación del servicio.

SÉPTIMA: SOPORTE Y ACTUALIZACIONES
EL PROVEEDOR podrá brindar:
• Soporte técnico 24/7
• Actualizaciones del sistema
• Nuevas funcionalidades sin previo aviso
No se garantiza soporte inmediato ni desarrollo personalizado.

OCTAVA: DISPONIBILIDAD DEL SERVICIO
EL PROVEEDOR realizará esfuerzos razonables para mantener el sistema operativo, pero no garantiza disponibilidad continua.
No será responsable por interrupciones causadas por:
• Fallas de internet
• Problemas eléctricos
• Servidores externos
• Fuerza mayor

NOVENA: RESPONSABILIDAD DEL CLIENTE
EL CLIENTE se compromete a:
• Usar el sistema conforme a ley
• Proteger sus accesos
• No realizar actividades fraudulentas
• Contar con conexión a internet adecuada

DÉCIMA: DATOS Y CONFIDENCIALIDAD
EL PROVEEDOR protegerá la información del cliente, pero:
• No se responsabiliza por pérdida de datos por causas externas
• Podrá usar datos de forma estadística sin identificar al cliente

DÉCIMA PRIMERA: SUSPENSIÓN DEL SERVICIO
EL PROVEEDOR podrá suspender el acceso sin previo aviso en caso de:
• Falta de pago
• Uso indebido del sistema
• Incumplimiento del contrato

DÉCIMA SEGUNDA: TERMINACIÓN
El contrato podrá finalizar:
• Por decisión del cliente
• Por incumplimiento
• Por decisión del proveedor
No hay devolución de pagos ya realizados.

DÉCIMA TERCERA: LIMITACIÓN DE RESPONSABILIDAD
EL PROVEEDOR no será responsable por:
• Pérdidas económicas del negocio
• Errores operativos del cliente
• Decisiones tomadas con base en el sistema

DÉCIMA CUARTA: FIRMA ELECTRÓNICA
Las partes acuerdan que este contrato será firmado mediante firma electrónica, teniendo plena validez legal conforme a la ley.
La aceptación digital tendrá el mismo valor que una firma manuscrita.

DÉCIMA QUINTA: ACEPTACIÓN DIGITAL
EL CLIENTE acepta este contrato mediante:
☐ Firma electrónica (NFC / dispositivo móvil y registro digital)

DÉCIMA SEXTA: JURISDICCIÓN
Las partes se someten a las leyes del Perú y a los tribunales de la ciudad donde opera EL PROVEEDOR.

DÉCIMA SÉPTIMA: VIGENCIA
El contrato entra en vigencia desde la aceptación digital y se mantiene activo mientras el servicio esté vigente.

ACEPTACIÓN DIGITAL

EL PROVEEDOR: FADEY SOLUTIONS SAC
RUC: 10600327327
GERENTE: ROMERO ROMERO DEYVI RENAN
Firma: ________________________

EL CLIENTE: ________________________
Firma: ________________________
Fecha: ____/____/________
`;

module.exports = { DEFAULT_SERVICE_CONTRACT_TEXT };

