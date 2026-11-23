# Changelog

Entradas nuevas arriba. El procedimiento para escribirlas está en `AGENTS.md`. El detalle técnico vive en `PROJECT_CONTEXT.md`. Historial anterior a esta lista: `git log`.

## 1.2.4.9 — 2026-11-23

- PIX (IA Fadey) suma 32 guías nuevas en `server/services/fadeyAi/fadeyAiModuleGuides.js`:
  - «Para qué sirve» cada módulo del menú (20 módulos).
  - Hotel: ingreso, pedido, salida y mantenimiento; habitaciones, tipos y tarifas; reservas.
  - GIT Cards; Mi perfil (cambiar contraseña); Pagos de créditos; Contrato.
  - Lo que ve el cliente final: QR de mesa y de habitación, carta web con carrito y seguimiento, encuesta, reserva web de hotel y un resumen de esas páginas.
- Las preguntas «¿para qué sirve…?» van a la guía del módulo antes que a los datos en vivo; por ejemplo, «para qué sirve ventas» ya no responde con las ventas de hoy. Cada guía respeta los permisos por módulo del usuario.
- Pendiente: se probó con 41 preguntas en una copia local de la base, no en el chat del navegador. «¿Qué productos vendí más?» responde «No encontré productos…»; es anterior a este cambio y no se tocó.

## 1.2.4.8 — 2026-11-23

- Control de Recursos (Inventario y kardex): las seis pestañas (Insumos, Compras, Recetas, Kardex, transformables y no transformables) pasan a una columna lateral izquierda con sus colores, iconos e indicador de activa; el contenido queda a la derecha. En pantallas angostas van arriba en una fila desplazable, sin scroll horizontal de la página. La ruta `/kardex-inventory` no cambia.
- Pendiente: no se verificó en el navegador con sesión iniciada (solo compila con `vite build`).

## 1.2.4.7 — 2026-11-20

- Boletas y facturas: se corrigen las observaciones del CDR de SUNAT 4252, 4255, 4256 y 4097. El tipo de documento usa `listName="Tipo de Documento"`. El código de tributo (`TaxScheme/ID`) usa el catálogo 05 de SUNAT (`Codigo de tributos`, `PE:SUNAT` y su `schemeURI`). El departamento del emisor solo se lee de la dirección fiscal si termina en un departamento real del Perú (se ignora «Perú» al final) y sale recortado a 30 caracteres.
- Pendiente: los comprobantes ya emitidos conservan sus observaciones. Falta confirmarlo en SUNAT beta con un comprobante real. `CityName` sigue llevando el distrito y no la provincia. Para que llegue al restaurante hay que reiniciar el bot e-fact o actualizar el instalador.

## 1.2.4.6 — 2026-11-20

- Nuevo logo Resto Fadey POS (RF dorado con gorro de chef) en la pestaña del navegador, el icono al instalar la app (PWA, Android/iOS) y el instalador de escritorio. Fuente: `client/public/branding/resto-fadey-app-icon-source.jpg`. La pantalla de entrada (splash) no cambia.
- Pendiente: `scripts/generate-branding-assets.js` sigue usando la fuente antigua; correrlo con `FORCE_BRANDING=1` volvería a poner el icono anterior. Los dispositivos con la app ya instalada pueden tardar en refrescar el icono o requerir reinstalarla.

## 1.2.4.5 — 2026-11-19

- La confirmación de impresión tras cobrar se activa o desactiva sin el asistente y vale para todo el sistema (se guarda en el servidor del restaurante).

## 1.2.4.4 — 2026-11-19

- Se quitaron restos de Vercel (`vercel.json`, guía vieja). El despliegue documentado es un solo Web Service en Render (API + front). En unificado, `/api` en el mismo origen es válido (respaldos e impresión local incluidos).

## 1.2.4.3 — 2026-11-19

- En detalle del cliente, la cuenta pendiente y «Ir a caja a cobrar» quedan dentro de Deuda pendiente y se abren al pulsar esa tarjeta.
- En el bloque de auto-pedido del cliente, el texto queda arriba y Copiar a la derecha.
- Todos los avisos toast se pueden quitar deslizando; el tiempo de auto-cierre baja un poco.

## 1.2.4.2 — 2026-11-17

- La disponibilidad horaria de productos usa la hora del restaurante (Lima). Un desayuno de 7 a 11 vuelve a verse a las 9 aunque el servidor esté en UTC.

## 1.2.4.1 — 2026-11-17

- Los submódulos de Hotelería quedan solo en el panel lateral. Se quitó la fila de botones de arriba.

## 1.2.4.0 — 2026-11-17

- Hotelería se abre en submódulos: dashboard, habitaciones, reservas, huéspedes, estadías, cuentas, limpieza, informes y configuración. El informe de estadías sale del menú general de Informes y queda en Hotelería. La ruta `/admin/hoteleria` no cambia.

## 1.2.3.9 — 2026-11-16

- El recepcionista entra con Hotelería marcada. En permisos el interruptor queda encendido; si el administrador lo apaga, se respeta.

## 1.2.3.8 — 2026-11-16

