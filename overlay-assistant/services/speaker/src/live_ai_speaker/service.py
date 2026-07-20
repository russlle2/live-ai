from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Literal

from .audio import decode_pcm_wav
from .backend import SpeakerEmbedder
from .embeddings import cosine_similarity, merge_owner_embeddings, normalize_vector
from .store import OwnerProfileStore, OwnerVoiceProfile, ProfileStoreError


class EnrollmentCancelledError(RuntimeError):
    """Raised when owner deletion invalidates an in-flight enrollment."""


class EnrollmentConsistencyError(ValueError):
    """Raised when a new enrollment sample conflicts with the owner profile."""


@dataclass(frozen=True, slots=True)
class EnrollmentResult:
    accepted: bool
    enrolled: bool
    model_id: str
    model_revision: str
    sample_count: int
    required_sample_count: int
    enrollment_complete: bool
    audio_seconds: float
    replaced_incompatible_profile: bool

    def to_dict(self) -> dict[str, object]:
        return {
            "accepted": self.accepted,
            "enrolled": self.enrolled,
            "modelId": self.model_id,
            "modelRevision": self.model_revision,
            "sampleCount": self.sample_count,
            "requiredSampleCount": self.required_sample_count,
            "enrollmentComplete": self.enrollment_complete,
            "audioSeconds": round(self.audio_seconds, 3),
            "replacedIncompatibleProfile": self.replaced_incompatible_profile,
            "rawAudioStored": False,
        }


@dataclass(frozen=True, slots=True)
class ClassificationResult:
    label: Literal["owner", "unknown"]
    similarity: float | None
    threshold: float
    reason: Literal[
        "owner_match",
        "below_owner_threshold",
        "owner_not_enrolled",
        "owner_enrollment_incomplete",
        "profile_model_mismatch",
    ]
    audio_seconds: float | None

    def to_dict(self) -> dict[str, object]:
        return {
            "label": self.label,
            "similarity": (
                round(self.similarity, 6) if self.similarity is not None else None
            ),
            "threshold": self.threshold,
            "reason": self.reason,
            "audioSeconds": (
                round(self.audio_seconds, 3)
                if self.audio_seconds is not None
                else None
            ),
            "decisionPolicy": "owner_or_unknown_only",
        }


