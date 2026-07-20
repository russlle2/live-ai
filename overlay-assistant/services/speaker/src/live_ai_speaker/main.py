from __future__ import annotations

import hmac
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from . import __version__
from .audio import AudioValidationError
from .backend import ModelUnavailableError, TransformersSpeakerEmbedder
from .service import (
    EnrollmentCancelledError,
    EnrollmentConsistencyError,
    SpeakerVerificationService,
)
from .settings import Settings
from .store import OwnerProfileStore, ProfileStoreError

settings = Settings.from_env()
embedder = TransformersSpeakerEmbedder(settings)
verifier = SpeakerVerificationService(
    embedder=embedder,
    store=OwnerProfileStore(settings.profile_path),
    threshold=settings.owner_threshold,
    sample_rate=settings.sample_rate,
    min_audio_seconds=settings.min_audio_seconds,
    max_audio_seconds=settings.max_audio_seconds,
    max_payload_bytes=settings.max_payload_bytes,
    min_enrollment_samples=settings.min_enrollment_samples,
    model_revision=settings.model_revision,
    enrollment_consistency_threshold=settings.enrollment_consistency_threshold,
)

app = FastAPI(
    title="Live AI Speaker Verifier",
    version=__version__,
    description=(
        "Optional mixed-audio owner verification. It returns owner only for a strong "
        "match; every non-match or uncertain result is unknown."
    ),
)


class EnrollmentResponse(BaseModel):
    accepted: bool
    enrolled: bool
    modelId: str
    modelRevision: str
    sampleCount: int
    requiredSampleCount: int
    enrollmentComplete: bool
    audioSeconds: float
    replacedIncompatibleProfile: bool
    rawAudioStored: bool


class ClassificationResponse(BaseModel):
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
    audioSeconds: float | None
    decisionPolicy: Literal["owner_or_unknown_only"]


class DeleteOwnerResponse(BaseModel):
    deleted: bool
    ownerProfile: Literal["not_enrolled"]


def _authorize(
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    if settings.api_token is None:
        return
    scheme, _, credential = (authorization or "").partition(" ")
    authorized = scheme.lower() == "bearer" and hmac.compare_digest(
        credential, settings.api_token
    )
    if not authorized:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="valid bearer token required",
        )


async def _wav_body(request: Request) -> bytes:
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > settings.max_payload_bytes:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail="audio body exceeds the configured size limit",
                )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="invalid content-length") from exc
    chunks: list[bytes] = []
    received = 0
    async for chunk in request.stream():
        received += len(chunk)
        if received > settings.max_payload_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="audio body exceeds the configured size limit",
            )
        chunks.append(chunk)
    return b"".join(chunks)


def _translate_error(exc: Exception) -> HTTPException:
    if isinstance(exc, EnrollmentCancelledError):
        return HTTPException(status_code=409, detail=str(exc))
    if isinstance(exc, EnrollmentConsistencyError):
        return HTTPException(status_code=422, detail=str(exc))
    if isinstance(exc, AudioValidationError):
        return HTTPException(status_code=422, detail=str(exc))
    if isinstance(exc, ModelUnavailableError):
        return HTTPException(status_code=503, detail=str(exc))
    if isinstance(exc, ProfileStoreError):
        return HTTPException(status_code=500, detail=str(exc))
    return HTTPException(status_code=500, detail="speaker verification failed")


@app.get("/health")
def health() -> dict[str, object]:
    return verifier.health()


@app.post(
    "/v1/owner/enroll",
    response_model=EnrollmentResponse,
    dependencies=[Depends(_authorize)],
)
async def enroll_owner(request: Request) -> dict[str, object]:
    try:
        payload = await _wav_body(request)
        result = await run_in_threadpool(verifier.enroll_owner, payload)
        return result.to_dict()
    except HTTPException:
        raise
    except Exception as exc:
        raise _translate_error(exc) from exc


@app.post(
    "/v1/segments/classify",
    response_model=ClassificationResponse,
    dependencies=[Depends(_authorize)],
)
async def classify_segment(request: Request) -> dict[str, object]:
    try:
        payload = await _wav_body(request)
        result = await run_in_threadpool(verifier.classify, payload)
        return result.to_dict()
    except HTTPException:
        raise
    except Exception as exc:
        raise _translate_error(exc) from exc


@app.delete(
    "/v1/owner",
    response_model=DeleteOwnerResponse,
    dependencies=[Depends(_authorize)],
)
async def delete_owner() -> dict[str, object]:
    try:
        deletion_generation = verifier.request_owner_deletion()
        deleted = await run_in_threadpool(verifier.delete_owner, deletion_generation)
        return {"deleted": deleted, "ownerProfile": "not_enrolled"}
    except Exception as exc:
        raise _translate_error(exc) from exc
