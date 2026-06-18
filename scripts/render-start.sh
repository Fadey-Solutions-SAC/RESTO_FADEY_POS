#!/usr/bin/env bash
# Arranque Render (runtime Node nativo): levanta el API Python e-fact y luego Node en el mismo proceso/grupo.
# En Render: Build = "bash scripts/render-build.sh"  |  Start = "bash scripts/render-start.sh"
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export EFACT_HTTP_HOST="${EFACT_HTTP_HOST:-0.0.0.0}"
export EFACT_HTTP_PORT="${EFACT_HTTP_PORT:-8765}"
if [[ -z "${OUTPUT_DIR:-}" ]]; then
  if [[ -d /data ]]; then
    export OUTPUT_DIR="/data/efact-output"
  else
    export OUTPUT_DIR="$ROOT/server/efact/output"
  fi
fi
mkdir -p "$OUTPUT_DIR"

cd "$ROOT/server/efact"
python3 api_server.py &
EFACT_PID=$!

cleanup() {
  kill "$EFACT_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

sleep 1

cd "$ROOT"
exec node server/index.js
