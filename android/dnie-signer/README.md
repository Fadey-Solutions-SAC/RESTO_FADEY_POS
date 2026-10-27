# RESTO FADEY — Firma DNIe (Android)

Companion nativo del módulo **Contrato del servicio / laboral**. Canal IsoDep + PIN local + CMS.

## Flujo legal (objetivo)

1. Web prepara PDF + hash (`POST /api/contrato/sign`).
2. Usuario abre la sesión en **esta app** (WebView + bridge `RestoFadeyDnie`).
3. Reader Mode (`FLAG_READER_SKIP_NDEF_CHECK`) → IsoDep → PIN local → APDU oficiales ([OfficialDnieApdu.kt](app/src/main/java/com/restofadey/dniesigner/OfficialDnieApdu.kt)).
4. App envía CMS (sin PIN) a `POST /api/contrato/sign/mobile/:token`.
5. Servidor verifica CMS con CAs RENIEC (`reniecCmsVerify.js`).

## Estado actual

- `OfficialDnieApdu.CONFIGURED = false` hasta integrar documentación/SDK oficial (Fase 0).
- No se inventan APDU ni se fabrican CMS simulados como “válidos”.
- Ver [docs/dnie-reniec/FASE0_TRAMITE.md](../../docs/dnie-reniec/FASE0_TRAMITE.md).

## Bridge WebView

`MainActivity` inyecta `window.RestoFadeyDnie` con `signAsync` / `getCapabilities` (`apdu_configured`).

Contrato JS: `client/src/utils/dnieSignerBridge.js`.

## Build

Abrir esta carpeta en Android Studio. Min SDK 26+. NFC `android:required="false"`.

Tras APDU oficiales: poner `CONFIGURED = true` y en el servidor `DNIE_APDU_READY=1`.
