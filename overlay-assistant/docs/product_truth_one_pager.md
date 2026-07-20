# Product truth

## What is implemented

Live Rhetoric is a private, single-owner browser communication aide with:

- separate owner-microphone and user-shared remote/system audio capture where the browser supports it;
- AudioWorklet/audio-time VAD per source, with local faster-whisper preferred and short-lived OpenAI Realtime sessions available as fallback;
- authenticated laptop audio-host and phone companion pairing;
- immediate cushions, a deterministic provisional line, and a short structured best line with actual abort propagation and deadline fallback;
- deterministic pre-display rejection for unknown evidence citations, private identifiers/source references, weakly grounded personal/action/title/numeric/employer/credential claims, unverified insurance claims, unauthorized service promises, negotiation bluffs, credential requests, and destructive IT instructions, with fallback preservation;
- exact seven-stage, mode-specific guidance from greeting through goodbye;
- interview, insurance-sales, IT-support, inbound-service, negotiation, and general modes;
- encrypted delivered-suggestion versus verified-owner-speech comparison plus slow numeric style learning after 12 eligible observations across three sessions;
- evidence-backed personal memory with confidence, provenance, sensitivity, validity, review flags, automatic transcript learning, and strict retrieval gating;
- bounded Gmail/Drive catch-up and incremental sync after one exact-read-only OAuth consent;
- encrypted Google OAuth/cache/cursor state, pre-cache redaction, minimized retained source content, and source-change/deletion reconciliation;
- owner deletion for individual facts plus a confirmed full purge covering local memory, Google state/facts, transcripts/style logs, speaker enrollment, and runtime database metadata;
- an owner-only memory review panel for verify-as-written, correction, and per-fact deletion without exposing raw source bodies or integration secrets;
- automatic three-consistent-turn owner-voice enrollment, poisoning rejection, and a fail-closed pinned Hugging Face verifier;
- a speaker-profile generation barrier that prevents in-flight enrollment from restoring a deleted embedding;
- optional two-fixed-speaker stereo direction with repeated calibration/evidence and item-ID-bound attribution;
- 96 original, reviewed weak-versus-improved examples, balanced across six modes and isolated from personal memory;
- a pinned 9,125-pair HelpSteer2 audit whose five staged survivors remain non-live;
- installable PWA and typed/manual fallback when audio attribution is unavailable;
- native browser always-on-top guidance through Document Picture-in-Picture where supported;
- encrypted indefinite transcript retention with source-linked local search;
- optional loopback local coaching through an OpenAI-compatible Ollama/llama.cpp server.

Authentication is fail-closed. Host development can generate managed owner credentials and expose the pairing code only to a directly observed loopback peer. Container and reverse-proxy deployments must provision explicit JWT/access-code/storage-encryption secrets. Unauthenticated use requires the explicit demo flag.

## What is automatic

Git and Docker image exclusions do not make private resources unavailable. The server automatically prefers configured local coaching/transcription, can load the server-side OpenAI key as fallback, retrieves eligible personal memory, writes encrypted transcript/style records, refreshes authorized Gmail/Drive state, and calls the speaker verifier. The user does not paste keys, transcripts, embeddings, or memory into each session.

Memory eligibility is processing-aware. Local personal coaching may retrieve review-gated normal/sensitive context with explicit qualification and ranking penalties, but cannot assert review-gated biography. Cloud coaching remains review-clear/verified. Restricted facts are never automatically retrieved.

## What is conditional or unsupported

- The owner must initiate tab/window sharing and enable audio. Meet/Zoom Web usually work through a shared tab; Zoom desktop is available only when the browser/OS returns an audio track.
- An ordinary PWA cannot capture protected same-phone cellular/VoIP uplink and downlink. Foreground microphone listening supports a room or speakerphone on another device and may stop when backgrounded.
- Mixed acoustic attribution is probabilistic. Direction requires actual stereo, explicit two-person fixed geometry, repeated evidence, and no overlap/conflict; it does not biometrically identify the remote person.
- Continuous Google sync extracts Gmail bodies and supported Google/text files, but PDF bodies and Gmail attachment binaries are metadata-only.
- The aide does not independently verify employer policy, interview rules, insurance authority/scripts, product facts, or newly pasted personal claims.
- It does not autonomously speak, place calls, apply for jobs, or make regulated decisions.
- The deterministic output validator catches defined evidence/safety patterns; it is not formal proof that every possible generated claim follows from its sources. The owner remains responsible for checking material statements.
- Preference-dataset winners are not presumed correct or safe. HelpSteer2 staging candidates cannot enter live retrieval without independent review and manifest admission.
- Historical enterprise, CRM, selling, roadmap, legal, and context-pack documents are not current product claims.

## Storage truth

The repository excludes populated environment files, `data/private`, recordings, voice material, Google exports, and runtime databases from publication. Google state, personal memory, transcript turns, and suggestion/style comparisons are application-encrypted. Populated environment files/API keys, managed auth state, PostgreSQL data, numeric style-feature logs, and speaker embeddings still depend on owner-only permissions and host storage protection. Every deployment must use full-disk or encrypted-volume protection and encrypted owner-controlled backups; Git exclusion is not encryption.

The app binds to loopback by default. The main Compose file keeps PostgreSQL and the speaker service internal; a development override exposes them only on loopback. Phone/LAN access requires an authenticated HTTPS proxy or private tunnel, explicit auth secrets, correct origins, and a host firewall.

## Deletion truth

The full purge requires `ERASE MY PRIVATE DATA`, closes live sessions, drains or blocks stale private writes, removes local stores, attempts Google revocation, and rotates managed auth plus the managed Google storage key. It reports warnings when a database/speaker service is unavailable or secrets are environment-managed. It cannot retroactively erase external backups, stdout, reverse-proxy/container logs, or browser-local profile/session access text on another device; those systems/devices need their own deletion controls, although rotated tokens block server access.

## Consent truth

The app does not decide whether recording, transcription, retention, or AI assistance is allowed. The owner must obtain clear participant consent and follow applicable law, employer/customer/interview rules, insurance requirements, platform terms, and data-retention obligations. It must not be used to fabricate credentials, experience, results, coverage, or technical outcomes.
