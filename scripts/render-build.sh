#!/usr/bin/env bash
# Build estándar Render (runtime Node nativo). Usar en ambos Web Services del mismo repo.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "[render-build] npm install + build frontend…"
npm install
npm run build

echo "[render-build] dependencias Python e-fact…"
python3 -m pip install -r server/efact/requirements.txt

echo "[render-build] listo."
