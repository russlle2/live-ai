# Live Rhetoric operating guide

## First start and pairing

For host development, start the server from the workspace and open `http://localhost:5173`. If explicit auth secrets are absent, the server generates owner credentials under `data/private/`; the local laptop UI fetches the pairing code only because the server directly sees a loopback peer. It uses the code for laptop login and shows it so the owner can pair the current phone browser session once. The phone exchanges that code for a time-limited owner JWT and does not attach the code to every request. Re-enter it after browser session storage is cleared or credentials rotate.

For Docker, a reverse proxy, LAN access, or any HTTPS deployment, configure `JWT_SECRET` (32+ characters), `PERSONAL_ACCESS_CODE` (12+ characters), and `PRIVATE_STORAGE_ENCRYPTION_KEY` (32+ characters). Add a separate `GOOGLE_STORAGE_ENCRYPTION_KEY` when Google sync is enabled. Docker bridge/NAT or proxy traffic may not look like loopback to the server, so container deployments must not depend on the bootstrap endpoint. `ALLOW_INSECURE_DEMO_AUTH=true` disables this protection and is permitted only for a temporary, loopback-only demo.

On Windows, run `scripts/setup-local-ai.ps1` once to install and configure Ollama plus the locked faster-whisper service. Live Rhetoric then prefers local GPU transcription and coaching automatically. The first run downloads model weights; later sessions work without a cloud AI connection.

## Recommended call setup

Use the laptop as the **audio host** and the phone as the **companion display**. This gives the app two deterministic sources: the laptop microphone is the owner and a separately shared tab/system-audio track is the other person.

Before a call:

1. Confirm that recording, transcription, retention, and AI assistance are permitted. Obtain clear participant consent and follow the employer, customer, interview, carrier, platform, and local rules that apply.
2. Open Live Rhetoric on the laptop and log in.
3. Choose interview, insurance sales, IT support, inbound service, negotiation, or general.
4. Enter the target role, company, and immediate goal. Paste only approved job or call context.
5. Choose **Audio host** and start the session; approve microphone access.
6. When the browser prompts for a share source, select the Google Meet/Zoom Web tab and enable **Share audio**. A Zoom desktop window or system source is usable only when the browser and operating system return an audio track.
7. On the phone, open the same authenticated HTTPS deployment, enter the owner access code when first pairing, choose **Companion**, and enter the laptop session ID.

The app cannot silently join a meeting or bypass the browser share picker. Stop capture when consent ends or confidential material outside the approved purpose begins.

## What appears during a call

The session opens with the exact greeting to say. The conversation path contains seven directly speakable stages from greeting through goodbye. After a verified remote turn, the response area follows a latency ladder:

1. **Cushion:** an immediate generic bridge.
2. **Provisional line:** a mode-aware deterministic response if the model is not ready.
3. **Best line:** a short, evidence-grounded generated response.

Use the cushion only when a fraction of a second is useful. A newer remote turn cancels or supersedes stale output, so an old response cannot overwrite current guidance.

The generated line is accepted only after a deterministic evidence/safety check. It rejects unknown memory references, private identifiers/source references, weakly grounded personal/action/title/numeric/employer/credential claims, unverified insurance claims, unauthorized service promises, negotiation bluffs, credential requests, and destructive IT commands. A rejected line never reaches the display; the deterministic fallback remains. This is a conservative safeguard, not a proof system capable of establishing the truth of every possible natural-language sentence, so the owner must still check important claims before speaking.

For each verified remote turn, the server retrieves a bounded set of relevant contrasts from the reviewed 96-example library: a weak structure, a stronger structure, why it works, and domain guardrails. The examples are not claims about the owner. Only eligible personal facts and safe learned style tendencies may shape the final line.

After a final line is delivered and the next verified owner-microphone turn arrives, the app compares suggested and spoken wording. Exact comparisons are encrypted for review; automatic learning stores only numeric style features. A profile changes after at least 12 eligible observations across three sessions, rejects contradictory evidence, and excludes accepted model wording and factual corrections. Exact owner wording is not made reusable unless explicitly pinned.

## Speaker identity

- **Dedicated sources:** local microphone = **You**; separately shared system/tab audio = **Other person**. Only the remote source automatically triggers coaching.
- **Mixed or owner-only:** a strong owner-embedding match may become **You**. Every non-match, weak result, overlap, or unavailable verification remains **Unknown** and does not trigger remote-person coaching.
- **Two fixed speakers + stereo:** enable this only for exactly two stationary people on opposite sides of a true stereo microphone. Three strong verified-owner turns calibrate the owner side; two consecutive strong opposite-side non-owner turns are required before **Other person**. Mono/dual-mono, center speech, movement, unstable timing, overlap, and voice/direction conflict remain **Unknown**.
- **Manual correction:** use **That was them — coach this** only after personally confirming the speaker.

Three clean dedicated-owner microphone turns automatically enroll a normalized private owner embedding. Raw enrollment clips are discarded. The embedding is a similarity heuristic, not a login credential or proof of the other person's identity.

An installed phone PWA can use its foreground microphone for an in-room exchange or a speakerphone playing from a second device. It cannot directly capture protected same-phone cellular/VoIP uplink and downlink, and capture is not reliable after the PWA is backgrounded. For a phone interview, use the laptop as the listening/guidance host or conduct the call through a supported laptop client.

## Mode guardrails

