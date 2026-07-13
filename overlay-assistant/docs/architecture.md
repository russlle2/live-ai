# Live Rhetoric architecture

## Runtime flow

```text
Dedicated owner microphone ─ source=rep ─┐
                                        ├─ separate Realtime transcription ─ transcript/session log
User-shared remote audio ─ source=lead ─┘                                  │
                                                                           ├─ rep: delivery comparison/style learning
                                                                           └─ lead turn ended
                                                                                  │
                                                    immediate cushion <────────────┤
                                                                                  │
            eligible personal facts + reviewed coaching examples + recent turns ─┤
                                                                                  ▼
                                                                   OpenAI Responses API
                                                                                  │
                                                           structured, speakable best line
                                                                                  │
                                                                  authenticated WS fan-out
                                                                    ├─ laptop audio host
                                                                    └─ phone companion PWA
```

At session creation, a deterministic seven-stage playbook emits the exact greeting and keeps directly speakable lines available through goodbye. Each verified owner turn is paired only with the final suggestion successfully delivered for the same remote cycle. The redacted comparison is stored privately and learned asynchronously after enough observations; later prompts receive only eligible communication-style facts.

## Speaker routing and directional evidence

Channel identity is primary:

- `rep`: dedicated local microphone; never starts a suggestion by itself;
- `lead`: separately shared remote/system-audio track; starts coaching at turn end;
- `unknown`: mixed, typed, low-confidence, or conflicting attribution; never masquerades as verified.

The owner verifier is secondary and fail-closed. Three clean dedicated-owner turns automatically create a normalized embedding. In ordinary mixed mode, only a strong owner match becomes `rep`; every weaker or non-matching result remains `unknown`. A non-match is not evidence of a remote biometric identity.

An explicit two-fixed-speaker mode can add stereo inter-channel delay, normalized correlation, and energy balance. One local VAD freezes the bounded PCM clip and commits the Realtime buffer. The API's returned `item_id` binds that evidence to the exact transcript. Direction learns an owner side from three strong owner matches and may infer `lead` only after two consecutive strong opposite-side non-owner turns. Mono/dual-mono input, center speech, silence, short input, weak correlation, overlap, unstable geometry, and voice/direction conflicts fail closed. Calibration resets on capture restart, device/orientation change, or repeated owner conflicts.

Google Meet and Zoom Web require a user-selected tab with audio. Zoom desktop is conditional on the browser/OS returning an audio track for the selected source. A phone PWA can use a foreground microphone for a room or a speakerphone on another device, but it cannot capture protected same-device cellular/VoIP streams. Platform participant adapters, if added later, would outrank acoustic inference.

## Latency and stale-work control

The system optimizes time-to-useful-text:

1. Browser VAD detects the remote turn boundary.
2. A mode-aware cushion renders immediately.
3. At the configured short delay, a deterministic mode-aware provisional answer replaces it if the model is not finished.
4. The server retrieves bounded personal and coaching context while the live model generates a short structured line with reasoning delay disabled.
5. The grounded line replaces the provisional result only if its request sequence is still current.

Before a grounded model line can replace the fallback, the server validates every cited memory ID against the retrieved set and applies deterministic output guards. It rejects private identifiers/source references, weakly grounded personal actions, titles, numbers, employers, and credentials, as well as unverified insurance claims, unauthorized service promises, negotiation bluffs, credential requests, and destructive IT commands. A rejection is logged and the deterministic line remains. These conservative syntactic/evidence checks materially reduce unsupported output; they are not formal entailment for every possible natural-language claim.

The grounded path is network/model dependent. Private-data deletion increments a runtime epoch so in-flight learning cannot repopulate a purged store.

## Personal memory eligibility

`personal_memory_v1` is an evidence bank rather than a mailbox dump. Each fact carries category, normalized text, keywords, source reference, confidence, sensitivity, temporality, validity dates, and owner-verification state.

Automatic retrieval applies this policy before ranking:

- normal facts require review/conflict flags to be clear;
- sensitive facts require both `userVerified: true` and clear review/conflict flags;
- restricted facts are never retrieved;
- not-yet-valid and expired facts are excluded.

This means a fact can remain stored for review without being prompt-eligible. The public repository contains only fabricated example data. The runtime evidence file is created with owner-only permissions under an ignored path.

