# Local-First Live Rhetoric v2 Design

## Status

Approved by the owner on 2026-07-20. This document is the authoritative design for the next architecture. It replaces the historical SaaS assumptions under `docs/context_pack`, `docs/roadmap`, and `docs/selling`.

## Product definition

Live Rhetoric is a private, single-owner, real-time conversational copilot. It helps the owner decide what to say next during high-stakes conversations while preserving the owner's agency. General high-stakes conversations are the primary domain; job interviewing receives additional domain-specific support.

The product:

- captures consented conversation audio from Windows, Android, browser meetings, Bluetooth devices, and supported platform APIs;
- maintains separate and overlapping speaker timelines when source evidence permits;
- produces short, directly speakable guidance during the conversation;
- runs transcription and coaching locally by default on a Windows 11 workstation with an RTX 5090-class GPU;
- allows per-session opt-in to cloud transcription or reasoning;
- retains encrypted local transcripts indefinitely as a searchable personal archive;
- learns the owner's communication style slowly from repeated behavior without copying isolated phrases;
- uses broad, owner-controlled memory while keeping authentication, encryption, secret handling, provenance, and destructive-action controls strict;
- never speaks or impersonates the owner and does not synthesize the owner's voice or appearance.

## Owner-approved constraints

- Deployment is hybrid and local-first.
- Windows 11 is the primary desktop target.
- Android is the primary mobile target.
- Android capture streams to the laptop by default and uses on-device transcription as a fallback.
- A two-device speakerphone workflow is acceptable for ordinary cellular calls.
- Audio processing is configurable per session, with local processing as the default.
- Guidance reasoning must work fully offline; cloud models are optional refiners or fallbacks.
- No robot voice or injected participant notice is added. The app retains a private owner-facing capture indicator.
- Raw audio is never retained.
- Encrypted transcripts are retained locally indefinitely by default.
- Normal operation unlocks automatically under the signed-in Windows account. Windows Hello or a PIN is optional for sensitive archive views.
- Memory is permissive and versatile. Security controls remain strict and mostly invisible.
- Guidance latency targets are:
  - context-aware bridge under 100 ms;
  - useful provisional guidance under 400 ms;
  - grounded personalized guidance under 1.5 seconds p95 after end of turn.
- Slow style adaptation requires at least 12 consistent observations across at least 3 sessions. Exact phrases are never adopted unless explicitly pinned.

## Platform truth

The architecture must not promise capture paths that operating systems prohibit:

- An ordinary Android app cannot capture protected same-device cellular or VoIP playback. Android playback capture excludes voice-communication usage.
- An ordinary iOS app cannot access protected phone-call audio through public recording APIs.
- Putting a call on speaker does not make same-device call audio available to another app on that phone.
- Reliable ordinary phone capture therefore uses a second device microphone or routes the call through an integrated telephony provider.
- Browser `getDisplayMedia()` audio varies by browser, operating system, and selected surface.
- Zoom RTMS can provide participant-separated media for authorized Zoom sessions.
- Google Meet Media API remains subject to its preview, enrollment, and conference eligibility restrictions.

When a source cannot provide authoritative identity, the app reports uncertainty rather than silently inventing a speaker label.

## Current repository assessment

### Inventory

The repository contains 202 tracked paths:

- React/Vite PWA in `apps/web`;
- Express/WebSocket/OpenAI runtime in `apps/server`;
- shared TypeScript protocols and playbooks in `packages/shared`;
- Python/FastAPI Hugging Face speaker verifier in `services/speaker`;
- reviewed coaching data in `data/coaching`;
- PostgreSQL migrations and runtime metadata;
- Docker/Compose packaging;
- active operations/product documents and a large archived SaaS context pack.

The validated baseline on 2026-07-20 is:

- 188 TypeScript tests passing;
- 10 Python tests passing;
- all TypeScript typechecks passing;
- server and web production builds passing;
- HTTP/WebSocket runtime smoke passing;
- production dependency audit reporting no known vulnerabilities.

### Existing strengths to preserve

