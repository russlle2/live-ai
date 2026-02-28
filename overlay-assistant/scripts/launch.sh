#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────
# Sales Coach Pro — Quick Launch Script
# Works on Linux, macOS, and Windows (Git Bash / WSL)
# ──────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN_DIR="$PROJECT_DIR/.run"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

log()  { printf "${GREEN}[launch]${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}[launch]${NC} %s\n" "$*"; }
fail() { printf "${RED}[launch]${NC} %s\n" "$*"; exit 1; }

# ── Ensure we're in the project root ──
cd "$PROJECT_DIR"

# ── Check prerequisites ──
command -v pnpm &>/dev/null || fail "pnpm is required. Install with: npm install -g pnpm"
command -v docker &>/dev/null || warn "Docker not found — database might not start"

# ── Start database ──
if command -v docker &>/dev/null; then
  log "Starting PostgreSQL database…"
  docker compose up -d db 2>/dev/null || docker-compose up -d db 2>/dev/null || warn "Could not start DB"
  
  # Wait for DB to be healthy (max 30s)
  log "Waiting for database…"
  for i in $(seq 1 30); do
    if docker compose exec -T db pg_isready -U overlay &>/dev/null 2>&1; then
      log "Database is ready"
      break
    fi
    sleep 1
    if [ "$i" = "30" ]; then warn "Database may not be ready yet"; fi
  done
fi

# ── Install dependencies (if needed) ──
if [ ! -d "node_modules" ]; then
  log "Installing dependencies…"
  pnpm install
fi

# ── Run DB migrations ──
log "Running database migrations…"
pnpm -C apps/server db:migrate 2>/dev/null || warn "Migrations may have failed (DB might be seeded already)"

# ── Start dev servers ──
mkdir -p "$RUN_DIR"
log "Starting development servers…"
pnpm dev > "$RUN_DIR/dev.log" 2>&1 &
DEV_PID=$!
echo "$DEV_PID" > "$RUN_DIR/dev.pid"

# ── Wait for web server ──
log "Waiting for web app (http://localhost:5173)…"
for i in $(seq 1 60); do
  if curl -sf http://localhost:5173 > /dev/null 2>&1; then
    log "Web app is ready!"
    break
  fi
  sleep 1
  if [ "$i" = "60" ]; then warn "Web app took longer than expected to start"; fi
done

# ── Open browser ──
URL="http://localhost:5173"
log "Opening $URL …"
if command -v xdg-open &>/dev/null; then xdg-open "$URL"
elif command -v open &>/dev/null; then open "$URL"
elif command -v start &>/dev/null; then start "$URL"
else log "Open $URL in your browser"
fi

log "Sales Coach Pro is running! (PID: $DEV_PID)"
log "Logs: $RUN_DIR/dev.log"
log "Stop: kill $DEV_PID (or Ctrl+C)"

# ── Keep running until Ctrl+C ──
trap 'log "Shutting down…"; kill $DEV_PID 2>/dev/null; exit 0' INT TERM
wait $DEV_PID 2>/dev/null || true
