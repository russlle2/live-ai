# Implementation checkpoint

Last refreshed: 2026-07-20 (UTC)

This is the durable, non-sensitive handoff for the private personal rhetoric aide. It records implemented behavior, verification state, and external limits so progress does not depend on conversation history. Never add keys, access codes, OAuth material, personal-memory facts, transcripts, voice embeddings, or raw audio here.

## Final product direction

- Private, single-owner aide for interviews, insurance sales, IT support, inbound service, negotiation, and general high-stakes conversations.
- Directly speakable guidance from an exact greeting through a final goodbye.
- Laptop audio host plus installable phone companion display.
- Automatic use of private memory, transcripts, Google-derived evidence, coaching knowledge, and learned speaking style without per-turn manual insertion.
- Truthful rhetoric support, not autonomous impersonation, résumé fabrication, covert monitoring, or unapproved regulated advice.

## Implemented live conversation path

- Separate owner-microphone and user-shared remote/system-audio capture with AudioWorklet/audio-time VAD; local faster-whisper is preferred and cloud Realtime transcription remains optional.
- Canonical versioned runtime events retain concurrent source turns. A verified remote start during active owner speech emits an interruption immediately; mixed unknown overlap cannot invent identity.
- Source identity remains primary routing: owner speech does not trigger a reply; verified remote speech does.
- Immediate cushion, turn-specific deterministic provisional line, then a schema-validated local-first/cloud best line. New speech, mute, dismissal, stop, deadline, or purge aborts obsolete inference; deadline expiry promotes the safe deterministic line to final.
- Before display, deterministic validation rejects unknown memory IDs, private identifiers/source references, weakly grounded personal/action/title/numeric/employer/credential claims, unverified insurance claims, unauthorized service promises, negotiation bluffs, credential requests, and destructive IT commands; a rejected line retains the safe fallback. These checks are deliberately conservative, not formal natural-language entailment.
- Seven-stage exact playbooks for all six modes: greeting, rapport, discovery, proof, questions, close, and goodbye.
- Authenticated WebSocket fan-out allows one audio host plus multiple companions, rejects a second host, bounds buffered output, and closes every socket when the session stops.
- Five-second authenticated start deadline, fixed owner claims, origin checks, per-IP/global limits, heartbeat termination, JWT-expiry closure, request/header timeouts, and slow-consumer disconnection.
- Mobile-first installable PWA, manual remote-speaker confirmation for ambiguous turns, and native browser always-on-top guidance through Document Picture-in-Picture.

## Implemented speaker identity

- Three mutually consistent dedicated owner-microphone segments automatically enroll a normalized owner embedding; conflicting samples are rejected without changing the profile and raw clips are discarded.
- Speaker-profile generation invalidation prevents an enrollment already in inference from saving after owner deletion.
- Pinned Hugging Face XVector model at revision `eb0be47779dda10620d068ab579fca970ee7e417`, remote code disabled, locked Python dependencies, non-root container.
- Owner verifier returns only `owner` or `unknown`; a non-match never establishes the other person's identity.
- Optional explicit two-fixed-speaker direction uses true stereo timing/correlation/energy evidence.
- Realtime `item_id` binds VAD-frozen direction/voice evidence to the exact transcript.
- Three strong owner-side observations calibrate the side and two stable opposite-side observations are required before remote inference.
- Mono/dual-mono, silence, short samples, center speech, overlap, movement, weak/conflicting cues, stale IDs, and unavailable verification remain `unknown`.
- Calibration resets on capture restart/device-orientation change and repeated verified-owner conflicts.

## Implemented memory and style learning

- Encrypted `personal_memory_v1` stores source, confidence, temporality, validity, sensitivity, owner verification, and review/conflict metadata; legacy plaintext migrates automatically.
- Local personal retrieval may use review-gated normal/sensitive context with explicit qualification and score penalties, but output validation blocks review-gated biography. Cloud retrieval remains review-clear/verified. Restricted facts are never retrieved.
- Every bounded transcript interval can produce source-backed career/story candidates asynchronously. Conversation-derived employment, education, skill, achievement, project, and story claims are always review-gated before live retrieval; unsupported elevated actions/titles are rejected and weak overlaps stay quarantined.
- Delivered final suggestions have stable IDs and explicit accepted/ignored feedback. Encrypted comparisons classify the next verified owner turn as exact, paraphrased, or changed.
- Automatic style learning stores no phrase text: promotion requires 12 eligible observations across three sessions, rejects contradictory/session-dominated evidence, moves features slowly, supports rollback, and excludes accepted model wording/factual corrections.
- Transcript turns are independently encrypted, retained indefinitely by default, and available through source-linked local archive search.
- Documented relative paths resolve from the overlay root; guarded private/control paths reject relative escapes.
- Individual memory-fact deletion and full memory/session-log clearing are implemented.
- Owner-only memory review supports verification as written, correction, and deletion; it states that normal review-clear facts may already be eligible and restricted facts remain excluded after verification.