- Source-separated microphone and shared-tab capture.
- Short-lived OpenAI Realtime client secrets and backend-only standard API key.
- Fail-closed owner-or-unknown voice verification.
- Typed WebSocket and overlay protocol definitions.
- Immediate cushion, provisional response, and stale-result display guard.
- Evidence-backed personal memory with provenance and sensitivity labels.
- Read-only Google OAuth with encrypted token/cache state.
- Deterministic output checks for several high-impact claim classes.
- Explicit private-data purge with in-flight persistence barriers.
- Reviewed coaching corpus with deny-by-default provenance admission.
- Good unit coverage around privacy-sensitive transformations.

### Structural weaknesses to replace

#### Audio and source handling

- `useSeparatedRealtimeTranscription.ts` owns capture, WebRTC setup, VAD, PCM recording, speaker classification, enrollment, and lifecycle in one browser hook.
- `ScriptProcessorNode` is deprecated and performs audio work on the UI thread.
- Turn detection depends on `requestAnimationFrame`, which is throttled when a page is backgrounded.
- The claimed transcription-delta fallback cannot reliably commit a manually segmented buffer when transcription itself depends on a commit.
- Capture has no unified clock, jitter buffer, backpressure protocol, or source-adapter contract.
- Mixed-speaker classification can continue after its 900 ms display timeout and mutate calibration out of sequence.
- Audio and model requests lack consistent cancellation and deadlines.
- Stereo direction is too environment-sensitive to be a primary identity signal.
- There is no native Windows per-process loopback, Android foreground capture service, Zoom RTMS, Meet Media, or Twilio adapter.

#### Conversation orchestration

- `apps/server/src/index.ts` is a process-global 2,000-line runtime containing routes, sessions, WebSockets, learning, deletion, integrations, and shutdown.
- Transcript HTTP requests can execute concurrently against mutable session objects.
- New model work is hidden when stale but not aborted, so obsolete turns still consume resources.
- Slow WebSocket consumers have no buffered-amount backpressure.
- Multiple audio hosts can join one session despite the documented single-host model.
- A stop from one socket does not consistently terminate every socket for the session.
- Sessions remain alive after all clients disconnect until timeout.

#### Guidance quality

- Deterministic arbitration computes intent/template items but the live coaching path does not use those items.
- Arbitration caching omits speaker and domain keywords from its key.
- The deterministic fallback is mostly a seven-stage generic script rather than a response to the actual turn.
- A provisional result can remain forever without being promoted to a final delivery event.
- The output validator is useful but regex-based and incomplete.
- Long few-shot examples increase prompt size and can introduce fictional first-person language.
- There is no explicit conversation-state graph, interruption event, open-loop tracker, commitment tracker, or strategy-ranking layer.

#### Learning and memory

- Personal memory and transcripts are plaintext JSON/JSONL.
- Retrieval reparses and linearly scans the complete JSON file on each coaching turn.
- There is no full-text archive, semantic search, evidence graph, multi-source provenance, or personal Q&A surface.
- Automatic style learning pairs the next owner turn with a suggestion even when the owner ignored it.
- Isolated wording can influence style too quickly, and the current model can learn from its own suggestions.
- Google exact-text deduplication loses secondary provenance and can remove a fact when one source disappears even if another source supports it.
- Google cache tombstones consume capacity indefinitely.
- Documentation claims PDF metadata import, but the default Drive allowlist excludes PDF.

#### Security and observability

- Strong security controls coexist with plaintext long-term personal stores.
- UI verification sends a complete fact object back to the server instead of a narrow correction command.
- Request IDs are reflected without a strict length/character schema.
- The CSP permits broad `ws:` and `wss:` destinations.
- Telemetry is synchronously written to stdout and cannot be retroactively erased.
- The telemetry “batch” performs multiple concurrent single-row inserts.
- Stored tenant identifiers are opaque hashes, while one trust query uses the raw tenant ID.
- In-memory rate-limit arrays use repeated `shift()` and can grow from invalid pre-validation requests.
- There is no signed model manifest, model rollback, local tracing timeline, or privacy-preserving diagnostic bundle.

#### Product surface

- The current PWA is a full web page, not an always-on-top overlay.
- It lacks Document Picture-in-Picture and a native desktop overlay.
- The UI monolith mixes authentication, capture, session state, memory review, Google sync, and rendering.
- “I used this” telemetry is not connected to style attribution.
- Mute and dismiss actions do not consistently update server state or telemetry.
- “Up to date” is shown after a deliberately bounded Google sync run.
- Reconnect uses a fixed delay and cannot refresh an expired cached token.

