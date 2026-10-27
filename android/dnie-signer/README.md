# RESTO FADEY — Firma DNIe (Android)

Companion nativo del módulo **Contrato del servicio**. No es un módulo aparte: solo canal NFC + PIN local.

## Flujo

1. Web prepara PDF + hash (`POST /api/contrato/sign`).
2. Usuario escanea el QR → `intent://…` abre esta app (`com.restofadey.dniesigner`); si no está instalada, cae a `/firmar-contrato` (sin NFC).
3. En la app: pulsar «Firmar con DNIe» → Reader Mode (`FLAG_READER_SKIP_NDEF_CHECK`) → acercar DNIe → PIN local.
4. App hace `POST /api/contrato/sign/mobile/:token` con `signature_value` (CMS) — **sin PIN**.
5. El panel web hace poll y muestra la firma dentro del contrato.

**Importante:** no acerque el DNIe en Chrome/navegador. El toast «No se pudo encontrar una aplicación que admita la etiqueta NFC» aparece cuando el sistema intenta NDEF fuera de Reader Mode.

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
