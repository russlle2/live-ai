# Local development

## Requirements

- Node 22+
- pnpm 11.7.0
- Docker Compose 2.24+ for PostgreSQL and the containerized speaker verifier
- Chrome or Edge for microphone and display/tab-audio capture
- an encrypted local disk if real personal data will be retained

## Host-development setup

From `overlay-assistant`:

```bash
pnpm install --frozen-lockfile
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db speaker
pnpm -C apps/server db:migrate
pnpm dev
```

If the repository-root `.env.local` exists, use it for Compose interpolation too:

```bash
docker compose --env-file ../.env.local \
  -f docker-compose.yml -f docker-compose.dev.yml \
  up -d db speaker
```

The development override publishes PostgreSQL at `127.0.0.1:5432` and the speaker service at `127.0.0.1:8791`. The web app is `http://localhost:5173`; the API and WebSocket server are `http://localhost:8080` and `ws://localhost:8080/ws`. Do not use the override to expose either private service beyond loopback.

The server loads environment values from repository-root `.env.local`, then `overlay-assistant/.env.local`, then `overlay-assistant/.env`. Documented relative configured paths resolve from `overlay-assistant`, not the package/process working directory; guarded private/control paths reject a relative escape.

## Host-development authentication

If `JWT_SECRET` and `PERSONAL_ACCESS_CODE` are not both supplied, the host server creates strong credentials in `data/private/personal_auth.local.json`. Because the server directly observes the laptop request as loopback, the UI can fetch the generated access code, log in, and display it for phone pairing. The endpoint is cache-disabled and rejects non-loopback peers.

This convenience is specifically for host development. Docker bridge/NAT and reverse-proxy peers may not appear as loopback. Configure explicit auth and Google storage secrets for every container/proxy deployment. No-auth development is not automatic; it requires `ALLOW_INSECURE_DEMO_AUTH=true` and must remain a temporary loopback-only demo.

## Optional Gmail/Drive connection

Create a Google OAuth web client, enable Gmail and Drive APIs, and register `http://localhost:8080/api/google/oauth/callback` exactly. Add the client values to repository-root `.env.local`. For host-managed auth, a separate storage key is generated automatically; for explicitly configured auth, also set a distinct `GOOGLE_STORAGE_ENCRYPTION_KEY` of 32+ characters.

Press **Connect once** in the app. It accepts exactly Gmail read-only and Drive read-only scopes. OAuth material, pending state, cursors, and the minimized cache are encrypted; subsequent background sync uses the refresh token without repeated consent.

## Verification

```bash
pnpm run check
pnpm run build
curl --fail http://127.0.0.1:8080/health
curl --fail http://127.0.0.1:5173/
```

For the production Compose path, stop the host dev server first, then:

```bash
docker compose --env-file ../.env.local up --build -d app
curl --fail http://127.0.0.1:8080/health
```

Explicit `JWT_SECRET`, `PERSONAL_ACCESS_CODE`, and `GOOGLE_STORAGE_ENCRYPTION_KEY` are required for this container path; do not expect loopback bootstrap through Docker. On Linux, set `LIVE_AI_UID`/`LIVE_AI_GID` to the owner of `data/private` so the non-root app container can write its bind mount.

## Audio checks

Use a call/media tab whose audio can be shared and confirm:

- microphone transcript is **You** (`rep`);
- shared remote tab/system transcript is **Other person** (`lead`);
- owner speech does not trigger coaching;
- a cushion appears immediately after a remote turn and an older request cannot overwrite the current final line;
- voice status collects three clean microphone turns and reports enrolled without retaining a raw recording;
- stopping/restarting capture resets directional calibration;
- removing the shared audio track causes mixed/unknown behavior rather than false remote attribution.

Never commit test recordings, real voice embeddings, populated memory, Google state, or session logs. Generated audio/text fixtures are acceptable. Even ignored local files are plaintext at rest unless their specific store says otherwise, so keep the workspace on encrypted storage.
