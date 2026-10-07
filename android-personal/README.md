# Live Rhetoric — personal Android app

A goal-driven conversation guide for relationships, disputes, appointments, work, support calls, negotiations, and everyday conversations. Set what you want, what you would accept, and your boundaries. Add what was said, identify the speaker, and request a short next line or a translation.

This is a separate, dependency-free Android shell around a bundled interface. It uses a model running locally in Termux. The broader web application remains in `../overlay-assistant`.

## What works, and what “live” means

- Type or paste an utterance; import UTF-8 `.txt`, `.srt`, or `.vtt`; or share text to the app from another app.
- Request a suggestion grounded in your outcome, acceptable compromise, boundaries, context, and tone. Review it before saying it: a small local model can miss context, invent facts, or produce poor advice.
- Before a conversation, tap **Prepare guide** after setting your goal and limits. It processes the same instructions in advance and discards its single output token. Preparation has its own status and never creates a suggestion or conversation turn. Starting a real request cancels unfinished preparation.
- Translate a short utterance. Token-limited results are marked incomplete, never presented as finished translations.
- Use on-device speech recognition when Android reports an installed compatible recognizer. The app requests microphone permission only when you tap Speak. It never falls back to a cloud recognizer.
- Optionally repeat recognition while the app is visible. Each native recognition operation handles one utterance. Microphone capture and generation stop when the app goes to the background. Keep the app visible or use supported split-screen mode for active use; neither setup guarantees access to phone-call audio.
- Choose the speaker yourself. Imported text and visible captions start as **Unknown** and need review. This build has no automatic speaker identification or owner-voice verification.

Samsung's built-in call transcription does **not** establish that third-party apps can receive its audio or live transcript. This app does not access internal call recordings or private dialer APIs. The optional accessibility bridge is experimental: after you manually enable the service in Android Settings and enable capture inside Live Rhetoric, it reads visible text only from caption/transcription-labelled resource IDs in the allowed Samsung/InCallUI packages. Some One UI versions expose no compatible fields. Captured text is staged for speaker review, not automatically used to generate advice.

## Local architecture

| Component | Behavior |
|---|---|
| Bundled interface | `assets/index.html`, `core.js`, `app.js`, and `styles.css`; no external scripts, analytics, or web requests |
| Native bridge | `MainActivity.java`; bounded text requests, streaming responses, latest-request cancellation, microphone and document-picker integration |
| Local guide engine | `http://127.0.0.1:8081`; Qwen3-4B-Instruct-2507 Q4_K_M, Unsloth GGUF conversion |
| Custom local engine | `http://127.0.0.1:8080`; your existing compatible GGUF, configured privately |
| Engine protocol | `/health`, `/v1/models`, and streaming `/v1/chat/completions`; redirects and arbitrary ports/URLs are rejected |
| Optional caption bridge | `CaptionAccessibilityService.java`; visible caption/transcription fields only, explicitly enabled per app session |

The default is Qwen's non-thinking Instruct variant; the launcher does not need reasoning-budget flags. The launcher runs one engine at a time, binds to loopback, and avoids stopping unrelated processes. Its portable default uses the CPU; a compatible, separately tested Vulkan runtime can optionally use the phone's GPU. Unload PocketPal or another copy of the model before starting to reduce memory pressure. Inference speed depends on the phone, model, backend, thermal state, and prompt length; “live” is not a latency guarantee. The reviewed native-app recording showed an unsuitable suggestion after **24.6 seconds** of generation. A separately tested optimized CPU engine reduces inference time in a local API check, but smooth live conversation and reliable response quality remain unverified. See [VERIFICATION.md](VERIFICATION.md) for current measurements and their limits.

The installed app keeps conversation text in memory. It stores only whitelisted outcome/preferences in Android private preferences, disables backups, and does not persist caption-enable state. Closing/killing the process loses the session. Android clipboard copying and explicitly selected/shared documents follow their respective Android storage behavior. Termux maintains engine state and diagnostic logs in its private home directory. Loopback prevents remote network exposure; it does not authenticate against other apps on the same phone.

## Build and install in Termux

Use the existing trusted Termux installation. From a local checkout of this repository:

```sh
cd android-personal
pkg install openjdk-21 aapt aapt2 apksigner python llama-cpp git
termux-setup-storage
python tools/prepare-build.py
python tools/download-model.py
install -m 700 tools/rhetoric-start "$PREFIX/bin/rhetoric-start"
python tools/build.py
```