- La reserva de Hotel se abre en una ventana encima de la pantalla. Totales, estados y botones de hotelería usan el verde, el azul, el naranja y el violeta de Informes.

## 1.2.3.7 — 2026-11-16

- Al cobrar una habitación, la pantalla dice Cobrar habitación y muestra el nombre de la habitación. Las mesas siguen igual.

## 1.2.3.6 — 2026-11-16

- Hotel puede apartar una habitación antes del ingreso, sin cambiar la cuenta ni la caja. En recepción la reserva queda confirmada. La página `/reservar` lee el origen de la red social y aparta 15 minutos. Al cobrar, esa habitación vuelve a poder reservarse.

## 1.2.3.5 — 2026-11-16

- En Caja, la habitación vinculada a esa caja se opera como una mesa: pedir, modificar, precuenta y cobrar. En Mesas queda igual. La zona se llama HOTEL, como los demás salones.

## 1.2.3.4 — 2026-11-16

- En Hotel, junto a las cajas, está Recepción. Esa habitación no se vincula a ninguna caja y solo se ve en el módulo de Hotel. En la habitación ocupada, Pedido abre el mismo pedido de Caja y Mesas. Cada producto sale al área de producción que tiene configurada.

## 1.2.3.3 — 2026-11-16

- En Mi empresa, Delivery y Hotel tienen cada uno su botón. Al abrir uno no se muestra el otro.

## 1.2.3.2 — 2026-11-16

- En Hotel, la salida no se bloquea por la caja de la habitación. El rol Recepcionista es el encargado del hotel. Al cobrar, la habitación queda en mantenimiento hasta activarla. En Caja y Mesas el pedido de la habitación usa el mismo formato que la mesa.

## 1.2.3.1 — 2026-11-16

- En el detalle del cliente, a la derecha del QR, Hacer pedido abre su auto-pedido con el nombre ya puesto. Sirve para cargar la pensión sin contraseña ni escribir el nombre uno por uno. El QR del cliente no cambia.

## 1.2.3.0 — 2026-11-16

- El QR de la habitación se abre al pulsar Ver QR y desde ahí se descarga. En Caja y Mesas hay una zona Hotel, con habitaciones en forma de puerta: ahí solo se ven y se cargan productos. En Hotel quedan a la vista Ingreso, Salida y Mantenimiento o Activar; el resto está en el menú de tres puntos.

## 1.2.2.9 — 2026-11-16

- La IA explica cómo mover un producto a otro almacén, cómo vincular el almacén de una caja y cómo consultar los comprobantes por fecha en Informes.

## 1.2.2.8 — 2026-11-16

- En Mi restaurante, Hotel es un interruptor igual al de Delivery y queda a su lado. Activarlo guarda `hotel_enabled` al momento y muestra Hotel en Operaciones y en Informes.

## 1.2.2.7 — 2026-11-16

- En Informes → Facturación electrónica, a la derecha del buscador hay Desde y Hasta. Arranca en el primer día del mes y llega hasta hoy. La lista y el conteo de comprobantes siguen ese periodo.
- El formulario de la caja vuelve a abrir. El aviso del almacén de productos impedía que el cliente compilara.

## 1.2.2.6 — 2026-11-16

- Informes tiene el submódulo Informe de Hotelería. Trae huésped, documento, noches, hospedaje, productos, total, caja y cobro. Solo se ve si Hotelería está activa.

## 1.2.2.5 — 2026-11-16

- Cada caja descuenta sus ventas del almacén que tenga configurado. Por defecto es el principal y el de insumos. En caja y mesas, el producto sigue visible si ese almacén está en cero.

## 1.2.2.4 — 2026-11-16

- Hotelería entra en Operaciones. Se activa o desactiva en Mi restaurante, como Delivery. Cada habitación lleva huésped, costo por noche y su caja. La cuenta suma las noches y los productos. El QR de auto pedido es el de la mesa.

## 1.2.2.3 — 2026-11-16

- En Movimiento interno, cada producto tiene Mover a almacén. La cantidad empieza en todo el stock del origen y se puede subir o bajar.

## 1.2.2.2 — 2026-11-16

- Si Chrome ya tiene el sistema instalado, el botón del perfil lo indica. Si no lo tiene, el clic abre el cuadro de instalación.

## 1.2.2.1 — 2026-11-16

- El botón Instalar el sistema del perfil abre el cuadro de instalación de Chrome. Ya no deja solo el aviso del menú.

## 1.2.2.0 — 2026-11-16

- En Mi perfil hay un botón al final para instalar el sistema, aunque Chrome no muestre su aviso.

## 1.2.1.9 — 2026-11-15

- La IA explica Mover mesa, Mover pedidos y Unir mesas como botones fijos del mapa (arriba en el celular, arriba a la derecha en la PC), sin pedir que se abra la mesa antes.

## 1.2.1.8 — 2026-11-14

- Junto al nombre comercial hay un botón de color. Ese color se usa en el nombre del inicio de sesión.

## 1.2.1.7 — 2026-11-14

- El login vuelve a mostrar el nombre comercial del local (Mi restaurante), debajo del logo.

## 1.2.1.6 — 2026-11-14

