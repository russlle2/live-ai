from __future__ import annotations

import io
import unittest
import wave
from collections.abc import Sequence

from live_rhetoric_stt.service import (
    AudioValidationError,
    BackendResult,
    TranscriptionService,
)


def wav_bytes(seconds: float = 0.5, sample_rate: int = 16_000) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(b"\x00\x01" * round(seconds * sample_rate))
    return buffer.getvalue()


class FakeBackend:
    model_id = "test-large-v3-turbo"

    def __init__(self, results: Sequence[BackendResult]):
        self.results = iter(results)
        self.calls: list[tuple[int, str | None]] = []

    @property
    def loaded(self) -> bool:
        return bool(self.calls)

    def transcribe(self, payload: bytes, language: str | None) -> BackendResult:
        self.calls.append((len(payload), language))
        return next(self.results)


class TranscriptionServiceTests(unittest.TestCase):
    def test_returns_bounded_openai_compatible_text(self) -> None:
        backend = FakeBackend([
            BackendResult(text="  Local transcript result.  ", language="en")
        ])
        service = TranscriptionService(
            backend=backend,
            min_audio_seconds=0.1,
            max_audio_seconds=15,
            max_payload_bytes=1_000_000,
        )

        result = service.transcribe(wav_bytes(), "en")

        self.assertEqual(result.text, "Local transcript result.")
        self.assertEqual(result.model, backend.model_id)
        self.assertEqual(result.language, "en")
        self.assertAlmostEqual(result.audio_seconds, 0.5, places=2)
        self.assertEqual(backend.calls[0][1], "en")

    def test_rejects_empty_invalid_truncated_and_oversized_audio(self) -> None:
        backend = FakeBackend([])
        service = TranscriptionService(
            backend=backend,
            min_audio_seconds=0.1,
            max_audio_seconds=1,
            max_payload_bytes=2_000,
        )
        for payload in (b"", b"not a wav", wav_bytes(seconds=2), wav_bytes()[:60]):
            with self.subTest(length=len(payload)):
                with self.assertRaises(AudioValidationError):
                    service.transcribe(payload, "en")
        self.assertEqual(backend.calls, [])

    def test_rejects_empty_or_unbounded_model_output(self) -> None:
        backend = FakeBackend([
            BackendResult(text="   ", language="en"),
            BackendResult(text="x" * 20_001, language="en"),
        ])
        service = TranscriptionService(
            backend=backend,
            min_audio_seconds=0.1,
            max_audio_seconds=15,
            max_payload_bytes=1_000_000,
        )
        with self.assertRaises(ValueError):
            service.transcribe(wav_bytes(), "en")
        with self.assertRaises(ValueError):
            service.transcribe(wav_bytes(), "en")


if __name__ == "__main__":
    unittest.main()
