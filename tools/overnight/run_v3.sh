#!/usr/bin/env bash
set -euo pipefail

# Run Overnight v3 from repo root.
# Usage:
#   bash tools/overnight/run_v3.sh --minutes 45 --sessions 300 --turns 10 --concurrency 2
#
# Notes:
# - Uses tsx from apps/server workspace (so you don't need to install anything new).
# - Writes outputs under tools/overnight/out/

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

# Ensure deps are installed
if [ ! -d "node_modules" ]; then
  echo "[overnight:v3] node_modules missing. Run: pnpm install"
  exit 1
fi

pnpm -C apps/server exec tsx ../../tools/overnight/v3/run_v3.ts "$@"
