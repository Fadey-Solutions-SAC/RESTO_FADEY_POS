# Certificados CA RENIEC

Coloque aquí los PEM oficiales (raíz e intermedios) cuando los entregue RENIEC.

Ejemplo de nombres (ajustar a los reales):

- `reniec-root.pem`
- `reniec-intermediate.pem`

Configure:

```text
RENIEC_CA_DIR=/ruta/absoluta/a/esta/carpeta
```

No suba certificados confidenciales a un repositorio público si el NDA lo prohíbe.
Use un volumen privado en el servidor (Render disk, etc.).

Este directorio puede quedar vacío en desarrollo; en `CONTRACT_DNIE_PROVIDER=real`
la verificación CMS fallará hasta que existan CAs válidas.
