from __future__ import annotations

import os
import tempfile
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any

from .service import BackendResult


class ModelUnavailableError(RuntimeError):
    """Raised when the optional local transcription model cannot run."""


ModelFactory = Callable[..., Any]


def _default_model_factory(
    model_id: str,
    *,
    device: str,
    compute_type: str,
    download_root: str | None,
):
    from faster_whisper import WhisperModel

    return WhisperModel(
        model_id,
        device=device,
        compute_type=compute_type,
        download_root=download_root,
    )


class FasterWhisperBackend:
    """Lazily loaded, serialized faster-whisper backend with ephemeral WAV files."""

    def __init__(
        self,
        *,
        model_id: str,
        device: str,
        compute_type: str,
        model_cache_dir: Path | None,
        temporary_dir: Path,
        model_factory: ModelFactory = _default_model_factory,
    ):
        self.model_id = model_id
        self.device = device
        self.compute_type = compute_type
        self.model_cache_dir = model_cache_dir
        self.temporary_dir = temporary_dir
        self.model_factory = model_factory
        self._model = None
        self._load_lock = threading.Lock()
        self._inference_lock = threading.Lock()

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def _load(self):
        if self._model is not None:
            return self._model
        with self._load_lock:
            if self._model is not None:
                return self._model
            try:
                self._model = self.model_factory(
                    self.model_id,
                    device=self.device,
                    compute_type=self.compute_type,
                    download_root=(
                        str(self.model_cache_dir)
                        if self.model_cache_dir is not None
                        else None
                    ),
                )
            except Exception as exc:
                raise ModelUnavailableError(
                    "local transcription model could not be loaded"
                ) from exc
            return self._model

    def transcribe(self, payload: bytes, language: str | None) -> BackendResult:
        model = self._load()
        self.temporary_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        try:
            self.temporary_dir.chmod(0o700)
        except OSError:
            pass
        temporary_path: str | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="wb",
                suffix=".wav",
                prefix=".turn-",
                dir=self.temporary_dir,
                delete=False,
            ) as handle:
                temporary_path = handle.name
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            os.chmod(temporary_path, 0o600)

            with self._inference_lock:
                segments, info = model.transcribe(
                    temporary_path,
                    language=language,
                    beam_size=1,
                    temperature=0,
                    condition_on_previous_text=False,
                    vad_filter=False,
                    word_timestamps=False,
                )
                text = " ".join(
                    str(segment.text).strip()
                    for segment in segments
                    if str(segment.text).strip()
                )
            return BackendResult(
                text=text,
                language=getattr(info, "language", language),
            )
        except ModelUnavailableError:
            raise
        except Exception as exc:
            raise ModelUnavailableError(
                "local transcription inference failed"
            ) from exc
        finally:
            if temporary_path is not None:
                try:
                    Path(temporary_path).unlink(missing_ok=True)
                except OSError:
                    pass