## Implemented local inference

- Loopback-only coaching provider selection prefers configured Ollama/llama.cpp and uses OpenAI-compatible chat structured output; cloud Responses remains the fallback when local is absent.
- Bundled `services/stt` exposes locked, OpenAI-compatible faster-whisper model and transcription endpoints. WAV turns are bounded, validated, temporary-only, and deleted in `finally`.
- The browser chooses healthy local STT automatically, processes each separated source independently, preserves order, and falls back to cloud transcription only when configured.
- `scripts/setup-local-ai.ps1` installs `uv` and Ollama via WinGet, downloads the chosen coach model, installs the locked STT service, updates `.env.local`, and starts both loopback services.
- Local model routes are constrained to loopback URLs; deterministic coaching remains available if both model providers are unavailable.

## Implemented Google pipeline

- Independent one-time OAuth web flow with PKCE/state and exact Gmail read-only + Drive read-only scope validation.
- Bounded Gmail/Drive bootstrap and resumable history/change-cursor synchronization.
- Gmail bodies plus Docs/Sheets/Slides/supported text extraction; PDFs and Gmail attachment binaries are metadata-only.
- Subjects/filenames and source content are sanitized before cache/model use. Exact email, phone, street address, verification code, credential, secret-bearing, government, account, and payment-card data is removed.
- Gmail profile/From/To addresses are reduced locally to non-identifying authorship/direction labels and are neither cached nor sent to the model. Correspondent/unknown high-impact claims receive review flags.
- Untrusted Google source attributes and text are escaped and delimited before model extraction.
- OAuth material, pending state, cursors, and source cache use authenticated AES-256-GCM envelopes and owner-only files. Legacy plaintext state migrates atomically on successful read.
- Source bodies are cleared after successful extraction and unchanged sync does not restore them.
- Changed/deleted source facts are deactivated before replacement so failed extraction cannot leave obsolete claims live.
- Status responses are minimized. Full purge removes Google-derived facts and local Google files and attempts provider revocation.
- Google network responses and time are bounded; default sync/extraction/cache budgets are 10 items, two pages, five metered attempts/run, 40/day, 1,000 sources, and a six-hour interval. Extraction attempts are usage-logged; output admits at most eight facts/source and skips exact cross-source duplicates. Purge aborts/drains Google work, includes Google cleanup for memory-scope deletion, and leaves background sync stopped until reauthorization.

## Implemented knowledge corpus

- 96 live, original weak-versus-improved contrasts: 36 seed + 30 customer + 30 growth, balanced at 16 per mode.
- Atomic validation against a deny-by-default provenance/license manifest; malformed, duplicate, or unadmitted data fails the live corpus.
- Retrieval is separate from personal memory and style blending occurs only during generation.
- Reproducible HelpSteer2 audit of 9,125 pairs at pinned revision `990b2711a36180dd19d9c94b8627844866f8982a`.
- Five automatically filtered HelpSteer2 candidates remain in a mechanically incompatible, non-live quarantine schema with `liveRetrievalAllowed: false`.
- TED/coaching/motivational transcripts are not bulk-copied; general rhetoric principles are represented through newly authored examples to avoid privacy, copyright, and provenance problems.

## Implemented security, storage, and deletion

- Strong host-development auth auto-bootstrap when explicit secrets are absent; state is `0600` under a `0700` private directory.
- Bootstrap code is cache-disabled and returned only when the server directly observes a loopback peer. Docker/proxy deployments require explicit JWT/access-code/storage-key provisioning.
- `ALLOW_INSECURE_DEMO_AUTH` is the only no-auth path and is never enabled implicitly.
- Google storage uses a distinct managed key or explicit `GOOGLE_STORAGE_ENCRYPTION_KEY`.
- Personal memory, transcript turns, and suggestion/style comparison records use authenticated encryption with explicit `PRIVATE_STORAGE_ENCRYPTION_KEY` support and managed-key rotation.
- Full private-data purge requires the literal `ERASE MY PRIVATE DATA`, closes sessions, drains or cancels stale persistence, clears memory/transcript/style/Google/voice/database stores, discards pending telemetry, attempts Google revocation, and rotates managed auth plus the managed storage key.
- Memory, Google, speaker, and managed-auth cleanup removes exact-prefix crash-left temporary siblings without sweeping unrelated files.
- Purge returns warnings for unavailable external stores or environment-managed secrets. Other browsers' local/session profile and access text, external logs, and backups remain separate retention systems; rotated JWTs only block server access.
- Main Compose keeps PostgreSQL/speaker internal and binds the app to host loopback by default; a development override exposes private services only on loopback.
- Speaker Compose receives scoped variables and dedicated named volumes rather than the root env file/private tree.
- Production app image contains the reviewed coaching corpus but excludes private data.
- Numeric runtime limits are strictly parsed and bounded; malformed, fractional, exponent, hexadecimal, infinite, or out-of-range values fail startup instead of disabling safeguards. `DB_SSL` is also parsed as a strict boolean.
- `/health` is public-minimal. Detailed health/AI diagnostics are owner-authenticated and non-cacheable.
- Browser access requires one exact `WEB_ORIGIN`; wildcard CORS/WebSocket admission is rejected, and non-loopback origins require HTTPS.
- Remote PostgreSQL TLS requires CA verification, TLS 1.2+, and a DNS hostname whose identity matches the certificate; URL-level TLS overrides are rejected. Local/internal database mode passes explicit TLS-off configuration.
- Runtime usage records token and extraction counts; safe numeric token metrics remain observable while credential-bearing token fields are redacted. PostgreSQL observability uses one parameterized batch query per flush and matching opaque tenant IDs for writes/trust reads.