#### Repository and dependency shape

- Generated `packages/shared/dist` files are committed while other builds are ignored, creating stale-artifact risk.
- The active TypeScript stack is several major versions behind current releases: React 18, Express 4, Vite 5, Vitest 2, and Zod 3.
- The OpenAI SDK, PostgreSQL client, WebSocket client, and development tools have newer compatible releases available.
- The Python lock is reproducible, but image tags are not digest-pinned.
- The current Wav2Vec2 SUPERB speaker model has sparse evaluation metadata and a fixed global threshold. It is not calibrated for the owner's devices or speakerphone conditions.
- CRM stubs, multi-tenant credential code, and archived SaaS tables are disconnected from the personal product.

## Target topology

### Windows desktop authority

A Tauri desktop application is the authoritative runtime.

The Rust core owns:

- WASAPI microphone, system-loopback, and per-process-loopback capture;
- device enumeration and Bluetooth endpoint selection;
- source clocks and timestamp normalization;
- secure key access through Windows DPAPI;
- encrypted database lifecycle;
- worker supervision and health;
- local IPC and authenticated LAN pairing;
- signed model manifests and update rollback;
- native always-on-top overlay windows;
- resource budgets and graceful shutdown.

The React renderer owns presentation only:

- onboarding and session brief;
- compact overlay and teleprompter views;
- transcript/archive browser;
- memory and style review;
- diagnostics and privacy controls;
- accessibility and keyboard controls.

The renderer does not hold database keys, standard cloud API keys, or unrestricted filesystem access.

### Local inference workers

Workers are independent, restartable processes behind versioned contracts:

- audio-quality/VAD/overlap worker;
- streaming STT worker;
- speaker embedding and diarization worker;
- local embedding/retrieval worker;
- local coaching LLM worker;
- background extraction/summarization/evaluation worker.

Worker implementations may use ONNX Runtime, CUDA/TensorRT, llama.cpp-compatible runtimes, or Python during migration. Selection is benchmark-driven. No provider type leaks into core session logic.

### Android client

The Android application uses:

- Kotlin and Jetpack Compose;
- a visible foreground microphone service;
- WebRTC or QUIC/Opus LAN transport;
- local VAD and bounded jitter buffering;
- certificate-based pairing after one QR/code exchange;
- companion overlay and manual speaker correction;
- compact on-device STT fallback;
- Android Keystore for device credentials.

The Android client does not claim access to protected same-device call media.

### Optional cloud adapter gateway

A stateless container service supports:

- Zoom RTMS media and participant events;
- Twilio Media Streams inbound/outbound tracks;
- Google Meet Media API when eligible;
- optional cloud STT and cloud LLM providers;
- remote session signaling when LAN connectivity is unavailable.

It stores no canonical transcript or personal memory. Media buffers are bounded and ephemeral. Long-lived WebSocket/media workloads do not run in short-lived serverless functions.

## Canonical event protocol

All sources publish a provider-neutral event envelope:

```text
eventId
protocolVersion
sessionId
sourceId
sourceKind
sequence
capturedAtMonotonic
capturedAtWallClock
receivedAt
payloadType
payload
provenance
confidence
privacyClass
```

Core event families:

- source connected/disconnected/changed;
- audio frame and quality signal;
- speech started/stable/ended;
- partial transcript revision;
- committed transcript turn;
- speaker changed;
- overlap started/ended;
- interruption detected;
- session state updated;
- strategy candidate ranked;
- guidance provisional/final/superseded;
- feedback accepted/changed/ignored/pinned;
- memory candidate/verified/conflicted/deleted;
- worker health/degraded/recovered.

Every consumer is idempotent by `eventId` and sequence-aware. Audio frames use bounded queues and explicit drop metrics. State projections can be rebuilt from retained non-audio events.

## Capture architecture

### Windows source adapters

- `wasapi-mic`: selected physical microphone.
- `wasapi-loopback`: selected system output.
- `wasapi-process-loopback`: audio emitted by a selected process where Windows permits it.
- `chromium-tab`: browser extension and native messaging for authoritative tab identity and tab audio.
- `bluetooth-input`: selected Bluetooth microphone endpoint.
- `manual-text`: typed or pasted turn.

