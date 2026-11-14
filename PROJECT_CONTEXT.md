# Contexto del proyecto

Versión de producto: **1.2.0.8** (`package.json` y `client/package.json`). En pantalla: `v 1.2.0.8`.

Este archivo describe el sistema tal como está en el código. No reemplaza `AGENTS.md` (cómo trabajar) ni `CHANGELOG.md` (qué cambió).

## Qué es

Plataforma de restaurante (Resto FADEY / restaurant-platform): caja, salón, producción, delivery, inventario, personal, facturación electrónica SUNAT y asistentes de impresión (PC y Android).

El asistente Android **no vive en este repo**. El cliente lo descarga desde `Fadey-Mobile-Assistant` (`client/src/utils/printingAssistantDownload.js`). Ese APK habla con esta API.

## Stack

| Capa | Tecnología |
|---|---|
| API | Node.js `>=22.5.0`, Express, Socket.IO |
| Datos | SQLite. Archivo `restaurant.db` o `DB_PATH`. Motor en `server/database.js` y `server/sqliteEngine.js` (`sql.js` en dependencias; en nube se usa motor nativo con WAL cuando está disponible) |
| Cliente | React 18, Vite 5, Tailwind 3, React Router 6, socket.io-client, i18next |
| Escritorio | Electron 37, `electron/main.js`, electron-builder. `appId` `com.restofadey.desktop`. Producto visible: Resto FADEY |
| E-fact | Python en `server/efact` (bot local, puerto típico 8765) |
| Central SaaS | `apps/central-platform` (`@restofadey/central-platform`), paquetes `packages/shared-*` |
| Hora de negocio | `America/Lima` (`server/utils/appDateTime.js`). En Render, SQLite está en UTC |

`README.md` de la raíz está desactualizado (cita `better-sqlite3` como motor único y lista usuarios de demo). La fuente de verdad es el código y este archivo.

## Arranque

- Desarrollo: `npm run dev` → API en el puerto `PORT` (defecto **3001**) y Vite en **5173**.
- `JWT_SECRET` es obligatoria para la API.
- Nube: `npm run start:render`. `LISTEN_HOST` es `0.0.0.0` si `RENDER` está definido; si no, `127.0.0.1`.
- App empaquetada: la API embebida escucha en **3001**; el puente de impresión del asistente empieza en **3002** (`electron/main.js`).

## Árbol útil

- `client/` — UI. Entrada de rutas: `client/src/App.jsx`. Módulos de menú: `client/src/utils/staffModuleAccess.js`.
- `server/index.js` — montaje de la API y Socket.IO.
- `server/routes/` — un archivo por prefijo.
- `server/services/` — reglas de negocio (jornadas, facturación, inventario, IA, RR. HH.).
- `server/efact/` — emisión SUNAT.
- `server/printing/` — tickets térmicos.
- `electron/` — asistente de impresión de PC y horario de consulta de usuarios.
- `apps/central-platform/` — plataforma central SaaS.
- `scripts/` — build, smoke, semver del instalador.
- `.cursor/rules/` — reglas ya activas (idioma, versión, git, remoto).

## Roles

Personal: `admin`, `cajero`, `mozo`, `produccion`, `cocina`, `bar`, `delivery`, `master_admin`. Cliente: `type === 'customer'` (JWT aparte, 7 días). El personal usa JWT largo (`server/utils/staffJwt.js`, defecto 30 días).

## Rutas de pantalla

Definidas en `client/src/App.jsx`. No cambiar el path sin autorización (ver `AGENTS.md`).

| Ruta | Uso |
|---|---|
| `/` | Login o redirección según rol |
| `/admin` | Escritorio |
| `/admin/caja` | POS |
| `/admin/ventas` | Ventas |
| `/admin/mesas` | Mesas |
| `/admin/reservas` | Reservas |
| `/admin/auto-pedido` | Auto-pedido (admin) |
| `/admin/creditos` | Créditos |
| `/admin/clientes`, `/admin/clientes/git-cards` | Clientes y Git Cards |
| `/admin/productos` | Productos |
| `/admin/promociones` | Ofertas y descuentos (`/admin/ofertas` y `/admin/descuentos` redirigen aquí) |
| `/admin/almacen` | Almacén |
| `/admin/delivery` | Delivery (admin) |
| `/admin/produccion/:areaId`, `/admin/cocina`, `/admin/bar` | Producción |
| `/admin/informes` | Informes. Facturación: `?seccion=facturacion` |
| `/admin/indicadores` | Indicadores |
| `/admin/fidelizacion` | Fidelización |
| `/admin/tiempo-trabajado`, `/admin/asistencia` | Jornada y kiosco |
| `/admin/perfil`, `/admin/mi-restaurant`, `/admin/configuracion` | Perfil, empresa, ajustes |
| `/kitchen`, `/bar`, `/produccion/:areaId` | Producción fuera del layout admin |
| `/delivery` | Panel del repartidor |
| `/master` | Master admin |
| `/customer`, `/customer/cart`, `/customer/orders`, `/customer/orders/:id` | Menú cliente |
| `/auto-pedido`, `/auto-pedido-cliente` | Auto-pedido público |
| `/git-cards/:token`, `/encuesta`, `/firmar-contrato`, `/desbloquear-pago` | Páginas públicas |

