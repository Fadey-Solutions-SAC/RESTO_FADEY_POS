#!/usr/bin/env bash
# Build estándar Render (runtime Node nativo). Usar en ambos Web Services del mismo repo.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "[render-build] npm install + build frontend…"
npm install
npm run build

echo "[render-build] dependencias Python e-fact…"
VENV_DIR="$ROOT/.venv-efact"
if python3 -m venv "$VENV_DIR" && [[ -x "$VENV_DIR/bin/pip" ]]; then
  "$VENV_DIR/bin/pip" install --upgrade pip
  "$VENV_DIR/bin/pip" install -r "$ROOT/server/efact/requirements.txt"
else
  echo "[render-build] WARN: no se pudo crear venv; pip del sistema."
  python3 -m pip install -r "$ROOT/server/efact/requirements.txt" || echo "[render-build] WARN: pip e-fact falló (Node igual se construye)."
fi

if command -v apt-get >/dev/null 2>&1; then
  echo "[render-build] sqlite3 (reparación de .db si hace falta)…"
  (apt-get update -qq && apt-get install -y -qq sqlite3) || echo "[render-build] WARN: no se pudo instalar sqlite3 CLI."
fi

echo "[render-build] listo."
