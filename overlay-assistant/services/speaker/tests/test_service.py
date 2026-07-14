from __future__ import annotations

import io
import json
import math
import tempfile
import threading
import unittest
import wave
from collections.abc import Sequence
from pathlib import Path

from live_ai_speaker.service import EnrollmentCancelledError, SpeakerVerificationService
from live_ai_speaker.store import OwnerProfileStore


def wav_bytes(seconds: float = 0.1, sample_rate: int = 16_000) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        frames = bytearray()
        for index in range(round(seconds * sample_rate)):
            value = round(math.sin(index / 12) * 12_000)
            frames.extend(value.to_bytes(2, "little", signed=True))
        wav.writeframes(bytes(frames))
    return buffer.getvalue()


class FakeEmbedder:
    model_id = "test/speaker-model"
    model_revision = "test-revision-a"

    def __init__(self, embeddings: list[tuple[float, ...]]):
        self._embeddings = iter(embeddings)
        self.calls = 0

    @property
    def loaded(self) -> bool:
        return self.calls > 0

    def embed(self, samples: Sequence[float], sample_rate: int) -> tuple[float, ...]:
        self.calls += 1
        self.last_sample_rate = sample_rate
        self.last_sample_count = len(samples)
        return next(self._embeddings)


class BlockingEmbedder(FakeEmbedder):
    def __init__(self):
        super().__init__([(1.0, 0.0)])
        self.started = threading.Event()
        self.release = threading.Event()

    def embed(self, samples: Sequence[float], sample_rate: int) -> tuple[float, ...]:
        self.started.set()
        if not self.release.wait(timeout=2):
            raise RuntimeError("test embedding did not resume")
        return super().embed(samples, sample_rate)