## Prefijos de API

Montados en `server/index.js`. El path del prefijo no se renombra sin autorización.

| Prefijo | Área |
|---|---|
| `/api/healthz`, `/api/readyz`, `/api/local`, `/api/printing/bridge` | Salud y descubrimiento |
| `/api/auth` | Login, heartbeat, logout, cliente |
| `/api/public/self-order`, `/api/public/loyalty`, `/api/public/git-cards` | Público |
| `/api/fadey` y `/fadey` | Público Fadey |
| `/api/orders`, `/api/pos`, `/api/tables`, `/api/products`, `/api/categories`, `/api/production-areas` | Operación de salón |
| `/api/delivery` | Delivery |
| `/api/inventory`, `/api/kardex-inventory` | Stock |
| `/api/billing` | Comprobantes electrónicos |
| `/api/printing`, `/api/print-jobs`, `/printers`, `/api/printers` | Impresión |
| `/api/assistant` | Presencia del asistente y si hay usuarios |
| `/api/users`, `/api/profile`, `/api/hr`, `/api/staff-chat` | Personal |
| `/api/reports`, `/api/admin-modules`, `/api/promotions`, `/api/loyalty`, `/api/git-cards` | Admin comercial |
| `/api/restaurant`, `/api/business-config`, `/api/system`, `/api/license`, `/api/legal-documents`, `/api/contrato` | Empresa, licencia, contratos |
| `/api/fadey-ai` | Asistente de IA interno |
| `/api/push` | Web push |
| `/api/master-admin` | Master |
| `/api/central-sync`, `/api/platform-payments` | Solo si **no** es el proceso Electron (`ELECTRON_RUN_AS_NODE`) |
| `/uploads`, `/imagenes-qr` | Archivos estáticos |

Socket.IO usa el path `/socket.io/`.

## Datos principales

Tablas creadas en `server/database.js` (no es la lista de columnas): `restaurants`, `users`, `user_work_sessions`, `user_work_activity_events`, `customers`, `categories`, `products`, `product_variants`, `orders`, `order_items`, `order_station_state`, `tables`, `reservations`, `cash_registers`, `cash_movements`, `delivery_assignments`, `electronic_documents`, `inventory_logs`, `insumos`, `kardex`, `recetas`, `suppliers`, `purchase_orders`, `promotions`, `loyalty_surveys`, `git_cards_*`, `customer_credits`, `print_jobs`, `printer_routes`, `printer_settings`, `app_settings`, `business_config_*`, `audit_logs`.

## Asistentes de impresión

- **PC** (`electron/main.js`): bandeja. Con vínculo de nube guardado, consulta `GET /api/assistant/operation-status`. Enciende impresión y e-fact si hay usuarios; si no hay, apaga esos servicios y, si hay actualización descargada, la instala. El proceso de bandeja sigue vivo. Horario en `electron/operationWatchSchedule.js` (Lima): con usuarios, 30 min de 5:00 a 7:00 y 15 min desde las 7:00; si ya cerraron, cada 2 horas hasta las 5:00.
- **Usuario activo** (`server/assistantOperation.js`): personas distintas con jornada abierta y actividad en los últimos **6 minutos**, o heartbeat de POS en los últimos **120 segundos**. Una caja abierta sola no enciende el asistente. Las consultas del propio asistente (`operation-status`, `pending-local`, cola de `print-jobs`) no crean ni refrescan jornadas (`server/middleware/auth.js`).
- **Android**: cola ` /api/print-jobs` y facturas ` /api/billing/pending-local`. El horario equivalente está en el repo del APK, no aquí.

## Decisiones que el código ya tomó

- La versión de UI es de cuatro segmentos `A.B.C.D` (cada uno 0–9). El instalador Electron la convierte a semver de tres segmentos (`scripts/electron-builder-with-semver.mjs`): `1.2.0.1` → `1.2.1`.
- La dirección del cliente en el comprobante no se rellena con la del restaurante.
- La hora de emisión del comprobante usa la zona del restaurante, no el reloj UTC del servidor.
- Un área de producción nueva recibe un color de una paleta fija, persistido en el registro del área.
- Los PDF de boleta y factura del flujo Android los arma el servidor (`server/billingFormalReceiptPdf.js`), no el teléfono.

## Dependencias de runtime (raíz)

`express`, `socket.io`, `sql.js`, `jsonwebtoken`, `bcryptjs`, `pdfkit`, `qrcode`, `multer`, `nodemailer`, `web-push`, `node-forge`, `jimp`, `electron-updater`. Cliente: `react`, `react-router-dom`, `tailwindcss` (dev), `exceljs`, `i18next`, `recharts`, `socket.io-client`.
