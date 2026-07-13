#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────
# Live Rhetoric — Quick Launch Script
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

COMPOSE_AVAILABLE=false
if command -v docker &>/dev/null && docker compose version &>/dev/null; then
  COMPOSE_VERSION="$(docker compose version --short 2>/dev/null || true)"
  COMPOSE_VERSION="${COMPOSE_VERSION#v}"
  COMPOSE_MAJOR="${COMPOSE_VERSION%%.*}"
  COMPOSE_REMAINDER="${COMPOSE_VERSION#*.}"
  COMPOSE_MINOR="${COMPOSE_REMAINDER%%.*}"
  if [[ "$COMPOSE_MAJOR" =~ ^[0-9]+$ ]] && [[ "$COMPOSE_MINOR" =~ ^[0-9]+$ ]] \
    && { [ "$COMPOSE_MAJOR" -gt 2 ] || { [ "$COMPOSE_MAJOR" -eq 2 ] && [ "$COMPOSE_MINOR" -ge 24 ]; }; }; then
    COMPOSE_AVAILABLE=true
  else
    warn "Docker Compose 2.24+ is required for the private service stack (found ${COMPOSE_VERSION:-unknown}); continuing without it"
  fi
else
  warn "Docker Compose not found — database and voice verification will not start"
fi

COMPOSE_ENV=()
if [ -f "$PROJECT_DIR/../.env.local" ]; then
  COMPOSE_ENV=(--env-file "$PROJECT_DIR/../.env.local")
fi
COMPOSE_FILES=(-f "$PROJECT_DIR/docker-compose.yml" -f "$PROJECT_DIR/docker-compose.dev.yml")

compose() {
  docker compose "${COMPOSE_ENV[@]}" "${COMPOSE_FILES[@]}" "$@"
}

# ── Start private services ──
DB_READY=false
if [ "$COMPOSE_AVAILABLE" = true ]; then
  log "Starting PostgreSQL and the private speaker verifier…"
  if compose up -d db speaker; then
    log "Waiting for database…"
    for i in $(seq 1 30); do
      if compose exec -T db pg_isready -U overlay -d overlay &>/dev/null; then
        DB_READY=true
        log "Database is ready"
        break
      fi
      sleep 1
    done
    if [ "$DB_READY" != true ]; then
      warn "Database did not become ready; the app will run in degraded mode"
    fi
  else
    warn "Could not start PostgreSQL/speaker services; the app will run in degraded mode"
  fi
fi

# ── Install exactly the committed dependency graph ──
log "Verifying dependencies from pnpm-lock.yaml…"
pnpm install --frozen-lockfile

# ── Run DB migrations ──
if [ "$DB_READY" = true ]; then
  log "Running database migrations…"
  pnpm -C apps/server db:migrate || fail "Database migrations failed"
else
  warn "Skipping database migrations because PostgreSQL is unavailable"
fi

# ── Start dev servers ──
mkdir -p "$RUN_DIR"
if [ -f "$RUN_DIR/dev.pid" ]; then
  EXISTING_PID="$(tr -dc '0-9' < "$RUN_DIR/dev.pid")"
  if [ -n "$EXISTING_PID" ] && kill -0 "$EXISTING_PID" 2>/dev/null; then
    fail "Live Rhetoric is already running with PID $EXISTING_PID"
  fi
fi

DEV_PID=""
cleanup() {
  if [ -n "$DEV_PID" ] && kill -0 "$DEV_PID" 2>/dev/null; then
    kill "$DEV_PID" 2>/dev/null || true
    wait "$DEV_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

log "Starting development servers…"
pnpm dev > "$RUN_DIR/dev.log" 2>&1 &
DEV_PID=$!
printf '%s\n' "$DEV_PID" > "$RUN_DIR/dev.pid"

# ── Verify both public surfaces ──
log "Waiting for API and web app…"
API_READY=false
WEB_READY=false
for i in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:8080/health >/dev/null 2>&1; then API_READY=true; fi
  if curl -fsS http://127.0.0.1:5173/ >/dev/null 2>&1; then WEB_READY=true; fi
  if [ "$API_READY" = true ] && [ "$WEB_READY" = true ]; then
    break
  fi
  if ! kill -0 "$DEV_PID" 2>/dev/null; then
    tail -n 40 "$RUN_DIR/dev.log" >&2 || true
    fail "Development servers exited before becoming ready"
  fi
  sleep 1
done

if [ "$API_READY" != true ] || [ "$WEB_READY" != true ]; then
  tail -n 40 "$RUN_DIR/dev.log" >&2 || true
  fail "Readiness timed out (API=$API_READY, web=$WEB_READY)"
fi
log "API and web app are ready"

# ── Open browser ──
URL="http://localhost:5173"
log "Opening $URL …"
if command -v xdg-open &>/dev/null; then xdg-open "$URL"
elif command -v open &>/dev/null; then open "$URL"
elif command -v start &>/dev/null; then start "$URL"
else log "Open $URL in your browser"
fi

log "Live Rhetoric is running! (PID: $DEV_PID)"
log "Logs: $RUN_DIR/dev.log"
log "Stop the app with Ctrl+C. Docker services remain available for the next launch."

# ── Keep running until Ctrl+C ──
wait "$DEV_PID"
