/**
 * Guías paso a paso del POS Resto Fadey (conocimiento base de la IA Fadey).
 * Cada guía incluye keywords para búsqueda aunque el usuario pregunte con otras palabras.
 */
const OPERATION_GUIDES = [
  {
    id: 'guide-mover-pedido',
    title: 'Cómo mover un pedido o cuenta a otra mesa',
    keywords: ['mover pedido', 'mover cuenta', 'trasladar', 'traslado', 'transferir mesa', 'cambiar mesa', 'pasar pedido'],
    body: `Paso a paso — Mover pedido / traslado de mesa:
1. Entra a Mesas o Caja (según tu permiso).
2. Abre la mesa de origen (la que tiene el pedido o la cuenta).
3. Busca la opción de traslado / mover / transferir (modal de mesa o menú de la cuenta).
4. Elige destino:
   - Mover toda la cuenta a otra mesa, o
   - Mover solo algunos productos a otra mesa (si el sistema lo ofrece).
5. Selecciona la mesa destino (libre o con cuenta; si tiene cuenta, puede unirse).
6. Confirma. Los pedidos pasan a la mesa destino y la origen se libera si quedó vacía.
Importante:
- Trasladar ≠ anular: el pedido sigue activo, solo cambia de mesa.
- Para liberar sin mover, usa anular/liberar mesa (requiere permiso).
- Si no ves el botón, tu usuario no tiene permiso de traslado o no hay mesa destino válida.`,
  },
  {
    id: 'guide-cerrar-caja',
    title: 'Cómo cerrar caja (cierre de turno)',
    keywords: ['cerrar caja', 'cierre', 'cierre de caja', 'cerrar turno', 'arqueo', 'apertura y cierre'],
    body: `Paso a paso — Cerrar caja:
1. Inicia sesión como admin o cajero con permiso de caja.
2. En el menú lateral abre Caja → Apertura y cierre (o Cierres de caja).
3. Verifica que el turno esté abierto (si no hay turno, primero haz Apertura e indica el monto inicial).
4. Revisa el resumen del turno: ventas, ingresos, egresos y efectivo esperado.
5. Cuenta el efectivo real en el cajón e indícalo en el cierre (arqueo).
6. Confirma el cierre. El sistema guarda el cierre y el turno queda cerrado.
7. Para ver históricos: Caja → Cierres de caja.
Nota: no se puede cobrar con el turno cerrado; hay que abrir uno nuevo.`,
  },
  {
    id: 'guide-abrir-caja',
    title: 'Cómo abrir caja (inicio de turno)',
    keywords: ['abrir caja', 'apertura', 'abrir turno', 'monto inicial'],
    body: `Paso a paso — Abrir caja:
1. Entra a Caja → Apertura y cierre.
2. Si no hay turno abierto, pulsa Abrir / Apertura.
3. Ingresa el monto inicial de efectivo (fondo de caja).
4. Confirma. Ya puedes cobrar mesas y pedidos.
5. Los ingresos y egresos del turno se registran en Caja → Ingresos / Egresos.`,
  },
  {
    id: 'guide-cobrar',
    title: 'Cómo cobrar una mesa o pedido',
    keywords: ['cobrar', 'pago', 'facturar', 'cobro'],
    body: `Paso a paso — Cobrar:
1. Asegúrate de tener turno de caja abierto.
2. Abre Caja o Mesas y selecciona la mesa/cuenta pendiente.
3. Revisa productos, descuentos y propina si aplica.
4. Elige método(s) de pago (efectivo, tarjeta, etc.).
5. Confirma el cobro. La cuenta queda pagada y la mesa se libera si no quedan pedidos activos.
6. Si usas impresora de caja, el ticket puede imprimirse automáticamente o desde Configuración de impresión.`,
  },
  {
    id: 'guide-requerimiento',
    title: 'Cómo generar un requerimiento de almacén',
    keywords: ['requerimiento', 'requerir', 'pedido a almacén', 'solicitar insumos', 'almacen'],
    body: `Paso a paso — Requerimiento:
1. Inicia sesión como admin (o rol con permiso de Almacén → Requerimiento).
2. Menú: Control de recursos / Almacén → Requerimiento.
3. Selecciona el área o almacén destino si el sistema lo pide.
4. Agrega insumos o productos no transformables a solicitar (cantidad).
5. Revisa el listado y guarda / envía el requerimiento.
6. El documento queda registrado para que Almacén prepare o apruebe según el flujo del local.
Nota: si no ves «Requerimiento», el Admin Maestro puede haberlo desactivado en el plan, o tu usuario no tiene ese subpermiso.`,
  },
  {
    id: 'guide-recepcion',
    title: 'Cómo hacer una recepción de mercadería',
    keywords: ['recepcion', 'recepción', 'recibir compra', 'ingreso mercaderia', 'compra almacén'],
    body: `Paso a paso — Recepción:
1. Menú: Almacén / Control de recursos → Recepción.
2. Crea una nueva recepción (proveedor, fecha, documento si aplica).
3. Agrega los ítems recibidos con cantidades y costos.
4. Confirma la recepción. El stock de insumos/productos se actualiza.
5. Puedes cruzar con un requerimiento previo si el local trabaja así.
Nota: sin permiso «Recepción» o con el módulo apagado por el maestro, no aparecerá en el menú.`,
  },
  {
    id: 'guide-auto-pedido-cartas',
    title: 'Cómo cargar una carta al Auto pedido QR',
    keywords: ['carta', 'cartas', 'auto pedido', 'auto-pedido', 'qr mesa', 'cargar carta', 'menú digital'],
    body: `Paso a paso — Cargar carta al Auto pedido QR:
1. Entra como admin a Auto pedido (menú lateral).
2. Ve a la sección de Cartas / menús digitales.
3. Crea o edita una carta: nombre, imagen y productos incluidos (elige de la carta del local).
4. Guarda la carta. Queda disponible para el QR de mesa.
5. En la misma pantalla de Auto pedido configura qué ve el cliente al escanear (ver guía «productos vs cartas»).
6. Imprime o descarga el QR de cada mesa desde Auto pedido / Mesas según tu flujo.
El cliente abre el enlace público del QR de la mesa y ve cartas y/o productos según la configuración.`,
  },
  {
    id: 'guide-qr-home-productos-cartas',
    title: 'Cómo mostrar productos o cartas en el QR (y viceversa)',
    keywords: ['productos en vez de carta', 'carta en vez de productos', 'qr home', 'inicio qr', 'ambos', 'ver productos', 'ver carta'],
    body: `Paso a paso — Qué ve el cliente al escanear el QR:
1. Admin → Auto pedido.
2. Busca la opción de inicio del QR / pantalla de inicio (productos, cartas o ambos).
3. Elige:
   - Productos: el cliente ve la carta de productos primero.
   - Cartas: el cliente ve las cartas/menús digitales primero.
   - Ambos: puede ver las dos vistas.
4. Guarda los cambios.
5. Prueba escaneando el QR de una mesa (o abriendo el enlace público).
6. Si el modo es «cartas», el cliente puede tener un botón para pasar a productos (y al revés según diseño).
Así controlas si se prioriza la carta visual o el listado de productos.`,
  },
  {
    id: 'guide-crear-usuario',
    title: 'Cómo crear un usuario',
    keywords: ['crear usuario', 'nuevo usuario', 'alta personal', 'empleado usuario', 'usuarios'],
    body: `Paso a paso — Crear usuario:
1. Admin → Configuración → Usuarios (o módulo Usuarios).
2. Pulsa Nuevo / Agregar usuario.
3. Completa: usuario, contraseña, nombre completo y rol (admin, cajero, mozo, producción, delivery, etc.).
4. Activa los permisos de módulos que necesite (Caja, Mesas, Cocina, Almacén…).
5. Si es cajero o mozo: asigna una caja.
6. Si es producción/cocina/bar: vincula el área de producción (ver guía de áreas).
7. Guarda. El usuario ya puede iniciar sesión.
8. Si usas RRHH / QR de jornada, asegúrate de que exista ficha de trabajador vinculada (Recursos humanos).`,
  },
  {
    id: 'guide-area-produccion',
    title: 'Cómo vincular un área de producción a un usuario o producto',
    keywords: ['area produccion', 'área de producción', 'vincular cocina', 'vincular bar', 'production area'],
    body: `Paso a paso — Áreas de producción:
A) Definir áreas:
1. Configuración → Áreas de producción (o desde Productos / producción).
2. Crea áreas (ej. Cocina, Bar, Parrilla) con nombre visible.
B) Vincular a un usuario:
1. Configuración → Usuarios → editar el usuario.
2. Rol producción / cocina / bar y elige production_area_id (su área).
3. Guarda. Al entrar irá a ese módulo (y a Asistencia QR si está activa).
C) Vincular a un producto:
1. Productos → editar plato.
2. Campo área de producción: cocina, bar u otra área.
3. Al pedir ese producto, la comanda llega al panel de esa área.`,
  },
  {
    id: 'guide-impresora',
    title: 'Cómo configurar la impresora térmica',
    keywords: ['impresora', 'imprimir', 'térmica', 'escpos', 'asistente impresión', 'usb', 'ticket'],
    body: `Paso a paso — Impresora:
1. Instala y abre la app de escritorio Resto FADEY (asistente de impresión) en la PC de caja/cocina.
2. En el POS (navegador o app), abre Configuración del módulo:
   - Caja: impresora de tickets de cobro.
   - Cocina / Bar / área: botón Configuración en el panel o en ajustes de impresión.
3. Verifica el vínculo (URL local, ej. http://127.0.0.1:3002). Usa «Verificar vínculo» o «Vincular manual».
4. Elige tipo USB o Red, ancho de papel (58/80 mm) e impresora detectada.
5. Guarda y haz «Imprimir prueba».
6. En cocina/bar activa el sonido de pedidos nuevos si lo necesitas.
Sin la app de escritorio abierta en esa PC, la detección USB no funciona.`,
  },
  {
    id: 'guide-salones-mesas',
    title: 'Cómo configurar salones y mesas',
    keywords: ['salon', 'salón', 'salones', 'mesas', 'mapa mesas', 'zona'],
    body: `Paso a paso — Salones y mesas:
1. Admin → Configuración → Salones y Mesas.
2. Crea salones/zonas (ej. Terraza, Salón principal, VIP).
3. Dentro de cada salón agrega mesas (número o nombre).
4. Guarda. En Mesas/Caja verás pestañas por salón.
5. El QR de auto-pedido suele asociarse por mesa: genera/imprime QR por mesa desde Auto pedido.
6. Para mover pedidos entre mesas usa traslado/unión de cuenta en el mapa de mesas.`,
  },
  {
    id: 'guide-mesas-pedido',
    title: 'Cómo tomar un pedido en mesa',
    keywords: ['pedido mesa', 'tomar pedido', 'enviar cocina', 'comanda'],
    body: `Paso a paso — Pedido en salón:
1. Abre Mesas (mozo/admin) o Caja.
2. Elige salón y toca la mesa libre o con cuenta.
3. Agrega productos por categoría; indica notas o modificadores.
4. Envía / confirma: la comanda va a cocina/bar según el área de cada producto.
5. Puedes agregar más ítems después (líneas nuevas).
6. Al terminar, cobra en Caja para liberar la mesa.`,
  },
  {
    id: 'guide-liberar-mesa',
    title: 'Cómo liberar o anular una mesa',
    keywords: ['liberar mesa', 'anular pedido', 'cancelar mesa', 'vaciar mesa'],
    body: `Paso a paso — Liberar mesa:
1. Si la cuenta ya se cobró, la mesa suele liberarse sola.
2. Si hay error: Caja/Mesas → mesa → opción anular / liberar (requiere permiso «Eliminar y liberar mesa»).
3. Confirma. Los pedidos activos se anulan y la mesa queda libre.
4. No confundir con traslado: traslado mueve la cuenta a otra mesa sin anular.`,
  },
  {
    id: 'guide-cocina',
    title: 'Cómo trabajar en cocina / producción',
    keywords: ['cocina', 'marcar listo', 'preparacion', 'producción', 'comanda cocina'],
    body: `Paso a paso — Cocina:
1. Si hay jornada por QR: marca asistencia antes.
2. Entra al módulo Cocina o tu área de producción.
3. Verás pedidos pendientes; toca para preparar y luego marcar listo.
4. Activa el sonido al entrar (pedidos nuevos).
5. Configuración del área: impresora + URL del asistente de impresión.`,
  },
  {
    id: 'guide-asistencia',
    title: 'Cómo marcar asistencia con QR',
    keywords: ['asistencia', 'marcar ingreso', 'jornada qr', 'escanear qr'],
    body: `Paso a paso — Asistencia QR:
1. Inicia sesión con tu usuario.
2. Ve a Asistencia QR.
3. Escanea el QR único del local (cámara del PC o teléfono).
4. Primer escaneo = ingreso (jornada activa); segundo = salida.
5. Si ya estás activo e inicias sesión en otro navegador, entras directo a tu módulo.`,
  },
  {
    id: 'guide-productos',
    title: 'Cómo crear o editar un producto',
    keywords: ['crear producto', 'editar plato', 'carta productos', 'precio', 'stock producto'],
    body: `Paso a paso — Productos:
1. Admin → Productos.
2. Nuevo producto: nombre, precio, categoría, imagen opcional.
3. Asigna área de producción (cocina/bar/otra) para que la comanda llegue al panel correcto.
4. Activa/desactiva el producto para que aparezca o no en la carta.
5. Stock: según tipo (transformado vs no transformado) se gestiona en Productos o Almacén.
6. Guarda. Ya puede pedirse en Mesas, Caja, Reservas y Auto pedido.`,
  },
  {
    id: 'guide-delivery',
    title: 'Cómo operar delivery',
    keywords: ['delivery', 'reparto', 'delivery pedido'],
    body: `Paso a paso — Delivery:
1. Crea pedido tipo delivery desde Caja/Mesas o módulo Delivery.
2. Cocina/bar preparan; cuando esté listo asigna repartidor.
3. El repartidor marca en camino / entregado en su panel.
4. Si Delivery no aparece, puede estar desactivado en configuración del local.`,
  },
  {
    id: 'guide-reservas',
    title: 'Cómo crear una reserva',
    keywords: ['reserva', 'reservar mesa', 'reservaciones'],
    body: `Paso a paso — Reservas:
1. Menú Reservas.
2. Nueva reserva: cliente, fecha/hora, personas, mesa si aplica.
3. Guarda. Caja puede recibir avisos cercanos a la hora.
4. En la reserva puedes armar el pedido anticipado (misma carta que Mesas).`,
  },
  {
    id: 'guide-rrhh',
    title: 'Cómo usar Recursos humanos',
    keywords: ['rrhh', 'recursos humanos', 'tiempo trabajado', 'empleados', 'horario'],
    body: `Paso a paso — RRHH / Tiempo trabajado:
1. Admin → Recursos humanos / Tiempo trabajado.
2. Activa o desactiva jornada por QR.
3. Personal: alta de empleados, horarios (plantilla o personalizado).
4. QR del local: genera/regenera el QR compartido de asistencia.
5. Productividad: paneles de activos, horas y alertas.
6. Tras reset de fábrica, los datos HR también se limpian.`,
  },
  {
    id: 'guide-mi-restaurant',
    title: 'Cómo configurar Mi empresa',
    keywords: ['mi empresa', 'mi restaurante', 'datos fiscales', 'logo', 'pago plan'],
    body: `Paso a paso — Mi empresa:
1. Menú Mi empresa / Mi restaurante.
2. Completa datos del local, logo y branding.
3. Pago de plan: carga comprobante cuando el sistema lo solicite.
4. Facturación electrónica (SUNAT): solo plan/profesional y si el maestro lo habilita.
5. Información/respaldo: según permisos del maestro.`,
  },
  {
    id: 'guide-config-general',
    title: 'Mapa rápido de Configuración',
    keywords: ['configuracion', 'ajustes', 'dónde está', 'menu', 'módulos'],
    body: `Dónde encontrar cada cosa:
- Usuarios y roles: Configuración → Usuarios
- Salones y mesas: Configuración → Salones y Mesas
- Áreas de producción: Configuración / Productos → áreas
- Impresoras: Configuración de cada módulo (Caja, Cocina, Bar) + app escritorio
- Auto pedido QR y cartas: menú Auto pedido
- Almacén (requerimiento, recepción, gastos): Control de recursos
- Caja (apertura, cierre, movimientos): menú Caja
- Asistencia: Asistencia QR
- IA Fadey: icono en Notificaciones (debe estar activa en Admin Maestro)
Si un ítem no aparece: falta permiso del usuario o el plan/maestro lo desactivó.`,
  },
  {
    id: 'guide-ia',
    title: 'Qué puede hacer la IA Fadey',
    keywords: ['ia fadey', 'asistente', 'qué puedes', 'ayuda'],
    body: `Soy la IA Fadey de este local. Puedo:
- Explicar paso a paso cómo operar el sistema (caja, mesas, almacén, QR, usuarios, impresoras…).
- Consultar ventas, platos más vendidos, stock bajo y personal en jornada (según tu rol).
- Avisar en segundo plano demoras o stock bajo (tras el periodo de aprendizaje).
No puedo cobrar, anular ni cambiar precios por ti: te indico cómo hacerlo tú en el sistema.`,
  },
];

module.exports = { OPERATION_GUIDES };
