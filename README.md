# Overlay Assistant (foundation demo)

This repo is a **GitHub-ready**, sellable foundation for the tool described in `MASTER_ALL_OUTPUTS.md`:
- **Real-time transcript → deterministic guidance → safe overlay patch**
- **No raw transcript logging** (hash + length only)
- **Strict patch sanitization** (`sanitizePatch_v1`) and bounded payloads
- **Trust dashboard** fed by privacy-safe telemetry

## What you get

- `packages/shared`: versioned protocol + patch sanitizer shared by server + web.
- `apps/server`: API + WS server + arbitration engine + telemetry + DB.
- `apps/web`: demo UI (call simulator + overlay preview + trust dashboard).

## Quickstart (local)

### 1) Start Postgres

```bash
docker compose up -d db
```

### 2) Configure env

```bash
cp .env.example .env
```

### 3) Install deps

```bash
npm install
```

### 4) Run DB migrations

```bash
npm run db:migrate -w apps/server
```

### 5) Run dev servers

```bash
npm run dev
```

- Web: http://localhost:5173
- Server: http://localhost:8080

## Demo loop (how to use it)

1. Open the web UI.
2. Click **Start Session** (creates a WS session + starts STT mock if enabled).
3. Either:
   - let the STT mock stream transcript blocks, or
   - type a transcript line and click **Send transcript_final**.
4. The server runs **backend arbitration**, emits a **sanitized patch**, and the overlay preview renders a guidance card.
5. Click **Apply / Dismiss / Mute** to generate telemetry.
6. Open **Trust Dashboard** to see computed trust metrics.

## Enforce / Apply / Integrate / Test / Deploy

### Enforce (safety & governance)
- Patch safety is enforced by `packages/shared/src/sanitize/sanitizePatch_v1.ts`.
- The allowlist `ALLOWED_PATCH_PATHS_V1` is intentionally small and should be treated as **governed surface**.
- WS and overlay message types are versioned in `packages/shared/src/protocol/*_v1.ts`.

### Integrate (real product)
Replace the demo components with your real:
- STT input (Zoom/Meet/Teams)
- Overlay transport (popup + BroadcastChannel)
- CRM connectors (Salesforce/HubSpot) using the idempotent pattern in `apps/server/src/integrations/*`.

### Test
```bash
npm run test
npm run typecheck
```

### Deploy
Option A: single container (API + static web)
```bash
docker build -t overlay-assistant .
docker run --rm -p 8080:8080 --env-file .env overlay-assistant
```

Option B: run server + web separately (recommended for production)
- Serve the web build via CDN
- Run the server behind an API gateway with Postgres

## Selling this to a company

See:
- `docs/product_truth_one_pager.md`
- `docs/selling/packaging_and_delivery.md`
- `docs/roadmap/Q2_overlay_exit_criteria.md` (what you must prove before pilots)
