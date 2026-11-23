/**
 * Guías de PIX (IA Fadey) que explican para qué sirve cada módulo del menú,
 * cómo operar Hotel y GIT Cards, y qué ve el cliente final (QR, carta web, reserva, encuesta).
 * Se suman a OPERATION_GUIDES en `fadeyAiGuides.js`. Los permisos por guía están en `fadeyAiAccess.js`.
 */

/** Frases de pregunta "para qué sirve" que se añaden a las palabras clave de cada módulo. */
function purposeKeywords(...names) {
  const out = [];
  for (const n of names) {
    out.push(`para que sirve ${n}`, `que es ${n}`, `que hace ${n}`, `modulo ${n}`, `para que es ${n}`);
  }
  return out;
}

const MODULE_GUIDES = [
  /* —— Para qué sirve cada módulo —— */
  {
    id: 'guide-modulo-escritorio',
    title: 'Para qué sirve el Escritorio',
    keywords: purposeKeywords('escritorio', 'el escritorio', 'inicio'),
    body: `Escritorio — para qué sirve:
- Es la pantalla de inicio del administrador.
- Muestra un resumen del negocio: ventas, caja y accesos rápidos.
- Se filtra por periodo (semana, mes, todos) y por caja.
- Desde aquí se entra a los demás módulos del menú lateral.
Úsalo para ver de un vistazo cómo va el día antes de entrar al detalle en Ventas o Informes.`,
  },
  {
    id: 'guide-modulo-caja',
    title: 'Para qué sirve el módulo Caja',
    keywords: purposeKeywords('caja', 'la caja', 'modulo de caja'),
    body: `Caja — para qué sirve:
- Cobrar cuentas de mesas, llevar y delivery, y emitir boleta o factura.
- Ver el mapa de mesas con su estado.
- Abrir y cerrar el turno de caja (Apertura y cierre), con arqueo de efectivo.
- Registrar Ingresos y Egresos de dinero fuera de una venta.
- Revisar Cierres de caja anteriores.
- Emitir notas de crédito o débito (si el plan lo permite).
- Configurar la impresora de caja.
Sin turno abierto no se puede cobrar. El cajero no ve Apertura y cierre ni Cierres de caja: eso lo hace el administrador.`,
  },
  {
    id: 'guide-modulo-mesas',
    title: 'Para qué sirve el módulo Mesas',
    keywords: purposeKeywords('mesas', 'las mesas', 'modulo mesas'),
    body: `Mesas — para qué sirve:
- Es la pantalla del mozo: ve los salones y sus mesas libres u ocupadas.
- Toma pedidos en la mesa y los envía a cocina, bar u otra área de producción.
- Agrega o quita productos, mueve un pedido a otra mesa o une cuentas.
- Pide la precuenta. El cobro final se hace en Caja.
Los salones y mesas se crean en Configuración → Salones y Mesas.`,
  },
  {
    id: 'guide-modulo-produccion',
    title: 'Para qué sirven Cocina, Bar y Producción',
    keywords: [
      ...purposeKeywords('cocina', 'bar', 'produccion', 'area de produccion'),
      'pantalla de cocina', 'comandas',
    ],
    body: `Cocina, Bar y áreas de Producción — para qué sirven:
- Cada área (Cocina, Bar u otra que crees) tiene su pantalla de comandas.
- Ahí llegan solo los productos que pertenecen a esa área, desde Mesas, Caja, Delivery o el QR.
- El personal marca cada pedido como en preparación o listo, y el mozo o la caja lo ven.
- Puede mostrar un aviso de preparación con lo que se espera vender (pronóstico de PIX).
Las áreas se crean en Configuración → Áreas de producción, y cada producto se vincula a su área.`,
  },
  {
    id: 'guide-modulo-delivery',
    title: 'Para qué sirve el módulo Delivery',
    keywords: purposeKeywords('delivery', 'el delivery', 'reparto'),
    body: `Delivery — para qué sirve:
- Registrar pedidos para entregar a domicilio con cliente, dirección y teléfono.
- Seguir el estado del pedido hasta la entrega.
- El repartidor tiene su propia pantalla con los pedidos asignados.
Solo aparece si Delivery está activo en el plan.`,
  },
  {
    id: 'guide-modulo-hotel',
    title: 'Para qué sirve el módulo Hotel',
    keywords: [
      ...purposeKeywords('hotel', 'hoteleria', 'el hotel'),
      'habitaciones', 'huespedes', 'huéspedes', 'recepcion hotel',
    ],
    body: `Hotel — para qué sirve:
Sirve para negocios que además del restaurante alquilan habitaciones. Tiene estas secciones:
- Dashboard: habitaciones disponibles, ocupadas, reservadas, en mantenimiento, por cobrar y cobrado hoy.
- Habitaciones: crear cada habitación con número, piso, capacidad, tarifa por noche y la caja donde se cobra.
- Reservas: reservas por fechas, incluidas las que llegan desde la web.
- Huéspedes: lista de huéspedes de reservas y estadías abiertas.
- Estadías y recepción: registrar el ingreso del huésped, cargar pedidos a la habitación y dar la salida.
- Cuentas y cobros: lo que debe cada habitación ocupada.
- Limpieza y mantenimiento: habitaciones que esperan limpieza antes de volver a usarse.
- Informes y Configuración (tipos de habitación y tarifas).
Solo aparece si Hotel está activo en el plan. Lo usan administrador, cajero y recepcionista.`,
  },
  {
    id: 'guide-modulo-reservas',
    title: 'Para qué sirve el módulo Reservas',
    keywords: purposeKeywords('reservas', 'las reservas'),
    body: `Reservas — para qué sirve:
- Apartar mesas del restaurante para una fecha y hora, con nombre y número de personas.
- Ver las reservas del día para preparar el salón.
No es lo mismo que las reservas de habitaciones: esas están en Hotel → Reservas.`,
  },
  {
    id: 'guide-modulo-auto-pedido',
    title: 'Para qué sirve el Auto pedido',
    keywords: [
      ...purposeKeywords('auto pedido', 'autopedido', 'pedido qr'),
      'carta digital', 'menu qr',
    ],
    body: `Auto pedido — para qué sirve:
- Que el cliente pida solo desde su celular escaneando el QR de la mesa, sin esperar al mozo.
- Mostrar la carta digital: productos, cartas o ambos.
- El pedido llega a cocina o bar y queda en la cuenta de la mesa para cobrarlo en Caja.
Desde el menú Auto pedido el administrador carga cartas, elige qué ve el cliente y descarga el QR de cada mesa.`,
  },
  {
    id: 'guide-modulo-ventas',
    title: 'Para qué sirve el módulo Ventas',
    keywords: purposeKeywords('ventas', 'el modulo de ventas'),
    body: `Ventas — para qué sirve:
- Consultar las ventas por periodo: totales, número de tickets y métodos de pago.
- Filtrar por caja y comparar periodos.
- Tiene un panel de PIX con análisis de ventas.
Para reportes más detallados y exportables usa Informes.`,
  },
  {
    id: 'guide-modulo-productos',
    title: 'Para qué sirve el módulo Productos',
    keywords: purposeKeywords('productos', 'el modulo de productos', 'catalogo'),
    body: `Productos — para qué sirve:
- Crear y editar lo que vendes: nombre, precio, categoría, foto, variantes y área de producción.
- Ordenar el catálogo en categorías.
- Armar combos y productos transformados con su receta de insumos (para que el inventario descuente solo y PIX calcule el margen).
- Activar o desactivar productos y definir en qué horario se venden.
Lo que creas aquí aparece en Mesas, Caja, Delivery y el QR.`,
  },
  {
    id: 'guide-modulo-clientes',
    title: 'Para qué sirve el módulo Clientes',
    keywords: purposeKeywords('clientes', 'el modulo de clientes'),
    body: `Clientes — para qué sirve:
- Guardar los datos de tus clientes: nombre, documento, teléfono, correo y dirección.
- Buscarlos al cobrar, en créditos o en delivery.
- Ver su deuda pendiente e ir a Caja a cobrarla.
- Darles su QR y contraseña de auto pedido (por ejemplo clientes de pensión) y cargar su pedido con «Hacer pedido».
- Inscribirlos en GIT Cards si el local las usa.`,
  },
  {
    id: 'guide-modulo-fidelizacion',
    title: 'Para qué sirve el módulo Fidelización',
    keywords: purposeKeywords('fidelizacion', 'fidelización'),
    body: `Fidelización — para qué sirve:
- Panel: ver las encuestas que responden tus clientes, sus calificaciones y las de cada mozo.
- Configuración: armar la encuesta, sus preguntas y descargar su QR.
- Activar o desactivar GIT Cards, la tarjeta digital de compras y recompensas.
Sirve para saber qué opinan los clientes y hacer que vuelvan.`,
  },
  {
    id: 'guide-modulo-creditos',
    title: 'Para qué sirve el módulo Créditos',
    keywords: purposeKeywords('creditos', 'créditos', 'fiado'),
    body: `Créditos — para qué sirve:
- Llevar las cuentas de clientes que consumen ahora y pagan después (fiado).
- Registrar abonos y ver el saldo pendiente de cada cliente.
Los límites (días y monto máximo por crédito) se ajustan en Mi empresa → Pagos de créditos.`,
  },
  {
    id: 'guide-modulo-promociones',
    title: 'Para qué sirve el módulo Promociones',
    keywords: [
      ...purposeKeywords('promociones', 'ofertas', 'descuentos'),
    ],
    body: `Promociones — para qué sirve:
- Crear ofertas automáticas: porcentaje, monto fijo, precio especial, 2x1, 3x2, combo o por cantidad.
- Definir productos, vigencia, días, horario y reglas.
- Las promociones activas se aplican solas al pedir en QR, Mesas, Caja y Delivery.
- Ver usos, ventas y ahorro de los clientes en cada promoción.
Un descuento manual o cortesía a una cuenta se hace al cobrar. Su historial está en Informes → Descuentos y cortesías.`,
  },
  {
    id: 'guide-modulo-control-recursos',
    title: 'Para qué sirve Control de Recursos',
    keywords: [
      ...purposeKeywords('control de recursos', 'almacen', 'almacén', 'inventario'),
      'logistica',
    ],
    body: `Control de Recursos (almacén) — para qué sirve:
- Inventario y kardex: stock de insumos y productos, compras, recetas y el historial de cada movimiento.
- Requerimiento: pedir mercadería que falta.
- Recepción: dar ingreso a la mercadería que llegó.
- Movimiento interno: pasar stock de un almacén a otro.
- Gastos: registrar gastos del negocio que no salen de la caja.
Con esto sabes cuánto tienes, cuánto gastas y cuándo reponer.`,
  },
  {
    id: 'guide-modulo-indicadores',
    title: 'Para qué sirve el módulo Indicadores',
    keywords: purposeKeywords('indicadores', 'kpi'),
    body: `Indicadores — para qué sirve:
- Ver el desempeño del negocio en tableros: ventas, ticket promedio, rankings y alertas.
- Incluye el inicio de PIX con análisis, reportes y consejos sobre tus datos.
Úsalo para decidir el día a día. Para listados y exportaciones, usa Informes.`,
  },
  {
    id: 'guide-modulo-informes',
    title: 'Para qué sirve el módulo Informes',
    keywords: purposeKeywords('informes', 'reportes'),
    body: `Informes — para qué sirve:
Reúne los reportes del negocio, con filtros de fecha y exportación:
- Ventas, Productos y Descuentos y cortesías.
- Reportes Caja: turnos y cierres.
- Compras, Finanzas e Inventario.
- Facturación electrónica: boletas, facturas y notas enviadas a SUNAT y su estado.
- Informe de Hotelería (solo si Hotel está activo).`,
  },
  {
    id: 'guide-modulo-mi-empresa',
    title: 'Para qué sirve Mi empresa',
    keywords: purposeKeywords('mi empresa', 'mi restaurante', 'mi restaurant'),
    body: `Mi empresa — para qué sirve:
- Mi empresa: datos del negocio, logo y datos fiscales.
- Facturación electrónica: datos del emisor y comprobantes SUNAT (si el plan la incluye).
- Pagos de créditos: métodos de pago aceptados y reglas de cobro y crédito.
- Contrato: el contrato digital del servicio y su firma.
- Pago de plan: pagar la suscripción y subir el comprobante.
- Información: respaldo y restauración (solo administrador maestro).`,
  },
  {
    id: 'guide-modulo-rrhh',
    title: 'Para qué sirve Recursos humanos',
    keywords: purposeKeywords('recursos humanos', 'rrhh', 'tiempo trabajado'),
    body: `Recursos humanos — para qué sirve:
- Registrar al personal y sus horarios.
- Controlar la asistencia con el QR del local (ingreso y salida).
- Productividad POS: jornadas, productividad por persona y área, rankings y alertas.
- PIX analiza demoras de cocina, hora pico y quién está en jornada.`,
  },
  {
    id: 'guide-modulo-configuracion',
    title: 'Para qué sirve Configuración',
    keywords: purposeKeywords('configuracion', 'configuración', 'ajustes'),
    body: `Configuración — para qué sirve:
- Usuarios: crear usuarios, asignar rol y permisos por módulo.
- Salones y Mesas.
- Áreas de producción (Cocina, Bar y otras).
- Cajas del local y de qué almacén descuenta cada una.
- Impresoras y otros ajustes del sistema.
Solo el administrador entra aquí.`,
  },

  /* —— Hotel —— */
  {
    id: 'guide-hotel-operar',
    title: 'Cómo registrar el ingreso, pedidos y la salida de un huésped',
    keywords: [
      'ingreso huesped', 'check in', 'checkin', 'registrar huesped', 'salida huesped', 'check out', 'checkout',
      'cobrar habitacion', 'pedido a la habitacion', 'cuenta habitacion', 'mantenimiento habitacion', 'limpieza habitacion',
    ],
    body: `Paso a paso — Huésped en Hotel:
1. Menú Hotel → Estadías y recepción.
2. En una habitación Disponible pulsa Ingreso.
3. Completa nombre, documento, teléfono, correo y número de noches. Confirma.
4. Para cargar consumo: pulsa Pedido, agrega productos y guarda. Va a la cuenta de la habitación.
5. En el menú ⋮ de la habitación, Cuenta muestra lo consumido. Ver QR da un código para que el huésped pida desde su celular.
6. Al irse, pulsa Salida, elige el método de pago y cobra. Entra en la caja de esa habitación o, si la habitación es de Recepción, en el turno de caja abierto.
7. Tras cobrar, la habitación pasa a Mantenimiento. Cuando esté limpia, en Limpieza y mantenimiento pulsa Activar.`,
  },
  {
    id: 'guide-hotel-habitaciones',
    title: 'Cómo crear habitaciones, tipos y tarifas del Hotel',
    keywords: [
      'crear habitacion', 'nueva habitacion', 'tipos de habitacion', 'tarifa por noche', 'precio habitacion',
      'tarifa fin de semana', 'publicar habitacion',
    ],
    body: `Paso a paso — Habitaciones (solo administrador):
1. Menú Hotel → Habitaciones → crear habitación.
2. Indica número, nombre, piso, capacidad y tarifa por noche.
3. Elige dónde se cobra: Recepción o una caja.
4. Hotel → Configuración: crea Tipos de habitación con tarifa por noche y, si quieres, tarifa de fin de semana.
5. Asigna cada habitación a su tipo. Así queda publicada para la reserva web.`,
  },
  {
    id: 'guide-hotel-reservas',
    title: 'Cómo manejar reservas de habitaciones',
    keywords: [
      'reserva de habitacion', 'reservar habitacion', 'reserva hotel', 'reserva web hotel', 'confirmar reserva hotel',
      'link de reserva', 'reservar online',
    ],
    body: `Paso a paso — Reservas de Hotel:
1. Menú Hotel → Reservas (recepción o administrador).
2. Nueva reserva: fechas, huésped y habitación libre.
3. Las reservas hechas por la web (página /reservar) también aparecen aquí.
4. Revisa el pago que envió el cliente y pulsa Confirmar reserva. La habitación queda apartada.
5. El día de llegada, registra el ingreso en Estadías y recepción.
No confundir con Reservas del menú principal, que es para mesas.`,
  },

  /* —— GIT Cards —— */
  {
    id: 'guide-git-cards',
    title: 'Qué son y cómo usar las GIT Cards',
    keywords: [
      'git card', 'git cards', 'gitcard', 'tarjeta digital', 'tarjeta de fidelidad', 'tarjeta de sellos',
      'recompensa', 'canjear recompensa', 'avance git', 'aprobar avance',
    ],
    body: `GIT Cards — tarjeta digital de compras y recompensas:
- El cliente tiene una tarjeta digital. Cada compra que cumple la promoción suma un avance.
- Al llegar a la meta (por ejemplo 3 compras) gana una recompensa: un producto de cortesía, un descuento u otro premio.
Paso a paso:
1. Actívalas en Fidelización → Configuración (GIT Cards).
2. Crea la promoción en Clientes → GIT Cards → Configuración: nombre, compra mínima, meta, vigencia, recompensa y diseño de la tarjeta.
3. Inscribe al cliente con Agregar cliente (usa el registro de Clientes). El cliente también puede inscribirse desde la encuesta.
4. Los avances pendientes se aprueban o rechazan en GIT Cards.
5. Cuando tiene Recompensa disponible, se canjea en GIT Cards o se aplica como descuento al cobrar en Caja.
6. Con Copiar enlace le envías al cliente su tarjeta para que vea su progreso.`,
  },

  /* —— Perfil / Mi empresa —— */
  {
    id: 'guide-mi-perfil',
    title: 'Cómo cambiar mi nombre, usuario o contraseña',
    keywords: [
      'mi perfil', 'perfil', 'cambiar contraseña', 'cambiar clave', 'cambiar mi contraseña', 'cambiar usuario', 'cambiar mi nombre',
    ],
    body: `Paso a paso — Mi perfil:
1. Arriba a la derecha pulsa tu nombre.
2. Edita tu nombre completo o tu nombre de usuario.
3. Para cambiar la contraseña escribe la nueva dos veces.
4. Si cambias usuario o contraseña, escribe tu contraseña actual.
5. Guarda.
Si no recuerdas tu contraseña, pídele al administrador que la cambie en Configuración → Usuarios.`,
  },
  {
    id: 'guide-pagos-creditos-config',
    title: 'Cómo configurar métodos de pago y reglas de crédito',
    keywords: [
      'pagos de creditos', 'metodos de pago aceptados', 'propina sugerida', 'tolerancia de caja', 'diferencia de caja',
      'limite de credito', 'monto maximo credito', 'dias de credito', 'politica de cobro',
    ],
    body: `Paso a paso — Pagos de créditos (Mi empresa):
1. Menú Mi empresa → Pagos de créditos.
2. Marca los métodos que aceptas: efectivo, tarjeta, Yape, Plin.
3. Indica si los pagos digitales requieren número de referencia.
4. Ajusta propina sugerida (%) y la tolerancia de diferencia al cerrar caja.
5. Define días máximos y monto máximo por crédito, y si se avisa la mora.
6. Escribe la política de cobro y guarda.`,
  },
  {
    id: 'guide-contrato',
    title: 'Cómo ver y firmar el contrato del servicio',
    keywords: ['contrato', 'firmar contrato', 'firma digital', 'contrato digital', 'firma con dni'],
    body: `Paso a paso — Contrato del servicio:
1. Menú Mi empresa → Contrato.
2. Lee el contrato digital del servicio con Fadey.
3. Para firmar, sigue la firma desde el teléfono: DNI electrónico con NFC y PIN.
4. Marca que revisaste el contrato y confirma. Queda la firma registrada.
El texto del contrato solo lo edita el administrador maestro.`,
  },

  /* —— Lo que ve el cliente final —— */
  {
    id: 'guide-cliente-que-ve',
    title: 'Qué páginas ve tu cliente',
    keywords: [
      'que ve el cliente', 'pagina del cliente', 'paginas publicas', 'lo que ve el cliente', 'vista del cliente',
      'cliente final', 'comensal',
    ],
    body: `Páginas que usa tu cliente (sin entrar al POS):
- QR de mesa (Auto pedido): ve la carta, arma su pedido y lo envía a cocina. Se cobra en Caja.
- Auto pedido de cliente: el cliente con contraseña (por ejemplo de pensión) se identifica y pide a su cuenta.
- Carta web: ve el menú, arma su carrito y pide para recoger o delivery. Luego sigue su pedido.
- Encuesta: califica la atención y deja comentarios.
- GIT Card: ve su tarjeta digital, su avance y sus recompensas.
- Reserva de hotel: busca habitaciones libres y aparta una.
Pregúntame por cualquiera, por ejemplo «qué ve el cliente al escanear el QR».`,
  },
  {
    id: 'guide-cliente-qr-mesa',
    title: 'Qué ve el cliente al escanear el QR de la mesa',
    keywords: [
      'cliente escanea', 'escanear qr', 'que ve el cliente qr', 'pedir desde el celular', 'cliente pide solo',
      'pedido del cliente qr', 'auto pedido cliente',
    ],
    body: `Lo que vive el cliente con el QR de la mesa:
1. Escanea el QR pegado en la mesa con la cámara del celular.
2. Se abre la carta (productos, cartas o ambos, según lo que elegiste en Auto pedido).
3. Agrega productos a «Tu pedido» y lo envía.
4. El pedido aparece en cocina o bar y queda en la cuenta de esa mesa.
5. El pago se hace en Caja como cualquier mesa.
Cliente con cuenta propia (pensión): en su QR personal escribe la contraseña que le dio el restaurante, se identifica y pide a su cuenta.
Huésped de Hotel: escanea el QR de su habitación (Hotel → menú ⋮ → Ver QR) y pide igual. El consumo va a la cuenta de la habitación.`,
  },
  {
    id: 'guide-cliente-carta-web',
    title: 'Cómo pide el cliente por la carta web',
    keywords: [
      'carta web', 'menu web', 'pedido online', 'pedido por internet', 'carrito', 'mis pedidos',
      'seguimiento de pedido', 'tracking', 'recoger pedido', 'para llevar web',
    ],
    body: `Lo que vive el cliente en la carta web:
1. Entra a la página del restaurante y ve «Nuestro Menú», con buscador y variantes.
2. Agrega productos al carrito.
3. En el carrito elige el tipo de pedido: recoger o Delivery (si está activo). Para delivery escribe la dirección.
4. Ve el resumen (subtotal, IGV y costo de envío) y confirma. Para pedir crea una cuenta o inicia sesión con su correo.
5. En Mis pedidos ve sus pedidos y abre el detalle para seguir el estado.
Los pedidos llegan al POS para prepararlos y cobrarlos.`,
  },
  {
    id: 'guide-cliente-encuesta',
    title: 'Qué ve el cliente en la encuesta',
    keywords: ['cliente responde encuesta', 'que ve el cliente encuesta', 'llenar encuesta', 'encuesta publica'],
    body: `Lo que vive el cliente en la encuesta:
1. Escanea el QR de la encuesta (en la mesa o la entrada).
2. Escribe su nombre, elige al mozo que lo atendió, la fecha y el área.
3. Califica cada pregunta, marca lo que más le gustó y lo que mejoraría, y deja un comentario.
4. Pulsa Enviar encuesta.
5. Si GIT Cards está activo, puede inscribirse y ver su tarjeta.
Las respuestas te llegan en Fidelización → Panel.`,
  },
  {
    id: 'guide-cliente-reserva-hotel',
    title: 'Cómo reserva el cliente una habitación por la web',
    keywords: [
      'cliente reserva habitacion', 'reserva por la web', 'pagina de reserva', 'reservar habitacion online',
      'apartar habitacion', 'codigo de reserva',
    ],
    body: `Lo que vive el cliente en «Reserva tu habitación»:
1. Abre el enlace de reserva del hotel.
2. Elige fechas de entrada y salida y número de personas, y pulsa Buscar.
3. Elige una habitación libre y pulsa Apartar 15 minutos.
4. Recibe un código de reserva y envía el comprobante de pago por WhatsApp.
5. Recepción revisa el pago y confirma la reserva en Hotel → Reservas.
Si no hay habitaciones en esas fechas, la página le pide probar otra entrada o menos personas.`,
  },
];

module.exports = { MODULE_GUIDES };