class SpeakerVerificationService:
    def __init__(
        self,
        *,
        embedder: SpeakerEmbedder,
        store: OwnerProfileStore,
        threshold: float,
        sample_rate: int,
        min_audio_seconds: float,
        max_audio_seconds: float,
        max_payload_bytes: int,
        min_enrollment_samples: int,
        model_revision: str,
        enrollment_consistency_threshold: float = 0.65,
    ):
        self.embedder = embedder
        self.store = store
        self.threshold = threshold
        self.sample_rate = sample_rate
        self.min_audio_seconds = min_audio_seconds
        self.max_audio_seconds = max_audio_seconds
        self.max_payload_bytes = max_payload_bytes
        self.min_enrollment_samples = min_enrollment_samples
        self.model_revision = model_revision
        if not 0.3 <= enrollment_consistency_threshold <= 0.95:
            raise ValueError("enrollment consistency threshold is invalid")
        self.enrollment_consistency_threshold = enrollment_consistency_threshold
        self._operation_lock = threading.Lock()
        self._state_lock = threading.Lock()
        self._profile_generation = 0
        self._deletion_requested = False

    def _decode(self, payload: bytes):
        return decode_pcm_wav(
            payload,
            target_sample_rate=self.sample_rate,
            min_seconds=self.min_audio_seconds,
            max_seconds=self.max_audio_seconds,
            max_payload_bytes=self.max_payload_bytes,
        )

    def health(self) -> dict[str, object]:
        with self._state_lock:
            deletion_requested = self._deletion_requested
        profile = None
        compatible = False
        complete = False
        try:
            profile = self.store.load()
            compatible = bool(
                profile
                and profile.model_id == self.embedder.model_id
                and profile.model_revision == self.model_revision
            )
            complete = bool(
                compatible and profile and profile.sample_count >= self.min_enrollment_samples
            )
            if profile is None:
                profile_state = "not_enrolled"
            elif not compatible:
                profile_state = "incompatible"
            elif complete:
                profile_state = "enrolled"
            else:
                profile_state = "enrolling"
            status = "ok"
        except ProfileStoreError:
            profile_state = "invalid"
            status = "degraded"
        if deletion_requested:
            profile_state = "deleting"
            complete = False
        return {
            "status": status,
            "role": "optional_mixed_audio_fallback",
            "primarySpeakerIdentity": "separate_microphone_and_system_audio_channels",
            "modelId": self.embedder.model_id,
            "modelRevision": self.model_revision,
            "modelLoaded": self.embedder.loaded,
            "ownerProfile": profile_state,
            "sampleCount": profile.sample_count if profile and compatible else 0,
            "requiredSampleCount": self.min_enrollment_samples,
            "enrollmentComplete": complete,
            "decisionPolicy": "owner_or_unknown_only",
        }

    def enroll_owner(self, payload: bytes) -> EnrollmentResult:
        with self._state_lock:
            enrollment_generation = self._profile_generation
            if self._deletion_requested:
                raise EnrollmentCancelledError("owner deletion is in progress")
        with self._operation_lock:
            audio = self._decode(payload)
            new_embedding = normalize_vector(
                self.embedder.embed(audio.samples, audio.sample_rate)
            )
            existing = self.store.load()
            replaced = False
            if (
                existing
                and existing.model_id == self.embedder.model_id
                and existing.model_revision == self.model_revision
                and len(existing.embedding) == len(new_embedding)
            ):
                consistency = cosine_similarity(existing.embedding, new_embedding)
                if consistency < self.enrollment_consistency_threshold:
                    raise EnrollmentConsistencyError(
                        "owner enrollment sample is inconsistent with the existing profile"
                    )
                embedding = merge_owner_embeddings(
                    existing.embedding, existing.sample_count, new_embedding
                )
                sample_count = existing.sample_count + 1
            else:
                replaced = existing is not None
                embedding = new_embedding
                sample_count = 1
            profile = OwnerVoiceProfile.create(
                model_id=self.embedder.model_id,
                model_revision=self.model_revision,
                embedding=embedding,
                sample_count=sample_count,
            )
            with self._state_lock:
                if (
                    self._deletion_requested
                    or enrollment_generation != self._profile_generation
                ):
                    raise EnrollmentCancelledError(
                        "owner enrollment was cancelled by deletion"
                    )
                self.store.save(profile)
            return EnrollmentResult(
                accepted=True,
                enrolled=sample_count >= self.min_enrollment_samples,
                model_id=self.embedder.model_id,
                model_revision=self.model_revision,
                sample_count=sample_count,
                required_sample_count=self.min_enrollment_samples,
                enrollment_complete=sample_count >= self.min_enrollment_samples,
                audio_seconds=audio.duration_seconds,
                replaced_incompatible_profile=replaced,
            )

    def classify(self, payload: bytes) -> ClassificationResult:
        with self._operation_lock:
            profile = self.store.load()
            if profile is None:
                return ClassificationResult(
                    label="unknown",
                    similarity=None,
                    threshold=self.threshold,
                    reason="owner_not_enrolled",
                    audio_seconds=None,
                )
            if profile.model_id != self.embedder.model_id:
                return ClassificationResult(
                    label="unknown",
                    similarity=None,
                    threshold=self.threshold,
                    reason="profile_model_mismatch",
                    audio_seconds=None,
                )
            if profile.model_revision != self.model_revision:
                return ClassificationResult(
                    label="unknown",
                    similarity=None,
                    threshold=self.threshold,
                    reason="profile_model_mismatch",
                    audio_seconds=None,
                )
            if profile.sample_count < self.min_enrollment_samples:
                return ClassificationResult(
                    label="unknown",
                    similarity=None,
                    threshold=self.threshold,
                    reason="owner_enrollment_incomplete",
                    audio_seconds=None,
                )

            audio = self._decode(payload)
            candidate = self.embedder.embed(audio.samples, audio.sample_rate)
            similarity = cosine_similarity(profile.embedding, candidate)
            if similarity >= self.threshold:
                return ClassificationResult(
                    label="owner",
                    similarity=similarity,
                    threshold=self.threshold,
                    reason="owner_match",
                    audio_seconds=audio.duration_seconds,
                )
            return ClassificationResult(
                label="unknown",
                similarity=similarity,
                threshold=self.threshold,
                reason="below_owner_threshold",
                audio_seconds=audio.duration_seconds,
            )

    def request_owner_deletion(self) -> int:
        """Invalidate current enrollment work before waiting for model inference."""
        with self._state_lock:
            self._profile_generation += 1
            self._deletion_requested = True
            return self._profile_generation

    def delete_owner(self, deletion_generation: int | None = None) -> bool:
        if deletion_generation is None:
            deletion_generation = self.request_owner_deletion()
        with self._operation_lock:
            try:
                return self.store.delete()
            finally:
                with self._state_lock:
                    if self._profile_generation == deletion_generation:
                        self._deletion_requested = False
