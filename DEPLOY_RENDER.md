# Desplegar con GitHub + Render (un Web Service por cliente)

Flujo: el código vive en **GitHub**; cada `git push` a la rama conectada vuelve a construir y publicar **un Web Service de Render** que sirve **API + frontend** (`client/dist`) en el mismo dominio.

No hace falta un front aparte (p. ej. Vercel): el Node de Render entrega el SPA y `/api`.

---

## 0) Requisitos previos

- Repositorio en GitHub con el código ya subido (`git push`).
- Cuenta en [render.com](https://render.com) (puede iniciar sesión con GitHub).

---

## 1) Web Service en Render (Node)

1. En Render: **New** → **Web Service**.
2. **Connect** tu repositorio de GitHub.
3. Configuración típica:
   - **Name:** el del cliente (ej. `resto-cliente-x`).
   - **Region:** la más cercana a tus usuarios.
   - **Branch:** `main` (o la que uses).
   - **Root directory:** vacío (raíz del repo).
   - **Runtime:** Node (**no** Docker).
   - **Build command:** `bash scripts/render-build.sh`
   - **Start command:** `bash scripts/render-start.sh`
4. Plan: Free tiene “sleep”; Starter ($7) conviene para caja real.
5. **Environment** — mínimo:

   | Variable | Valor |
   |---|---|
   | `JWT_SECRET` | Cadena larga y aleatoria (obligatoria). |
   | `DB_PATH` | `/data/restaurant.db` (con Disk; ver abajo). |
   | `RENDER_PUBLIC_URL` | URL pública de este servicio (`https://….onrender.com`). |
   | `CORS_ORIGIN` | Opcional si el front es el mismo servicio. En local: `http://localhost:5173`. |

   **No** defina `VITE_API_URL` en el build de Render unificado: el cliente usa `/api` en el mismo origen.

### 1b) Disco persistente (no perder datos en cada deploy)

En Render el disco del contenedor es **efímero**. Sin **Disk** + `DB_PATH`, cada deploy puede arrancar sin el `.db` y parecer un “reset”.

1. Servicio → **Disks** → **Add disk** (una sola vez).
2. **Mount path** = `/data`.
3. **Environment** → `DB_PATH=/data/restaurant.db`
4. **Manual Deploy**.

Con ese `DB_PATH`, las subidas van a `/data/uploads` automáticamente.

**Comprobar:** en Logs, si falta el Disk verá `[CRÍTICO] Riesgo de PERDER DATOS`. Si está bien: `DB_PATH parece volumen persistente`.

### 1c) Bot e-fact en el mismo servicio

Con runtime Node, `render-start.sh` levanta el API Python e-fact y luego Node.

Variables típicas: `EFACT_API_URL=http://127.0.0.1:8765`, `EFACT_HTTP_SECRET=…`  
Opcional: `OUTPUT_DIR=/data/efact-output`.

---

## 2) Cada vez que cambies código

```bash
git add .
git commit -m "tu mensaje"
git push origin main
```

Render (si está enlazado a `main`) desplegará solo.

---

## 3) Comprobar

- Abra `https://TU-SERVICIO.onrender.com` e inicie sesión.
- En DevTools → **Network**, las peticiones deben ir a `https://TU-SERVICIO.onrender.com/api/...` (mismo host).
- Salud: `https://TU-SERVICIO.onrender.com/api/healthz`

---

## 4) Qué no subir a GitHub

- `.env` con secretos reales (solo `.env.example`).
- `uploads/`, `*.db`, `node_modules/`.
- Imágenes de cartas en `client/public/cartas/` (están en `.gitignore`); súbelas desde el admin.

---

## Notas

- **Dominio propio:** puede añadirse en Render; el front y el API siguen en el mismo origen.
- **Un servicio = un cliente** (su Disk, su `JWT_SECRET`, su URL).
- Plantilla de variables: ver `/.env.example` y `/client/.env.example`.