For Meet/Zoom Web, microphone and tab audio remain separate. For Zoom desktop and compatible applications, microphone and per-process output remain separate. System-loopback fallback is explicitly labeled as mixed when other applications can contribute audio.

### Phone workflows

Reliable ordinary cellular-call workflow:

1. call remains on the phone and is placed on speaker;
2. laptop or second Android device captures the room microphone;
3. streaming diarization and owner verification attempt attribution;
4. overlap or uncertainty remains `unknown`;
5. one-tap “coach this remote turn” provides explicit correction.

The architecture also supports Twilio/VoIP calls with separated inbound/outbound tracks when the owner intentionally routes calls through that provider.

### Endpointing and overlap

Audio processing uses an off-main-thread/native pipeline:

- 10–20 ms timestamped frames;
- adaptive noise floor;
- speech probability rather than one fixed RMS threshold;
- pre-roll and hangover;
- server/local secondary endpoint confirmation;
- maximum turn duration and forced checkpoint;
- overlap detection;
- independent VAD per separated source;
- streaming diarization on mixed sources;
- partial transcript stability tracking.

When the remote source begins while the owner is speaking:

- emit `interruption.detected`;
- preserve both concurrent turns;
- suspend guidance intended for the owner's interrupted turn;
- begin remote intent/state processing from stable partial text;
- abort guidance that is no longer valid.

Separated channels can identify this switch reliably. A mixed microphone cannot guarantee identity during overlap and must expose `unknown`.

## Transcription routing

Per-session policy selects:

- local GPU streaming STT;
- Android on-device fallback;
- owner-approved cloud STT;
- platform-provided transcript when its timing and identity are sufficient.

The router can shadow a second provider with consented, ephemeral audio during explicit evaluation sessions. Shadow output never reaches live guidance and is used only to compare latency and transcription accuracy.

STT output includes:

- revision ID;
- stable and unstable text spans;
- word timestamps when available;
- language;
- source and speaker evidence;
- confidence and quality flags;
- finalization reason.

Domain vocabulary and owner-approved names are supplied as hints without silently rewriting transcript evidence.

## Conversation intelligence

### Stateful conversation graph

The session projection tracks:

- participants and source evidence;
- concurrent and interrupted turns;
- owner goal;
- current topic and conversational move;
- questions asked and answered;
- claims and their evidence status;
- objections, constraints, and interests;
- commitments, owners, conditions, and dates;
- unresolved loops;
- conversation stage;
- risk and uncertainty flags.

State updates are deterministic where possible and model-assisted through schema-validated extraction where needed.

### Deadline-driven guidance pipeline

1. A fast local strategy classifier runs on stable partials.
2. Candidate strategies are ranked by expected usefulness, evidence, risk, latency, and repetition.
3. Personal evidence, prior transcript episodes, pinned facts, and compact coaching strategies are retrieved in parallel.
4. A bridge is selected from state, not from a global generic rotation.
5. A small local model or deterministic composer produces provisional wording.
6. The main local LLM produces a grounded final response.
7. Optional cloud refinement runs only when enabled and only while the result remains timely.
8. A deterministic verifier checks the structured result.
9. The result is emitted with a turn ID and expiration deadline.

Any newer event that invalidates assumptions aborts the in-flight operation through a cancellation token propagated to every worker.

### Guidance contract

```text
guidanceId
sessionId
basedOnTurnIds
strategy
say
backup
alternatives
confidence
evidenceRefs
riskFlags
createdAt
validUntil
generationTier
modelManifestId
```

Default rendering shows one short line. Alternatives are progressive disclosure:

- safer;
- shorter;
- warmer;
- more direct;
- ask instead of answer.

Low confidence favors a clarifying question. Guidance that arrives after `validUntil` is recorded as superseded and never displayed.

## Safety and policy

### Personal policy profile

Personal mode favors warnings over suppression:

- normal and sensitive local memory may be retrieved automatically;
- review flags qualify confidence rather than always blocking retrieval;
- broad adult conversational content is allowed;
- owner-defined domain packs and vocabulary are allowed;
- local-only context can be more permissive than context sent to a cloud provider.

