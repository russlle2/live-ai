# Verification — 2026-10-07 UTC

**Verdict:** source regressions pass and the local engine responds; translation quality passed only partially. The updated APK has built and passed signature verification, but installation and native runtime behavior remain unverified. This is not yet a verified hands-free, live in-call guide.

## Artifacts and test scope

| Item | Evidence / result |
|---|---|
| Installed app inspected | Version **0.1.0**, version code **1**, confirmed from the installed APK |
| Installed APK SHA-256 | `45e629c1e944c3e3a8334729882362ead464eac39cb0e1e5e775e688843dc26b` |
| Updated source | Version **0.1.1**, version code **2**; changes based on `9097ee8` |
| Updated build | Resource compilation, Java compilation, and D8 completed with exit code 0 |
| Updated signature verification | **Pass**: APK Signature Scheme v3; one signer |
| Updated APK size / SHA-256 | **74,768 bytes**; `97e5248b2259ab26b73a924873cb59298461b9e821162f10bbe106a93620c97f` |
| Update compatibility | Package remains `com.christopherlake.liverhetoric`; APK metadata confirms version **0.1.1**, code **2** |
| Signing-certificate continuity | **Pass**: installed and updated APK signer SHA-256 both `14f17525e11f7b2905bf3bfd26d29501de49ca122c252feb624b2144c1c7580b` |
| Updated APK installation and native UI | Pending; inspecting or building an APK does not verify that it runs on the phone |
| Core tests | **11 passed** |
| Browser regression groups | **8 passed**, using Chromium with a simulated native bridge |
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

## Remaining readiness gates

1. Install the verified version 0.1.1 APK and confirm the installed version. The installer-open command completed successfully, but the installed app was still 0.1.0 at the subsequent package check. Android’s Update action requires an on-device tap.
2. Exercise microphone permission, installed on-device recognizer/language support, speech results, cancellation, and foreground/background transitions in the actual app. Test call-time microphone behavior separately.
3. Verify that this phone's Samsung caption view exposes supported text fields during an actual call. Accessibility service connection alone does not establish compatibility.
4. Keep the guide visible, or use a supported split-screen arrangement, and manually identify the speaker. The current app stops microphone capture and generation in the background and has no automatic speaker identification or background guidance overlay.
5. Measure end-to-end latency and output quality in the real interaction. API smoke tests and simulated-browser tests cannot satisfy this gate.

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
