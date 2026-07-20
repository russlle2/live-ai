# Live Rhetoric personal aide

Live Rhetoric is a private, single-owner communication copilot designed to put a credible next sentence on the owner's laptop and phone as the other person finishes speaking. The active modes are interview, insurance sales, IT support, inbound service, negotiation, and general rhetoric.

## Live behavior

1. The laptop captures the local microphone as **You** and a user-selected tab/system-audio track as **Other person**.
2. AudioWorklet-driven, audio-time VAD keeps each source independent even when a browser tab is backgrounded. Concurrent speech is retained as overlap, and a verified remote start during owner speech emits an interruption immediately.
3. Each source uses local faster-whisper when its loopback service is healthy, otherwise the configured cloud transcription path. Source separation is the primary identity signal, and only a verified remote turn triggers coaching.
4. A safe cushion appears immediately, a deterministic provisional line follows if needed, and an accepted grounded local-first or cloud response replaces it when ready. New speech aborts obsolete inference instead of merely hiding its result. Before display, a deterministic guard rejects unknown memory citations, private identifiers/source references, weakly grounded personal/action/title/numeric/employer/credential claims, unverified insurance claims, unauthorized service promises, negotiation bluffs, credential requests, and destructive IT commands; rejection keeps the safe fallback.
5. A phone can join the session as a companion display while the laptop remains the audio host.
6. Every session opens with an exact greeting and includes a mode-specific, seven-stage path through the final goodbye.
7. Owner speech produces numeric style features without retaining exact phrasing. A profile changes only after at least 12 eligible observations across three sessions; accepted model wording and factual corrections do not train style.
8. In an explicitly declared two-fixed-speaker setup, true stereo direction can supplement owner-voice verification. Three strong owner-side observations calibrate the side and two stable opposite-side observations are required before `Other`; conflicts remain `Unknown`.
9. Chromium browsers can pop the current response into a native always-on-top Document Picture-in-Picture window.

Google Meet and Zoom Web work only when the owner explicitly selects the call tab and enables its audio. Zoom desktop works only when the browser and operating system return audio for the selected window or system source. A phone PWA cannot directly capture protected same-device cellular or VoIP call audio. Its foreground microphone can hear an in-room conversation or a speakerphone playing from another device. Mono, dual-mono, overlap, movement, weak evidence, and conflicting cues remain `Unknown`; the owner can use **That was them — coach this** after checking the speaker.

## Quick start

Requirements: Node 22+, pnpm 11.7.0, Docker Compose 2.24+ for the local PostgreSQL/speaker services, and Chrome or Edge for tab-audio capture.

```bash
cd overlay-assistant
pnpm install --frozen-lockfile
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db speaker
pnpm -C apps/server db:migrate
pnpm dev
```

If repository-root `.env.local` exists, add `--env-file ../.env.local` before `-f`. The development UI is `http://localhost:5173`; the API and WebSocket server are on `http://localhost:8080`. The development override publishes PostgreSQL and the speaker service only on host loopback. The main Compose file keeps them on the private Compose network.

The server loads environment values in this order:

1. repository-root `.env.local`;
2. `overlay-assistant/.env.local`;
3. `overlay-assistant/.env`.

Documented relative runtime paths are resolved from `overlay-assistant`, regardless of the process working directory. Guarded private/control paths reject escapes from that root. Never commit a populated environment file.

### Optional one-command Windows local AI

On the target Windows 11 laptop, `scripts/setup-local-ai.ps1` installs `uv` and Ollama through WinGet, downloads the configured local coaching model, installs the locked faster-whisper service, updates repository-root `.env.local`, and starts both loopback services. The app automatically prefers healthy local coaching and transcription while retaining cloud providers as optional fallbacks.

## Authentication and phone pairing

Authentication is fail-closed by default. In host development, if `JWT_SECRET` and `PERSONAL_ACCESS_CODE` are not both supplied, the server creates strong local credentials in `data/private/personal_auth.local.json` with owner-only permissions. The laptop UI can retrieve the generated pairing code only when the server directly observes the peer as loopback; it fills the local login and displays the code for the phone. Enter it once to pair the current phone browser session and obtain its owner JWT; re-entry is required after browser session storage is cleared or credentials rotate. Do not send the code in chat or store it in the repository.

Do not depend on loopback bootstrap inside Docker or behind a reverse proxy: bridge/NAT/proxy traffic may not appear as loopback to the server even when the published host port is `127.0.0.1`. Container and reverse-proxy deployments must explicitly set `JWT_SECRET`, `PERSONAL_ACCESS_CODE`, and `PRIVATE_STORAGE_ENCRYPTION_KEY`; add a distinct `GOOGLE_STORAGE_ENCRYPTION_KEY` when Google sync is enabled.

