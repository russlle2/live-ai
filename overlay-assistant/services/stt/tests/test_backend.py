from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from live_rhetoric_stt.backend import FasterWhisperBackend
from test_service import wav_bytes


class FakeModel:
    def __init__(self):
        self.paths: list[str] = []
        self.calls: list[dict[str, object]] = []

    def transcribe(self, file_path: str, **options):
        self.paths.append(file_path)
        self.calls.append(options)
        self.path_existed_during_call = Path(file_path).exists()
        return (
            iter([
                SimpleNamespace(text=" First local segment. "),
                SimpleNamespace(text="Second segment."),
            ]),
            SimpleNamespace(language="en"),
        )


class FasterWhisperBackendTests(unittest.TestCase):
    def test_loads_once_and_removes_every_temporary_audio_file(self) -> None:
        fake = FakeModel()
        factory_calls: list[tuple[str, str, str, str | None]] = []

        def factory(model_id, *, device, compute_type, download_root):
            factory_calls.append((model_id, device, compute_type, download_root))
            return fake

        with tempfile.TemporaryDirectory() as directory:
            backend = FasterWhisperBackend(
                model_id="Systran/faster-whisper-large-v3-turbo",
                device="cuda",
                compute_type="auto",
                model_cache_dir=Path(directory) / "models",
                temporary_dir=Path(directory) / "turns",
                model_factory=factory,
            )
            first = backend.transcribe(wav_bytes(), "en")
            second = backend.transcribe(wav_bytes(), None)

            self.assertTrue(fake.path_existed_during_call)
            self.assertEqual(first.text, "First local segment. Second segment.")
            self.assertEqual(first.language, "en")
            self.assertEqual(second.text, first.text)
            self.assertEqual(len(factory_calls), 1)
            self.assertTrue(backend.loaded)
            self.assertFalse(any((Path(path).exists() for path in fake.paths)))
            self.assertEqual(fake.calls[0]["beam_size"], 1)
            self.assertFalse(fake.calls[0]["condition_on_previous_text"])


if __name__ == "__main__":
    unittest.main()
