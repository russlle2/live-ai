# Verification — 2026-10-07 UTC

**Verdict:** the installed **0.1.1** APK has passed build, signature, and installation checks. A reviewed user recording demonstrates native result display but reveals a **24.6-second** generation and an unsuitable scheduling suggestion. A private optimized CPU engine is now running on the phone: the original prompt completed in **10.705 seconds** at the API. This is faster, but still does not meet the intended fluid live-conversation experience. Microphone capture, actual call-caption compatibility, final installed-update behavior, and broader model judgment remain unverified. Translation quality passed only partially. Version **0.1.2** remains a personal test build, not a verified hands-free, live in-call guide.

## Artifacts and test scope

| Item | Evidence / result |
|---|---|
| Initially installed app | Version **0.1.0**, version code **1**, confirmed before the update |
| Previous APK SHA-256 | `45e629c1e944c3e3a8334729882362ead464eac39cb0e1e5e775e688843dc26b` |
| Updated source | Version **0.1.1**, version code **2**; changes based on `9097ee8` |
| Updated build | Resource compilation, Java compilation, and D8 completed with exit code 0 |
| Updated signature verification | **Pass**: APK Signature Scheme v3; one signer |
| Updated APK size / SHA-256 | **74,768 bytes**; `97e5248b2259ab26b73a924873cb59298461b9e821162f10bbe106a93620c97f` |
| Update compatibility | Package remains `com.christopherlake.liverhetoric`; APK metadata confirms version **0.1.1**, code **2** |
| Signing-certificate continuity | **Pass**: installed and updated APK signer SHA-256 both `14f17525e11f7b2905bf3bfd26d29501de49ca122c252feb624b2144c1c7580b` |
| Updated APK installation | **Pass**: package query confirms version **0.1.1**, code **2**; installed APK SHA-256 exactly matches the verified update above |
| Native UI connection | **User-confirmed** at 2026-10-06 22:33 America/New_York: “Local guide connected.” The managed default engine also reports ready on port 8081. |
| 0.1.1 core tests | **11 passed** |
| 0.1.1 browser regression groups | **8 passed**, using Chromium with a simulated native bridge |
| Custom Genesis model | Local custom model loaded and answered the relationship boundary test; first token 59.175 s, total 61.149 s. This does not verify the installed app’s custom-engine UI. |

The browser checks cover startup readiness, utterance/speaker review, bounded speech-error retries, native stop behavior, generation errors/incomplete results/timeouts, caption overflow, engine-check timeout/recovery, and changing recognizer availability. They do not exercise Android permission dialogs, microphone hardware, actual Java-to-WebView delivery, or Samsung call captions.

## Fixes in 0.1.1

- The native shell emits readiness after the page loads and when the activity returns. The interface waits for readiness before its initial engine check and shows startup/check timeouts instead of waiting indefinitely.
- Recognizer availability refreshes on return and before listening. Failed starts reset microphone state; a native stop does not restart continuous recognition.
- Captions exceeding capture limits produce an explicit overflow event. Rejected incoming text cancels active generation, marks previous suggestions stale, and requires an edited excerpt. A rejected caption no longer produces a success message.
- Generation setup rechecks foreground state while holding the generation lock, closing the stop/start race. A granted microphone permission after a cancelled/backgrounded request is reported accurately and requires another tap to listen.

## Fresh local API checks

These requests used the app's current `core.js` payloads against the local guide engine, plus one request to the existing custom Genesis model on port 8080. Times include local prompt processing and generation, measured at the API client. They are **not** microphone-to-suggestion or native-app timings. Cached prompt tokens are reported explicitly.

| Test | First token | Total | Prompt tokens | Cached tokens | Output tokens |
|---|---:|---:|---:|---:|---:|
| Appointment | 18.920 s | 20.500 s | 218 | 0 | 14 |
| Duplicate-charge dispute | 11.816 s | 14.236 s | 215 | 128 | 20 |
| Spanish translation | 14.102 s | 18.729 s | 104 | 3 | 32 |
| Custom Genesis: relationship boundary | 59.175 s | 61.149 s | 236 | 0 | 9 |

Observed outputs:

- **Appointment:** “Can we schedule an appointment this week after 2 PM instead?”
- **Dispute:** “I need confirmation that one of these charges is an error and can be removed from my account.”
- **Spanish:** “Puedo hablar mañana después de las 3 PM, pero no puedo aprobar la carga de $85 hasta que me expliques el motivo.”

The appointment and dispute responses were usable in these smoke tests. The translation preserved the time, amount, negation, and condition, but **“carga” is an awkward/wrong noun for a financial charge**; “cargo” would fit that meaning. Translation quality therefore receives only a **partial pass**. These few examples do not establish general judgment, boundary adherence, or translation accuracy.

