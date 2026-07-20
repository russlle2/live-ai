from __future__ import annotations

import io
import wave
from dataclasses import dataclass
from typing import Protocol


class AudioValidationError(ValueError):
    """Raised when a local transcription request contains unusable audio."""


@dataclass(frozen=True, slots=True)
class BackendResult:
    text: str
    language: str | None


class TranscriptionBackend(Protocol):
    model_id: str

    @property
    def loaded(self) -> bool: ...

    def transcribe(self, payload: bytes, language: str | None) -> BackendResult: ...


@dataclass(frozen=True, slots=True)
class TranscriptionResult:
    text: str
    model: str
    language: str | None
    audio_seconds: float

    def to_dict(self) -> dict[str, object]:
        return {
            "text": self.text,
            "model": self.model,
            "language": self.language,
            "audioSeconds": round(self.audio_seconds, 3),
        }


class TranscriptionService:
    def __init__(
        self,
        *,
        backend: TranscriptionBackend,
        min_audio_seconds: float,
        max_audio_seconds: float,
        max_payload_bytes: int,
    ):
        self.backend = backend
        self.min_audio_seconds = min_audio_seconds
        self.max_audio_seconds = max_audio_seconds
        self.max_payload_bytes = max_payload_bytes

    def transcribe(
        self, payload: bytes, language: str | None
    ) -> TranscriptionResult:
        duration = self._validate_wav(payload)
        normalized_language = self._language(language)
        result = self.backend.transcribe(payload, normalized_language)
        text = " ".join(result.text.split()).strip()
        if not text or len(text) > 20_000:
            raise ValueError("local transcription output is empty or too large")
        return TranscriptionResult(
            text=text,
            model=self.backend.model_id,
            language=result.language or normalized_language,
            audio_seconds=duration,
        )

    def _validate_wav(self, payload: bytes) -> float:
        if not payload:
            raise AudioValidationError("audio body is empty")
        if len(payload) > self.max_payload_bytes:
            raise AudioValidationError("audio body exceeds the configured size limit")
        try:
            with wave.open(io.BytesIO(payload), "rb") as wav:
                channels = wav.getnchannels()
                sample_width = wav.getsampwidth()
                sample_rate = wav.getframerate()
                frame_count = wav.getnframes()
                if wav.getcomptype() != "NONE":
                    raise AudioValidationError("compressed WAV audio is not supported")
                if channels not in {1, 2}:
                    raise AudioValidationError("WAV audio must be mono or stereo")
                if sample_width not in {1, 2, 3, 4}:
                    raise AudioValidationError("WAV sample width is unsupported")
                if sample_rate < 8_000 or sample_rate > 192_000:
                    raise AudioValidationError("WAV sample rate is unsupported")
                duration = frame_count / sample_rate if sample_rate else 0
                if duration < self.min_audio_seconds:
                    raise AudioValidationError("audio is too short")
                if duration > self.max_audio_seconds:
                    raise AudioValidationError("audio is too long")
                frames = wav.readframes(frame_count)
                if len(frames) != frame_count * channels * sample_width:
                    raise AudioValidationError("WAV data is truncated")
        except (wave.Error, EOFError) as exc:
            raise AudioValidationError("body must be valid PCM WAV audio") from exc
        return duration

    @staticmethod
    def _language(value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        normalized = value.strip().lower()
        if (
            len(normalized) > 16
            or not normalized.replace("-", "").isalpha()
        ):
            raise AudioValidationError("language hint is invalid")
        return normalized
