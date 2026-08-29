# RESTO FADEY — Firma DNIe (Android)

Companion nativo del módulo **Contrato del servicio**. No es un módulo aparte: solo canal NFC + PIN local.

## Flujo

1. Web prepara PDF + hash (`POST /api/contrato/sign`).
2. Usuario abre QR → `/firmar-contrato?token=…` (WebView) o deep link `restofadey://contract-sign?token=…`.
3. App lee DNIe por NFC, pide PIN **solo en el dispositivo**.
4. App hace `POST /api/contrato/sign/mobile/:token` con `signature_value` (CMS) — **sin PIN**.
5. El panel web hace poll y muestra la firma dentro del contrato.

## Bridge WebView

Inyectar en el WebView:

```kotlin
webView.addJavascriptInterface(DnieJsBridge(this), "RestoFadeyDnieAndroid")
// Exponer también window.RestoFadeyDnie = { signAsync(payload) { ... } }
```

Contrato JS: ver `client/src/utils/dnieSignerBridge.js`.

## REQUIERE VALIDACIÓN TÉCNICA

Los comandos APDU del DNIe peruano **no están inventados** en este scaffold.

Antes de producción hay que confirmar con documentación oficial / RENIEC / fabricante:

- Select AID de la aplicación de firma
- Autenticación con PIN (solo local)
- Operación de firma sobre el hash del PDF
- Extracción de certificado
- Formato CMS/PKCS#7 de salida

Marcado en código: `NfcDnieBridge.kt` → `TODO_REQUIERE_VALIDACION_TECNICA`.

## Variables

- API base: la misma URL pública del Web Service (sin `/api` al final en la config de la app; el cliente añade `/api`).
- `PUBLIC_WEB_URL` / `FRONTEND_URL` en el servidor para que el QR apunte a `/firmar-contrato`.

## Build

Abrir esta carpeta en Android Studio (o copiar `app/` a un proyecto nuevo).
Min SDK 26+, NFC required feature optional (`android:required="false"`) para instalar en emulador.