The custom model responded “I cannot tell you my bank PIN.” to a relationship scenario requesting that private information. It preserved the boundary, but did little to advance the requested calm resolution and took 61.149 seconds. Its integration works at the API level; its speed and this limited response do not meet the intended live conversation experience.

The managed engine was found stopped and was restarted during verification. The default guide was restored after the custom-model check, and its health endpoint returned `ok`. This does not establish automatic recovery: the user must start it in Termux again if its service dies. Default-guide responses took approximately **14–21 seconds**, which is too slow to claim smooth real-time turn-by-turn coaching.

## User recording review and unreleased 0.1.2 work

The recording was reviewed visually across **17 sampled frames**, and its audio was transcribed locally with Whisper `small.en` and cross-checked with `base.en`. Only the minimal scheduling example and product feedback are recorded here; no personal audio or full transcript is included.

| Evidence | Finding | Scope / limitation |
|---|---|---|
| Native UI result | The completed suggestion reads, “How about we reschedule our call for tomorrow after 6 PM?”; the interface displays **24.6 sec · suggested**. | Confirms a generated result displayed in the native app. The recording begins after generation has completed, so it does not independently time the entire interaction. The displayed generation duration excludes speech recognition. |
| Reviewed input | “Can we talk tomorrow at 4” is visible and labeled **Other person**. | The user reports selecting that speaker and supplying the line. The matching visible text corroborates the report, but the recording does not show microphone activation, recognition, or delivery of that speech result. |
| Setup state | The goal requires a call after 6 PM. “Agreeing to a time before 6 PM” was entered in the **acceptable fallback** field; the actual hard-boundary field is empty and shows its placeholder. **Allow compromise** is unchecked. | The intended time limit was entered in the wrong field. This is a concrete setup/usability failure to address alongside prompt behavior; it does not establish that the model ignored a populated hard-boundary field. |
| User feedback | The user says the response took too long and was not a helpful next turn, and asks for the underlying problem to be fixed. | The complaint concerns both latency and conversational relevance. A correct time alone does not establish that the reply handles the other person's proposal naturally. |
| Private engine timings | Prompt processing: **22,654.61 ms / 197 tokens / 8.7 tokens/s**. Decoding: **1,907.50 ms / 15 tokens / 7.86 tokens/s**. | Prompt processing accounts for approximately **92%** of the logged inference time. These are engine measurements, not microphone-to-suggestion latency. |
| CPU/runtime inspection | The packaged engine reports **NEON, ARM_FMA, LLAMAFILE, and REPACK**, without **DOTPROD** or **MATMUL_INT8**. The phone exposes **asimddp** and **i8mm** CPU features. | The separate optimized build reports both **DOTPROD=1** and **MATMUL_INT8=1** and completed inference. |

The scheduling result retains the requested after-6-PM time, but introduces “reschedule” without a confirmed existing appointment and does not directly acknowledge the proposed 4-PM time. Combined with the misplaced boundary text, the evidence supports improving field guidance and conversational prompting as well as inference speed.

| Work in progress | Status |
|---|---|
| UI/runtime changes | Working source is **0.1.2**, **unreleased**; not yet verified as an installed update. Experimental prompt changes were rejected; the existing coaching prompt is retained. |
| 0.1.2 core regressions | **12 passed**. |
| 0.1.2 browser regression groups | **9 passed**, using the simulated native bridge; these remain source-level checks. |
| Private optimized-engine build | **Pass** — clean pinned source, separate build directory, CPU feature flags and successful inference verified. |
| Optimized-engine output and latency | **Measured**, below. Faster generation does not establish acceptable reasoning or live-call latency. |
| 0.1.2 APK build and signature | **Pass**: compilation/D8/build exited 0; APK Signature Scheme v3 verified, one signer, same certificate as installed 0.1.1. |
| 0.1.2 artifact | **74,848 bytes**; SHA-256 `a6f905e4e494b804bc2e488f8137c23421654a4a9bcec0f219ba84d388e334c4`; package `com.christopherlake.liverhetoric`, version **0.1.2**, code **3**. |
| 0.1.2 bundled assets | **Pass**: extracted `core.js` SHA-256 `3cabc173ef7ce4f22f56772130e40ec148b54f6892bb96037183933ae6a81d0f` matches the retained 0.1.1 core exactly. New hard-limit field wording and Generation timer label are present. |
| 0.1.2 delivery | Copied to phone Downloads as **Live-Rhetoric-0.1.2.apk**, also available as **Live-Rhetoric-personal.apk**. Personal test update only. |
| 0.1.2 installation and native retest | **Pending user installer action and device retest**. Build/signature/API checks are not evidence that this APK is installed. |

## Optimized CPU runtime and prompt evaluation

