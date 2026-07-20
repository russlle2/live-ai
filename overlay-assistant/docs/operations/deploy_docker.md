# Docker deployment

## Security prerequisites

Docker Compose 2.24+ is required. Before starting the container path, create repository-root `.env.local` with at least:

```dotenv
JWT_SECRET=<32-or-more-random-characters>
PERSONAL_ACCESS_CODE=<12-or-more-random-characters>
PRIVATE_STORAGE_ENCRYPTION_KEY=<a-separate-32+-character-random-secret>
GOOGLE_STORAGE_ENCRYPTION_KEY=<a-different-32+-character-random-secret>
COMPOSE_WEB_ORIGIN=http://localhost:8080
APP_BIND_ADDRESS=127.0.0.1
LIVE_AI_UID=1000
LIVE_AI_GID=1000
```

Add `OPENAI_API_KEY` and the Google OAuth client values when using those features. On Linux, set `LIVE_AI_UID` and `LIVE_AI_GID` to the actual owner of `overlay-assistant/data/private` (`id -u` and `id -g`) and ensure that directory is owner-only. Keep the three secrets stable and outside source control.

Container deployments must configure explicit authentication. The host-development bootstrap endpoint requires the server to directly observe a loopback peer; Docker bridge/NAT and reverse-proxy traffic may not satisfy that check even when the published host port is loopback-only.

## Start the stack

From `overlay-assistant`:

```bash
docker compose --env-file ../.env.local up --build -d app
docker compose --env-file ../.env.local ps
curl --fail http://127.0.0.1:8080/health
```

Starting `app` also starts its PostgreSQL and speaker-verifier dependencies. The app waits for their health checks, applies SQL migrations, serves the built PWA/API, and mounts `./data/private` at runtime. The public image does not contain environment files or private data.

The main Compose topology is deliberately private:

- PostgreSQL and the speaker API have no host-published ports;
- the app publishes to `127.0.0.1:8080` by default;
- the speaker receives only speaker-specific environment values plus `speaker_private` and model-cache volumes;
- the speaker does not receive repository-root `.env.local` or the app's complete private-data directory.

`docker-compose.dev.yml` publishes PostgreSQL and speaker ports on host loopback for a host-run Node server. Do not include that override in deployment.

## HTTPS and phone/LAN access

For a deployed origin, set:

```dotenv
COMPOSE_WEB_ORIGIN=https://your-host.example
GOOGLE_REDIRECT_URI=https://your-host.example/api/google/oauth/callback
```

Register the callback exactly in Google Cloud. Terminate TLS with an authenticated host reverse proxy or a private HTTPS tunnel, keep the app publish on loopback, restrict access to the owner's devices, and pass WebSocket upgrades. Browser microphone, display capture, and service-worker behavior require HTTPS outside localhost.

Set `APP_BIND_ADDRESS=0.0.0.0` only when a host firewall and authenticated HTTPS perimeter are already in place. A broadly bound raw HTTP port is not a phone-deployment solution. Configure the exact browser origin; browser WebSocket admission rejects unexpected origins.

Leave `TRUST_PROXY=false` unless the app is reachable only through a trusted proxy that overwrites client-forwarding headers. When that boundary is true, enable it so IP-based rate limits use the proxy-provided client address; never trust forwarding headers from an internet-reachable raw app port.

## Database transport

The built-in Compose database stays on the private Compose network and uses `DB_SSL=false`. The server passes an explicit no-TLS setting in that mode, so an ambient `PGSSLMODE` cannot silently change the local policy.

If you replace it with a remote PostgreSQL service, use a Compose override for `DATABASE_URL` and set `DB_SSL=true`. The URL authority must contain the database's DNS hostname so certificate identity can be checked; IP addresses and a `host=` query parameter are rejected. Leave `DB_SSL_CA_FILE` empty to use the container's operating-system trust store, or mount a non-empty PEM CA bundle into the app container and point `DB_SSL_CA_FILE` to it. Do not add `ssl`, `sslmode`, certificate, key, root-certificate, or libpq-compatibility query parameters to `DATABASE_URL`; startup rejects them so they cannot override the verified TLS policy.

## Private storage and backups

The stores are split:

- `overlay-assistant/data/private`: app auth state, personal memory, transcript/style logs, and encrypted Google state;
- `overlay-assistant/.pgdata`: PostgreSQL data;
- Compose volume `speaker_private`: owner speaker embedding;
- Compose volume `speaker_models`: downloaded model cache, not owner enrollment.

Git/Docker exclusions are publication controls, not encryption. Google state, personal memory, transcript turns, and delivery comparisons are application-encrypted. The populated environment file/API keys, auth state, PostgreSQL directory, numeric style-feature logs, and speaker embedding still rely on filesystem/container permissions and host disk protection. Put the Docker host and volumes on encrypted storage and send backups only to encrypted owner-controlled storage. Back up the `speaker_private` volume only if retaining the embedding is intentional; otherwise re-enroll after recovery.

The speaker model revision and Python lock are fixed, but container base images still use tags rather than immutable image digests. Rebuilds are therefore not fully byte-for-byte supply-chain reproducible until those digests are pinned.

## Google retention and deletion

Google consent is one time and accepts exactly Gmail read-only and Drive read-only scopes. Encrypted refresh tokens and cursors enable later background sync. Full source bodies are removed from the encrypted cache after extraction, while source-backed facts remain subject to memory gating.

Use **Erase all private data…** and type `ERASE MY PRIVATE DATA` before decommissioning. The app closes live sessions, purges app memory/logs and database metadata, removes Google-derived facts and local Google state, attempts provider revocation, and deletes the speaker enrollment. Because deployment secrets are environment-managed, the endpoint cannot rotate `JWT_SECRET`, `PERSONAL_ACCESS_CODE`, `PRIVATE_STORAGE_ENCRYPTION_KEY`, or `GOOGLE_STORAGE_ENCRYPTION_KEY`; rotate them manually afterward. Review warnings and separately expire/delete reverse-proxy logs, container logs, and backups according to their retention policy.

## Operational checks

```bash
curl --fail https://your-host.example/health
curl --fail \
  --header "Authorization: Bearer $LIVE_AI_OWNER_TOKEN" \
  https://your-host.example/api/ai-status
curl --fail \
  --header "Authorization: Bearer $LIVE_AI_OWNER_TOKEN" \
  https://your-host.example/api/health/metrics
docker compose --env-file ../.env.local logs --tail=100 app
docker compose --env-file ../.env.local logs --tail=100 speaker
```

Set `LIVE_AI_OWNER_TOKEN` from an owner login without writing it to shell history or logs. `/health` is intentionally public and minimal: it reports only `ok` and overall `status`, making it suitable for a container/proxy health check. Detailed health metrics and AI model status require the owner bearer token and are returned with `Cache-Control: no-store`. A degraded public status can indicate optional database connectivity in host development; the Compose app itself depends on a healthy database before startup.