## Storage truth

Git and Docker exclusions prevent publication; they do not disable automatic runtime use and do not provide encryption. Google state, personal memory, transcript turns, and suggestion/style comparisons are application-encrypted. Populated environment files/API keys, managed auth state, PostgreSQL data, numeric style-feature logs, and speaker embeddings still rely on restrictive permissions and host disk protection. Every real deployment needs full-disk or encrypted-volume protection and encrypted owner-controlled backups, including the `speaker_private` volume when retained.

## Platform and consent truth

- Meet/Zoom Web requires an owner-selected share source with audio; Zoom desktop is conditional on browser/OS support.
- A phone foreground microphone supports a room or speakerphone on another device. A PWA cannot capture protected same-device cellular/VoIP streams and may lose capture when backgrounded.
- Mixed acoustic attribution is probabilistic and must fail closed.
- The owner must obtain participant consent and follow applicable recording/transcription law, employer/customer/interview/insurance rules, confidentiality duties, retention requirements, and platform terms.

## Current-tree validation

- TypeScript tests: runtime 30/30, shared 20/20, server 190/190, and web 65/65 (305/305 total).
- All four TypeScript typechecks and all production builds passed; the web build emitted 65 modules.
- Runtime smoke passed with the required 96-example corpus: public-minimal health, protected diagnostics, JWT WebSocket admission, stable guidance ID/feedback, interruption fan-out, second-audio-host rejection, ready/greeting delivery, and pre-start denial were verified. The optional database correctly reported degraded in this workspace.
- Speaker service: 11/11 standard-library unittests plus Python compilation passed, including deletion concurrency and inconsistent-enrollment rejection.
- Local STT service: 6/6 API/backend/service tests plus Python compilation and frozen `uv` lock verification passed without downloading model weights.
- Production pnpm dependency audit reported no known vulnerabilities.
- A one-minute manual browser walkthrough verified the archive privacy modal, synchronized always-on-top guidance, Other/owner manual turns, stable “I used this” feedback, and source-linked encrypted archive search without visible failures.

The verified automated total is 322/322 tests: 305 TypeScript and 17 Python.

## Unverified or external limits

- Docker image build/runtime was not executed because Docker is unavailable in this workspace.
- No paid live OpenAI API request was made.
- No real Google OAuth consent/catch-up/revocation run was performed.
- No real Hugging Face speaker/faster-whisper weight download, CUDA inference, Ollama model run, or target-RTX latency benchmark was performed; unit tests use fakes.
- No physical phone, stereo microphone, Zoom, Meet, speakerphone, or cross-device HTTPS session was exercised.
- The Windows PowerShell setup and Document Picture-in-Picture flow were code/browser validated in Linux Chromium, not executed on the owner's Windows 11 machine.
- A dedicated Android native foreground service, Tauri/WASAPI process loopback, Zoom RTMS, Twilio Media Streams, and eligible Meet Media adapter remain future migration increments; the implemented path is the PWA/browser capture plus local-loopback providers.
- Disk/volume encryption, reverse-proxy hardening, firewall rules, consent, and employer/carrier policies are deployment responsibilities and were not verifiable here.
- Container base images remain tag-pinned rather than digest-pinned.
- The purge cannot retroactively erase stdout, container/proxy logs, or external backups.

## Release finish sequence

1. Complete final diff/private-data/credential scans and review the release diff.
2. On an encrypted owner-controlled machine, build and exercise the Docker stack with explicit deployment auth/storage keys.
3. Complete real Google, OpenAI, speaker-model, phone, browser-share, Zoom/Meet, and stereo acceptance tests using consented non-sensitive fixtures first.
4. Review purge warnings and external log/backup retention behavior.
5. Publish only after the diff is reviewed and an authenticated GitHub path is available.
