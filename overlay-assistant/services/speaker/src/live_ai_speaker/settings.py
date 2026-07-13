from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _find_overlay_root() -> Path:
    """Find overlay-assistant in a source checkout without coupling installed builds."""
    for parent in Path(__file__).resolve().parents:
        if (parent / "services" / "speaker").is_dir() and (parent / "data").is_dir():
            return parent
    return Path.cwd()


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


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    normalized = raw.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"{name} must be true or false")


@dataclass(frozen=True, slots=True)
class Settings:
    model_id: str
    model_revision: str
    model_cache_dir: Path | None
    local_files_only: bool
    device: str
    owner_threshold: float
    min_enrollment_samples: int
    sample_rate: int
    min_audio_seconds: float
    max_audio_seconds: float
    max_payload_bytes: int
    profile_path: Path
    api_token: str | None
    host: str
    port: int

    @classmethod
    def from_env(cls) -> "Settings":
        private_dir = Path(
            os.getenv(
                "LIVE_AI_PRIVATE_DATA_DIR",
                str(_find_overlay_root() / "data" / "private" / "speaker"),
            )
        ).expanduser()
        cache_value = os.getenv("SPEAKER_MODEL_CACHE_DIR") or os.getenv("HF_HOME")
        api_token = os.getenv("SPEAKER_SERVICE_API_TOKEN")
        return cls(
            model_id=os.getenv(
                "SPEAKER_MODEL_ID", "anton-l/wav2vec2-base-superb-sv"
            ),
            model_revision=os.getenv(
                "SPEAKER_MODEL_REVISION",
                "eb0be47779dda10620d068ab579fca970ee7e417",
            ),
            model_cache_dir=Path(cache_value).expanduser() if cache_value else None,
            local_files_only=_env_bool("SPEAKER_LOCAL_FILES_ONLY", False),
            device=os.getenv("SPEAKER_DEVICE", "auto").strip().lower(),
            owner_threshold=_env_float("SPEAKER_OWNER_THRESHOLD", 0.90, 0.0, 1.0),
            min_enrollment_samples=_env_int(
                "SPEAKER_MIN_ENROLLMENT_SAMPLES", 3, 2, 10
            ),
            sample_rate=_env_int("SPEAKER_SAMPLE_RATE", 16_000, 8_000, 48_000),
            min_audio_seconds=_env_float("SPEAKER_MIN_AUDIO_SECONDS", 0.6, 0.1, 10.0),
            max_audio_seconds=_env_float("SPEAKER_MAX_AUDIO_SECONDS", 15.0, 1.0, 120.0),
            max_payload_bytes=_env_int(
                "SPEAKER_MAX_PAYLOAD_BYTES", 8 * 1024 * 1024, 1024, 64 * 1024 * 1024
            ),
            profile_path=private_dir / "owner_embedding.json",
            api_token=api_token.strip() if api_token and api_token.strip() else None,
            host=os.getenv("SPEAKER_SERVICE_HOST", "127.0.0.1"),
            port=_env_int("SPEAKER_SERVICE_PORT", 8791, 1, 65_535),
        )
