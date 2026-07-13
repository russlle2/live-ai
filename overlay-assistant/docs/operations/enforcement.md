# Personal-app enforcement

The owner may retain private transcripts and memory, but personal use does not remove security, truthfulness, or consent controls.

## Required runtime controls

1. The standard OpenAI key remains server-side; browsers receive only short-lived transcription client secrets.
2. Authentication fails closed. The identity is fixed to the single owner, JWT algorithm/issuer/audience/subject are pinned, and no request field chooses privileges.
3. Host-managed bootstrap is exposed only to a directly observed loopback peer. Docker, proxy, and LAN deployments use explicit strong auth and storage-encryption secrets.
4. `ALLOW_INSECURE_DEMO_AUTH` is an explicit temporary loopback-demo switch, never a network deployment setting.
5. WebSockets require one authenticated start within five seconds, enforce browser origin and connection limits, expire with JWTs, and terminate missing heartbeats.
6. Documented relative paths resolve from the overlay root; guarded private/control paths cannot escape it.
7. Git and Docker image exclusions cover populated environment files, every `data/private` path, recordings, voice material, Google exports, and runtime databases.
8. Google runtime scope is exactly Gmail read-only plus Drive read-only. OAuth/cache/cursor files are authenticated-encrypted; source text/titles are sanitized and minimized.
9. Normal memory must be review-clear; sensitive memory must be owner-verified and review-clear; restricted memory never enters automatic prompts.
10. Dedicated source identity outranks acoustic guesses. Unknown or conflicting audio remains `unknown`; a voice non-match is never relabeled as the other person without the strict independent stereo rule.
11. Only a verified remote/system source triggers automatic coaching. Manual remote labeling requires an explicit owner action.
12. New turn sequence numbers cancel or supersede stale generation. Private-data purge epochs prevent in-flight learning from repopulating deleted state.
13. Prompt, transcript, context, and overlay fields are treated as untrusted, schema-validated, sanitized, and payload-bounded.
14. Model output must cite only memory IDs supplied for that request. Before display, deterministic guards reject private identifiers/source references, weakly grounded personal/action/title/numeric/employer/credential claims, unverified insurance claims, unauthorized service promises, negotiation bluffs, credential requests, and destructive IT commands; rejection preserves the safe fallback.
15. Unsupported credentials, employment dates, pay, quotas, licenses, guarantees, insurance product claims, technical outcomes, and customer facts remain prohibited. Pattern/evidence guards reduce risk but do not constitute formal entailment for arbitrary language.
16. Generic coaching examples remain separate from owner evidence. Only the 96 reviewed originals are live; the five HelpSteer2 staging survivors remain quarantined.

## Storage enforcement

Private runtime files are automatically used even though they are untracked. Google OAuth state, cursors, and minimized cache are application-encrypted. Personal memory, transcript/style logs, managed auth state, PostgreSQL data, and owner embeddings are not all application-encrypted; filesystem permissions alone do not protect a stolen disk, volume, snapshot, or backup. Require full-disk or encrypted-volume storage and encrypted, owner-controlled backups.

The main Compose stack keeps PostgreSQL and speaker ports internal and publishes the app on loopback by default. The development override may expose database/speaker only on loopback. LAN/phone operation requires authenticated HTTPS, correct origin policy, and host-level access controls.

## Deletion enforcement

The full-purge API requires `ERASE MY PRIVATE DATA` and must report partial failures. It closes sessions, drains or invalidates pending persistence, clears app stores, removes Google facts/state, attempts provider revocation, deletes voice enrollment, purges runtime database metadata, discards pending telemetry, and rotates managed auth plus the managed Google storage key. The speaker deletion generation barrier must prevent an enrollment already in inference from saving afterward. Memory-scope deletion must include Google disconnect/cache cleanup to prevent repopulation. Environment-managed secrets, other paired browsers' site data, external logs, and backups require separate rotation/deletion.

## Human/legal enforcement

The owner must obtain clear consent for recording, transcription, monitoring, AI assistance, and retention; follow applicable law and platform terms; and obey employer, customer, interview, confidentiality, and insurance rules. Read-only access and personal ownership do not create permission to process someone else's communications covertly.

The aide may polish a truthful answer. It must not manufacture résumé history, certifications, insurance authority, product coverage, technical access, resolved outcomes, customer consent, or testimonials.

## Repository enforcement

The root CI workflow typechecks, tests, builds, and rejects tracked private runtime paths. Branch protection should require that workflow. A passing tracked-file scan does not prove that host volumes, Docker logs, backups, or deployed secrets are secure; those controls remain operational responsibilities.