### Non-configurable security invariants

- Never expose credentials, tokens, private keys, one-time codes, payment credentials, or government identifiers.
- Never let untrusted transcript/document content choose tools, policies, or storage destinations.
- Never claim a personal fact without an evidence reference or explicit session assertion.
- Never represent an action as completed without a verified tool result.
- Never silently turn uncertain mixed audio into a remote speaker.
- Never execute or recommend an irreversible destructive action without explicit confirmation and an approved procedure.
- Never synthesize or impersonate the owner's voice or likeness.

Untrusted documents are processed by a quarantined extraction worker with no tools or private destinations. It can emit only schema-validated candidates. Core policy code—not an LLM—decides storage, retrieval, and external actions.

## Encrypted personal archive

### Storage

The canonical local store is encrypted SQLite/SQLCipher. A random 256-bit database key is wrapped with Windows DPAPI and bound to the owner's Windows account. Windows Hello can protect sensitive archive views without making normal live use cumbersome.

Android device credentials and fallback data use Android Keystore-backed keys.

Raw audio has no storage API and is represented only by ephemeral bounded buffers.

### Projections

- sessions;
- sources;
- transcript turns and revisions;
- interruption/overlap events;
- summaries and topics;
- commitments and open loops;
- evidence items and provenance edges;
- conflicts and corrections;
- style observations and profiles;
- guidance and owner feedback;
- evaluation runs and model manifests;
- connector cursors;
- privacy/deletion ledger.

Full-text search uses FTS. Semantic search uses local embeddings stored in the encrypted database or an equally encrypted sidecar.

### Personal knowledge features

- full-text and semantic transcript search;
- chronological timeline;
- “what did we decide?” and “when was this discussed?” local Q&A;
- source-linked answers;
- pinned facts and episodes;
- correction and conflict resolution;
- per-session/source/fact deletion;
- encrypted export and backup;
- complete purge and cryptographic key rotation.

Indefinite retention remains the default, with visible size statistics and optional owner-defined cleanup rules.

## Slow style adaptation

Style adaptation does not fine-tune model weights during live use.

Each owner turn can produce bounded features:

- response length;
- sentence length;
- directness;
- warmth and acknowledgment rate;
- question/statement ratio;
- vocabulary complexity;
- contraction usage;
- hedging strength;
- structure preference;
- cadence and pause features when derived ephemerally from audio;
- semantic difference from guidance;
- whether the owner accepted, changed, ignored, or pinned the suggestion.

Candidate changes require:

- at least 12 supporting observations;
- at least 3 distinct sessions;
- no dominant contribution from one repeated script;
- no secret or factual-content leakage;
- no unresolved contradictory pattern;
- bounded profile movement per promotion;
- offline evaluation against recent held-out turns.

Profile versions are reversible. Exact phrases are not learned automatically. Owner factual corrections update evidence, not style. Aggregate style promotion occurs between sessions.

## Reliability

The local supervisor provides:

- worker startup ordering;
- readiness and liveness checks;
- deadline propagation;
- bounded retry only for idempotent operations;
- circuit breakers;
- per-worker resource limits;
- GPU memory admission control;
- crash restart with exponential backoff;
- signed model rollback;
- graceful session checkpoint and shutdown.

Degradation order:

1. preferred local providers;
2. alternate local providers;
3. Android fallback;
4. explicitly enabled cloud providers;
5. deterministic strategy composer;
6. transcript/manual mode.

Capture and UI remain usable when background learning, archive indexing, cloud adapters, or telemetry fail.

## Observability

Local metrics include:

- audio frame loss and jitter;
- endpointing delay;
- partial stability and finalization latency;
- STT provider latency and correction rate;
- speaker-confidence and unknown/overlap rates;
- bridge/provisional/final latency;
- cancellation and stale-result rates;
- retrieval latency and evidence coverage;
- guidance acceptance/change/ignore rates;
- style-promotion evidence;
- worker crashes and fallback transitions;
- CPU, RAM, GPU memory, and thermal pressure.

Logs contain IDs, enums, hashes, counts, and bounded error classes—not transcript text. A local trace viewer can correlate source → turn → strategy → guidance without exposing content in ordinary logs. Crash reporting is opt-in.