`termux-setup-storage` lets the build copy its APK to Downloads and permits access to a shared-storage custom model. It does not enable commands from other Android apps. No broad external-command grant, remote shell, cloud API key, account, or `allow-external-apps=true` setting is required.

The build writes `build/Live-Rhetoric-personal.apk` and copies it to `/storage/emulated/0/Download/Live-Rhetoric-personal.apk`. Open that file with Android's installer and approve installation for the app you use to open it, if Android requests that permission. Building or verifying a signature is not an installed-app runtime test.

`prepare-build.py` downloads two fixed official Google archives, validates the selected JARs, and records archive/JAR SHA-256 values in a private provenance file. It extracts only the required JAR, never archive-controlled filesystem paths:

- Android 35: `https://dl.google.com/android/repository/platform-35-ext15_r01.zip`
- Build tools 35: `https://dl.google.com/android/repository/build-tools_r35_linux.zip`

The default directory is `~/.local/share/live-rhetoric-build`. Existing structurally valid JARs are reused; use `--refresh` to fetch the pinned archives again. The build also accepts `RHETORIC_ANDROID_JAR` and `RHETORIC_D8_JAR` overrides. Compilation uses Java 8 bytecode and D8, without Gradle or third-party app dependencies. The build targets Android 35 and requires Android 12/API 31 or newer.

The personal APK signing key and its password stay in `~/.local/share/live-rhetoric-build`, outside the repository, with private permissions. Retain that key securely to install future builds as updates to the same app. Do not commit signing material, model configuration, model weights, downloaded SDKs, or runtime files.

## Models and daily use

The fast-model downloader pins all of the following and verifies exact size and SHA-256 before atomically making the file available. Interrupted downloads retain a resumable `.part` file.

| Field | Value |
|---|---|
| Source | `unsloth/Qwen3-4B-Instruct-2507-GGUF` on Hugging Face |
| Revision | `a06e946bb6b655725eafa393f4a9745d460374c9` |
| File | `Qwen3-4B-Instruct-2507-Q4_K_M.gguf` |
| Bytes | `2497281120` |
| SHA-256 | `3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597` |
| Local path | `~/models/live-rhetoric/Qwen3-4B-Instruct-2507-Q4_K_M.gguf` |

To use your custom model, create `~/.config/live-rhetoric/models.json` privately, substituting the actual absolute file path:

```json
{
  "custom_model": "/storage/emulated/0/Download/YourModels/model.gguf"
}
```

Use mode `700` for `~/.config/live-rhetoric` and `600` for `models.json`. Without this configuration, custom mode looks for `~/models/custom.gguf`. The custom model is user supplied; its weights and personal path are not included in the repository. Its chat-template support and output quality require separate verification.

For a device with an existing **matching, tested** Vulkan build of `llama-server`, the same private configuration optionally accepts:

```json
{
  "custom_model": "/storage/emulated/0/Download/YourModels/model.gguf",
  "backend": "vulkan",
  "vulkan_binary": "~/llama-server-vulkan",
  "vulkan_libraries": "~/llama-vulkan-libs"
}
```

The binary and its companion libraries must belong to the same tested runtime. This setup does not download or prescribe replacement GPU libraries. A preexisting Android aarch64 runtime identified as version 1, commit `a95a11e`, built with Clang 21.1.8 reported an Adreno 840 device; that discovery alone does not establish correct inference or improved latency. Full offload on that runtime failed with a Vulkan device-loss error, including with flash attention disabled. Batch 32 did not complete within 50 seconds. The delivered configuration uses CPU. Enable this configuration only after device quality and latency checks pass. Leave `backend` unset, or set it to `"cpu"`, to use the portable CPU fallback. Configuration remains private and is never committed. The stock OpenCL backend also returned no available platform after the official vendor-driver setup; that unsuccessful driver package was removed.

### Optional optimized ARM CPU engine

The phone's packaged CPU engine reported NEON and repacking but lacked dot-product and int8 matrix support, despite the hardware supporting both. In the recorded test, prompt processing took 22.65 seconds of the approximately 24.6-second generation. `tools/build-cpu.py` builds a separate engine with those supported ARM instructions; it does not overwrite the Termux package or modify the source checkout.

Run it in Termux with a clean local `llama.cpp` checkout at commit `a95a11e5b834057e684712963f90bbb730f4745c` and CMake, Ninja, and Clang installed:

```sh
python tools/build-cpu.py --source ~/llama.cpp
```