- **Interview:** answer directly, use eligible evidence, and favor concise STAR stories. Do not invent experience, dates, credentials, or outcomes.
- **Insurance sales:** discover needs and handle objections only within the owner's current license, appointment, carrier scripts, approved disclosures, and product facts. Do not guarantee coverage or returns.
- **IT support:** acknowledge, clarify, give one reversible diagnostic step at a time, and confirm the result. Never fabricate system access or a resolved outcome.
- **Inbound service:** verify appropriately, de-escalate, own the next action, and avoid exposing customer data.
- **Negotiation:** identify the goal and constraint, frame truthful value, ask a calibrated question, and avoid unauthorized promises.
- **General:** produce the clearest credible next line for the stated relationship and goal.

## Memory policy and review

Memory retrieval is automatic for verified remote turns:

- **Local personal mode:** normal and sensitive review-gated context can be retrieved with a visible internal qualification and ranking penalty, but cannot become an asserted personal-history claim.
- **Cloud mode:** normal evidence must be review-clear; sensitive evidence must also be owner-verified.
- **Restricted:** never included in automatic coaching prompts, even if owner-verified.

Validity dates and relevance are also enforced. Review-gated claims can remain stored so the owner can resolve them without being presented as fact. The app periodically distills completed transcript turns into career/story candidates and learns delivery style asynchronously; conversation-derived employment, education, skill, achievement, project, and career-story claims always require owner review before live use. Unsupported elevated actions/titles are rejected and weak evidence overlap remains quarantined. The live path always reads the local evidence bank and never waits on Gmail/Drive network latency.

Choose **Review facts** in the automation panel to open the owner-only review surface. It separates claims needing owner review from claims that are confirmed and review-clear, shows normalized fact text plus bounded source metadata, and lets you verify as written, correct and verify, or permanently delete one fact. The panel deliberately does not display raw source bodies, OAuth data, or hidden credentials. Confirmation clears review flags; it never makes a restricted fact eligible, and normal review-clear facts may already have been eligible before confirmation.

After one Google consent, bounded Gmail/Drive catch-up and incremental sync run automatically. The worker requests exactly read-only scopes, sanitizes source text and titles before caching/model use, and replaces or deactivates facts when a source changes or disappears. Exact email addresses, phone numbers, street addresses, verification codes, secret-bearing lines, account/government/payment identifiers, and credentials are removed. Gmail profile/From/To addresses are used only in memory during that sync to derive non-identifying owner/correspondent and direction labels; correspondent/unknown high-impact claims remain review-gated. Full source bodies are cleared after successful extraction. Continuous sync treats PDFs and Gmail attachment binaries as metadata only.

## Private storage is automatic, not magically encrypted

All relative paths are resolved from the `overlay-assistant` directory. Runtime files are used even though Git and Docker build context exclude them:

- `data/private/personal_memory.local.json`: personal evidence bank;
- `data/private/sessions/`: encrypted transcript and delivery-comparison archives plus non-text numeric style features;
- `data/private/google/`: encrypted OAuth material, cursors, and minimized cache;
- `data/private/personal_auth.local.json`: host-development managed auth/bootstrap state;
- `data/private/speaker/owner_embedding.json`: local-service owner embedding;
- Compose volume `speaker_private`: containerized speaker embedding.

Google state, personal memory, transcript turns, and delivery comparisons are application-encrypted. The populated environment file/API keys, managed auth file, PostgreSQL data, numeric style-feature logs, and speaker embedding still rely on owner-only file permissions and host storage encryption. Use encrypted backups. Protect the Compose `speaker_private` volume too, or choose not to back it up and re-enroll after restoration.

## Erasing data

Open the automation panel, choose **Erase all private data…**, and type the exact confirmation `ERASE MY PRIVATE DATA`. A full purge:

- closes active sessions and cancels pending learning persistence;
- clears personal memory and transcript/style logs;
- removes Google-derived facts and encrypted local Google state;
- attempts to revoke the Google provider grant;
- deletes the owner voice enrollment;
- clears runtime database metadata and pending telemetry;
- rotates app-managed JWT/access-code credentials and the managed Google storage key, invalidating existing tokens and protecting future Google state with a fresh key.

Read the returned warnings. If the speaker service or database was unavailable, that store may still need deletion. Environment-managed auth/storage secrets cannot be rotated by the app. Provider revocation is best effort. The initiating browser clears its local state; clear site data on every other paired device because its browser-local profile and session access-code text may remain even though the rotated JWT blocks server access. External backups, proxy logs, stdout, and container logs have separate retention and must be handled through their own systems.

## Troubleshooting

- **No system audio:** stop and restart capture, select the call tab/window, and enable Share audio. Some browser/OS combinations do not offer it.
- **Phone cannot join:** use the same HTTPS origin and exact session ID. Laptop `localhost` is not reachable as phone `localhost`. Confirm explicit deployment auth values are configured.
- **Pairing code does not appear in Docker:** expected. The server does not see Docker bridge/NAT traffic as a direct loopback peer; use the explicitly configured `PERSONAL_ACCESS_CODE`.
- **No microphone permission:** allow the microphone in browser site permissions and reload.
- **No AI answer:** inspect `/api/ai-status`; start the configured local Ollama/llama.cpp server or configure cloud OpenAI. Cushions and deterministic fallbacks remain available if both are unavailable.
- **Wrong speaker label:** stop audio. Restart capture to reset directional calibration, keep both people/device stationary, or disable direction and use source/manual labels. Do not continue in a falsely verified mode.
- **Google cannot decrypt state:** restore the exact storage encryption key used to create it. If unavailable, purge/reconnect Google; changing the key cannot recover old ciphertext.

The reusable coaching corpus is under `data/coaching/` and contains no owner facts. The pinned HelpSteer2 audit covers 9,125 preference pairs; its five staged survivors remain quarantined and are not live coaching data.