Supplying both environment values disables managed rotation; `JWT_SECRET` must contain at least 32 characters and `PERSONAL_ACCESS_CODE` at least 12. `ALLOW_INSECURE_DEMO_AUTH=true` is the only unauthenticated mode. It is for a temporary loopback-only demo and must never be used on a LAN or internet endpoint.

For a phone:

1. Configure explicit `JWT_SECRET`, `PERSONAL_ACCESS_CODE`, `PRIVATE_STORAGE_ENCRYPTION_KEY`, and—when used—`GOOGLE_STORAGE_ENCRYPTION_KEY`, then put the app behind an authenticated HTTPS reverse proxy or private HTTPS tunnel; leave the app's host port on loopback.
2. Open the HTTPS deployment on the laptop and start an **Audio host** session.
3. Share the call tab/window and enable its audio.
4. Open the same deployment on the phone, enter the pairing code, choose **Companion**, and enter the laptop session ID.
5. Add the PWA to the home screen if desired.

Outside localhost, microphone, screen capture, and service workers require a secure context. Set `COMPOSE_WEB_ORIGIN` and `GOOGLE_REDIRECT_URI` to the exact public HTTPS values. `WEB_ORIGIN=*` is rejected because a wildcard could expose local pairing credentials; configure one exact origin. Set `APP_BIND_ADDRESS=0.0.0.0` only when an authenticated HTTPS proxy and host firewall protect the port.

## Automatic private memory

Git and Docker exclusions prevent publication; they do not disable runtime use. The server automatically reads and writes:

| Resource | Host/local path | Runtime behavior |
| --- | --- | --- |
| OpenAI key | repository-root `.env.local` | loaded server-side at startup; never returned to the PWA |
| Authentication state | `data/private/personal_auth.local.json` | generated and reused when explicit auth secrets are absent |
| Personal memory | `data/private/personal_memory.local.json` | authenticated encryption at rest; relevant eligible facts retrieved for verified remote turns |
| Transcript/style logs | `data/private/sessions/` | independently encrypted turn/comparison records retained indefinitely by default, plus non-text numeric style features |
| Google state | `data/private/google/` | encrypted OAuth material, resumable cursors, and minimized source cache |
| Owner embedding, local service | `data/private/speaker/owner_embedding.json` | three mutually consistent owner-microphone turns enroll it; raw clips are discarded |
| Owner embedding, Compose | named volume `speaker_private` | same purpose without bind-mounting the root environment or entire private directory into the speaker container |

Memory policy depends on the processing boundary:

- local personal coaching may retrieve normal and sensitive review-gated context with an explicit `review-required` marker and ranking penalty;
- spoken personal-history claims still require review-clear supporting evidence;
- cloud coaching uses the stricter review-clear/verified policy;
- restricted facts are never included in automatic coaching prompts.

Confidence, provenance, temporality, validity dates, and current conflicts still affect ranking or gating. The public `data/personal_memory.example.json` is fabricated schema documentation, not owner data.

Conversation-derived employment, education, skill, achievement, project, and career-story claims are stored automatically and marked for owner review. Local personal mode can use them as tentative context for clarification, but deterministic output validation prevents them from becoming asserted biography until review clears. Unsupported managerial actions or titles are rejected during extraction.

Use **Review facts** in the automation panel to inspect normalized fact text and source metadata, verify a claim as written, correct and verify it, or delete it. Verification clears its review flags; it does not change the policy above. In particular, a normal review-clear fact may already be eligible before confirmation, while a restricted fact remains excluded even after confirmation. The panel does not reveal cached source bodies, OAuth material, or hidden credentials.

Google OAuth and cache files use authenticated AES-256-GCM encryption. Fully managed host bootstrap creates a separate storage key automatically. When auth is environment-managed, `GOOGLE_STORAGE_ENCRYPTION_KEY` is required and must contain at least 32 characters; the app does not reuse `JWT_SECRET`. Keep the storage key stable or the encrypted state cannot be read. Legacy plaintext Google state is migrated on a successful read.

Personal memory, transcripts, and suggestion/style comparison records now use authenticated application encryption with automatic plaintext migration. The populated environment file/API keys, managed auth bootstrap file, PostgreSQL data, numeric style-feature log, and speaker embedding are not all application-encrypted; private stores also use restrictive `0700` directory/`0600` file permissions. Keep full-disk or encrypted-volume protection and encrypted, owner-controlled backups. For Compose, include the `speaker_private` volume in that policy or simply re-enroll after loss.

## One-time Gmail and Drive connection

ChatGPT/Codex connector credentials cannot be exported into this independent runtime. Create a Google OAuth web client and consent once:

1. Enable the Gmail and Drive APIs and configure the consent screen.
2. Register the exact local callback `http://localhost:8080/api/google/oauth/callback`, or the deployed HTTPS equivalent.
3. Put `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` in repository-root `.env.local`. Also set a dedicated `GOOGLE_STORAGE_ENCRYPTION_KEY` whenever auth is environment-managed; restart.
4. Press **Connect once**. The app accepts exactly `gmail.readonly` and `drive.readonly`; a saved refresh token supports bounded background catch-up and incremental sync.

Before source text reaches the extraction model or cache, the worker removes secret-bearing lines and exact email addresses, phone numbers, street addresses, verification codes, government/payment identifiers, and related credentials. Gmail subjects and Drive filenames are sanitized. During each Gmail run, the owner's profile address and From/To headers are converted locally into non-identifying owner/correspondent and inbound/outbound labels; exact addresses are not cached or sent to the model. Correspondent-authored or unknown-authorship high-impact claims are review-gated. Full source bodies are retained only while extraction is pending and are cleared after successful extraction; PDFs and Gmail attachment binaries are metadata-only, and unsupported Drive binaries are excluded. Extracted facts remain source-backed, review-gated, limited to eight per source, and deduplicated exactly across sources. Default catch-up is deliberately bounded: Gmail excludes Spam/Trash, Google requests and bodies are capped, extraction is metered per run and per day, and cache capacity is finite; current budget/capacity appears in runtime status.

## Coaching knowledge and speaker verification

- Live coaching retrieves up to three relevant examples from 96 original, reviewed weak-versus-improved contrasts: 16 in each of six modes. They are generic coaching knowledge, never personal evidence.
- The pinned HelpSteer2 audit covers 9,125 preference pairs. Five rows passed automatic staging filters, remain `liveRetrievalAllowed: false`, and do not enter runtime suggestions.
- The speaker service uses `anton-l/wav2vec2-base-superb-sv` at immutable Hub revision `eb0be47779dda10620d068ab579fca970ee7e417`. Its Python dependencies are locked in `services/speaker/uv.lock` and Docker installs them with `uv sync --frozen`.
- A strong embedding match may identify the owner. A non-match is not proof of the other person's identity; without a separate channel or the strict stereo rule it stays `Unknown`.

## Owner-controlled deletion

The automation panel provides **Erase all private data…** and requires the exact phrase `ERASE MY PRIVATE DATA`. A full purge closes active sessions, drains/cancels pending private writes, clears memory and transcript/style logs, removes Google-derived facts and encrypted Google state, attempts Google provider revocation, deletes the speaker enrollment, clears runtime database metadata, and discards pending telemetry. A memory-scope purge also disconnects and clears Google so background sync cannot repopulate memory. Managed JWT/access-code credentials and the managed Google storage key rotate, so existing tokens stop working and later Google state uses a fresh key; environment-managed secrets cannot be rotated by the app and produce a warning.

Treat warnings as unfinished deletion work. If the database or speaker service is unavailable, clear that store when it returns. Provider revocation is best effort. The initiating UI clears its browser state, but another browser may retain browser-local profile and session access-code text even though its old JWT is invalid; clear site data on every paired device. Existing stdout, proxy, or container logs and external encrypted backups have their own retention controls and cannot be retroactively erased by this endpoint.

## Consent and appropriate use

The app does not determine whether recording, transcription, call monitoring, or AI assistance is allowed. Laws, employer/customer rules, interview rules, and platform terms vary. Obtain clear participant consent before capture, disclose transcription/AI assistance when required, do not use the tool to evade an employer's or interviewer's rules, and delete scoped or all retained data afterward when required. Insurance guidance must stay within the owner's license, appointment, carrier scripts, and approved product disclosures.

## Verification

```bash
pnpm run check
pnpm run build
```

The root GitHub Actions workflow also rejects tracked private runtime paths. See [`docs/IMPLEMENTATION_CHECKPOINT.md`](docs/IMPLEMENTATION_CHECKPOINT.md) for the latest validated counts and unverified physical/cloud paths.

## Repository map

```text
apps/web                 React/Vite PWA and audio/companion UI
apps/server              API, WebSocket router, coaching, memory, integrations
packages/shared          versioned session, playbook, and transport types
packages/runtime         provider-neutral events, interruption state, deadlines, and slow style profiles
services/speaker         pinned Hugging Face owner-verification fallback
services/stt             locked local faster-whisper OpenAI-compatible service
data/private             ignored runtime state; automatically used, not encrypted as a whole
data/coaching            reviewed live contrasts, manifest, and staging audit
docs                     active operating, architecture, and product-truth documents
```