- Permisos POS muestra las áreas de producción reales del local, no solo Cocina y Bar. El acceso queda por área.

## 1.2.1.5 — 2026-11-14

- El botón que abre las secciones de Productividad POS queda solo en el celular. En la PC vuelve la lista al costado.

## 1.2.1.4 — 2026-11-14

- En Productividad POS el menú de secciones se guarda en un botón arriba a la izquierda. Al tocarlo se abre para elegir otra y al tocarlo de nuevo se cierra.

## 1.2.1.3 — 2026-11-13

- En Cobrar mesa, el nombre del producto queda en el mismo color sólido que la cantidad y el total.

## 1.2.1.2 — 2026-11-13

- El nombre del auto-pedido se ve en la comanda de cocina, en la cuenta de la mesa y al cobrar. Sirve para identificar quién pidió por QR.

## 1.2.1.1 — 2026-11-13

- El auto-pedido por QR pide un nombre antes de la carta. Ese nombre sale en la comanda y en la cuenta del pedido.

## 1.2.1.0 — 2026-11-13

- El asistente de PC encendido ya no consulta usuarios cada 15 minutos. Cada 2 horas intenta apagarse: si queda alguien, sigue; si ya cerraron todos, se apaga.
- Un usuario con el sistema abierto en dos equipos cuenta como uno.

## 1.2.0.9 — 2026-11-13

- Por área, en Productividad POS, muestra Caja, Cocina, Delivery y Mesas con la misma ficha de color que Ventas.

## 1.2.0.8 — 2026-11-13

- Las cifras de Recursos humanos (panel y Productividad POS) usan la misma ficha de color que Ventas: degradado, círculo e icono.

## 1.2.0.7 — 2026-11-13

- Recursos humanos usa las mismas pestañas, tarjetas redondeadas y colores del tema que el resto del sistema. El donut de áreas ya no fuerza azul, verde y naranja.

## 1.2.0.6 — 2026-11-13

- El auto pedido vuelve a mostrar el botón **Hacer pedido** en la cabecera, con la cantidad del carrito.

## 1.2.0.5 — 2026-11-13

- El menú público de auto pedido (mesa y cliente) pasa a grilla de dos columnas: pastillas, ficha con foto y botón naranja, carrito en la cabecera. El recuadro «Tu pedido» solo aparece cuando ya hay productos.

## 1.2.0.4 — 2026-11-13

- El logo del login queda 1.5 veces más grande.

## 1.2.0.3 — 2026-11-13

- El login vuelve a mostrar el logo principal de cada negocio (Mi empresa → Identidad visual). «Sistema de gestión gastronómica» queda abajo, al centro.

## 1.2.0.2 — 2026-11-13

- Login sin logo ni nombre: campos con icono, «Recordarme» (solo el usuario, en este equipo) y aviso para pedir el restablecimiento al administrador. Encima: «Sistema de gestión gastronómica» y la versión real. Sin marco alrededor del formulario.

## 1.2.0.1 — 2026-11-13

- Consulta de usuarios con el sistema ya cerrado: cada 2 horas hasta las 5:00 (Lima), en `electron/operationWatchSchedule.js`. De 5:00 a 7:00 sigue cada 30 minutos.
- El mismo criterio quedó en el repo del APK (`OperationWatchScheduler`, versión de código 1.0.11). Ese APK no se publicó en esta tarea.

## 1.2.0.0 — 2026-11-13

- `activeUsers` cuenta personas (`COUNT(DISTINCT user_id)`), no cada fila de `user_work_sessions`.
- El poll del asistente ya no abre ni refresca jornadas.
- Jornadas de más duplicadas por el mismo usuario se cierran al consultar el estado.

## 1.1.9.9 — 2026-11-13

- El asistente de PC sigue el horario de Lima: enciende con usuarios y se apaga al confirmar que no queda nadie. La actualización se instala en ese apagado.
- Instalador publicado aparte: tag `v1.1.99`. No incluye 1.2.0.0 ni 1.2.0.1.

## 1.1.9.8 — 2026-11-13

- El asistente de PC dejó de cerrarse al abrir para instalar una actualización ya descargada.

## 1.1.9.7 — 2026-11-13

- El asistente móvil solo permanece activo si hay un usuario activo en el sistema.

## 1.1.9.6 — 2026-11-13

- Copiar URL y token del vínculo Android por separado.
- Enviar boleta o factura por WhatsApp cuando el cliente tiene teléfono.

## 1.1.9.5 — 2026-11-13

- Hora de emisión en zona del restaurante.
- Dirección del cliente vacía si no se escribió. El emisor no repite la línea de distrito.

## 1.1.9.4 — 2026-11-13

- PDF formal de boleta y factura para el flujo del asistente Android.
- Color distinto y persistido al crear un área de producción.

## Pendiente conocido

- El instalador de PC que está en GitHub (`v1.1.99`) no trae el conteo de personas ni la consulta cada 2 horas. Esos cambios están en `main` desde 1.2.0.0 y 1.2.0.1.
- `README.md` de la raíz no coincide con el motor de base ni con el mapa actual. No usarlo como especificación.
