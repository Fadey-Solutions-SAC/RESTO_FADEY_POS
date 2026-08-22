# Desplegar con GitHub + Render (API) + Vercel (web)

Flujo: tu código vive en **GitHub**; cada `git push` a la rama conectada vuelve a construir y publicar **Render** (backend) y **Vercel** (frontend React).

---

## 0) Requisitos previos

- Repositorio en GitHub con el código ya subido (`git push`).
- Cuentas en [render.com](https://render.com) y [vercel.com](https://vercel.com) (pueden iniciar sesión con GitHub).

---

## 1) Backend en Render (Node / Express)

1. En Render: **New** → **Web Service**.
2. **Connect** tu repositorio de GitHub y elige el repo (ej. `RESTAURANT`).
3. Configuración típica:
   - **Name:** el que quieras (ej. `resto-api`).
   - **Region:** la más cercana a tus usuarios.
   - **Branch:** `main` (o la que uses).
   - **Root directory:** déjalo **vacío** (raíz del repo; ahí está `package.json` y `server/`).
   - **Runtime:** Node.
   - **Build command:** `npm install && npm run build`  
     (el script `build` del repo instala dependencias en `client` **incluyendo devDependencies** para que exista `vite` en Render, donde `NODE_ENV=production` suele omitirlas.)
   - **Start command:** `npm start`  
     (equivale a `node server/index.js` según el `package.json` del proyecto).
4. Elige plan (Free tiene “sleep” tras inactividad; el primer request puede tardar).
5. **Environment** (Variables) — mínimo obligatorio:

   | Variable        | Valor (ejemplo) |
   |----------------|------------------|
   | `JWT_SECRET`   | Una cadena larga y aleatoria (obligatoria; no uses la de ejemplo en producción). |
   | `CORS_ORIGIN`  | URL de tu front en Vercel, **sin barra final**. Varias URLs separadas por coma:  
     `https://tu-app.vercel.app,http://localhost:5173` |
   | *(opcional)* `PORT` | Render suele inyectar `PORT` solo; no hace falta definirla salvo que tu plantilla lo exija. |
   | `DB_PATH` | **Imprescindible** para no perder datos: ruta en un **disco persistente**. Ver sección **1b** abajo. |

   Opcionales (ver `/.env.example`):

   - `NODE_ENV` = `production`

### 1b) Que los datos no se borren en cada deploy (Render)

**Importante:** El código del proyecto **no borra** tu base al hacer `git push`. Lo que ocurre es que, en Render, el disco del contenedor es **efímero**: si `restaurant.db` no está en un **Disk** persistente, cada nuevo deploy arranca **sin** ese archivo y el servidor **crea otra base vacía** (parece un “reset”).

**⚠️ Servicios en producción (clientes reales):**

- **NO** sincronices `render.yaml` como Blueprint sobre un servicio que ya funciona.
- **NO** añadas un **segundo** disco ni reemplaces el disco existente sin backup.
- **NO** definas `ALLOW_EMPTY_DB_BOOT=1` salvo recuperación controlada por un técnico.
- El repo incluye **protecciones** (`render-start.sh` + marcador `.restaurant_db_guard.json`): si falta el `.db` pero había datos, el servicio **no arranca** en lugar de crear una base vacía.

**Solo para un Web Service NUEVO y vacío** (p. ej. demo aparte):

1. En el servicio web → **Disks** → **Add disk** (una sola vez).
2. Montaje: **Mount path** = `/data`, tamaño según plan (p. ej. 1 GB).
3. **Environment** → **`DB_PATH`** = **`/data/restaurant.db`**
4. **Manual Deploy**.

> Copiar `DB_PATH` de otro servicio **no** comparte la base: cada servicio tiene **su propio** disco. Para clonar datos, exporta el `.db` desde el servicio que ya funciona (`/master` → Respaldo) y restáuralo en el nuevo.

**Logos e imágenes (`/uploads`):** con `DB_PATH=/data/restaurant.db`, el servidor guarda subidas en **`/data/uploads`** automáticamente (mismo volumen que la base). Así no se pierden al redeploy. En los logs verás `[uploads] Archivos estáticos en: /data/uploads`. Opcional: fija `UPLOADS_DIR` si quieres otra ruta.

**Comprobar que quedó bien:** abre **Logs** del servicio al iniciar. Si falta el Disk o `DB_PATH`, verás un bloque **`[CRÍTICO] Riesgo de PERDER DATOS`**. Si está bien, verás **`DB_PATH parece volumen persistente`**.

El **reinicio completo** de datos del programa sigue siendo solo el que configures en **Configuración** del panel (no el deploy normal).

**Si ya perdiste datos:** no están en el deploy anterior del contenedor; la recuperación solo es posible si tenías **copia** del archivo `.db` o backup exportado desde el panel.

6. **Create Web Service**. Espera a que el deploy termine y copia la URL pública del servicio, por ejemplo:  
   `https://resto-api-xxxx.onrender.com`

7. **Probar API:** en el navegador abre  
   `https://TU-SERVICIO.onrender.com/api/healthz`  
   Debería responder JSON con `{ "ok": true }` (o similar).

### 1c) Mismo servicio Node (sin Docker ni segundo Web Service): bot e-fact

**Recomendado para todos los clientes (POLLERIA-KUELAP, ZOILAS SUITE ESCAPE, etc.): runtime Node, no Docker.**  
Con Node, Render clona todo el repo (`packages/`, `scripts/`, etc.) y los deploys reflejan cada `git push` sin fallos de imagen Docker.

Si un servicio está en **Docker**, cámbialo: **Settings** → **Build & Deploy** → **Runtime: Node** (o crea un Web Service nuevo Node y migra variables + disco).

Render incluye **Python 3** en el runtime nativo de Node ([herramientas disponibles](https://render.com/docs/native-environments)). Puedes levantar **Node + `api_server.py`** en un solo servicio:

1. Servicio → **Settings** → **Build & Deploy**.
2. **Runtime:** **Node** (no Docker).
3. **Root directory:** vacío (raíz del repo).
4. **Build command:**

   `bash scripts/render-build.sh`

   (equivale a `npm install && npm run build && python3 -m pip install -r server/efact/requirements.txt`)

5. **Start command:**

   `bash scripts/render-start.sh`

6. Variables (como ya tienes): `EFACT_API_URL=http://127.0.0.1:8765` y `EFACT_HTTP_SECRET=…`  
   Opcional: `OUTPUT_DIR=/data/efact-output` si tienes disco en `/data` y quieres conservar XML/PDF del bot ahí.
   Cada servicio su propia URL en `RENDER_PUBLIC_URL` y `CORS_ORIGIN` con su front Vercel.

7. **Save** y **Manual Deploy**. En **Logs** deberías ver el mensaje del API Python (puerto **8765**) y luego el arranque de Node.

El script está en el repo: `scripts/render-start.sh`. Build: `scripts/render-build.sh`. Referencia: `render.yaml`.

---

## 2) Frontend en Vercel (React / Vite)

1. En Vercel: **Add New** → **Project** → **Import** el mismo repo de GitHub.
2. **Framework Preset:** Vite (o “Other” si no detecta bien).
3. **Root Directory:** `client`  
   (importante: el `package.json` del front está dentro de `client/`.)
4. **Build Command:** `npm run build`  
5. **Output Directory:** `dist`
6. **Environment Variables:**

   | Name            | Value |
   |-----------------|--------|
   | `VITE_API_URL`  | La URL base del backend **sin** `/api` al final.  
     Ejemplo: `https://resto-api-xxxx.onrender.com` |

7. **Deploy**. Al terminar, Vercel te da una URL tipo `https://tu-app.vercel.app`.

8. Vuelve a **Render** y en `CORS_ORIGIN` asegúrate de incluir exactamente esa URL de Vercel (con `https://`). Guarda y redeploy si hace falta.

### 2b) Errores típicos en Vercel («Failed to fetch» en login)

| Dónde | Variable | Valor correcto |
|-------|----------|----------------|
| **Vercel** (frontend) | `VITE_API_URL` | `https://TU-SERVICIO.onrender.com` (**sin** `/api`) |
| **Render** (backend) | `CORS_ORIGIN` | `https://tu-app.vercel.app,http://localhost:5173` |

Despliegues conocidos (el front también los detecta por dominio si falta `VITE_API_URL`):

| Vercel | Render |
|--------|--------|
| `sistemademo.vercel.app` | `https://sistema-demo-m80e.onrender.com` |
| `zoilas-suite-escape.vercel.app` | `https://zoilas-suite-escape.onrender.com` |

- `CORS_ORIGIN` en **Vercel no sirve** — debe estar en **Render**.
- `JWT_SECRET`, `DB_PATH`, `PERU_CONSULTAS_TOKEN`, etc. van en **Render**, no en Vercel.
- Tras cambiar `VITE_API_URL` hace falta **Redeploy** en Vercel (la variable se embebe en el build).
- En DevTools → Network, las peticiones deben ir a `onrender.com/api/...`, no a `vercel.app/api/...`.

---

## 3) Cada vez que cambies código

```bash
git add .
git commit -m "tu mensaje"
git push origin main
```

Render y Vercel (si están enlazados a `main`) desplegarán solos el nuevo commit.

---

## 4) Comprobar que todo apunta bien

- Abre el sitio de Vercel, inicia sesión en la app.
- En las herramientas de desarrollador → **Network**, las peticiones a la API deben ir a  
  `https://TU-SERVICIO.onrender.com/api/...`
- Si ves llamadas a `https://....vercel.app/api/...` y fallan, falta o está mal `VITE_API_URL` en Vercel, o el despliegue no incluye el último commit.

---

## 5) Qué no subir a GitHub

- `.env` con secretos reales (solo `.env.example` como plantilla).
- `uploads/`, `*.db`, `node_modules/`.
- Imágenes de cartas en `client/public/cartas/` (están en `.gitignore`); súbelas desde **Admin → Cartas y QR → Subir** o colócalas en el servidor según la sección 6 antigua del historial del doc.

---

## 6) Cartas del menú (imágenes) — no van en Git

- Las PNG/JPG/PDF de `client/public/cartas/` están en `.gitignore`: el **push solo lleva código**.
- **En producción (recomendado):** admin → **Cartas y QR (config.)** → **Subir** o URL. Los archivos quedan en el backend (`/uploads/...` en Render).
- **Estáticos solo en el front:** copiar imágenes en `client/public/cartas/` en el entorno que ejecuta el build (sin commitearlas) o usar CDN.

---

## Notas útiles

- **Dominio propio:** en Vercel y en Render puedes añadir dominios personalizados; actualiza `CORS_ORIGIN` con las URLs definitivas.
- **Base de datos en Render:** sin disco persistente, el archivo SQLite puede perderse al redeploy; para producción serio, valorar disco en Render o base gestionada.
