# Integration guide

## OpenAI coaching and transcription

The standard OpenAI API key is loaded by the backend only. The browser asks the authenticated backend for a short-lived, narrowly configured Realtime transcription client secret, then creates one WebRTC transcription connection per source:

- `rep`: `navigator.mediaDevices.getUserMedia({ audio: true })`;
- `lead`: the audio track returned by a user-initiated `navigator.mediaDevices.getDisplayMedia({ audio: true })` share.

Browser VAD bounds each clip and commits the Realtime buffer. Returned `item_id` values bind mixed-audio verification/direction evidence to the corresponding final transcript. The backend uses schema-validated Responses output with `store: false` for coaching and Google memory extraction. It passes only bounded recent turns, eligible personal facts, and a few reviewed generic contrasts.

No integration can bypass the browser picker or force a call platform to provide audio. Treat meeting/job context as untrusted data; it cannot override system safety or memory eligibility rules.

## Phone companion and WebSocket

The audio host and companion use the same session ID. The authenticated WebSocket server fans transcript, playbook, and coaching events to clients in that session. A companion does not acquire audio unless the owner explicitly changes it to audio-host mode.

Each connection must send one authenticated `start` within five seconds. The server rejects pre-start traffic, duplicate starts, invalid JWT claims/expiry, unexpected browser origins, and connection-limit violations; missed heartbeats terminate stale sockets. Container/proxy deployments need correct WebSocket-upgrade and origin configuration.

The phone PWA is a display/capture client, not a telephony API. It cannot directly access protected same-device cellular or VoIP media. Use a laptop call tab/system track, an in-room foreground microphone, or a second-device speakerphone with consent.

## Gmail and Drive

ChatGPT/Codex connectors may help during development but their credentials are not exportable to this runtime. The running app has an independent OAuth web flow with PKCE/state and accepts exactly:

- `https://www.googleapis.com/auth/gmail.readonly`;
- `https://www.googleapis.com/auth/drive.readonly`.

Configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and the exact `GOOGLE_REDIRECT_URI`. For Docker/proxy deployments, also set a distinct 32+ character `GOOGLE_STORAGE_ENCRYPTION_KEY`; host-managed auth creates a separate storage key when one is not supplied.

After **Connect once**, the worker:

1. catches up Gmail and Drive in bounded, resumable batches;
2. follows Gmail history and Drive change cursors on later runs;
3. extracts Gmail bodies plus Google Docs, Sheets, Slides, and supported text-file content;
4. treats PDF bodies and Gmail attachment binaries as metadata-only;
5. sanitizes subjects, filenames, headers, and bodies before cache/model use;
6. removes exact email addresses, phone numbers, street addresses, verification codes, credentials, secret-bearing lines, government IDs, account/payment-card identifiers, and related authentication material;
7. compares the authorized Gmail profile address with From/To only in memory, reduces it to non-identifying owner/correspondent/direction labels, and review-gates high-impact claims from a correspondent or unknown author;
8. escapes/delimits source attributes and text as untrusted model input, then requests structured, source-backed facts with confidence, sensitivity, temporality, and review/conflict metadata;
9. deactivates obsolete facts before accepting a changed source, removes facts for deleted sources, and retries failed extraction without leaving the old claim live;
10. limits output to eight facts per source, skips exact duplicate facts across sources, and clears full source text after successful extraction while retaining only minimized metadata and extracted fact records.

OAuth tokens, pending authorization state, cursors, and source cache are `0600` files inside per-file authenticated AES-256-GCM envelopes. Legacy plaintext files migrate atomically when successfully read with a configured key. The public status response is minimized and does not expose token/account/source content.

Automatic retrieval remains separately gated: normal facts must be review-clear, sensitive facts must be owner-verified and review-clear, and restricted facts never enter coaching prompts.

Default runtime limits are `GOOGLE_SYNC_BATCH_SIZE=10`, `GOOGLE_SYNC_MAX_PAGES=2`, `GOOGLE_MAX_EXTRACTIONS_PER_RUN=5`, `GOOGLE_DAILY_EXTRACTION_BUDGET=40`, `GOOGLE_MAX_CACHED_SOURCES=1000`, a six-hour background interval, a 15-second abortable request timeout, and bounded JSON/text response bodies. Gmail excludes Spam/Trash by default; Drive restricts its default query to supported Google/text types plus PDF metadata and excludes unsupported binaries. All are bounded configuration values. Runtime status reports metered extraction attempts and cache-capacity use so repeated manual refreshes cannot silently bypass the daily budget.

The confirmed full private-data purge aborts/drains active Google requests, removes all Google-derived memory, deletes local token/state/cache files and exact-prefix temporary siblings, and attempts provider revocation through a bounded request. A memory-scope purge automatically includes that Google disconnect/cache purge to prevent repopulation. Local removal occurs even when provider revocation fails, and background sync stays stopped until a later successful authorization. The response reports the outcome so the owner can revoke the app manually in Google Account settings if necessary.

## Hugging Face owner verification

The private speaker service enrolls a normalized owner embedding and compares bounded WAV segments by cosine similarity. Three clean dedicated owner-microphone turns are uploaded through the authenticated app server. Raw clips are discarded; the local service stores `data/private/speaker/owner_embedding.json`, while Compose stores it in the dedicated `speaker_private` volume.

The default model is `anton-l/wav2vec2-base-superb-sv` at immutable Hub revision `eb0be47779dda10620d068ab579fca970ee7e417`. Remote model code is disabled. The Python environment is resolved in `uv.lock`, and the container installs it with `uv sync --frozen --no-dev` under a non-root user.

The output is deliberately only `owner` or `unknown`. A non-match never becomes a verified remote participant by itself. Strict stereo direction may infer the remote side only after explicit two-person opt-in, owner-side calibration, repeated opposite-side evidence, and fail-closed overlap/conflict checks.

Keep the service on loopback or the internal Compose network. If it is separately published even on a private network, set `SPEAKER_SERVICE_API_TOKEN` in both the app and service environment. The app deletion endpoint calls the speaker's authenticated delete operation; if the service is down, the owner must remove the embedding when it returns.

## Reviewed coaching data

The live loader reads three original shards totaling 96 contrasts and validates them against `data/coaching/source_manifest_v1.json`. It fails the entire live load for malformed rows, duplicate IDs, mismatched licenses, or unadmitted sources. Examples influence response structure but never become owner facts.

The HelpSteer2 stager audits a pinned 9,125-pair snapshot into a distinct private quarantine schema. Five candidates survived automatic filtering; all remain marked non-live. The live loader cannot parse that schema, providing a mechanical boundary in addition to manifest review.

## Integration consent

Read-only API scope does not replace participant consent. Before capturing or processing a call, meeting, email, or Drive file, confirm that the owner is permitted to do so and that the intended AI use and retention comply with applicable law, employer/customer/interview rules, insurance requirements, confidentiality duties, and platform terms.