The owner-only review UI fetches all facts, normalizes untrusted API data at the browser boundary, renders fact/source fields as plain text, and supports verify-as-written, correction, and deletion. Verification retains provenance while setting `userVerified` and clearing review keywords; the retrieval filter still enforces sensitivity and validity independently. Raw Google bodies and integration credentials are not returned to this surface.

## Google read-only memory pipeline

Development-time ChatGPT/Codex connectors are not runtime credentials. The independent app uses one OAuth web client, PKCE/state validation, and exactly `gmail.readonly` plus `drive.readonly`. A bounded worker performs initial catch-up and then Gmail history/Drive change-cursor synchronization.

Before source content is cached or sent to the extraction model, sanitization removes secret-bearing lines, exact email addresses, phone numbers, street addresses, verification codes, government/payment identifiers, and credentials. Gmail subjects and Drive filenames are sanitized too. The Gmail profile address and message From/To headers are compared locally for that run and reduced to non-identifying `owner`/`correspondent`/`unknown` plus direction; exact addresses do not enter cached text or model context. High-impact claims from correspondent/unknown authorship receive review flags. Gmail bodies and supported Google/text file content are used for extraction; PDF bodies and Gmail attachment binaries remain metadata-only. Changed/deleted sources deactivate their old facts before replacement. Full source text is retained only while extraction is pending and is erased after successful extraction.

OAuth tokens, pending PKCE state, sync cursors, and the minimized source cache use per-file authenticated AES-256-GCM envelopes. Fully managed host-development auth creates a distinct storage key; an environment-managed deployment must supply `GOOGLE_STORAGE_ENCRYPTION_KEY`, and the app does not reuse `JWT_SECRET`. Losing or changing the key makes existing encrypted state unreadable. Legacy plaintext Google files migrate atomically after a successful read.

The worker bounds both cost and exposure. Defaults are 10 items per batch, two pages per run, five deep extractions per run, 40 per UTC day, a 1,000-source cache, a six-hour background interval, and 15-second Google request timeouts with bounded response bodies. Usage is metered and logged at extraction attempts; output is capped at eight facts per source and exact duplicate facts across sources are skipped. Spam/Trash are excluded by the default Gmail query; Drive admits supported Google/text types and PDF metadata while excluding unsupported binaries. These are bounded environment settings rather than promises to ingest an entire account in one run. Runtime telemetry records actual token/attempt counts rather than presenting incomplete currency estimates.

## Coaching knowledge boundary

Generic knowledge is separate from personal evidence. Three reviewed JSONL shards provide 96 original weak-versus-improved contrasts, balanced at 16 per mode. The loader validates the complete corpus atomically and rejects unadmitted provenance, license mismatches, malformed rows, and duplicate IDs. Selected examples contribute structure, rationale, and guardrails—not autobiographical claims or copied scripts.

The pinned HelpSteer2 staging audit covers all 9,125 preference pairs at revision `990b2711a36180dd19d9c94b8627844866f8982a`. Five short communication pairs survived automated quarantine filters. They use a non-live schema, remain `liveRetrievalAllowed: false`, and cannot enter generation without independent review, adaptation, and manifest admission.

## OpenAI and Hugging Face boundaries

The standard OpenAI API key is backend-only. The backend mints short-lived Realtime transcription client secrets for browser WebRTC. Live coaching and memory extraction use schema-validated Responses output with `store: false`; prompts treat transcript, job/company text, and delimited/escaped Google source fields as untrusted data and prohibit invented credentials, guarantees, and uncited personal claims.

The speaker service is reached server-to-server, receives bounded WAV clips, and stores only the normalized embedding. Its default Hugging Face model is pinned to immutable revision `eb0be47779dda10620d068ab579fca970ee7e417`, remote model code is disabled, Python packages are locked in `uv.lock`, and the Docker build uses `uv sync --frozen`. Deletion advances a profile generation before waiting for inference; an enrollment that began earlier is rejected before it can save, preventing post-delete resurrection. The service is a heuristic fallback, not biometric authentication.

## Authentication, devices, and WebSocket admission

The identity is fixed to the single owner. JWTs are signed with HS256 and pinned issuer, audience, and subject claims. Protected HTTP routes require the owner token. A WebSocket must present exactly one authenticated `start` within five seconds; pre-start traffic, duplicate starts, invalid browser origins, expired JWTs, missed heartbeats, and connection-limit violations are closed.