## Packaging and updates

- Signed Windows installer.
- Native Tauri updater with signature verification and automatic rollback.
- Model manager with signed/checksummed manifests, resumable downloads, disk checks, and hardware-specific selection.
- Signed Android application.
- Containerized optional adapter gateway.
- Encrypted backup/export with recovery guidance.

No base image, model alias, or dependency range is treated as reproducible unless its immutable digest or resolved lock entry is recorded.

## Migration strategy

The rebuild uses a strangler approach:

1. Define canonical events, session state, deadlines, provider contracts, and conformance tests in shared packages.
2. Route the existing browser and Express paths through the new core while preserving behavior.
3. Replace main-thread VAD with an AudioWorklet/native capture pipeline.
4. Introduce interruption-aware state and slow style adaptation.
5. Add encrypted archive and migrate existing JSON/JSONL stores.
6. Split the Express monolith into focused services and remove dead SaaS/CRM paths.
7. Add the Windows Tauri shell and native capture adapters.
8. Add local GPU STT, embeddings, speaker verification, and coaching providers selected by benchmarks.
9. Add Android capture/companion.
10. Add Zoom RTMS and Twilio adapters; keep Meet Media behind an eligibility flag.
11. Remove compatibility code only after replay and conformance suites pass.

At every step the repository remains runnable and the current browser path remains available until its replacement passes acceptance tests.

## Testing strategy

### Automated correctness

- Unit tests for every state transition, policy, adapter normalizer, and storage command.
- Property/fuzz tests for event parsing, patch sanitization, archive import, and untrusted extraction.
- Deterministic replay tests from event fixtures.
- Contract tests shared by every capture, STT, LLM, speaker, and cloud adapter.
- Red/green tests for each refactor and behavior change.

### Audio and interruption

- Generated two-channel and mixed fixtures with known turn boundaries.
- Overlap, interruption, echo, silence, clipping, device switch, packet loss, and clock-drift cases.
- Separate-channel tests must identify concurrent owner/remote speech.
- Mixed overlap must remain unknown unless evidence is sufficient.

### Intelligence

- Scenario suites for general high-stakes conversation and interviews.
- Grounding, contradiction, stale-result, interruption, repetition, and low-confidence tests.
- Latency benchmark fixtures with p50/p95/p99 reporting.
- Local-model candidate bake-off on the target workstation before promotion.

### Memory and privacy

- Encryption-at-rest inspection.
- DPAPI key-wrap and recovery tests on Windows.
- Migration tests from current JSON/JSONL.
- Search/Q&A provenance tests.
- Slow-learning support/session thresholds and rollback tests.
- No raw-audio write-path and no-secret-log conformance checks.
- Deletion tests across canonical data, indexes, backups, connectors, and in-flight tasks.

### Manual acceptance

- Windows microphone, per-process loopback, system loopback, Bluetooth, Meet Web, Zoom Web, and Zoom desktop.
- Two-device Android speakerphone workflow.
- Android LAN capture, reconnect, background/foreground transitions, and on-device fallback.
- Mid-sentence interruption and overlap.
- Offline full-session operation.
- Cloud opt-in and fallback.
- Always-on-top overlay and keyboard controls.
- Search, Q&A, correction, pinning, export, and purge.

Physical-device and platform acceptance results are recorded separately from automated unit claims.

## Acceptance criteria

- A complete offline Windows session works without cloud access.
- Separate sources preserve simultaneous speaker timelines and detect remote interruption during owner speech.
- Mixed overlap never silently becomes a verified remote turn.
- No obsolete guidance replaces current guidance, and obsolete model work is actually cancelled.
- Bridge, provisional, and final latency meet the approved targets on the target workstation under benchmark load.
- No raw audio is written to disk.
- Canonical transcripts and indexes are encrypted at rest.
- Transcript archive supports full-text, semantic, timeline, and source-linked Q&A.
- Style does not promote before 12 observations across 3 sessions.
- Exact owner phrases are reused only when pinned.
- Cloud context follows the active privacy profile.
- The app injects no spoken recording notice.
- Security invariants remain enforced in permissive personal mode.
- Every adapter passes the same protocol and lifecycle conformance suite.
- Existing private data migrates without loss and can be completely purged.

