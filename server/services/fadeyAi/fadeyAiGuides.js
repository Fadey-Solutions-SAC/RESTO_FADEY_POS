/**
 * Guías paso a paso del POS Resto Fadey (conocimiento base de la IA Fadey).
 * Cubren los módulos del menú y operaciones habituales del local.
 */
const OPERATION_GUIDES = [
  /* —— Caja —— */
  {
    id: 'guide-abrir-caja',
    title: 'Cómo abrir caja (inicio de turno)',
    keywords: ['abrir caja', 'apertura', 'abrir turno', 'monto inicial', 'fondo de caja'],
    body: `Paso a paso — Abrir caja:
1. Entra a Caja → Apertura y cierre.
2. Si no hay turno abierto, pulsa Abrir / Apertura.
3. Ingresa el monto inicial de efectivo (fondo de caja).
4. Confirma. Ya puedes cobrar mesas y pedidos.
5. Los ingresos y egresos del turno se registran en Caja → Ingresos / Egresos.`,
  },
  {
    id: 'guide-cerrar-caja',
    title: 'Cómo cerrar caja (cierre de turno)',
    keywords: ['cerrar caja', 'cierre', 'cierre de caja', 'cerrar turno', 'arqueo', 'apertura y cierre'],
    body: `Paso a paso — Cerrar caja:
1. Inicia sesión como admin o cajero con permiso de caja.
2. Menú Caja → Apertura y cierre (o Cierres de caja).
3. Verifica que el turno esté abierto (si no hay turno, primero haz Apertura).
4. Revisa el resumen: ventas, ingresos, egresos y efectivo esperado.
5. Cuenta el efectivo real e indícalo en el cierre (arqueo).
6. Confirma el cierre. El turno queda cerrado.
7. Históricos: Caja → Cierres de caja.
Nota: no se puede cobrar con el turno cerrado; hay que abrir uno nuevo.`,
  },
  {
    id: 'guide-cobrar',
    title: 'Cómo cobrar una mesa o pedido',
    keywords: ['cobrar', 'pago', 'facturar', 'cobro', 'pagar cuenta', 'registrar venta', 'efectivo', 'tarjeta', 'yape', 'plin'],
    body: `Paso a paso — Cobrar:
1. Asegúrate de tener turno de caja abierto.
2. Abre Caja → Cobrar (o Mesas) y selecciona la mesa/cuenta pendiente.
3. Revisa productos, descuentos y propina si aplica.
4. Elige método(s) de pago (efectivo, tarjeta, Yape, Plin, etc.).
5. Confirma el cobro. La cuenta queda pagada y la mesa se libera si no quedan pedidos activos.
6. El ticket puede imprimirse si la impresora de caja está configurada.`,
  },
  {
    id: 'guide-caja-ingresos-egresos',
    title: 'Cómo registrar ingresos o egresos de caja',
    keywords: ['ingresos', 'egresos', 'gasto caja', 'entrada efectivo', 'salida efectivo', 'movimiento caja'],
    body: `Paso a paso — Ingresos / Egresos:
1. Abre Caja con turno abierto.
2. Ve a Caja → Ingresos (dinero que entra al cajón fuera de una venta) o Egresos (salidas).
3. Pulsa Nuevo / Agregar.
4. Indica monto, motivo/categoría y confirma.
5. Queda registrado en el turno y afecta el arqueo al cerrar.
Nota: no confundir con Gastos de almacén (Control de recursos → Gastos).`,
  },
  {
    id: 'guide-cierres-historial',
    title: 'Cómo ver cierres de caja anteriores',
    keywords: ['cierres de caja', 'historial cierre', 'arqueos anteriores', 'reporte cierre'],
    body: `Paso a paso — Cierres de caja:
1. Menú Caja → Cierres de caja.
2. Filtra por fecha o caja si el sistema lo ofrece.
3. Abre un cierre para ver ventas, efectivo esperado vs contado y diferencias.
4. Desde ahí puedes exportar o imprimir según permisos.`,
  },
  {
    id: 'guide-notas-credito-debito',
    title: 'Cómo emitir notas de crédito o débito',
    keywords: ['nota de credito', 'nota de debito', 'notas credito', 'notas debito', 'anular boleta', 'corregir factura'],
    body: `Paso a paso — Notas de crédito / débito:
1. Entra a Caja (o Informes → Facturación, según tu plan).
2. Busca Notas de crédito / Notas de débito (si tu plan y permisos las habilitan).
3. Selecciona el comprobante original a corregir.
4. Indica motivo, montos e ítems afectados.
5. Confirma. Queda el documento vinculado a la venta original.
Nota: requiere facturación electrónica / plan que lo permita. Si no ves la opción, el maestro o el plan la tienen apagada.`,
  },
  {
    id: 'guide-mapa-mesas-caja',
    title: 'Cómo usar el mapa de mesas en Caja',
    keywords: ['mapa de mesas', 'mapa mesas caja', 'ver mesas en caja'],
    body: `Paso a paso — Mapa de mesas (Caja):
1. Caja → Mapa de Mesas (o Cobrar según vista).
2. Filtra por salón si hay varios.
3. Toca una mesa libre para abrir cuenta o una ocupada para ver/cobrar.
4. Desde ahí puedes agregar productos, trasladar o cobrar.`,
  },

  /* —— Mesas —— */
  {
    id: 'guide-mesas-pedido',
    title: 'Cómo tomar un pedido en mesa',
    keywords: ['pedido mesa', 'tomar pedido', 'enviar cocina', 'comanda', 'agregar productos mesa'],
    body: `Paso a paso — Pedido en salón:
1. Abre Mesas (mozo/admin) o Caja.
2. Elige salón y toca la mesa libre o con cuenta.
3. Agrega productos por categoría; indica notas o modificadores.
4. Envía / confirma: la comanda va a cocina/bar según el área de cada producto.
5. Puedes agregar más ítems después.
6. Al terminar, cobra en Caja para liberar la mesa.`,
  },
  {
    id: 'guide-mover-pedido',
    title: 'Cómo mover un pedido o cuenta a otra mesa',
    keywords: ['mover pedido', 'mover cuenta', 'trasladar', 'traslado', 'transferir mesa', 'cambiar mesa', 'pasar pedido'],
    body: `Paso a paso — Mover pedido / traslado de mesa:
1. Entra a Mesas o Caja (según tu permiso).
2. Abre la mesa de origen (la que tiene el pedido o la cuenta).
3. Busca la opción de traslado / mover / transferir (modal de mesa o menú de la cuenta).
4. Elige destino:
   - Mover toda la cuenta a otra mesa
   - Mover solo algunos productos a otra mesa (si el sistema lo ofrece)
5. Selecciona la mesa destino (libre o con cuenta; si tiene cuenta, puede unirse).
6. Confirma (los pedidos pasan a la mesa destino y la origen se libera si quedó vacía).
Importante:
- Trasladar ≠ anular: el pedido sigue activo, solo cambia de mesa.
- Para liberar sin mover, usa anular/liberar mesa (requiere permiso).`,
  },
  {
    id: 'guide-liberar-mesa',
    title: 'Cómo liberar o anular una mesa',
    keywords: ['liberar mesa', 'anular pedido', 'cancelar mesa', 'vaciar mesa', 'eliminar mesa ocupada'],
    body: `Paso a paso — Liberar mesa:
1. Si la cuenta ya se cobró, la mesa suele liberarse sola.
2. Si hay error: Caja/Mesas → mesa → opción anular / liberar (permiso «Eliminar y liberar mesa»).
3. Confirma. Los pedidos activos se anulan y la mesa queda libre.
4. No confundir con traslado: traslado mueve la cuenta sin anular.`,
  },
  {
    id: 'guide-unir-cuentas',
    title: 'Cómo unir o juntar cuentas de mesas',
    keywords: ['unir mesas', 'juntar cuentas', 'fusionar cuenta', 'unir cuenta', 'combinar mesas'],
    body: `Paso a paso — Unir cuentas:
1. Abre Mesas o Caja.
2. En la mesa origen usa traslado / unir cuenta hacia la mesa destino que ya tiene cuenta.
3. Confirma la unión. Los ítems quedan en una sola cuenta.
4. Cobra la cuenta unificada en Caja.
Nota: si solo quieres pasar algunos productos, usa traslado parcial (cuando esté disponible).`,
  },
  {
    id: 'guide-anular-producto',
    title: 'Cómo anular o quitar un producto del pedido',
    keywords: ['anular producto', 'quitar plato', 'eliminar item', 'borrar linea', 'cortesia anular', 'cancelar producto'],
    body: `Paso a paso — Anular producto del pedido:
1. Abre la mesa o cuenta en Mesas/Caja.
2. Selecciona la línea del producto.
3. Usa Quitar / Anular (puede pedir motivo o categoría de anulación).
4. Confirma. Si ya se envió a cocina, avisa al área de producción.
Nota: requiere permiso; algunas anulaciones quedan registradas en informes de descuentos/cortesías.`,
  },
  {
    id: 'guide-salones-mesas',
    title: 'Cómo configurar salones y mesas',
    keywords: ['salon', 'salón', 'salones', 'mesas', 'mapa mesas', 'zona', 'crear mesa', 'agregar mesa'],
    body: `Paso a paso — Salones y mesas:
1. Admin → Configuración → Salones y Mesas.
2. Crea salones/zonas (ej. Terraza, Salón principal).
3. Dentro de cada salón agrega mesas (número o nombre).
4. Guarda. En Mesas/Caja verás pestañas por salón.
5. Genera/imprime QR por mesa desde Auto pedido.
6. Para mover pedidos entre mesas usa traslado en el mapa.`,
  },

  /* —— Producción / Cocina / Bar —— */
  {
    id: 'guide-cocina',
    title: 'Cómo trabajar en cocina / producción',
    keywords: ['cocina', 'marcar listo', 'preparacion', 'producción', 'comanda cocina', 'pedido listo'],
    body: `Paso a paso — Cocina / producción:
1. Si hay jornada por QR: marca asistencia antes.
2. Entra al módulo Cocina o tu área de producción.
3. Verás pedidos pendientes; prepáralos y márcalos listos.
4. Activa el sonido al entrar (pedidos nuevos).
5. Configuración del área: impresora + URL del asistente de impresión.`,
  },
  {
    id: 'guide-bar',
    title: 'Cómo trabajar en bar',
    keywords: ['bar', 'barra', 'tragos', 'bebidas bar', 'comanda bar'],
    body: `Paso a paso — Bar:
1. Entra al módulo Bar (o tu área de producción tipo bar).
2. Atiende comandas de bebidas/tragos pendientes.
3. Marca en preparación y luego listo.
4. Configura impresora y sonido en el panel del área.
Nota: los productos deben tener área de producción = Bar (o el área creada).`,
  },
  {
    id: 'guide-crear-area-produccion',
    title: 'Cómo crear un área de producción',
    keywords: [
      'crear area', 'crear área', 'nueva area', 'nueva área', 'area de produccion',
      'área de producción', 'agregar area', 'añadir area', 'creo un area', 'creo un área',
    ],
    body: `Paso a paso — Crear un área de producción:
1. Inicia sesión como administrador.
2. Ve a Configuración (menú lateral).
3. Abre Áreas de producción (cerca de Cajas).
4. Pulsa Agregar / Nueva área.
5. Escribe el nombre (ej. Parrilla, Postres, Barra 2).
6. Guarda. Aparece al editar productos y usuarios.
7. Opcional: asigna usuarios o vincula productos.
8. Quienes tengan esa área verán su panel en Producción / Cocina / Bar.
Nota: crear el área ≠ asignarla. Para vincularla, edita usuario o producto.`,
  },
  {
    id: 'guide-area-produccion',
    title: 'Cómo vincular un área de producción a un usuario o producto',
    keywords: ['vincular area', 'vincular área', 'asignar area', 'asignar cocina', 'vincular cocina', 'vincular bar'],
    body: `Paso a paso — Vincular un área ya existente:
A) A un usuario:
1. Configuración → Usuarios → editar.
2. Rol producción / cocina / bar y elige el área.
3. Guarda.
B) A un producto:
1. Productos → editar plato.
2. Campo área de producción.
3. Al pedir, la comanda llega a ese panel.
Para crear un área nueva, pregunta «cómo crear un área de producción».`,
  },

  /* —— Delivery —— */
  {
    id: 'guide-delivery',
    title: 'Cómo operar delivery',
    keywords: ['delivery', 'reparto', 'delivery pedido', 'domicilio', 'repartidor'],
    body: `Paso a paso — Delivery:
1. Crea pedido tipo delivery desde Caja/Mesas o módulo Delivery.
2. Completa cliente, dirección y productos.
3. Cocina/bar preparan; cuando esté listo asigna repartidor.
4. El repartidor marca en camino / entregado en su panel (/delivery).
5. Si Delivery no aparece, puede estar desactivado en Mi empresa / configuración del local.`,
  },

  /* —— Reservas —— */
  {
    id: 'guide-reservas',
    title: 'Cómo crear una reserva',
    keywords: ['reserva', 'reservar mesa', 'reservaciones', 'nueva reserva', 'cita mesa'],
    body: `Paso a paso — Reservas:
1. Menú Reservas.
2. Nueva reserva: cliente, fecha/hora, personas, mesa si aplica.
3. Guarda. Caja puede recibir avisos cercanos a la hora.
4. Puedes armar el pedido anticipado (misma carta que Mesas).
5. Al llegar el cliente, abre/confirma la mesa y cobra normalmente.
6. Cancela o reprograma desde el detalle de la reserva si hace falta.`,
  },

  /* —— Auto pedido QR —— */
  {
    id: 'guide-auto-pedido-cartas',
    title: 'Cómo cargar una carta al Auto pedido QR',
    keywords: ['carta', 'cartas', 'auto pedido', 'auto-pedido', 'qr mesa', 'cargar carta', 'menú digital'],
    body: `Paso a paso — Cargar carta al Auto pedido QR:
1. Admin → Auto pedido.
2. Sección Cartas / menús digitales.
3. Crea o edita: nombre, imagen y productos.
4. Guarda. Queda disponible para el QR.
5. Configura qué ve el cliente al escanear (productos / cartas / ambos).
6. Imprime o descarga el QR de cada mesa.`,
  },
  {
    id: 'guide-qr-home-productos-cartas',
    title: 'Cómo mostrar productos o cartas en el QR (y viceversa)',
    keywords: ['productos en vez de carta', 'carta en vez de productos', 'qr home', 'inicio qr', 'ambos', 'ver productos', 'ver carta'],
    body: `Paso a paso — Qué ve el cliente al escanear el QR:
1. Admin → Auto pedido.
2. Opción de inicio del QR (productos, cartas o ambos).
3. Elige Productos, Cartas o Ambos.
4. Guarda.
5. Prueba escaneando el QR de una mesa.
6. Según el modo, el cliente puede cambiar entre vistas.`,
  },
  {
    id: 'guide-qr-imprimir',
    title: 'Cómo generar e imprimir el QR de una mesa',
    keywords: ['imprimir qr', 'generar qr', 'codigo qr mesa', 'descargar qr', 'qr auto pedido'],
    body: `Paso a paso — QR de mesa:
1. Admin → Auto pedido (o Mesas / Configuración según tu flujo).
2. Selecciona la mesa.
3. Genera o descarga el código QR.
4. Imprímelo y colócalo en la mesa.
5. El cliente escanea y pide sin mozo (si Auto pedido está activo).`,
  },

  /* —— Clientes / créditos / fidelización —— */
  {
    id: 'guide-clientes',
    title: 'Cómo registrar o editar un cliente',
    keywords: ['clientes', 'crear cliente', 'nuevo cliente', 'ficha cliente', 'buscar cliente'],
    body: `Paso a paso — Clientes:
1. Menú Clientes.
2. Nuevo: nombre, documento, teléfono, correo, dirección.
3. Guarda. Puedes buscarlo al cobrar o en créditos/delivery.
4. Edita o desactiva desde el mismo listado.`,
  },
  {
    id: 'guide-creditos',
    title: 'Cómo usar créditos de clientes',
    keywords: ['creditos', 'créditos', 'fiado', 'cuenta cliente', 'cobrar credito', 'pago credito', 'abono cliente'],
    body: `Paso a paso — Créditos:
1. Menú Créditos.
2. Selecciona o crea el cliente.
3. Registra un crédito (venta a cuenta) o un abono/pago.
4. Revisa el saldo pendiente.
5. Al cobrar en Caja puedes aplicar pago a crédito si el flujo del local lo permite.
Nota: créditos ≠ encuestas. Para la encuesta de satisfacción ve a Fidelización → Configuración.`,
  },
  {
    id: 'guide-encuesta-clientes',
    title: 'Cómo configurar la encuesta para clientes',
    keywords: [
      'encuesta', 'encuestas', 'configurar encuesta', 'encuesta clientes', 'encuesta satisfaccion',
      'satisfacción', 'qr encuesta', 'formulario clientes', 'calificacion clientes', 'opinión cliente',
    ],
    body: `Paso a paso — Encuesta de clientes (Fidelización):
1. Menú Fidelización (permiso admin/cajero según tu plan).
2. Abre la pestaña Configuración.
3. Arma el formato del cuadro: título, textos, estilo tipográfico y etiquetas de campos.
4. Define áreas del negocio (ej. Restaurante, Terraza) y marca cuáles aparecen.
5. Ajusta filas de calificación (Excelente → Muy malo) y preguntas / opciones «más le gustó» y «mejorar».
6. Pulsa Guardar formato.
7. Descarga el QR de la encuesta (PNG) y colócalo en mesas o la entrada.
8. El cliente escanea el QR (/encuesta), completa y envía. Las respuestas salen en Fidelización (resumen y listado).
9. Opcional: imprime una encuesta respondida en la impresora de caja desde el listado.
Nota: no confundir con Créditos (fiado/cuenta). La encuesta es solo opinión/calificación.`,
  },
  {
    id: 'guide-fidelizacion',
    title: 'Cómo usar fidelización / puntos',
    keywords: ['fidelizacion', 'fidelización', 'puntos', 'cliente frecuente', 'premios', 'loyalty', 'canjear puntos'],
    body: `Paso a paso — Fidelización:
1. Menú Fidelización (admin/cajero con permiso).
2. Revisa el resumen de encuestas y calificaciones de mozos.
3. Para configurar el formulario y el QR: pestaña Configuración (ver guía de encuesta).
4. Si el local usa puntos/premios, acumula o canjea al identificar al cliente al cobrar.
Nota: si no aparece, falta permiso o el plan lo desactivó.`,
  },

  /* —— Ofertas / descuentos —— */
  {
    id: 'guide-ofertas',
    title: 'Cómo crear una oferta',
    keywords: ['ofertas', 'promocion', 'promoción', '2x1', 'combo oferta', 'crear oferta'],
    body: `Paso a paso — Ofertas:
1. Admin → Ofertas.
2. Nueva oferta: nombre, vigencia, productos o condiciones.
3. Activa la oferta.
4. Al pedir/cobrar se aplica según las reglas configuradas.
5. Desactiva o edita cuando termine la campaña.`,
  },
  {
    id: 'guide-descuentos',
    title: 'Cómo aplicar un descuento o cortesía',
    keywords: ['descuento', 'descuentos', 'cortesia', 'cortesía', 'rebaja', 'porcentaje descuento'],
    body: `Paso a paso — Descuentos / cortesías:
1. Abre la cuenta en Mesas o Caja.
2. Usa la opción de descuento / cortesía (puede pedir motivo).
3. Indica monto o porcentaje y confirma.
4. Admin → Descuentos configura reglas o catálogo de motivos.
5. Informes → Descuentos y cortesías muestra el histórico.
Nota: requiere permiso; queda trazabilidad para auditoría.`,
  },

  /* —— Productos —— */
  {
    id: 'guide-productos',
    title: 'Cómo crear o editar un producto',
    keywords: ['crear producto', 'editar plato', 'carta productos', 'precio', 'stock producto', 'nuevo producto'],
    body: `Paso a paso — Productos:
1. Admin → Productos.
2. Nuevo: nombre, precio, categoría, imagen opcional.
3. Asigna área de producción (cocina/bar/otra).
4. Activa/desactiva para que aparezca en la carta.
5. Stock: transformado vs no transformado (Productos o Almacén).
6. Guarda. Ya puede pedirse en Mesas, Caja, Reservas y Auto pedido.`,
  },
  {
    id: 'guide-categorias',
    title: 'Cómo gestionar categorías de productos',
    keywords: ['categoria', 'categoría', 'categorias', 'rubro', 'grupo productos'],
    body: `Paso a paso — Categorías:
1. Admin → Productos (o Configuración según tu versión).
2. Abre Categorías.
3. Crea o edita nombre y orden.
4. Asigna cada producto a una categoría.
5. En Mesas/Caja el catálogo se filtra por esas categorías.`,
  },
  {
    id: 'guide-combos-recetas',
    title: 'Cómo armar combos o productos transformados',
    keywords: ['combo', 'receta', 'transformado', 'insumos producto', 'ficha tecnica', 'producto compuesto'],
    body: `Paso a paso — Combos / transformados:
1. Productos → editar o crear el ítem.
2. Si es transformado: define insumos/receta que descuenta almacén al vender.
3. Si es combo: incluye los productos o componentes del paquete.
4. Guarda y prueba pidiendo uno en una mesa de prueba.
5. El stock de insumos baja según recepción y movimientos de almacén.`,
  },

  /* —— Almacén —— */
  {
    id: 'guide-requerimiento',
    title: 'Cómo generar un requerimiento de almacén',
    keywords: ['requerimiento', 'requerir', 'pedido a almacén', 'solicitar insumos', 'almacen'],
    body: `Paso a paso — Requerimiento:
1. Admin (o rol con Almacén → Requerimiento).
2. Control de recursos → Requerimiento.
3. Selecciona área/almacén destino si aplica.
4. Agrega insumos o productos no transformables (cantidad).
5. Guarda / envía el requerimiento.
6. Queda para que Almacén prepare o apruebe.
Nota: si no ves «Requerimiento», el maestro o tu permiso lo bloquean.`,
  },
  {
    id: 'guide-recepcion',
    title: 'Cómo hacer una recepción de mercadería',
    keywords: ['recepcion', 'recepción', 'recibir compra', 'ingreso mercaderia', 'compra almacén'],
    body: `Paso a paso — Recepción:
1. Control de recursos → Recepción.
2. Nueva recepción (proveedor, fecha, documento).
3. Agrega ítems con cantidades y costos.
4. Confirma. El stock se actualiza.
5. Puedes cruzar con un requerimiento previo.`,
  },
  {
    id: 'guide-movimiento-interno',
    title: 'Cómo hacer un movimiento interno de almacén',
    keywords: ['movimiento interno', 'transferir stock', 'traslado almacén', 'pasar insumos'],
    body: `Paso a paso — Movimiento interno:
1. Control de recursos → Movimiento interno.
2. Indica origen, destino y productos/insumos.
3. Cantidades y confirma.
4. El kardex refleja la salida y entrada entre ubicaciones.`,
  },
  {
    id: 'guide-inventario-kardex',
    title: 'Cómo ver inventario y kardex',
    keywords: ['inventario', 'kardex', 'stock', 'existencia', 'logistica', 'consultar stock'],
    body: `Paso a paso — Inventario / kardex:
1. Control de recursos → Inventario y kardex.
2. Busca el producto o insumo.
3. Revisa existencias, entradas, salidas y saldos.
4. Informes → Inventario también resume movimientos.
5. Stock bajo: la IA/avisos pueden alertar tras el aprendizaje.`,
  },
  {
    id: 'guide-gastos-almacen',
    title: 'Cómo registrar gastos de almacén',
    keywords: ['gastos', 'gasto almacen', 'gastos almacén', 'egreso almacen'],
    body: `Paso a paso — Gastos (Control de recursos):
1. Control de recursos → Gastos.
2. Nuevo gasto: concepto, monto, fecha.
3. Guarda. Queda en reportes de finanzas/compras según configuración.
Nota: distinto de Egresos de caja (turno de cajero).`,
  },

  /* —— Informes / ventas / indicadores —— */
  {
    id: 'guide-informes',
    title: 'Cómo ver informes y reportes',
    keywords: ['informes', 'reportes', 'estadisticas', 'reporte ventas', 'informe caja', 'informe productos'],
    body: `Paso a paso — Informes:
1. Menú Informes.
2. Elige la vista: Ventas, Descuentos y cortesías, Productos, Reportes Caja, Compras, Finanzas, Facturación, Inventario.
3. Filtra por fecha, caja o salón si aplica.
4. Exporta (CSV/TXT/PDF) cuando el botón esté disponible.
5. Ventas rápidas también en el módulo Ventas del menú.`,
  },
  {
    id: 'guide-ventas',
    title: 'Cómo consultar ventas del día o del mes',
    keywords: ['ventas', 'cuanto vendimos', 'resumen ventas', 'venta del dia', 'facturacion del dia'],
    body: `Paso a paso — Consultar ventas:
1. Escritorio (resumen) o menú Ventas / Informes → Ventas.
2. Elige rango: hoy, semana, mes o personalizado.
3. Filtra por caja si tienes varias.
4. Revisa totales, tickets y métodos de pago.
5. Pregúntame «ventas de hoy» si tu rol permite datos en vivo.`,
  },
  {
    id: 'guide-indicadores',
    title: 'Cómo usar Indicadores',
    keywords: ['indicadores', 'kpi', 'tablero', 'metricas', 'dashboard indicadores'],
    body: `Paso a paso — Indicadores:
1. Menú Indicadores (admin).
2. Revisa paneles de desempeño, alertas y rankings.
3. Cambia pestañas/filtros de fecha.
4. Usa la vista para decisiones diarias junto con Informes.`,
  },
  {
    id: 'guide-escritorio',
    title: 'Cómo usar el Escritorio',
    keywords: ['escritorio', 'inicio', 'dashboard', 'panel principal', 'resumen'],
    body: `Paso a paso — Escritorio:
1. Tras iniciar sesión como admin/cajero, abre Escritorio.
2. Verás resumen de ventas, caja y accesos rápidos.
3. Filtra por periodo (semana, mes, todos) y por caja.
4. Desde aquí entras a módulos del menú lateral.`,
  },

  /* —— Usuarios / config —— */
  {
    id: 'guide-crear-usuario',
    title: 'Cómo crear un usuario',
    keywords: ['crear usuario', 'nuevo usuario', 'alta personal', 'empleado usuario', 'usuarios'],
    body: `Paso a paso — Crear usuario:
1. Admin → Configuración → Usuarios.
2. Pulsa Nuevo / Agregar usuario.
3. Completa usuario, contraseña, nombre y rol.
4. Activa permisos de módulos (Caja, Mesas, Cocina, Almacén…).
5. Si es cajero o mozo: asigna una caja.
6. Si es producción/cocina/bar: vincula el área.
7. Guarda. Ya puede iniciar sesión.
8. Con RRHH/QR, crea ficha de trabajador vinculada.`,
  },
  {
    id: 'guide-permisos-usuario',
    title: 'Cómo dar o quitar permisos a un usuario',
    keywords: ['permisos', 'modulos usuario', 'activar modulo', 'quitar acceso', 'roles'],
    body: `Paso a paso — Permisos:
1. Configuración → Usuarios → editar.
2. Marca o desmarca módulos (Caja, Mesas, Almacén, Informes…).
3. Ajusta subpermisos si aparecen (requerimiento, liberar mesa, etc.).
4. Guarda. El usuario debe volver a entrar o refrescar para ver cambios.
Nota: el Admin Maestro también puede limitar módulos por plan.`,
  },
  {
    id: 'guide-cajas-config',
    title: 'Cómo configurar cajas del local',
    keywords: ['configurar caja', 'crear caja', 'estaciones caja', 'cajas configuracion'],
    body: `Paso a paso — Cajas (configuración):
1. Configuración → Cajas.
2. Agrega o edita cajas (nombre, activa).
3. Asigna usuarios cajeros/mozos a una caja.
4. Cada turno de apertura usa la caja asignada.
5. Impresora de tickets: Caja → Impresora + app escritorio.`,
  },
  {
    id: 'guide-impresora',
    title: 'Cómo configurar la impresora térmica',
    keywords: ['impresora', 'imprimir', 'térmica', 'escpos', 'asistente impresión', 'usb', 'ticket'],
    body: `Paso a paso — Impresora:
1. Instala y abre la app de escritorio Resto FADEY en la PC de caja/cocina.
2. En el POS:
   - Caja → Impresora (tickets de cobro)
   - Cocina / Bar / área: Configuración de impresión
3. Verifica el vínculo (ej. http://127.0.0.1:3002).
4. Elige USB o Red, ancho 58/80 mm e impresora.
5. Guarda e Imprimir prueba.
6. En cocina/bar activa sonido de pedidos nuevos.
Sin la app abierta, la detección USB no funciona.`,
  },
  {
    id: 'guide-config-general',
    title: 'Mapa rápido de Configuración y menú',
    keywords: ['configuracion', 'ajustes', 'dónde está', 'menu', 'módulos', 'donde encuentro'],
    body: `Dónde encontrar cada cosa:
- Usuarios y roles: Configuración → Usuarios
- Salones y mesas: Configuración → Salones y Mesas
- Áreas de producción: Configuración → Áreas de producción
- Cajas del local: Configuración → Cajas
- Impresoras: Caja/Cocina/Bar + app escritorio
- Auto pedido QR y cartas: menú Auto pedido
- Almacén: Control de recursos (requerimiento, recepción, kardex, gastos)
- Caja operativa: Cobrar, apertura/cierre, ingresos/egresos
- Clientes, créditos, fidelización/encuestas, ofertas, descuentos: menú lateral
- Informes y ventas: Informes / Ventas / Escritorio
- RRHH y asistencia: Recursos humanos / Asistencia QR
- Mi empresa y pago de plan: Mi empresa
- Mensajes del equipo: icono Mensajes en la cabecera
- IA Fadey: icono IA (activa en Admin Maestro)
Si un ítem no aparece: falta permiso o el plan/maestro lo desactivó.`,
  },

  /* —— RRHH / asistencia —— */
  {
    id: 'guide-asistencia',
    title: 'Cómo marcar asistencia con QR',
    keywords: ['asistencia', 'marcar ingreso', 'jornada qr', 'escanear qr', 'marcar salida'],
    body: `Paso a paso — Asistencia QR:
1. Inicia sesión con tu usuario.
2. Ve a Asistencia QR.
3. Escanea el QR único del local.
4. Primer escaneo = ingreso; segundo = salida.
5. Si ya estás activo, al iniciar sesión entras directo a tu módulo.`,
  },
  {
    id: 'guide-rrhh',
    title: 'Cómo usar Recursos humanos',
    keywords: ['rrhh', 'recursos humanos', 'tiempo trabajado', 'empleados', 'horario', 'plantilla horario'],
    body: `Paso a paso — RRHH / Tiempo trabajado:
1. Admin → Recursos humanos.
2. Activa o desactiva jornada por QR.
3. Personal: alta, horarios (plantilla o personalizado).
4. Genera/regenera el QR compartido de asistencia.
5. Productividad: activos, horas y alertas.
6. Tras reset de fábrica, los datos HR también se limpian.`,
  },

  /* —— Mi empresa —— */
  {
    id: 'guide-mi-restaurant',
    title: 'Cómo configurar Mi empresa',
    keywords: ['mi empresa', 'mi restaurante', 'datos fiscales', 'logo', 'razon social'],
    body: `Paso a paso — Mi empresa:
1. Menú Mi empresa.
2. Completa datos del local, logo y branding.
3. Revisa Información y Contrato.
4. Pago de plan: carga comprobante cuando el sistema lo pida.
5. Facturación electrónica (SUNAT): si el plan/maestro lo habilita.`,
  },
  {
    id: 'guide-pago-plan',
    title: 'Cómo pagar el plan y subir comprobante',
    keywords: ['pago de plan', 'comprobante', 'pagar sistema', 'subir voucher', 'bloqueo pago', 'pago uso'],
    body: `Paso a paso — Pago de plan:
1. Cuando haya aviso de pago, abre Notificaciones o Mi empresa → Pago de plan.
2. Revisa el monto y datos de pago.
3. Sube el comprobante (imagen/PDF).
4. Espera aprobación del Admin Maestro.
5. Si el sistema está bloqueado por mora, el login indica cómo desbloquear tras pagar.`,
  },
  {
    id: 'guide-facturacion-electronica',
    title: 'Cómo configurar facturación electrónica',
    keywords: ['facturacion electronica', 'sunat', 'boleta', 'factura electronica', 'cpe'],
    body: `Paso a paso — Facturación electrónica:
1. Mi empresa → Facturación electrónica (si el plan lo incluye).
2. Completa datos del emisor y credenciales según el asistente.
3. Activa tipos de comprobante (boleta/factura).
4. Al cobrar, elige el comprobante; se emite según configuración.
5. Informes → Facturación para consultar emitidos.
Nota: sin habilitación del maestro o plan básico, la opción no aparece.`,
  },

  /* —— Comunicación / sistema —— */
  {
    id: 'guide-mensajes',
    title: 'Cómo usar Mensajes del equipo',
    keywords: ['mensajes', 'chat interno', 'chat de grupo', 'mensaje privado', 'hablar con'],
    body: `Paso a paso — Mensajes:
1. En la cabecera toca el icono Mensajes (globo).
2. Chat de grupo: escribe y envía (visible para el equipo, ciclo 24 h).
3. Mensaje privado: elige destinatario y escribe.
4. Si llega un mensaje con el panel cerrado, verás toast y badge.
5. No es el chat de la IA: la IA es el icono de robot/cerebro.`,
  },
  {
    id: 'guide-notificaciones',
    title: 'Cómo ver notificaciones del sistema',
    keywords: ['notificaciones', 'avisos', 'campana', 'megafono', 'aviso pago'],
    body: `Paso a paso — Notificaciones:
1. Icono de megáfono / avisos en la cabecera.
2. Lee avisos del Admin Maestro, pago de plan, reservas, etc.
3. Puedes quitar un aviso de tu lista (confirmación).
4. Avisos de pago suelen llevar botón «Cargar comprobante».`,
  },
  {
    id: 'guide-login',
    title: 'Cómo iniciar y cerrar sesión',
    keywords: ['login', 'iniciar sesion', 'cerrar sesion', 'salir', 'contraseña', 'olvidé clave'],
    body: `Paso a paso — Sesión:
1. Abre el POS e ingresa usuario y contraseña.
2. Según rol irás a Escritorio, Caja, Mesas, Cocina, etc.
3. Si hay jornada QR y ya marcaste ingreso, puedes ir directo a tu módulo.
4. Cierra sesión desde el menú lateral / perfil.
5. Cambio de contraseña: Configuración → Usuarios (admin) o flujo de recuperación si está habilitado.`,
  },
  {
    id: 'guide-offline',
    title: 'Qué hacer si no hay internet en Caja',
    keywords: ['sin internet', 'offline', 'sin conexion', 'modo offline', 'cola offline'],
    body: `Paso a paso — Sin internet (Caja):
1. El mapa de Caja muestra indicador de conexión.
2. Algunas operaciones se encolan y se sincronizan al volver la red.
3. No cierres a la fuerza la app a mitad de un cobro.
4. Al recuperar internet, espera a que procese la cola.
5. Si algo falló, revisa la cuenta en Mesas/Caja o contacta soporte.`,
  },
  {
    id: 'guide-ia',
    title: 'Qué puede hacer la IA Fadey',
    keywords: ['ia fadey', 'asistente', 'qué puedes', 'ayuda', 'como funciona la ia'],
    body: `Soy la IA Fadey de este local. Puedo:
- Explicar paso a paso cómo operar todo el POS (caja, mesas, almacén, QR, usuarios, informes…).
- Consultar ventas, platos más vendidos, stock bajo y personal en jornada (según tu rol).
- Avisar en segundo plano demoras o stock bajo (tras el periodo de aprendizaje).
No puedo cobrar, anular ni cambiar precios por ti: te indico cómo hacerlo en el sistema.`,
  },
];

module.exports = { OPERATION_GUIDES };
