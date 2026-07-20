# AGENTS.md

## Cursor Cloud specific instructions

### Where the app lives
The runnable product ("Live Rhetoric") lives entirely in `overlay-assistant/`, not the repo root. Run all `pnpm` commands from `overlay-assistant/` (or with `pnpm -C overlay-assistant ...`). Toolchain (Node 22, pnpm 11.7.0, Python 3.12) is preinstalled; `pnpm install --frozen-lockfile` is handled by the startup update script.

### Running the app (dev)
From `overlay-assistant/`, `pnpm dev` starts three processes concurrently: the `shared` package in tsc watch, the server, and the web PWA. See `package.json` scripts for the individual `dev:server` / `dev:web` commands.
- Server API + WebSocket: `http://127.0.0.1:8080` (WS at `/ws`). `/health` returns 200; status is `"degraded"` when Postgres is absent (expected here — see below).
- Web PWA (Vite): reachable at `http://localhost:5173`. Vite binds to `localhost`/IPv6 only, so `curl http://127.0.0.1:5173` fails — use `localhost`.
- In loopback dev, auth is auto-bootstrapped: the server generates local owner credentials under `data/private/` and the UI prefills the access/pairing code, so no manual login is needed. Just click "Open live session" to start a coaching session.

### Optional services (NOT installed here)
Postgres and the Python speaker-verification service are optional and require Docker / `uv`, which are not installed. The app runs fine without them:
- No DB → `/health` reports `degraded` but the app works; DB is only session/analytics metadata (`DATABASE_REQUIRED` defaults to `false`).
- No `OPENAI_API_KEY` → live AI coaching falls back to deterministic scripted lines (fine for local testing). Put a real key in repository-root `.env.local` for real coaching; optionally set `STT_MOCK=true` to simulate transcription without live audio. Config template: `overlay-assistant/.env.example`.

### Lint / test / build
Standard commands (see `overlay-assistant/package.json` and `.github/workflows/ci.yml`):
- `pnpm run check` — builds `shared`, then runs lint (tsc `--noEmit`), typecheck, and Vitest tests across all packages.
- `pnpm run build` — production build of all packages.
- `pnpm -C apps/server smoke:runtime` — HTTP + WebSocket runtime smoke.
- Python speaker unit tests: `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=services/speaker/src python3 -m unittest discover -s services/speaker/tests`. These need no heavy deps — `torch`/`transformers`/`numpy`/`fastapi` are lazily imported, so the unit tests run on stdlib only (matching CI).
