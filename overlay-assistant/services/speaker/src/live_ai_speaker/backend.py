from __future__ import annotations

import threading
from collections.abc import Sequence
from typing import Protocol

from .settings import Settings


class ModelUnavailableError(RuntimeError):
    """Raised when the optional Hugging Face model cannot be loaded or run."""


class SpeakerEmbedder(Protocol):
    model_id: str
    model_revision: str

    @property
    def loaded(self) -> bool: ...

    def embed(self, samples: Sequence[float], sample_rate: int) -> tuple[float, ...]: ...


class TransformersSpeakerEmbedder:
    """Lazy Transformers x-vector backend; health never forces a model download."""

    def __init__(self, settings: Settings):
        self.model_id = settings.model_id
        self.model_revision = settings.model_revision
        self._settings = settings
        self._feature_extractor = None
        self._model = None
        self._torch = None
        self._device = "unloaded"
        self._lock = threading.Lock()

    @property
    def loaded(self) -> bool:
        return self._model is not None

    @property
    def device(self) -> str:
        return self._device

    def _load(self) -> None:
        if self.loaded:
            return
        with self._lock:
            if self.loaded:
                return
            try:
                import torch
                from transformers import AutoFeatureExtractor, AutoModelForAudioXVector

                requested = self._settings.device
                if requested == "auto":
                    device = "cuda" if torch.cuda.is_available() else "cpu"
                elif requested in {"cpu", "cuda"}:
                    device = requested
                else:
                    raise ModelUnavailableError(
                        "SPEAKER_DEVICE must be auto, cpu, or cuda"
                    )
                if device == "cuda" and not torch.cuda.is_available():
                    raise ModelUnavailableError("CUDA was requested but is unavailable")

                common = {
                    "revision": self._settings.model_revision,
                    "cache_dir": (
                        str(self._settings.model_cache_dir)
                        if self._settings.model_cache_dir
                        else None
                    ),
                    "local_files_only": self._settings.local_files_only,
                    "trust_remote_code": False,
                }
                self._feature_extractor = AutoFeatureExtractor.from_pretrained(
                    self.model_id, **common
                )
                self._model = AutoModelForAudioXVector.from_pretrained(
                    self.model_id, **common
                )
                self._model.eval().to(device)
                self._torch = torch
                self._device = device
            except ModelUnavailableError:
                raise
            except Exception as exc:
                raise ModelUnavailableError(
                    "speaker embedding model could not be loaded"
                ) from exc

    def embed(self, samples: Sequence[float], sample_rate: int) -> tuple[float, ...]:
        self._load()
        try:
            import numpy as np

            assert self._feature_extractor is not None
            assert self._model is not None
            assert self._torch is not None
            waveform = np.asarray(samples, dtype=np.float32)
            inputs = self._feature_extractor(
                waveform,
                sampling_rate=sample_rate,
                return_tensors="pt",
                padding=True,
            )
            inputs = {name: value.to(self._device) for name, value in inputs.items()}
            with self._torch.inference_mode():
                output = self._model(**inputs)
            vector = output.embeddings[0].detach().float().cpu().tolist()
            return tuple(float(value) for value in vector)
        except Exception as exc:
            raise ModelUnavailableError("speaker embedding inference failed") from exc
