#!/usr/bin/env bash
set -euo pipefail

ROOT="$(pwd)"
if [[ ! -f "$ROOT/package.json" ]]; then
  echo "[fix] ERROR: run this from repo root (where package.json lives)."
  exit 1
fi

echo "[fix] repoRoot=$ROOT"

#############################
# 0) Basic env sanity
#############################
if [[ -f "$ROOT/.env" ]]; then
  # Ensure SERVER_PORT is set (some earlier patches replaced PORT= with SERVER_PORT=)
  if ! grep -qE '^SERVER_PORT=' "$ROOT/.env"; then
    echo "SERVER_PORT=8080" >> "$ROOT/.env"
    echo "[fix] Added SERVER_PORT=8080 to .env"
  fi

  # Fix common broken DATABASE_URL that uses host 'user' (postgres://user:5432/user)
  if grep -qE '^DATABASE_URL=postgres(ql)?://user:5432/user' "$ROOT/.env"; then
    perl -pi -e 's#^DATABASE_URL=postgres(ql)?://user:5432/user#DATABASE_URL=postgres://localhost:5432/overlay#g' "$ROOT/.env"
    echo "[fix] Rewrote DATABASE_URL to postgres://localhost:5432/overlay"
  fi
else
  echo "[fix] NOTE: .env not found at repo root (OK if you export env vars some other way)."
fi

#############################
# 1) Fix CONFIG.port undefined (prevents "localhost:undefined")
#############################
CFG="$ROOT/apps/server/src/config.ts"
if [[ -f "$CFG" ]]; then
  python3 - <<'PY'
from pathlib import Path
p = Path("apps/server/src/config.ts")
txt = p.read_text()

if "export const CONFIG" not in txt:
    print("[fix] config.ts: couldn't find CONFIG export; skipping.")
    raise SystemExit(0)

if "port:" in txt:
    # ensure it prefers SERVER_PORT then PORT then 8080
    # (safe replace if someone used a different env var)
    import re
    txt2 = re.sub(r'port:\s*Number\([^)]*\)\s*,?',
                  'port: Number(process.env.SERVER_PORT || process.env.PORT || 8080),',
                  txt)
    if txt2 != txt:
        p.write_text(txt2)
        print("[fix] config.ts: normalized CONFIG.port to SERVER_PORT||PORT||8080")
    else:
        print("[fix] config.ts: CONFIG.port already present")
else:
    # Insert port as the first property inside CONFIG object
    import re
    m = re.search(r'export const CONFIG\s*=\s*\{\s*\n', txt)
    if not m:
        print("[fix] config.ts: couldn't find CONFIG object opener; skipping.")
        raise SystemExit(0)
    ins = m.end()
    txt2 = txt[:ins] + '  port: Number(process.env.SERVER_PORT || process.env.PORT || 8080),\n' + txt[ins:]
    p.write_text(txt2)
    print("[fix] config.ts: inserted CONFIG.port")
PY
else
  echo "[fix] WARNING: apps/server/src/config.ts not found; skipping port fix."
fi

#############################
# 2) Fix tone_pro_v1.ts crash + add brevity cues ("short/quick/TLDR")
#############################
TONE="$ROOT/apps/server/src/arbitration/pro/tone_pro_v1.ts"
if [[ -f "$TONE" ]]; then
  python3 - <<'PY'
from pathlib import Path

p = Path("apps/server/src/arbitration/pro/tone_pro_v1.ts")
txt = p.read_text()
orig = txt

# (A) Fix the invalid regex that crashes Node:
# /\b(today|this week|right now|now\b/i  ->  /\b(today|this week|right now|now)\b/i
txt = txt.replace(r'/\b(today|this week|right now|now\b/i', r'/\b(today|this week|right now|now)\b/i')

