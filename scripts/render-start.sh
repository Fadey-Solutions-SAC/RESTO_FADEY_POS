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

ensure_data_volume() {
  local db_path="${1:-}"
  local wait_secs="${RENDER_DATA_WAIT_SECS:-90}"

  for _i in $(seq 1 "$wait_secs"); do
    if [[ -d /data ]]; then
      if (( _i > 1 )); then
        echo "[render-start] Disco /data disponible (${_i}/${wait_secs})."
      fi
      return 0
    fi
    if (( _i == 1 || _i % 10 == 0 )); then
      echo "[render-start] Esperando montaje de /data (${_i}/${wait_secs})…"
    fi
    sleep 1
  done

  if [[ -d /data ]]; then
    return 0
  fi

  echo "[render-start] ERROR: DB_PATH=$db_path pero /data no existe tras ${wait_secs}s."
  echo "[render-start] Render → Disks → Add Disk → Mount path /data → Manual Deploy."
  echo "[render-start] NO se arranca sin disco: evita crear una base vacía sobre clientes reales."
  return 1
}

if [[ -n "${DB_PATH:-}" ]] && [[ "$DB_PATH" == /data/* ]]; then
  ensure_data_volume "$DB_PATH" || exit 1
  mkdir -p "$(dirname "$DB_PATH")" /data/uploads /data/backups 2>/dev/null || true

  local_guard="/data/.restaurant_db_guard.json"
  if [[ -f "$local_guard" ]] && [[ ! -f "$DB_PATH" ]]; then
    if ls /data/backups/*.db >/dev/null 2>&1; then
      echo "[render-start] Falta $DB_PATH; Node restaurará desde /data/backups."
    else
      echo "[render-start] ERROR: Hay marcador de base con datos pero falta $DB_PATH."
      echo "[render-start] NO se iniciará con una base vacía. Restaure backup o snapshot de Render."
      exit 1
    fi
  fi

  if [[ -f "$DB_PATH" ]]; then
    db_bytes="$(wc -c < "$DB_PATH" 2>/dev/null | tr -d ' ' || echo 0)"
    if [[ "${db_bytes:-0}" -lt 512 ]] && [[ -f "$local_guard" ]]; then
      if ls /data/backups/*.db >/dev/null 2>&1; then
        echo "[render-start] $DB_PATH está vacío/truncado (${db_bytes} bytes). Node restaurará desde /data/backups."
      else
        echo "[render-start] ERROR: $DB_PATH existe pero está vacío/corrupto (${db_bytes} bytes) con marcador de datos."
        echo "[render-start] NO se arranca para evitar sobrescribir clientes reales. Restaure backup .db."
        exit 1
      fi
    fi
  fi
fi

cd "$ROOT/server/efact"
EFACT_PY="python3"
if [[ -x "$ROOT/.venv-efact/bin/python" ]]; then
  EFACT_PY="$ROOT/.venv-efact/bin/python"
fi
if "$EFACT_PY" -c "import reportlab" >/dev/null 2>&1; then
  "$EFACT_PY" api_server.py &
  EFACT_PID=$!
else
  echo "[render-start] WARN: e-fact sin reportlab (PDF). Node arranca igual. Rehaga el build si necesita facturación."
  EFACT_PID=""
fi

cleanup() {
  if [[ -n "${EFACT_PID:-}" ]]; then
    kill "$EFACT_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

sleep 1

if ! command -v sqlite3 >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1; then
  echo "[render-start] Instalando sqlite3 CLI (reparación de .db)…"
  (apt-get update -qq && apt-get install -y -qq sqlite3) || echo "[render-start] WARN: no se pudo instalar sqlite3."
fi

try_sqlite_recover() {
  local src="${1:-}"
  if [[ -z "$src" || ! -f "$src" ]]; then
    return 1
  fi
  if ! command -v sqlite3 >/dev/null 2>&1; then
    echo "[render-start] sqlite3 no disponible para .recover"
    return 1
  fi
  if sqlite3 "$src" "SELECT 1;" >/dev/null 2>&1; then
    echo "[render-start] SQLite abre correctamente."
    return 0
  fi
  echo "[render-start] SQLite no abre; intentando .recover (el código de salida distinto de 0 es normal)…"
  local rec="/data/restaurant.recovered.db"
  local sql="/tmp/restaurant.recover.sql"
  rm -f "$rec" "$sql"
  set +e
  sqlite3 "$src" ".recover" > "$sql" 2>/tmp/restaurant.recover.err
  local st=$?
  set -e
  local sql_bytes
  sql_bytes="$(wc -c < "$sql" 2>/dev/null | tr -d ' ' || echo 0)"
  echo "[render-start] .recover exit=${st} sql_bytes=${sql_bytes}"
  if [[ "${sql_bytes:-0}" -lt 64 ]]; then
    set +e
    sqlite3 "$src" ".dump" > "$sql" 2>/tmp/restaurant.dump.err
    set -e
    sql_bytes="$(wc -c < "$sql" 2>/dev/null | tr -d ' ' || echo 0)"
    echo "[render-start] .dump sql_bytes=${sql_bytes}"
  fi
  if [[ "${sql_bytes:-0}" -lt 64 ]]; then
    echo "[render-start] recover/dump vacío"
    return 1
  fi
  set +e
  sqlite3 "$rec" < "$sql"
  set -e
  if [[ -f "$rec" ]] && sqlite3 "$rec" "SELECT 1;" >/dev/null 2>&1; then
    local users
    users="$(sqlite3 "$rec" "SELECT COUNT(*) FROM users;" 2>/dev/null || echo 0)"
    echo "[render-start] recover OK, users=${users}. Reemplazando $src"
    cp -f "$src" "/data/restaurant.db.malformed-pre-recover" || true
    cp -f "$rec" "$src"
    return 0
  fi
  echo "[render-start] recover no produjo una base que se pueda abrir"
  return 1
}

if [[ -n "${DB_PATH:-}" && -f "$DB_PATH" ]]; then
  try_sqlite_recover "$DB_PATH" || true
fi

cd "$ROOT"
echo "[render-start] Iniciando Node (PORT=${PORT:-3001})…"
export _RENDER_START_WRAPPER=1
exec node server/index.js
