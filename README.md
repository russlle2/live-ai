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
pnpm install
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
- Mobile coach app: http://localhost:5174
- Server: http://localhost:8080

To run desktop + mobile + server together:

```bash
npm run dev:all
```

To run only the phone app:

```bash
npm run dev:mobile
```

## Demo loop (how to use it)

1. Open the web UI.
2. Click **Start Session** (creates a WS session + starts STT mock if enabled).
3. Either:
   - let the STT mock stream transcript blocks, or
   - type a transcript line and click **Send transcript_final**.
4. The server runs **backend arbitration**, emits a **sanitized patch**, and the overlay preview renders a guidance card.
5. Click **Apply / Dismiss / Mute** to generate telemetry.
6. Open **Trust Dashboard** to see computed trust metrics.

## Universal live coach mode (desktop + phone)

1. Start a session on desktop web (`apps/web`) and copy the session ID.
2. Open the phone app (`apps/mobile`) and join with the same tenant/rep/session values.
3. Use phone controls to mute, reframe, switch guidance mode, and tune AI depth while desktop overlay stays live.
4. When the engine changes interpretation after new context, both clients receive a `correction` event and updated guidance.
5. Mark guidance as helpful/unhelpful in either client to adapt depth in-session.

### Bluetooth support note

- The mobile app includes Web Bluetooth pairing for browser-supported devices.
- Full hardware-button remote control behavior depends on the connected BLE device profile and browser support.
- For production mobile BLE support across iOS/Android, use a native wrapper (for example Capacitor/React Native) around this control protocol.

## Universal compatibility and integrations

- Universal compatibility architecture and hardening details: `docs/operations/universal_compatibility.md`.
- Integrated dispatcher targets now include: Salesforce, HubSpot, Zoom, Google Meet, Google Workspace, Bluetooth bridge, and server webhooks.
- Integration dispatch is handled via `apps/server/src/integrations/universal_dispatch.ts`.
- Enterprise policy templates: `docs/operations/enterprise_policy_templates.md`.
- Native Bluetooth bridge rollout plan: `docs/operations/native_mobile_ble_plan.md`.

### Tenant OAuth onboarding (Zoom + Google)

- Start OAuth: `POST /api/integrations/oauth/start` with `{ tenantId, provider, redirectUri }`.
- Complete OAuth: `POST /api/integrations/oauth/callback` with `{ tenantId, provider, code, state, redirectUri }`.
- Check status: `GET /api/integrations/oauth/status?tenantId=...&provider=zoom|google`.
- Tokens are stored tenant-scoped and encrypted at rest using `OAUTH_TOKEN_ENC_KEY`.

### Live voice + intelligence APIs

- Streaming voice frame endpoint: `POST /api/live/audio_frame` (VAD + STT payload handling + intelligence output).
- Conversation intelligence endpoint: `POST /api/conversation/intel` (entities, moments, compliance risk detection).
- Privacy controls: `GET /api/privacy/controls` and `POST /api/privacy/controls`.
- Session artifact deletion: `POST /api/privacy/delete-session`.
- Manual retention prune trigger: `POST /api/privacy/prune-retention` with optional `{ tenantId }`.
- Retention scheduler status: `GET /api/privacy/retention-status?tenantId=...`.
- Persisted session timeline: `GET /api/conversation/timeline?tenantId=...&sessionId=...&limit=...`.
- Realtime timeline push over WS: `timeline_event` server message for low-latency transcript/risk updates.
- Delta timeline fetches: `GET /api/conversation/timeline?...&sinceId=<lastSeenId>` returns only new events and `nextSinceId` checkpoint.

### Bluetooth-first transcription workflow

- Web app now includes a **Live Audio** tab for Bluetooth-prioritized input device selection, VAD meter, partial/final STT streaming, and intelligence/risk preview.
- Mobile app now includes a **Bluetooth Transcription Bridge** section to stream live audio frames from Bluetooth headset input into `/api/live/audio_frame`.
- Both interfaces support fallback modes if browser speech recognition is unavailable, while still sending VAD energy frames.
- Both interfaces now include real-time transcript panes, compliance alert feeds, and objection/moment timelines for live call monitoring.
- Transcript/risk/timeline panes now hydrate from a shared server timeline so they survive refresh and stay synchronized across desktop + mobile.
- UIs now consume pushed `timeline_event` updates first, with timeline polling retained as resilience fallback.
- UIs now deduplicate timeline entries by event ID and maintain checkpoint cursors to reduce UI churn and backend reads.

### Automated retention pruning

- Server now enforces tenant retention policy (`retentionDays`) across timeline, observability, CRM write events, and stale sessions.
- Scheduler controls:
   - `RETENTION_PRUNE_ENABLED=true|false`
   - `RETENTION_PRUNE_INTERVAL_MS` (default 900000 / 15m)

### DB migrations

- Includes OAuth and privacy tables in:
   - `apps/server/src/db/migrations/002_oauth_tokens.sql`
   - `apps/server/src/db/migrations/003_privacy_controls.sql`

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
