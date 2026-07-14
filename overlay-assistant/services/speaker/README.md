# Optional speaker-verification fallback

This small service verifies whether a mixed-audio segment is probably the owner's
voice. It is an optional fallback for speakerphone or other mixed-channel audio;
it is not the app's primary speaker-identification system.

The identity order is deliberate:

1. A separately captured microphone channel is the owner.
2. A separately captured system/tab-audio channel is the other participant.
3. If only mixed audio exists, this service may affirm `owner` above a conservative
   similarity threshold. Every weaker, missing, or incompatible result is
   `unknown`—never `other`.

That last rule matters: a voice-verification non-match is not proof that a speaker
is the other participant. The app must not trigger remote-party coaching from an
`unknown` result without another explicit signal. Verify one non-overlapping speech
turn at a time; an overlapping segment containing both voices is inherently
ambiguous even when the owner's voice is detectable.

## Model and data

The backend lazily loads the Apache-2.0
[`anton-l/wav2vec2-base-superb-sv`](https://huggingface.co/anton-l/wav2vec2-base-superb-sv)
speaker-verification model through Hugging Face Transformers and Torch. Its Hub
card describes a Wav2Vec2 XVector head trained for the SUPERB speaker-verification
task on 16 kHz audio. The first enrollment or classification can therefore be slow
while the model downloads. `/health` does not load or download the model. The
default deployment pins immutable model revision
`eb0be47779dda10620d068ab579fca970ee7e417` and disables remote model code.

The backend uses `AutoModelForAudioXVector`, so another compatible Hub model can be
selected with `SPEAKER_MODEL_ID`. For example,
`microsoft/wavlm-base-plus-sv` is compatible and generally attractive for its
WavLM speaker embeddings, but its model card points to a CC BY-SA 3.0 license—not
Apache-2.0. Review that license before selecting or redistributing it.

Enrollment stores only a normalized owner embedding and metadata—never the raw
audio—at `overlay-assistant/data/private/speaker/owner_embedding.json` by default.
Compose instead stores it in its dedicated `speaker_private` named volume; the
container receives neither repository-root `.env.local` nor the app's complete
private-data directory. A voice embedding is still sensitive biometric-derived
data. It is plaintext at rest with owner-only file permissions, so protect the
host/volume with encryption, back it up only when intentional, and use the
authenticated `DELETE /v1/owner` operation (or the app's full private-data purge)
to revoke enrollment.

Deletion first advances a profile generation, then waits for any active model operation. An enrollment that started under the older generation is rejected before save, so a slow in-flight inference cannot recreate the embedding after deletion. Matching crash-left temporary profile files are removed as part of deletion without sweeping unrelated files.

This is a similarity heuristic, not biometric authentication. The default `0.90`
threshold is intentionally conservative but should be calibrated with the actual
microphone, room noise, and representative enrollment phrases. Below threshold
always remains `unknown`.

## Run locally

Python 3.11–3.13 is supported. With `uv`:

```bash
cd overlay-assistant/services/speaker
uv sync --frozen
uv run uvicorn live_ai_speaker.main:app --host 127.0.0.1 --port 8791
```

`uv.lock` records the resolved dependency graph and the Docker build runs
`uv sync --frozen --no-dev` as a non-root service user. A manual editable install
with `pip install -e .` is convenient but does not provide the same lock
enforcement. The service accepts uncompressed PCM WAV (8/16/24/32-bit),
downmixes channels, and resamples to 16 kHz. Clips must be 0.6–15 seconds by
default. A few varied, clean enrollment clips are better than one long clip.

Enroll the owner:

```bash
curl --fail --request POST \
  --header 'Content-Type: audio/wav' \
  --data-binary @owner-sample.wav \
  http://127.0.0.1:8791/v1/owner/enroll
```

Classify a segment:

```bash
curl --fail --request POST \
  --header 'Content-Type: audio/wav' \
  --data-binary @segment.wav \
  http://127.0.0.1:8791/v1/segments/classify
```

The classification response has `label: "owner" | "unknown"`, the cosine
similarity when available, threshold, and a reason. It intentionally has no
`other` label.

Delete enrollment:

```bash
curl --fail --request DELETE http://127.0.0.1:8791/v1/owner
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `SPEAKER_MODEL_ID` | `anton-l/wav2vec2-base-superb-sv` | Hugging Face XVector model ID |
| `SPEAKER_MODEL_REVISION` | `eb0be47779dda10620d068ab579fca970ee7e417` | Immutable Hub revision for reproducible deployment |
| `SPEAKER_OWNER_THRESHOLD` | `0.90` | Minimum cosine similarity for `owner` |
| `SPEAKER_DEVICE` | `auto` | `auto`, `cpu`, or `cuda` |
| `SPEAKER_LOCAL_FILES_ONLY` | `false` | Refuse Hub downloads when `true` |
| `SPEAKER_MODEL_CACHE_DIR` / `HF_HOME` | Hugging Face default | Model cache location |
| `LIVE_AI_PRIVATE_DATA_DIR` | `../../data/private/speaker` | Private embedding directory |
| `SPEAKER_SERVICE_API_TOKEN` | unset | Optional bearer token for enrollment, classification, and deletion |
| `SPEAKER_MIN_AUDIO_SECONDS` | `0.6` | Minimum clip duration |
| `SPEAKER_MAX_AUDIO_SECONDS` | `15` | Maximum clip duration |
| `SPEAKER_MAX_PAYLOAD_BYTES` | `8388608` | Request-body limit |

When `SPEAKER_SERVICE_API_TOKEN` is set, include
`Authorization: Bearer <token>`. Keep the service on loopback or a private Docker
network; do not expose it directly to the internet. It has no CORS configuration
because the main app server should call it server-to-server.

## Docker

Build with this directory as the context:

```bash
docker build -t live-ai-speaker overlay-assistant/services/speaker
docker run --rm \
  --publish 127.0.0.1:8791:8791 \
  --volume live-ai-speaker-data:/data/private/speaker \
  --volume live-ai-speaker-models:/models \
  live-ai-speaker
```

The project's main Compose stack does not publish this port; the development
override publishes it on loopback only. Set the same bearer token in the app and
service whenever the API is reachable outside its private Compose network. The
image runs one worker so the large model is loaded only once. Its default
`speaker_private` volume contains the plaintext embedding and therefore needs
encrypted volume/disk protection; `speaker_models` contains the model cache.

## Tests

The tests use fake two-dimensional embeddings and standard-library WAV generation;
they never import or download Torch/Transformers models:

```bash
cd overlay-assistant/services/speaker
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=src \
  python -m unittest discover -s tests -v
```
