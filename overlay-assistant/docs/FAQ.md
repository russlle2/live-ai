# Live Rhetoric FAQ

## If private files are excluded from Git and Docker images, how does the app use them?

The exclusions prevent publication, not runtime access. The server automatically loads the API key from a local environment file, reads and updates personal memory, writes transcript/style logs, opens encrypted Google OAuth/cache state, and calls the private speaker service. Host development uses ignored local paths. Compose bind-mounts `data/private` into the app and gives the speaker verifier its own named volume. Nothing needs to be pasted for every turn.

## Is all private data encrypted at rest?

Not all stores are encrypted by the application. Google state, personal memory, transcript turns, and suggestion/style comparisons use authenticated encryption. The populated environment file/API keys, managed auth file, PostgreSQL data, numeric style-feature logs, and speaker embedding still rely on owner-only filesystem permissions and host disk/volume encryption. Use encrypted, owner-controlled backups. Git exclusion is not encryption.

## How do I log in if I did not configure secrets?

For direct host development, unless explicit demo mode is enabled, the server generates strong local JWT/access-code credentials in `data/private/personal_auth.local.json`. The laptop UI can retrieve the pairing code only when the server directly observes a loopback peer and uses it automatically. Enter the displayed code once to pair the current phone browser session and obtain its owner token; enter it again after browser session storage is cleared or credentials rotate. In this direct-host topology, non-loopback peers are rejected.

Docker bridge/NAT or reverse-proxy traffic may not appear as loopback even when the host publish is loopback-only. Provision `JWT_SECRET`, `PERSONAL_ACCESS_CODE`, and a distinct `GOOGLE_STORAGE_ENCRYPTION_KEY` explicitly for container or proxied deployments; do not expect the container to reveal a generated code.

If both `JWT_SECRET` and `PERSONAL_ACCESS_CODE` are supplied, the app uses them instead. The only no-auth mode is the explicit `ALLOW_INSECURE_DEMO_AUTH=true` switch, which is unsafe beyond a temporary loopback demo.

## Can the phone hear a call running on that same phone?

Not reliably. An ordinary PWA cannot directly capture protected cellular or VoIP uplink/downlink audio, and foreground capture can stop when the browser is hidden. Use the laptop as the audio host for a laptop call, or let the laptop hear a phone call that is on speaker. A phone foreground microphone can support an in-room conversation or a speakerphone on another device, subject to consent.

## Does Zoom or Google Meet work automatically?

The owner must initiate screen/tab sharing and enable audio. Meet and Zoom Web usually work best by sharing the call tab. Zoom desktop audio is supported only if Chrome/Edge and the operating system expose an audio track for the selected window/system source. If no separate remote track exists, the app must use mixed/unknown behavior instead of pretending attribution is certain.

## Can transcription and coaching stay on my laptop?

Yes. A healthy loopback faster-whisper service is preferred automatically for transcription, and a loopback OpenAI-compatible Ollama/llama.cpp server is preferred for coaching. `scripts/setup-local-ai.ps1` installs and configures both paths on Windows. Cloud OpenAI remains optional for Realtime transcription, deeper extraction, or fallback.

## Will one off-script answer immediately change future wording?

No. Verified owner turns are reduced to numeric style features rather than retained as reusable phrases. Promotion requires at least 12 eligible observations across three sessions, rejects contradictory or session-dominated evidence, moves each feature only a bounded amount, and excludes accepted model wording and factual corrections. Exact wording becomes reusable only when the owner explicitly pins it.

## How does the app know which person spoke?

A dedicated owner microphone and a separately shared remote track are authoritative. In mixed audio, a strong owner-embedding match may label **You**, but a non-match alone never proves **Other person**. Optional direction requires an explicit two-fixed-speaker declaration, true stereo input, repeated owner-side calibration, repeated opposite-side evidence, and no overlap or conflicting signals. Otherwise the turn stays `Unknown` until the owner labels it.

## Which personal facts can enter an automatic suggestion?

Local personal mode may retrieve normal or sensitive review-gated context, but marks it `review-required`, ranks it below verified evidence, and permits clarification rather than an asserted biography. Cloud coaching requires review-clear evidence and owner verification for sensitive facts. Restricted facts never enter automatic prompts. Validity dates and relevance still apply.

## Does the app guarantee that every suggested claim is true?

No. Before display, a deterministic guard verifies that cited memory IDs were actually retrieved and rejects private identifiers/source references, weakly grounded personal/action/title/numeric/employer/credential claims, unverified insurance claims, unauthorized service promises, negotiation bluffs, credential requests, and destructive IT commands. Rejection preserves the safe deterministic fallback. These checks are useful guardrails, not formal proof for every possible natural-language claim; verify important facts before speaking them.

## How do I verify, correct, or delete one memory fact?

Open the automation panel and choose **Review facts**. The owner-only panel shows normalized fact text, category, sensitivity, confidence, and source metadata. Choose **Verify as written**, **Correct**, or **Delete**. Verification clears review flags but does not override sensitivity policy: normal review-clear facts may already have been eligible, sensitive facts require confirmation, and restricted facts remain excluded after confirmation. Source bodies, OAuth material, and credentials are not shown.

## What does the Google connection retain?

The independent runtime requests exactly Gmail read-only and Drive read-only scopes. It stores encrypted OAuth material and resumable cursors, plus a minimized encrypted cache. Exact email addresses, phone numbers, street addresses, verification codes, credentials, and government/payment identifiers are removed before caching/model use; subjects and filenames are sanitized. Gmail From/To addresses are reduced locally to non-identifying owner/correspondent direction labels, and high-impact claims from a correspondent or unknown author remain review-gated. Full source bodies are cleared after extraction succeeds. PDFs and Gmail attachment binaries are metadata-only in continuous sync.

## Can I disconnect Google or erase what the app learned?

Use **Erase all private data…** and type `ERASE MY PRIVATE DATA`. The full purge removes Google-derived facts and local Google state and attempts provider revocation along with memory, transcript/style logs, voice enrollment, and database metadata. A memory-scope purge also disconnects/clears Google so sync cannot immediately recreate memory. The full purge rotates app-managed auth credentials and the managed Google storage key. The initiating UI clears its site state; clear site data manually on every other paired browser because browser-local profile and session access-code text can remain even though its old JWT is invalid. Review returned warnings: an unavailable database/speaker service, failed provider revocation, environment-managed secrets, external logs, and backups require separate follow-up.

## Is the app recording calls legally?

The app cannot decide whether capture is permitted. Recording, transcription, monitoring, AI-assistance, employer, customer, interview, and insurance rules vary. Obtain clear participant consent, follow applicable policies and platform terms, disclose assistance when required, and do not capture or retain a conversation when permission is absent.

## Is the large coaching corpus training on my personal data?

No. Runtime retrieval uses 96 original, reviewed weak-versus-improved contrasts, balanced across six modes and kept separate from personal memory. A pinned HelpSteer2 audit inspected 9,125 pairs; only five passed automatic staging filters, and all five remain quarantined and unavailable to live retrieval. Personal style is blended only at generation time.

## What does owner-voice enrollment store?

The speaker service retains one normalized embedding and metadata, not raw enrollment clips. In host development the default is `data/private/speaker/owner_embedding.json`; Compose uses the `speaker_private` named volume. It is a similarity heuristic, not an authentication factor or proof of the remote person's identity.
