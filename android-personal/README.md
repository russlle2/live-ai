# Live Rhetoric — personal Android app

A goal-driven conversation guide for relationships, disputes, appointments, work, support calls, negotiations, and everyday conversations. Set what you want, what you would accept, and your boundaries. Add what was said, identify the speaker, and request a short next line or a translation.

This is a separate, dependency-free Android shell around a bundled interface. It uses a model running locally in Termux. The broader web application remains in `../overlay-assistant`.

## What works, and what “live” means

- Type or paste an utterance; import UTF-8 `.txt`, `.srt`, or `.vtt`; or share text to the app from another app.
- Request a suggestion grounded in your outcome, acceptable compromise, boundaries, context, and tone. Review it before saying it: a small local model can miss context, invent facts, or produce poor advice.
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

The default is Qwen's non-thinking Instruct variant; the launcher does not need reasoning-budget flags. The launcher runs one engine at a time, binds to loopback, and avoids stopping unrelated processes. Its portable default uses the CPU; a compatible, separately tested Vulkan runtime can optionally use the phone's GPU. Unload PocketPal or another copy of the model before starting to reduce memory pressure. Inference speed depends on the phone, model, backend, thermal state, and prompt length; “live” is not a latency guarantee. On the target phone, two CPU examples preserved the requested appointment time and relationship boundaries, completing in 30.17 seconds cold and 14.41 seconds with a reused prompt prefix. These are small smoke tests, not a quality guarantee or a claim of instant coaching.

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

```sh
rhetoric-start fast
# Or switch models:
rhetoric-start custom

# Inspect or stop the managed local engine:
rhetoric-start status
rhetoric-start stop
```

After the launcher reports Ready, open Live Rhetoric, choose the corresponding engine, enter your desired outcome/compromise/boundaries, and add an utterance. Fallback text is sent to the model only when you select “Allow compromise now.” Choose its speaker before requesting advice. Text, shared transcripts, and imports are the reliable fallback when microphone access or Samsung caption integration is unavailable.

## Verification

```sh
node --test assets/tests/core.test.cjs
python tools/build.py
```

A Spanish translation smoke test preserved “cannot before 10 AM” and “this week.” Repeating the identical cached request streamed its first token in 0.18 seconds and finished in 4.13 seconds; this is a cache-hit result, not representative new-conversation latency.

The JavaScript suite checks conversation/request behavior. The build compiles Java/resources, creates DEX, signs the APK, and verifies its signature. These checks do not certify Samsung caption compatibility, microphone behavior during a call, translation accuracy, or model judgment. Verify the installed app on the target phone with a short ordinary utterance, cancelled generation, an imported text sample, and foreground/background transitions before relying on it in a conversation.
