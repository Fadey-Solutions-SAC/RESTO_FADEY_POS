# Fase 0 — Trámite RENIEC / DNIe (bloqueante para validez legal)

Este documento es la checklist operativa. **Sin el material oficial no se puede afirmar firma 100 % legal.**

## Objetivo

Obtener de RENIEC y/o del fabricante del DNIe peruano lo necesario para:

1. Comandos APDU de la aplicación de firma (AID, VERIFY PIN, SIGN).
2. Formato de salida CMS/PKCS#7.
3. Certificados raíz e intermedios de la PKI.
4. Política de revocación (CRL y/o OCSP), si aplica.
5. SDK Android oficial, si existe y es el canal homologado.

## Checklist de gestión

- [ ] Contacto formal con RENIEC / área de firma digital / proveedor del chip.
- [ ] NDA firmado si el material es confidencial.
- [ ] Recepción de documentación APDU o SDK Android.
- [ ] Recepción de certificados CA (PEM/DER).
- [ ] Criterio escrito de asesoría legal (Ley de firmas electrónicas en Perú + DNIe).
- [ ] Política interna de conservación: PDF + hash + CMS + metadatos ≥ plazo legal.

## Dónde guardar el material (no subir secretos al repo público)

| Material | Ubicación sugerida |
|----------|--------------------|
| CAs PEM | `server/services/contractSignature/reniec/ca/` (ver README allí) |
| Docs APDU/SDK | Fuera del repo o carpeta local ignorada por git |
| NDA / dictamen legal | Archivo de la empresa (no en GitHub público) |

Variable de entorno: `RENIEC_CA_DIR` (ruta absoluta a los PEM).

Cuando APDU estén integrados en la app: `DNIE_APDU_READY=1`.

## Criterio de “listo para producción legal”

1. `CONTRACT_DNIE_PROVIDER=real`
2. `ALLOW_MOCK_DNIE` **ausente** o distinto de `1`
3. `DNIE_APDU_READY=1` y app Android con secuencia oficial
4. CAs RENIEC cargadas y verificación CMS en servidor en verde
5. Pruebas con DNIe reales (PIN ok / PIN mal / rechazo sin NFC) documentadas en `QA_CHECKLIST.md`
