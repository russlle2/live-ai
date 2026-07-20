# Live Rhetoric local STT

This service gives the desktop/web runtime a private OpenAI-compatible
`/v1/audio/transcriptions` endpoint backed by faster-whisper. It is designed for
the owner's Windows 11 workstation and defaults to loopback-only access.

## Privacy behavior

- Each request accepts one bounded PCM WAV turn.
- The WAV exists only in memory and one owner-only temporary file while
  faster-whisper is reading it.
- The temporary file is deleted in `finally`, including inference failures.
- No audio or transcript log is written by this service.
- The main Live Rhetoric server encrypts accepted transcript turns separately.

## Windows setup

Install `uv` once:

```powershell
winget install --id=astral-sh.uv -e
```

Then, from `overlay-assistant\services\stt`:

```powershell
uv sync --frozen --no-dev
$env:LOCAL_STT_DEVICE = "cuda"
$env:LOCAL_STT_MODEL = "Systran/faster-whisper-large-v3-turbo"
uv run python -m live_rhetoric_stt
```

The first run downloads the configured model. faster-whisper/CTranslate2 must
be able to load the NVIDIA runtime libraries supplied by the installed driver
and CUDA environment. Use `LOCAL_STT_DEVICE=cpu` as a slower fallback.

Configure the main app:

```dotenv
LOCAL_STT_BASE_URL=http://127.0.0.1:8178/v1
LOCAL_STT_MODEL=Systran/faster-whisper-large-v3-turbo
```

If `LOCAL_STT_API_KEY` is set, use the same value in both processes.

## Endpoints

- `GET /health`
- `GET /v1/models`
- `POST /v1/audio/transcriptions`

The transcription endpoint accepts OpenAI-style multipart fields: `file`,
`model`, optional `language`, and `response_format=json`.

## Tests

```bash
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=src \
  python3 -m unittest discover -s tests -v
```

Unit tests use a fake model and never download weights or retain audio.
