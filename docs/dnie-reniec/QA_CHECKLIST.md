# Fase 4 — Checklist QA firma DNIe legal

## Entorno

- [ ] `CONTRACT_DNIE_PROVIDER=real`
- [ ] Sin `ALLOW_MOCK_DNIE=1`
- [ ] `RENIEC_CA_DIR` apunta a PEM oficiales
- [ ] `DNIE_APDU_READY=1` tras integrar APDU
- [ ] App Android RESTO FADEY Firma instalada; firma solo desde WebView con bridge

## Funcional

- [ ] Preparar contrato → hash PDF estable
- [ ] Abrir firma en app nativa (bridge detectado)
- [ ] Acerque DNIe → PIN correcto → CMS recibido en servidor
- [ ] `validation_status = VALID` solo tras verificación PKI
- [ ] PIN incorrecto → error local, nada al servidor
- [ ] Sin acercar DNI → timeout / mensaje claro
- [ ] Empleador luego empleado (contrato laboral)
- [ ] Ambas partes → contrato `firmado` + PDF visual

## Seguridad / legal

- [ ] PIN nunca en logs de red, JS ni base de datos
- [ ] Rechazo de campos `pin`/`clave` en API
- [ ] Placeholder `NFC_PHONE_` / `dnie_nfc_phone` rechazado en modo `real`
- [ ] MOCK rechazado en producción
- [ ] CMS + certificado + hash guardados en auditoría

## Dispositivos

- [ ] Android con NFC-A / NFC-B
- [ ] IsoDep disponible
- [ ] Rechazo claro en iOS / navegador sin bridge cuando modo `real`
