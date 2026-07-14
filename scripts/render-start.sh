#!/usr/bin/env bash
# Arranque Render (runtime Node nativo): levanta el API Python e-fact y luego Node en el mismo proceso/grupo.
# En Render: Build = "bash scripts/render-build.sh"  |  Start = "bash scripts/render-start.sh"
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export EFACT_HTTP_HOST="${EFACT_HTTP_HOST:-0.0.0.0}"
export EFACT_HTTP_PORT="${EFACT_HTTP_PORT:-8765}"

resolve_output_dir() {
  if [[ -n "${OUTPUT_DIR:-}" ]]; then
    echo "$OUTPUT_DIR"
    return
  fi
  if [[ -d /data ]]; then
    echo "/data/efact-output"
    return
  fi
  echo "$ROOT/server/efact/output"
}

export OUTPUT_DIR="$(resolve_output_dir)"
if ! mkdir -p "$OUTPUT_DIR" 2>/dev/null; then
  echo "[render-start] WARN: no se pudo usar OUTPUT_DIR=$OUTPUT_DIR (¿disco /data montado?). Fallback local."
  export OUTPUT_DIR="$ROOT/server/efact/output"
  mkdir -p "$OUTPUT_DIR"
fi

if [[ -n "${DB_PATH:-}" ]] && [[ "$DB_PATH" == /data/* ]]; then
  for _i in $(seq 1 20); do
    [[ -d /data ]] && break
    echo "[render-start] Esperando montaje de /data (${_i}/20)…"
    sleep 1
  done
  if [[ ! -d /data ]]; then
    echo "[render-start] ERROR: DB_PATH=$DB_PATH pero /data no existe."
    echo "[render-start] Render → Disks → mount path /data, luego Manual Deploy (ver DEPLOY_GITHUB_VERCEL_RENDER.md)."
    exit 1
  fi
  if [[ -f /data/.restaurant_db_guard.json ]] && [[ ! -f "$DB_PATH" ]]; then
    echo "[render-start] ERROR: Hay marcador de base con datos pero falta $DB_PATH."
    echo "[render-start] NO se iniciará con una base vacía. Restaure backup o snapshot de Render."
    exit 1
  fi
fi

cd "$ROOT/server/efact"
if command -v python3 >/dev/null 2>&1; then
  python3 api_server.py &
  EFACT_PID=$!
else
  echo "[render-start] WARN: python3 no disponible; e-fact no iniciará (Node sigue)."
  EFACT_PID=""
fi

cleanup() {
  if [[ -n "${EFACT_PID:-}" ]]; then
    kill "$EFACT_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

sleep 1

cd "$ROOT"
echo "[render-start] Iniciando Node (PORT=${PORT:-3001})…"
exec node server/index.js
