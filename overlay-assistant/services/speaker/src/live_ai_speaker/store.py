from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .embeddings import EmbeddingError, normalize_vector


class ProfileStoreError(RuntimeError):
    """Raised when the private owner-voice profile is corrupt or unavailable."""


@dataclass(frozen=True, slots=True)
class OwnerVoiceProfile:
    model_id: str
    model_revision: str
    embedding: tuple[float, ...] = field(repr=False)
    sample_count: int = 1
    updated_at: str = ""
    schema_version: int = 2

    @classmethod
    def create(
        cls,
        *,
        model_id: str,
        model_revision: str,
        embedding: tuple[float, ...],
        sample_count: int,
    ) -> "OwnerVoiceProfile":
        return cls(
            model_id=model_id,
            model_revision=model_revision,
            embedding=normalize_vector(embedding),
            sample_count=sample_count,
            updated_at=datetime.now(UTC).isoformat(),
        )

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "OwnerVoiceProfile":
        try:
            schema_version = int(data["schemaVersion"])
            model_id = str(data["modelId"])
            model_revision = str(data.get("modelRevision", ""))
            sample_count = int(data["sampleCount"])
            updated_at = str(data["updatedAt"])
            embedding = normalize_vector(data["embedding"])
        except (KeyError, TypeError, ValueError, EmbeddingError) as exc:
            raise ProfileStoreError("owner voice profile is invalid") from exc
        if schema_version not in {1, 2}:
            raise ProfileStoreError("owner voice profile schema is unsupported")
        if not model_id or sample_count < 1 or not updated_at:
            raise ProfileStoreError("owner voice profile metadata is invalid")
        return cls(
            model_id=model_id,
            model_revision=model_revision,
            embedding=embedding,
            sample_count=sample_count,
            updated_at=updated_at,
            schema_version=schema_version,
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "schemaVersion": self.schema_version,
            "modelId": self.model_id,
            "modelRevision": self.model_revision,
            "sampleCount": self.sample_count,
            "updatedAt": self.updated_at,
            "embedding": list(self.embedding),
        }


class OwnerProfileStore:
    def __init__(self, path: Path):
        self.path = path

    def load(self) -> OwnerVoiceProfile | None:
        if not self.path.exists():
            return None
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ProfileStoreError("owner voice profile could not be read") from exc
        if not isinstance(raw, dict):
            raise ProfileStoreError("owner voice profile must be a JSON object")
        return OwnerVoiceProfile.from_dict(raw)

    def save(self, profile: OwnerVoiceProfile) -> None:
        temporary_path: str | None = None
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            try:
                self.path.parent.chmod(0o700)
            except OSError:
                pass
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=self.path.parent,
                prefix=".owner_embedding.",
                suffix=".tmp",
                delete=False,
            ) as handle:
                temporary_path = handle.name
                json.dump(profile.to_dict(), handle, separators=(",", ":"))
                handle.flush()
                os.fsync(handle.fileno())
            os.chmod(temporary_path, 0o600)
            os.replace(temporary_path, self.path)
        except OSError as exc:
            if temporary_path:
                try:
                    Path(temporary_path).unlink(missing_ok=True)
                except OSError:
                    pass
            raise ProfileStoreError("owner voice profile could not be saved") from exc

    def delete(self) -> bool:
        try:
            existed = self.path.exists()
            self.path.unlink(missing_ok=True)
            if self.path.parent.exists():
                for candidate in self.path.parent.glob(".owner_embedding.*.tmp"):
                    candidate.unlink(missing_ok=True)
            return existed
        except OSError as exc:
            raise ProfileStoreError("owner voice profile could not be deleted") from exc