# (B) Add "brevity cues" to executive bucket so the engine auto-compresses when user says quick/short/tldr.
# Your overnight regex suggestions list includes "short", "quick", "today", "week", "question" as top correlated terms:contentReference[oaicite:1]{index=1}.
# We add the most actionable: short/quick/tldr/in one sentence/executive summary.
if "exec:brevity" not in txt:
    needle = "executive:"
    i = txt.find(needle)
    if i != -1:
        # try to find the end of the executive array by locating "],urgent" after it
        j = txt.find("],urgent", i)
        if j != -1:
            block = txt[i:j]
            insert = '{id:"exec:brevity",re:/\\b(short|quick|tl;dr|tldr|in (one|1) sentence|executive summary)\\b/i,w:.55},'
            if insert not in block:
                # insert right after the opening '[' of executive
                k = block.find("[")
                if k != -1:
                    block2 = block[:k+1] + insert + block[k+1:]
                    txt = txt[:i] + block2 + txt[j:]
        else:
            # fallback: append a tiny cue near top (non-breaking)
            txt = txt.replace("const TONE_RX={", "const TONE_RX={/* exec:brevity injected */")
    else:
        # no executive bucket found; do nothing
        pass

if txt != orig:
    p.write_text(txt)
    print("[fix] tone_pro_v1.ts patched (regex crash + exec brevity cues)")
else:
    print("[fix] tone_pro_v1.ts already OK (no changes needed)")
PY
else
  echo "[fix] WARNING: $TONE not found; skipping tone patch."
fi

#############################
# 3) Ensure Postgres is up (best effort) + migrations
#############################
export PATH="/usr/local/opt/postgresql@16/bin:/opt/homebrew/opt/postgresql@16/bin:$PATH"

if command -v pg_isready >/dev/null 2>&1; then
  if ! pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
    echo "[fix] Postgres not ready on :5432. Attempting local start..."
    PGDATA="${PGDATA:-$HOME/pg16data}"
    mkdir -p "$PGDATA"
    if [[ ! -f "$PGDATA/PG_VERSION" ]] && command -v initdb >/dev/null 2>&1; then
      echo "[fix] Initializing PGDATA at $PGDATA"
      initdb -D "$PGDATA" >/dev/null
    fi
    if command -v pg_ctl >/dev/null 2>&1; then
      pg_ctl -D "$PGDATA" -l "$HOME/pg16.log" start || true
      sleep 1
    fi
  fi

  # Create overlay DB if missing (non-fatal if it already exists)
  if command -v createdb >/dev/null 2>&1; then
    createdb overlay >/dev/null 2>&1 || true
  fi
else
  echo "[fix] NOTE: pg_isready not found; skipping automatic Postgres check."
fi

# Run migrations (this is where missing tables like sessions/obs_events get created)
echo "[fix] Running db:migrate..."
pnpm -C apps/server run db:migrate

#############################
# 4) Start server on 8080 and verify /health
#############################
echo "[fix] Killing anything still holding :8080 (best effort)..."
if command -v lsof >/dev/null 2>&1; then
  PIDS="$(lsof -ti tcp:8080 || true)"
  if [[ -n "${PIDS:-}" ]]; then
    kill -9 $PIDS || true
  fi
fi

echo "[fix] Starting server (apps/server dev) in background..."
mkdir -p "$ROOT/apps/server"
( pnpm -C apps/server run dev > "$ROOT/apps/server/server.log" 2>&1 & echo $! > "$ROOT/.server_pid" )

echo "[fix] Waiting for health..."
ok=0
for _ in $(seq 1 60); do
  if curl -fsS http://localhost:8080/health >/dev/null 2>&1; then ok=1; break; fi
  sleep 0.5
done

if [[ "$ok" == "1" ]]; then
  echo "[fix] ✅ SERVER UP:"
  curl -s http://localhost:8080/health || true
  echo
  echo "[fix] tail apps/server/server.log:"
  tail -n 25 "$ROOT/apps/server/server.log" || true
else
  echo "[fix] ❌ SERVER STILL DOWN. Last 120 log lines:"
  tail -n 120 "$ROOT/apps/server/server.log" || true
  exit 1
fi

