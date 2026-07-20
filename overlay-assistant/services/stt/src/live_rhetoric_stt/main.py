from __future__ import annotations

import hmac
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from . import __version__
from .backend import FasterWhisperBackend, ModelUnavailableError
from .service import AudioValidationError, TranscriptionService
from .settings import Settings

settings = Settings.from_env()
backend = FasterWhisperBackend(
    model_id=settings.model_id,
    device=settings.device,
    compute_type=settings.compute_type,
    model_cache_dir=settings.model_cache_dir,
    temporary_dir=settings.temporary_dir,
)
service = TranscriptionService(
    backend=backend,
    min_audio_seconds=settings.min_audio_seconds,
    max_audio_seconds=settings.max_audio_seconds,
    max_payload_bytes=settings.max_payload_bytes,
)

app = FastAPI(
    title="Live Rhetoric Local STT",
    version=__version__,
    description="Loopback-only OpenAI-compatible local transcription service.",
)


class ModelEntry(BaseModel):
    id: str
    object: Literal["model"] = "model"
    owned_by: Literal["local"] = "local"


class ModelList(BaseModel):
    object: Literal["list"] = "list"
    data: list[ModelEntry]


class TranscriptionResponse(BaseModel):
    text: str
    model: str
    language: str | None
    audioSeconds: float


def _authorize(
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    if settings.api_token is None:
        return
    scheme, _, credential = (authorization or "").partition(" ")
    if not (
        scheme.lower() == "bearer"
        and hmac.compare_digest(credential, settings.api_token)
    ):
        raise HTTPException(status_code=401, detail="valid bearer token required")


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "status": "ok",
        "model": settings.model_id,
        "modelLoaded": backend.loaded,
        "rawAudioStored": False,
    }


@app.get(
    "/v1/models",
    response_model=ModelList,
    dependencies=[Depends(_authorize)],
)
def models() -> ModelList:
    return ModelList(data=[ModelEntry(id=settings.model_id)])


@app.post(
    "/v1/audio/transcriptions",
    response_model=TranscriptionResponse,
    dependencies=[Depends(_authorize)],
)
async def transcribe(
    file: Annotated[UploadFile, File()],
    model: Annotated[str, Form()],
    language: Annotated[str | None, Form()] = None,
    response_format: Annotated[str, Form()] = "json",
) -> dict[str, object]:
    if model != settings.model_id:
        raise HTTPException(status_code=400, detail="requested model is unavailable")
    if response_format != "json":
        raise HTTPException(status_code=400, detail="only JSON response format is supported")
    payload = await _bounded_upload(file)
    try:
        result = await run_in_threadpool(service.transcribe, payload, language)
        return result.to_dict()
    except AudioValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ModelUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


async def _bounded_upload(file: UploadFile) -> bytes:
    received = 0
    chunks: list[bytes] = []
    try:
        while chunk := await file.read(64 * 1024):
            received += len(chunk)
            if received > settings.max_payload_bytes:
                raise HTTPException(
                    status_code=413,
                    detail="audio body exceeds the configured size limit",
                )
            chunks.append(chunk)
    finally:
        await file.close()
    return b"".join(chunks)