The script checks the processor features and exact source revision, builds outside the checkout, and links its own engine libraries into the executable. It leaves Android system libraries normally linked. It does not download models, change system CPU restrictions, or install GPU drivers.

An engine built from that clean source revision successfully ran on the target phone and reported **DOTPROD** and **MATMUL_INT8** enabled. With the same Qwen3-4B model, CPU execution, batch size **128**, and the original **197-token** prompt, one local API request with `cache_prompt: false` reached its first token in **8.951 seconds** and completed in **10.705 seconds**. The recorded native-app result took **24.6 seconds**, but the tests used different conditions and runtime commits; this is not a controlled measurement attributing the entire difference to those CPU instructions. It also does not establish microphone-to-suggestion latency or improved reasoning quality.

After checking successful inference on the target phone, select the private executable by adding this key to the existing private `models.json` (retain the custom model path):

```json
{
  "backend": "cpu",
  "cpu_binary": "~/.local/build/live-guide-cpu-a95a11e/bin/llama-server"
}
```

Then run `rhetoric-start fast`. The launcher notices an executable change and switches only its managed engine. Remove `cpu_binary` and run the same command to return to the packaged engine. Build success alone is not a speed or response-quality guarantee; see [VERIFICATION.md](VERIFICATION.md) for measured results.

```sh
rhetoric-start fast
# Or switch models:
rhetoric-start custom

# Inspect or stop the managed local engine:
rhetoric-start status
rhetoric-start stop
```

After the launcher reports Ready, open Live Rhetoric, choose the corresponding engine, enter your desired outcome/compromise/boundaries, and add an utterance. Fallback text is sent to the model only when you select “Allow compromise now.” Choose its speaker before requesting advice. Text, shared transcripts, and imports are the reliable fallback when microphone access or Samsung caption integration is unavailable.

For a lower wait during the conversation, set your direction first, tap **Prepare guide**, and wait for **Prepared** before speaking. The preparation cost happens before the first reply. A phone API test took **6.920 seconds** to prepare, then **2.923 seconds** for the first reply and **4.487 seconds** for a three-turn follow-up. These are a small sample, not installed-app or microphone-to-answer guarantees. Prepare again after changing direction, switching engines, translating, or a long pause. Android may reclaim the model's memory; a successful health check alone does not mean the model's prompt is prepared. The app does not run a background keep-warm loop.

## Verification

See [VERIFICATION.md](VERIFICATION.md) for the **2026-10-07 UTC** results, artifact status, measured latency, and outstanding device checks. The current working source is **0.1.3**, a personal test update with an explicit preparation action. The confirmed installed version is **0.1.2**. Source checks do not establish installation of the newer version.

```sh
node --test assets/tests/core.test.cjs
```

The browser regression requires the **Playwright Node package** and compatible Chromium. It uses a simulated native bridge; it does not test an installed APK. Run with Playwright's installed Chromium, or provide an existing executable:

```sh
node assets/tests/browser-regression.cjs
# Optional executable override:
RHETORIC_CHROMIUM=/absolute/path/to/chromium node assets/tests/browser-regression.cjs
```

Build and verify the APK in the prepared Termux environment:

```sh
python tools/build.py
```

Version **0.1.2** adds clearer setup fields and support for the optional optimized CPU runtime. It retains the **0.1.1 baseline coaching prompt**: tested replacement prompts still violated time constraints or introduced unsupported assumptions, so they were not retained. **Reasoning and conversational-response quality are not fixed by this update.** Goal and hard-limit fields now appear before the optional fallback; the fallback is visibly inactive until authorized. The displayed timer explicitly measures generation, excluding speech recognition. Historical 0.1.1 local API requests took **14–21 seconds**. See [VERIFICATION.md](VERIFICATION.md) for final source-test results, current runtime measurements, and remaining device checks.

Version **0.1.3** keeps the same coaching messages and adds pre-call preparation with prompt reuse explicitly enabled. Preparation preserves the current goal, limits, authorized fallback, and committed history. Its one generated token is discarded by the native shell. Typing, changing direction, clearing the session, backgrounding, and real requests cancel active preparation; stale preparation events cannot replace a suggestion. Preparing does not repair the model's semantic errors or provide access to call audio.

The JavaScript suite checks conversation/request behavior. The build compiles Java/resources, creates DEX, signs the APK, and verifies its signature. These checks do not certify Samsung caption compatibility, microphone behavior during a call, translation accuracy, or model judgment. Verify the installed app on the target phone with a short ordinary utterance, cancelled generation, an imported text sample, and foreground/background transitions before relying on it in a conversation.