In host development, missing explicit secrets generate owner-only auth state. The bootstrap code is exposed only when the server directly observes the peer as loopback. Docker bridge/NAT and reverse-proxy peers are not guaranteed to meet that test, so container/proxied deployments must provision `JWT_SECRET`, `PERSONAL_ACCESS_CODE`, and a distinct Google storage key explicitly. `ALLOW_INSECURE_DEMO_AUTH` is an explicit, unauthenticated loopback-demo escape hatch—not a development default.

A session has one audio host and may have companion clients. The PWA supplies a synchronized display but does not gain protected phone audio access.

## Storage and deployment boundaries

Documented relative runtime paths resolve from the `overlay-assistant` root; guarded private/control paths reject escapes from it. Git and Docker build exclusions are publication controls; they do not stop runtime reads/writes. The app Compose service bind-mounts `data/private`, while the speaker container receives only its dedicated named private/model volumes and speaker-specific environment values. The root `.env.local` is not mounted into the speaker.

Google state is application-encrypted. The populated environment file/API keys, personal memory, session/style logs, managed auth state, and owner embedding are plaintext at rest; app-created private stores use `0700` directories/`0600` files. Deployment therefore requires full-disk or volume encryption and encrypted backups. Include the speaker named volume in the protection/retention plan or re-enroll after loss.

The main Compose file keeps PostgreSQL and the speaker service internal and publishes the app to `127.0.0.1:8080` by default. The development override exposes database and speaker ports on host loopback only. LAN/phone access requires an authenticated HTTPS proxy/private tunnel and correct origin configuration. Set a broader app bind only when that perimeter is already in place.

The public health route exposes only `ok` and overall status. Detailed health metrics and AI-model status are owner-authenticated, non-cacheable diagnostics. Local/internal PostgreSQL explicitly disables TLS, including ambient `PGSSLMODE` influence. When remote database TLS is enabled, the client requires CA validation, TLS 1.2 or newer, and DNS-hostname identity verification; connection-string TLS overrides and IP-hostname substitutions fail at startup.

## Deletion lifecycle

The authenticated full-purge endpoint requires the literal `ERASE MY PRIVATE DATA`. It closes active sockets/sessions, drains or invalidates pending private writes, clears personal memory and transcript/style logs, removes Google-derived facts and encrypted Google files, attempts provider revocation, deletes speaker enrollment, purges runtime database metadata, and drops pending telemetry. A memory-scope purge includes Google disconnect/cache cleanup so background sync cannot repopulate the cleared evidence bank. Managed auth credentials and the managed storage-encryption key rotate and invalidate old JWTs; environment-managed secrets cannot be rotated and return a warning. Memory, Google, speaker, and managed-auth cleanup also removes exact matching crash-left atomic-write siblings without sweeping unrelated files.

The result is evidence, not an assumption: an unavailable database/speaker service, failed provider revocation, external backups, stdout, proxy logs, container logs, and browser-local/session text in other paired browsers require separate handling. Rotated JWTs block those browsers from server access but cannot erase their storage remotely.

## Consent boundary

The product does not determine whether capture or AI assistance is lawful or permitted. The owner must obtain participant consent, comply with applicable recording/transcription laws, employer/customer/interview rules, insurance obligations, platform terms, and retention limits, and stop capture when authorization ends.

## Legacy database role

PostgreSQL supports session metadata and analytics while portable personal memory remains in the private JSON store. The coaching path degrades to local cushions when optional analytics storage is unavailable. In the main Compose stack, the app requires healthy PostgreSQL at startup.

## Technical references

- [OpenAI Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription)
- [OpenAI current model guidance](https://developers.openai.com/api/docs/guides/latest-model)
- [Chrome screen-sharing controls](https://developer.chrome.com/docs/web-platform/screen-sharing-controls/)
- [W3C Screen Capture specification](https://w3c.github.io/mediacapture-screen-share/)
- [Android playback capture](https://developer.android.com/media/platform/av-capture)
- [Android audio-input sharing](https://developer.android.com/media/platform/sharing-audio-input)
- [Zoom Realtime Media Streams](https://developers.zoom.us/docs/rtms/meetings/)
- [Google Meet Media API](https://developers.google.com/workspace/meet/media-api/guides/overview)
- [NVIDIA HelpSteer2 dataset card](https://huggingface.co/datasets/nvidia/HelpSteer2)
- [Pinned owner-speaker model](https://huggingface.co/anton-l/wav2vec2-base-superb-sv/tree/eb0be47779dda10620d068ab579fca970ee7e417)
