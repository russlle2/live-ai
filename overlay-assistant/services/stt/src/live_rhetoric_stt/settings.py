from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _env_float(name: str, default: float, minimum: float, maximum: float) -> float:
    raw = os.getenv(name)
    try:
        value = default if raw is None else float(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be a number") from exc
    if not minimum <= value <= maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


def _env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.getenv(name)
    try:
        value = default if raw is None else int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc
    if not minimum <= value <= maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


@dataclass(frozen=True, slots=True)
class Settings:
    model_id: str
    device: str
    compute_type: str
    model_cache_dir: Path | None
    temporary_dir: Path
    api_token: str | None
    min_audio_seconds: float
    max_audio_seconds: float
    max_payload_bytes: int
    host: str
    port: int

    @classmethod
    def from_env(cls) -> "Settings":
        private_root = Path(
            os.getenv("LIVE_RHETORIC_PRIVATE_DATA_DIR", "./data/private")
        ).expanduser()
        cache = os.getenv("LOCAL_STT_MODEL_CACHE_DIR") or os.getenv("HF_HOME")
        token = os.getenv("LOCAL_STT_API_KEY")
        device = os.getenv("LOCAL_STT_DEVICE", "auto").strip().lower()
        if device not in {"auto", "cpu", "cuda"}:
            raise ValueError("LOCAL_STT_DEVICE must be auto, cpu, or cuda")
        return cls(
            model_id=os.getenv(
                "LOCAL_STT_MODEL",
                "Systran/faster-whisper-large-v3-turbo",
            ).strip(),
            device=device,
            compute_type=os.getenv("LOCAL_STT_COMPUTE_TYPE", "auto").strip(),
            model_cache_dir=Path(cache).expanduser() if cache else None,
            temporary_dir=private_root / "stt" / "turns",
            api_token=token.strip() if token and token.strip() else None,
            min_audio_seconds=_env_float(
                "LOCAL_STT_MIN_AUDIO_SECONDS", 0.1, 0.05, 5.0
            ),
            max_audio_seconds=_env_float(
                "LOCAL_STT_MAX_AUDIO_SECONDS", 15.0, 1.0, 120.0
            ),
            max_payload_bytes=_env_int(
                "LOCAL_STT_MAX_PAYLOAD_BYTES",
                8 * 1024 * 1024,
                1024,
                64 * 1024 * 1024,
            ),
            host=os.getenv("LOCAL_STT_HOST", "127.0.0.1"),
            port=_env_int("LOCAL_STT_PORT", 8178, 1, 65_535),
        )
