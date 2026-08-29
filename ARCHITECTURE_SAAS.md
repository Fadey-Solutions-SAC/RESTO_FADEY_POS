# Arquitectura SaaS Resto Fadey

## Principio

Cada restaurante mantiene su **web service independiente** y base de datos aislada. La plataforma central (`https://restofadey.pe`) agrega solo datos SaaS: clientes, pagos, licencias, métricas y usuarios para el dashboard.

```
┌─────────────────────┐     eventos SaaS      ┌──────────────────────────┐
│ Web Service Cliente │ ────────────────────► │ Plataforma Central         │
│ (POS + API Node)    │  Bearer API_SECRET  │ restofadey.pe              │
│ SQLite local        │                     │ SQLite/Postgres central    │
└─────────────────────┘                     └──────────────────────────┘
        │                                              │
        ▼                                              ▼
  Ventas, cocina,                              Pagos, vouchers,
  inventario (NO sync)                           planes, licencias,
                                               dashboard financiero
```

## Estructura del monorepo

```
/apps
  /central-platform      → API + panel admin SaaS
  /restaurant-pos-template → documentación de despliegue POS
/packages
  /shared-types          → tipos de eventos
  /shared-auth           → JWT + Bearer entre servicios
  /shared-api            → cliente HTTP de sincronización
  /shared-config         → clientId, webServiceId, licenseKey
/server + /client        → implementación POS actual (plantilla viva)
```

## Eventos sincronizados

| Evento | Endpoint central |
|--------|------------------|
| Comprobante / pago | `POST /api/payments` |
| Login usuario | `POST /api/sync/events` + `POST /api/sync/users` |
| Plan / renovación | `POST /api/sync/events` |
| Licencia | `POST /api/sync/events` |

**No se sincroniza:** pedidos, ventas de caja, cocina, inventario, kardex.

## Autenticación

- **POS → Central:** `Authorization: Bearer {API_SECRET_KEY}`
- **Dashboard central:** `POST /api/auth/login` (usuarios espejados desde POS en el primer login con email)
- **JWT:** `JWT_SECRET` en cada entorno

## Identificación por cliente

| Variable | Uso |
|----------|-----|
| `CLIENT_ID` | Tenant SaaS (obligatorio) |
| `API_SECRET_KEY` | Bearer POS → central (obligatorio) |
| `CENTRAL_API_URL` | URL del panel (`https://restofadey.pe`) |
| `RENDER_PUBLIC_URL` | URL pública del POS en Render (descubrimiento SaaS; preferida) |
| `NEXT_PUBLIC_API_URL` | Respaldo URL pública (vouchers si no hay `RENDER_PUBLIC_URL`) |
| `RESTAURANT_ID` | Opcional (alias de `CLIENT_ID`) |
| `WEBSERVICE_ID` / `LICENSE_KEY` | Solo si `CENTRAL_SYNC_EXTENDED=1` |

## Integración mínima POS (sin tocar operaciones)

### POS expone (panel SaaS consulta el Render del cliente)

- `GET /api/fadey/restaurant` — perfil público para vincular (`name`, `legalName`, `email`, `phone`, `ruc`, `address`; sin login)
- `GET /fadey/restaurant` — alias del anterior
- `GET /api/local` — alias del anterior
- `GET /api/restaurant/info` — registro automático (`Bearer API_SECRET_KEY`)
- `GET /api/system/health` — disponibilidad
- `POST /api/license/confirm` — push de aprobación/rechazo desde el panel

`CLIENT_ID` y `apiKey` (`RF_CLIENT_KEY_*`) se generan y persisten en SQLite si faltan.

### POS consume (hacia `CENTRAL_API_URL`)

- `POST /api/payments` — comprobante (payload: `clientId`, `restaurantName`, `adminName`, `adminEmail`, `plan`, `voucherUrl`, `amount`, `operationNumber`, `paymentDate`)
- `GET /api/license-status/:clientId` — licencia + último pago (polling)
- `GET /api/payments/status` — respaldo por referencia

## Panel administrativo central

- URL local: `http://localhost:4000/admin`
- Producción: `https://restofadey.pe/admin` (mismo servicio detrás del dominio)
- APIs: `/api/admin/dashboard/financial`, `/api/admin/payments`, `/api/admin/clients`

## Arranque local

```bash
# Plataforma central
npm run central

# POS cliente (raíz del repo)
npm run dev
```

## Despliegue

1. Desplegar `apps/central-platform` en el host de `restofadey.pe`.
2. Cada restaurante despliega su copia POS con variables `CLIENT_*` únicas.
3. Usar el mismo `API_SECRET_KEY` en central y en cada POS autorizado.