class SpeakerVerificationServiceTests(unittest.TestCase):
    def make_service(
        self, directory: str, embeddings: list[tuple[float, ...]]
    ) -> tuple[SpeakerVerificationService, FakeEmbedder, Path]:
        embedder = FakeEmbedder(embeddings)
        profile_path = Path(directory) / "owner_embedding.json"
        service = SpeakerVerificationService(
            embedder=embedder,
            store=OwnerProfileStore(profile_path),
            threshold=0.82,
            sample_rate=16_000,
            min_audio_seconds=0.05,
            max_audio_seconds=2.0,
            max_payload_bytes=1_000_000,
            min_enrollment_samples=3,
            model_revision=embedder.model_revision,
        )
        return service, embedder, profile_path

    def test_unenrolled_audio_is_explicitly_unknown_without_inference(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            service, embedder, _ = self.make_service(directory, [])
            result = service.classify(wav_bytes())
            self.assertEqual(result.label, "unknown")
            self.assertEqual(result.reason, "owner_not_enrolled")
            self.assertIsNone(result.similarity)
            self.assertEqual(embedder.calls, 0)

    def test_owner_match_and_low_match_policy(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            service, _, profile_path = self.make_service(
                directory,
                [
                    (1.0, 0.0),
                    (1.0, 0.0),
                    (1.0, 0.0),
                    (0.99, 0.1),
                    (0.0, 1.0),
                ],
            )
            self.assertFalse(service.enroll_owner(wav_bytes()).enrolled)
            self.assertFalse(service.enroll_owner(wav_bytes()).enrolled)
            enrollment = service.enroll_owner(wav_bytes())
            self.assertTrue(enrollment.enrolled)
            self.assertTrue(enrollment.enrollment_complete)
            self.assertEqual(service.classify(wav_bytes()).label, "owner")

            uncertain = service.classify(wav_bytes())
            self.assertEqual(uncertain.label, "unknown")
            self.assertEqual(uncertain.reason, "below_owner_threshold")
            self.assertNotEqual(uncertain.label, "other")

            stored = json.loads(profile_path.read_text(encoding="utf-8"))
            self.assertNotIn("audio", stored)
            self.assertIn("embedding", stored)
            self.assertEqual(stored["modelRevision"], "test-revision-a")

    def test_additional_enrollment_merges_profile(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            service, _, _ = self.make_service(
                directory, [(1.0, 0.0), (0.8, 0.6)]
            )
            self.assertEqual(service.enroll_owner(wav_bytes()).sample_count, 1)
            self.assertEqual(service.enroll_owner(wav_bytes()).sample_count, 2)

    def test_partial_enrollment_stays_unknown_and_resumes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            service, embedder, _ = self.make_service(
                directory, [(1.0, 0.0), (1.0, 0.0), (1.0, 0.0), (1.0, 0.0)]
            )
            first = service.enroll_owner(wav_bytes())
            second = service.enroll_owner(wav_bytes())
            self.assertTrue(first.accepted)
            self.assertFalse(first.enrollment_complete)
            self.assertFalse(second.enrolled)
            self.assertEqual(service.health()["ownerProfile"], "enrolling")

            incomplete = service.classify(wav_bytes())
            self.assertEqual(incomplete.label, "unknown")
            self.assertEqual(incomplete.reason, "owner_enrollment_incomplete")
            self.assertEqual(embedder.calls, 2)

            third = service.enroll_owner(wav_bytes())
            self.assertTrue(third.enrollment_complete)
            self.assertEqual(service.health()["ownerProfile"], "enrolled")
            self.assertEqual(service.classify(wav_bytes()).label, "owner")

    def test_model_revision_change_requires_reenrollment_without_inference(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            service, _, profile_path = self.make_service(
                directory, [(1.0, 0.0), (1.0, 0.0), (1.0, 0.0)]
            )
            for _ in range(3):
                service.enroll_owner(wav_bytes())

            changed_embedder = FakeEmbedder([])
            changed_embedder.model_revision = "test-revision-b"
            changed_service = SpeakerVerificationService(
                embedder=changed_embedder,
                store=OwnerProfileStore(profile_path),
                threshold=0.82,
                sample_rate=16_000,
                min_audio_seconds=0.05,
                max_audio_seconds=2.0,
                max_payload_bytes=1_000_000,
                min_enrollment_samples=3,
                model_revision=changed_embedder.model_revision,
            )
            self.assertEqual(changed_service.health()["ownerProfile"], "incompatible")
            result = changed_service.classify(wav_bytes())
            self.assertEqual(result.reason, "profile_model_mismatch")
            self.assertEqual(changed_embedder.calls, 0)

    def test_owner_profile_can_be_deleted_without_raw_audio(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            service, _, profile_path = self.make_service(directory, [(1.0, 0.0)])
            service.enroll_owner(wav_bytes())
            self.assertTrue(profile_path.exists())
            abandoned_temp = profile_path.parent / ".owner_embedding.crash.tmp"
            abandoned_temp.write_text("partial", encoding="utf-8")
            self.assertTrue(service.delete_owner())
            self.assertFalse(profile_path.exists())
            self.assertFalse(abandoned_temp.exists())
            self.assertFalse(service.delete_owner())

    def test_delete_invalidates_an_inflight_enrollment_before_it_can_save(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            embedder = BlockingEmbedder()
            profile_path = Path(directory) / "owner_embedding.json"
            service = SpeakerVerificationService(
                embedder=embedder,
                store=OwnerProfileStore(profile_path),
                threshold=0.82,
                sample_rate=16_000,
                min_audio_seconds=0.05,
                max_audio_seconds=2.0,
                max_payload_bytes=1_000_000,
                min_enrollment_samples=3,
                model_revision=embedder.model_revision,
            )
            errors: list[Exception] = []

            def enroll() -> None:
                try:
                    service.enroll_owner(wav_bytes())
                except Exception as error:
                    errors.append(error)

            enrollment = threading.Thread(target=enroll)
            enrollment.start()
            self.assertTrue(embedder.started.wait(timeout=1))
            generation = service.request_owner_deletion()
            deletion = threading.Thread(target=service.delete_owner, args=(generation,))
            deletion.start()
            embedder.release.set()
            enrollment.join(timeout=2)
            deletion.join(timeout=2)

            self.assertEqual(len(errors), 1)
            self.assertIsInstance(errors[0], EnrollmentCancelledError)
            self.assertFalse(profile_path.exists())
            self.assertEqual(service.health()["ownerProfile"], "not_enrolled")


if __name__ == "__main__":
    unittest.main()