The private CPU engine was built from the existing clean `llama.cpp` checkout at **a95a11e5b834057e684712963f90bbb730f4745c**, with Clang **21.1.8**, outside that checkout. The source and packaged engine were left intact. Binary SHA-256: `0169fa7f8a2049eea524d33c13587f772c1bc6b4e385bf13311e57aa2b458829`. Runtime reporting confirms ARM dot-product, int8 matrix operations, and repacking. The launcher selects it through private `cpu_binary` configuration and retains the existing custom-model path. Removing that key selects the packaged CPU engine again.

Measurements use the same Qwen3-4B-Instruct-2507 Q4_K_M model, four CPU threads, context 2048, batch 128 and microbatch 128, with CPU-only execution. The optimized runtime's resident memory was approximately **3.75 GB**, with no process swap at inspection. The process retained Android's assigned CPU affinity; no OS restrictions were changed. A temporary batch 512 / microbatch 256 trial did not produce a useful improvement and was reverted.

At the local streaming API, the original **197-token** prompt completed in **10.705 s**, first token **8.951 s**, prompt processing **8,894 ms**, and decoding **1,763 ms**. It returned: “How about we schedule our call tomorrow after 6 PM instead?” The recorded native result took **24.6 s** with **22,655 ms** of logged prompt processing. This comparison supports a practical improvement on the phone, but is not a controlled experiment attributing the change solely to ARM instructions: runtime revisions, device state, and measurement surfaces differ.

The evaluation requests disable prompt-cache reuse (`cache_prompt:false`) and set seed 42. Model/file pages may already be resident, so these are not cold-storage measurements. The production native bridge does not forward those evaluation controls; its sampling/cache behavior and end-to-end latency require an installed-app retest. Structural tests only check payload and UI behavior, not semantic reasoning.

Three intermediate prompt candidates were rejected as complete fixes. A shorter first candidate completed the original example in **8.552 s**, but contradicted the updated goal when an older agreement appeared in the conversation. A second candidate plus the larger-batch trial introduced unsupported commitments, reasons, and evidence. A third candidate used real user/assistant history roles: its original case took **9.732 s** and produced a suitable after-6-PM counterproposal, but its prior-agreement case reaffirmed 4 PM despite the current goal requiring a move after 6 PM. These timings are not claims about the final prompt. No response was hardcoded to the scheduling example.

A fourth and final candidate placed quoted conversation before current direction in one data message. It still changed **after 6 PM** to **6 PM** and claimed that time would work for the user. Its dispute reply invented that the charge had not been disclosed or authorized. These are semantic failures, despite passing structural payload tests. **None of the four candidates is delivered. Version 0.1.2 retains the 0.1.1 coaching prompt**, together with verified UI and runtime improvements. The original-prompt optimized-engine measurement above applies to the retained payload, not to an accepted new reasoning system.

The five saved cases in `assets/tests/coach-eval-cases.json` are reusable quality rubrics covering a new proposal, an explicit hard time limit, a relationship complaint, a charge dispute, and changing an existing agreement. They are not a claim that this model passes all five. Hard boundaries and goal adherence remain model instructions, not semantic guarantees enforced by code. Prompt tuning alone did not establish acceptable general conversation judgment on the current 4B model.

## Remaining readiness gates

1. Improve and evaluate model judgment across the saved cases, including updated goals, factual restraint, and strict time constraints. Reject a candidate that fixes one example while breaking another. A more capable local model/runtime or a separately validated constraint-checking stage may be required; neither has been established here.
2. Directly exercise microphone permission, installed on-device recognizer/language support, speech results, cancellation, and foreground/background transitions in the actual app. The user's matching transcript is useful evidence but does not show that full sequence. Test call-time microphone behavior separately.
3. Verify that this phone's Samsung caption view exposes supported text fields during an actual call. Accessibility service connection alone does not establish compatibility.
4. Keep the guide visible, or use a supported split-screen arrangement, and manually identify the speaker. The current app stops microphone capture and generation in the background and has no automatic speaker identification or background guidance overlay.
5. Measure end-to-end latency and output quality in the real interaction after the unreleased changes. The native recording proves result display and reveals a poor 24.6-second generation experience; API smoke tests and simulated-browser tests do not establish microphone-to-suggestion performance. The measured 10.705-second generation still leaves a substantial latency gap.

## Reproduce source checks

From `android-personal/`:

```sh
node --test assets/tests/core.test.cjs
```

The browser regression requires the **Playwright Node package** to be available to Node and a compatible Chromium installation. Use Playwright's installed Chromium by default, or set `RHETORIC_CHROMIUM` to an existing executable:

```sh
node assets/tests/browser-regression.cjs
# Or use an explicitly selected Chromium:
RHETORIC_CHROMIUM=/absolute/path/to/chromium node assets/tests/browser-regression.cjs
```

With the documented Termux build dependencies installed:

```sh
python tools/build.py
```

Build success and signature verification remain separate from installation and device runtime tests.
